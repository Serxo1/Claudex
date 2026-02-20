"use strict";

// ── IPC: Git ─────────────────────────────────────────────────────────────────

/**
 * @param {Electron.IpcMain} ipcMain
 * @param {{ git: any, runCommand: Function, isCommandAvailable: Function, WORKSPACE_DIR: string, PR_TIMEOUT_MS: number }} deps
 */
function register(ipcMain, { git, runCommand, isCommandAvailable, WORKSPACE_DIR, PR_TIMEOUT_MS }) {
  ipcMain.handle("git:getSummary", async (_event, cwd) => {
    return git.getGitSummary(typeof cwd === "string" && cwd ? cwd : undefined);
  });

  ipcMain.handle("git:getRecentCommits", async (_event, limit, cwd) => {
    return git.getRecentGitCommits(limit, typeof cwd === "string" && cwd ? cwd : undefined);
  });

  ipcMain.handle("git:initRepo", async (_event, cwd) => {
    const dir = (typeof cwd === "string" && cwd) ? cwd : WORKSPACE_DIR;
    const alreadyRepo = await git.isGitRepository(dir);
    if (alreadyRepo) {
      return git.getGitSummary(dir);
    }

    const initResult = await runCommand("git", ["init"], { cwd: dir });
    if (initResult.code !== 0) {
      throw new Error(initResult.stderr.trim() || initResult.stdout.trim() || "Unable to initialize git repository.");
    }

    return git.getGitSummary(dir);
  });

  ipcMain.handle("git:checkoutBranch", async (_event, branchName, cwd) => {
    if (typeof branchName !== "string" || !branchName.trim()) {
      throw new Error("Invalid branch name.");
    }
    const dir = (typeof cwd === "string" && cwd) ? cwd : WORKSPACE_DIR;

    const checkout = await runCommand("git", ["checkout", branchName.trim()], { cwd: dir });
    if (checkout.code !== 0) {
      throw new Error(checkout.stderr.trim() || checkout.stdout.trim() || "Unable to checkout branch.");
    }

    return git.getGitSummary(dir);
  });

  ipcMain.handle("git:commit", async (_event, message, cwd) => {
    if (typeof message !== "string" || !message.trim()) {
      throw new Error("Commit message cannot be empty.");
    }
    const dir = (typeof cwd === "string" && cwd) ? cwd : WORKSPACE_DIR;

    const addResult = await runCommand("git", ["add", "-A"], { cwd: dir });
    if (addResult.code !== 0) {
      throw new Error(addResult.stderr.trim() || "Unable to stage files.");
    }

    const commitResult = await runCommand("git", ["commit", "-m", message.trim()], { cwd: dir });
    if (commitResult.code !== 0) {
      const detail = commitResult.stderr.trim() || commitResult.stdout.trim();
      throw new Error(detail || "Commit failed.");
    }

    return {
      ok: true,
      output: commitResult.stdout.trim() || commitResult.stderr.trim(),
      summary: await git.getGitSummary(dir)
    };
  });

  ipcMain.handle("git:getHeadHash", async (_event, { cwd } = {}) => {
    return git.getHeadHash(typeof cwd === "string" && cwd ? cwd : undefined);
  });

  ipcMain.handle("git:getChangedFiles", async (_event, { since, cwd } = {}) => {
    return git.getChangedFiles(
      typeof since === "string" && since ? since : null,
      typeof cwd === "string" && cwd ? cwd : undefined
    );
  });

  ipcMain.handle("git:push", async (_event, cwd) => {
    const dir = (typeof cwd === "string" && cwd) ? cwd : WORKSPACE_DIR;
    const result = await runCommand("git", ["push"], { cwd: dir, timeoutMs: PR_TIMEOUT_MS });
    if (result.code !== 0) {
      throw new Error(result.stderr.trim() || result.stdout.trim() || "Push failed.");
    }
    return { ok: true, output: result.stderr.trim() || result.stdout.trim() || "Pushed." };
  });

  ipcMain.handle("git:pull", async (_event, cwd) => {
    const dir = (typeof cwd === "string" && cwd) ? cwd : WORKSPACE_DIR;
    const result = await runCommand("git", ["pull"], { cwd: dir, timeoutMs: PR_TIMEOUT_MS });
    if (result.code !== 0) {
      throw new Error(result.stderr.trim() || result.stdout.trim() || "Pull failed.");
    }
    return {
      ok: true,
      output: result.stdout.trim() || result.stderr.trim() || "Pulled.",
      summary: await git.getGitSummary(dir)
    };
  });

  ipcMain.handle("git:fetch", async (_event, cwd) => {
    const dir = (typeof cwd === "string" && cwd) ? cwd : WORKSPACE_DIR;
    const result = await runCommand("git", ["fetch", "--prune"], { cwd: dir, timeoutMs: PR_TIMEOUT_MS });
    if (result.code !== 0) {
      throw new Error(result.stderr.trim() || result.stdout.trim() || "Fetch failed.");
    }
    return { ok: true, output: result.stderr.trim() || result.stdout.trim() || "Fetched." };
  });

  ipcMain.handle("git:createPr", async (_event, payload = {}) => {
    const hasGh = await isCommandAvailable("gh");
    if (!hasGh) {
      throw new Error("GitHub CLI (gh) not found. Install it and run gh auth login.");
    }
    const dir = (typeof payload.cwd === "string" && payload.cwd) ? payload.cwd : WORKSPACE_DIR;

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
      cwd: dir,
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
