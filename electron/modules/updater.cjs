"use strict";

// ── Auto-updater (electron-updater / GitHub Releases) ─────────────────────────
// Requires "publish" config in package.json pointing to a GitHub repo.
// Set WIN_CERT_PATH / WIN_CERT_PASSWORD env vars for code signing on Windows.

let autoUpdater = null;
try {
  autoUpdater = require("electron-updater").autoUpdater;
} catch {
  // electron-updater not installed — silently skip updates
}

/**
 * @param {Electron.BrowserWindow} mainWindow
 * @param {Electron.IpcMain} ipcMain
 */
function init(mainWindow, ipcMain) {
  if (!autoUpdater) return;

  // Don't auto-download — let the user decide when to install
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = null; // suppress noisy logs in production

  autoUpdater.on("update-available", (info) => {
    try {
      mainWindow.webContents.send("app:updateAvailable", {
        version: info.version,
        releaseNotes: info.releaseNotes ?? null
      });
    } catch {
      // window already closed
    }
  });

  autoUpdater.on("update-downloaded", (info) => {
    try {
      mainWindow.webContents.send("app:updateDownloaded", {
        version: info.version
      });
    } catch {
      // window already closed
    }
  });

  autoUpdater.on("error", (err) => {
    // Only log — never crash the app over update failures
    console.error("[updater] error:", err.message);
  });

  ipcMain.handle("app:checkForUpdates", async () => {
    try {
      await autoUpdater.checkForUpdates();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle("app:installUpdate", () => {
    autoUpdater.quitAndInstall(false, true);
    return { ok: true };
  });

  // Silent background check 8 seconds after start
  setTimeout(() => {
    autoUpdater.checkForUpdatesAndNotify().catch(() => {});
  }, 8000);
}

module.exports = { init };
