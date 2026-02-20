const fs = require("node:fs");
const path = require("node:path");
const { runCommand, getWorkspaceDir } = require("./utils.cjs");
const { GIT_TIMEOUT_MS } = require("./constants.cjs");

function parseNumStat(output) {
  let additions = 0;
  let deletions = 0;

  const lines = output.split("\n").map((line) => line.trim()).filter(Boolean);
  for (const line of lines) {
    const [added, removed] = line.split("\t");
    const addCount = Number.isFinite(Number(added)) ? Number(added) : 0;
    const removeCount = Number.isFinite(Number(removed)) ? Number(removed) : 0;
    additions += addCount;
    deletions += removeCount;
  }

  return { additions, deletions };
}

async function isGitRepository(cwd) {
  const WORKSPACE_DIR = cwd || getWorkspaceDir();
  const result = await runCommand("git", ["rev-parse", "--is-inside-work-tree"], {
    cwd: WORKSPACE_DIR,
    timeoutMs: GIT_TIMEOUT_MS
  });
  return result.code === 0 && result.stdout.trim() === "true";
}

async function getGitSummary(cwd) {
  const WORKSPACE_DIR = cwd || getWorkspaceDir();
  const repo = await isGitRepository(WORKSPACE_DIR);
  if (!repo) {
    return {
      isRepo: false,
      branch: "",
      branches: [],
      additions: 0,
      deletions: 0
    };
  }

  const [branchResult, branchesResult, diffResult, diffCachedResult, untrackedResult] = await Promise.all([
    runCommand("git", ["branch", "--show-current"], { cwd: WORKSPACE_DIR }),
    runCommand("git", ["for-each-ref", "--format=%(refname:short)", "refs/heads"], {
      cwd: WORKSPACE_DIR
    }),
    runCommand("git", ["diff", "--numstat"], { cwd: WORKSPACE_DIR }),
    runCommand("git", ["diff", "--cached", "--numstat"], { cwd: WORKSPACE_DIR }),
    runCommand("git", ["ls-files", "--others", "--exclude-standard"], { cwd: WORKSPACE_DIR })
  ]);

  const diff = parseNumStat(diffResult.stdout);
  const stagedDiff = parseNumStat(diffCachedResult.stdout);

  // Count lines in untracked files (new files not yet staged)
  let untrackedAdditions = 0;
  const untrackedFiles = untrackedResult.code === 0
    ? untrackedResult.stdout.split("\n").map((f) => f.trim()).filter(Boolean)
    : [];
  const MAX_UNTRACKED_SIZE = 512 * 1024; // skip files > 512 KB
  for (const relFile of untrackedFiles.slice(0, 200)) {
    try {
      const abs = path.resolve(WORKSPACE_DIR, relFile);
      const stat = fs.statSync(abs);
      if (!stat.isFile() || stat.size > MAX_UNTRACKED_SIZE) continue;
      const content = fs.readFileSync(abs, "utf8");
      untrackedAdditions += content.split("\n").length;
    } catch {
      // skip binary or unreadable files
    }
  }

  return {
    isRepo: true,
    branch: branchResult.stdout.trim(),
    branches: branchesResult.stdout
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean),
    additions: diff.additions + stagedDiff.additions + untrackedAdditions,
    deletions: diff.deletions + stagedDiff.deletions
  };
}

function mapGitStatus(code) {
  const value = (code || "").toUpperCase();
  if (value === "A") return "added";
  if (value === "D") return "deleted";
  if (value === "R") return "renamed";
  return "modified";
}

function parseGitCommitFiles(raw) {
  const map = new Map();
  const lines = raw.split("\n").map((line) => line.trim()).filter(Boolean);
  for (const line of lines) {
    const parts = line.split("\t");
    if (parts.length >= 2 && /^[ADMRTCU]/i.test(parts[0])) {
      const status = mapGitStatus(parts[0][0]);
      const filePath = parts[parts.length - 1];
      const existing = map.get(filePath) || { path: filePath, status, additions: 0, deletions: 0 };
      existing.status = status;
      map.set(filePath, existing);
      continue;
    }

    if (parts.length >= 3) {
      const addCount = Number.isFinite(Number(parts[0])) ? Number(parts[0]) : 0;
      const delCount = Number.isFinite(Number(parts[1])) ? Number(parts[1]) : 0;
      const filePath = parts[2];
      const existing = map.get(filePath) || { path: filePath, status: "modified", additions: 0, deletions: 0 };
      existing.additions = addCount;
      existing.deletions = delCount;
      map.set(filePath, existing);
    }
  }

  return [...map.values()];
}

async function getRecentGitCommits(limit = 6, cwd) {
  const WORKSPACE_DIR = cwd || getWorkspaceDir();
  const safeLimit = Number.isFinite(Number(limit)) ? Math.max(1, Math.min(20, Number(limit))) : 6;
  const repo = await isGitRepository(WORKSPACE_DIR);
  if (!repo) {
    return [];
  }

  const logResult = await runCommand(
    "git",
    [
      "log",
      `-n${safeLimit}`,
      "--date=iso-strict",
      "--pretty=format:%H%x1f%h%x1f%an%x1f%ad%x1f%s%x1e"
    ],
    { cwd: WORKSPACE_DIR }
  );
  if (logResult.code !== 0) {
    return [];
  }

  const records = logResult.stdout
    .split("\x1e")
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => {
      const [hash, shortHash, author, dateIso, message] = chunk.split("\x1f");
      return { hash, shortHash, author, dateIso, message };
    })
    .filter((entry) => entry.hash && entry.shortHash);

  const commits = [];
  for (const entry of records) {
    // eslint-disable-next-line no-await-in-loop
    const filesResult = await runCommand(
      "git",
      ["show", "--pretty=format:", "--name-status", "--numstat", entry.hash],
      { cwd: WORKSPACE_DIR }
    );
    const files = filesResult.code === 0 ? parseGitCommitFiles(filesResult.stdout) : [];
    commits.push({
      hash: entry.hash,
      shortHash: entry.shortHash,
      message: entry.message || "Commit",
      author: entry.author || "Unknown",
      dateIso: entry.dateIso || new Date().toISOString(),
      files
    });
  }

  return commits;
}

async function getHeadHash(cwd) {
  const WORKSPACE_DIR = cwd || getWorkspaceDir();
  const repo = await isGitRepository(WORKSPACE_DIR);
  if (!repo) return null;
  const result = await runCommand("git", ["rev-parse", "HEAD"], { cwd: WORKSPACE_DIR, timeoutMs: GIT_TIMEOUT_MS });
  return result.code === 0 ? result.stdout.trim() : null;
}

function statusFromCode(code) {
  const c = (code || "").toUpperCase();
  if (c === "A") return "added";
  if (c === "D") return "deleted";
  if (c === "R") return "renamed";
  if (c === "?" || c === "!") return "untracked";
  return "modified";
}

/**
 * Returns list of changed files with status.
 * If since is null/undefined, returns all dirty files (tracked changes + untracked).
 * Returns: { path: string, status: string, staged: boolean }[]
 */
async function getChangedFiles(since, cwd) {
  const WORKSPACE_DIR = cwd || getWorkspaceDir();
  const repo = await isGitRepository(WORKSPACE_DIR);
  if (!repo) return [];

  if (since) {
    // Files changed since the recorded commit — use --name-status for status codes
    const result = await runCommand("git", ["diff", "--name-status", since, "HEAD"], { cwd: WORKSPACE_DIR, timeoutMs: GIT_TIMEOUT_MS });
    if (result.code !== 0) return [];
    return result.stdout
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .map((line) => {
        const parts = line.split("\t");
        const status = statusFromCode(parts[0]?.[0]);
        const filePath = parts[parts.length - 1] || "";
        return { path: filePath, status, staged: false };
      })
      .filter((f) => f.path);
  }

  // All dirty files: git status --porcelain for full picture
  const result = await runCommand("git", ["status", "--porcelain"], { cwd: WORKSPACE_DIR, timeoutMs: GIT_TIMEOUT_MS });
  if (result.code !== 0) return [];

  const files = [];
  for (const line of result.stdout.split("\n")) {
    if (!line || line.length < 4) continue;
    const X = line[0]; // index (staging area) status
    const Y = line[1]; // working tree status
    let name = line.slice(3);
    const arrow = name.indexOf(" -> ");
    if (arrow !== -1) name = name.slice(arrow + 4);
    name = name.trim();
    if (!name) continue;

    if (X === "?") {
      // Untracked file
      files.push({ path: name, status: "untracked", staged: false });
    } else {
      // Staged change (X is not space/?)
      if (X !== " " && X !== "?") {
        files.push({ path: name, status: statusFromCode(X), staged: true });
      }
      // Unstaged working-tree change (Y is not space)
      if (Y !== " " && Y !== "?") {
        // Avoid duplicate if already added as staged with same path
        const alreadyHasUnstaged = files.some((f) => f.path === name && !f.staged);
        if (!alreadyHasUnstaged) {
          files.push({ path: name, status: statusFromCode(Y), staged: false });
        }
      }
    }
  }
  return files;
}

module.exports = {
  parseNumStat,
  isGitRepository,
  getGitSummary,
  mapGitStatus,
  parseGitCommitFiles,
  getRecentGitCommits,
  getHeadHash,
  getChangedFiles
};
