const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const PLUGINS_DIR = path.join(os.homedir(), ".claude", "plugins");
const INSTALLED_PLUGINS_FILE = path.join(PLUGINS_DIR, "installed_plugins.json");
const LEGACY_COMMANDS_DIR = path.join(os.homedir(), ".claude", "commands");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseFrontMatter(content) {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/);
  if (!match) return { meta: {}, body: content.trim() };

  const meta = {};
  for (const line of match[1].split("\n")) {
    const colonIdx = line.indexOf(":");
    if (colonIdx > 0) {
      const key = line.slice(0, colonIdx).trim();
      const value = line.slice(colonIdx + 1).trim();
      meta[key] = value;
    }
  }
  return { meta, body: match[2].trim() };
}

function tryReadFile(filePath) {
  try { return fs.readFileSync(filePath, "utf8"); }
  catch { return null; }
}

function tryReadDir(dirPath) {
  try { return fs.readdirSync(dirPath, { withFileTypes: true }); }
  catch { return []; }
}

// ---------------------------------------------------------------------------
// Plugin readers
// ---------------------------------------------------------------------------

/**
 * Read slash commands from a plugin's commands/ directory.
 * Files: {installPath}/commands/{name}.md
 * Invoked as: /{pluginName}:{name}
 */
function readPluginCommands(pluginName, installPath) {
  const commandsDir = path.join(installPath, "commands");
  const commands = [];

  for (const entry of tryReadDir(commandsDir)) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
    const name = entry.name.slice(0, -3);
    const raw = tryReadFile(path.join(commandsDir, entry.name));
    if (!raw) continue;
    const { meta, body } = parseFrontMatter(raw);
    commands.push({
      name: `${pluginName}:${name}`,
      description: meta.description || "",
      argumentHint: meta["argument-hint"] || "",
      type: "command",
      body
    });
  }

  return commands;
}

/**
 * Read skills from a plugin's skills/ directory.
 * Files: {installPath}/skills/{skillName}/SKILL.md
 * Invoked as: /{pluginName}:{skillName}
 * If skillName === pluginName, also available as /{pluginName}
 */
function readPluginSkills(pluginName, installPath) {
  const skillsDir = path.join(installPath, "skills");
  const skills = [];

  for (const entry of tryReadDir(skillsDir)) {
    if (!entry.isDirectory()) continue;
    const skillFile = path.join(skillsDir, entry.name, "SKILL.md");
    const raw = tryReadFile(skillFile);
    if (!raw) continue;
    const { meta, body } = parseFrontMatter(raw);
    const skillName = meta.name || entry.name;
    const fullName = `${pluginName}:${skillName}`;

    skills.push({
      name: fullName,
      description: meta.description || "",
      type: "skill",
      body
    });

    // Also register without prefix when skillName === pluginName
    if (skillName === pluginName) {
      skills.push({ name: pluginName, description: meta.description || "", type: "skill", body });
    }
  }

  return skills;
}

/**
 * Read legacy simple commands from ~/.claude/commands/ (flat .md files or nested dirs).
 */
function readLegacyCommands() {
  const commands = [];

  function walk(dir, prefix) {
    for (const entry of tryReadDir(dir)) {
      if (entry.isDirectory()) {
        walk(path.join(dir, entry.name), prefix ? `${prefix}:${entry.name}` : entry.name);
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        const name = entry.name.slice(0, -3);
        const fullName = prefix ? `${prefix}:${name}` : name;
        const raw = tryReadFile(path.join(dir, entry.name));
        if (!raw) continue;
        const { meta, body } = parseFrontMatter(raw);
        commands.push({
          name: fullName,
          description: meta.description || "",
          argumentHint: meta["argument-hint"] || "",
          type: "command",
          body
        });
      }
    }
  }

  walk(LEGACY_COMMANDS_DIR, "");
  return commands;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

let _cache = null;
let _cacheTime = 0;
const CACHE_TTL_MS = 30_000; // 30s

/**
 * Returns all available skills and commands from installed plugins.
 * Result is cached for 30s.
 */
function getAvailableSkills() {
  const now = Date.now();
  if (_cache && now - _cacheTime < CACHE_TTL_MS) return _cache;

  const items = [...readLegacyCommands()];

  try {
    const raw = tryReadFile(INSTALLED_PLUGINS_FILE);
    if (raw) {
      const data = JSON.parse(raw);
      for (const [pluginKey, installations] of Object.entries(data.plugins || {})) {
        const installation = Array.isArray(installations)
          ? installations[installations.length - 1]
          : installations;
        if (!installation?.installPath) continue;

        const pluginName = pluginKey.split("@")[0];
        items.push(...readPluginCommands(pluginName, installation.installPath));
        items.push(...readPluginSkills(pluginName, installation.installPath));
      }
    }
  } catch { /* ignore */ }

  // Deduplicate by name (first wins)
  const seen = new Set();
  const unique = items.filter((item) => {
    if (seen.has(item.name)) return false;
    seen.add(item.name);
    return true;
  });

  _cache = unique;
  _cacheTime = now;
  return unique;
}

/**
 * If `prompt` is a slash command matching a known skill or command,
 * returns the expanded prompt string.  Returns null if no match.
 */
function expandSlashCommand(prompt) {
  if (!prompt || !prompt.startsWith("/")) return null;

  const parts = prompt.trim().split(/\s+/);
  const commandName = parts[0].slice(1); // remove leading /
  const args = parts.slice(1).join(" ");

  const items = getAvailableSkills();
  const match = items.find((item) => item.name === commandName);
  if (!match) return null;

  if (match.type === "command") {
    // Replace $ARGUMENTS placeholder
    return match.body.replace(/\$ARGUMENTS/gi, args).trim();
  }

  // Skill: inject skill instructions followed by user request
  const userPart = args ? `\n\n## User Request\n\n${args}` : "";
  return `${match.body}${userPart}`.trim();
}

module.exports = { getAvailableSkills, expandSlashCommand };
