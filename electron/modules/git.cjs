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

async function isGitRepository() {
  const WORKSPACE_DIR = getWorkspaceDir();
  const result = await runCommand("git", ["rev-parse", "--is-inside-work-tree"], {
    cwd: WORKSPACE_DIR,
    timeoutMs: GIT_TIMEOUT_MS
  });
  return result.code === 0 && result.stdout.trim() === "true";
}

async function getGitSummary() {
  const WORKSPACE_DIR = getWorkspaceDir();
  const repo = await isGitRepository();
  if (!repo) {
    return {
      isRepo: false,
      branch: "",
      branches: [],
      additions: 0,
      deletions: 0
    };
  }

  const [branchResult, branchesResult, diffResult, diffCachedResult] = await Promise.all([
    runCommand("git", ["branch", "--show-current"], { cwd: WORKSPACE_DIR }),
    runCommand("git", ["for-each-ref", "--format=%(refname:short)", "refs/heads"], {
      cwd: WORKSPACE_DIR
    }),
    runCommand("git", ["diff", "--numstat"], { cwd: WORKSPACE_DIR }),
    runCommand("git", ["diff", "--cached", "--numstat"], { cwd: WORKSPACE_DIR })
  ]);

  const diff = parseNumStat(diffResult.stdout);
  const stagedDiff = parseNumStat(diffCachedResult.stdout);

  return {
    isRepo: true,
    branch: branchResult.stdout.trim(),
    branches: branchesResult.stdout
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean),
    additions: diff.additions + stagedDiff.additions,
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

async function getRecentGitCommits(limit = 6) {
  const WORKSPACE_DIR = getWorkspaceDir();
  const safeLimit = Number.isFinite(Number(limit)) ? Math.max(1, Math.min(20, Number(limit))) : 6;
  const repo = await isGitRepository();
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

module.exports = {
  parseNumStat,
  isGitRepository,
  getGitSummary,
  mapGitStatus,
  parseGitCommitFiles,
  getRecentGitCommits
};
