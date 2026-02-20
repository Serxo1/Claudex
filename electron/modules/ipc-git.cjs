"use strict";

// ── IPC: Git ─────────────────────────────────────────────────────────────────

/**
 * @param {Electron.IpcMain} ipcMain
 * @param {{ git: any, runCommand: Function, isCommandAvailable: Function, WORKSPACE_DIR: string, PR_TIMEOUT_MS: number }} deps
 */
function register(ipcMain, { git, runCommand, isCommandAvailable, WORKSPACE_DIR, PR_TIMEOUT_MS }) {
  ipcMain.handle("git:getSummary", async () => {
    return git.getGitSummary();
  });

  ipcMain.handle("git:getRecentCommits", async (_event, limit) => {
    return git.getRecentGitCommits(limit);
  });

  ipcMain.handle("git:initRepo", async () => {
    const alreadyRepo = await git.isGitRepository();
    if (alreadyRepo) {
      return git.getGitSummary();
    }

    const initResult = await runCommand("git", ["init"], { cwd: WORKSPACE_DIR });
    if (initResult.code !== 0) {
      throw new Error(initResult.stderr.trim() || initResult.stdout.trim() || "Unable to initialize git repository.");
    }

    return git.getGitSummary();
  });

  ipcMain.handle("git:checkoutBranch", async (_event, branchName) => {
    if (typeof branchName !== "string" || !branchName.trim()) {
      throw new Error("Invalid branch name.");
    }

    const checkout = await runCommand("git", ["checkout", branchName.trim()], {
      cwd: WORKSPACE_DIR
    });
    if (checkout.code !== 0) {
      throw new Error(checkout.stderr.trim() || checkout.stdout.trim() || "Unable to checkout branch.");
    }

    return git.getGitSummary();
  });

  ipcMain.handle("git:commit", async (_event, message) => {
    if (typeof message !== "string" || !message.trim()) {
      throw new Error("Commit message cannot be empty.");
    }

    const addResult = await runCommand("git", ["add", "-A"], { cwd: WORKSPACE_DIR });
    if (addResult.code !== 0) {
      throw new Error(addResult.stderr.trim() || "Unable to stage files.");
    }

    const commitResult = await runCommand("git", ["commit", "-m", message.trim()], {
      cwd: WORKSPACE_DIR
    });
    if (commitResult.code !== 0) {
      const detail = commitResult.stderr.trim() || commitResult.stdout.trim();
      throw new Error(detail || "Commit failed.");
    }

    return {
      ok: true,
      output: commitResult.stdout.trim() || commitResult.stderr.trim(),
      summary: await git.getGitSummary()
    };
  });

  ipcMain.handle("git:createPr", async (_event, payload = {}) => {
    const hasGh = await isCommandAvailable("gh");
    if (!hasGh) {
      throw new Error("GitHub CLI (gh) not found. Install it and run gh auth login.");
    }

    const args = ["pr", "create", "--fill"];
    if (typeof payload.title === "string" && payload.title.trim()) {
      args.push("--title", payload.title.trim());
    }
    if (typeof payload.body === "string" && payload.body.trim()) {
      args.push("--body", payload.body.trim());
    }
    if (typeof payload.base === "string" && payload.base.trim()) {
      args.push("--base", payload.base.trim());
    }

    const prResult = await runCommand("gh", args, {
      cwd: WORKSPACE_DIR,
      timeoutMs: PR_TIMEOUT_MS
    });
    if (prResult.code !== 0) {
      const detail = prResult.stderr.trim() || prResult.stdout.trim();
      throw new Error(detail || "Unable to create pull request.");
    }

    return {
      ok: true,
      output: prResult.stdout.trim() || "Pull request created."
    };
  });
}

module.exports = { register };
