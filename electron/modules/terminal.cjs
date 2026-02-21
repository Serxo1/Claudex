const fs = require("node:fs");
const { spawn } = require("node:child_process");

const { getWorkspaceDir } = require("./utils.cjs");
const { logError, logWarn } = require("./logger.cjs");

let pty = null;
try {
  pty = require("node-pty");
} catch (error) {
  logWarn("terminal:init", `node-pty not available: ${error instanceof Error ? error.message : String(error)}`);
  pty = null;
}

const activeTerminalSessions = new Map();

function resolveTerminalShell() {
  if (process.platform === "win32") {
    return process.env.COMSPEC || "cmd.exe";
  }
  const candidates = [
    process.env.SHELL,
    "/bin/zsh",
    "/opt/homebrew/bin/zsh",
    "/usr/local/bin/zsh",
    "/bin/bash",
    "/bin/sh"
  ].filter((value) => typeof value === "string" && value.trim());

  for (const candidate of candidates) {
    const shellPath = candidate.trim();
    try {
      fs.accessSync(shellPath, fs.constants.X_OK);
      return shellPath;
    } catch (error) {
      logError("terminal:resolveTerminalShell", error);
      continue;
    }
  }

  return "/bin/sh";
}

function resolveTerminalCwd(appGetHomePath) {
  const WORKSPACE_DIR = getWorkspaceDir();
  try {
    // Exclude "/" — it's the default process.cwd() for GUI apps launched from
    // Finder/Launchpad and is not a meaningful workspace directory.
    if (
      WORKSPACE_DIR &&
      WORKSPACE_DIR !== "/" &&
      fs.existsSync(WORKSPACE_DIR) &&
      fs.statSync(WORKSPACE_DIR).isDirectory()
    ) {
      return WORKSPACE_DIR;
    }
  } catch (error) {
    logError("terminal:resolveTerminalCwd", error);
  }

  return appGetHomePath;
}

function buildTerminalEnv() {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === "string") {
      env[key] = value;
    }
  }
  env.TERM = env.TERM || "xterm-256color";
  return env;
}

function closeTerminalSession(sessionId) {
  const session = activeTerminalSessions.get(sessionId);
  if (!session) {
    return;
  }

  try {
    session.process.kill();
  } catch (error) {
    logError("terminal:closeTerminalSession", error);
  }
  activeTerminalSessions.delete(sessionId);
}

function spawnPipeShellSession(shell, cwd, env) {
  const args = process.platform === "win32" ? [] : ["-i"];
  const child = spawn(shell, args, {
    cwd,
    env,
    stdio: ["pipe", "pipe", "pipe"]
  });

  return {
    mode: "pipe",
    shell,
    process: {
      write(data) {
        if (!child.killed) {
          child.stdin.write(data);
        }
      },
      resize() {
        // no-op: stdio pipes do not expose PTY resize.
      },
      kill() {
        if (!child.killed) {
          child.kill();
        }
      },
      onData(callback) {
        child.stdout.on("data", (chunk) => callback(chunk.toString()));
        child.stderr.on("data", (chunk) => callback(chunk.toString()));
      },
      onExit(callback) {
        child.on("close", (exitCode) => {
          callback({ exitCode: exitCode ?? 0, signal: 0 });
        });
      }
    }
  };
}

function spawnPtyShellSession(shell, cwd, env, cols, rows) {
  if (!pty) {
    throw new Error("node-pty unavailable");
  }

  const ptyProcess = pty.spawn(shell, [], {
    name: "xterm-256color",
    cwd,
    env,
    cols,
    rows
  });

  return {
    mode: "pty",
    shell,
    process: ptyProcess
  };
}

module.exports = {
  activeTerminalSessions,
  resolveTerminalShell,
  resolveTerminalCwd,
  buildTerminalEnv,
  closeTerminalSession,
  spawnPipeShellSession,
  spawnPtyShellSession
};
