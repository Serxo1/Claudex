const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { nativeImage } = require("electron");
const os = require("node:os");

const { isCommandAvailable, getWorkspaceDir } = require("./utils.cjs");

// For macOS .app bundles, define the app name so we can locate the icon and optionally the CLI.
const IDE_CANDIDATES = [
  {
    id: "cursor",
    label: "Cursor",
    command: "cursor",
    windowsAppPath: path.join(os.homedir(), "AppData", "Local", "Programs", "cursor", "Cursor.exe")
  },
  {
    id: "vscode",
    label: "VS Code",
    command: "code",
    windowsAppPath: path.join(os.homedir(), "AppData", "Local", "Programs", "Microsoft VS Code", "Code.exe")
  },
  { id: "windsurf", label: "Windsurf", command: "windsurf" },
  { id: "zed", label: "Zed", command: "zed" },
  { id: "webstorm", label: "WebStorm", command: "webstorm" },
  {
    id: "antigravity",
    label: "Antigravity",
    // CLI lives inside the bundle; fall back to `open -a` if not found
    macOsApp: "Antigravity",
    bundleCliPath: "/Applications/Antigravity.app/Contents/Resources/app/bin/antigravity",
    // Windows support:
    windowsAppPath: path.join(os.homedir(), "AppData", "Local", "Programs", "Antigravity", "Antigravity.exe")
  }
];

function getAppIconDataUrl(appName) {
  try {
    const icnsPath = `/Applications/${appName}.app/Contents/Resources/${appName}.icns`;
    if (!fs.existsSync(icnsPath)) return null;
    const img = nativeImage.createFromPath(icnsPath);
    if (img.isEmpty()) return null;
    // Resize to 32x32 for UI use
    return img.resize({ width: 32, height: 32 }).toDataURL();
  } catch {
    return null;
  }
}

async function isMacOsAppAvailable(appName) {
  return fs.existsSync(`/Applications/${appName}.app`);
}

async function listAvailableIdes() {
  const available = [];
  for (const candidate of IDE_CANDIDATES) {
    let ok = false;

    if (process.platform === "win32") {
      // 1. Try specific path if defined
      if (candidate.windowsAppPath && fs.existsSync(candidate.windowsAppPath)) {
        ok = true;
      }
      // 2. Try command if not found yet
      if (!ok && candidate.command) {
        // eslint-disable-next-line no-await-in-loop
        ok = await isCommandAvailable(candidate.command);
      }
    } else if (process.platform === "darwin") {
      // 1. Try .app bundle
      if (candidate.macOsApp) {
        // eslint-disable-next-line no-await-in-loop
        if (await isMacOsAppAvailable(candidate.macOsApp)) ok = true;
      }
      // 2. Try command
      if (!ok && candidate.command) {
        // eslint-disable-next-line no-await-in-loop
        ok = await isCommandAvailable(candidate.command);
      }
    } else {
      // Linux/Other: rely on command
      if (candidate.command) {
        // eslint-disable-next-line no-await-in-loop
        ok = await isCommandAvailable(candidate.command);
      }
    }

    if (ok) {
      const entry = { id: candidate.id, label: candidate.label };
      if (candidate.macOsApp) {
        entry.iconDataUrl = getAppIconDataUrl(candidate.macOsApp);
      }
      available.push(entry);
    }
  }
  return available;
}

function launchIde(candidate, workspaceDir) {
  const WORKSPACE_DIR = workspaceDir || getWorkspaceDir();

  // Resolve the original candidate definition to get macOsApp / bundleCliPath
  const def = IDE_CANDIDATES.find((c) => c.id === candidate.id) || candidate;

  if (process.platform === "win32" && def.windowsAppPath && fs.existsSync(def.windowsAppPath)) {
    const child = spawn(def.windowsAppPath, [WORKSPACE_DIR], {
      cwd: WORKSPACE_DIR,
      stdio: "ignore",
      detached: true
    });
    child.unref();
    return;
  }

  if (def.bundleCliPath && fs.existsSync(def.bundleCliPath)) {
    // Use the CLI inside the bundle if available
    const child = spawn(def.bundleCliPath, [WORKSPACE_DIR], {
      cwd: WORKSPACE_DIR,
      stdio: "ignore",
      detached: true
    });
    child.unref();
    return;
  }

  if (def.macOsApp) {
    // Fall back to `open -a AppName /path`
    const child = spawn("open", ["-a", def.macOsApp, WORKSPACE_DIR], {
      cwd: WORKSPACE_DIR,
      stdio: "ignore",
      detached: true
    });
    child.unref();
    return;
  }

  const child = spawn(def.command || candidate.id, [WORKSPACE_DIR], {
    cwd: WORKSPACE_DIR,
    stdio: "ignore",
    detached: true
  });
  child.unref();
}

module.exports = {
  IDE_CANDIDATES,
  listAvailableIdes,
  launchIde
};
