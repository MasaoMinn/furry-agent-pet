import { existsSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const [, , requestedCommand, ...requestedArgs] = process.argv;

if (!requestedCommand) {
  console.error("Usage: node scripts/native-command.mjs <cargo|tauri> [...args]");
  process.exit(2);
}

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const environment = createNativeEnvironment();
const { executable, args } = resolveCommand(requestedCommand, requestedArgs);
const result = spawnSync(executable, args, {
  cwd: repositoryRoot,
  env: environment,
  stdio: "inherit",
  windowsHide: true,
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);

function resolveCommand(command, args) {
  if (command === "tauri") {
    return {
      executable: process.execPath,
      args: [
        path.join(repositoryRoot, "node_modules", "@tauri-apps", "cli", "tauri.js"),
        ...args,
      ],
    };
  }

  if (command === "cargo" && process.platform === "win32") {
    const cargoPath = path.join(
      process.env.USERPROFILE ?? "",
      ".cargo",
      "bin",
      "cargo.exe",
    );

    if (existsSync(cargoPath)) {
      return { executable: cargoPath, args };
    }
  }

  return { executable: command, args };
}

function createNativeEnvironment() {
  const environment = { ...process.env };

  if (process.platform !== "win32") {
    return environment;
  }

  const cargoBin = path.join(
    process.env.USERPROFILE ?? "",
    ".cargo",
    "bin",
  );
  const visualStudioEnvironment = loadVisualStudioEnvironment();
  const nativeEnvironment = { ...environment, ...visualStudioEnvironment };
  nativeEnvironment.Path = [
    cargoBin,
    nativeEnvironment.Path ?? nativeEnvironment.PATH ?? "",
  ]
    .filter(Boolean)
    .join(";");
  nativeEnvironment.PATH = nativeEnvironment.Path;

  addProjectLocalWindowsSdk(nativeEnvironment);

  return nativeEnvironment;
}

function addProjectLocalWindowsSdk(environment) {
  const sysroot = path.join(repositoryRoot, ".cache", "xwin", "xwin");
  const toolsBin = path.join(
    repositoryRoot,
    ".tooling",
    "winsdk-tools",
    "Windows Kits",
    "10",
    "bin",
    "10.0.22621.0",
    "x64",
  );
  const kernelLibrary = path.join(
    sysroot,
    "sdk",
    "lib",
    "um",
    "x86_64",
    "kernel32.Lib",
  );

  if (!existsSync(kernelLibrary)) {
    return;
  }

  const includePaths = [
    path.join(sysroot, "crt", "include"),
    path.join(sysroot, "sdk", "include", "ucrt"),
    path.join(sysroot, "sdk", "include", "um"),
    path.join(sysroot, "sdk", "include", "shared"),
    path.join(sysroot, "sdk", "include", "winrt"),
  ];
  const libraryPaths = [
    path.join(sysroot, "crt", "lib", "x86_64"),
    path.join(sysroot, "sdk", "lib", "ucrt", "x86_64"),
    path.join(sysroot, "sdk", "lib", "um", "x86_64"),
  ];

  environment.INCLUDE = [...includePaths, environment.INCLUDE ?? ""]
    .filter(Boolean)
    .join(";");
  environment.LIB = [...libraryPaths, environment.LIB ?? ""]
    .filter(Boolean)
    .join(";");
  environment.UniversalCRTSdkDir = `${path.join(sysroot, "sdk")}\\`;
  environment.UCRTVersion = "10.0.26100";
  environment.WindowsSdkDir = `${path.join(sysroot, "sdk")}\\`;
  environment.WindowsSDKVersion = "10.0.26100\\";

  const resourceCompiler = path.join(toolsBin, "rc.exe");
  if (existsSync(resourceCompiler)) {
    environment.Path = `${toolsBin};${environment.Path ?? environment.PATH ?? ""}`;
    environment.PATH = environment.Path;
    environment.RC = resourceCompiler;
  }
}

function loadVisualStudioEnvironment() {
  const programFilesX86 =
    process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)";
  const vswhere = path.join(
    programFilesX86,
    "Microsoft Visual Studio",
    "Installer",
    "vswhere.exe",
  );

  if (!existsSync(vswhere)) {
    throw new Error(
      "Visual Studio Installer was not found. Install Visual Studio C++ Build Tools for Tauri.",
    );
  }

  const discovery = spawnSync(
    vswhere,
    [
      "-latest",
      "-products",
      "*",
      "-requires",
      "Microsoft.VisualStudio.Component.VC.Tools.x86.x64",
      "-property",
      "installationPath",
    ],
    { encoding: "utf8", windowsHide: true },
  );
  const installationPath = discovery.stdout?.trim();

  if (discovery.status !== 0 || !installationPath) {
    throw new Error(
      "Visual Studio C++ Build Tools were not found. Add the Desktop development with C++ workload.",
    );
  }

  const vsDevCmd = path.join(
    installationPath,
    "Common7",
    "Tools",
    "VsDevCmd.bat",
  );

  if (!existsSync(vsDevCmd)) {
    throw new Error(`Visual Studio environment script was not found: ${vsDevCmd}`);
  }

  const commandProcessor = process.env.ComSpec ?? "cmd.exe";
  const environmentResult = spawnSync(
    commandProcessor,
    [
      "/d",
      "/c",
      `call "${vsDevCmd}" -no_logo -arch=x64 -host_arch=x64 >nul && set`,
    ],
    {
      encoding: "utf8",
      windowsHide: true,
      windowsVerbatimArguments: true,
    },
  );

  if (environmentResult.status !== 0) {
    const detail = environmentResult.stderr?.trim();
    throw new Error(
      `Visual Studio developer environment could not be loaded.${detail ? ` ${detail}` : ""}`,
    );
  }

  const values = {};
  for (const line of environmentResult.stdout.split(/\r?\n/u)) {
    const separator = line.indexOf("=");
    if (separator <= 0) {
      continue;
    }

    values[line.slice(0, separator)] = line.slice(separator + 1);
  }

  return values;
}
