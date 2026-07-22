import { randomUUID } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

export function acquireSmokeDirectoryLock({ lockDir, runId, scope, metadata = {} }) {
  const resolvedLockDir = path.resolve(lockDir);
  const parent = path.dirname(resolvedLockDir);
  mkdirSync(parent, { recursive: true });
  assertNormalDirectory(parent, `${scope} lock parent`);

  try {
    mkdirSync(resolvedLockDir, { recursive: false });
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    let owner = "unreadable owner metadata";
    try {
      assertNormalDirectory(resolvedLockDir, `existing ${scope} lock`);
      const ownerPath = path.join(resolvedLockDir, "owner.json");
      assertNormalFile(ownerPath, `existing ${scope} lock owner`);
      owner = readFileSync(ownerPath, "utf8").trim();
    } catch {
      // Never mutate or auto-recover a lock with unknown ownership.
    }
    throw new Error(`Another ${scope} run holds the desktop interaction lock: ${owner}`);
  }

  const ownerPath = path.join(resolvedLockDir, "owner.json");
  const owner = {
    scope,
    runId,
    pid: process.pid,
    token: randomUUID(),
    acquiredAt: new Date().toISOString(),
    ...metadata,
  };
  try {
    writeFileSync(ownerPath, `${JSON.stringify(owner, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
    });
  } catch (error) {
    rmdirSync(resolvedLockDir);
    throw error;
  }

  return { lockDir: resolvedLockDir, ownerPath, owner };
}

export function verifySmokeDirectoryLock({
  lockDir,
  scope,
  runId,
  pid,
  token,
}) {
  const resolvedLockDir = path.resolve(lockDir);
  assertNormalDirectory(resolvedLockDir, `${scope} delegated lock`);

  const ownerPath = path.join(resolvedLockDir, "owner.json");
  assertNormalFile(ownerPath, `${scope} delegated lock owner`);
  const entries = readdirSync(resolvedLockDir, { withFileTypes: true });
  if (
    entries.length !== 1 ||
    !entries[0].isFile() ||
    entries[0].isSymbolicLink() ||
    entries[0].name !== "owner.json"
  ) {
    throw new Error(`${scope} delegated lock contains unexpected entries.`);
  }

  const owner = JSON.parse(readFileSync(ownerPath, "utf8"));
  if (
    owner.scope !== scope ||
    owner.runId !== runId ||
    owner.pid !== pid ||
    owner.token !== token
  ) {
    throw new Error(
      `${scope} delegated desktop interaction lock ownership does not match.`,
    );
  }

  return { lockDir: resolvedLockDir, ownerPath, owner };
}

export function releaseSmokeDirectoryLock(lock) {
  if (!lock) return;
  assertNormalDirectory(lock.lockDir, `${lock.owner.scope} owned lock`);
  assertNormalFile(lock.ownerPath, `${lock.owner.scope} owned lock owner`);
  const entries = readdirSync(lock.lockDir, { withFileTypes: true });
  if (
    entries.length !== 1 ||
    !entries[0].isFile() ||
    entries[0].isSymbolicLink() ||
    entries[0].name !== path.basename(lock.ownerPath)
  ) {
    throw new Error(`${lock.owner.scope} owned lock contains unexpected entries.`);
  }

  const currentOwner = JSON.parse(readFileSync(lock.ownerPath, "utf8"));
  if (
    currentOwner.scope !== lock.owner.scope ||
    currentOwner.runId !== lock.owner.runId ||
    currentOwner.pid !== lock.owner.pid ||
    currentOwner.token !== lock.owner.token
  ) {
    throw new Error(`${lock.owner.scope} desktop interaction lock ownership changed.`);
  }
  rmSync(lock.ownerPath, { force: false });
  rmdirSync(lock.lockDir);
}

function assertNormalDirectory(target, label) {
  if (!existsSync(target)) throw new Error(`${label} is missing: ${target}`);
  const stats = lstatSync(target);
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new Error(`${label} is not a normal directory: ${target}`);
  }
}

function assertNormalFile(target, label) {
  if (!existsSync(target)) throw new Error(`${label} is missing: ${target}`);
  const stats = lstatSync(target);
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw new Error(`${label} is not a normal file: ${target}`);
  }
}
