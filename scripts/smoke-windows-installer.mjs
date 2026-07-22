#!/usr/bin/env node

import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import {
  constants,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  acquireSmokeDirectoryLock,
  releaseSmokeDirectoryLock,
} from "./smoke-directory-lock.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
const tauriConfig = JSON.parse(readFileSync(path.join(root, "src-tauri", "tauri.conf.json"), "utf8"));
const smokeConfigPath = path.join(root, "scripts", "tauri.smoke.windows.conf.json");
const smokeConfig = JSON.parse(readFileSync(smokeConfigPath, "utf8"));
const nativeCommand = path.join(root, "scripts", "native-command.mjs");
const nativeSmokeScript = path.join(root, "scripts", "smoke-windows-native.mjs");
const skipBuild = process.argv.includes("--skip-build");
const preflightOnly = process.argv.includes("--preflight-only");
const unknownArgs = process.argv
  .slice(2)
  .filter((argument) => argument !== "--skip-build" && argument !== "--preflight-only");
const architecture = process.arch === "x64" ? "x64" : process.arch === "arm64" ? "arm64" : "";
const runId = String(Date.now()) + "-" + String(process.pid);
const cacheRoot = path.resolve(root, ".cache", "windows-installer-smoke");
const desktopInteractionLockDir = path.resolve(root, ".cache", "windows-desktop-interaction.lock");
const lockDir = path.resolve(cacheRoot, ".lock");
const lockOwnerPath = path.join(lockDir, "owner.json");
const runRoot = path.resolve(cacheRoot, runId);
const reportPath = path.join(runRoot, "installer-smoke-report.json");
const releaseRoot = path.resolve(root, "src-tauri", "target", "release");
const nsisRoot = path.join(releaseRoot, "bundle", "nsis");
const mainWindowTitle = "furry-agent-pet";
const manufacturer = "github";
const processTimeoutMs = 180_000;
const installSettleMs = 30_000;
const appStartupMs = 20_000;
const installedNativeSmokeTimeoutMs = 5 * 60_000;
const unbundledTauriMarker = Buffer.from("__TAURI_BUNDLE_TYPE_VAR_UNK", "ascii");
const nsisTauriMarker = Buffer.from("__TAURI_BUNDLE_TYPE_VAR_NSS", "ascii");
const report = {
  generatedAt: new Date().toISOString(),
  runId,
  platform: process.platform,
  architecture: process.arch,
  version: packageJson.version,
  currentSourceBuild: !skipBuild && !preflightOnly,
  preflightOnly,
  runRoot,
  modes: {},
};

let trackedApp;
let ownsSmokeData = false;
let ownsRunLock = false;
let desktopInteractionLock;
let success = false;
let desktopInteractionLockSafeToRelease = true;
let desktopInteractionLockUnsafeReason;

const formalMainBinaryName = String(tauriConfig.mainBinaryName || packageJson.name || "");

const modes = [
  createMode({
    key: "formal",
    productName: String(tauriConfig.productName),
    identifier: String(tauriConfig.identifier),
    mainBinaryName: formalMainBinaryName,
    launch: false,
    extraBuildArgs: [],
  }),
  createMode({
    key: "smoke",
    productName: String(smokeConfig.productName),
    identifier: String(smokeConfig.identifier),
    mainBinaryName: String(smokeConfig.mainBinaryName),
    launch: true,
    extraBuildArgs: ["--config", smokeConfigPath],
  }),
];

const registryQueryScript = [
  "$ErrorActionPreference = 'Stop'",
  "$product = $env:INSTALLER_SMOKE_PRODUCT",
  "$manufacturer = $env:INSTALLER_SMOKE_MANUFACTURER",
  "$rows = @()",
  "$targets = @(",
  "  @{ Name = 'HKCU'; Value = [Microsoft.Win32.RegistryHive]::CurrentUser; View = [Microsoft.Win32.RegistryView]::Registry64 },",
  "  @{ Name = 'HKLM'; Value = [Microsoft.Win32.RegistryHive]::LocalMachine; View = [Microsoft.Win32.RegistryView]::Registry64 },",
  "  @{ Name = 'HKLM'; Value = [Microsoft.Win32.RegistryHive]::LocalMachine; View = [Microsoft.Win32.RegistryView]::Registry32 }",
  ")",
  "foreach ($target in $targets) {",
  "    $base = [Microsoft.Win32.RegistryKey]::OpenBaseKey($target.Value, $target.View)",
  "    try {",
  "      $candidates = @(",
  "        @{ Kind = 'uninstall'; Path = 'Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\' + $product },",
  "        @{ Kind = 'manufacturer'; Path = 'Software\\' + $manufacturer + '\\' + $product }",
  "      )",
  "      foreach ($candidate in $candidates) {",
  "        $key = $base.OpenSubKey($candidate.Path)",
  "        if ($null -eq $key) { continue }",
  "        try {",
  "          $rows += [pscustomobject]@{",
  "            hive = $target.Name",
  "            view = [string]$target.View",
  "            kind = $candidate.Kind",
  "            path = $candidate.Path",
  "            defaultValue = [string]$key.GetValue('')",
  "            displayName = [string]$key.GetValue('DisplayName')",
  "            displayVersion = [string]$key.GetValue('DisplayVersion')",
  "            mainBinaryName = [string]$key.GetValue('MainBinaryName')",
  "            installLocation = [string]$key.GetValue('InstallLocation')",
  "            uninstallString = [string]$key.GetValue('UninstallString')",
  "            publisher = [string]$key.GetValue('Publisher')",
  "            subKeyCount = $key.SubKeyCount",
  "          }",
  "        } finally { $key.Dispose() }",
  "      }",
  "    } finally { $base.Dispose() }",
  "}",
  "[pscustomobject]@{ rows = @($rows) } | ConvertTo-Json -Compress -Depth 5",
].join("\n");

const processByPidScript = [
  "$ErrorActionPreference = 'Stop'",
  "$targetPid = [uint32]::Parse($env:INSTALLER_SMOKE_PID)",
  "$cim = Get-CimInstance Win32_Process -Filter ('ProcessId = ' + $targetPid)",
  "if ($null -eq $cim) { exit 0 }",
  "$runtime = Get-Process -Id $targetPid -ErrorAction Stop",
  "[pscustomobject]@{",
  "  pid = $targetPid",
  "  name = [string]$cim.Name",
  "  executablePath = [string]$cim.ExecutablePath",
  "  commandLine = [string]$cim.CommandLine",
  "  responding = [bool]$runtime.Responding",
  "  mainWindowHandle = [int64]$runtime.MainWindowHandle",
  "  mainWindowTitle = [string]$runtime.MainWindowTitle",
  "} | ConvertTo-Json -Compress",
].join("\n");

const processByNamesScript = [
  "$ErrorActionPreference = 'Stop'",
  "$names = @($env:INSTALLER_SMOKE_NAMES -split '\\|')",
  "$rows = @(Get-CimInstance Win32_Process | Where-Object { $names -contains $_.Name } | ForEach-Object {",
  "  [pscustomobject]@{ pid = [uint32]$_.ProcessId; name = [string]$_.Name; executablePath = [string]$_.ExecutablePath; commandLine = [string]$_.CommandLine }",
  "})",
  "[pscustomobject]@{ rows = @($rows) } | ConvertTo-Json -Compress -Depth 4",
].join("\n");

const processByPathScript = [
  "$ErrorActionPreference = 'Stop'",
  "$target = $env:INSTALLER_SMOKE_EXE",
  "$rows = @(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.Equals($target, [StringComparison]::OrdinalIgnoreCase) } | ForEach-Object {",
  "  [pscustomobject]@{ pid = [uint32]$_.ProcessId; name = [string]$_.Name; executablePath = [string]$_.ExecutablePath; commandLine = [string]$_.CommandLine }",
  "})",
  "[pscustomobject]@{ rows = @($rows) } | ConvertTo-Json -Compress -Depth 4",
].join("\n");

const processByNeedleScript = [
  "$ErrorActionPreference = 'Stop'",
  "$needle = $env:INSTALLER_SMOKE_NEEDLE",
  "$rows = @(Get-CimInstance Win32_Process | Where-Object {",
  "  ($_.ExecutablePath -and $_.ExecutablePath.IndexOf($needle, [StringComparison]::OrdinalIgnoreCase) -ge 0) -or",
  "  ($_.CommandLine -and $_.CommandLine.IndexOf($needle, [StringComparison]::OrdinalIgnoreCase) -ge 0)",
  "} | ForEach-Object {",
  "  [pscustomobject]@{ pid = [uint32]$_.ProcessId; name = [string]$_.Name; executablePath = [string]$_.ExecutablePath; commandLine = [string]$_.CommandLine }",
  "})",
  "[pscustomobject]@{ rows = @($rows) } | ConvertTo-Json -Compress -Depth 4",
].join("\n");

const shellPathsScript = [
  "$ErrorActionPreference = 'Stop'",
  "[pscustomobject]@{",
  "  desktop = [Environment]::GetFolderPath([Environment+SpecialFolder]::DesktopDirectory)",
  "  programs = [Environment]::GetFolderPath([Environment+SpecialFolder]::Programs)",
  "} | ConvertTo-Json -Compress",
].join("\n");

const signatureScript = [
  "$ErrorActionPreference = 'Stop'",
  "$signature = Get-AuthenticodeSignature -LiteralPath $env:INSTALLER_SMOKE_ARTIFACT",
  "[pscustomobject]@{",
  "  status = [string]$signature.Status",
  "  statusMessage = [string]$signature.StatusMessage",
  "  signerSubject = if ($null -eq $signature.SignerCertificate) { '' } else { [string]$signature.SignerCertificate.Subject }",
  "} | ConvertTo-Json -Compress",
].join("\n");

const nonElevatedScript = [
  "$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())",
  "$principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator) | ConvertTo-Json -Compress",
].join("\n");

const windowInspectionScript = [
  "$ErrorActionPreference = 'Stop'",
  "Add-Type -TypeDefinition @'",
  "using System;",
  "using System.Runtime.InteropServices;",
  "public static class InstallerSmokeWindow {",
  "  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }",
  "  [DllImport(\"user32.dll\")] [return: MarshalAs(UnmanagedType.Bool)] public static extern bool IsWindowVisible(IntPtr window);",
  "  [DllImport(\"user32.dll\")] [return: MarshalAs(UnmanagedType.Bool)] public static extern bool IsHungAppWindow(IntPtr window);",
  "  [DllImport(\"user32.dll\")] [return: MarshalAs(UnmanagedType.Bool)] public static extern bool GetWindowRect(IntPtr window, out RECT rect);",
  "  [DllImport(\"user32.dll\", SetLastError = true)] public static extern IntPtr SendMessageTimeout(IntPtr window, uint message, IntPtr wParam, IntPtr lParam, uint flags, uint timeout, out UIntPtr result);",
  "}",
  "'@",
  "$handle = [IntPtr]([int64]::Parse($env:INSTALLER_SMOKE_HANDLE))",
  "$rect = New-Object InstallerSmokeWindow+RECT",
  "$hasRect = [InstallerSmokeWindow]::GetWindowRect($handle, [ref]$rect)",
  "$messageResult = [UIntPtr]::Zero",
  "$ping = [InstallerSmokeWindow]::SendMessageTimeout($handle, 0, [IntPtr]::Zero, [IntPtr]::Zero, 3, 2000, [ref]$messageResult)",
  "[pscustomobject]@{",
  "  visible = [InstallerSmokeWindow]::IsWindowVisible($handle)",
  "  hung = [InstallerSmokeWindow]::IsHungAppWindow($handle)",
  "  hasRect = [bool]$hasRect",
  "  left = $rect.Left",
  "  top = $rect.Top",
  "  right = $rect.Right",
  "  bottom = $rect.Bottom",
  "  pingSucceeded = ($ping -ne [IntPtr]::Zero)",
  "} | ConvertTo-Json -Compress",
].join("\n");

async function main() {
try {
  if (process.platform !== "win32") fail("This installer smoke harness only supports Windows.");
  if (!architecture) fail("Unsupported Windows architecture: " + process.arch);
  if (unknownArgs.length > 0) fail("Unknown arguments: " + unknownArgs.join(" "));
  if (!String(smokeConfig.identifier).endsWith("-smoke")) {
    fail("Refusing non-smoke identifier: " + String(smokeConfig.identifier));
  }
  if (!formalMainBinaryName) fail("Formal mainBinaryName is unavailable.");
  if (String(smokeConfig.mainBinaryName) === formalMainBinaryName) {
    fail("Smoke mainBinaryName must be isolated from the formal binary.");
  }

  desktopInteractionLock = acquireSmokeDirectoryLock({
    lockDir: desktopInteractionLockDir,
    runId,
    scope: "Windows installer smoke",
    metadata: { runRoot },
  });
  report.desktopInteractionLock = {
    path: desktopInteractionLock.lockDir,
    owner: desktopInteractionLock.owner,
    released: false,
  };
  acquireRunLock();
  assertDirectChild(runRoot, cacheRoot, runId, "run root");
  assert(!existsSync(runRoot), "Run root already exists: " + runRoot);
  mkdirSync(runRoot, { recursive: true });

  const elevated = runPowerShellJson(nonElevatedScript);
  assert(elevated === false, "Refusing installer smoke from an elevated process.");
  assertNoUntrackedMainProcesses();

  const shellPaths = runPowerShellJson(shellPathsScript);
  for (const mode of modes) {
    mode.desktopShortcut = path.join(shellPaths.desktop, mode.productName + ".lnk");
    mode.startMenuShortcut = path.join(shellPaths.programs, mode.productName + ".lnk");
    preflightMode(mode);
  }
  assertNoSmokeAppData();
  ownsSmokeData = true;

  if (preflightOnly) {
    success = true;
    report.success = true;
    console.log("PASS Windows installer smoke safety preflight");
    return;
  }

  for (const mode of modes) {
    if (!skipBuild) buildMode(mode);
    else inspectExistingArtifact(mode);
  }

  for (const mode of modes) {
    await exerciseMode(mode);
  }

  assertNoUntrackedMainProcesses();
  const runProcesses = queryProcessesContaining(runRoot);
  assert(runProcesses.length === 0, "Processes still reference run root: " + JSON.stringify(runProcesses));
  cleanupOwnedWorkspaceTrees();
  assertNoSmokeAppData();

  success = true;
  report.success = true;
  const evidenceLabel = skipBuild ? "existing-artifact" : "current-source";
  console.log("PASS " + evidenceLabel + " Windows NSIS lifecycle: formal install/uninstall");
  console.log("PASS " + evidenceLabel + " Windows NSIS lifecycle: isolated install/start/window/uninstall");
  console.log(
    "PASS installed isolated Release: seven states, four-GIF mappings, onboarding, settings, tray, and desktop integration",
  );
  for (const mode of modes) {
    const result = report.modes[mode.key];
    console.log(
      "PASS " + mode.key + " artifact: " + result.installer.bytes + " bytes SHA-256 " +
        result.installer.sha256 + " Authenticode=" + result.installer.authenticode.status,
    );
  }
} catch (error) {
  report.success = false;
  report.error = error instanceof Error ? error.message : String(error);
  console.error("FAIL " + report.error);
  process.exitCode = 1;
} finally {
  try {
    await cleanupAfterFailure();
  } catch (cleanupError) {
    markDesktopInteractionCleanupUnsafe(
      "installer failure cleanup threw: " +
        (cleanupError instanceof Error ? cleanupError.message : String(cleanupError)),
    );
    report.cleanupError = cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
    console.error("WARN failure cleanup aborted: " + report.cleanupError);
  }
  try {
    releaseRunLock();
  } catch (lockError) {
    report.success = false;
    report.lockReleaseError = lockError instanceof Error ? lockError.message : String(lockError);
    console.error("WARN run lock release aborted: " + report.lockReleaseError);
    process.exitCode = 1;
  }
  if (desktopInteractionLockSafeToRelease) {
    try {
      releaseSmokeDirectoryLock(desktopInteractionLock);
      desktopInteractionLock = undefined;
      if (report.desktopInteractionLock) {
        report.desktopInteractionLock.released = true;
        report.desktopInteractionLock.releasedAt = new Date().toISOString();
      }
    } catch (desktopLockError) {
      report.success = false;
      report.desktopInteractionLockReleaseError =
        desktopLockError instanceof Error ? desktopLockError.message : String(desktopLockError);
      console.error(
        "WARN desktop interaction lock release aborted: " + report.desktopInteractionLockReleaseError,
      );
      process.exitCode = 1;
    }
  } else if (desktopInteractionLock) {
    report.success = false;
    report.desktopInteractionLock.preservedReason = desktopInteractionLockUnsafeReason;
    console.error(
      "WARN preserving desktop interaction lock for manual review: " +
        desktopInteractionLockUnsafeReason + " (" + desktopInteractionLock.lockDir + ")",
    );
    process.exitCode = 1;
  }
  report.completedAt = new Date().toISOString();
  report.reportPath = reportPath;
  mkdirSync(runRoot, { recursive: true });
  writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n", "utf8");
  console.log("Report: " + reportPath);
}
}

function createMode(options) {
  const installDir = path.join(runRoot, options.key + "-install");
  const tempDir = path.join(runRoot, options.key + "-temp");
  const profileDir = path.join(runRoot, options.key + "-webview2");
  const installerName =
    options.productName + "_" + String(packageJson.version) + "_" + architecture + "-setup.exe";
  return {
    ...options,
    exeName: options.mainBinaryName + ".exe",
    installerPath: path.join(nsisRoot, installerName),
    installerSnapshotPath: path.join(runRoot, options.key + "-setup.exe"),
    sourceExePath: path.join(releaseRoot, options.mainBinaryName + ".exe"),
    sourceExeSnapshotPath: path.join(runRoot, options.key + "-source.exe"),
    installDir,
    tempDir,
    profileDir,
    installedExePath: path.join(installDir, options.mainBinaryName + ".exe"),
    uninstallerPath: path.join(installDir, "uninstall.exe"),
    defaultInstallDir: path.join(String(process.env.LOCALAPPDATA || ""), options.productName),
    installedVerified: false,
    uninstalled: false,
  };
}

function preflightMode(mode) {
  assertDirectChild(mode.installDir, runRoot, path.basename(mode.installDir), mode.key + " install directory");
  assertDirectChild(mode.tempDir, runRoot, path.basename(mode.tempDir), mode.key + " temp directory");
  assertDirectChild(mode.profileDir, runRoot, path.basename(mode.profileDir), mode.key + " profile directory");
  assertDirectChild(
    mode.installerSnapshotPath,
    runRoot,
    path.basename(mode.installerSnapshotPath),
    mode.key + " installer snapshot",
  );
  assertDirectChild(
    mode.sourceExeSnapshotPath,
    runRoot,
    path.basename(mode.sourceExeSnapshotPath),
    mode.key + " source executable snapshot",
  );
  for (const target of [
    mode.installDir,
    mode.tempDir,
    mode.profileDir,
    mode.installerSnapshotPath,
    mode.sourceExeSnapshotPath,
  ]) {
    assert(!existsSync(target), "Pre-existing test path requires manual review: " + target);
  }
  if (!process.env.LOCALAPPDATA) fail("LOCALAPPDATA is unavailable.");
  assert(
    !existsSync(mode.defaultInstallDir),
    "Default install directory already exists; refusing to touch it: " + mode.defaultInstallDir,
  );
  const registry = queryRegistry(mode);
  assert(registry.length === 0, "Pre-existing registry state requires manual review: " + JSON.stringify(registry));
  for (const shortcut of [mode.desktopShortcut, mode.startMenuShortcut]) {
    assert(!existsSync(shortcut), "Pre-existing shortcut requires manual review: " + shortcut);
  }
}

function buildMode(mode) {
  const startedAt = Date.now();
  const args = [
    nativeCommand,
    "tauri",
    "build",
    "--bundles",
    "nsis",
    "--no-sign",
    "--ci",
    ...mode.extraBuildArgs,
  ];
  console.log("BUILD " + mode.key + ": " + process.execPath + " " + args.join(" "));
  runChecked(process.execPath, args, 20 * 60_000);
  assertFreshRegularFile(mode.installerPath, startedAt, mode.key + " installer");
  assertFreshRegularFile(mode.sourceExePath, startedAt, mode.key + " release executable");
  snapshotExclusive(mode.installerPath, mode.installerSnapshotPath, mode.key + " installer");
  snapshotExclusive(mode.sourceExePath, mode.sourceExeSnapshotPath, mode.key + " release executable");
  mode.sourceExeSha256 = sha256(mode.sourceExeSnapshotPath);
  recordArtifact(mode, args);
}

function inspectExistingArtifact(mode) {
  assertRegularFile(mode.installerPath, mode.key + " installer");
  snapshotExclusive(mode.installerPath, mode.installerSnapshotPath, mode.key + " installer");
  recordArtifact(mode, null);
}

function recordArtifact(mode, buildArgs) {
  const metadata = artifactMetadata(mode.installerSnapshotPath);
  report.modes[mode.key] = {
    productName: mode.productName,
    identifier: mode.identifier,
    mainBinaryName: mode.mainBinaryName,
    installDir: mode.installDir,
    buildCommand: buildArgs ? [process.execPath, ...buildArgs] : null,
    currentSourceBound: !skipBuild,
    sourceExecutable: mode.sourceExeSha256
      ? {
          buildOutputPath: mode.sourceExePath,
          evidencePath: mode.sourceExeSnapshotPath,
          bytes: statSync(mode.sourceExeSnapshotPath).size,
          sha256: mode.sourceExeSha256,
        }
      : null,
    installer: { ...metadata, buildOutputPath: mode.installerPath },
    install: {},
    startup: null,
    nativeSmoke: null,
    uninstall: {},
  };
}

async function exerciseMode(mode) {
  mkdirSync(mode.tempDir, { recursive: false });
  const environment = {
    ...process.env,
    TEMP: mode.tempDir,
    TMP: mode.tempDir,
  };
  const installArgs = ["/S", "/NS", "/D=" + mode.installDir];
  const installResult = await runTrackedExecutable(
    mode.key + " installer",
    mode.installerSnapshotPath,
    installArgs,
    processTimeoutMs,
    environment,
  );
  report.modes[mode.key].install.exitCode = installResult.code;
  report.modes[mode.key].install.pid = installResult.pid;
  report.modes[mode.key].install.arguments = installArgs;

  const installed = await waitFor(
    () => validateInstalledState(mode),
    Boolean,
    installSettleMs,
    mode.key + " installed state",
  );
  mode.installedVerified = true;
  report.modes[mode.key].install.registry = installed.registry;
  report.modes[mode.key].install.installedExecutableSha256 = installed.installedExeSha256;
  report.modes[mode.key].install.executableBinding = installed.executableBinding;
  report.modes[mode.key].install.uninstallerPath = mode.uninstallerPath;
  report.modes[mode.key].install.shortcutsSuppressed = true;

  if (mode.launch) {
    report.modes[mode.key].startup = await launchAndInspectSmoke(mode);
    removeSmokeAppData();
    report.modes[mode.key].nativeSmoke = runInstalledNativeSmoke(mode);
    removeSmokeAppData();
  } else {
    await delay(1_000);
    const unexpected = queryProcessesByPath(mode.installedExePath);
    assert(unexpected.length === 0, "Formal silent install unexpectedly launched the app.");
    report.modes[mode.key].startup = { launchedByInstaller: false };
  }

  const uninstallResult = await runTrackedExecutable(
    mode.key + " uninstaller",
    mode.uninstallerPath,
    ["/S"],
    processTimeoutMs,
    environment,
  );
  report.modes[mode.key].uninstall.exitCode = uninstallResult.code;
  report.modes[mode.key].uninstall.pid = uninstallResult.pid;
  await waitFor(
    () => !existsSync(mode.installDir) && uninstallEntries(mode).length === 0,
    Boolean,
    installSettleMs,
    mode.key + " uninstall removal",
  );
  mode.uninstalled = true;

  const manufacturerCleanup = removeOwnedManufacturerKey(mode);
  report.modes[mode.key].uninstall.manufacturerKeyCleanup = manufacturerCleanup;
  validateNoModeResidue(mode);
  report.modes[mode.key].uninstall.installDirectoryRemoved = true;
  report.modes[mode.key].uninstall.registryRemoved = true;
  report.modes[mode.key].uninstall.noRelatedProcesses = true;

  removeOwnedWorkspaceTree(mode.tempDir);
  if (mode.launch) removeOwnedWorkspaceTree(mode.profileDir);
}

function validateInstalledState(mode) {
  if (!existsSync(mode.installedExePath) || !existsSync(mode.uninstallerPath)) return false;
  assertRegularFile(mode.installedExePath, mode.key + " installed executable");
  assertRegularFile(mode.uninstallerPath, mode.key + " uninstaller");

  const registry = queryRegistry(mode);
  const uninstall = registry.filter((entry) => entry.kind === "uninstall");
  const manufacturerRows = registry.filter((entry) => entry.kind === "manufacturer");
  if (uninstall.length !== 1 || manufacturerRows.length !== 1) return false;
  const entry = uninstall[0];
  const manufacturerEntry = manufacturerRows[0];
  assert(entry.hive === "HKCU", mode.key + " uninstall key was not written to HKCU.");
  assert(manufacturerEntry.hive === "HKCU", mode.key + " manufacturer key was not written to HKCU.");
  assert(entry.displayName === mode.productName, mode.key + " DisplayName mismatch.");
  assert(entry.displayVersion === String(packageJson.version), mode.key + " DisplayVersion mismatch.");
  assert(entry.mainBinaryName === mode.exeName, mode.key + " MainBinaryName mismatch.");
  assert(entry.publisher === manufacturer, mode.key + " Publisher mismatch.");
  assertSamePath(stripOuterQuotes(entry.installLocation), mode.installDir, mode.key + " InstallLocation");
  assertSamePath(stripOuterQuotes(entry.uninstallString), mode.uninstallerPath, mode.key + " UninstallString");
  assertSamePath(manufacturerEntry.defaultValue, mode.installDir, mode.key + " manufacturer install path");

  const installedExeSha256 = sha256(mode.installedExePath);
  let executableBinding = null;
  if (mode.sourceExeSha256) {
    executableBinding = verifyInstalledExecutable(mode);
  }
  assert(!existsSync(mode.desktopShortcut), mode.key + " desktop shortcut exists despite /NS.");
  assert(!existsSync(mode.startMenuShortcut), mode.key + " Start Menu shortcut exists despite /NS.");
  assert(!existsSync(mode.defaultInstallDir), mode.key + " installer ignored the isolated /D path.");
  return { registry, installedExeSha256, executableBinding };
}

function canSafelyUninstall(mode) {
  try {
    if (!existsSync(mode.installedExePath) || !existsSync(mode.uninstallerPath)) return false;
    assertRegularFile(mode.installedExePath, mode.key + " cleanup executable");
    assertRegularFile(mode.uninstallerPath, mode.key + " cleanup uninstaller");
    const registry = queryRegistry(mode);
    const uninstall = registry.filter((entry) => entry.kind === "uninstall");
    const manufacturerRows = registry.filter((entry) => entry.kind === "manufacturer");
    if (uninstall.length !== 1 || manufacturerRows.length !== 1) return false;
    if (uninstall[0].hive !== "HKCU" || manufacturerRows[0].hive !== "HKCU") return false;
    assertSamePath(stripOuterQuotes(uninstall[0].installLocation), mode.installDir, mode.key + " cleanup InstallLocation");
    assertSamePath(stripOuterQuotes(uninstall[0].uninstallString), mode.uninstallerPath, mode.key + " cleanup UninstallString");
    assertSamePath(manufacturerRows[0].defaultValue, mode.installDir, mode.key + " cleanup manufacturer path");
    if (mode.sourceExeSha256) {
      verifyInstalledExecutable(mode);
    }
    return true;
  } catch {
    return false;
  }
}

async function launchAndInspectSmoke(mode) {
  mkdirSync(mode.profileDir, { recursive: false });
  const environment = {
    ...process.env,
    FURRY_COMPANION_IPC_PATH: "\\\\.\\pipe\\furry-companion-installer-" + runId,
    WEBVIEW2_USER_DATA_FOLDER: mode.profileDir,
  };
  const child = spawn(mode.installedExePath, [], {
    cwd: mode.installDir,
    env: environment,
    windowsHide: true,
    stdio: "ignore",
  });
  trackedApp = { child, expectedPath: mode.installedExePath, label: "installed smoke app" };
  const spawnError = new Promise((_, reject) => child.once("error", reject));
  const snapshot = await Promise.race([
    waitFor(
      () => {
        const current = queryProcessByPid(child.pid);
        if (!current) return false;
        if (!samePath(current.executablePath, mode.installedExePath)) {
          fail("Tracked smoke PID executable path changed: " + current.executablePath);
        }
        return current.responding &&
          current.mainWindowHandle > 0 &&
          current.mainWindowTitle === mainWindowTitle
          ? current
          : false;
      },
      Boolean,
      appStartupMs,
      "installed smoke app window",
    ),
    spawnError,
  ]);
  assert(snapshot.mainWindowTitle === mainWindowTitle, "Installed smoke window title mismatch.");

  const window = inspectWindow(snapshot.mainWindowHandle, mode.tempDir);
  assert(window.visible === true, "Installed smoke window is not visible.");
  assert(window.hung === false, "Installed smoke window is hung.");
  assert(window.hasRect === true, "Installed smoke window has no bounds.");
  assert(window.right > window.left && window.bottom > window.top, "Installed smoke window bounds are invalid.");
  assert(window.pingSucceeded === true, "Installed smoke window did not answer WM_NULL.");
  await delay(750);
  const stable = queryProcessByPid(child.pid);
  assert(stable && stable.responding, "Installed smoke app did not remain responsive.");

  const stopped = await stopTrackedProcess(child, mode.installedExePath, "installed smoke app");
  assert(stopped, "Could not confirm installed smoke app exit.");
  trackedApp = undefined;
  await waitFor(
    () => queryProcessesByPath(mode.installedExePath).length === 0,
    Boolean,
    10_000,
    "installed smoke process cleanup",
  );
  await waitFor(
    () => queryProcessesContaining(mode.profileDir).length === 0,
    Boolean,
    10_000,
    "installed smoke WebView2 cleanup",
  );
  return {
    pid: child.pid,
    executablePath: snapshot.executablePath,
    responding: snapshot.responding,
    mainWindowHandle: snapshot.mainWindowHandle,
    mainWindowTitle: snapshot.mainWindowTitle,
    visible: window.visible,
    hung: window.hung,
    bounds: {
      left: window.left,
      top: window.top,
      right: window.right,
      bottom: window.bottom,
    },
    wmNull: window.pingSucceeded,
    termination: "tracked PID and exact executable path",
  };
}

function runInstalledNativeSmoke(mode) {
  assert(mode.key === "smoke", "Full installed native smoke is restricted to the isolated identity.");
  assert(desktopInteractionLock, "Installed native smoke requires the outer desktop interaction lock.");
  assert(
    desktopInteractionLock.owner.pid === process.pid && desktopInteractionLock.owner.runId === runId,
    "Outer desktop interaction lock ownership is inconsistent.",
  );
  const installedSha256 = report.modes[mode.key].install.installedExecutableSha256;
  assert(/^[A-F0-9]{64}$/.test(installedSha256), "Installed smoke executable SHA-256 is unavailable.");

  const args = [nativeSmokeScript, "--skip-build"];
  console.log("SMOKE installed Release: " + process.execPath + " " + args.join(" "));
  markDesktopInteractionCleanupUnsafe("installed native smoke cleanup result has not been verified");
  const result = spawnSync(process.execPath, args, {
    cwd: root,
    env: {
      ...process.env,
      TEMP: mode.tempDir,
      TMP: mode.tempDir,
      NATIVE_SMOKE_EXECUTABLE: mode.installedExePath,
      NATIVE_SMOKE_EXPECTED_EXECUTABLE_SHA256: installedSha256,
      NATIVE_SMOKE_INHERITED_DESKTOP_LOCK_TOKEN: desktopInteractionLock.owner.token,
      NATIVE_SMOKE_INHERITED_DESKTOP_LOCK_RUN_ID: runId,
    },
    encoding: "utf8",
    windowsHide: true,
    timeout: installedNativeSmokeTimeoutMs,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);

  const artifactMatches = [...String(result.stdout || "").matchAll(/^Artifacts:\s+(.+)\r?$/gm)];
  assert(artifactMatches.length === 1, "Installed Release native smoke did not report one artifact directory.");
  const artifactRoot = path.resolve(artifactMatches[0][1].trim());
  const nativeCacheRoot = path.resolve(root, ".cache", "native-windows-smoke");
  assert(
    path.dirname(artifactRoot).toLowerCase() === nativeCacheRoot.toLowerCase() &&
      /^\d+-\d+$/.test(path.basename(artifactRoot)),
    "Installed Release native smoke reported an unsafe artifact directory: " + artifactRoot,
  );
  const artifactStats = lstatSync(artifactRoot);
  assert(
    artifactStats.isDirectory() && !artifactStats.isSymbolicLink(),
    "Installed Release native smoke artifact root is not a normal directory.",
  );

  const evidence = {
    metadata: path.join(artifactRoot, "run-metadata.json"),
    result: path.join(artifactRoot, "run-result.json"),
    state: path.join(artifactRoot, "state-integration.json"),
    onboarding: path.join(artifactRoot, "onboarding-integration.json"),
    desktop: path.join(artifactRoot, "desktop-integration.json"),
    tray: path.join(artifactRoot, "tray-integration.json"),
  };
  for (const [label, evidencePath] of Object.entries(evidence)) {
    assertRegularFile(evidencePath, "installed native smoke " + label + " evidence");
  }
  const nativeResult = JSON.parse(readFileSync(evidence.result, "utf8"));
  assert(nativeResult.runId === path.basename(artifactRoot), "Installed native smoke result run ID mismatch.");
  assert(nativeResult.executionMode === "installed-release", "Installed native smoke result mode mismatch.");
  assert(nativeResult.cleanupSafe === true, "Installed native smoke did not prove descendant cleanup.");
  assert(result.status !== null, "Installed native smoke did not report a process exit status.");
  assert(
    queryProcessesByPath(mode.installedExePath).length === 0,
    "Installed native smoke executable is still running after its cleanup result.",
  );
  assert(
    queryProcessesContaining(artifactRoot).length === 0,
    "A process still references the installed native smoke artifact root.",
  );
  markDesktopInteractionCleanupSafe();

  if (result.error) fail("Installed Release native smoke failed to run: " + result.error.message);
  if (result.status !== 0) {
    fail(
      "Installed Release native smoke exited with " + String(result.status) +
        (result.signal ? " signal=" + result.signal : ""),
    );
  }

  const metadata = JSON.parse(readFileSync(evidence.metadata, "utf8"));
  assert(metadata.executionMode === "installed-release", "Installed native smoke mode mismatch.");
  assert(metadata.buildSkipped === true, "Installed native smoke unexpectedly built a workspace executable.");
  assert(metadata.desktopLockMode === "inherited-installer-lock", "Installed native smoke lock mode mismatch.");
  assertSamePath(metadata.executable?.path, mode.installedExePath, "installed native smoke executable path");
  assert(metadata.executable?.sha256 === installedSha256, "Installed native smoke executable hash mismatch.");

  const state = JSON.parse(readFileSync(evidence.state, "utf8"));
  assert(
    Array.isArray(state.requiredStates) && state.requiredStates.length === 7 &&
      state.requiredStates.every((agentState) => state.observedStates.includes(agentState)),
    "Installed native smoke did not observe all seven states.",
  );
  assert(Array.isArray(state.imageErrors) && state.imageErrors.length === 0, "Installed pet media failed to load.");
  assert(
    state.delayedSleeping?.elapsedMs >= 59_500 &&
      String(state.delayedSleeping?.src ?? "").replaceAll("\\", "/").split(/[?#]/, 1)[0]
        .endsWith("/pets/furry-ai-state/animations/sleeping.gif") &&
      state.delayedSleeping?.imageComplete === true &&
      state.delayedSleeping?.naturalWidth > 0 && state.delayedSleeping?.naturalHeight > 0,
    "Installed pet did not activate a decoded sleeping.gif after the 60-second idle delay.",
  );
  const onboarding = JSON.parse(readFileSync(evidence.onboarding, "utf8"));
  assert(onboarding.actions?.complete?.storeVersion === 1, "Installed onboarding completion was not stored.");
  assert(onboarding.primaryExit?.diskVersion === 1, "Installed onboarding completion was not flushed to disk.");
  assert(onboarding.restart?.panelHidden === true, "Installed onboarding reopened after restart.");
  const tray = JSON.parse(readFileSync(evidence.tray, "utf8"));
  assert(tray.hiddenQuit?.exit?.code === 0, "Installed tray quit was not graceful.");

  return {
    command: [process.execPath, ...args],
    exitCode: result.status,
    artifactRoot,
    executableSha256: installedSha256,
    evidence,
    statesObserved: state.requiredStates,
    onboardingVersion: onboarding.primaryExit.diskVersion,
    sleepingActivatedAfterMs: state.delayedSleeping.elapsedMs,
    trayExitCode: tray.hiddenQuit.exit.code,
  };
}

function markDesktopInteractionCleanupUnsafe(reason) {
  desktopInteractionLockSafeToRelease = false;
  desktopInteractionLockUnsafeReason = String(reason);
  if (report.desktopInteractionLock) {
    report.desktopInteractionLock.cleanupVerified = false;
    report.desktopInteractionLock.cleanupVerification = desktopInteractionLockUnsafeReason;
  }
}

function markDesktopInteractionCleanupSafe() {
  desktopInteractionLockSafeToRelease = true;
  desktopInteractionLockUnsafeReason = undefined;
  if (report.desktopInteractionLock) {
    report.desktopInteractionLock.cleanupVerified = true;
    report.desktopInteractionLock.cleanupVerifiedAt = new Date().toISOString();
    delete report.desktopInteractionLock.cleanupVerification;
  }
}

function validateNoModeResidue(mode) {
  assert(!existsSync(mode.installDir), mode.key + " install directory remains after uninstall.");
  assert(queryRegistry(mode).length === 0, mode.key + " registry state remains after cleanup.");
  assert(queryProcessesByPath(mode.installedExePath).length === 0, mode.key + " process remains after uninstall.");
  assert(!existsSync(mode.desktopShortcut), mode.key + " desktop shortcut remains.");
  assert(!existsSync(mode.startMenuShortcut), mode.key + " Start Menu shortcut remains.");
  assert(!existsSync(mode.defaultInstallDir), mode.key + " default install directory was unexpectedly created.");
  if (mode.launch) assertNoSmokeAppData();
}

function queryRegistry(mode) {
  return runPowerShellRows(registryQueryScript, {
    INSTALLER_SMOKE_PRODUCT: mode.productName,
    INSTALLER_SMOKE_MANUFACTURER: manufacturer,
  });
}

function uninstallEntries(mode) {
  return queryRegistry(mode).filter((entry) => entry.kind === "uninstall");
}

function removeOwnedManufacturerKey(mode) {
  const registry = queryRegistry(mode);
  const uninstall = registry.filter((entry) => entry.kind === "uninstall");
  const manufacturerRows = registry.filter((entry) => entry.kind === "manufacturer");
  assert(uninstall.length === 0, "Refusing manufacturer cleanup while uninstall entry exists.");
  if (manufacturerRows.length === 0) return "already removed by uninstaller";
  assert(manufacturerRows.length === 1, "Refusing ambiguous manufacturer cleanup: " + JSON.stringify(manufacturerRows));
  const row = manufacturerRows[0];
  assert(row.hive === "HKCU", "Refusing manufacturer cleanup outside HKCU.");
  assert(row.subKeyCount === 0, "Refusing manufacturer cleanup with subkeys.");
  assertSamePath(row.defaultValue, mode.installDir, mode.key + " owned manufacturer path");

  const script = [
    "$ErrorActionPreference = 'Stop'",
    "$view = [System.Enum]::Parse([Microsoft.Win32.RegistryView], $env:INSTALLER_SMOKE_VIEW)",
    "$base = [Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::CurrentUser, $view)",
    "try {",
    "  $key = $base.OpenSubKey($env:INSTALLER_SMOKE_REGISTRY_PATH, $true)",
    "  if ($null -eq $key) { throw 'Manufacturer key disappeared before verified cleanup.' }",
    "  try {",
    "    if ($key.SubKeyCount -ne 0) { throw 'Manufacturer key gained subkeys.' }",
    "    $actual = [IO.Path]::GetFullPath(([string]$key.GetValue('')).Trim('\"'))",
    "    $expected = [IO.Path]::GetFullPath($env:INSTALLER_SMOKE_EXPECTED_PATH)",
    "    if (-not $actual.Equals($expected, [StringComparison]::OrdinalIgnoreCase)) { throw 'Manufacturer path changed.' }",
    "  } finally { $key.Dispose() }",
    "  $base.DeleteSubKey($env:INSTALLER_SMOKE_REGISTRY_PATH, $false)",
    "} finally { $base.Dispose() }",
  ].join("\n");
  runPowerShell(script, {
    INSTALLER_SMOKE_VIEW: row.view,
    INSTALLER_SMOKE_REGISTRY_PATH: row.path,
    INSTALLER_SMOKE_EXPECTED_PATH: mode.installDir,
  }, true);
  assert(
    queryRegistry(mode).filter((entry) => entry.kind === "manufacturer").length === 0,
    "Manufacturer key remains after verified cleanup.",
  );
  return "removed harness-owned key after exact path verification";
}

function assertNoUntrackedMainProcesses() {
  const names = modes.map((mode) => mode.exeName);
  const processes = runPowerShellRows(processByNamesScript, {
    INSTALLER_SMOKE_NAMES: names.join("|"),
  });
  assert(
    processes.length === 0,
    "Related app process is already running; refusing installer actions: " + JSON.stringify(processes),
  );
}

function queryProcessByPid(pid) {
  const output = runPowerShell(processByPidScript, { INSTALLER_SMOKE_PID: String(pid) }, true);
  return output ? JSON.parse(output) : null;
}

function queryProcessesByPath(executablePath) {
  return runPowerShellRows(processByPathScript, { INSTALLER_SMOKE_EXE: executablePath });
}

function queryProcessesContaining(needle) {
  return runPowerShellRows(processByNeedleScript, {
    INSTALLER_SMOKE_NEEDLE: path.resolve(needle),
  });
}

function inspectWindow(handle, tempDir) {
  return runPowerShellJson(
    windowInspectionScript,
    {
      INSTALLER_SMOKE_HANDLE: String(handle),
      TEMP: tempDir,
      TMP: tempDir,
    },
  );
}

async function runTrackedExecutable(label, executablePath, args, timeoutMs, environment) {
  assertRegularFile(executablePath, label);
  const child = spawn(executablePath, args, {
    cwd: root,
    env: environment,
    windowsHide: true,
    stdio: "ignore",
  });
  const result = await waitForChildExit(child, timeoutMs, label, executablePath);
  assert(
    result.code === 0,
    label + " failed: code=" + String(result.code) + " signal=" + String(result.signal),
  );
  return { pid: child.pid, code: result.code, signal: result.signal };
}

function waitForChildExit(child, timeoutMs, label, expectedPath) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve({ code: child.exitCode, signal: child.signalCode });
  }
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback(value);
    };
    const onError = (error) => finish(reject, error);
    const onExit = (code, signal) => finish(resolve, { code, signal });
    timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.removeListener("error", onError);
      child.removeListener("exit", onExit);
      void (async () => {
        try {
          await stopTrackedProcess(child, expectedPath, label);
        } catch {
          // Preserve the timeout as the primary failure.
        }
        reject(new Error(label + " did not exit in " + String(timeoutMs) + " ms."));
      })();
    }, timeoutMs);
    child.once("error", onError);
    child.once("exit", onExit);
  });
}

async function stopTrackedProcess(child, expectedPath, label) {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return true;
  const current = queryProcessByPid(child.pid);
  if (!current) return true;
  if (!samePath(current.executablePath, expectedPath)) {
    fail(
      "Refusing to terminate " + label + " PID " + String(child.pid) +
        " because its path changed to " + current.executablePath,
    );
  }
  spawnSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
    windowsHide: true,
    stdio: "ignore",
  });
  try {
    await waitFor(
      () => queryProcessByPid(child.pid) === null,
      Boolean,
      5_000,
      label + " process exit",
    );
    return true;
  } catch {
    console.error("WARN could not confirm " + label + " PID " + String(child.pid) + " exit");
    return false;
  }
}

function artifactMetadata(artifactPath) {
  const stats = statSync(artifactPath);
  return {
    path: artifactPath,
    bytes: stats.size,
    modifiedAt: stats.mtime.toISOString(),
    sha256: sha256(artifactPath),
    authenticode: runPowerShellJson(signatureScript, {
      INSTALLER_SMOKE_ARTIFACT: artifactPath,
    }),
  };
}

function sha256(filePath) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex").toUpperCase();
}

function verifyInstalledExecutable(mode) {
  assertRegularFile(mode.sourceExeSnapshotPath, mode.key + " source executable snapshot");
  assertRegularFile(mode.installedExePath, mode.key + " installed executable");
  const source = readFileSync(mode.sourceExeSnapshotPath);
  const installed = readFileSync(mode.installedExePath);
  assert(source.length === installed.length, mode.key + " installed executable length mismatch.");

  const sourceSha256 = sha256(mode.sourceExeSnapshotPath);
  const installedSha256 = sha256(mode.installedExePath);
  if (sourceSha256 === installedSha256) {
    return { relation: "exact", sourceSha256, installedSha256 };
  }

  const markerOffset = source.indexOf(unbundledTauriMarker);
  assert(markerOffset >= 0, mode.key + " source executable has no unbundled Tauri marker.");
  assert(
    source.indexOf(unbundledTauriMarker, markerOffset + 1) === -1,
    mode.key + " source executable has multiple unbundled Tauri markers.",
  );
  assert(
    installed.indexOf(nsisTauriMarker) === markerOffset &&
      installed.indexOf(nsisTauriMarker, markerOffset + 1) === -1,
    mode.key + " installed executable has no unique NSIS Tauri marker at the expected offset.",
  );
  const expectedInstalled = Buffer.from(source);
  nsisTauriMarker.copy(expectedInstalled, markerOffset);
  assert(
    expectedInstalled.equals(installed),
    mode.key + " installed executable differs beyond the expected Tauri NSIS marker patch.",
  );
  return {
    relation: "tauri-nsis-bundle-marker-patch",
    markerOffset,
    sourceMarker: unbundledTauriMarker.toString("ascii"),
    installedMarker: nsisTauriMarker.toString("ascii"),
    sourceSha256,
    installedSha256,
  };
}

function snapshotExclusive(sourcePath, snapshotPath, label) {
  assertDirectChild(snapshotPath, runRoot, path.basename(snapshotPath), label + " snapshot");
  assert(!existsSync(snapshotPath), label + " snapshot already exists: " + snapshotPath);
  copyFileSync(sourcePath, snapshotPath, constants.COPYFILE_EXCL);
  assertRegularFile(snapshotPath, label + " snapshot");
  assert(sha256(snapshotPath) === sha256(sourcePath), label + " snapshot hash mismatch.");
}

function assertFreshRegularFile(filePath, startedAt, label) {
  assertRegularFile(filePath, label);
  const modifiedAt = statSync(filePath).mtimeMs;
  assert(
    modifiedAt >= startedAt - 5_000,
    label + " was not refreshed by this build: " + filePath,
  );
}

function assertRegularFile(filePath, label) {
  assert(existsSync(filePath), label + " is missing: " + filePath);
  const stats = lstatSync(filePath);
  assert(stats.isFile() && !stats.isSymbolicLink(), label + " is not a normal file: " + filePath);
}

function assertRegularDirectory(directoryPath, label) {
  assert(existsSync(directoryPath), label + " is missing: " + directoryPath);
  const stats = lstatSync(directoryPath);
  assert(stats.isDirectory() && !stats.isSymbolicLink(), label + " is not a normal directory: " + directoryPath);
}

function acquireRunLock() {
  mkdirSync(cacheRoot, { recursive: true });
  assertRegularDirectory(cacheRoot, "installer smoke cache root");
  assertDirectChild(lockDir, cacheRoot, ".lock", "installer smoke lock");
  try {
    mkdirSync(lockDir, { recursive: false });
  } catch (error) {
    if (error && error.code === "EEXIST") {
      let owner = "unreadable owner metadata";
      try {
        assertRegularDirectory(lockDir, "existing installer smoke lock");
        assertRegularFile(lockOwnerPath, "existing installer smoke lock owner");
        owner = readFileSync(lockOwnerPath, "utf8").trim();
      } catch {
        // Never mutate or auto-recover an unknown lock.
      }
      fail("Another installer smoke run holds the lock: " + owner);
    }
    throw error;
  }
  ownsRunLock = true;
  const owner = {
    runId,
    pid: process.pid,
    acquiredAt: new Date().toISOString(),
    runRoot,
  };
  try {
    writeFileSync(lockOwnerPath, JSON.stringify(owner, null, 2) + "\n", { encoding: "utf8", flag: "wx" });
  } catch (error) {
    rmdirSync(lockDir);
    ownsRunLock = false;
    throw error;
  }
  report.lock = { path: lockDir, owner, released: false };
}

function releaseRunLock() {
  if (!ownsRunLock) return;
  assertDirectChild(lockDir, cacheRoot, ".lock", "installer smoke lock");
  assertRegularDirectory(lockDir, "owned installer smoke lock");
  assertRegularFile(lockOwnerPath, "owned installer smoke lock owner");
  const entries = readdirSync(lockDir, { withFileTypes: true });
  assert(
    entries.length === 1 && entries[0].isFile() && entries[0].name === path.basename(lockOwnerPath),
    "Owned installer smoke lock contains unexpected entries.",
  );
  const owner = JSON.parse(readFileSync(lockOwnerPath, "utf8"));
  assert(owner.runId === runId && owner.pid === process.pid, "Installer smoke lock ownership changed.");
  rmSync(lockOwnerPath, { force: false });
  rmdirSync(lockDir);
  ownsRunLock = false;
  if (report.lock) {
    report.lock.released = true;
    report.lock.releasedAt = new Date().toISOString();
  }
}

function assertDirectChild(target, parent, expectedLeaf, label) {
  const resolvedTarget = path.resolve(target);
  const resolvedParent = path.resolve(parent);
  assert(path.dirname(resolvedTarget) === resolvedParent, label + " is not a direct child of " + resolvedParent);
  assert(path.basename(resolvedTarget) === expectedLeaf, label + " leaf mismatch.");
}

function assertDescendant(target, parent, label) {
  const resolvedTarget = path.resolve(target);
  const resolvedParent = path.resolve(parent);
  const relative = path.relative(resolvedParent, resolvedTarget);
  assert(
    relative && relative !== ".." && !relative.startsWith(".." + path.sep) && !path.isAbsolute(relative),
    label + " is outside its allowed parent: " + resolvedTarget,
  );
}

function assertNoSmokeAppData() {
  const existing = smokeAppDataPaths().filter((target) => existsSync(target));
  assert(existing.length === 0, "Smoke AppData requires manual review: " + existing.join(", "));
}

function smokeAppDataPaths() {
  return [process.env.APPDATA, process.env.LOCALAPPDATA]
    .filter(Boolean)
    .map((parent) => path.resolve(parent, String(smokeConfig.identifier)));
}

function removeSmokeAppData() {
  if (!ownsSmokeData) fail("Refusing smoke AppData cleanup without ownership.");
  for (const target of smokeAppDataPaths()) {
    if (!existsSync(target)) continue;
    const parent = path.dirname(target);
    assertDirectChild(target, parent, String(smokeConfig.identifier), "smoke AppData");
    assertRegularTree(target);
    rmSync(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 });
  }
  assertNoSmokeAppData();
}

function assertRegularTree(rootPath) {
  if (process.platform === "win32") {
    const reparse = runPowerShellJson(
      [
        "$ErrorActionPreference = 'Stop'",
        "$root = Get-Item -LiteralPath $env:INSTALLER_SMOKE_TREE -Force",
        "$found = if ($root.Attributes -band [IO.FileAttributes]::ReparsePoint) { $root } else {",
        "  Get-ChildItem -LiteralPath $root.FullName -Force -Recurse |",
        "    Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint } |",
        "    Select-Object -First 1",
        "}",
        "[pscustomobject]@{ found = ($null -ne $found); path = if ($null -eq $found) { '' } else { $found.FullName } } | ConvertTo-Json -Compress",
      ].join("\n"),
      { INSTALLER_SMOKE_TREE: rootPath },
    );
    assert(reparse.found === false, "Refusing cleanup through a Windows reparse point: " + reparse.path);
  }
  const pending = [rootPath];
  let count = 0;
  while (pending.length > 0) {
    const current = pending.pop();
    const stats = lstatSync(current);
    assert(!stats.isSymbolicLink(), "Refusing cleanup through a link/reparse entry: " + current);
    assert(stats.isDirectory() || stats.isFile(), "Refusing cleanup of a special entry: " + current);
    count += 1;
    assert(count <= 200_000, "Refusing cleanup of an unexpectedly large tree: " + rootPath);
    if (stats.isDirectory()) {
      for (const entry of readdirSync(current, { withFileTypes: true })) {
        pending.push(path.join(current, entry.name));
      }
    }
  }
}

function removeOwnedWorkspaceTree(target) {
  if (!existsSync(target)) return;
  assertDescendant(target, runRoot, "workspace cleanup target");
  assertRegularTree(target);
  rmSync(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 });
}

function cleanupOwnedWorkspaceTrees() {
  for (const mode of modes) {
    removeOwnedWorkspaceTree(mode.tempDir);
    removeOwnedWorkspaceTree(mode.profileDir);
  }
}

async function cleanupAfterFailure() {
  if (success) return;
  if (trackedApp) {
    try {
      const stopped = await stopTrackedProcess(trackedApp.child, trackedApp.expectedPath, trackedApp.label);
      if (!stopped) {
        markDesktopInteractionCleanupUnsafe(
          "could not confirm tracked installed application cleanup",
        );
      }
    } catch (error) {
      markDesktopInteractionCleanupUnsafe("tracked installed application cleanup failed: " + String(error));
      console.error("WARN app cleanup failed: " + String(error));
    }
    trackedApp = undefined;
  }

  for (const mode of [...modes].reverse()) {
    if (mode.uninstalled || !existsSync(mode.uninstallerPath)) continue;
    if (!mode.installedVerified && !canSafelyUninstall(mode)) {
      console.error("WARN preserving " + mode.key + " install because ownership could not be proven.");
      continue;
    }
    try {
      await runTrackedExecutable(
        mode.key + " failure cleanup uninstaller",
        mode.uninstallerPath,
        ["/S"],
        processTimeoutMs,
        { ...process.env, TEMP: mode.tempDir, TMP: mode.tempDir },
      );
      await waitFor(
        () => !existsSync(mode.installDir) && uninstallEntries(mode).length === 0,
        Boolean,
        installSettleMs,
        mode.key + " failure cleanup uninstall",
      );
      mode.uninstalled = true;
      removeOwnedManufacturerKey(mode);
    } catch (error) {
      console.error("WARN preserving " + mode.key + " install for review: " + String(error));
    }
  }

  const related = queryProcessesContaining(runRoot);
  if (related.length > 0) {
    markDesktopInteractionCleanupUnsafe(
      "processes still reference the installer smoke run root: " + JSON.stringify(related),
    );
    console.error("WARN preserving run-root data because processes still reference it: " + JSON.stringify(related));
    return;
  }
  if (ownsSmokeData) {
    try {
      removeSmokeAppData();
    } catch (error) {
      console.error("WARN preserving smoke AppData for review: " + String(error));
    }
  }
  try {
    cleanupOwnedWorkspaceTrees();
  } catch (error) {
    console.error("WARN workspace cleanup failed: " + String(error));
  }
}

function runPowerShellJson(script, extraEnvironment = {}) {
  const output = runPowerShell(script, extraEnvironment, false);
  return output ? JSON.parse(output) : [];
}

function runPowerShellRows(script, extraEnvironment = {}) {
  const value = runPowerShellJson(script, extraEnvironment);
  assert(value && Array.isArray(value.rows), "PowerShell row helper returned an invalid envelope.");
  return value.rows;
}

function runPowerShell(script, extraEnvironment = {}, allowEmpty = false) {
  const result = spawnSync(
    "powershell.exe",
    ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
    {
      cwd: root,
      encoding: "utf8",
      windowsHide: true,
      timeout: 30_000,
      maxBuffer: 4 * 1024 * 1024,
      env: { ...process.env, ...extraEnvironment },
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    fail("PowerShell helper failed: " + String(result.stderr || result.stdout).trim());
  }
  const output = String(result.stdout || "").trim();
  if (!allowEmpty && !output) fail("PowerShell helper returned no output.");
  return output;
}

function runChecked(command, args, timeoutMs) {
  const result = spawnSync(command, args, {
    cwd: root,
    env: process.env,
    stdio: "inherit",
    windowsHide: true,
    timeout: timeoutMs,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    fail("Command failed with exit code " + String(result.status) + ": " + command + " " + args.join(" "));
  }
}

async function waitFor(producer, predicate, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const value = await producer();
      if (predicate(value)) return value;
      lastError = undefined;
    } catch (error) {
      lastError = error;
    }
    await delay(250);
  }
  throw new Error(
    "Timed out waiting for " + label + (lastError ? ": " + String(lastError.message || lastError) : ""),
  );
}

function stripOuterQuotes(value) {
  const text = String(value || "").trim();
  return text.startsWith("\"") && text.endsWith("\"") ? text.slice(1, -1) : text;
}

function samePath(left, right) {
  if (!left || !right) return false;
  return path.resolve(stripOuterQuotes(left)).toLowerCase() ===
    path.resolve(stripOuterQuotes(right)).toLowerCase();
}

function assertSamePath(actual, expected, label) {
  assert(samePath(actual, expected), label + " mismatch: " + String(actual) + " != " + expected);
}

function toArray(value) {
  if (value === null || value === undefined || value === "") return [];
  return Array.isArray(value) ? value : [value];
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function fail(message) {
  throw new Error(message);
}

await main();
