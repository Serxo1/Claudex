const { app, BrowserWindow, ipcMain, nativeImage, nativeTheme, safeStorage, dialog, globalShortcut, Notification, shell } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const { randomUUID } = require("node:crypto");

// Suppress "Operation aborted" rejections from the Claude Agent SDK when a
// stream is aborted while a tool-approval promise is still pending.
process.on("unhandledRejection", (reason) => {
  if (reason instanceof Error && reason.message === "Operation aborted") return;
  console.error("Unhandled rejection:", reason);
});

async function createRoundedDockIcon() {
  const logoPath = path.join(__dirname, "../public/logo.png");
  const logoBase64 = fs.readFileSync(logoPath).toString("base64");
  const logoDataURL = `data:image/png;base64,${logoBase64}`;

  const win = new BrowserWindow({
    width: 256,
    height: 256,
    show: false,
    webPreferences: { offscreen: true, contextIsolation: true }
  });

  await new Promise((resolve) => {
    win.loadURL("data:text/html,<html><body style='margin:0'><canvas id='c' width='256' height='256'></canvas></body></html>");
    win.webContents.once("did-finish-load", resolve);
  });

  const dataURL = await win.webContents.executeJavaScript(`
    new Promise(resolve => {
      const canvas = document.getElementById('c');
      const ctx = canvas.getContext('2d');
      const img = new Image();
      img.onload = () => {
        const size = 256, r = 56;
        ctx.clearRect(0, 0, size, size);
        ctx.beginPath();
        ctx.moveTo(r, 0);
        ctx.arcTo(size, 0, size, size, r);
        ctx.arcTo(size, size, 0, size, r);
        ctx.arcTo(0, size, 0, 0, r);
        ctx.arcTo(0, 0, size, 0, r);
        ctx.closePath();
        ctx.clip();
        ctx.drawImage(img, 0, 0, size, size);
        resolve(canvas.toDataURL('image/png'));
      };
      img.src = '${logoDataURL}';
    })
  `);

  win.destroy();
  return nativeImage.createFromDataURL(dataURL);
}

const { setWorkspaceDir, runCommand, isCommandAvailable } = require("./modules/utils.cjs");
const settings = require("./modules/settings.cjs");
const workspace = require("./modules/workspace.cjs");
const git = require("./modules/git.cjs");
const ide = require("./modules/ide.cjs");
const terminal = require("./modules/terminal.cjs");
const chat = require("./modules/chat.cjs");
const skills = require("./modules/skills.cjs");
const teams = require("./modules/teams.cjs");
const { logError } = require("./modules/logger.cjs");
const { MAX_EDITOR_FILE_SIZE, PR_TIMEOUT_MS, TEMP_PASTE_DIR } = require("./modules/constants.cjs");

const ipcSettings = require("./modules/ipc-settings.cjs");
const ipcWorkspace = require("./modules/ipc-workspace.cjs");
const ipcGit = require("./modules/ipc-git.cjs");
const ipcTerminal = require("./modules/ipc-terminal.cjs");
const ipcChat = require("./modules/ipc-chat.cjs");
const ipcTeams = require("./modules/ipc-teams.cjs");

const WORKSPACE_DIR = process.cwd();

setWorkspaceDir(WORKSPACE_DIR);
settings.init(app, safeStorage);


async function createWindow() {
  const isDarwin = process.platform === "darwin";
  const mainWindow = new BrowserWindow({
    width: 1400,
    height: 920,
    minWidth: 1024,
    minHeight: 720,
    title: "Claude Desktop MVP",
    icon: path.join(__dirname, "../public/logo.png"),
    ...(isDarwin
      ? {
        vibrancy: nativeTheme.shouldUseDarkColors ? "sidebar" : null,
        visualEffectState: "active",
        transparent: true,
        titleBarStyle: "hiddenInset",
        trafficLightPosition: { x: 16, y: 16 }
      }
      : {}),
    ...(process.platform === "win32"
      ? {
        backgroundMaterial: "acrylic",
        titleBarStyle: "hidden",
        titleBarOverlay: {
          color: "#00000000",
          symbolColor: nativeTheme.shouldUseDarkColors ? "#ffffff" : "#000000",
          height: 30
        }
      }
      : {}),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true
    }
  });

  const devServerUrl = process.env.VITE_DEV_SERVER_URL;

  if (devServerUrl) {
    await mainWindow.loadURL(devServerUrl);
    mainWindow.webContents.openDevTools({ mode: "detach" });
    return mainWindow;
  }

  await mainWindow.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  return mainWindow;
}

app.whenReady().then(() => {
  if (process.platform === "darwin" && app.dock) {
    createRoundedDockIcon().then((icon) => app.dock.setIcon(icon)).catch(() => {
      app.dock.setIcon(path.join(__dirname, "../public/logo.png"));
    });
  }

  let mainWindow = null;

  createWindow().then((win) => {
    mainWindow = win;
    if (process.platform === "darwin" && mainWindow) {
      nativeTheme.on("updated", () => {
        mainWindow.setVibrancy(nativeTheme.shouldUseDarkColors ? "sidebar" : null);
      });
    }
    if (mainWindow) {
      teams.init(mainWindow.webContents);
      mainWindow.on("closed", () => {
        teams.destroy();
      });
    }
  });

  const getMainWindow = () => mainWindow;

  ipcSettings.register(ipcMain, { settings });
  ipcWorkspace.register(ipcMain, { settings, workspace, skills, ide, dialog, app, fs, path, WORKSPACE_DIR, TEMP_PASTE_DIR, MAX_EDITOR_FILE_SIZE, randomUUID });
  ipcGit.register(ipcMain, { git, runCommand, isCommandAvailable, WORKSPACE_DIR, PR_TIMEOUT_MS });
  ipcTerminal.register(ipcMain, { terminal, runCommand, logError, WORKSPACE_DIR, randomUUID });
  ipcChat.register(ipcMain, { chat, settings, workspace, skills, app, shell, fs, path, Notification, randomUUID, getMainWindow });
  ipcTeams.register(ipcMain, { teams, fs, path, os, getMainWindow });

  // ── App lifecycle ─────────────────────────────────────────────────────

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });

  app.on("browser-window-focus", () => {
    globalShortcut.register("F12", () => {
      const win = BrowserWindow.getFocusedWindow();
      if (win) win.webContents.toggleDevTools();
    });
  });

  app.on("browser-window-blur", () => {
    globalShortcut.unregister("F12");
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  for (const active of chat.activeStreamRequests.values()) {
    try {
      active.aborted = true;
      active.abort();
    } catch (error) {
      logError("app:before-quit:stream", error);
    }
  }
  chat.activeStreamRequests.clear();

  for (const sessionId of terminal.activeTerminalSessions.keys()) {
    terminal.closeTerminalSession(sessionId);
  }
  terminal.activeTerminalSessions.clear();

});
