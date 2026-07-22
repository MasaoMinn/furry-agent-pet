use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    io::{Cursor, Read},
    num::NonZeroU64,
    path::{Component, Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex,
    },
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::DialogExt;

const MANIFEST_FILE_NAME: &str = "pet.json";
const IMPORT_DIRECTORY_NAME: &str = "pet-packages";
const LOCAL_ID_PREFIX: &str = "local-";
const LOCAL_ID_HEX_LENGTH: usize = 24;
const MAX_MANIFEST_BYTES: u64 = 64 * 1_024;
const MAX_ANIMATIONS: usize = 64;
const MAX_IMPORTED_PACKAGES: usize = 32;
const MAX_ASSET_BYTES: u64 = 10 * 1_024 * 1_024;
const MAX_PACKAGE_BYTES: u64 = 64 * 1_024 * 1_024;
const MAX_IMAGE_DIMENSION: u32 = 2_048;
const MAX_GIF_FRAMES: u64 = 300;
const MAX_DECODED_PIXELS: u64 = 120_000_000;
const MAX_GIF_LOOP_CENTISECONDS: u64 = 6_000;
const MIN_GIF_DELAY_CENTISECONDS: u16 = 2;
const IMAGE_DECODER_MEMORY_BYTES: usize = 32 * 1_024 * 1_024;
const MAX_VARIANTS_PER_STATE: usize = 16;
const MAX_VARIANTS_TOTAL: usize = 64;
const MAX_VARIANT_DELAY_MS: u64 = 86_400_000;
const MAX_INTERACTION_ACTIONS: usize = 32;
const MIN_INTERACTION_DURATION_MS: u64 = 100;
const MAX_INTERACTION_DURATION_MS: u64 = 60_000;
const STALE_STAGING_AGE: Duration = Duration::from_secs(24 * 60 * 60);
const AGENT_STATES: [&str; 7] = [
    "idle", "thinking", "planning", "coding", "testing", "success", "error",
];

static PACKAGE_STORE_LOCK: Mutex<()> = Mutex::new(());
static STAGING_COUNTER: AtomicU64 = AtomicU64::new(0);

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PetPackageManifest {
    schema_version: u32,
    id: String,
    name: String,
    version: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    description: Option<String>,
    author: String,
    license: String,
    canvas: PetCanvas,
    animations: BTreeMap<String, PetAnimation>,
    states: BTreeMap<String, String>,
    #[serde(default)]
    state_variants: BTreeMap<String, Vec<PetStateVariant>>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    interactions: BTreeMap<String, PetInteractionAction>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    reduced_motion_animations: BTreeMap<String, String>,
    fallback_animation: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct PetCanvas {
    width: u32,
    height: u32,
    fit: String,
    anchor: PetAnchor,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct PetAnchor {
    x: f64,
    y: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PetAnimation {
    source: String,
    media_type: String,
    #[serde(rename = "loop")]
    loops: bool,
    alt: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PetStateVariant {
    animation: String,
    activate_after_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PetInteractionAction {
    animation: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    duration_ms: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedPetPackageDto {
    catalog_id: String,
    manifest_path: String,
    asset_paths: BTreeMap<String, String>,
    manifest: PetPackageManifest,
}

#[derive(Debug)]
struct ValidatedPackage {
    manifest: PetPackageManifest,
    manifest_bytes: Vec<u8>,
    assets: BTreeMap<String, Vec<u8>>,
    catalog_id: String,
}

#[tauri::command]
pub async fn list_imported_pet_packages(
    app: AppHandle,
) -> Result<Vec<ImportedPetPackageDto>, String> {
    let root = imported_packages_root(&app)?;
    tauri::async_runtime::spawn_blocking(move || list_installed_packages(&root))
        .await
        .map_err(|_| "Could not inspect imported pet packages".to_owned())?
}

#[tauri::command]
pub async fn import_pet_package(app: AppHandle) -> Result<Option<ImportedPetPackageDto>, String> {
    let Some(selected) = app
        .dialog()
        .file()
        .add_filter("furry-agent-pet package", &["json"])
        .blocking_pick_file()
    else {
        return Ok(None);
    };
    let manifest_path = selected
        .into_path()
        .map_err(|_| "The selected manifest is not a local file".to_owned())?;
    let root = imported_packages_root(&app)?;
    tauri::async_runtime::spawn_blocking(move || install_package(&manifest_path, &root))
        .await
        .map_err(|_| "Could not import the selected pet package".to_owned())?
        .map(Some)
}

#[tauri::command]
pub async fn remove_imported_pet_package(app: AppHandle, catalog_id: String) -> Result<(), String> {
    let root = imported_packages_root(&app)?;
    tauri::async_runtime::spawn_blocking(move || remove_installed_package(&root, &catalog_id))
        .await
        .map_err(|_| "Could not remove the imported pet package".to_owned())?
}

fn imported_packages_root(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|path| path.join(IMPORT_DIRECTORY_NAME))
        .map_err(|_| "Could not resolve the application data directory".to_owned())
}

fn install_package(manifest_path: &Path, root: &Path) -> Result<ImportedPetPackageDto, String> {
    let _store_guard = lock_package_store()?;
    let validated = validate_package_source(manifest_path)?;
    fs::create_dir_all(root)
        .map_err(|_| "Could not prepare the pet package directory".to_owned())?;
    reject_link_or_reparse(root)?;
    cleanup_stale_staging_directories(root);

    let destination = root.join(&validated.catalog_id);
    if destination.exists() {
        if let Ok(existing) = load_installed_package(&destination) {
            return Ok(existing);
        }
        remove_managed_directory(root, &destination)?;
    } else if installed_package_count(root) >= MAX_IMPORTED_PACKAGES {
        return Err(format!(
            "No more than {MAX_IMPORTED_PACKAGES} local pet packages can be installed"
        ));
    }

    let staging = create_staging_directory(root, &validated.catalog_id)?;

    let install_result = (|| {
        fs::write(staging.join(MANIFEST_FILE_NAME), &validated.manifest_bytes)
            .map_err(|_| "Could not copy the pet package manifest".to_owned())?;
        for (source, bytes) in &validated.assets {
            let destination = staging.join(source_path(source)?);
            if let Some(parent) = destination.parent() {
                fs::create_dir_all(parent)
                    .map_err(|_| "Could not create an animation directory".to_owned())?;
            }
            fs::write(&destination, bytes)
                .map_err(|_| "Could not copy a pet animation".to_owned())?;
        }
        fs::rename(&staging, &destination)
            .map_err(|_| "Could not finish installing the pet package".to_owned())?;
        Ok::<(), String>(())
    })();

    if let Err(error) = install_result {
        let _ = fs::remove_dir_all(&staging);
        return Err(error);
    }

    let manifest_path = managed_path_to_string(&destination.join(MANIFEST_FILE_NAME))?;
    let asset_paths = installed_asset_paths(&destination, &validated.manifest)?;
    Ok(ImportedPetPackageDto {
        catalog_id: validated.catalog_id,
        manifest_path,
        asset_paths,
        manifest: validated.manifest,
    })
}

fn list_installed_packages(root: &Path) -> Result<Vec<ImportedPetPackageDto>, String> {
    let _store_guard = lock_package_store()?;
    if !root.exists() {
        return Ok(Vec::new());
    }
    reject_link_or_reparse(root)?;
    let mut directories = fs::read_dir(root)
        .map_err(|_| "Could not inspect imported pet packages".to_owned())?
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .collect::<Vec<_>>();
    directories.sort();

    let mut packages = Vec::new();
    for directory in directories {
        if packages.len() >= MAX_IMPORTED_PACKAGES {
            break;
        }
        if let Ok(package) = load_installed_package(&directory) {
            packages.push(package);
        }
    }
    Ok(packages)
}

fn load_installed_package(directory: &Path) -> Result<ImportedPetPackageDto, String> {
    let catalog_id = directory
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "Imported pet package id is invalid".to_owned())?;
    validate_catalog_id(catalog_id)?;
    reject_link_or_reparse(directory)?;
    let validated = validate_package_source(&directory.join(MANIFEST_FILE_NAME))?;
    if validated.catalog_id != catalog_id {
        return Err("Imported pet package content hash does not match its id".to_owned());
    }
    let manifest_path = managed_path_to_string(&directory.join(MANIFEST_FILE_NAME))?;
    let asset_paths = installed_asset_paths(directory, &validated.manifest)?;
    Ok(ImportedPetPackageDto {
        catalog_id: catalog_id.to_owned(),
        manifest_path,
        asset_paths,
        manifest: validated.manifest,
    })
}

fn installed_asset_paths(
    directory: &Path,
    manifest: &PetPackageManifest,
) -> Result<BTreeMap<String, String>, String> {
    let mut paths = BTreeMap::new();
    for animation in manifest.animations.values() {
        if paths.contains_key(&animation.source) {
            continue;
        }
        let asset_path = directory.join(source_path(&animation.source)?);
        paths.insert(
            animation.source.clone(),
            managed_path_to_string(&asset_path)?,
        );
    }
    Ok(paths)
}

fn managed_path_to_string(path: &Path) -> Result<String, String> {
    path.to_str()
        .map(str::to_owned)
        .ok_or_else(|| "The local pet package path is not valid UTF-8".to_owned())
}

fn remove_installed_package(root: &Path, catalog_id: &str) -> Result<(), String> {
    let _store_guard = lock_package_store()?;
    validate_catalog_id(catalog_id)?;
    if !root.exists() {
        return Ok(());
    }
    reject_link_or_reparse(root)?;
    let directory = root.join(catalog_id);
    if !directory.exists() {
        return Ok(());
    }
    remove_managed_directory(root, &directory)
}

fn remove_managed_directory(root: &Path, directory: &Path) -> Result<(), String> {
    reject_link_or_reparse(directory)?;
    let canonical_root = root
        .canonicalize()
        .map_err(|_| "Could not validate the pet package directory".to_owned())?;
    let canonical_directory = directory
        .canonicalize()
        .map_err(|_| "Could not validate the selected pet package".to_owned())?;
    if canonical_directory == canonical_root || !canonical_directory.starts_with(&canonical_root) {
        return Err("Refusing to modify a path outside the pet package directory".to_owned());
    }
    validate_managed_tree_no_links(&canonical_directory)?;
    fs::remove_dir_all(canonical_directory)
        .map_err(|_| "Could not remove the imported pet package".to_owned())
}

fn validate_package_source(manifest_path: &Path) -> Result<ValidatedPackage, String> {
    if manifest_path.file_name().and_then(|name| name.to_str()) != Some(MANIFEST_FILE_NAME) {
        return Err("Select a file named pet.json".to_owned());
    }
    reject_link_or_reparse(manifest_path)?;

    let source_root = manifest_path
        .parent()
        .ok_or_else(|| "The pet package manifest has no parent directory".to_owned())?;
    reject_link_or_reparse(source_root)?;
    let canonical_root = source_root
        .canonicalize()
        .map_err(|_| "Could not validate the pet package directory".to_owned())?;
    let manifest_bytes =
        read_bounded_regular_file(manifest_path, MAX_MANIFEST_BYTES, PackageFileKind::Manifest)?;
    let manifest: PetPackageManifest = serde_json::from_slice(&manifest_bytes)
        .map_err(|_| "The selected pet.json is not a valid package manifest".to_owned())?;
    validate_manifest(&manifest)?;

    let mut assets = BTreeMap::new();
    let mut path_keys = BTreeSet::new();
    let mut total_bytes = manifest_bytes.len() as u64;
    let mut total_decoded_pixels = 0_u64;
    for animation in manifest.animations.values() {
        let collision_key = animation.source.to_lowercase();
        if !path_keys.insert(collision_key) && !assets.contains_key(&animation.source) {
            return Err("Animation paths differ only by case".to_owned());
        }
        if assets.contains_key(&animation.source) {
            continue;
        }
        let relative_path = source_path(&animation.source)?;
        let source_path = source_root.join(&relative_path);
        validate_source_components(source_root, &relative_path)?;
        let canonical_source = source_path
            .canonicalize()
            .map_err(|_| "A referenced pet animation does not exist".to_owned())?;
        if !canonical_source.starts_with(&canonical_root) {
            return Err("A pet animation escapes the package directory".to_owned());
        }
        reject_link_or_reparse(&source_path)?;
        let bytes =
            read_bounded_regular_file(&source_path, MAX_ASSET_BYTES, PackageFileKind::Asset)?;
        total_bytes = total_bytes
            .checked_add(bytes.len() as u64)
            .ok_or_else(|| "The pet package size is invalid".to_owned())?;
        if total_bytes > MAX_PACKAGE_BYTES {
            return Err(format!(
                "The pet package exceeds the {MAX_PACKAGE_BYTES} byte limit"
            ));
        }
        let decoded_pixels = validate_media(
            &animation.source,
            &animation.media_type,
            animation.loops,
            &bytes,
        )?;
        add_to_decoded_pixel_budget(&mut total_decoded_pixels, decoded_pixels)?;
        assets.insert(animation.source.clone(), bytes);
    }

    let mut hasher = Sha256::new();
    hasher.update((manifest_bytes.len() as u64).to_le_bytes());
    hasher.update(&manifest_bytes);
    for (source, bytes) in &assets {
        hasher.update((source.len() as u64).to_le_bytes());
        hasher.update(source.as_bytes());
        hasher.update((bytes.len() as u64).to_le_bytes());
        hasher.update(bytes);
    }
    let digest = format!("{:x}", hasher.finalize());
    let catalog_id = format!("{LOCAL_ID_PREFIX}{}", &digest[..LOCAL_ID_HEX_LENGTH]);

    Ok(ValidatedPackage {
        manifest,
        manifest_bytes,
        assets,
        catalog_id,
    })
}

fn validate_manifest(manifest: &PetPackageManifest) -> Result<(), String> {
    if manifest.schema_version != 1 {
        return Err("Unsupported pet package schema".to_owned());
    }
    validate_identifier(&manifest.id, "package id")?;
    validate_text(&manifest.name, 128, "package name")?;
    validate_text(&manifest.version, 64, "package version")?;
    validate_text(&manifest.author, 128, "package author")?;
    validate_text(&manifest.license, 128, "package license")?;
    if let Some(description) = manifest.description.as_deref() {
        validate_text(description, 1_024, "package description")?;
    }
    if manifest.canvas.width == 0
        || manifest.canvas.height == 0
        || manifest.canvas.width > MAX_IMAGE_DIMENSION
        || manifest.canvas.height > MAX_IMAGE_DIMENSION
    {
        return Err("Pet package canvas dimensions are invalid".to_owned());
    }
    if manifest.canvas.fit != "contain" && manifest.canvas.fit != "cover" {
        return Err("Pet package canvas fit is invalid".to_owned());
    }
    if !manifest.canvas.anchor.x.is_finite()
        || !manifest.canvas.anchor.y.is_finite()
        || !(0.0..=1.0).contains(&manifest.canvas.anchor.x)
        || !(0.0..=1.0).contains(&manifest.canvas.anchor.y)
    {
        return Err("Pet package canvas anchor is invalid".to_owned());
    }
    if manifest.animations.is_empty() || manifest.animations.len() > MAX_ANIMATIONS {
        return Err(format!(
            "Pet packages must contain between 1 and {MAX_ANIMATIONS} animations"
        ));
    }
    for (id, animation) in &manifest.animations {
        validate_identifier(id, "animation id")?;
        validate_text(&animation.alt, 256, "animation alt text")?;
        source_path(&animation.source)?;
        expected_extension(&animation.source, &animation.media_type)?;
    }
    if !manifest
        .animations
        .contains_key(&manifest.fallback_animation)
    {
        return Err("Pet package fallback animation does not exist".to_owned());
    }
    if manifest.states.len() != AGENT_STATES.len() {
        return Err("Pet package must map exactly seven Agent states".to_owned());
    }
    for state in AGENT_STATES {
        let animation = manifest
            .states
            .get(state)
            .ok_or_else(|| format!("Pet package is missing the {state} state"))?;
        if !manifest.animations.contains_key(animation) {
            return Err(format!(
                "Pet package state {state} references an unknown animation"
            ));
        }
    }
    if manifest
        .states
        .keys()
        .any(|state| !AGENT_STATES.contains(&state.as_str()))
    {
        return Err("Pet package contains an unknown Agent state".to_owned());
    }

    let mut total_variants = 0_usize;
    for (state, variants) in &manifest.state_variants {
        if !AGENT_STATES.contains(&state.as_str()) {
            return Err("Pet package contains variants for an unknown state".to_owned());
        }
        if variants.len() > MAX_VARIANTS_PER_STATE {
            return Err(format!(
                "A state cannot contain more than {MAX_VARIANTS_PER_STATE} delayed variants"
            ));
        }
        total_variants += variants.len();
        for variant in variants {
            if !manifest.animations.contains_key(&variant.animation) {
                return Err("A delayed variant references an unknown animation".to_owned());
            }
            if variant.activate_after_ms == 0 || variant.activate_after_ms > MAX_VARIANT_DELAY_MS {
                return Err("A delayed variant duration is outside the supported range".to_owned());
            }
        }
    }
    if total_variants > MAX_VARIANTS_TOTAL {
        return Err(format!(
            "A pet package cannot contain more than {MAX_VARIANTS_TOTAL} delayed variants"
        ));
    }

    if manifest.interactions.len() > MAX_INTERACTION_ACTIONS {
        return Err(format!(
            "A pet package cannot contain more than {MAX_INTERACTION_ACTIONS} interaction actions"
        ));
    }
    for (interaction_id, action) in &manifest.interactions {
        validate_identifier(interaction_id, "interaction id")?;
        if !manifest.animations.contains_key(&action.animation) {
            return Err(format!(
                "Pet package interaction {interaction_id} references an unknown animation"
            ));
        }
        if action.duration_ms.is_some_and(|duration_ms| {
            !(MIN_INTERACTION_DURATION_MS..=MAX_INTERACTION_DURATION_MS).contains(&duration_ms)
        }) {
            return Err(format!(
                "Pet package interaction {interaction_id} duration is outside the supported range"
            ));
        }
    }

    for (animation_id, reduced_motion_animation_id) in &manifest.reduced_motion_animations {
        validate_identifier(animation_id, "reduced-motion animation id")?;
        validate_identifier(
            reduced_motion_animation_id,
            "reduced-motion target animation id",
        )?;
        let source_animation = manifest.animations.get(animation_id).ok_or_else(|| {
            format!("Reduced-motion mapping {animation_id} references an unknown animation")
        })?;
        if source_animation.media_type != "image/gif" {
            return Err(format!(
                "Reduced-motion mapping {animation_id} source must be a GIF"
            ));
        }
        let target_animation = manifest
            .animations
            .get(reduced_motion_animation_id)
            .ok_or_else(|| {
                format!("Reduced-motion mapping {animation_id} references an unknown target")
            })?;
        if target_animation.media_type == "image/gif" || target_animation.loops {
            return Err(format!(
                "Reduced-motion mapping {animation_id} target must be a non-looping PNG or WebP"
            ));
        }
    }
    Ok(())
}

fn validate_media(
    source: &str,
    media_type: &str,
    loops: bool,
    bytes: &[u8],
) -> Result<u64, String> {
    match media_type {
        "image/gif" => validate_gif(bytes, loops),
        "image/png" => validate_png(bytes),
        "image/webp" => validate_webp(bytes),
        _ => Err(format!("Unsupported media type for animation {source}")),
    }
}

fn validate_gif(bytes: &[u8], loops: bool) -> Result<u64, String> {
    let memory_limit = NonZeroU64::new(16 * 1_024 * 1_024).expect("non-zero GIF memory limit");
    let mut options = gif::DecodeOptions::new();
    options.set_color_output(gif::ColorOutput::Indexed);
    options.set_memory_limit(gif::MemoryLimit::Bytes(memory_limit));
    options.check_frame_consistency(true);
    options.skip_frame_decoding(true);
    let mut decoder = options
        .read_info(Cursor::new(bytes))
        .map_err(|_| "A declared GIF has invalid data".to_owned())?;
    let width = u32::from(decoder.width());
    let height = u32::from(decoder.height());
    validate_dimensions(width, height)?;
    let repeats_forever = decoder.repeat() == gif::Repeat::Infinite;
    if repeats_forever != loops {
        return Err(if loops {
            "A GIF declared with loop=true must contain an infinite repeat extension".to_owned()
        } else {
            "A GIF declared with loop=false must not contain an infinite repeat extension"
                .to_owned()
        });
    }

    let mut frame_count = 0_u64;
    let mut loop_duration = 0_u64;
    let mut has_too_fast_frame = false;
    while let Some(frame) = decoder
        .read_next_frame()
        .map_err(|_| "A declared GIF has invalid frame data".to_owned())?
    {
        frame_count += 1;
        if frame_count > MAX_GIF_FRAMES {
            return Err(format!(
                "GIF animations cannot exceed {MAX_GIF_FRAMES} frames"
            ));
        }
        has_too_fast_frame |= frame.delay < MIN_GIF_DELAY_CENTISECONDS;
        loop_duration = loop_duration.saturating_add(u64::from(frame.delay));
        if loop_duration > MAX_GIF_LOOP_CENTISECONDS {
            return Err("A single GIF loop is too long".to_owned());
        }
    }
    if frame_count == 0 {
        return Err("GIF animation contains no frames".to_owned());
    }
    if frame_count > 1 && has_too_fast_frame {
        return Err("GIF animation frame rate is too high".to_owned());
    }
    let animated_pixels = decoded_pixel_count(width, height, frame_count)?;
    if animated_pixels > MAX_DECODED_PIXELS {
        return Err(format!(
            "GIF animation exceeds the {MAX_DECODED_PIXELS} decoded pixel limit"
        ));
    }
    Ok(animated_pixels)
}

fn validate_png(bytes: &[u8]) -> Result<u64, String> {
    let mut decoder = png::Decoder::new(Cursor::new(bytes));
    decoder.set_limits(png::Limits {
        bytes: IMAGE_DECODER_MEMORY_BYTES,
    });
    let mut reader = decoder
        .read_info()
        .map_err(|_| "A declared PNG has invalid file data".to_owned())?;
    let (width, height, animated) = {
        let info = reader.info();
        (info.width, info.height, info.animation_control.is_some())
    };
    if animated {
        return Err("Animated PNG is not supported for local packages".to_owned());
    }
    validate_dimensions(width, height)?;
    let buffer_size = reader
        .output_buffer_size()
        .ok_or_else(|| "PNG decoded size is invalid".to_owned())?;
    if buffer_size > IMAGE_DECODER_MEMORY_BYTES {
        return Err("PNG decoded data exceeds the memory limit".to_owned());
    }
    let mut buffer = vec![0; buffer_size];
    reader
        .next_frame(&mut buffer)
        .map_err(|_| "A declared PNG has invalid image data".to_owned())?;
    reader
        .finish()
        .map_err(|_| "A declared PNG has invalid trailing data".to_owned())?;
    decoded_pixel_count(width, height, 1)
}

fn validate_webp(bytes: &[u8]) -> Result<u64, String> {
    let container_dimensions = inspect_webp_container(bytes)?;
    let mut decoder = image_webp::WebPDecoder::new(Cursor::new(bytes))
        .map_err(|_| "A declared WebP has invalid image data".to_owned())?;
    decoder.set_memory_limit(IMAGE_DECODER_MEMORY_BYTES);
    if decoder.is_animated() {
        return Err("Animated WebP is not supported for local packages".to_owned());
    }
    let dimensions = decoder.dimensions();
    if dimensions != container_dimensions {
        return Err("WebP container and image dimensions do not match".to_owned());
    }
    validate_dimensions(dimensions.0, dimensions.1)?;
    let buffer_size = decoder
        .output_buffer_size()
        .ok_or_else(|| "WebP decoded size is invalid".to_owned())?;
    if buffer_size > IMAGE_DECODER_MEMORY_BYTES {
        return Err("WebP decoded data exceeds the memory limit".to_owned());
    }
    let mut buffer = vec![0; buffer_size];
    decoder
        .read_image(&mut buffer)
        .map_err(|_| "A declared WebP has invalid image data".to_owned())?;
    decoded_pixel_count(dimensions.0, dimensions.1, 1)
}

fn inspect_webp_container(bytes: &[u8]) -> Result<(u32, u32), String> {
    if bytes.len() < 20 || &bytes[0..4] != b"RIFF" || &bytes[8..12] != b"WEBP" {
        return Err("A declared WebP has invalid file data".to_owned());
    }
    let riff_size = read_le_u32(&bytes[4..8]) as usize;
    let container_end = riff_size
        .checked_add(8)
        .ok_or_else(|| "WebP container size is invalid".to_owned())?;
    if container_end != bytes.len() {
        return Err(if container_end > bytes.len() {
            "WebP data is truncated".to_owned()
        } else {
            "WebP data exists outside the declared RIFF container".to_owned()
        });
    }

    let mut offset = 12_usize;
    let mut chunk_index = 0_usize;
    let mut extended_dimensions = None;
    let mut image_dimensions = None;
    while offset < container_end {
        if offset.checked_add(8).is_none_or(|end| end > container_end) {
            return Err("WebP chunk header is truncated".to_owned());
        }
        let chunk_type = &bytes[offset..offset + 4];
        let length = read_le_u32(&bytes[offset + 4..offset + 8]) as usize;
        let data_start = offset + 8;
        let data_end = data_start
            .checked_add(length)
            .ok_or_else(|| "WebP chunk size is invalid".to_owned())?;
        let padded_end = data_end
            .checked_add(length & 1)
            .ok_or_else(|| "WebP chunk size is invalid".to_owned())?;
        if padded_end > container_end {
            return Err("WebP data is truncated".to_owned());
        }
        let data = &bytes[data_start..data_end];
        match chunk_type {
            b"ANIM" | b"ANMF" => {
                return Err("Animated WebP is not supported for local packages".to_owned())
            }
            b"VP8X" => {
                if chunk_index != 0 || data.len() != 10 || extended_dimensions.is_some() {
                    return Err("WebP has an invalid extended header".to_owned());
                }
                if data[0] & 0b0000_0010 != 0 {
                    return Err("Animated WebP is not supported for local packages".to_owned());
                }
                if data[0] & 0b1100_0001 != 0 || data[1..4] != [0, 0, 0] {
                    return Err("WebP extended header contains reserved flags".to_owned());
                }
                extended_dimensions =
                    Some((1 + read_le_u24(&data[4..7]), 1 + read_le_u24(&data[7..10])));
            }
            b"VP8 " => {
                if image_dimensions.is_some() || data.len() < 10 || data[3..6] != [0x9d, 0x01, 0x2a]
                {
                    return Err("WebP has invalid or duplicate VP8 image data".to_owned());
                }
                image_dimensions = Some((
                    u32::from(u16::from_le_bytes([data[6], data[7]]) & 0x3fff),
                    u32::from(u16::from_le_bytes([data[8], data[9]]) & 0x3fff),
                ));
            }
            b"VP8L" => {
                if image_dimensions.is_some() || data.len() < 5 || data[0] != 0x2f {
                    return Err("WebP has invalid or duplicate VP8L image data".to_owned());
                }
                image_dimensions = Some((
                    1 + u32::from(data[1]) + (u32::from(data[2] & 0x3f) << 8),
                    1 + (u32::from(data[2] >> 6))
                        + (u32::from(data[3]) << 2)
                        + (u32::from(data[4] & 0x0f) << 10),
                ));
            }
            _ => {}
        }
        offset = padded_end;
        chunk_index += 1;
    }
    if offset != container_end {
        return Err("WebP container length is invalid".to_owned());
    }
    let (width, height) =
        image_dimensions.ok_or_else(|| "WebP image dimensions are missing".to_owned())?;
    if extended_dimensions.is_some_and(|dimensions| dimensions != (width, height)) {
        return Err("WebP extended and image dimensions do not match".to_owned());
    }
    validate_dimensions(width, height).map(|()| (width, height))
}

fn decoded_pixel_count(width: u32, height: u32, frames: u64) -> Result<u64, String> {
    u64::from(width)
        .checked_mul(u64::from(height))
        .and_then(|pixels| pixels.checked_mul(frames))
        .ok_or_else(|| "Pet animation decoded pixel count is invalid".to_owned())
}

fn add_to_decoded_pixel_budget(total: &mut u64, decoded_pixels: u64) -> Result<(), String> {
    *total = total
        .checked_add(decoded_pixels)
        .ok_or_else(|| "The pet package decoded pixel budget is invalid".to_owned())?;
    if *total > MAX_DECODED_PIXELS {
        return Err(format!(
            "The pet package exceeds the {MAX_DECODED_PIXELS} decoded pixel limit"
        ));
    }
    Ok(())
}

fn validate_dimensions(width: u32, height: u32) -> Result<(), String> {
    if width == 0 || height == 0 || width > MAX_IMAGE_DIMENSION || height > MAX_IMAGE_DIMENSION {
        return Err(format!(
            "Pet animation dimensions must be between 1 and {MAX_IMAGE_DIMENSION} pixels"
        ));
    }
    Ok(())
}

fn expected_extension(source: &str, media_type: &str) -> Result<(), String> {
    let extension = Path::new(source)
        .extension()
        .and_then(|extension| extension.to_str())
        .map(str::to_ascii_lowercase)
        .ok_or_else(|| "A pet animation has no supported file extension".to_owned())?;
    let expected = match media_type {
        "image/gif" => "gif",
        "image/png" => "png",
        "image/webp" => "webp",
        _ => return Err("A pet animation declares an unsupported media type".to_owned()),
    };
    if extension != expected {
        return Err("A pet animation extension does not match its media type".to_owned());
    }
    Ok(())
}

fn source_path(source: &str) -> Result<PathBuf, String> {
    validate_text(source, 256, "animation source")?;
    if source.contains(['%', '\\', ':', '?', '#']) || source.starts_with('/') {
        return Err("A pet animation source path is unsafe".to_owned());
    }
    if source
        .split('/')
        .any(|segment| segment.is_empty() || segment == "." || segment == "..")
    {
        return Err("A pet animation source path is unsafe".to_owned());
    }
    let path = Path::new(source);
    let mut depth = 0_usize;
    for component in path.components() {
        let Component::Normal(segment) = component else {
            return Err("A pet animation source must be a normal relative path".to_owned());
        };
        let segment = segment
            .to_str()
            .ok_or_else(|| "A pet animation source is not valid UTF-8".to_owned())?;
        validate_path_segment(segment)?;
        depth += 1;
        if depth > 8 {
            return Err("A pet animation source path is too deep".to_owned());
        }
    }
    if depth == 0 {
        return Err("A pet animation source path is empty".to_owned());
    }
    Ok(path.to_path_buf())
}

fn validate_path_segment(segment: &str) -> Result<(), String> {
    if segment.is_empty() || segment == "." || segment == ".." {
        return Err("A pet animation source path is unsafe".to_owned());
    }
    if segment.ends_with(['.', ' ']) {
        return Err("A pet animation path segment has an unsafe ending".to_owned());
    }
    if segment
        .chars()
        .any(|character| character.is_control() || "<>\"|*".contains(character))
    {
        return Err("A pet animation path segment contains unsafe characters".to_owned());
    }
    let device_name = segment
        .split('.')
        .next()
        .unwrap_or(segment)
        .to_ascii_uppercase();
    let reserved = matches!(
        device_name.as_str(),
        "CON"
            | "PRN"
            | "AUX"
            | "NUL"
            | "COM1"
            | "COM2"
            | "COM3"
            | "COM4"
            | "COM5"
            | "COM6"
            | "COM7"
            | "COM8"
            | "COM9"
            | "LPT1"
            | "LPT2"
            | "LPT3"
            | "LPT4"
            | "LPT5"
            | "LPT6"
            | "LPT7"
            | "LPT8"
            | "LPT9"
    );
    if reserved {
        return Err("A pet animation uses a reserved device name".to_owned());
    }
    Ok(())
}

fn validate_source_components(root: &Path, relative: &Path) -> Result<(), String> {
    let mut current = root.to_path_buf();
    for component in relative.components() {
        let Component::Normal(segment) = component else {
            return Err("A pet animation source path is unsafe".to_owned());
        };
        current.push(segment);
        reject_link_or_reparse(&current)?;
    }
    Ok(())
}

#[derive(Clone, Copy)]
enum PackageFileKind {
    Manifest,
    Asset,
}

fn read_bounded_regular_file(
    path: &Path,
    limit: u64,
    kind: PackageFileKind,
) -> Result<Vec<u8>, String> {
    let mut options = fs::OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_CLOEXEC | libc::O_NOFOLLOW);
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        const FILE_FLAG_OPEN_REPARSE_POINT: u32 = 0x0020_0000;
        options.custom_flags(FILE_FLAG_OPEN_REPARSE_POINT);
    }

    let mut file = options.open(path).map_err(|_| match kind {
        PackageFileKind::Manifest => {
            "Could not safely open the selected pet package manifest".to_owned()
        }
        PackageFileKind::Asset => "Could not safely open a referenced pet animation".to_owned(),
    })?;
    let metadata = file.metadata().map_err(|_| match kind {
        PackageFileKind::Manifest => {
            "Could not inspect the selected pet package manifest".to_owned()
        }
        PackageFileKind::Asset => "Could not inspect a referenced pet animation".to_owned(),
    })?;
    if metadata.file_type().is_symlink() || is_reparse_point(&metadata) || !metadata.is_file() {
        return Err(match kind {
            PackageFileKind::Manifest => {
                "The selected pet package manifest is not a regular file".to_owned()
            }
            PackageFileKind::Asset => "A referenced pet animation is not a regular file".to_owned(),
        });
    }
    if metadata.len() == 0 {
        return Err(match kind {
            PackageFileKind::Manifest => "The selected pet package manifest is empty".to_owned(),
            PackageFileKind::Asset => "A referenced pet animation is empty".to_owned(),
        });
    }
    if metadata.len() > limit {
        return Err(match kind {
            PackageFileKind::Manifest => {
                format!("The pet package manifest exceeds {limit} bytes")
            }
            PackageFileKind::Asset => {
                format!("A pet animation exceeds the {limit} byte limit")
            }
        });
    }

    let capacity = usize::try_from(metadata.len().min(limit)).unwrap_or(0);
    let mut bytes = Vec::with_capacity(capacity);
    (&mut file)
        .take(limit.saturating_add(1))
        .read_to_end(&mut bytes)
        .map_err(|_| match kind {
            PackageFileKind::Manifest => {
                "Could not read the selected pet package manifest".to_owned()
            }
            PackageFileKind::Asset => "Could not read a referenced pet animation".to_owned(),
        })?;
    if bytes.len() as u64 > limit {
        return Err(match kind {
            PackageFileKind::Manifest => {
                "The pet package manifest changed while it was being read".to_owned()
            }
            PackageFileKind::Asset => "A pet animation changed while it was being read".to_owned(),
        });
    }
    let final_metadata = file.metadata().map_err(|_| match kind {
        PackageFileKind::Manifest => {
            "Could not re-check the selected pet package manifest".to_owned()
        }
        PackageFileKind::Asset => "Could not re-check a referenced pet animation".to_owned(),
    })?;
    if final_metadata.len() != bytes.len() as u64
        || final_metadata.file_type().is_symlink()
        || is_reparse_point(&final_metadata)
        || !final_metadata.is_file()
    {
        return Err(match kind {
            PackageFileKind::Manifest => {
                "The pet package manifest changed while it was being read".to_owned()
            }
            PackageFileKind::Asset => "A pet animation changed while it was being read".to_owned(),
        });
    }
    Ok(bytes)
}

fn reject_link_or_reparse(path: &Path) -> Result<(), String> {
    let metadata = fs::symlink_metadata(path)
        .map_err(|_| "A required pet package path does not exist".to_owned())?;
    if metadata.file_type().is_symlink() || is_reparse_point(&metadata) {
        return Err("Pet packages cannot contain symbolic links or reparse points".to_owned());
    }
    Ok(())
}

#[cfg(windows)]
fn is_reparse_point(metadata: &fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;
    const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x0000_0400;
    metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0
}

#[cfg(not(windows))]
fn is_reparse_point(_metadata: &fs::Metadata) -> bool {
    false
}

fn validate_catalog_id(catalog_id: &str) -> Result<(), String> {
    let Some(hash) = catalog_id.strip_prefix(LOCAL_ID_PREFIX) else {
        return Err("Imported pet package id is invalid".to_owned());
    };
    if hash.len() != LOCAL_ID_HEX_LENGTH
        || !hash
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return Err("Imported pet package id is invalid".to_owned());
    }
    Ok(())
}

fn validate_identifier(value: &str, label: &str) -> Result<(), String> {
    validate_text(value, 64, label)?;
    let mut bytes = value.bytes();
    if !bytes
        .next()
        .is_some_and(|byte| byte.is_ascii_alphanumeric())
        || !bytes.all(|byte| byte.is_ascii_alphanumeric() || b"._-".contains(&byte))
    {
        return Err(format!("Pet package {label} contains unsafe characters"));
    }
    Ok(())
}

fn validate_text(value: &str, max_length: usize, label: &str) -> Result<(), String> {
    if value.trim().is_empty() || value.chars().count() > max_length || value.contains('\0') {
        return Err(format!("Pet package {label} is invalid"));
    }
    Ok(())
}

fn installed_package_count(root: &Path) -> usize {
    fs::read_dir(root)
        .into_iter()
        .flatten()
        .filter_map(Result::ok)
        .filter(|entry| {
            entry
                .file_name()
                .to_str()
                .is_some_and(|name| validate_catalog_id(name).is_ok())
        })
        .count()
}

fn lock_package_store() -> Result<std::sync::MutexGuard<'static, ()>, String> {
    PACKAGE_STORE_LOCK
        .lock()
        .map_err(|_| "The local pet package store is unavailable".to_owned())
}

fn create_staging_directory(root: &Path, catalog_id: &str) -> Result<PathBuf, String> {
    for _ in 0..32 {
        let sequence = STAGING_COUNTER.fetch_add(1, Ordering::Relaxed);
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let staging = root.join(format!(
            ".staging-{catalog_id}-{}-{timestamp:x}-{sequence:x}",
            std::process::id()
        ));
        match fs::create_dir(&staging) {
            Ok(()) => return Ok(staging),
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(_) => return Err("Could not create a pet package staging directory".to_owned()),
        }
    }
    Err("Could not allocate a unique pet package staging directory".to_owned())
}

fn cleanup_stale_staging_directories(root: &Path) {
    let Ok(entries) = fs::read_dir(root) else {
        return;
    };
    for entry in entries.flatten() {
        let name = entry.file_name();
        if name.to_string_lossy().starts_with(".staging-") {
            let path = entry.path();
            let is_stale = fs::symlink_metadata(&path)
                .ok()
                .and_then(|metadata| metadata.modified().ok())
                .and_then(|modified| SystemTime::now().duration_since(modified).ok())
                .is_some_and(|age| age >= STALE_STAGING_AGE);
            if is_stale && reject_link_or_reparse(&path).is_ok() {
                let _ = remove_managed_directory(root, &path);
            }
        }
    }
}

fn validate_managed_tree_no_links(path: &Path) -> Result<(), String> {
    let metadata = fs::symlink_metadata(path)
        .map_err(|_| "Could not inspect an imported pet package".to_owned())?;
    if metadata.file_type().is_symlink() || is_reparse_point(&metadata) {
        return Err("Imported pet packages cannot contain links or reparse points".to_owned());
    }
    if metadata.is_dir() {
        for entry in fs::read_dir(path)
            .map_err(|_| "Could not inspect an imported pet package".to_owned())?
        {
            let entry =
                entry.map_err(|_| "Could not inspect an imported pet package".to_owned())?;
            validate_managed_tree_no_links(&entry.path())?;
        }
    } else if !metadata.is_file() {
        return Err("Imported pet packages must contain only regular files".to_owned());
    }
    Ok(())
}

fn read_le_u32(bytes: &[u8]) -> u32 {
    u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]])
}

fn read_le_u24(bytes: &[u8]) -> u32 {
    u32::from(bytes[0]) | (u32::from(bytes[1]) << 8) | (u32::from(bytes[2]) << 16)
}

#[cfg(test)]
mod tests {
    use std::borrow::Cow;

    use super::*;

    fn gif_bytes(frame_count: usize, delay: u16) -> Vec<u8> {
        gif_bytes_with_repeat(frame_count, delay, gif::Repeat::Infinite)
    }

    fn gif_bytes_with_repeat(frame_count: usize, delay: u16, repeat: gif::Repeat) -> Vec<u8> {
        let mut bytes = Vec::new();
        {
            let mut encoder = gif::Encoder::new(&mut bytes, 1, 1, &[0, 0, 0, 255, 255, 255])
                .expect("create GIF encoder");
            encoder.set_repeat(repeat).expect("set GIF repeat");
            for _ in 0..frame_count {
                let frame = gif::Frame {
                    width: 1,
                    height: 1,
                    delay,
                    buffer: Cow::Borrowed(&[0]),
                    ..gif::Frame::default()
                };
                encoder.write_frame(&frame).expect("write GIF frame");
            }
        }
        bytes
    }

    #[test]
    fn enforces_manifest_loop_against_intrinsic_gif_repeat() {
        let infinite = gif_bytes_with_repeat(2, 2, gif::Repeat::Infinite);
        let finite = gif_bytes_with_repeat(2, 2, gif::Repeat::Finite(1));

        assert!(validate_gif(&infinite, true).is_ok());
        assert!(validate_gif(&finite, false).is_ok());
        assert!(validate_gif(&infinite, false)
            .expect_err("infinite GIF declared one-shot")
            .contains("loop=false"));
        assert!(validate_gif(&finite, true)
            .expect_err("finite GIF declared looping")
            .contains("loop=true"));
    }

    fn png_bytes() -> Vec<u8> {
        let mut bytes = Vec::new();
        {
            let mut encoder = png::Encoder::new(&mut bytes, 1, 1);
            encoder.set_color(png::ColorType::Grayscale);
            encoder.set_depth(png::BitDepth::Eight);
            let mut writer = encoder.write_header().expect("write PNG header");
            writer.write_image_data(&[128]).expect("write PNG pixels");
        }
        bytes
    }

    fn webp_bytes() -> Vec<u8> {
        let mut bytes = Vec::new();
        image_webp::WebPEncoder::new(&mut bytes)
            .encode(&[10, 20, 30], 1, 1, image_webp::ColorType::Rgb8)
            .expect("encode WebP");
        bytes
    }

    fn manifest_json(source: &str, media_type: &str) -> String {
        format!(
            r#"{{
              "schemaVersion":1,
              "id":"test-pet",
              "name":"Test Pet",
              "version":"1.0.0",
              "author":"Test",
              "license":"Test-only",
              "canvas":{{"width":1,"height":1,"fit":"contain","anchor":{{"x":0.5,"y":1.0}}}},
              "animations":{{"idle":{{"source":"{source}","mediaType":"{media_type}","loop":true,"alt":"idle"}}}},
              "states":{{"idle":"idle","thinking":"idle","planning":"idle","coding":"idle","testing":"idle","success":"idle","error":"idle"}},
              "fallbackAnimation":"idle"
            }}"#
        )
    }

    fn write_valid_source(root: &Path) -> PathBuf {
        fs::create_dir_all(root.join("animations")).expect("create fixture directory");
        fs::write(root.join("animations/idle.gif"), gif_bytes(1, 2)).expect("write GIF");
        let manifest = root.join(MANIFEST_FILE_NAME);
        fs::write(&manifest, manifest_json("animations/idle.gif", "image/gif"))
            .expect("write manifest");
        manifest
    }

    #[test]
    fn installs_an_independent_content_addressed_snapshot() {
        let source = tempfile::tempdir().expect("source tempdir");
        let storage = tempfile::tempdir().expect("storage tempdir");
        let manifest = write_valid_source(source.path());

        let installed = install_package(&manifest, storage.path()).expect("install package");
        assert!(validate_catalog_id(&installed.catalog_id).is_ok());
        assert_eq!(installed.asset_paths.len(), 1);
        assert!(
            Path::new(&installed.asset_paths["animations/idle.gif"]).starts_with(storage.path())
        );
        fs::remove_dir_all(source.path()).expect("remove source after import");
        let reloaded = load_installed_package(&storage.path().join(&installed.catalog_id))
            .expect("reload copied package");
        assert_eq!(reloaded.catalog_id, installed.catalog_id);
        let installed_manifest = Path::new(&reloaded.manifest_path);
        assert!(installed_manifest.starts_with(storage.path()));
        assert!(!installed_manifest.starts_with(source.path()));
    }

    #[test]
    fn installs_and_reloads_interaction_duration_metadata() {
        let source = tempfile::tempdir().expect("source tempdir");
        let storage = tempfile::tempdir().expect("storage tempdir");
        fs::create_dir_all(source.path().join("animations")).expect("create animations");
        fs::write(source.path().join("animations/idle.gif"), gif_bytes(1, 2)).expect("write GIF");

        let mut package: PetPackageManifest =
            serde_json::from_str(&manifest_json("animations/idle.gif", "image/gif"))
                .expect("parse package");
        package.interactions.insert(
            "clicked".to_owned(),
            PetInteractionAction {
                animation: "idle".to_owned(),
                duration_ms: Some(1_250),
            },
        );
        let manifest_path = source.path().join(MANIFEST_FILE_NAME);
        fs::write(
            &manifest_path,
            serde_json::to_vec(&package).expect("serialize package"),
        )
        .expect("write manifest");

        let installed = install_package(&manifest_path, storage.path()).expect("install package");
        fs::remove_dir_all(source.path()).expect("remove source package");
        let reloaded = load_installed_package(&storage.path().join(&installed.catalog_id))
            .expect("reload snapshot");
        assert_eq!(
            reloaded
                .manifest
                .interactions
                .get("clicked")
                .and_then(|action| action.duration_ms),
            Some(1_250)
        );
    }

    #[test]
    fn installs_and_reloads_reduced_motion_targets_inside_the_managed_snapshot() {
        let source = tempfile::tempdir().expect("source tempdir");
        let storage = tempfile::tempdir().expect("storage tempdir");
        fs::create_dir_all(source.path().join("animations")).expect("create animations");
        fs::write(source.path().join("animations/idle.gif"), gif_bytes(1, 2)).expect("write GIF");
        fs::write(
            source.path().join("animations/idle-static.png"),
            png_bytes(),
        )
        .expect("write PNG");

        let mut package: PetPackageManifest =
            serde_json::from_str(&manifest_json("animations/idle.gif", "image/gif"))
                .expect("parse package");
        package.animations.insert(
            "idle-static".to_owned(),
            PetAnimation {
                source: "animations/idle-static.png".to_owned(),
                media_type: "image/png".to_owned(),
                loops: false,
                alt: "static idle".to_owned(),
            },
        );
        package
            .reduced_motion_animations
            .insert("idle".to_owned(), "idle-static".to_owned());
        let manifest_path = source.path().join(MANIFEST_FILE_NAME);
        fs::write(
            &manifest_path,
            serde_json::to_vec(&package).expect("serialize package"),
        )
        .expect("write manifest");

        let installed = install_package(&manifest_path, storage.path()).expect("install package");
        assert_eq!(installed.asset_paths.len(), 2);
        for source in ["animations/idle.gif", "animations/idle-static.png"] {
            let installed_path = Path::new(&installed.asset_paths[source]);
            assert!(installed_path.starts_with(storage.path()));
            assert!(installed_path.is_file());
        }

        fs::remove_dir_all(source.path()).expect("remove source package");
        let reloaded = load_installed_package(&storage.path().join(&installed.catalog_id))
            .expect("reload snapshot");
        assert_eq!(
            reloaded
                .manifest
                .reduced_motion_animations
                .get("idle")
                .map(String::as_str),
            Some("idle-static")
        );
        assert_eq!(reloaded.asset_paths.len(), 2);
    }

    #[test]
    fn every_bundled_catalog_package_meets_import_safety_limits() {
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct BundledPackageIndex {
            schema_version: u32,
            default_package_id: String,
            packages: Vec<BundledPackageEntry>,
        }

        #[derive(Deserialize)]
        struct BundledPackageEntry {
            id: String,
            manifest: String,
        }

        let pets_root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../public/pets");
        let index: BundledPackageIndex = serde_json::from_slice(
            &fs::read(pets_root.join("index.json")).expect("read bundled package index"),
        )
        .expect("parse bundled package index");
        assert_eq!(index.schema_version, 1);
        assert!(!index.packages.is_empty());
        assert!(index.packages.len() <= 32);

        let mut package_ids = BTreeSet::new();
        for entry in &index.packages {
            validate_identifier(&entry.id, "catalog package id")
                .expect("validate catalog package id");
            assert!(package_ids.insert(entry.id.clone()), "duplicate package id");

            let manifest_path = pets_root
                .join(source_path(&entry.manifest).expect("validate bundled manifest path"));
            let validated = validate_package_source(&manifest_path)
                .unwrap_or_else(|error| panic!("validate bundled package {}: {error}", entry.id));
            assert_eq!(validated.manifest.id, entry.id);
            assert!(!validated.assets.is_empty());
        }

        assert!(package_ids.contains(&index.default_package_id));
    }

    #[test]
    fn rejects_traversal_and_encoded_or_windows_paths() {
        for source in [
            "../idle.gif",
            "animations/%2e%2e/idle.gif",
            "animations\\idle.gif",
            "C:/idle.gif",
            "//server/share/idle.gif",
        ] {
            assert!(source_path(source).is_err(), "source should fail: {source}");
        }
    }

    #[test]
    fn rejects_media_type_mismatch_before_installing() {
        let source = tempfile::tempdir().expect("source tempdir");
        fs::create_dir_all(source.path().join("animations")).expect("create fixture directory");
        fs::write(
            source.path().join("animations/idle.gif"),
            b"not actually a gif",
        )
        .expect("write invalid media");
        let manifest = source.path().join(MANIFEST_FILE_NAME);
        fs::write(&manifest, manifest_json("animations/idle.gif", "image/gif"))
            .expect("write manifest");

        assert!(validate_package_source(&manifest)
            .expect_err("invalid GIF must fail")
            .contains("invalid"));
    }

    #[test]
    fn bounds_gif_frames_frame_rate_and_decoded_pixels() {
        assert!(validate_gif(&gif_bytes(301, 2), true).is_err());
        assert!(validate_gif(&gif_bytes(1, 0), true).is_ok());
        assert!(validate_gif(&gif_bytes(2, 0), true).is_err());
        assert!(validate_gif(&gif_bytes(2, 2), true).is_ok());
    }

    #[test]
    fn fully_decodes_static_png_and_webp_and_rejects_container_smuggling() {
        let png = png_bytes();
        assert_eq!(validate_png(&png).expect("valid PNG"), 1);
        let mut corrupt_png = png.clone();
        let idat = corrupt_png
            .windows(4)
            .position(|window| window == b"IDAT")
            .expect("PNG IDAT chunk");
        corrupt_png[idat + 4] ^= 0xff;
        assert!(validate_png(&corrupt_png).is_err());

        let webp = webp_bytes();
        assert_eq!(validate_webp(&webp).expect("valid WebP"), 1);

        let mut outside_riff = webp.clone();
        outside_riff.extend_from_slice(b"VP8L\x05\x00\x00\x00\x2f\x00\x00\x00\x00\x00");
        assert!(validate_webp(&outside_riff)
            .expect_err("bytes outside RIFF must fail")
            .contains("outside"));

        let mut duplicate_image = outside_riff;
        let riff_size = u32::try_from(duplicate_image.len() - 8).expect("test RIFF size");
        duplicate_image[4..8].copy_from_slice(&riff_size.to_le_bytes());
        assert!(validate_webp(&duplicate_image)
            .expect_err("duplicate dimensions must fail")
            .contains("duplicate"));

        let mut reserved_vp8x = b"RIFF\x00\x00\x00\x00WEBPVP8X\x0a\x00\x00\x00".to_vec();
        reserved_vp8x.extend_from_slice(&[
            0x40, 0, 0, 0, 0, 0, 0, 0, 0, 0, b'V', b'P', b'8', b'L', 5, 0, 0, 0, 0x2f, 0, 0, 0, 0,
            0,
        ]);
        let riff_size = u32::try_from(reserved_vp8x.len() - 8).expect("test RIFF size");
        reserved_vp8x[4..8].copy_from_slice(&riff_size.to_le_bytes());
        assert!(inspect_webp_container(&reserved_vp8x)
            .expect_err("reserved VP8X bits must fail")
            .contains("reserved"));
    }

    #[test]
    fn enforces_one_decoded_pixel_budget_across_the_package() {
        let mut total = 0;
        add_to_decoded_pixel_budget(&mut total, 60_000_000).expect("first asset");
        add_to_decoded_pixel_budget(&mut total, 60_000_000).expect("exact package limit");
        assert!(add_to_decoded_pixel_budget(&mut total, 1).is_err());
    }

    #[test]
    fn bounded_reader_rejects_a_file_larger_than_its_limit() {
        let directory = tempfile::tempdir().expect("file tempdir");
        let path = directory.path().join("asset.gif");
        fs::write(&path, [0_u8; 9]).expect("write oversized fixture");
        assert!(read_bounded_regular_file(&path, 8, PackageFileKind::Asset)
            .expect_err("oversized read must fail")
            .contains("exceeds"));
    }

    #[test]
    fn recent_staging_directories_are_unique_and_not_removed_by_listing() {
        let storage = tempfile::tempdir().expect("storage tempdir");
        let first = create_staging_directory(storage.path(), "local-test").expect("first staging");
        let second =
            create_staging_directory(storage.path(), "local-test").expect("second staging");
        assert_ne!(first, second);
        assert!(list_installed_packages(storage.path())
            .expect("list packages")
            .is_empty());
        assert!(first.exists());
        assert!(second.exists());
    }

    #[test]
    fn concurrent_imports_converge_on_one_content_addressed_snapshot() {
        let source = tempfile::tempdir().expect("source tempdir");
        let storage = tempfile::tempdir().expect("storage tempdir");
        let manifest = write_valid_source(source.path());
        let storage_path = storage.path().to_path_buf();

        let handles = (0..2)
            .map(|_| {
                let manifest = manifest.clone();
                let storage_path = storage_path.clone();
                std::thread::spawn(move || install_package(&manifest, &storage_path))
            })
            .collect::<Vec<_>>();
        let installed = handles
            .into_iter()
            .map(|handle| {
                handle
                    .join()
                    .expect("import thread")
                    .expect("import package")
            })
            .collect::<Vec<_>>();

        assert_eq!(installed[0].catalog_id, installed[1].catalog_id);
        assert_eq!(installed_package_count(&storage_path), 1);
        assert!(!fs::read_dir(&storage_path)
            .expect("read package root")
            .filter_map(Result::ok)
            .any(|entry| entry.file_name().to_string_lossy().starts_with(".staging-")));
    }

    #[test]
    fn canvas_uses_the_same_dimension_limit_as_assets() {
        let mut manifest: PetPackageManifest =
            serde_json::from_str(&manifest_json("animations/idle.gif", "image/gif"))
                .expect("parse manifest fixture");
        manifest.canvas.width = MAX_IMAGE_DIMENSION + 1;
        assert!(validate_manifest(&manifest).is_err());
    }

    #[test]
    fn interaction_actions_are_extensible_but_bounded_and_reference_known_animations() {
        let manifest_json = manifest_json("animations/idle.gif", "image/gif");
        let mut manifest: PetPackageManifest =
            serde_json::from_str(&manifest_json).expect("parse manifest fixture");
        manifest.interactions.insert(
            "dragging".to_owned(),
            PetInteractionAction {
                animation: "idle".to_owned(),
                duration_ms: Some(MIN_INTERACTION_DURATION_MS),
            },
        );
        assert!(validate_manifest(&manifest).is_ok());
        assert_eq!(
            serde_json::to_value(
                manifest
                    .interactions
                    .get("dragging")
                    .expect("dragging action")
            )
            .expect("serialize action")["durationMs"],
            MIN_INTERACTION_DURATION_MS
        );

        let mut maximum_duration = manifest.clone();
        maximum_duration
            .interactions
            .get_mut("dragging")
            .expect("dragging action")
            .duration_ms = Some(MAX_INTERACTION_DURATION_MS);
        assert!(validate_manifest(&maximum_duration).is_ok());

        for invalid_duration in [
            MIN_INTERACTION_DURATION_MS - 1,
            MAX_INTERACTION_DURATION_MS + 1,
        ] {
            let mut invalid = manifest.clone();
            invalid
                .interactions
                .get_mut("dragging")
                .expect("dragging action")
                .duration_ms = Some(invalid_duration);
            assert!(validate_manifest(&invalid).is_err());
        }

        let mut unknown_animation = manifest.clone();
        unknown_animation
            .interactions
            .get_mut("dragging")
            .expect("dragging action")
            .animation = "missing".to_owned();
        assert!(validate_manifest(&unknown_animation).is_err());

        let mut unsafe_id = manifest.clone();
        unsafe_id.interactions.insert(
            "drag/../../outside".to_owned(),
            PetInteractionAction {
                animation: "idle".to_owned(),
                duration_ms: None,
            },
        );
        assert!(validate_manifest(&unsafe_id).is_err());

        let mut too_many = manifest;
        too_many.interactions = (0..=MAX_INTERACTION_ACTIONS)
            .map(|index| {
                (
                    format!("interaction-{index}"),
                    PetInteractionAction {
                        animation: "idle".to_owned(),
                        duration_ms: None,
                    },
                )
            })
            .collect();
        assert!(validate_manifest(&too_many).is_err());
    }

    #[test]
    fn reduced_motion_mappings_require_known_gifs_and_non_looping_static_targets() {
        let manifest_json = manifest_json("animations/idle.gif", "image/gif");
        let mut manifest: PetPackageManifest =
            serde_json::from_str(&manifest_json).expect("parse manifest fixture");
        manifest.animations.insert(
            "idle-static".to_owned(),
            PetAnimation {
                source: "animations/idle-static.png".to_owned(),
                media_type: "image/png".to_owned(),
                loops: false,
                alt: "static idle".to_owned(),
            },
        );
        manifest
            .reduced_motion_animations
            .insert("idle".to_owned(), "idle-static".to_owned());
        assert!(validate_manifest(&manifest).is_ok());

        let mut unknown_source = manifest.clone();
        unknown_source.reduced_motion_animations =
            BTreeMap::from([("missing".to_owned(), "idle-static".to_owned())]);
        assert!(validate_manifest(&unknown_source)
            .expect_err("unknown source must fail")
            .contains("unknown animation"));

        let mut unknown_target = manifest.clone();
        unknown_target.reduced_motion_animations =
            BTreeMap::from([("idle".to_owned(), "missing".to_owned())]);
        assert!(validate_manifest(&unknown_target)
            .expect_err("unknown target must fail")
            .contains("unknown target"));

        let mut animated_target = manifest.clone();
        animated_target.reduced_motion_animations =
            BTreeMap::from([("idle".to_owned(), "idle".to_owned())]);
        assert!(validate_manifest(&animated_target)
            .expect_err("animated target must fail")
            .contains("non-looping PNG or WebP"));

        let mut looping_target = manifest.clone();
        looping_target
            .animations
            .get_mut("idle-static")
            .expect("static target")
            .loops = true;
        assert!(validate_manifest(&looping_target)
            .expect_err("looping target must fail")
            .contains("non-looping PNG or WebP"));
    }

    #[test]
    fn only_accepts_generated_local_catalog_ids() {
        assert!(validate_catalog_id(&format!("local-{}", "a".repeat(24))).is_ok());
        for invalid in [
            "furry-ai-state",
            "local-abc",
            "local-AAAAAAAAAAAAAAAAAAAAAAAA",
            "local-../../outsideoutside",
        ] {
            assert!(validate_catalog_id(invalid).is_err());
        }
    }
}
