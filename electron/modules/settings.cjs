const path = require("node:path");
const fs = require("node:fs");

const { logError, logWarn } = require("./logger.cjs");

const SETTINGS_FILE = "settings.json";
const AUTH_MODES = {
  API_KEY: "api-key",
  CLAUDE_CLI: "claude-cli"
};

const DEFAULT_SETTINGS = {
  authMode: AUTH_MODES.CLAUDE_CLI,
  model: "claude-sonnet-4-5",
  encryptedApiKey: "",
  claudeCliSessionId: "",
  preferredIde: "cursor",
  workspaceDirs: []
};

let _app = null;
let _safeStorage = null;
let _encryptionSecure = false;

function init(app, safeStorage) {
  _app = app;
  _safeStorage = safeStorage;
}

function settingsPath() {
  return path.join(_app.getPath("userData"), SETTINGS_FILE);
}

function readSettings() {
  try {
    const filePath = settingsPath();
    if (!fs.existsSync(filePath)) {
      return { ...DEFAULT_SETTINGS };
    }

    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw);
    const merged = { ...DEFAULT_SETTINGS, ...parsed };
    const dirs = Array.isArray(merged.workspaceDirs) ? merged.workspaceDirs : [];
    merged.workspaceDirs = [...new Set(dirs.filter((value) => typeof value === "string" && value.trim()))];
    return merged;
  } catch (error) {
    logError("settings:readSettings", error);
    return { ...DEFAULT_SETTINGS };
  }
}

function writeSettings(next) {
  const merged = { ...DEFAULT_SETTINGS, ...next };
  fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
  fs.writeFileSync(settingsPath(), JSON.stringify(merged, null, 2), "utf8");
}

function encryptSecret(value) {
  if (!value) {
    return "";
  }

  if (_safeStorage.isEncryptionAvailable()) {
    _encryptionSecure = true;
    return _safeStorage.encryptString(value).toString("base64");
  }

  _encryptionSecure = false;
  logWarn("settings:encryptSecret", "safeStorage encryption unavailable. API key stored with weak base64 encoding only.");
  return Buffer.from(value, "utf8").toString("base64");
}

function decryptSecret(value) {
  if (!value) {
    return "";
  }

  try {
    if (_safeStorage.isEncryptionAvailable()) {
      return _safeStorage.decryptString(Buffer.from(value, "base64"));
    }
  } catch (error) {
    logError("settings:decryptSecret", error);
    return "";
  }

  return Buffer.from(value, "base64").toString("utf8");
}

function publicSettings(settings) {
  return {
    authMode: settings.authMode,
    model: settings.model,
    hasApiKey: Boolean(settings.encryptedApiKey),
    hasClaudeCliSession: Boolean(settings.claudeCliSessionId),
    preferredIde: settings.preferredIde,
    workspaceDirs: Array.isArray(settings.workspaceDirs) ? settings.workspaceDirs : [],
    encryptionSecure: _encryptionSecure
  };
}

module.exports = {
  SETTINGS_FILE,
  AUTH_MODES,
  DEFAULT_SETTINGS,
  init,
  settingsPath,
  readSettings,
  writeSettings,
  encryptSecret,
  decryptSecret,
  publicSettings
};
