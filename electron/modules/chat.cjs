// ---------------------------------------------------------------------------
// chat.cjs — Thin orchestrator: owns shared state, re-exports all chat API
// ---------------------------------------------------------------------------

const path = require("node:path");

const { toAnthropicMessages, runAnthropicApi, startAnthropicPseudoStream: _startAnthropicPseudoStream } = require("./chat-anthropic.cjs");
const { buildCliPrompt, resolveClaudeCliPrompt, parseClaudeOutput, parseClaudeErrorSummary, buildClaudeCliErrorDetail, parseClaudeResult, runClaudeCli } = require("./chat-cli-legacy.cjs");
const { sendStreamEvent, parseChatPayload, getLatestUserPrompt, isSlashCommandPrompt, isRecoverableResumeError, shouldApplyEffort, extractTextFromClaudeMessageContent, parsePercentMatch, extractLimitsHint } = require("./chat-utils.cjs");
const { startSDKStream: _startSDKStream } = require("./chat-sdk-stream.cjs");

// ---------------------------------------------------------------------------
// Shared mutable state (owned here, injected into sub-modules as needed)
// ---------------------------------------------------------------------------

const activeStreamRequests = new Map();
const pendingApprovals = new Map();

function resolveApproval(approvalId, response) {
  const pending = pendingApprovals.get(approvalId);
  if (!pending) return false;
  pendingApprovals.delete(approvalId);
  pending.resolve(response);
  return true;
}

// ---------------------------------------------------------------------------
// Resolve the physical path to cli.js when running inside an Electron ASAR.
// The SDK uses import.meta.url to auto-detect cli.js, which gives it the
// ASAR-internal path (e.g. app.asar/node_modules/.../cli.js). Regular node.exe
// cannot read files from inside an ASAR archive, so we override it with the
// unpacked path (app.asar.unpacked/node_modules/.../cli.js) when necessary.
// ---------------------------------------------------------------------------
function resolveClaudeCodeCliPath() {
  const sdkDir = path.join(__dirname, "../../node_modules/@anthropic-ai/claude-agent-sdk");
  const cliPath = path.join(sdkDir, "cli.js");
  // Detect ASAR context: the path contains ".asar" but not ".asar.unpacked"
  if (cliPath.includes(".asar") && !cliPath.includes(".asar.unpacked")) {
    return cliPath.replace(/\.asar([/\\])/, ".asar.unpacked$1");
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// SDK dynamic import (ESM interop — kept here intentionally, uses import())
// ---------------------------------------------------------------------------

let _sdk = null;
async function getSdk() {
  if (!_sdk) {
    _sdk = await import("@anthropic-ai/claude-agent-sdk");
  }
  return _sdk;
}

// ---------------------------------------------------------------------------
// Wrappers that inject shared internal dependencies into sub-modules
// ---------------------------------------------------------------------------

function startSDKStream(args) {
  return _startSDKStream({ ...args, activeStreamRequests, pendingApprovals, getSdk, resolveClaudeCodeCliPath });
}

function startAnthropicPseudoStream(args) {
  return _startAnthropicPseudoStream({ ...args, activeStreamRequests });
}

// ---------------------------------------------------------------------------
// Exports — identical public API as before the refactor
// ---------------------------------------------------------------------------

module.exports = {
  activeStreamRequests,
  pendingApprovals,
  resolveApproval,
  toAnthropicMessages,
  runAnthropicApi,
  startAnthropicPseudoStream,
  buildCliPrompt,
  getLatestUserPrompt,
  isSlashCommandPrompt,
  resolveClaudeCliPrompt,
  parseClaudeOutput,
  parseClaudeErrorSummary,
  buildClaudeCliErrorDetail,
  parseClaudeResult,
  isRecoverableResumeError,
  shouldApplyEffort,
  extractTextFromClaudeMessageContent,
  parsePercentMatch,
  extractLimitsHint,
  sendStreamEvent,
  startSDKStream,
  parseChatPayload,
  runClaudeCli
};
