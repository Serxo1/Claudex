"use strict";

// ── IPC: Workspace & IDE ─────────────────────────────────────────────────────

/**
 * @param {Electron.IpcMain} ipcMain
 * @param {{ settings: any, workspace: any, skills: any, ide: any, dialog: any, app: any, fs: any, path: any, WORKSPACE_DIR: string, TEMP_PASTE_DIR: string, MAX_EDITOR_FILE_SIZE: number, randomUUID: () => string }} deps
 */
function register(ipcMain, { settings, workspace, skills, ide, dialog, app, fs, path, WORKSPACE_DIR, TEMP_PASTE_DIR, MAX_EDITOR_FILE_SIZE, randomUUID }) {
  // ── Workspace ──────────────────────────────────────────────────────────

  ipcMain.handle("workspace:getInfo", async () => {
    const current = settings.readSettings();
    const roots = workspace.getWorkspaceRoots(current);
    return {
      path: WORKSPACE_DIR,
      name: path.basename(WORKSPACE_DIR),
      roots
    };
  });

  ipcMain.handle("workspace:getFileTree", async (_event, payload = {}) => {
    return workspace.readWorkspaceFileTree(WORKSPACE_DIR, payload);
  });

  ipcMain.handle("workspace:getFileTrees", async (_event, payload = {}) => {
    const current = settings.readSettings();
    const roots = workspace.getWorkspaceRoots(current);
    return roots.map((rootPath) => {
      const tree = workspace.readWorkspaceFileTree(rootPath, payload);
      return {
        rootPath,
        rootName: path.basename(rootPath),
        nodes: tree.nodes,
        truncated: tree.truncated
      };
    });
  });

  ipcMain.handle("workspace:addDirectory", async () => {
    const current = settings.readSettings();
    const result = await dialog.showOpenDialog({
      defaultPath: WORKSPACE_DIR,
      properties: ["openDirectory"]
    });
    if (result.canceled || result.filePaths.length === 0) {
      return { ok: false, dirs: workspace.normalizeAdditionalWorkspaceDirs(current.workspaceDirs) };
    }
    const picked = path.resolve(result.filePaths[0]);
    const nextDirs = workspace.normalizeAdditionalWorkspaceDirs([...(current.workspaceDirs || []), picked]);
    settings.writeSettings({ ...current, workspaceDirs: nextDirs });
    return { ok: true, path: picked, dirs: nextDirs };
  });

  ipcMain.handle("workspace:pickDirectory", async () => {
    const result = await dialog.showOpenDialog({
      defaultPath: WORKSPACE_DIR,
      properties: ["openDirectory"]
    });
    if (result.canceled || result.filePaths.length === 0) return { ok: false, path: null };
    return { ok: true, path: path.resolve(result.filePaths[0]) };
  });

  ipcMain.handle("workspace:removeDirectory", async (_event, dirPath) => {
    const current = settings.readSettings();
    const toRemove = typeof dirPath === "string" ? path.resolve(dirPath) : "";
    const nextDirs = workspace.normalizeAdditionalWorkspaceDirs(current.workspaceDirs).filter((dir) => dir !== toRemove);
    settings.writeSettings({ ...current, workspaceDirs: nextDirs });
    return { ok: true, dirs: nextDirs };
  });

  ipcMain.handle("workspace:pickContextFile", async () => {
    const result = await dialog.showOpenDialog({
      defaultPath: WORKSPACE_DIR,
      properties: ["openFile"]
    });

    if (result.canceled || result.filePaths.length === 0) {
      return { canceled: true };
    }

    const absolutePath = result.filePaths[0];
    return workspace.toContextFilePayload(absolutePath);
  });

  ipcMain.handle("workspace:resolveContextFile", async (_event, relativePath) => {
    const current = settings.readSettings();
    const normalizedAbsolute = workspace.resolveWorkspaceFilePath(relativePath, current);
    if (!fs.existsSync(normalizedAbsolute)) {
      throw new Error("File does not exist.");
    }
    const stat = fs.statSync(normalizedAbsolute);
    if (!stat.isFile()) {
      throw new Error("Path is not a file.");
    }
    return workspace.toContextFilePayload(normalizedAbsolute);
  });

  ipcMain.handle("workspace:readFile", async (_event, filePath) => {
    const current = settings.readSettings();
    const absolutePath = workspace.resolveWorkspaceFilePath(filePath, current);
    if (!fs.existsSync(absolutePath)) {
      throw new Error("File does not exist.");
    }
    const stat = fs.statSync(absolutePath);
    if (!stat.isFile()) {
      throw new Error("Path is not a file.");
    }
    if (stat.size > MAX_EDITOR_FILE_SIZE) {
      throw new Error("File too large to open in editor.");
    }
    const buffer = fs.readFileSync(absolutePath);
    if (buffer.includes(0)) {
      throw new Error("Binary files are not supported in this editor.");
    }
    const content = buffer.toString("utf8");
    return {
      absolutePath,
      relativePath: path.relative(WORKSPACE_DIR, absolutePath) || path.basename(absolutePath),
      content
    };
  });

  ipcMain.handle("workspace:writeFile", async (_event, payload = {}) => {
    const current = settings.readSettings();
    const filePath = typeof payload.filePath === "string" ? payload.filePath : "";
    const content = typeof payload.content === "string" ? payload.content : "";
    const absolutePath = workspace.resolveWorkspaceFilePath(filePath, current);
    if (!fs.existsSync(absolutePath)) {
      throw new Error("File does not exist.");
    }
    const stat = fs.statSync(absolutePath);
    if (!stat.isFile()) {
      throw new Error("Path is not a file.");
    }
    fs.writeFileSync(absolutePath, content, "utf8");
    return {
      ok: true,
      absolutePath,
      relativePath: path.relative(WORKSPACE_DIR, absolutePath) || path.basename(absolutePath)
    };
  });

  ipcMain.handle("workspace:savePastedImage", async (_event, payload) => {
    const dataUrl = typeof payload?.dataUrl === "string" ? payload.dataUrl.trim() : "";
    if (!dataUrl) {
      throw new Error("Missing pasted image data.");
    }

    const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) {
      throw new Error("Invalid pasted image format.");
    }

    const mediaType = match[1].toLowerCase();
    if (!mediaType.startsWith("image/")) {
      throw new Error("Only image paste is supported.");
    }

    const base64 = match[2];
    const raw = Buffer.from(base64, "base64");
    const ext = workspace.extensionForMediaType(mediaType);
    const preferredName = workspace.sanitizeFileName(payload?.filename || "pasted-image");
    const filename = preferredName.endsWith(ext) ? preferredName : `${preferredName}${ext}`;
    const rootDir = path.join(app.getPath("temp"), TEMP_PASTE_DIR);
    fs.mkdirSync(rootDir, { recursive: true });
    const absolutePath = path.join(rootDir, `${Date.now()}-${randomUUID()}-${filename}`);
    fs.writeFileSync(absolutePath, raw);

    return {
      absolutePath,
      relativePath: path.basename(absolutePath),
      mediaType,
      isImage: true,
      previewDataUrl: dataUrl
    };
  });

  ipcMain.handle("workspace:getSkills", async () => {
    try {
      return { ok: true, skills: skills.getAvailableSkills() };
    } catch {
      return { ok: false, skills: [] };
    }
  });

  // ── IDE ────────────────────────────────────────────────────────────────

  ipcMain.handle("ide:getInfo", async () => {
    const current = settings.readSettings();
    const available = await ide.listAvailableIdes();
    const selected =
      available.find((i) => i.id === current.preferredIde) ||
      available[0] ||
      ide.IDE_CANDIDATES[0];

    return {
      available,
      selectedId: selected.id
    };
  });

  ipcMain.handle("ide:openProject", async (_event, payload) => {
    // payload can be a plain ideId string (legacy) or { ideId, workspaceDir }
    const ideId = typeof payload === "string" ? payload : payload?.ideId;
    const workspaceDir = typeof payload === "object" && payload?.workspaceDir ? payload.workspaceDir : undefined;

    const available = await ide.listAvailableIdes();
    const byId = available.find((i) => i.id === ideId);
    const current = settings.readSettings();
    const selected =
      byId ||
      available.find((i) => i.id === current.preferredIde) ||
      available[0];

    if (!selected) {
      throw new Error("No supported IDE found on PATH.");
    }

    ide.launchIde(selected, workspaceDir);
    settings.writeSettings({ ...current, preferredIde: selected.id });
    return { ok: true, ideId: selected.id };
  });
}

module.exports = { register };
