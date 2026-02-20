// ---------------------------------------------------------------------------
// chat-utils.cjs — Pure utility functions for chat (no chat-specific state)
// ---------------------------------------------------------------------------

const { logError } = require("./logger.cjs");
const { normalizeContextFiles } = require("./workspace.cjs");

function sendStreamEvent(webContents, payload) {
  if (!webContents || webContents.isDestroyed()) return;
  try {
    webContents.send("chat:streamEvent", payload);
  } catch (error) {
    logError("chat:sendStreamEvent", error);
  }
}

function parseChatPayload(payload) {
  if (Array.isArray(payload)) return { messages: payload, effort: "", contextFiles: [], resumeSessionId: "", workspaceDirs: [] };
  if (!payload || typeof payload !== "object") return { messages: [], effort: "", contextFiles: [], resumeSessionId: "", workspaceDirs: [] };
  return {
    messages: Array.isArray(payload.messages) ? payload.messages : [],
    effort: typeof payload.effort === "string" ? payload.effort.trim() : "",
    contextFiles: normalizeContextFiles(payload.contextFiles),
    resumeSessionId: typeof payload.resumeSessionId === "string" ? payload.resumeSessionId.trim() : "",
    workspaceDirs: Array.isArray(payload.workspaceDirs) ? payload.workspaceDirs.filter((d) => typeof d === "string") : []
  };
}

function getLatestUserPrompt(messages) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === "user" && typeof message.content === "string" && message.content.trim()) {
      return message.content.trim();
    }
  }
  return "";
}

function isSlashCommandPrompt(prompt) {
  return typeof prompt === "string" && /^\/\S+/.test(prompt.trim());
}

function isRecoverableResumeError(message) {
  if (typeof message !== "string") return false;
  return /session id/i.test(message) && /(not found|does not exist|invalid|expired|cannot)/i.test(message);
}

function shouldApplyEffort(model, effort) {
  if (typeof effort !== "string" || !effort.trim()) return false;
  if (typeof model !== "string" || !model.trim()) return false;
  return /opus/i.test(model);
}

function extractTextFromClaudeMessageContent(content) {
  if (!Array.isArray(content)) return "";
  return content
    .filter((part) => part && part.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("\n")
    .trim();
}

function parsePercentMatch(value) {
  if (typeof value !== "string") return null;
  const match = value.match(/(\d{1,3})\s*%/);
  if (!match) return null;
  const num = Number(match[1]);
  if (!Number.isFinite(num)) return null;
  return Math.max(0, Math.min(100, num));
}

function extractLimitsHint(parsed) {
  if (!parsed || parsed.type !== "system") return null;

  const rawCandidates = [];
  if (typeof parsed.message === "string") rawCandidates.push(parsed.message);
  if (typeof parsed.text === "string") rawCandidates.push(parsed.text);
  if (typeof parsed.warning === "string") rawCandidates.push(parsed.warning);
  if (Array.isArray(parsed.content)) {
    for (const part of parsed.content) {
      if (part && typeof part.text === "string") rawCandidates.push(part.text);
    }
  }

  const combined = rawCandidates.join(" ").replace(/\s+/g, " ").trim();
  if (!combined) return null;
  if (!/(5.?hour|weekly|rate limit|quota|usage limit)/i.test(combined)) return null;

  let fiveHourPercent = null;
  let weeklyPercent = null;

  const fiveHourMatch = combined.match(/(?:5.?hour|session)[^%]{0,40}(\d{1,3})\s*%/i);
  if (fiveHourMatch) fiveHourPercent = parsePercentMatch(fiveHourMatch[0]);

  const weeklyMatch = combined.match(/weekly[^%]{0,40}(\d{1,3})\s*%/i);
  if (weeklyMatch) weeklyPercent = parsePercentMatch(weeklyMatch[0]);

  const warningLevel =
    (fiveHourPercent !== null && fiveHourPercent >= 75) ||
    (weeklyPercent !== null && weeklyPercent >= 75) ||
    /\bwarning|limited|near\b/i.test(combined)
      ? "warning" : "info";

  return { level: warningLevel, message: combined, fiveHourPercent, weeklyPercent };
}

module.exports = {
  sendStreamEvent,
  parseChatPayload,
  getLatestUserPrompt,
  isSlashCommandPrompt,
  isRecoverableResumeError,
  shouldApplyEffort,
  extractTextFromClaudeMessageContent,
  parsePercentMatch,
  extractLimitsHint
};
