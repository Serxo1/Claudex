const path = require("node:path");
const fs = require("node:fs");

const { getWorkspaceDir } = require("./utils.cjs");
const { logError } = require("./logger.cjs");
const { SKIPPED_DIRS, IMAGE_EXTENSIONS, MAX_FILE_SIZE_BYTES } = require("./constants.cjs");

function normalizeAdditionalWorkspaceDirs(input) {
  const WORKSPACE_DIR = getWorkspaceDir();
  if (!Array.isArray(input)) {
    return [];
  }
  const normalizedMain = path.resolve(WORKSPACE_DIR);
  const unique = new Set();
  for (const value of input) {
    if (typeof value !== "string" || !value.trim()) {
      continue;
    }
    const absolute = path.resolve(value.trim());
    if (absolute === normalizedMain) {
      continue;
    }
    try {
      if (!fs.existsSync(absolute) || !fs.statSync(absolute).isDirectory()) {
        continue;
      }
      unique.add(absolute);
    } catch (error) {
      logError("workspace:normalizeAdditionalWorkspaceDirs", error);
      continue;
    }
  }
  return [...unique];
}

function getWorkspaceRoots(settings) {
  const WORKSPACE_DIR = getWorkspaceDir();
  const mainRoot = path.resolve(WORKSPACE_DIR);
  const extra = normalizeAdditionalWorkspaceDirs(settings?.workspaceDirs);
  return [mainRoot, ...extra];
}

function resolveWorkspaceFilePath(inputPath, settings) {
  const WORKSPACE_DIR = getWorkspaceDir();
  if (typeof inputPath !== "string" || !inputPath.trim()) {
    throw new Error("Invalid file path.");
  }
  const raw = inputPath.trim();
  const absolutePath = path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(WORKSPACE_DIR, raw);
  const normalized = path.resolve(absolutePath);
  const roots = getWorkspaceRoots(settings);
  const withinAnyRoot = roots.some((root) => {
    const normalizedRoot = path.resolve(root);
    return normalized === normalizedRoot || normalized.startsWith(`${normalizedRoot}${path.sep}`);
  });
  if (!withinAnyRoot) {
    throw new Error("File path must be inside configured workspace roots.");
  }
  return normalized;
}

function shouldSkipTreeEntry(name) {
  return SKIPPED_DIRS.includes(name);
}

function readWorkspaceFileTree(rootDir, options = {}) {
  const maxDepth = Number.isFinite(Number(options.maxDepth)) ? Math.max(1, Number(options.maxDepth)) : 5;
  const maxEntries = Number.isFinite(Number(options.maxEntries)) ? Math.max(100, Number(options.maxEntries)) : 2000;
  let entryCount = 0;
  let truncated = false;

  function walk(dir, depth) {
    if (depth > maxDepth || entryCount >= maxEntries) {
      truncated = true;
      return [];
    }

    let dirents = [];
    try {
      dirents = fs.readdirSync(dir, { withFileTypes: true });
    } catch (error) {
      logError("workspace:readWorkspaceFileTree", error);
      return [];
    }

    const sorted = dirents
      .filter((entry) => !shouldSkipTreeEntry(entry.name))
      .sort((a, b) => {
        if (a.isDirectory() && !b.isDirectory()) return -1;
        if (!a.isDirectory() && b.isDirectory()) return 1;
        return a.name.localeCompare(b.name);
      });

    const nodes = [];
    for (const entry of sorted) {
      if (entryCount >= maxEntries) {
        truncated = true;
        break;
      }
      const absolute = path.join(dir, entry.name);
      const relative = path.relative(rootDir, absolute) || entry.name;
      if (entry.isDirectory()) {
        entryCount += 1;
        nodes.push({
          path: relative,
          name: entry.name,
          type: "folder",
          children: walk(absolute, depth + 1)
        });
      } else if (entry.isFile()) {
        entryCount += 1;
        nodes.push({
          path: relative,
          name: entry.name,
          type: "file"
        });
      }
    }

    return nodes;
  }

  return {
    rootPath: rootDir,
    nodes: walk(rootDir, 1),
    truncated
  };
}

function toContextFilePayload(absolutePath) {
  const WORKSPACE_DIR = getWorkspaceDir();
  const relativePath = path.relative(WORKSPACE_DIR, absolutePath) || path.basename(absolutePath);
  let mediaType = "";
  let isImage = false;
  let previewDataUrl = "";
  const ext = path.extname(absolutePath).toLowerCase();
  if (IMAGE_EXTENSIONS.includes(ext)) {
    isImage = true;
    mediaType =
      ext === ".png"
        ? "image/png"
        : ext === ".gif"
          ? "image/gif"
          : ext === ".webp"
            ? "image/webp"
            : ext === ".bmp"
              ? "image/bmp"
              : "image/jpeg";
    try {
      const stat = fs.statSync(absolutePath);
      if (stat.size <= MAX_FILE_SIZE_BYTES) {
        const raw = fs.readFileSync(absolutePath);
        previewDataUrl = `data:${mediaType};base64,${raw.toString("base64")}`;
      }
    } catch (error) {
      logError("workspace:toContextFilePayload", error);
      previewDataUrl = "";
    }
  }

  return {
    canceled: false,
    absolutePath,
    relativePath,
    mediaType,
    isImage,
    previewDataUrl
  };
}

function extensionForMediaType(mediaType) {
  switch ((mediaType || "").toLowerCase()) {
    case "image/png":
      return ".png";
    case "image/jpeg":
      return ".jpg";
    case "image/webp":
      return ".webp";
    case "image/gif":
      return ".gif";
    case "image/bmp":
      return ".bmp";
    default:
      return ".bin";
  }
}

function sanitizeFileName(name) {
  if (typeof name !== "string" || !name.trim()) {
    return "pasted-image";
  }
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80) || "pasted-image";
}

function normalizeContextFiles(contextFiles) {
  if (!Array.isArray(contextFiles)) {
    return [];
  }

  return contextFiles
    .filter((item) => item && typeof item === "object")
    .map((item) => ({
      absolutePath: typeof item.absolutePath === "string" ? item.absolutePath.trim() : "",
      relativePath: typeof item.relativePath === "string" ? item.relativePath.trim() : "",
      mediaType: typeof item.mediaType === "string" ? item.mediaType.trim() : "",
      previewDataUrl: typeof item.previewDataUrl === "string" ? item.previewDataUrl.trim() : "",
      isImage: Boolean(item.isImage)
    }))
    .filter((item) => item.absolutePath);
}

function collectContextDirs(contextFiles) {
  const unique = new Set();
  for (const file of contextFiles) {
    const dir = path.dirname(file.absolutePath);
    if (!dir) {
      continue;
    }
    unique.add(dir);
  }
  return [...unique];
}

module.exports = {
  normalizeAdditionalWorkspaceDirs,
  getWorkspaceRoots,
  resolveWorkspaceFilePath,
  readWorkspaceFileTree,
  shouldSkipTreeEntry,
  toContextFilePayload,
  extensionForMediaType,
  sanitizeFileName,
  normalizeContextFiles,
  collectContextDirs
};
