const { spawn } = require("node:child_process");

const { COMMAND_TIMEOUT_MS, CLI_TEST_TIMEOUT_MS } = require("./constants.cjs");

let WORKSPACE_DIR = process.cwd();

function setWorkspaceDir(dir) {
  WORKSPACE_DIR = dir;
}

function getWorkspaceDir() {
  return WORKSPACE_DIR;
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd || WORKSPACE_DIR,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
      shell: false
    });

    let stdout = "";
    let stderr = "";
    let killedByTimeout = false;
    const timeoutMs = typeof options.timeoutMs === "number" ? options.timeoutMs : COMMAND_TIMEOUT_MS;

    const timeout = setTimeout(() => {
      killedByTimeout = true;
      child.kill("SIGTERM");
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      clearTimeout(timeout);
      resolve({
        code: 1,
        stdout,
        stderr: `${stderr}\n${error.message}`.trim(),
        timedOut: false
      });
    });

    child.on("close", (code) => {
      clearTimeout(timeout);
      resolve({
        code: killedByTimeout ? 124 : code ?? 1,
        stdout,
        stderr,
        timedOut: killedByTimeout
      });
    });
  });
}

async function isCommandAvailable(command) {
  const result = await runCommand("which", [command], { timeoutMs: CLI_TEST_TIMEOUT_MS });
  return result.code === 0 && Boolean(result.stdout.trim());
}

module.exports = {
  setWorkspaceDir,
  getWorkspaceDir,
  runCommand,
  isCommandAvailable
};
