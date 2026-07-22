#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  createWriteStream,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import net from "node:net";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import {
  acquireSmokeDirectoryLock,
  releaseSmokeDirectoryLock,
  verifySmokeDirectoryLock,
} from "./smoke-directory-lock.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const configPath = path.join(root, "scripts", "tauri.smoke.windows.conf.json");
const nativeProbePath = path.join(root, "scripts", "windows-native-probe.ps1");
const trayProbePath = path.join(root, "scripts", "windows-tray-probe.ps1");
const config = JSON.parse(readFileSync(configPath, "utf8"));
const identifier = String(config.identifier ?? "");
const expectedSuccess = "桌宠的状态演示已经完成，现在可以查看任务结束气泡了。";
const requiredStates = ["idle", "thinking", "planning", "coding", "testing", "error", "success"];
const metricBindingName = "__nativeSmokeReport";
const latencyMarkerPrefix = "__native_latency__:";
const burstMarkerPrefix = "__native_burst__:";
const latencyWarmupCycles = 1;
const latencyMeasuredCycles = 20;
const latencyTargetMs = 200;
const burstEventCount = 1_001;
const burstMutationLimit = 4;
const sleepingDelayMs = 60_000;
const sleepingActivationMinimumMs = 59_500;
const sleepingActivationTimeoutMs = 67_000;
const mainWindowTitle = "furry-agent-pet";
const trayTooltipPrefix = "furry-agent-pet — 连接状态：";
const connectedTrayTooltip = `${trayTooltipPrefix}已连接`;
const expectedTrayMenuItems = [
  "连接状态：已连接",
  "显示/隐藏桌宠",
  "恢复默认位置",
  "总在最前",
  "设置",
  "重新连接",
  "退出",
];
const transparentProbeColors = [
  { r: 21, g: 166, b: 227 },
  { r: 239, g: 72, b: 92 },
];
const opaqueProbeColor = { r: 246, g: 196, b: 46 };
const unknownArgs = process.argv.slice(2).filter((argument) => argument !== "--skip-build");
const externalExecutable = String(process.env.NATIVE_SMOKE_EXECUTABLE ?? "").trim();
const expectedExecutableSha256 = String(
  process.env.NATIVE_SMOKE_EXPECTED_EXECUTABLE_SHA256 ?? "",
).trim().toUpperCase();
const inheritedDesktopLockToken = String(
  process.env.NATIVE_SMOKE_INHERITED_DESKTOP_LOCK_TOKEN ?? "",
).trim();
const inheritedDesktopLockRunId = String(
  process.env.NATIVE_SMOKE_INHERITED_DESKTOP_LOCK_RUN_ID ?? "",
).trim();
const usesInstalledExecutable = externalExecutable.length > 0;
const skipBuild = usesInstalledExecutable || process.argv.includes("--skip-build");
const runId = `${Date.now()}-${process.pid}`;
const artifactRoot = path.join(root, ".cache", "native-windows-smoke", runId);
const desktopInteractionLockDir = path.join(root, ".cache", "windows-desktop-interaction.lock");
const workspaceDebugExePath = path.join(
  root,
  "src-tauri",
  "target",
  "debug",
  "furry-agent-pet-smoke.exe",
);
const exePath = usesInstalledExecutable ? path.resolve(externalExecutable) : workspaceDebugExePath;
const pipeAddress = String.raw`\\.\pipe\furry-companion-smoke-${runId}`;
const trackedApplications = [];
const trackedProcessIdentities = new WeakMap();
const exitedBeforeIdentityCapture = new WeakSet();
const unidentifiedProcesses = [];
const workspaceProfiles = new Set();
let app;
let mock;
let cdp;
let controlledServer;
let observations;
let backdrop;
let desktopIntegration;
let trayIntegration;
let onboardingIntegration;
let stateIntegration;
let ownsSmokeData = false;
let desktopInteractionLock;
let inheritedDesktopInteractionLock = false;
let runSucceeded = false;
let mainFailure;

async function main() {
if (process.platform !== "win32") fail("This smoke harness only supports Windows.");
if (!identifier.endsWith("-smoke")) fail(`Refusing non-smoke identifier: ${identifier}`);
if (unknownArgs.length > 0) fail(`Unknown arguments: ${unknownArgs.join(" ")}`);
const inheritedLockConfigured = inheritedDesktopLockToken.length > 0 || inheritedDesktopLockRunId.length > 0;
if (usesInstalledExecutable) {
  if (!/^[A-F0-9]{64}$/.test(expectedExecutableSha256)) {
    fail("Installed Release smoke requires an exact expected executable SHA-256.");
  }
  if (!inheritedDesktopLockToken || !inheritedDesktopLockRunId) {
    fail("Installed Release smoke requires an inherited installer desktop lock.");
  }
} else if (expectedExecutableSha256 || inheritedLockConfigured) {
  fail("External executable metadata and inherited locks are only valid for installed Release smoke.");
}

try {
  if (usesInstalledExecutable) {
    desktopInteractionLock = verifySmokeDirectoryLock({
      lockDir: desktopInteractionLockDir,
      scope: "Windows installer smoke",
      runId: inheritedDesktopLockRunId,
      pid: process.ppid,
      token: inheritedDesktopLockToken,
    });
    inheritedDesktopInteractionLock = true;
    assertInstalledExecutablePath(desktopInteractionLock.owner);
  } else {
    desktopInteractionLock = acquireSmokeDirectoryLock({
      lockDir: desktopInteractionLockDir,
      runId,
      scope: "Windows native smoke",
      metadata: { artifactRoot },
    });
  }
  mkdirSync(artifactRoot, { recursive: true });
  if (!skipBuild) {
    runChecked(process.execPath, [
      path.join(root, "scripts", "native-command.mjs"), "tauri", "build", "--debug",
      "--no-bundle", "--config", configPath,
    ]);
  }
  if (!existsSync(exePath)) fail(`Smoke executable is missing: ${exePath}`);
  const executable = inspectSmokeExecutable();
  writeFileSync(
    path.join(artifactRoot, "run-metadata.json"),
    `${JSON.stringify({
      schemaVersion: 1,
      runId,
      generatedAt: new Date().toISOString(),
      executionMode: usesInstalledExecutable ? "installed-release" : "workspace-debug",
      buildSkipped: skipBuild,
      identifier,
      executable,
      desktopLockMode: inheritedDesktopInteractionLock ? "inherited-installer-lock" : "owned-native-lock",
    }, null, 2)}\n`,
    "utf8",
  );
  assertNoExistingSmokeExe();
  assertNoExistingSmokeAppData();
  ownsSmokeData = true;

  const port = await reservePort();
  mock = launch("mock", process.execPath, [
    path.join(root, "scripts", "mock-agent-ipc.mjs"), "--address", pipeAddress,
    "--protocol-test", "--demo", "--client-delay", "3000",
  ]);
  await waitFor(() => mock.output.includes(`READY ${pipeAddress}`), 5000, "mock READY");

  app = launchTrackedApplication(
    "app-primary",
    applicationEnvironment(port, "webview2-primary"),
  );
  const target = await waitForCdpTarget(port, 15000);
  cdp = new CdpClient(target.webSocketDebuggerUrl);
  await cdp.connect();
  await waitForCdp(
    () => cdp.evaluate("Boolean(document.querySelector('#app'))"),
    Boolean,
    5000,
    "application DOM",
  );
  await cdp.evaluate(`(() => {
    const app = document.querySelector('#app');
    const image = document.querySelector('#pet-image');
    window.__nativeSmokeStates = [app?.dataset.state ?? 'missing'];
    window.__nativeSmokeAnimations = [{
      state: app?.dataset.state ?? 'missing',
      src: image?.getAttribute('src') ?? '',
      alt: image?.getAttribute('alt') ?? '',
    }];
    window.__nativeSmokeImageErrors = [];
    image?.addEventListener('error', () => window.__nativeSmokeImageErrors.push({
      state: app?.dataset.state ?? 'missing',
      src: image?.getAttribute('src') ?? '',
    }));
    new MutationObserver(() => {
      window.__nativeSmokeStates.push(app.dataset.state);
      window.__nativeSmokeAnimations.push({
        state: app.dataset.state,
        src: image?.getAttribute('src') ?? '',
        alt: image?.getAttribute('alt') ?? '',
      });
    })
      .observe(app, { attributes: true, attributeFilter: ['data-state'] });
    return true;
  })()`);
  await waitForCdp(
    () => cdp.evaluate("document.querySelector('#app').dataset.connection"),
    (value) => value === "connected",
    5000,
    "runtime connection",
  );
  onboardingIntegration = await verifyOnboardingIntegration(mock);
  writeOnboardingArtifact();
  await cdp.evaluate(`(() => {
    const scale = document.querySelector('#scale-input');
    scale.value = '125';
    scale.dispatchEvent(new Event('input', { bubbles: true }));
    const opacity = document.querySelector('#opacity-input');
    opacity.value = '80';
    opacity.dispatchEvent(new Event('input', { bubbles: true }));
    const duration = document.querySelector('#duration-input');
    duration.value = '3';
    duration.dispatchEvent(new Event('input', { bubbles: true }));
    const file = document.querySelector('#file-input');
    file.checked = true;
    file.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);

  await waitForCdp(() => stateSnapshot(), (value) => value.state === "error", 15000, "error state");
  const error = await stateSnapshot();
  assert(!error.bubbleHidden && error.role === "alert", "error bubble must be visible with role=alert");
  assert(error.closeLabel.includes("确认错误"), "error close button must be an explicit confirmation");
  await cdp.evaluate("document.querySelector('#bubble-close').click()");
  await waitForCdp(() => stateSnapshot(), (value) => value.state === "idle", 600, "error acknowledgement -> idle");

  const success = await waitForCdp(
    () => stateSnapshot(),
    (value) => value.state === "success" && value.message === expectedSuccess && !value.bubbleHidden,
    5000,
    "final success bubble",
  );
  const states = success.states;
  for (const state of requiredStates) assert(states.includes(state), `CDP did not observe state: ${state}`);
  assertBundledAnimationObservations(success.animations, success.imageErrors);
  stateIntegration = {
    schemaVersion: 1,
    runId,
    generatedAt: new Date().toISOString(),
    requiredStates,
    observedStates: states,
    animationObservations: success.animations,
    imageErrors: success.imageErrors,
    finalSuccessMessage: success.message,
  };
  writeStateIntegrationArtifact();

  await cdp.evaluate(`(() => {
    const bubble = document.querySelector('#state-bubble');
    bubble?.dispatchEvent(new PointerEvent('pointerleave', { pointerType: 'mouse' }));
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    document.getSelection()?.removeAllRanges();
    return true;
  })()`);
  await waitForCdp(() => stateSnapshot(), (value) => value.bubbleHidden, 4500, "success bubble auto-hide");
  await cdp.evaluate(`document.querySelector('#pet-drag-handle').dispatchEvent(
    new PointerEvent('pointerenter', { pointerType: 'mouse' })
  )`);
  await waitForCdp(
    () => stateSnapshot(),
    (value) => !value.bubbleHidden && value.message === expectedSuccess,
    1000,
    "pointerenter detail replay",
  );

  desktopIntegration = await verifyWindowsDesktopIntegration(app.child);
  await cdp.evaluate(`(() => {
    const alwaysOnTop = document.querySelector('#always-on-top-input');
    alwaysOnTop.checked = false;
    alwaysOnTop.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  const topmostDisabled = await waitFor(
    () => {
      assertChildRunning(backdrop.child, "native compositor backdrop exited before the Z-order check");
      const snapshot = queryTrackedWindow(app.child, { otherHandle: backdrop.handle });
      return snapshot.count === 1 && snapshot.topmost === false &&
        snapshot.targetAboveOther === false && snapshot.zOrderComparison === 1
        ? snapshot
        : false;
    },
    5_000,
    "always-on-top disabled native Z-order",
    100,
  );
  desktopIntegration.topmostDisabled = topmostDisabled;
  assert(await stopByTrackedPid(backdrop.child, "native compositor backdrop"), "backdrop did not exit");
  backdrop = undefined;
  writeFileSync(
    path.join(artifactRoot, "desktop-integration.json"),
    `${JSON.stringify(desktopIntegration, null, 2)}\n`,
    "utf8",
  );

  trayIntegration = await verifyWindowsTrayIntegration(app.child, mock);
  writeFileSync(
    path.join(artifactRoot, "tray-integration.json"),
    `${JSON.stringify(trayIntegration, null, 2)}\n`,
    "utf8",
  );

  observations = await installNativeMetricsObserver();
  assert(await stopByTrackedPid(mock.child, "mock"), "mock process did not exit before controlled IPC phase");
  mock = undefined;
  controlledServer = await startControlledIpcServer(pipeAddress);
  const controlledSocket = await controlledServer.waitForClient(10_000);
  const latency = await runNativeLatencyPhase(controlledSocket, observations);
  const burst = await runNativeBurstPhase(controlledSocket, observations);
  stateIntegration.delayedSleeping = await runDelayedSleepingPhase(controlledSocket);
  stateIntegration.imageErrors = (await stateSnapshot()).imageErrors;
  assert(
    stateIntegration.imageErrors.length === 0,
    "bundled pet image emitted an error during the delayed sleeping phase",
  );
  writeStateIntegrationArtifact();

  writeFileSync(
    path.join(artifactRoot, "desktop-integration.json"),
    `${JSON.stringify(desktopIntegration, null, 2)}\n`,
    "utf8",
  );

  observations.close();
  observations = undefined;
  await controlledServer.close();
  controlledServer = undefined;

  const primaryApp = app;
  await waitForTrackedWindowVisibility(primaryApp.child, true, "primary app window before WM_CLOSE");
  postTrackedWindowClose(primaryApp.child);
  await waitForTrackedWindowVisibility(primaryApp.child, false, "primary app hidden after WM_CLOSE");
  assertChildRunning(primaryApp.child, "primary app exited instead of hiding after WM_CLOSE");

  trayIntegration.hiddenQuit = {
    probe: runTrayAction(primaryApp.child, "menu-click", { menuItem: "退出" }),
  };
  const primaryExit = await waitForChildExit(primaryApp.child, 7000);
  assert(
    primaryExit.code === 0,
    `hidden primary app exit was not graceful: code=${primaryExit.code} signal=${primaryExit.signal}`,
  );
  await assertWindowStateVisibility(false, "hidden primary app exit");
  assertPersistedApplicationSettings();
  onboardingIntegration.primaryExit = {
    diskVersion: readPersistedApplicationSettings()?.onboardingVersion,
  };
  writeOnboardingArtifact();
  trayIntegration.hiddenQuit.exit = primaryExit;
  writeFileSync(
    path.join(artifactRoot, "tray-integration.json"),
    `${JSON.stringify(trayIntegration, null, 2)}\n`,
    "utf8",
  );
  cdp.close();
  cdp = undefined;

  const restartPort = await reservePort();
  app = launchTrackedApplication(
    "app-hidden-restart",
    applicationEnvironment(restartPort, "webview2-hidden-restart"),
  );
  cdp = await connectToApplicationCdp(restartPort);
  await waitForCdp(
    () => cdp.evaluate("Boolean(document.querySelector('#app'))"),
    Boolean,
    5000,
    "hidden restart application DOM",
  );
  const restoredSettings = await waitForCdp(
    () => cdp.evaluate(`(() => ({
      scale: document.querySelector('#scale-input')?.value,
      opacity: document.querySelector('#opacity-input')?.value,
      duration: document.querySelector('#duration-input')?.value,
      showFilePath: document.querySelector('#file-input')?.checked,
      alwaysOnTop: document.querySelector('#always-on-top-input')?.checked,
      effectiveReducedMotion: document.documentElement.dataset.reducedMotion === 'true',
      petSource: document.querySelector('#pet-image')?.src,
      onboardingHidden: document.querySelector('#onboarding-panel')?.hidden,
    }))()`),
    (settings) => (
      settings.scale === "125"
      && settings.opacity === "80"
      && settings.duration === "3"
      && settings.showFilePath === true
      && settings.alwaysOnTop === false
      && settings.effectiveReducedMotion === false
      && settings.petSource?.toLowerCase().includes('.gif')
      && settings.onboardingHidden === true
    ),
    5000,
    "Rust Store settings restoration",
  );
  assert(restoredSettings.scale === "125", "Rust Store did not restore scale=125");
  assert(restoredSettings.opacity === "80", "Rust Store did not restore opacity=80");
  assert(restoredSettings.duration === "3", "Rust Store did not restore duration=3");
  assert(restoredSettings.showFilePath === true, "Rust Store did not restore showFilePath=true");
  assert(restoredSettings.alwaysOnTop === false, "Rust Store did not restore alwaysOnTop=false");
  assert(restoredSettings.effectiveReducedMotion === false, "reduced motion unexpectedly persisted as a manual preference");
  assert(restoredSettings.petSource.toLowerCase().includes(".gif"), "restart did not restore animated pet media");
  assert(restoredSettings.onboardingHidden === true, "completed onboarding reopened after restart");
  writeFileSync(
    path.join(artifactRoot, "desktop-integration.json"),
    `${JSON.stringify(desktopIntegration, null, 2)}\n`,
    "utf8",
  );
  onboardingIntegration.restart = {
    panelHidden: restoredSettings.onboardingHidden,
    storeVersion: await waitForOnboardingStoreVersion(2, "restart onboarding version"),
  };
  writeOnboardingArtifact();
  await waitForTrackedWindowVisibility(app.child, false, "persisted hidden restart window");
  const hiddenRestartNative = queryTrackedWindow(app.child);
  assert(hiddenRestartNative.topmost === false, "hidden restart native window restored topmost unexpectedly");
  await delay(500);
  const stableHiddenWindow = queryTrackedWindow(app.child);
  assert(
    stableHiddenWindow.count === 1 && stableHiddenWindow.visible === false,
    "persisted hidden restart window became visible without a user action",
  );
  assertChildRunning(app.child, "persisted hidden restart app exited unexpectedly");

  const secondInstancePort = await reservePort();
  const secondInstance = launchTrackedApplication(
    "app-second-instance",
    applicationEnvironment(secondInstancePort, "webview2-second-instance"),
    { allowEarlyExit: true },
  );
  const secondInstanceExit = await waitForChildExit(secondInstance.child, 7000);
  assert(
    secondInstanceExit.code === 0,
    `second instance did not exit cleanly: code=${secondInstanceExit.code} signal=${secondInstanceExit.signal}`,
  );
  await waitForTrackedWindowVisibility(app.child, true, "second instance wake-up");
  assertChildRunning(app.child, "original instance exited during second instance wake-up");

  await quitThroughCdp(cdp);
  const finalExit = await waitForChildExit(app.child, 7000);
  assert(
    finalExit.code === 0,
    `visible restarted app exit was not graceful: code=${finalExit.code} signal=${finalExit.signal}`,
  );
  await assertWindowStateVisibility(true, "visible restarted app exit");
  cdp.close();
  cdp = undefined;

  assertTrackedApplicationsExited();
  await cleanWorkspaceProfilesSettled();
  await cleanSmokeAppDataSettled();
  ownsSmokeData = false;
  runSucceeded = true;
  console.log(`PASS Windows native smoke: ${requiredStates.join(" -> ")}`);
  console.log("PASS error acknowledgement, success bubble, pointerenter replay, and graceful quit");
  console.log(
    `PASS native state latency: n=${latency.count} p50=${formatMilliseconds(latency.p50)} ` +
      `p95=${formatMilliseconds(latency.p95)} max=${formatMilliseconds(latency.max)}`,
  );
  console.log(
    `PASS native non-terminal burst: ${burstEventCount} events -> ` +
      `${burst.mutations} DOM marker mutations (limit ${burstMutationLimit})`,
  );
  console.log(
    "PASS WM_CLOSE hide, visible=false persistence, hidden restart, second-instance wake-up, " +
      "visible=true persistence, and isolated cleanup",
  );
  console.log(
    "PASS Rust-owned settings persistence, retired-key migration, and 9-key on-disk schema",
  );
  console.log(
    "PASS first-run onboarding: defer, settings reopen, re-detect, completion persistence, and restart",
  );
  console.log(
    `PASS bundled furry-ai-state mappings rendered all seven states and activated sleeping.gif after ` +
      `${formatMilliseconds(stateIntegration.delayedSleeping.elapsedMs)} without image fallback`,
  );
  console.log(
    "PASS native desktop integration: transparent compositor pixels, topmost Z-order toggle, " +
    "frameless client geometry, system reduced-motion fallback/restore, real mouse drag, and hover/drag/click interaction lifecycle",
  );
  console.log(
    "PASS real tray integration: connected tooltip/menu, left-click and menu visibility, restore, " +
      "settings title-bar drag, topmost, reconnect, and hidden-window quit",
  );
  console.log(`PASS executable mode: ${usesInstalledExecutable ? "installed-release" : "workspace-debug"}`);
} catch (error) {
  mainFailure = error instanceof Error ? error.message : String(error);
  console.error(`FAIL ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  let cleanupSafe = true;
  let cleanupFailure;
  try {
    observations?.close();
    cdp?.close();
    let trackedProcessesStopped = true;
    if (backdrop) {
      trackedProcessesStopped =
        (await stopByTrackedPid(backdrop.child, "native compositor backdrop")) && trackedProcessesStopped;
      backdrop = undefined;
    }
    for (const tracked of [...trackedApplications].reverse()) {
      trackedProcessesStopped = (await stopByTrackedPid(tracked.child, tracked.label)) && trackedProcessesStopped;
    }
    if (mock) trackedProcessesStopped = (await stopByTrackedPid(mock.child, "mock")) && trackedProcessesStopped;
    for (const tracked of unidentifiedProcesses) {
      if (tracked.child.exitCode === null && tracked.child.signalCode === null) {
        console.error(
          `WARN ${tracked.label} PID ${tracked.child.pid} is still running without a verified process identity`,
        );
        trackedProcessesStopped = false;
      }
    }
    if (controlledServer) await controlledServer.close();
    if (trackedProcessesStopped) {
      await cleanWorkspaceProfilesSettled();
      if (ownsSmokeData) await cleanSmokeAppDataSettled();
    } else {
      cleanupSafe = false;
      console.error("WARN skipped profile/AppData cleanup because a tracked process may still be running");
    }
  } catch (cleanupError) {
    cleanupSafe = false;
    cleanupFailure = cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
    console.error(
      `WARN native smoke cleanup failed: ${cleanupError instanceof Error ? cleanupError.message : cleanupError}`,
    );
    process.exitCode = 1;
  }
  if (!inheritedDesktopInteractionLock && desktopInteractionLock && cleanupSafe) {
    try {
      releaseSmokeDirectoryLock(desktopInteractionLock);
      desktopInteractionLock = undefined;
    } catch (lockError) {
      console.error(
        `WARN desktop interaction lock release failed: ${lockError instanceof Error ? lockError.message : lockError}`,
      );
      process.exitCode = 1;
    }
  } else if (!inheritedDesktopInteractionLock && desktopInteractionLock && !cleanupSafe) {
    console.error(
      `WARN preserving desktop interaction lock for manual review because native cleanup was not proven safe: ` +
        `${desktopInteractionLock.lockDir}`,
    );
    process.exitCode = 1;
  }
  if (existsSync(artifactRoot)) {
    const resultPath = path.join(artifactRoot, "run-result.json");
    try {
      writeFileSync(
        resultPath,
        `${JSON.stringify({
          schemaVersion: 1,
          runId,
          completedAt: new Date().toISOString(),
          executionMode: usesInstalledExecutable ? "installed-release" : "workspace-debug",
          success: runSucceeded && cleanupSafe && process.exitCode !== 1,
          cleanupSafe,
          failure: mainFailure,
          cleanupFailure,
        }, null, 2)}\n`,
        "utf8",
      );
    } catch (resultError) {
      console.error(
        `WARN native smoke result write failed: ${resultError instanceof Error ? resultError.message : resultError}`,
      );
      process.exitCode = 1;
    }
    console.log(`Artifacts: ${artifactRoot}`);
  }
}
}

function assertInstalledExecutablePath(lockOwner) {
  const installerCacheRoot = path.resolve(root, ".cache", "windows-installer-smoke");
  const parentRunRoot = path.resolve(String(lockOwner?.runRoot ?? ""));
  assert(
    path.dirname(parentRunRoot).toLowerCase() === installerCacheRoot.toLowerCase() &&
      path.basename(parentRunRoot) === inheritedDesktopLockRunId,
    `Inherited installer lock has an unsafe run root: ${parentRunRoot}`,
  );
  const expectedInstallDir = path.join(parentRunRoot, "smoke-install");
  assert(
    path.dirname(exePath).toLowerCase() === expectedInstallDir.toLowerCase(),
    `Installed smoke executable is outside the inherited install directory: ${exePath}`,
  );
  assert(
      path.basename(exePath).toLowerCase() === "furry-agent-pet-smoke.exe",
    `Installed smoke executable has an unexpected name: ${exePath}`,
  );
  for (const [target, label] of [
    [parentRunRoot, "installer run root"],
    [expectedInstallDir, "installed smoke directory"],
  ]) {
    const stats = lstatSync(target);
    assert(stats.isDirectory() && !stats.isSymbolicLink(), `${label} is not a normal directory: ${target}`);
  }
}

function inspectSmokeExecutable() {
  const stats = lstatSync(exePath);
  assert(stats.isFile() && !stats.isSymbolicLink(), `Smoke executable is not a normal file: ${exePath}`);
  assert(stats.size > 0, `Smoke executable is empty: ${exePath}`);
  const sha256 = createHash("sha256").update(readFileSync(exePath)).digest("hex").toUpperCase();
  if (expectedExecutableSha256) {
    assert(
      sha256 === expectedExecutableSha256,
      `Installed smoke executable SHA-256 mismatch: ${sha256} != ${expectedExecutableSha256}`,
    );
  }
  return {
    path: exePath,
    bytes: statSync(exePath).size,
    modifiedAt: stats.mtime.toISOString(),
    sha256,
  };
}

async function verifyOnboardingIntegration(mockProcess) {
  const report = {
    schemaVersion: 1,
    runId,
    generatedAt: new Date().toISOString(),
    actions: {},
  };
  report.actions.initial = await waitForCdp(
    () => onboardingSnapshot(),
    (snapshot) =>
      snapshot.hidden === false &&
      snapshot.role === "dialog" &&
      snapshot.ariaModal === "true" &&
      snapshot.focusedId === "copy-agent-prompt" &&
      snapshot.connection === "connected" &&
      snapshot.connectionLabel === "已连接",
    5_000,
    "first-run onboarding dialog",
  );
  assert(
    report.actions.initial.prompt.includes("npx -y furry-companion-mcp") &&
      report.actions.initial.prompt.includes("furry_companion.set_state"),
    "onboarding omitted the direct Agent connection prompt",
  );
  assert(
    report.actions.initial.prompt.includes("thinking") &&
      report.actions.initial.prompt.includes("planning") &&
      report.actions.initial.prompt.includes("coding") &&
      report.actions.initial.prompt.includes("testing") &&
      report.actions.initial.prompt.includes("success") &&
      report.actions.initial.prompt.includes("不要发送私密路径"),
    "onboarding Agent prompt omitted the state or privacy contract",
  );
  await cdp.evaluate(`(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: async (text) => { window.__nativeSmokeCopiedPrompt = text; } },
    });
    document.querySelector('#copy-agent-prompt')?.click();
    return true;
  })()`);
  report.actions.copyPrompt = await waitForCdp(
    () => cdp.evaluate(`(() => ({
      prompt: document.querySelector('#agent-connection-prompt')?.textContent ?? '',
      copied: window.__nativeSmokeCopiedPrompt ?? '',
      status: document.querySelector('#copy-agent-prompt-status')?.textContent ?? '',
    }))()`),
    (snapshot) => snapshot.copied === snapshot.prompt && snapshot.status.includes("已复制"),
    2_000,
    "copyable Agent onboarding prompt",
  );
  report.actions.initial.storeVersion = await waitForOnboardingStoreVersion(
    0,
    "first-run onboarding version",
  );

  await cdp.evaluate("document.querySelector('#onboarding-close')?.click(); true");
  report.actions.defer = await waitForCdp(
    () => onboardingSnapshot(),
    (snapshot) => snapshot.hidden === true && snapshot.settingsToggleHidden === false,
    2_000,
    "onboarding defer",
  );
  report.actions.defer.storeVersion = await waitForOnboardingStoreVersion(
    0,
    "deferred onboarding version",
  );

  await cdp.evaluate("document.querySelector('#settings-toggle')?.click(); true");
  await waitForCdp(
    () => cdp.evaluate("document.querySelector('#settings-panel')?.hidden === false"),
    Boolean,
    2_000,
    "settings opened before onboarding reopen",
  );
  await cdp.evaluate("document.querySelector('#onboarding-button')?.click(); true");
  report.actions.reopen = await waitForCdp(
    () => onboardingSnapshot(),
    (snapshot) =>
      snapshot.hidden === false &&
      snapshot.settingsHidden === true &&
      snapshot.focusedId === "copy-agent-prompt",
    2_000,
    "onboarding reopened from settings",
  );

  const connectionsBeforeDetect = mockConnectionCount(mockProcess);
  await cdp.evaluate("document.querySelector('#onboarding-reconnect')?.click(); true");
  const connectionsAfterDetect = await waitFor(
    () => {
      assertChildRunning(mockProcess.child, "IPC mock exited during onboarding re-detect");
      const count = mockConnectionCount(mockProcess);
      return count > connectionsBeforeDetect ? count : false;
    },
    7_000,
    "onboarding re-detect creates a new IPC client",
    100,
  );
  report.actions.redetect = await waitForCdp(
    () => onboardingSnapshot(),
    (snapshot) => snapshot.hidden === false && snapshot.connection === "connected",
    5_000,
    "onboarding re-detect connected state",
  );
  report.actions.redetect.connections = {
    before: connectionsBeforeDetect,
    after: connectionsAfterDetect,
  };
  report.actions.redetect.storeVersion = await waitForOnboardingStoreVersion(
    0,
    "re-detect keeps onboarding incomplete",
  );
  const connectionsBeforeComplete = mockConnectionCount(mockProcess);
  await cdp.evaluate("document.querySelector('#onboarding-done')?.click(); true");
  report.actions.complete = await waitForCdp(
    () => onboardingSnapshot(),
    (snapshot) => snapshot.hidden === true && snapshot.settingsToggleHidden === false,
    7_000,
    "onboarding completion",
  );
  report.actions.complete.storeVersion = await waitForOnboardingStoreVersion(
    2,
    "completed onboarding version",
  );
  const connectionsAfterComplete = await waitFor(
    () => {
      assertChildRunning(mockProcess.child, "IPC mock exited during onboarding completion reconnect");
      const count = mockConnectionCount(mockProcess);
      return count > connectionsBeforeComplete ? count : false;
    },
    7_000,
    "onboarding completion creates a new IPC client",
    100,
  );
  await waitForCdp(
    () => cdp.evaluate("document.querySelector('#app').dataset.connection"),
    (value) => value === "connected",
    5_000,
    "onboarding completion returns to connected",
  );
  report.actions.complete.connections = {
    before: connectionsBeforeComplete,
    after: connectionsAfterComplete,
  };
  return report;
}

function onboardingSnapshot() {
  return cdp.evaluate(`(() => {
    const panel = document.querySelector('#onboarding-panel');
    return {
      hidden: panel?.hidden,
      role: panel?.getAttribute('role') ?? '',
      ariaModal: panel?.getAttribute('aria-modal') ?? '',
      focusedId: document.activeElement?.id ?? '',
      connection: document.querySelector('#onboarding-status')?.dataset.connection ?? '',
      connectionLabel: document.querySelector('#onboarding-connection-label')?.textContent ?? '',
      settingsHidden: document.querySelector('#settings-panel')?.hidden,
      settingsToggleHidden: document.querySelector('#settings-toggle')?.hidden,
      prompt: document.querySelector('#agent-connection-prompt')?.textContent ?? '',
      content: panel?.textContent ?? '',
    };
  })()`);
}

function writeOnboardingArtifact() {
  writeFileSync(
    path.join(artifactRoot, "onboarding-integration.json"),
    `${JSON.stringify(onboardingIntegration, null, 2)}\n`,
    "utf8",
  );
}

async function waitForOnboardingStoreVersion(expectedVersion, label) {
  let lastVersion;
  try {
    const observed = await waitFor(
      async () => {
        const version = await cdp.evaluate(
        "window.__TAURI_INTERNALS__.invoke('load_app_settings').then((settings) => settings.onboardingVersion)",
        );
        lastVersion = version;
        return version === expectedVersion ? { version } : false;
      },
      5_000,
      label,
      25,
    );
    return observed.version;
  } catch (error) {
    throw new Error(
      `${label} expected ${expectedVersion}, last observed ${JSON.stringify(lastVersion)}: ${error.message}`,
    );
  }
}

function readPersistedApplicationSettings() {
  if (!process.env.APPDATA) fail("APPDATA is unavailable for the settings persistence check.");
  const settingsPath = path.join(process.env.APPDATA, identifier, "settings.json");
  if (!existsSync(settingsPath)) return undefined;
  try {
    const document = JSON.parse(readFileSync(settingsPath, "utf8"));
    return document?.settings && typeof document.settings === "object"
      ? document.settings
      : undefined;
  } catch {
    return undefined;
  }
}

function assertBundledAnimationObservations(animations, imageErrors) {
  assert(Array.isArray(imageErrors) && imageErrors.length === 0, "bundled pet image emitted an error");
  assert(Array.isArray(animations), "native state observations omitted pet animations");
  const expectedSources = {
    idle: "idle.gif",
    thinking: "idle.gif",
    planning: "idle.gif",
    coding: "coding.gif",
    testing: "coding.gif",
    error: "exhausted.gif",
    success: "idle.gif",
  };
  for (const [state, fileName] of Object.entries(expectedSources)) {
    const expectedSuffix = `/pets/furry-ai-state/animations/${fileName}`;
    const matched = animations.some((observation) =>
      observation?.state === state &&
      String(observation.src ?? "").replaceAll("\\", "/").split(/[?#]/, 1)[0].endsWith(expectedSuffix) &&
      !String(observation.alt ?? "").includes("备用静态图标"),
    );
    assert(matched, `native state ${state} did not render bundled ${fileName}`);
  }
}

function writeStateIntegrationArtifact() {
  assert(stateIntegration, "state integration evidence is unavailable");
  writeFileSync(
    path.join(artifactRoot, "state-integration.json"),
    `${JSON.stringify({ ...stateIntegration, generatedAt: new Date().toISOString() }, null, 2)}\n`,
    "utf8",
  );
}

function launch(label, command, args, extraEnvironment = {}, options = {}) {
  const output = { value: "" };
  const child = spawn(command, args, {
    cwd: options.cwd ?? root,
    env: { ...process.env, ...extraEnvironment },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  const log = createWriteStream(path.join(artifactRoot, `${label}.log`));
  const capture = (chunk) => {
    const text = chunk.toString();
    output.value = `${output.value}${text}`.slice(-64_000);
    log.write(text);
  };
  child.stdout.on("data", capture);
  child.stderr.on("data", capture);
  child.once("exit", () => log.end());
  try {
    const identity = captureProcessIdentity(child, label, {
      allowMissing: options.allowEarlyExit === true,
      expectedExecutablePath: expectedLaunchExecutablePath(command),
    });
    if (identity) trackedProcessIdentities.set(child, identity);
    else exitedBeforeIdentityCapture.add(child);
  } catch (error) {
    unidentifiedProcesses.push({ label, child });
    throw error;
  }
  return { child, get output() { return output.value; } };
}

function launchTrackedApplication(label, environment, options = {}) {
  const launched = launch(label, exePath, [], environment, {
    ...options,
    cwd: path.dirname(exePath),
  });
  trackedApplications.push({ label, child: launched.child });
  return launched;
}

function applicationEnvironment(port, profileName) {
  assert(Number.isSafeInteger(port) && port > 0, `invalid CDP port: ${port}`);
  assert(
    /^webview2-[a-z0-9-]+$/.test(profileName),
    `unsafe workspace WebView2 profile name: ${profileName}`,
  );
  const profilePath = path.resolve(artifactRoot, profileName);
  if (path.dirname(profilePath) !== path.resolve(artifactRoot)) {
    fail(`Unsafe WebView2 profile path: ${profilePath}`);
  }
  workspaceProfiles.add(profilePath);
  return {
    FURRY_COMPANION_IPC_PATH: pipeAddress,
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:
      `--remote-debugging-port=${port} --remote-allow-origins=*`,
    WEBVIEW2_USER_DATA_FOLDER: profilePath,
  };
}

async function connectToApplicationCdp(port) {
  const target = await waitForCdpTarget(port, 15_000);
  const client = new CdpClient(target.webSocketDebuggerUrl);
  await client.connect();
  return client;
}

async function verifyWindowsDesktopIntegration(child) {
  const initial = queryTrackedWindow(child);
  assert(initial.count === 1 && initial.visible, "desktop integration requires one visible native window");
  assert(initial.topmost === true, "desktop pet did not start with WS_EX_TOPMOST");
  assert(
    initial.clientBounds.left === initial.bounds.left &&
      initial.clientBounds.top === initial.bounds.top &&
      initial.clientBounds.width === initial.bounds.width &&
      initial.clientBounds.height === initial.bounds.height,
    `native client area does not cover the full frameless window: ${JSON.stringify({
      window: initial.bounds,
      client: initial.clientBounds,
      style: initial.style,
    })}`,
  );
  const petHoverPoint = await cdp.evaluate(`(() => {
    const rect = document.querySelector('#pet-drag-handle')?.getBoundingClientRect();
    if (!rect) throw new Error('pet hover target is unavailable');
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })()`);
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x: petHoverPoint.x,
    y: petHoverPoint.y,
  });
  await waitForCdp(
    () => cdp.evaluate(`(() => {
      const toggle = document.querySelector('#settings-toggle');
      if (!toggle) return null;
      const style = getComputedStyle(toggle);
      return { opacity: style.opacity, visibility: style.visibility, width: toggle.getBoundingClientRect().width };
    })()`),
    (snapshot) => snapshot?.opacity === "1" && snapshot.visibility === "visible" && snapshot.width >= 20,
    2_000,
    "settings toggle visibility after pet hover",
  );
  const css = await cdp.evaluate(`(() => {
    const transparent = (element) => getComputedStyle(element).backgroundColor === 'rgba(0, 0, 0, 0)';
    const app = document.querySelector('#app');
    const dragHandle = document.querySelector('#pet-drag-handle');
    const petImage = document.querySelector('#pet-image');
    const settingsToggle = document.querySelector('#settings-toggle');
    if (!app || !dragHandle || !petImage || !settingsToggle) throw new Error('desktop integration DOM is incomplete');
    window.__nativeSmokeDragObserver?.disconnect();
    window.__nativeSmokeDragActions = [];
    const recordDragAction = () => {
      window.__nativeSmokeDragActions.push({
        action: app.getAttribute('data-action'),
        fallbackAction: app.getAttribute('data-action-fallback'),
        animationName: getComputedStyle(petImage).animationName,
      });
    };
    window.__nativeSmokeDragObserver = new MutationObserver(recordDragAction);
    window.__nativeSmokeDragObserver.observe(app, {
      attributes: true,
      attributeFilter: ['data-action', 'data-action-fallback'],
    });
    recordDragAction();
    document.querySelector('#__native-smoke-opaque-probe')?.remove();
    const probe = document.createElement('div');
    probe.id = '__native-smoke-opaque-probe';
    Object.assign(probe.style, {
      position: 'fixed', left: '28px', top: '28px', width: '22px', height: '22px',
      zIndex: '2147483647', pointerEvents: 'none',
      background: 'rgb(${opaqueProbeColor.r}, ${opaqueProbeColor.g}, ${opaqueProbeColor.b})',
      border: '0', boxShadow: 'none', opacity: '1'
    });
    document.body.append(probe);
    const handleRect = dragHandle.getBoundingClientRect();
    const probeRect = probe.getBoundingClientRect();
    const hitTarget = document.elementFromPoint(
      handleRect.left + handleRect.width / 2,
      handleRect.top + handleRect.height / 2,
    );
    return {
      htmlTransparent: transparent(document.documentElement),
      bodyTransparent: transparent(document.body),
      appTransparent: transparent(app),
      interaction: {
        action: app.getAttribute('data-action'),
        fallbackAction: app.getAttribute('data-action-fallback'),
        animationName: getComputedStyle(petImage).animationName,
      },
      settingsToggle: {
        insideStateChip: settingsToggle.closest('.state-chip') !== null,
        opacity: getComputedStyle(settingsToggle).opacity,
        visibility: getComputedStyle(settingsToggle).visibility,
        width: settingsToggle.getBoundingClientRect().width,
      },
      devicePixelRatio: window.devicePixelRatio,
      screen: {
        availLeft: window.screen.availLeft,
        availTop: window.screen.availTop,
        availWidth: window.screen.availWidth,
        availHeight: window.screen.availHeight,
      },
      dragHandle: {
        left: handleRect.left, top: handleRect.top,
        width: handleRect.width, height: handleRect.height,
        centerHitTargetId: hitTarget?.id ?? null,
      },
      transparentPoint: { x: 4, y: 4 },
      opaquePoint: {
        x: probeRect.left + probeRect.width / 2,
        y: probeRect.top + probeRect.height / 2,
      },
    };
  })()`);
  assert(css.htmlTransparent && css.bodyTransparent && css.appTransparent, "HTML/body/app CSS is not transparent");
  assert(
    css.interaction.action === "hovering" &&
      css.interaction.fallbackAction === "hovering" &&
      css.interaction.animationName === "hovering-bob",
    `hovering interaction did not render before drag: ${JSON.stringify(css.interaction)}`,
  );
  assert(
    css.settingsToggle.insideStateChip &&
      css.settingsToggle.opacity === "1" &&
      css.settingsToggle.visibility === "visible" &&
      css.settingsToggle.width >= 20,
    `settings toggle did not appear beside the state text while hovering: ${JSON.stringify(css.settingsToggle)}`,
  );
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x: -20,
    y: -20,
  });
  await waitForCdp(
    () => cdp.evaluate(`(() => {
      const toggle = document.querySelector('#settings-toggle');
      if (!toggle) return null;
      const style = getComputedStyle(toggle);
      return { opacity: style.opacity, visibility: style.visibility, width: toggle.getBoundingClientRect().width };
    })()`),
    (snapshot) => snapshot?.opacity === "0" && snapshot.visibility === "hidden" && snapshot.width === 0,
    2_000,
    "settings toggle hides after pet hover ends",
  );
  assert(
    Number.isFinite(css.devicePixelRatio) && css.devicePixelRatio > 0,
    "WebView returned an invalid devicePixelRatio",
  );
  assert(css.dragHandle.width > 20 && css.dragHandle.height > 20, "drag handle has no usable hit target");
  assert(
    css.dragHandle.centerHitTargetId === "pet-drag-handle",
    `drag handle center is covered by ${css.dragHandle.centerHitTargetId ?? "an unknown element"}`,
  );
  const reducedMotion = await verifyReducedMotionRendering();

  const availableRight =
    (css.screen.availLeft + css.screen.availWidth) * css.devicePixelRatio - initial.bounds.right;
  const availableBottom =
    (css.screen.availTop + css.screen.availHeight) * css.devicePixelRatio - initial.bounds.bottom;
  const requestedDelta = {
    x: availableRight >= 120 ? 96 : -96,
    y: availableBottom >= 90 ? 64 : -64,
  };
  const requestedDistance = Math.hypot(requestedDelta.x, requestedDelta.y);
  const dragAttempts = [];
  let dragged = initial;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const before = dragged;
    const startX = Math.round(
      before.clientOrigin.x + (css.dragHandle.left + css.dragHandle.width / 2) * css.devicePixelRatio,
    );
    const startY = Math.round(
      before.clientOrigin.y + (css.dragHandle.top + css.dragHandle.height / 2) * css.devicePixelRatio,
    );
    dragged = runTrackedWindowAction(child, "drag", {
      drag: {
        startX,
        startY,
        endX: startX + requestedDelta.x,
        endY: startY + requestedDelta.y,
      },
    });
    const attemptDelta = {
      x: dragged.bounds.left - before.bounds.left,
      y: dragged.bounds.top - before.bounds.top,
    };
    dragAttempts.push({ attempt, start: { x: startX, y: startY }, observedDelta: attemptDelta });
    const attemptDistance = Math.hypot(attemptDelta.x, attemptDelta.y);
    const attemptDirectionSimilarity =
      (attemptDelta.x * requestedDelta.x + attemptDelta.y * requestedDelta.y) /
      (attemptDistance * requestedDistance);
    if (
      Math.sign(attemptDelta.x) === Math.sign(requestedDelta.x) &&
      Math.sign(attemptDelta.y) === Math.sign(requestedDelta.y) &&
      attemptDistance >= requestedDistance * 0.5 &&
      attemptDistance <= requestedDistance * 1.75 &&
      attemptDirectionSimilarity >= 0.8
    ) {
      break;
    }
    await delay(250);
  }
  const dragDelta = {
    x: dragged.bounds.left - initial.bounds.left,
    y: dragged.bounds.top - initial.bounds.top,
  };
  assert(
    Math.hypot(dragDelta.x, dragDelta.y) >= 40,
    `native mouse drag moved only (${dragDelta.x}, ${dragDelta.y}) physical pixels`,
  );
  const observedDistance = Math.hypot(dragDelta.x, dragDelta.y);
  const dragDirectionSimilarity =
    (dragDelta.x * requestedDelta.x + dragDelta.y * requestedDelta.y) /
    (observedDistance * requestedDistance);
  assert(
    Math.sign(dragDelta.x) === Math.sign(requestedDelta.x) &&
      Math.sign(dragDelta.y) === Math.sign(requestedDelta.y) &&
      observedDistance >= requestedDistance * 0.5 &&
      observedDistance <= requestedDistance * 1.75 &&
      dragDirectionSimilarity >= 0.8,
    `native mouse drag diverged: requested (${requestedDelta.x}, ${requestedDelta.y}), ` +
      `observed (${dragDelta.x}, ${dragDelta.y})`,
  );
  assert(
    dragged.bounds.width === initial.bounds.width && dragged.bounds.height === initial.bounds.height,
    "native mouse drag changed the fixed-size pet window",
  );
  const restorationBeforePointerLeave = await waitForCdp(
    () => cdp.evaluate(`(() => ({
      currentAction: document.querySelector('#app')?.getAttribute('data-action') ?? null,
      history: window.__nativeSmokeDragActions ?? [],
    }))()`),
    (snapshot) => {
      const draggingIndex = snapshot.history.findIndex(
        (entry) => entry.action === "dragging" && entry.animationName === "dragging-float",
      );
      return draggingIndex >= 0 && snapshot.currentAction !== "dragging" &&
        snapshot.history.slice(draggingIndex + 1).some(
          (entry) => entry.action === "hovering" || entry.action === null,
        );
    },
    5_000,
    "native dragging interaction restoration",
  );
  await cdp.evaluate(`document.querySelector('#pet-drag-handle').dispatchEvent(
    new PointerEvent('pointerleave', { pointerType: 'mouse' })
  )`);
  const dragInteraction = await waitForCdp(
    () => cdp.evaluate(`(() => ({
      currentAction: document.querySelector('#app')?.getAttribute('data-action') ?? null,
      history: window.__nativeSmokeDragActions ?? [],
    }))()`),
    (snapshot) => snapshot.currentAction === null && snapshot.history.some(
      (entry) => entry.action === "dragging" && entry.animationName === "dragging-float",
    ) && snapshot.history.some((entry) => entry.action === null),
    2_000,
    "native hovering interaction exit",
  );
  assert(
    !dragInteraction.history.some((entry) => entry.action === "clicked"),
    "native drag incorrectly triggered the bounded clicked interaction",
  );
  await cdp.evaluate("document.querySelector('#pet-drag-handle')?.click(); true");
  const clickedActive = await waitForCdp(
    () => cdp.evaluate(`(() => ({
      currentAction: document.querySelector('#app')?.getAttribute('data-action') ?? null,
      fallbackAction: document.querySelector('#app')?.getAttribute('data-action-fallback') ?? null,
      animationName: getComputedStyle(document.querySelector('#pet-image')).animationName,
      history: window.__nativeSmokeDragActions ?? [],
    }))()`),
    (snapshot) => snapshot.currentAction === "clicked" &&
      snapshot.fallbackAction === "clicked" &&
      snapshot.animationName === "clicked-pop",
    2_000,
    "bounded clicked interaction activation",
  );
  const clickedRestored = await waitForCdp(
    () => cdp.evaluate(`(() => ({
      currentAction: document.querySelector('#app')?.getAttribute('data-action') ?? null,
      fallbackAction: document.querySelector('#app')?.getAttribute('data-action-fallback') ?? null,
      history: window.__nativeSmokeDragActions ?? [],
    }))()`),
    (snapshot) => snapshot.currentAction === null &&
      snapshot.fallbackAction === null &&
      snapshot.history.some(
        (entry) => entry.action === "clicked" &&
          entry.fallbackAction === "clicked" &&
          entry.animationName === "clicked-pop",
      ),
    2_000,
    "bounded clicked interaction restoration",
  );
  const clickInteraction = { active: clickedActive, restored: clickedRestored };
  await cdp.evaluate("window.__nativeSmokeDragObserver?.disconnect(); true");

  const points = desktopProbeScreenPoints(dragged, css);
  const first = await captureCompositorSample(child, dragged.bounds, points, transparentProbeColors[0], 1);
  assert(await stopByTrackedPid(backdrop.child, "first native compositor backdrop"), "first backdrop did not exit");
  backdrop = undefined;
  const second = await captureCompositorSample(child, dragged.bounds, points, transparentProbeColors[1], 2);

  assert(
    maxChannelDelta(first.transparent, second.transparent) >= 80,
    "transparent screen pixel did not follow two distinct native backdrop colors",
  );
  assert(
    maxChannelDelta(first.opaque, second.opaque) <= 12,
    "opaque WebView probe changed with the native backdrop",
  );
  await cdp.evaluate("document.querySelector('#__native-smoke-opaque-probe')?.remove(); true");

  return {
    schemaVersion: 1,
    runId,
    generatedAt: new Date().toISOString(),
    initial,
    css,
    reducedMotion,
    drag: {
      requestedDelta,
      observedDelta: dragDelta,
      attempts: dragAttempts,
      before: initial.bounds,
      after: dragged.bounds,
      interaction: dragInteraction,
      restorationBeforePointerLeave,
    },
    click: clickInteraction,
    topmostEnabled: second.topmostEnabled,
    compositor: {
      points,
      samples: [first.sample, second.sample],
    },
  };
}

async function verifyReducedMotionRendering() {
  const before = await reducedMotionSnapshot();
  assert(before.source.toLowerCase().includes(".gif"), "reduced-motion probe requires an active GIF");
  assert(!before.effectiveReducedMotion, "reduced motion unexpectedly effective before its probe");

  await cdp.send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-reduced-motion", value: "reduce" }],
  });
  let reduced;
  let lastReducedSnapshot;
  try {
    reduced = await waitForCdp(
      async () => {
        lastReducedSnapshot = await reducedMotionSnapshot();
        return lastReducedSnapshot;
      },
      (value) => value.systemRequested &&
        value.effectiveReducedMotion &&
        value.source.endsWith("/pets/fallback-idle.svg") &&
        value.alt.includes("已减少动态效果") &&
        value.animationName === "none",
      2_000,
      "reduced-motion static pet fallback",
    );
  } catch (error) {
    throw new Error(`${error.message}; last snapshot=${JSON.stringify(lastReducedSnapshot)}`);
  } finally {
    await cdp.send("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-reduced-motion", value: "no-preference" }],
    });
  }
  const restored = await waitForCdp(
    reducedMotionSnapshot,
    (value) => !value.systemRequested &&
      !value.effectiveReducedMotion &&
      value.source === before.source,
    2_000,
    "animated pet restoration after reduced motion",
  );
  const evidence = {
    schemaVersion: 1,
    runId,
    generatedAt: new Date().toISOString(),
    before,
    systemReduced: reduced,
    restoredAfterSystem: restored,
  };
  writeReducedMotionArtifact(evidence);
  return evidence;
}

function reducedMotionSnapshot() {
  return cdp.evaluate(`(() => {
    const image = document.querySelector('#pet-image');
    if (!(image instanceof HTMLImageElement)) throw new Error('pet image is unavailable');
    return {
      systemRequested: matchMedia('(prefers-reduced-motion: reduce)').matches,
      effectiveReducedMotion: document.documentElement.dataset.reducedMotion === 'true',
      source: image.src,
      alt: image.alt,
      animationName: getComputedStyle(image).animationName,
    };
  })()`);
}

function writeReducedMotionArtifact(evidence) {
  writeFileSync(
    path.join(artifactRoot, "reduced-motion-integration.json"),
    `${JSON.stringify(evidence, null, 2)}\n`,
    "utf8",
  );
}

function desktopProbeScreenPoints(windowSnapshot, css) {
  const toScreen = (point) => ({
    x: Math.round(windowSnapshot.clientOrigin.x + point.x * css.devicePixelRatio),
    y: Math.round(windowSnapshot.clientOrigin.y + point.y * css.devicePixelRatio),
  });
  const transparent = toScreen(css.transparentPoint);
  const opaque = toScreen(css.opaquePoint);
  for (const [name, point] of Object.entries({ transparent, opaque })) {
    assert(
      point.x >= windowSnapshot.bounds.left && point.x < windowSnapshot.bounds.right &&
        point.y >= windowSnapshot.bounds.top && point.y < windowSnapshot.bounds.bottom,
      `${name} compositor sample lies outside the tracked native window`,
    );
  }
  return [
    { name: "transparent", ...transparent },
    { name: "opaque", ...opaque },
  ];
}

async function captureCompositorSample(child, bounds, points, color, ordinal) {
  backdrop = await launchNativeBackdrop(bounds, color, ordinal);
  assertChildRunning(backdrop.child, `${backdrop.label} exited before the topmost check`);
  const topmostEnabled = runTrackedWindowAction(child, "topmost", { otherHandle: backdrop.handle });
  assert(topmostEnabled.topmost === true, "native probe could not confirm WS_EX_TOPMOST");
  assert(topmostEnabled.targetAboveOther === true, "pet is not above the topmost compositor probe");
  assert(topmostEnabled.zOrderComparison === -1, "native probe did not place the pet above the compositor probe");

  const captured = await waitFor(
    () => {
      assertChildRunning(backdrop.child, `${backdrop.label} exited before compositor sampling`);
      const snapshot = runTrackedWindowAction(child, "pixels", {
        otherHandle: backdrop.handle,
        points,
      });
      const transparent = pixelByName(snapshot, "transparent");
      const opaque = pixelByName(snapshot, "opaque");
      return maxChannelDelta(transparent, color) <= 8 &&
        maxChannelDelta(opaque, opaqueProbeColor) <= 12
        ? { snapshot, transparent, opaque }
        : false;
    },
    6_000,
    `native transparent compositor sample ${ordinal}`,
    200,
  );
  return {
    sample: {
      backdrop: color,
      transparent: captured.transparent,
      opaque: captured.opaque,
      targetAboveBackdrop: captured.snapshot.targetAboveOther,
    },
    transparent: captured.transparent,
    opaque: captured.opaque,
    topmostEnabled,
  };
}

async function launchNativeBackdrop(bounds, color, ordinal) {
  const margin = 24;
  const backdropBounds = {
    left: bounds.left - margin,
    top: bounds.top - margin,
    width: bounds.width + margin * 2,
    height: bounds.height + margin * 2,
  };
  const label = `compositor-backdrop-${ordinal}`;
  const launched = launch(
    label,
    "powershell.exe",
    ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", nativeProbePath],
    {
      TEMP: artifactRoot,
      TMP: artifactRoot,
      NATIVE_SMOKE_ACTION: "backdrop",
      NATIVE_SMOKE_BACKDROP_BOUNDS: JSON.stringify(backdropBounds),
      NATIVE_SMOKE_BACKDROP_COLOR: JSON.stringify(color),
    },
  );
  try {
    const handle = await waitFor(
      () => {
        assertChildRunning(launched.child, `${label} exited before READY`);
        const match = launched.output.match(/READY\s+(\d+)/);
        return match ? Number(match[1]) : false;
      },
      8_000,
      `${label} READY`,
      100,
    );
    assert(Number.isSafeInteger(handle) && handle > 0, `${label} returned an invalid HWND`);
    return { child: launched.child, handle, label, bounds: backdropBounds, color };
  } catch (error) {
    await stopByTrackedPid(launched.child, label);
    throw error;
  }
}

function pixelByName(snapshot, name) {
  const pixel = snapshot.pixels?.find((candidate) => candidate.name === name);
  assert(pixel, `native probe omitted the ${name} screen pixel`);
  for (const channel of ["r", "g", "b"]) {
    assert(Number.isInteger(pixel[channel]) && pixel[channel] >= 0 && pixel[channel] <= 255,
      `native probe returned an invalid ${name}.${channel} channel`);
  }
  return { r: pixel.r, g: pixel.g, b: pixel.b };
}

function maxChannelDelta(first, second) {
  return Math.max(
    Math.abs(first.r - second.r),
    Math.abs(first.g - second.g),
    Math.abs(first.b - second.b),
  );
}

async function verifyWindowsTrayIntegration(child, mockProcess) {
  assertChildRunning(mockProcess?.child, "tray integration requires the running IPC mock");
  const report = {
    schemaVersion: 1,
    runId,
    generatedAt: new Date().toISOString(),
    expectedTooltip: connectedTrayTooltip,
    expectedMenuItems: expectedTrayMenuItems,
    actions: {},
  };

  const initial = runTrayAction(child, "inspect", { tooltipPrefix: connectedTrayTooltip });
  assertTrayMenuSnapshot(initial, "unchecked");
  report.actions.inspectConnected = initial;

  report.actions.leftClickHide = runTrayAction(child, "left-click");
  await waitForTrackedWindowVisibility(child, false, "tray left-click hide");
  report.actions.leftClickShow = runTrayAction(child, "left-click");
  await waitForTrackedWindowVisibility(child, true, "tray left-click show");

  report.actions.menuHide = runTrayAction(child, "menu-click", { menuItem: "显示/隐藏桌宠" });
  await waitForTrackedWindowVisibility(child, false, "tray menu hide");
  report.actions.menuShow = runTrayAction(child, "menu-click", { menuItem: "显示/隐藏桌宠" });
  await waitForTrackedWindowVisibility(child, true, "tray menu show");

  const beforeRestore = queryTrackedWindow(child);
  report.actions.restorePosition = {
    before: beforeRestore,
    probe: runTrayAction(child, "menu-click", { menuItem: "恢复默认位置" }),
  };
  const screen = desktopIntegration.css.screen;
  const scale = desktopIntegration.css.devicePixelRatio;
  const expectedCenter = {
    x: Math.round((screen.availLeft + screen.availWidth / 2) * scale),
    y: Math.round((screen.availTop + screen.availHeight / 2) * scale),
  };
  const restored = await waitFor(
    () => {
      const snapshot = queryTrackedWindow(child);
      if (snapshot.count !== 1 || !snapshot.visible) return false;
      const center = {
        x: snapshot.bounds.left + snapshot.bounds.width / 2,
        y: snapshot.bounds.top + snapshot.bounds.height / 2,
      };
      return Math.abs(center.x - expectedCenter.x) <= 24 &&
        Math.abs(center.y - expectedCenter.y) <= 24
        ? { ...snapshot, center }
        : false;
    },
    5_000,
    "tray restore centered native window",
    100,
  );
  assert(
    Math.hypot(
      restored.bounds.left - beforeRestore.bounds.left,
      restored.bounds.top - beforeRestore.bounds.top,
    ) >= 40,
    "tray restore did not materially move the previously dragged window",
  );
  report.actions.restorePosition.expectedCenter = expectedCenter;
  report.actions.restorePosition.after = restored;

  const settingsInitiallyHidden = await cdp.evaluate(
    "document.querySelector('#settings-panel')?.hidden === true",
  );
  assert(settingsInitiallyHidden, "settings panel was unexpectedly open before the tray settings test");
  postTrackedWindowClose(child);
  report.actions.settingsPreconditionHide = {
    method: "WM_CLOSE",
    state: await waitForTrackedWindowVisibility(child, false, "tray settings hidden-window precondition"),
  };
  report.actions.settings = runTrayAction(child, "menu-click", { menuItem: "设置" });
  await waitForTrackedWindowVisibility(child, true, "tray settings shows native window");
  const settingsState = await waitForCdp(
    () => cdp.evaluate(`(() => ({
      hidden: document.querySelector('#settings-panel')?.hidden,
      focused: document.hasFocus(),
      devicePixelRatio: window.devicePixelRatio,
      screen: {
        availLeft: window.screen.availLeft,
        availTop: window.screen.availTop,
        availWidth: window.screen.availWidth,
        availHeight: window.screen.availHeight,
      },
      dragHandle: (() => {
        const handle = document.querySelector('#settings-drag-handle');
        const rect = handle?.getBoundingClientRect();
        if (!handle || !rect) return null;
        const target = document.elementFromPoint(
          rect.left + rect.width / 2,
          rect.top + rect.height / 2,
        );
        return {
          left: rect.left,
          top: rect.top,
          width: rect.width,
          height: rect.height,
          centerInsideButton: Boolean(target?.closest('button')),
        };
      })(),
      petRect: (() => {
        const rect = document.querySelector('.pet-column')?.getBoundingClientRect();
        return rect ? { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom } : null;
      })(),
      panelRect: (() => {
        const rect = document.querySelector('#settings-panel')?.getBoundingClientRect();
        return rect ? { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom } : null;
      })(),
      closeRect: (() => {
        const rect = document.querySelector('#settings-close')?.getBoundingClientRect();
        return rect ? { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom } : null;
      })(),
      form: (() => {
        const form = document.querySelector('#settings-form');
        return form ? { clientHeight: form.clientHeight, scrollHeight: form.scrollHeight, scrollTop: form.scrollTop } : null;
      })(),
      retiredControlsAbsent: [
        '#reduce-motion-input',
        '#ipc-enabled-input',
        '#ipc-address-input',
        '#center-window-button',
      ].every((selector) => document.querySelector(selector) === null),
      settingsToggleInsideStateChip: document.querySelector('.state-chip')?.contains(
        document.querySelector('#settings-toggle'),
      ) === true,
    }))()`),
    (value) => value.hidden === false && value.focused === true && value.dragHandle && value.petRect && value.panelRect && value.closeRect && value.form,
    5_000,
    "tray settings panel and focus",
  );
  report.actions.settings.state = settingsState;
  assert(settingsState.dragHandle.width >= 120, "settings drag handle is too narrow to use reliably");
  assert(
    settingsState.dragHandle.height >= 32,
    "settings drag handle is too short to use reliably",
  );
  assert(
    settingsState.dragHandle.centerInsideButton === false,
    "settings drag handle center is covered by an interactive button",
  );
  assert(
    settingsState.petRect.right <= settingsState.panelRect.left,
    "settings panel overlaps the pet instead of opening beside it",
  );
  assert(settingsState.retiredControlsAbsent, "retired settings controls are still present in the DOM");
  assert(
    settingsState.settingsToggleInsideStateChip,
    "settings toggle is not placed beside the state text inside the state chip",
  );
  assert(
    settingsState.form.scrollHeight > settingsState.form.clientHeight,
    "settings form is not scrollable, so the fixed close-button behavior cannot be exercised",
  );
  const closeBeforeScroll = settingsState.closeRect;
  const closeAfterScroll = await cdp.evaluate(`(() => {
    const form = document.querySelector('#settings-form');
    const close = document.querySelector('#settings-close');
    form.scrollTop = form.scrollHeight;
    const rect = close.getBoundingClientRect();
    return {
      left: rect.left,
      right: rect.right,
      top: rect.top,
      bottom: rect.bottom,
      scrollTop: form.scrollTop,
    };
  })()`);
  assert(closeAfterScroll.scrollTop > 0, "settings form did not scroll during the fixed close-button probe");
  assert(
    closeAfterScroll.left === closeBeforeScroll.left &&
      closeAfterScroll.right === closeBeforeScroll.right &&
      closeAfterScroll.top === closeBeforeScroll.top &&
      closeAfterScroll.bottom === closeBeforeScroll.bottom,
    "settings close button moved when the settings content scrolled",
  );
  report.actions.settings.fixedCloseButton = { before: closeBeforeScroll, after: closeAfterScroll };
  const beforeSettingsDrag = queryTrackedWindow(child);
  const settingsAvailableRight =
    (settingsState.screen.availLeft + settingsState.screen.availWidth) *
      settingsState.devicePixelRatio -
    beforeSettingsDrag.bounds.right;
  const settingsAvailableBottom =
    (settingsState.screen.availTop + settingsState.screen.availHeight) *
      settingsState.devicePixelRatio -
    beforeSettingsDrag.bounds.bottom;
  const settingsRequestedDelta = {
    x: settingsAvailableRight >= 90 ? 72 : -72,
    y: settingsAvailableBottom >= 70 ? 48 : -48,
  };
  const settingsDragStart = {
    x: Math.round(
      beforeSettingsDrag.clientOrigin.x +
        (settingsState.dragHandle.left + settingsState.dragHandle.width / 2) *
          settingsState.devicePixelRatio,
    ),
    y: Math.round(
      beforeSettingsDrag.clientOrigin.y +
        (settingsState.dragHandle.top + settingsState.dragHandle.height / 2) *
          settingsState.devicePixelRatio,
    ),
  };
  const afterSettingsDrag = runTrackedWindowAction(child, "drag", {
    drag: {
      startX: settingsDragStart.x,
      startY: settingsDragStart.y,
      endX: settingsDragStart.x + settingsRequestedDelta.x,
      endY: settingsDragStart.y + settingsRequestedDelta.y,
    },
  });
  const settingsObservedDelta = {
    x: afterSettingsDrag.bounds.left - beforeSettingsDrag.bounds.left,
    y: afterSettingsDrag.bounds.top - beforeSettingsDrag.bounds.top,
  };
  assert(
    Math.hypot(settingsObservedDelta.x, settingsObservedDelta.y) >= 32,
    `settings header drag moved only (${settingsObservedDelta.x}, ${settingsObservedDelta.y}) physical pixels`,
  );
  assert(
    afterSettingsDrag.bounds.width === beforeSettingsDrag.bounds.width &&
      afterSettingsDrag.bounds.height === beforeSettingsDrag.bounds.height,
    "settings header drag changed the fixed-size window",
  );
  assert(
    await cdp.evaluate("document.querySelector('#settings-panel')?.hidden === false"),
    "settings panel closed while dragging its title bar",
  );
  report.actions.settings.drag = {
    requestedDelta: settingsRequestedDelta,
    observedDelta: settingsObservedDelta,
    before: beforeSettingsDrag.bounds,
    after: afterSettingsDrag.bounds,
  };
  await cdp.evaluate("document.querySelector('#settings-close')?.click(); true");
  await waitForCdp(
    () => cdp.evaluate("document.querySelector('#settings-panel')?.hidden === true"),
    Boolean,
    2_000,
    "settings panel close after tray test",
  );

  report.actions.topmostEnable = runTrayAction(child, "menu-click", { menuItem: "总在最前" });
  const enabled = await waitFor(
    async () => {
      const native = queryTrackedWindow(child);
      const checked = await cdp.evaluate("document.querySelector('#always-on-top-input')?.checked");
      return native.count === 1 && native.topmost === true && checked === true
        ? { native, checked }
        : false;
    },
    5_000,
    "tray always-on-top enable",
    100,
  );
  assert(
    report.actions.topmostEnable.clickedItem?.toggleState === "unchecked",
    "tray topmost enable did not start from an unchecked menu item",
  );
  report.actions.topmostEnable.result = enabled;

  const checkedMenu = runTrayAction(child, "inspect");
  assertTrayMenuSnapshot(checkedMenu, "checked");
  report.actions.topmostCheckedMenu = checkedMenu;
  report.actions.topmostDisable = runTrayAction(child, "menu-click", { menuItem: "总在最前" });
  const disabled = await waitFor(
    async () => {
      const native = queryTrackedWindow(child);
      const checked = await cdp.evaluate("document.querySelector('#always-on-top-input')?.checked");
      return native.count === 1 && native.topmost === false && checked === false
        ? { native, checked }
        : false;
    },
    5_000,
    "tray always-on-top disable",
    100,
  );
  assert(
    report.actions.topmostDisable.clickedItem?.toggleState === "checked",
    "tray topmost disable did not start from a checked menu item",
  );
  report.actions.topmostDisable.result = disabled;

  const connectionCountBefore = mockConnectionCount(mockProcess);
  assert(connectionCountBefore >= 1, "IPC mock did not record the initial tray-test connection");
  report.actions.reconnect = runTrayAction(child, "menu-click", { menuItem: "重新连接" });
  const connectionCountAfter = await waitFor(
    () => {
      assertChildRunning(mockProcess.child, "IPC mock exited during tray reconnect");
      const count = mockConnectionCount(mockProcess);
      return count > connectionCountBefore ? count : false;
    },
    7_000,
    "tray reconnect creates a new IPC client",
    100,
  );
  await waitForCdp(
    () => cdp.evaluate("document.querySelector('#app').dataset.connection"),
    (value) => value === "connected",
    5_000,
    "tray reconnect returns to connected",
  );
  report.actions.reconnect.connections = {
    before: connectionCountBefore,
    after: connectionCountAfter,
  };
  const reconnected = runTrayAction(child, "inspect", { tooltipPrefix: connectedTrayTooltip });
  assertTrayMenuSnapshot(reconnected, "unchecked");
  report.actions.reconnectedStatus = reconnected;

  return report;
}

function runTrayAction(child, action, options = {}) {
  assertChildRunning(child, `cannot ${action} the tray of a stopped application`);
  assert(Number.isSafeInteger(child.pid) && child.pid > 0, `invalid tray PID: ${child.pid}`);
  assert(
    ["inspect", "left-click", "menu-click"].includes(action),
    `unsupported tray action: ${action}`,
  );
  if (action === "menu-click") {
    assert(
      typeof options.menuItem === "string" && options.menuItem.length > 0,
      "tray menu-click requires a menu item",
    );
  }
  const tooltipPrefix = options.tooltipPrefix ?? trayTooltipPrefix;
  assert(
      typeof tooltipPrefix === "string" && tooltipPrefix.startsWith("furry-agent-pet"),
    "invalid tray tooltip prefix",
  );
  const actionLabel = action === "menu-click" ? `${action}:${options.menuItem}` : action;
  console.log(`CHECK real tray action ${actionLabel}`);

  const result = spawnSync(
    "powershell.exe",
    [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      trayProbePath,
    ],
    {
      encoding: "utf8",
      windowsHide: true,
      timeout: 60_000,
      env: {
        ...process.env,
        TEMP: artifactRoot,
        TMP: artifactRoot,
        NATIVE_TRAY_ACTION: action,
        NATIVE_TRAY_PID: String(child.pid),
        NATIVE_TRAY_TOOLTIP_PREFIX: tooltipPrefix,
        NATIVE_TRAY_MENU_ITEM: action === "menu-click" ? options.menuItem : "",
      },
    },
  );
  if (result.error) {
    fail(`Windows tray helper ${actionLabel} failed: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const detail = `${result.stderr ?? ""}\n${result.stdout ?? ""}`.trim();
    fail(
      `Windows tray helper ${actionLabel} exited with ${result.status}` +
        (detail ? `: ${detail}` : ""),
    );
  }

  let snapshot;
  try {
    snapshot = JSON.parse(result.stdout.trim());
  } catch (error) {
    fail(`Windows tray helper returned invalid JSON: ${error.message}`);
  }
  assert(snapshot.action === action, `Windows tray helper returned action ${snapshot.action}`);
  assert(snapshot.pid === child.pid, `Windows tray helper returned PID ${snapshot.pid}`);
  assert(Number.isSafeInteger(snapshot.trayWindow) && snapshot.trayWindow > 0, "tray helper omitted HWND");
  assert(Number.isSafeInteger(snapshot.iconId) && snapshot.iconId >= 1, "tray helper omitted icon id");
  assert(
    Array.isArray(snapshot.icon?.names) &&
      snapshot.icon.names.some((name) => name.includes(tooltipPrefix)),
    `tray helper did not confirm tooltip prefix: ${tooltipPrefix}`,
  );
  assert(snapshot.icon.bounds?.width > 0 && snapshot.icon.bounds?.height > 0, "tray helper omitted icon bounds");
  if (action === "menu-click") {
    assert(snapshot.clickedItem?.name === options.menuItem, "tray helper clicked the wrong menu item");
    assert(snapshot.clickedItem.enabled === true, "tray helper reported a disabled clicked menu item");
  }
  console.log(`PASS real tray action ${actionLabel}`);
  return snapshot;
}

function assertTrayMenuSnapshot(snapshot, expectedTopmostToggle) {
  const items = snapshot.menu?.items;
  assert(Array.isArray(items), "tray inspection omitted the popup menu items");
  assert(
    JSON.stringify(items.map((item) => item.name)) === JSON.stringify(expectedTrayMenuItems),
    `tray menu items did not match: ${JSON.stringify(items.map((item) => item.name))}`,
  );
  assert(items[0].enabled === false, "tray connection status item must be read-only");
  assert(items.slice(1).every((item) => item.enabled === true), "an actionable tray item was disabled");
  const topmost = items.find((item) => item.name === "总在最前");
  assert(
    topmost?.toggleState === expectedTopmostToggle,
    `tray topmost toggle was ${topmost?.toggleState}, expected ${expectedTopmostToggle}`,
  );
}

function mockConnectionCount(mockProcess) {
  return (mockProcess.output.match(/^CLIENT_CONNECTED\s+\d+$/gm) ?? []).length;
}

async function waitForTrackedWindowVisibility(child, expectedVisibility, label) {
  return waitFor(
    () => {
      assertChildRunning(child, `${label}: tracked application exited`);
      const snapshot = queryTrackedWindow(child);
      if (snapshot.count > 1) {
        fail(`${label}: found ${snapshot.count} windows matching the tracked PID and exact title`);
      }
      return snapshot.count === 1 && snapshot.visible === expectedVisibility ? snapshot : false;
    },
    7_000,
    label,
    50,
  );
}

function queryTrackedWindow(child, options = {}) {
  return runTrackedWindowAction(child, "query", options);
}

function postTrackedWindowClose(child) {
  const snapshot = runTrackedWindowAction(child, "close");
  assert(snapshot.count === 1, "WM_CLOSE helper did not target exactly one tracked window");
}

function runTrackedWindowAction(child, action, options = {}) {
  assertChildRunning(child, `cannot ${action} a stopped application`);
  assert(Number.isSafeInteger(child.pid) && child.pid > 0, `invalid tracked PID: ${child.pid}`);
  assert(
    ["query", "close", "topmost", "pixels", "drag"].includes(action),
    `unsupported tracked window action: ${action}`,
  );
  if (options.otherHandle !== undefined) {
    assert(
      Number.isSafeInteger(options.otherHandle) && options.otherHandle > 0,
      `invalid comparison HWND: ${options.otherHandle}`,
    );
  }
  if (action === "pixels") {
    assert(Array.isArray(options.points) && options.points.length > 0, "pixel action requires sample points");
  }
  if (action === "drag") {
    for (const key of ["startX", "startY", "endX", "endY"]) {
      assert(Number.isSafeInteger(options.drag?.[key]), `drag action requires integer ${key}`);
    }
  }
  const result = spawnSync(
    "powershell.exe",
    [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      nativeProbePath,
    ],
    {
      encoding: "utf8",
      windowsHide: true,
      timeout: 5_000,
      env: {
        ...process.env,
        TEMP: artifactRoot,
        TMP: artifactRoot,
        NATIVE_SMOKE_ACTION: action,
        NATIVE_SMOKE_WINDOW_PID: String(child.pid),
        NATIVE_SMOKE_WINDOW_TITLE: mainWindowTitle,
        NATIVE_SMOKE_OTHER_HANDLE:
          options.otherHandle === undefined ? "" : String(options.otherHandle),
        NATIVE_SMOKE_POINTS: action === "pixels" ? JSON.stringify(options.points) : "[]",
        NATIVE_SMOKE_DRAG_START_X: action === "drag" ? String(options.drag.startX) : "0",
        NATIVE_SMOKE_DRAG_START_Y: action === "drag" ? String(options.drag.startY) : "0",
        NATIVE_SMOKE_DRAG_END_X: action === "drag" ? String(options.drag.endX) : "0",
        NATIVE_SMOKE_DRAG_END_Y: action === "drag" ? String(options.drag.endY) : "0",
      },
    },
  );
  if (result.error) {
    fail(`Win32 window helper failed: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const detail = `${result.stderr ?? ""}\n${result.stdout ?? ""}`.trim();
    fail(`Win32 window helper exited with ${result.status}${detail ? `: ${detail}` : ""}`);
  }

  let snapshot;
  try {
    snapshot = JSON.parse(result.stdout.trim());
  } catch (error) {
    fail(`Win32 window helper returned invalid JSON: ${error.message}`);
  }
  assert(
    Number.isSafeInteger(snapshot.count) && snapshot.count >= 0,
    "Win32 window helper returned an invalid match count",
  );
  if (snapshot.count === 1) {
    assert(typeof snapshot.visible === "boolean", "Win32 window helper omitted visibility");
    assert(snapshot.bounds && Number.isInteger(snapshot.bounds.left), "Win32 helper omitted bounds");
    assert(typeof snapshot.topmost === "boolean", "Win32 helper omitted topmost style");
  }
  return snapshot;
}

async function quitThroughCdp(client) {
  const scheduled = await client.evaluate(`(() => {
    if (typeof window.__TAURI_INTERNALS__?.invoke !== 'function') {
      throw new Error('Tauri invoke bridge is unavailable');
    }
    void window.__TAURI_INTERNALS__.invoke('quit_app');
    return true;
  })()`);
  assert(scheduled === true, "CDP did not schedule quit_app");
}

function assertChildRunning(child, message) {
  assert(child && child.exitCode === null && child.signalCode === null, message);
}

function assertTrackedApplicationsExited() {
  for (const tracked of trackedApplications) {
    assert(
      tracked.child.exitCode !== null || tracked.child.signalCode !== null,
      `${tracked.label} PID ${tracked.child.pid} is still running after the smoke lifecycle`,
    );
  }
}

function stateSnapshot() {
  return cdp.evaluate(`(() => {
    const bubble = document.querySelector('#state-bubble');
    return {
      state: document.querySelector('#app').dataset.state,
      states: window.__nativeSmokeStates ?? [],
      animations: window.__nativeSmokeAnimations ?? [],
      imageErrors: window.__nativeSmokeImageErrors ?? [],
      bubbleHidden: bubble.hidden,
      role: bubble.getAttribute('role'),
      message: document.querySelector('#bubble-message').textContent,
      closeLabel: document.querySelector('#bubble-close').getAttribute('aria-label') ?? ''
    };
  })()`);
}

async function installNativeMetricsObserver() {
  const collector = new BindingObservationCollector(cdp, metricBindingName);
  try {
    await cdp.send("Runtime.enable", {});
    await cdp.send("Runtime.addBinding", { name: metricBindingName });
    await cdp.evaluate(`(() => {
      const message = document.querySelector('#bubble-message');
      const file = document.querySelector('#bubble-file');
      const bubble = document.querySelector('#state-bubble');
      const app = document.querySelector('#app');
      if (!message || !file || !bubble || !app) {
        throw new Error('native metrics DOM is incomplete');
      }

      window.__nativeSmokeMetricsObserver?.disconnect();
      window.__nativeSmokeMetrics = { burstMutations: 0 };
      const reportMarker = (marker) => {
        if (!marker.startsWith(${JSON.stringify(latencyMarkerPrefix)}) &&
            !marker.startsWith(${JSON.stringify(burstMarkerPrefix)})) {
          return;
        }
        if (marker.startsWith(${JSON.stringify(burstMarkerPrefix)})) {
          window.__nativeSmokeMetrics.burstMutations += 1;
        }
        window[${JSON.stringify(metricBindingName)}](JSON.stringify({
          marker,
          state: app.dataset.state,
          fileText: file.textContent ?? '',
          fileHidden: file.hidden,
          bubbleHidden: bubble.hidden,
        }));
      };
      window.__nativeSmokeMetricsObserver = new MutationObserver((records) => {
        for (const record of records) {
          for (const node of record.addedNodes) {
            reportMarker(node.textContent ?? '');
          }
        }
      });
      window.__nativeSmokeMetricsObserver.observe(message, { childList: true });
      return true;
    })()`);
    return collector;
  } catch (error) {
    collector.close();
    throw error;
  }
}

async function runNativeLatencyPhase(socket, collector) {
  for (let cycle = 0; cycle < latencyWarmupCycles; cycle += 1) {
    await runLatencyCycle(socket, collector, `warmup-${cycle}`, undefined);
  }

  const samples = [];
  for (let cycle = 0; cycle < latencyMeasuredCycles; cycle += 1) {
    await runLatencyCycle(socket, collector, `sample-${cycle}`, samples);
  }

  const expectedSamples = latencyMeasuredCycles * requiredStates.length;
  assert(samples.length === expectedSamples, `expected ${expectedSamples} latency samples, got ${samples.length}`);
  const sorted = [...samples].sort((left, right) => left - right);
  const result = {
    count: sorted.length,
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    max: sorted.at(-1),
  };
  assert(
    result.p95 < latencyTargetMs,
    `native state latency p95 was ${formatMilliseconds(result.p95)}, target is < ${latencyTargetMs} ms`,
  );
  return result;
}

async function runLatencyCycle(socket, collector, cycleId, samples) {
  for (const [index, state] of requiredStates.entries()) {
    const marker = `${latencyMarkerPrefix}${cycleId}:${index}:${state}`;
    const observed = collector.waitFor(marker, 2_000);
    const sentAt = performance.now();
    writeIpc(socket, toJsonLine({ type: "state", state, message: marker }));
    const observation = await observed;
    const elapsed = observation.receivedAt - sentAt;
    assert(observation.state === state, `${marker} rendered state ${observation.state}`);
    assert(!observation.bubbleHidden, `${marker} did not render a visible bubble`);
    assert(Number.isFinite(elapsed) && elapsed >= 0, `${marker} produced invalid latency ${elapsed}`);
    samples?.push(elapsed);
  }
}

async function runNativeBurstPhase(socket, collector) {
  await cdp.evaluate(`(() => {
    const file = document.querySelector('#file-input');
    file.checked = true;
    file.dispatchEvent(new Event('change', { bubbles: true }));
    window.__nativeSmokeMetrics.burstMutations = 0;
    return true;
  })()`);

  const leadingMarker = `${burstMarkerPrefix}0`;
  const finalMarker = `${burstMarkerPrefix}${burstEventCount - 1}`;
  const leading = collector.waitFor(leadingMarker, 2_000);
  const final = collector.waitFor(finalMarker, 2_000);
  const payload = Array.from({ length: burstEventCount }, (_, index) =>
    toJsonLine({
      type: "state",
      state: "coding",
      message: `${burstMarkerPrefix}${index}`,
      ...(index < burstEventCount - 1
        ? { file: index === 0 ? "src/burst-leading.ts" : `src/burst/${index}.ts` }
        : {}),
    }),
  ).join("");

  writeIpc(socket, payload);
  const [leadingObservation, finalObservation] = await Promise.all([leading, final]);
  assert(leadingObservation.state === "coding", "burst leading event did not render coding");
  assert(
    leadingObservation.fileText === "src/burst-leading.ts" && !leadingObservation.fileHidden,
    "burst leading event did not render its complete file field",
  );
  assert(finalObservation.state === "coding", "burst final event did not render coding");
  assert(
    finalObservation.fileText === "" && finalObservation.fileHidden,
    "burst final event did not clear the omitted file field",
  );

  await delay(100);
  const snapshot = await cdp.evaluate(`(() => ({
    state: document.querySelector('#app').dataset.state,
    message: document.querySelector('#bubble-message').textContent,
    fileText: document.querySelector('#bubble-file').textContent,
    fileHidden: document.querySelector('#bubble-file').hidden,
    bubbleHidden: document.querySelector('#state-bubble').hidden,
    mutations: window.__nativeSmokeMetrics.burstMutations,
  }))()`);
  assert(snapshot.state === "coding", `burst ended in ${snapshot.state}, expected coding`);
  assert(snapshot.message === finalMarker && !snapshot.bubbleHidden, "burst final message is not visible");
  assert(snapshot.fileText === "" && snapshot.fileHidden, "burst final DOM retained a stale file");
  assert(snapshot.mutations >= 2, `burst produced only ${snapshot.mutations} marker mutation(s)`);
  assert(
    snapshot.mutations <= burstMutationLimit,
    `burst produced ${snapshot.mutations} marker mutations, limit is ${burstMutationLimit}`,
  );
  return { mutations: snapshot.mutations };
}

async function runDelayedSleepingPhase(socket) {
  // Force a real state transition before installing the timer probe. The
  // success fallback may already have returned to idle while slower native
  // interaction checks are running; another idle detail update intentionally
  // does not reset the delayed-variant schedule.
  writeIpc(socket, toJsonLine({
    type: "state",
    state: "thinking",
    message: "准备验证空闲延迟动作",
  }));
  await waitForCdp(
    () => petImageSnapshot(),
    (value) => value.state === "thinking",
    5_000,
    "non-idle precondition before delayed sleeping transition",
  );
  await cdp.evaluate(`(() => {
    window.__nativeSmokeDelayTimers = [];
    const originalSetTimeout = window.setTimeout.bind(window);
    window.setTimeout = (callback, delay = 0, ...args) => {
      const entry = {
        delay,
        scheduledAt: performance.now(),
        firedAt: null,
      };
      const timerId = originalSetTimeout(() => {
        entry.firedAt = performance.now();
        callback(...args);
      }, delay);
      entry.timerId = timerId;
      window.__nativeSmokeDelayTimers.push(entry);
      return timerId;
    };
    return true;
  })()`);
  const startedAt = performance.now();
  writeIpc(socket, toJsonLine({
    type: "state",
    state: "idle",
    message: "验证空闲 60 秒后切换 sleeping.gif",
  }));

  const idle = await waitForCdp(
    () => petImageSnapshot(),
    (value) => value.state === "idle" && assetSourceEndsWith(value.src, "idle.gif") &&
      value.complete === true && value.naturalWidth > 0 && value.naturalHeight > 0,
    5_000,
    "idle.gif before delayed sleeping transition",
  );
  const idleRenderedAfterMs = performance.now() - startedAt;
  assert(!idle.alt.includes("备用静态图标"), "idle phase used the fallback image");
  await waitForCdp(
    () => cdp.evaluate("window.__nativeSmokeDelayTimers ?? []"),
    (timers) => timers.some((timer) => timer.delay === 60_000),
    2_000,
    "60-second idle variant timer scheduling",
  );

  let sleeping;
  try {
    sleeping = await waitForCdp(
      () => petImageSnapshot(),
      (value) => value.state === "idle" && assetSourceEndsWith(value.src, "sleeping.gif") &&
        value.complete === true && value.naturalWidth > 0 && value.naturalHeight > 0,
      sleepingActivationTimeoutMs,
      "sleeping.gif after the configured idle delay",
    );
  } catch (error) {
    const diagnostics = await cdp.evaluate(`(() => ({
      timers: window.__nativeSmokeDelayTimers ?? [],
      state: document.querySelector('#app')?.dataset.state ?? null,
      action: document.querySelector('#app')?.dataset.action ?? null,
      animationOverride: document.querySelector('[data-state="idle"]')?.value ?? null,
      imageSource: document.querySelector('#pet-image')?.getAttribute('src') ?? null,
      visible: document.visibilityState,
      focused: document.hasFocus(),
    }))()`);
    writeFileSync(
      path.join(artifactRoot, "delayed-sleeping-diagnostic.json"),
      `${JSON.stringify(diagnostics, null, 2)}\n`,
      "utf8",
    );
    throw error;
  }
  const elapsedMs = performance.now() - startedAt;
  assert(
    elapsedMs >= sleepingActivationMinimumMs,
    `sleeping.gif activated too early after ${formatMilliseconds(elapsedMs)}`,
  );
  assert(!sleeping.alt.includes("备用静态图标"), "sleeping phase used the fallback image");
  const completedTimerDiagnostics = await cdp.evaluate("window.__nativeSmokeDelayTimers ?? []");
  return {
    configuredDelayMs: sleepingDelayMs,
    minimumAcceptedMs: sleepingActivationMinimumMs,
    idleRenderedAfterMs,
    elapsedMs,
    state: sleeping.state,
    src: sleeping.src,
    alt: sleeping.alt,
    imageComplete: sleeping.complete,
    naturalWidth: sleeping.naturalWidth,
    naturalHeight: sleeping.naturalHeight,
    timerDiagnostics: completedTimerDiagnostics.filter((timer) => timer.delay === 60_000),
  };
}

function petImageSnapshot() {
  return cdp.evaluate(`(() => {
    const image = document.querySelector('#pet-image');
    return {
      state: document.querySelector('#app')?.dataset.state ?? '',
      src: image?.getAttribute('src') ?? '',
      alt: image?.getAttribute('alt') ?? '',
      complete: image?.complete === true,
      naturalWidth: image?.naturalWidth ?? 0,
      naturalHeight: image?.naturalHeight ?? 0,
    };
  })()`);
}

function assetSourceEndsWith(source, fileName) {
  const normalized = String(source ?? "").replaceAll("\\", "/").split(/[?#]/, 1)[0];
  return normalized.endsWith(`/pets/furry-ai-state/animations/${fileName}`);
}

function percentile(sorted, fraction) {
  assert(sorted.length > 0, "cannot calculate a percentile from no samples");
  return sorted[Math.ceil(sorted.length * fraction) - 1];
}

function formatMilliseconds(value) {
  return `${value.toFixed(2)} ms`;
}

function toJsonLine(event) {
  return `${JSON.stringify(event)}\n`;
}

function writeIpc(socket, payload) {
  assert(socket && !socket.destroyed && socket.writable, "controlled IPC client is not writable");
  socket.write(payload);
}

async function waitForCdp(read, predicate, timeoutMs, label) {
  return waitFor(async () => {
    const value = await read();
    return predicate(value) ? value : false;
  }, timeoutMs, label, 25);
}

async function waitFor(check, timeoutMs, label, intervalMs = 50) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const value = await check();
      if (value) return value;
    } catch (error) { lastError = error; }
    await delay(intervalMs);
  }
  throw new Error(`Timed out waiting for ${label}${lastError ? `: ${lastError.message}` : ""}`);
}

async function waitForCdpTarget(port, timeoutMs) {
  return waitFor(async () => {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(750) });
    if (!response.ok) return false;
    const targets = await response.json();
    return targets.find((target) => target.type === "page" && target.webSocketDebuggerUrl) ?? false;
  }, timeoutMs, "WebView2 CDP target", 100);
}

class BindingObservationCollector {
  constructor(client, bindingName) {
    this.bindingName = bindingName;
    this.pending = new Map();
    this.unsubscribe = client.on("Runtime.bindingCalled", (parameters) => {
      const receivedAt = performance.now();
      if (parameters.name !== this.bindingName) return;
      let payload;
      try {
        payload = JSON.parse(parameters.payload);
      } catch {
        return;
      }
      const waiter = this.pending.get(payload.marker);
      if (!waiter) return;
      this.pending.delete(payload.marker);
      clearTimeout(waiter.timer);
      waiter.resolve({ ...payload, receivedAt });
    });
  }

  waitFor(marker, timeoutMs) {
    assert(!this.pending.has(marker), `duplicate native observation waiter: ${marker}`);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(marker);
        reject(new Error(`Timed out waiting for native DOM observation: ${marker}`));
      }, timeoutMs);
      this.pending.set(marker, { resolve, reject, timer });
    });
  }

  close() {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    for (const [marker, waiter] of this.pending) {
      clearTimeout(waiter.timer);
      waiter.reject(new Error(`Native observation collector closed before ${marker}`));
    }
    this.pending.clear();
  }
}

class CdpClient {
  constructor(url) {
    this.url = url;
    this.sequence = 0;
    this.pending = new Map();
    this.listeners = new Map();
  }
  async connect() {
    this.socket = new WebSocket(this.url);
    this.socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if ("id" in message) {
        const pending = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) pending?.reject(new Error(message.error.message)); else pending?.resolve(message.result);
        return;
      }
      if (message.method) {
        for (const listener of this.listeners.get(message.method) ?? []) {
          listener(message.params ?? {});
        }
      }
    });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("CDP WebSocket connection timed out")), 5000);
      this.socket.addEventListener("open", () => { clearTimeout(timer); resolve(); }, { once: true });
      this.socket.addEventListener("error", () => { clearTimeout(timer); reject(new Error("CDP WebSocket failed")); }, { once: true });
    });
  }
  async evaluate(expression) {
    const result = await this.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) {
      const detail = result.exceptionDetails.exception?.description ?? result.exceptionDetails.text;
      throw new Error(detail ?? "CDP evaluation failed");
    }
    return result.result.value;
  }
  send(method, params) {
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  on(method, listener) {
    const listeners = this.listeners.get(method) ?? new Set();
    listeners.add(listener);
    this.listeners.set(method, listeners);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.listeners.delete(method);
    };
  }
  close() {
    this.listeners.clear();
    this.socket?.close();
  }
}

async function startControlledIpcServer(address) {
  const deadline = Date.now() + 5_000;
  let lastError;
  while (Date.now() < deadline) {
    try {
      return await listenControlledIpcServer(address);
    } catch (error) {
      lastError = error;
      await delay(50);
    }
  }
  throw new Error(`Could not start controlled IPC server: ${lastError?.message ?? "unknown error"}`);
}

async function listenControlledIpcServer(address) {
  const server = net.createServer();
  let client;
  let resolveClient;
  let rejectClient;
  let closing = false;
  const clientPromise = new Promise((resolve, reject) => {
    resolveClient = resolve;
    rejectClient = reject;
  });

  server.on("connection", (socket) => {
    if (client) {
      socket.destroy();
      return;
    }
    client = socket;
    socket.setNoDelay(true);
    socket.on("error", () => {});
    resolveClient(socket);
  });

  try {
    await new Promise((resolve, reject) => {
      const onError = (error) => {
        server.off("listening", onListening);
        reject(error);
      };
      const onListening = () => {
        server.off("error", onError);
        resolve();
      };
      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(address);
    });
  } catch (error) {
    server.removeAllListeners();
    throw error;
  }

  server.on("error", (error) => {
    if (!closing) rejectClient(error);
  });

  return {
    async waitForClient(timeoutMs) {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error(`Controlled IPC client did not connect in ${timeoutMs} ms`)),
          timeoutMs,
        );
        clientPromise.then(
          (socket) => {
            clearTimeout(timer);
            resolve(socket);
          },
          (error) => {
            clearTimeout(timer);
            reject(error);
          },
        );
      });
    },
    async close() {
      if (closing) return;
      closing = true;
      client?.destroy();
      if (server.listening) {
        await new Promise((resolve) => server.close(() => resolve()));
      }
    },
  };
}

async function reservePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => server.listen(0, "127.0.0.1", resolve).once("error", reject));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function waitForChildExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return { code: child.exitCode, signal: child.signalCode };
  }
  return Promise.race([
    new Promise((resolve) => child.once("exit", (code, signal) => resolve({ code, signal }))),
    delay(timeoutMs).then(() => { throw new Error(`PID ${child.pid} did not exit in ${timeoutMs} ms`); }),
  ]);
}

async function stopByTrackedPid(child, label) {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return true;
  if (exitedBeforeIdentityCapture.has(child)) return true;
  const expected = trackedProcessIdentities.get(child);
  if (!expected) {
    console.error(`WARN refusing to terminate ${label} PID ${child.pid} without captured process identity`);
    return false;
  }
  const current = queryProcessIdentity(child.pid);
  if (!current) return true;
  if (!sameProcessIdentity(current, expected)) {
    console.error(
      `WARN ${label} PID ${child.pid} was reused or changed identity; refusing to terminate the current process`,
    );
    return true;
  }
  spawnSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
  try {
    await waitFor(
      () => {
        const remaining = queryProcessIdentity(child.pid);
        return !remaining || !sameProcessIdentity(remaining, expected);
      },
      3_000,
      `${label} tracked process identity exit`,
      50,
    );
    return true;
  } catch {
    console.error(`WARN could not confirm ${label} PID ${child.pid} exit`);
    return false;
  }
}

function captureProcessIdentity(child, label, { allowMissing, expectedExecutablePath }) {
  assert(child?.pid, `${label} did not expose a process ID`);
  const script = [
    "$ErrorActionPreference = 'Stop'",
    "$process = Get-CimInstance Win32_Process -Filter ('ProcessId = ' + $env:NATIVE_SMOKE_PID)",
    "if ($null -eq $process) { exit 3 }",
    "[pscustomobject]@{",
    "  pid = [int]$process.ProcessId",
    "  executablePath = [string]$process.ExecutablePath",
    "  creationDate = $process.CreationDate.ToUniversalTime().ToString('O')",
    "} | ConvertTo-Json -Compress",
  ].join("\n");
  const result = spawnSync(
    "powershell.exe",
    ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
    {
      cwd: root,
      env: { ...process.env, NATIVE_SMOKE_PID: String(child.pid) },
      encoding: "utf8",
      windowsHide: true,
      timeout: 10_000,
    },
  );
  if (allowMissing && result.status === 3 && !result.stdout.trim()) return undefined;
  assert(
    result.status === 0 && result.stdout.trim(),
    `could not capture ${label} process identity: status=${result.status} ` +
      `error=${result.error?.message ?? "none"} stderr=${result.stderr.trim() || "empty"}`,
  );
  const identity = JSON.parse(result.stdout);
  assert(
    identity.pid === child.pid && identity.executablePath && identity.creationDate,
    `${label} returned an incomplete process identity`,
  );
  assert(
    path.resolve(identity.executablePath).toLowerCase() ===
      path.resolve(expectedExecutablePath).toLowerCase(),
    `${label} PID ${child.pid} executable identity changed before capture`,
  );
  return identity;
}

function expectedLaunchExecutablePath(command) {
  if (path.isAbsolute(command)) return path.resolve(command);
  if (String(command).toLowerCase() === "powershell.exe" && process.env.SystemRoot) {
    return path.join(
      process.env.SystemRoot,
      "System32",
      "WindowsPowerShell",
      "v1.0",
      "powershell.exe",
    );
  }
  fail(`cannot establish an exact executable identity for ${command}`);
}

function queryProcessIdentity(pid) {
  const script = [
    "$ErrorActionPreference = 'Stop'",
    "$process = Get-CimInstance Win32_Process -Filter ('ProcessId = ' + $env:NATIVE_SMOKE_PID)",
    "if ($null -ne $process) {",
    "  [pscustomobject]@{",
    "    pid = [int]$process.ProcessId",
    "    executablePath = [string]$process.ExecutablePath",
    "    creationDate = $process.CreationDate.ToUniversalTime().ToString('O')",
    "  } | ConvertTo-Json -Compress",
    "}",
  ].join("\n");
  const result = spawnSync(
    "powershell.exe",
    ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
    {
      cwd: root,
      env: { ...process.env, NATIVE_SMOKE_PID: String(pid) },
      encoding: "utf8",
      windowsHide: true,
      timeout: 5_000,
    },
  );
  assert(result.status === 0, `could not query tracked PID ${pid} safely`);
  if (!result.stdout.trim()) return undefined;
  const identity = JSON.parse(result.stdout);
  assert(
    identity.pid === pid && identity.executablePath && identity.creationDate,
    `tracked PID ${pid} returned an incomplete process identity`,
  );
  return identity;
}

function sameProcessIdentity(left, right) {
  return left?.pid === right?.pid &&
    String(left?.creationDate ?? "") === String(right?.creationDate ?? "") &&
    path.resolve(String(left?.executablePath ?? "")).toLowerCase() ===
      path.resolve(String(right?.executablePath ?? "")).toLowerCase();
}

function assertNoExistingSmokeExe() {
  const result = spawnSync("powershell.exe", ["-NoProfile", "-Command",
    "@(Get-CimInstance Win32_Process | Where-Object { $_.Name -ieq $env:SMOKE_EXE_NAME } | ForEach-Object { \"$($_.ProcessId):$($_.ExecutablePath)\" }) -join ';'"],
  { encoding: "utf8", windowsHide: true, env: { ...process.env, SMOKE_EXE_NAME: path.basename(exePath) } });
  if (result.status !== 0) fail("Could not verify existing smoke processes safely.");
  if (result.stdout.trim()) {
    fail(`An untracked ${path.basename(exePath)} process is already running (${result.stdout.trim()}); refusing to kill it or touch smoke data.`);
  }
}

function assertNoExistingSmokeAppData() {
  const existing = smokeAppDataPaths().filter((target) => existsSync(target));
  if (existing.length > 0) {
    fail(`Pre-existing smoke AppData requires manual review; refusing to remove it: ${existing.join(", ")}`);
  }
}

function assertPersistedApplicationSettings() {
  const settings = readPersistedApplicationSettings();
  assert(settings && typeof settings === "object", "Rust Store settings object is missing");
  assert(settings.scale === 1.25, `Persisted scale was ${settings.scale}, expected 1.25`);
  assert(settings.opacity === 0.8, `Persisted opacity was ${settings.opacity}, expected 0.8`);
  assert(
    settings.successBubbleDurationMs === 3_000,
    `Persisted successBubbleDurationMs was ${settings.successBubbleDurationMs}, expected 3000`,
  );
  assert(settings.showFilePath === true, "Persisted showFilePath was not true");
  assert(settings.alwaysOnTop === false, "Persisted alwaysOnTop was not false");
  assert(settings.onboardingVersion === 2, "Persisted onboardingVersion was not 2");
  assert(
    Object.keys(settings).length === 9,
    `Persisted settings schema has ${Object.keys(settings).length} keys, expected 9`,
  );
  for (const retiredKey of ["reduceMotion", "ipcEnabled", "ipcAddress"]) {
    assert(!(retiredKey in settings), `Retired settings key ${retiredKey} was persisted`);
  }
}

function cleanSmokeAppData() {
  for (const parent of [process.env.APPDATA, process.env.LOCALAPPDATA]) {
    if (!parent) continue;
    const resolvedParent = path.resolve(parent);
    const target = path.resolve(resolvedParent, identifier);
    if (path.dirname(target).toLowerCase() !== resolvedParent.toLowerCase() || path.basename(target) !== identifier) {
      fail(`Unsafe smoke data path: ${target}`);
    }
    rmSync(target, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
}

async function cleanSmokeAppDataSettled() {
  let stableChecks = 0;
  let lastError;
  for (let attempt = 1; attempt <= 20; attempt += 1) {
    try {
      cleanSmokeAppData();
      lastError = undefined;
    } catch (error) {
      lastError = error;
    }
    await delay(250);
    const remaining = smokeAppDataPaths().filter((target) => existsSync(target));
    stableChecks = remaining.length === 0 ? stableChecks + 1 : 0;
    if (stableChecks >= 3) return;
  }
  throw new Error(
    `Smoke AppData cleanup did not settle${lastError ? `: ${lastError.message}` : ""}`,
  );
}

function smokeAppDataPaths() {
  return [process.env.APPDATA, process.env.LOCALAPPDATA]
    .filter(Boolean)
    .map((parent) => path.resolve(parent, identifier));
}

async function cleanWorkspaceProfilesSettled() {
  for (const target of workspaceProfiles) {
    if (
      path.dirname(target) !== path.resolve(artifactRoot) ||
      !/^webview2-[a-z0-9-]+$/.test(path.basename(target))
    ) {
      fail(`Unsafe WebView2 profile path: ${target}`);
    }

    let stableChecks = 0;
    let lastError;
    for (let attempt = 1; attempt <= 20; attempt += 1) {
      try {
        rmSync(target, { recursive: true, force: true, maxRetries: 2, retryDelay: 100 });
        lastError = undefined;
      } catch (error) {
        lastError = error;
      }
      await delay(250);
      stableChecks = existsSync(target) ? 0 : stableChecks + 1;
      if (stableChecks >= 3) break;
    }
    if (existsSync(target)) {
      throw new Error(
        `WebView2 profile cleanup did not settle: ${target}` +
          (lastError ? ` (${lastError.code ?? lastError.message})` : ""),
      );
    }
  }
}

async function assertWindowStateVisibility(expectedVisibility, label) {
  if (!process.env.APPDATA) fail("APPDATA is unavailable for the Window State assertion.");
  const statePath = path.resolve(process.env.APPDATA, identifier, ".window-state.json");
  const expectedParent = path.resolve(process.env.APPDATA, identifier);
  if (path.dirname(statePath).toLowerCase() !== expectedParent.toLowerCase()) {
    fail(`Unsafe Window State path: ${statePath}`);
  }
  await waitFor(
    () => {
      if (!existsSync(statePath)) return false;
      const saved = JSON.parse(readFileSync(statePath, "utf8"));
      return saved?.main?.visible === expectedVisibility ? saved : false;
    },
    3_000,
    `${label} Window State main.visible=${expectedVisibility}`,
  );
  console.log(`PASS ${label} persisted main.visible=${expectedVisibility}`);
}

function runChecked(command, args) {
  const result = spawnSync(command, args, { cwd: root, env: process.env, stdio: "inherit", windowsHide: true });
  if (result.status !== 0) fail(`Build failed with exit code ${result.status}`);
}

function assert(condition, message) { if (!condition) throw new Error(message); }
function fail(message) { throw new Error(message); }
function delay(milliseconds) { return new Promise((resolve) => setTimeout(resolve, milliseconds)); }

await main();
