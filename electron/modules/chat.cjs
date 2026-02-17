const { randomUUID } = require("node:crypto");
const { spawn } = require("node:child_process");

const { collectContextDirs, normalizeContextFiles } = require("./workspace.cjs");
const { logError } = require("./logger.cjs");
const { ANTHROPIC_API_URL, ANTHROPIC_API_VERSION, MAX_TOKENS_DEFAULT, CONTEXT_WINDOW_DEFAULT } = require("./constants.cjs");

const activeStreamRequests = new Map();

// ---------------------------------------------------------------------------
// Pending approvals (permissions + AskUserQuestion)
// approvalId -> { resolve }
// ---------------------------------------------------------------------------

const pendingApprovals = new Map();

function resolveApproval(approvalId, response) {
  const pending = pendingApprovals.get(approvalId);
  if (!pending) return false;
  pendingApprovals.delete(approvalId);
  pending.resolve(response);
  return true;
}

// ---------------------------------------------------------------------------
// SDK streaming (Claude CLI mode)
// ---------------------------------------------------------------------------

let _sdk = null;
async function getSdk() {
  if (!_sdk) {
    _sdk = await import("@anthropic-ai/claude-agent-sdk");
  }
  return _sdk;
}

async function startSDKStream({
  webContents,
  requestId,
  messages,
  model,
  effort,
  contextFiles,
  forcedSessionId,
  resumeSessionId,
  workspaceDirs,
  onSessionId,
  onSessionReset
}) {
  const message = getLatestUserPrompt(messages);
  if (!message) {
    sendStreamEvent(webContents, {
      requestId, type: "error",
      error: "No message to send.", provider: "claude-cli"
    });
    return;
  }

  const abortController = new AbortController();
  const entry = {
    provider: "claude-cli",
    aborted: false,
    abort: () => {
      entry.aborted = true;
      abortController.abort();
    }
  };
  activeStreamRequests.set(requestId, entry);

  sendStreamEvent(webContents, { requestId, type: "start", provider: "claude-cli" });

  const contextDirs = collectContextDirs(contextFiles || []);
  const allDirs = [...new Set([...(Array.isArray(workspaceDirs) ? workspaceDirs : []), ...contextDirs])];
  const cwd = allDirs[0] || process.cwd();
  const additionalDirectories = allDirs.slice(1);

  // canUseTool: intercept every tool call — permissions + AskUserQuestion
  const canUseTool = async (toolName, input) => {
    if (entry.aborted) {
      return { behavior: "deny", message: "Stream aborted." };
    }

    const approvalId = randomUUID();

    return new Promise((resolve) => {
      pendingApprovals.set(approvalId, { resolve });

      const eventType = toolName === "AskUserQuestion" ? "askUser" : "approvalRequest";
      sendStreamEvent(webContents, {
        requestId, type: eventType,
        provider: "claude-cli", approvalId, toolName, input
      });

      // Safety timeout: 5 minutes
      setTimeout(() => {
        if (pendingApprovals.has(approvalId)) {
          pendingApprovals.delete(approvalId);
          resolve({ behavior: "deny", message: "Approval timed out." });
        }
      }, 5 * 60 * 1000);
    });
  };

  let streamedText = "";
  let finalText = "";
  let permissionMode = "";
  let sessionId = resumeSessionId || forcedSessionId || "";
  let sessionCostUsd = null;

  const { query } = await getSdk();

  try {
    const sdkOptions = {
      model: model || undefined,
      cwd,
      additionalDirectories: additionalDirectories.length > 0 ? additionalDirectories : undefined,
      resume: resumeSessionId || undefined,
      sessionId: forcedSessionId || undefined,
      abortController,
      includePartialMessages: true,
      canUseTool
    };

    if (shouldApplyEffort(model, effort)) {
      sdkOptions.effortLevel = effort;
    }

    for await (const msg of query({ prompt: message, options: sdkOptions })) {
      if (entry.aborted) break;

      if (msg.type === "system" && msg.subtype === "init") {
        if (msg.session_id) sessionId = msg.session_id;
        permissionMode = msg.permissionMode || "";

        const slashCommands = Array.isArray(msg.slash_commands)
          ? msg.slash_commands.filter((c) => typeof c === "string" && c.trim())
          : [];
        if (slashCommands.length > 0) {
          sendStreamEvent(webContents, {
            requestId, type: "slashCommands",
            provider: "claude-cli", commands: slashCommands
          });
        }
        if (permissionMode) {
          sendStreamEvent(webContents, {
            requestId, type: "status",
            provider: "claude-cli", permissionMode, context: null
          });
        }
        continue;
      }

      if (msg.type === "system" && msg.subtype === "compact_boundary") {
        sendStreamEvent(webContents, { requestId, type: "compactBoundary", provider: "claude-cli" });
        continue;
      }

      if (msg.type === "system") {
        const limitsHint = extractLimitsHint(msg);
        if (limitsHint) {
          sendStreamEvent(webContents, {
            requestId, type: "limits", provider: "claude-cli",
            level: limitsHint.level, message: limitsHint.message,
            fiveHourPercent: limitsHint.fiveHourPercent,
            weeklyPercent: limitsHint.weeklyPercent
          });
        }
        continue;
      }

      if (msg.type === "stream_event") {
        const ev = msg.event;
        if (
          ev?.type === "content_block_delta" &&
          ev.delta?.type === "text_delta" &&
          typeof ev.delta.text === "string" &&
          ev.delta.text
        ) {
          streamedText += ev.delta.text;
          sendStreamEvent(webContents, {
            requestId, type: "delta",
            delta: ev.delta.text, content: streamedText, provider: "claude-cli"
          });
        }
        continue;
      }

      if (msg.type === "assistant") {
        if (msg.session_id) sessionId = msg.session_id;
        const blocks = Array.isArray(msg.message?.content) ? msg.message.content : [];
        for (const block of blocks) {
          if (!block || block.type !== "tool_use") continue;
          const toolUseId = typeof block.id === "string" && block.id.trim() ? block.id.trim() : randomUUID();
          sendStreamEvent(webContents, {
            requestId, type: "toolUse", provider: "claude-cli",
            toolUseId, name: block.name || "tool",
            input: block.input && typeof block.input === "object" ? block.input : null,
            timestamp: Date.now()
          });
        }
        const text = extractTextFromClaudeMessageContent(blocks);
        if (text) finalText = text;
        continue;
      }

      if (msg.type === "user") {
        const blocks = Array.isArray(msg.message?.content) ? msg.message.content : [];
        for (const block of blocks) {
          if (!block || block.type !== "tool_result") continue;
          const toolUseId = typeof block.tool_use_id === "string" && block.tool_use_id.trim()
            ? block.tool_use_id.trim() : randomUUID();
          sendStreamEvent(webContents, {
            requestId, type: "toolResult", provider: "claude-cli",
            toolUseId, isError: Boolean(block.is_error),
            content: block.content, timestamp: Date.now()
          });
        }
        continue;
      }

      if (msg.type === "result") {
        if (msg.session_id) sessionId = msg.session_id;
        if (typeof msg.total_cost_usd === "number" && Number.isFinite(msg.total_cost_usd)) {
          sessionCostUsd = msg.total_cost_usd;
        }
        if (typeof msg.result === "string" && msg.result.trim()) {
          finalText = msg.result.trim();
        }

        // Token usage
        const usage = msg.usage || {};
        const modelUsage = msg.modelUsage || {};
        const primaryModel = Object.values(modelUsage)[0];
        const maxTokens = primaryModel && Number.isFinite(primaryModel.contextWindow)
          ? Number(primaryModel.contextWindow) : CONTEXT_WINDOW_DEFAULT;
        const inputTokens = Number(usage.input_tokens) || 0;
        const outputTokens = Number(usage.output_tokens) || 0;
        const cacheReadInputTokens = Number(usage.cache_read_input_tokens) || 0;
        const cacheCreationInputTokens = Number(usage.cache_creation_input_tokens) || 0;
        const usedTokens = inputTokens + outputTokens + cacheReadInputTokens + cacheCreationInputTokens;
        const percent = maxTokens > 0
          ? Math.max(0, Math.min(100, Math.round((usedTokens / maxTokens) * 100))) : 0;

        sendStreamEvent(webContents, {
          requestId, type: "status", provider: "claude-cli",
          permissionMode: permissionMode || "unknown",
          context: { usedTokens, maxTokens, percent, inputTokens, outputTokens, cacheReadInputTokens, cacheCreationInputTokens }
        });

        if (Array.isArray(msg.permission_denials) && msg.permission_denials.length > 0) {
          sendStreamEvent(webContents, {
            requestId, type: "permissionDenials", provider: "claude-cli",
            denials: msg.permission_denials.filter((d) => typeof d === "string" && d.trim())
          });
        }

        activeStreamRequests.delete(requestId);

        if (sessionId && typeof onSessionId === "function") {
          onSessionId(sessionId);
        }

        if (msg.is_error) {
          const errorMsg = msg.result || (Array.isArray(msg.errors) ? msg.errors.join(", ") : "Unknown error");
          if (sessionId && isRecoverableResumeError(errorMsg) && typeof onSessionReset === "function") {
            onSessionReset();
          }
          sendStreamEvent(webContents, {
            requestId, type: "error",
            error: `Claude CLI failed: ${errorMsg}`,
            errorSubtype: msg.subtype || "error",
            provider: "claude-cli"
          });
          return;
        }

        let content = (finalText || streamedText || "").trim();
        if (!content && isSlashCommandPrompt(message)) {
          const command = message.trim().split(/\s+/)[0] || "/command";
          content = command === "/compact" ? "Compacted." : `${command} executed.`;
        }

        sendStreamEvent(webContents, {
          requestId, type: "done",
          content, sessionCostUsd, provider: "claude-cli"
        });
      }
    }
  } catch (err) {
    activeStreamRequests.delete(requestId);
    if (entry.aborted) {
      sendStreamEvent(webContents, { requestId, type: "aborted", provider: "claude-cli" });
      return;
    }
    const errMsg = err instanceof Error ? err.message : String(err);
    if (sessionId && isRecoverableResumeError(errMsg) && typeof onSessionReset === "function") {
      onSessionReset();
    }
    if (/Unable to execute|ENOENT|not found/i.test(errMsg)) {
      sendStreamEvent(webContents, {
        requestId, type: "error",
        error: `Unable to execute Claude CLI: ${errMsg}. Install CLI and run "claude login".`,
        provider: "claude-cli"
      });
    } else {
      sendStreamEvent(webContents, {
        requestId, type: "error",
        error: `Claude CLI failed: ${errMsg}`,
        provider: "claude-cli"
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Anthropic API (pseudo-stream)
// ---------------------------------------------------------------------------

function toAnthropicMessages(messages) {
  return messages
    .filter((message) => message.role === "user" || message.role === "assistant")
    .map((message) => ({
      role: message.role,
      content: [{ type: "text", text: message.content }]
    }));
}

async function runAnthropicApi(messages, model, apiKey, signal) {
  const response = await fetch(ANTHROPIC_API_URL, {
    method: "POST",
    signal,
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": ANTHROPIC_API_VERSION
    },
    body: JSON.stringify({
      model,
      max_tokens: MAX_TOKENS_DEFAULT,
      messages: toAnthropicMessages(messages)
    })
  });

  const text = await response.text();

  if (!response.ok) {
    throw new Error(`Anthropic API error (${response.status}): ${text}`);
  }

  const parsed = JSON.parse(text);
  const content = Array.isArray(parsed.content)
    ? parsed.content
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("\n")
    : "";

  return content || "No text content returned by API.";
}

function startAnthropicPseudoStream({ webContents, requestId, messages, model, apiKey }) {
  const controller = new AbortController();
  const entry = {
    provider: "anthropic-api",
    aborted: false,
    abort: () => {
      entry.aborted = true;
      controller.abort();
    }
  };
  activeStreamRequests.set(requestId, entry);

  sendStreamEvent(webContents, { requestId, type: "start", provider: "anthropic-api" });
  sendStreamEvent(webContents, {
    requestId, type: "status",
    provider: "anthropic-api", permissionMode: "api-key", context: null
  });

  void (async () => {
    try {
      const content = await runAnthropicApi(messages, model, apiKey, controller.signal);
      const latestEntry = activeStreamRequests.get(requestId);
      if (latestEntry?.aborted) {
        activeStreamRequests.delete(requestId);
        sendStreamEvent(webContents, { requestId, type: "aborted", provider: "anthropic-api" });
        return;
      }
      sendStreamEvent(webContents, { requestId, type: "delta", delta: content, content, provider: "anthropic-api" });
      sendStreamEvent(webContents, { requestId, type: "done", content, provider: "anthropic-api" });
      activeStreamRequests.delete(requestId);
    } catch (error) {
      const latestEntry = activeStreamRequests.get(requestId);
      if (latestEntry?.aborted) {
        activeStreamRequests.delete(requestId);
        sendStreamEvent(webContents, { requestId, type: "aborted", provider: "anthropic-api" });
        return;
      }
      activeStreamRequests.delete(requestId);
      sendStreamEvent(webContents, {
        requestId, type: "error",
        error: error instanceof Error ? error.message : "Unknown streaming error.",
        provider: "anthropic-api"
      });
    }
  })();
}

// ---------------------------------------------------------------------------
// Legacy sync CLI (used by chat:send non-streaming)
// ---------------------------------------------------------------------------

function buildCliPrompt(messages) {
  const turns = messages
    .filter((message) => message.role === "user" || message.role === "assistant")
    .map((message) => {
      const label = message.role === "user" ? "User" : "Assistant";
      return `${label}: ${message.content}`;
    });
  return `${turns.join("\n\n")}\n\nAssistant:`;
}

function resolveClaudeCliPrompt(messages) {
  const latestPrompt = getLatestUserPrompt(messages);
  return latestPrompt || buildCliPrompt(messages);
}

function parseClaudeOutput(raw) {
  const trimmed = raw.trim();
  if (!trimmed) return "";

  const lines = trimmed.split("\n").map((line) => line.trim()).filter(Boolean);
  const candidates = [trimmed, ...lines.slice().reverse()];

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (typeof parsed.result === "string" && parsed.result.trim()) return parsed.result.trim();
      if (typeof parsed.output === "string" && parsed.output.trim()) return parsed.output.trim();
      if (Array.isArray(parsed.content)) {
        const joined = parsed.content
          .filter((part) => part.type === "text")
          .map((part) => part.text)
          .join("\n").trim();
        if (joined) return joined;
      }
    } catch { continue; }
  }
  return trimmed;
}

function parseClaudeErrorSummary(raw) {
  if (typeof raw !== "string" || !raw.trim()) return "";
  const parsed = parseClaudeOutput(raw);
  if (parsed && parsed !== raw.trim()) return parsed;
  const resultMatch = raw.match(/"result"\s*:\s*"([^"]+)"/);
  if (resultMatch?.[1]) return resultMatch[1];
  const textMatch = raw.match(/"text"\s*:\s*"([^"]+)"/);
  if (textMatch?.[1]) return textMatch[1];
  return "";
}

function buildClaudeCliErrorDetail(stdout, stderr, code) {
  const joined = `${stdout || ""}\n${stderr || ""}`;
  if (/Prompt is too long/i.test(joined)) return "Prompt is too long";

  const fromStdout = parseClaudeErrorSummary(stdout);
  if (fromStdout) return fromStdout;

  const fromStderr = parseClaudeErrorSummary(stderr);
  if (fromStderr) return fromStderr;

  const compactStderr = (stderr || "").replace(/\s+/g, " ").trim();
  if (compactStderr) return compactStderr.length > 320 ? `${compactStderr.slice(0, 317)}...` : compactStderr;

  const compactStdout = (stdout || "").replace(/\s+/g, " ").trim();
  if (compactStdout) return compactStdout.length > 320 ? `${compactStdout.slice(0, 317)}...` : compactStdout;

  return `exit code ${code}`;
}

function parseClaudeResult(raw) {
  const trimmed = raw.trim();
  if (!trimmed) return { content: "", sessionId: "" };

  let sessionId = "";
  let content = "";

  const lines = trimmed.split("\n").map((line) => line.trim()).filter(Boolean);
  const candidates = [trimmed, ...lines.slice().reverse()];
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (typeof parsed.session_id === "string" && parsed.session_id) sessionId = parsed.session_id;
      if (typeof parsed.result === "string" && parsed.result.trim()) {
        content = parsed.result.trim();
      } else if (typeof parsed.output === "string" && parsed.output.trim()) {
        content = parsed.output.trim();
      } else if (Array.isArray(parsed.content)) {
        const joined = parsed.content
          .filter((part) => part.type === "text")
          .map((part) => part.text)
          .join("\n").trim();
        if (joined) content = joined;
      }
      if (content && sessionId) break;
    } catch { continue; }
  }

  return { content: content || parseClaudeOutput(raw), sessionId };
}

function runClaudeCli(messages, model, resumeSessionId, effort, contextFiles = [], forcedSessionId = "", workspaceDirs = []) {
  const prompt = resolveClaudeCliPrompt(messages);

  return new Promise((resolve, reject) => {
    const args = ["-p", prompt, "--output-format", "json"];
    if (typeof model === "string" && model.trim()) args.push("--model", model.trim());
    if (shouldApplyEffort(model, effort)) args.push("--effort", effort.trim());
    if (typeof resumeSessionId === "string" && resumeSessionId.trim()) args.push("--resume", resumeSessionId.trim());
    if (typeof forcedSessionId === "string" && forcedSessionId.trim()) args.push("--session-id", forcedSessionId.trim());

    const contextDirs = collectContextDirs(contextFiles);
    const addDirs = [...new Set([...workspaceDirs, ...contextDirs])];
    for (const dir of addDirs) args.push("--add-dir", dir);

    const { CLAUDECODE: _cc2, ...safeEnv2 } = process.env;
    const child = spawn("claude", args, { stdio: ["ignore", "pipe", "pipe"], env: safeEnv2 });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", (error) => {
      reject(new Error(`Unable to execute Claude CLI: ${error.message}. Install CLI and run "claude login".`));
    });
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`Claude CLI failed: ${buildClaudeCliErrorDetail(stdout, stderr, code)}`));
        return;
      }
      resolve(parseClaudeResult(stdout));
    });
  });
}

// ---------------------------------------------------------------------------
// Utility functions
// ---------------------------------------------------------------------------

function parseChatPayload(payload) {
  if (Array.isArray(payload)) return { messages: payload, effort: "", contextFiles: [] };
  if (!payload || typeof payload !== "object") return { messages: [], effort: "", contextFiles: [] };
  return {
    messages: Array.isArray(payload.messages) ? payload.messages : [],
    effort: typeof payload.effort === "string" ? payload.effort.trim() : "",
    contextFiles: normalizeContextFiles(payload.contextFiles)
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

function sendStreamEvent(webContents, payload) {
  if (!webContents || webContents.isDestroyed()) return;
  try {
    webContents.send("chat:streamEvent", payload);
  } catch (error) {
    logError("chat:sendStreamEvent", error);
  }
}

module.exports = {
  activeStreamRequests,
  pendingApprovals,
  resolveApproval,
  toAnthropicMessages,
  runAnthropicApi,
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
  startAnthropicPseudoStream,
  parseChatPayload,
  runClaudeCli
};
