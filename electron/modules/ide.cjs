const { spawn } = require("node:child_process");

const { isCommandAvailable, getWorkspaceDir } = require("./utils.cjs");

const IDE_CANDIDATES = [
  { id: "cursor", label: "Cursor", command: "cursor", icon: "cursor" },
  { id: "vscode", label: "VS Code", command: "code", icon: "vscode" },
  { id: "windsurf", label: "Windsurf", command: "windsurf", icon: "windsurf" },
  { id: "zed", label: "Zed", command: "zed", icon: "zed" },
  { id: "webstorm", label: "WebStorm", command: "webstorm", icon: "jetbrains" }
];

async function listAvailableIdes() {
  const available = [];
  for (const candidate of IDE_CANDIDATES) {
    // eslint-disable-next-line no-await-in-loop
    const ok = await isCommandAvailable(candidate.command);
    if (ok) {
      available.push(candidate);
    }
  }
  return available;
}

function launchIde(command) {
  const WORKSPACE_DIR = getWorkspaceDir();
  const child = spawn(command, [WORKSPACE_DIR], {
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
