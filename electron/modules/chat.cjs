const { randomUUID } = require("node:crypto");
const { spawn } = require("node:child_process");

const { collectContextDirs, normalizeContextFiles } = require("./workspace.cjs");
const { logError } = require("./logger.cjs");
const { ANTHROPIC_API_URL, ANTHROPIC_API_VERSION, MAX_TOKENS_DEFAULT, CONTEXT_WINDOW_DEFAULT } = require("./constants.cjs");

const activeStreamRequests = new Map();

// ---------------------------------------------------------------------------
// Persistent CLI session
// ---------------------------------------------------------------------------

/** @type {CliSession | null} */
let currentCliSession = null;

class CliSession {
  constructor({ model, effort, workspaceDirs, resumeSessionId }) {
    this.model = model || "";
    this.effort = effort || "";
    this.workspaceDirs = [...(workspaceDirs || [])];
    this.sessionId = resumeSessionId || "";
    this.dead = false;
    this.buffer = "";
    this.stderrBuffer = "";
    this.spawnError = "";

    // Per-request state
    this.requestId = null;
    this.webContents = null;
    this.finished = true;
    this.streamedText = "";
    this.finalText = "";
    this.sessionCostUsd = null;
    this.errorSubtype = "";
    this.permissionMode = "";
    this.aborted = false;
    this.currentMessage = "";
    this.stdout = "";

    // Callbacks
    this.onSessionId = null;
    this.onSessionReset = null;

    // Cached init data from system:init event
    this.initData = null;

    this._spawn();
  }

  _spawn() {
    const args = ["--output-format", "stream-json", "--include-partial-messages", "--verbose"];
    if (this.model) args.push("--model", this.model);
    if (shouldApplyEffort(this.model, this.effort)) args.push("--effort", this.effort);
    if (this.sessionId) args.push("--resume", this.sessionId);
    for (const dir of this.workspaceDirs) args.push("--add-dir", dir);

    const { CLAUDECODE: _cc, ...safeEnv } = process.env;
    try {
      this.child = spawn("claude", args, { stdio: ["pipe", "pipe", "pipe"], env: safeEnv });
    } catch (err) {
      this.dead = true;
      this.spawnError = err.message || String(err);
      return;
    }

    this.child.stdout.on("data", (chunk) => this._onData(chunk));
    this.child.stderr.on("data", (chunk) => { this.stderrBuffer += chunk.toString(); });
    this.child.on("error", (err) => {
      this.dead = true;
      this.spawnError = err.message || String(err);
      this._onProcessDie("error");
    });
    this.child.on("close", (code) => {
      this.dead = true;
      this._onProcessDie(code);
    });
  }

  setRequest(requestId, webContents, onSessionId, onSessionReset) {
    this.requestId = requestId;
    this.webContents = webContents;
    this.onSessionId = onSessionId;
    this.onSessionReset = onSessionReset;
    this.finished = false;
    this.streamedText = "";
    this.finalText = "";
    this.sessionCostUsd = null;
    this.errorSubtype = "";
    this.aborted = false;
    this.currentMessage = "";
    this.stdout = "";
    this.stderrBuffer = "";
  }

  sendMessage(message) {
    this.currentMessage = message;
    if (this.dead || !this.child?.stdin?.writable) return;
    try {
      this.child.stdin.write(message + "\n");
    } catch {
      // Handled via error event
    }
  }

  provideToolResponse(answer) {
    if (this.dead || this.finished || !this.child?.stdin?.writable) return false;
    try {
      this.child.stdin.write(answer + "\n");
      return true;
    } catch {
      return false;
    }
  }

  abort() {
    if (this.aborted) return;
    this.aborted = true;
    this.kill();
  }

  kill() {
    this.dead = true;
    if (currentCliSession === this) currentCliSession = null;
    try { this.child?.kill("SIGTERM"); } catch {}
  }

  _onData(chunk) {
    const text = chunk.toString();
    this.stdout += text;
    this.buffer += text;
    let idx;
    while ((idx = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, idx).trim();
      this.buffer = this.buffer.slice(idx + 1);
      if (line) this._handleLine(line);
    }
  }

  _handleLine(line) {
    let parsed;
    try { parsed = JSON.parse(line); } catch { return; }

    if (typeof parsed.session_id === "string" && parsed.session_id) {
      this.sessionId = parsed.session_id;
    }

    // system:init is session-level (can arrive before first request)
    if (parsed.type === "system" && parsed.subtype === "init") {
      const slashCommands = Array.isArray(parsed.slash_commands)
        ? parsed.slash_commands.filter((c) => typeof c === "string" && c.trim())
        : [];
      const permissionMode = typeof parsed.permissionMode === "string" ? parsed.permissionMode : "";
      this.initData = { slashCommands, permissionMode };
      if (permissionMode) this.permissionMode = permissionMode;

      // Forward to active request if there is one
      if (this.requestId && !this.finished) {
        if (slashCommands.length > 0) {
          sendStreamEvent(this.webContents, {
            requestId: this.requestId, type: "slashCommands",
            provider: "claude-cli", commands: slashCommands
          });
        }
        if (permissionMode) {
          sendStreamEvent(this.webContents, {
            requestId: this.requestId, type: "status",
            provider: "claude-cli", permissionMode, context: null
          });
        }
      }
      return;
    }

    // All other events require an active request
    const requestId = this.requestId;
    if (!requestId || this.finished) return;

    if (parsed.type === "system" && parsed.subtype === "compact_boundary") {
      sendStreamEvent(this.webContents, { requestId, type: "compactBoundary", provider: "claude-cli" });
      return;
    }

    if (parsed.type === "system") {
      const limitsHint = extractLimitsHint(parsed);
      if (limitsHint) {
        sendStreamEvent(this.webContents, {
          requestId, type: "limits", provider: "claude-cli",
          level: limitsHint.level, message: limitsHint.message,
          fiveHourPercent: limitsHint.fiveHourPercent,
          weeklyPercent: limitsHint.weeklyPercent
        });
      }
      return;
    }

    if (
      parsed.type === "stream_event" &&
      parsed.event?.type === "content_block_delta" &&
      parsed.event?.delta?.type === "text_delta"
    ) {
      const delta = typeof parsed.event.delta.text === "string" ? parsed.event.delta.text : "";
      if (!delta) return;
      this.streamedText += delta;
      sendStreamEvent(this.webContents, {
        requestId, type: "delta", delta,
        content: this.streamedText, provider: "claude-cli"
      });
      return;
    }

    if (parsed.type === "assistant") {
      const blocks = Array.isArray(parsed.message?.content) ? parsed.message.content : [];
      for (const block of blocks) {
        if (!block || block.type !== "tool_use") continue;
        const toolUseId =
          typeof block.id === "string" && block.id.trim() ? block.id.trim()
          : typeof block.tool_use_id === "string" && block.tool_use_id.trim() ? block.tool_use_id.trim()
          : randomUUID();
        const name = typeof block.name === "string" && block.name.trim() ? block.name.trim() : "tool";
        const input = block.input && typeof block.input === "object" && !Array.isArray(block.input)
          ? block.input : null;
        sendStreamEvent(this.webContents, {
          requestId, type: "toolUse", provider: "claude-cli",
          toolUseId, name, input, timestamp: Date.now()
        });
      }
      const messageText = extractTextFromClaudeMessageContent(parsed.message?.content);
      if (messageText) this.finalText = messageText;
      if (typeof parsed.session_id === "string" && parsed.session_id) {
        this.sessionId = parsed.session_id;
      }
      return;
    }

    if (parsed.type === "user") {
      const blocks = Array.isArray(parsed.message?.content) ? parsed.message.content : [];
      for (const block of blocks) {
        if (!block || block.type !== "tool_result") continue;
        const toolUseId =
          typeof block.tool_use_id === "string" && block.tool_use_id.trim() ? block.tool_use_id.trim()
          : typeof block.toolUseId === "string" && block.toolUseId.trim() ? block.toolUseId.trim()
          : randomUUID();
        const isError = Boolean(block.is_error || block.isError);
        sendStreamEvent(this.webContents, {
          requestId, type: "toolResult", provider: "claude-cli",
          toolUseId, isError, content: block.content, timestamp: Date.now()
        });
      }
      return;
    }

    if (parsed.type === "result") {
      if (typeof parsed.result === "string" && parsed.result.trim()) {
        this.finalText = parsed.result.trim();
      }
      if (typeof parsed.session_id === "string" && parsed.session_id) {
        this.sessionId = parsed.session_id;
      }
      if (parsed.is_error) {
        this.errorSubtype = typeof parsed.subtype === "string" && parsed.subtype
          ? parsed.subtype : "error";
      }
      if (typeof parsed.total_cost_usd === "number" && Number.isFinite(parsed.total_cost_usd)) {
        this.sessionCostUsd = parsed.total_cost_usd;
      }
      if (Array.isArray(parsed.permission_denials) && parsed.permission_denials.length > 0) {
        sendStreamEvent(this.webContents, {
          requestId, type: "permissionDenials", provider: "claude-cli",
          denials: parsed.permission_denials.filter((d) => typeof d === "string" && d.trim())
        });
      }

      const usage = parsed.usage || {};
      const modelUsage = parsed.modelUsage || {};
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

      sendStreamEvent(this.webContents, {
        requestId, type: "status", provider: "claude-cli",
        permissionMode: this.permissionMode || "unknown",
        context: { usedTokens, maxTokens, percent, inputTokens, outputTokens, cacheReadInputTokens, cacheCreationInputTokens }
      });

      this._finishRequest(parsed);
    }
  }

  _finishRequest(resultParsed) {
    if (this.finished) return;
    this.finished = true;

    const requestId = this.requestId;
    activeStreamRequests.delete(requestId);

    if (this.sessionId && typeof this.onSessionId === "function") {
      this.onSessionId(this.sessionId);
    }

    if (this.aborted) {
      sendStreamEvent(this.webContents, { requestId, type: "aborted", provider: "claude-cli" });
      return;
    }

    if (resultParsed?.is_error) {
      const detail = buildClaudeCliErrorDetail(this.stdout, this.stderrBuffer, 1);
      const errorMsg = resultParsed.result || detail;
      if (this.sessionId && isRecoverableResumeError(errorMsg) && typeof this.onSessionReset === "function") {
        this.onSessionReset();
        this.sessionId = "";
      }
      sendStreamEvent(this.webContents, {
        requestId, type: "error",
        error: `Claude CLI failed: ${errorMsg}`,
        errorSubtype: this.errorSubtype || "error",
        provider: "claude-cli"
      });
      return;
    }

    let content = (this.finalText || this.streamedText || "").trim();
    if (!content && isSlashCommandPrompt(this.currentMessage)) {
      const command = this.currentMessage.trim().split(/\s+/)[0] || "/command";
      content = command === "/compact" ? "Compacted." : `${command} executed.`;
    }

    sendStreamEvent(this.webContents, {
      requestId, type: "done", content,
      sessionCostUsd: this.sessionCostUsd, provider: "claude-cli"
    });
  }

  _onProcessDie(code) {
    if (!this.requestId || this.finished) return;
    this.finished = true;

    const requestId = this.requestId;
    activeStreamRequests.delete(requestId);

    if (this.aborted) {
      sendStreamEvent(this.webContents, { requestId, type: "aborted", provider: "claude-cli" });
      return;
    }

    if (this.spawnError) {
      sendStreamEvent(this.webContents, {
        requestId, type: "error",
        error: `Unable to execute Claude CLI: ${this.spawnError}. Install CLI and run "claude login".`,
        provider: "claude-cli"
      });
      return;
    }

    const detail = buildClaudeCliErrorDetail(this.stdout, this.stderrBuffer, code);
    if (this.sessionId && isRecoverableResumeError(detail) && typeof this.onSessionReset === "function") {
      this.onSessionReset();
    }
    sendStreamEvent(this.webContents, {
      requestId, type: "error",
      error: `Claude CLI failed: ${detail}`,
      provider: "claude-cli"
    });
  }
}

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

function buildCliPrompt(messages) {
  const turns = messages
    .filter((message) => message.role === "user" || message.role === "assistant")
    .map((message) => {
      const label = message.role === "user" ? "User" : "Assistant";
      return `${label}: ${message.content}`;
    });

  return `${turns.join("\n\n")}\n\nAssistant:`;
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

function resolveClaudeCliPrompt(messages, resumeSessionId) {
  const latestPrompt = getLatestUserPrompt(messages);
  if (isSlashCommandPrompt(latestPrompt)) {
    return latestPrompt;
  }

  if (latestPrompt) {
    return latestPrompt;
  }

  return buildCliPrompt(messages);
}

function parseClaudeOutput(raw) {
  const trimmed = raw.trim();
  if (!trimmed) {
    return "";
  }

  const lines = trimmed.split("\n").map((line) => line.trim()).filter(Boolean);
  const candidates = [trimmed, ...lines.slice().reverse()];

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);

      if (typeof parsed.result === "string" && parsed.result.trim()) {
        return parsed.result.trim();
      }

      if (typeof parsed.output === "string" && parsed.output.trim()) {
        return parsed.output.trim();
      }

      if (Array.isArray(parsed.content)) {
        const joined = parsed.content
          .filter((part) => part.type === "text")
          .map((part) => part.text)
          .join("\n")
          .trim();
        if (joined) {
          return joined;
        }
      }
    } catch {
      // Expected: trying multiple JSON parse candidates
      continue;
    }
  }

  return trimmed;
}

function parseClaudeErrorSummary(raw) {
  if (typeof raw !== "string" || !raw.trim()) {
    return "";
  }

  const parsed = parseClaudeOutput(raw);
  if (parsed && parsed !== raw.trim()) {
    return parsed;
  }

  const resultMatch = raw.match(/"result"\s*:\s*"([^"]+)"/);
  if (resultMatch && resultMatch[1]) {
    return resultMatch[1];
  }

  const textMatch = raw.match(/"text"\s*:\s*"([^"]+)"/);
  if (textMatch && textMatch[1]) {
    return textMatch[1];
  }

  return "";
}

function buildClaudeCliErrorDetail(stdout, stderr, code) {
  const joined = `${stdout || ""}\n${stderr || ""}`;
  if (/Prompt is too long/i.test(joined)) {
    return "Prompt is too long";
  }

  const fromStdout = parseClaudeErrorSummary(stdout);
  if (fromStdout) {
    return fromStdout;
  }

  const fromStderr = parseClaudeErrorSummary(stderr);
  if (fromStderr) {
    return fromStderr;
  }

  const compactStderr = (stderr || "").replace(/\s+/g, " ").trim();
  if (compactStderr) {
    return compactStderr.length > 320 ? `${compactStderr.slice(0, 317)}...` : compactStderr;
  }

  const compactStdout = (stdout || "").replace(/\s+/g, " ").trim();
  if (compactStdout) {
    return compactStdout.length > 320 ? `${compactStdout.slice(0, 317)}...` : compactStdout;
  }

  return `exit code ${code}`;
}

function parseClaudeResult(raw) {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { content: "", sessionId: "" };
  }

  let sessionId = "";
  let content = "";

  const lines = trimmed.split("\n").map((line) => line.trim()).filter(Boolean);
  const candidates = [trimmed, ...lines.slice().reverse()];
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (typeof parsed.session_id === "string" && parsed.session_id) {
        sessionId = parsed.session_id;
      }

      if (typeof parsed.result === "string" && parsed.result.trim()) {
        content = parsed.result.trim();
      } else if (typeof parsed.output === "string" && parsed.output.trim()) {
        content = parsed.output.trim();
      } else if (Array.isArray(parsed.content)) {
        const joined = parsed.content
          .filter((part) => part.type === "text")
          .map((part) => part.text)
          .join("\n")
          .trim();
        if (joined) {
          content = joined;
        }
      }

      if (content && sessionId) {
        break;
      }
    } catch {
      continue;
    }
  }

  return {
    content: content || parseClaudeOutput(raw),
    sessionId
  };
}

function isRecoverableResumeError(message) {
  if (typeof message !== "string") {
    return false;
  }

  return /session id/i.test(message) && /(not found|does not exist|invalid|expired|cannot)/i.test(message);
}

function shouldApplyEffort(model, effort) {
  if (typeof effort !== "string" || !effort.trim()) {
    return false;
  }
  if (typeof model !== "string" || !model.trim()) {
    return false;
  }

  return /opus/i.test(model);
}

function extractTextFromClaudeMessageContent(content) {
  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .filter((part) => part && part.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("\n")
    .trim();
}

function parsePercentMatch(value) {
  if (typeof value !== "string") {
    return null;
  }
  const match = value.match(/(\d{1,3})\s*%/);
  if (!match) {
    return null;
  }
  const num = Number(match[1]);
  if (!Number.isFinite(num)) {
    return null;
  }
  return Math.max(0, Math.min(100, num));
}

function extractLimitsHint(parsed) {
  if (!parsed || parsed.type !== "system") {
    return null;
  }

  const rawCandidates = [];
  if (typeof parsed.message === "string") {
    rawCandidates.push(parsed.message);
  }
  if (typeof parsed.text === "string") {
    rawCandidates.push(parsed.text);
  }
  if (typeof parsed.warning === "string") {
    rawCandidates.push(parsed.warning);
  }
  if (Array.isArray(parsed.content)) {
    for (const part of parsed.content) {
      if (part && typeof part.text === "string") {
        rawCandidates.push(part.text);
      }
    }
  }

  const combined = rawCandidates.join(" ").replace(/\s+/g, " ").trim();
  if (!combined) {
    return null;
  }

  if (!/(5.?hour|weekly|rate limit|quota|usage limit)/i.test(combined)) {
    return null;
  }

  let fiveHourPercent = null;
  let weeklyPercent = null;

  const fiveHourMatch = combined.match(/(?:5.?hour|session)[^%]{0,40}(\d{1,3})\s*%/i);
  if (fiveHourMatch) {
    fiveHourPercent = parsePercentMatch(fiveHourMatch[0]);
  }

  const weeklyMatch = combined.match(/weekly[^%]{0,40}(\d{1,3})\s*%/i);
  if (weeklyMatch) {
    weeklyPercent = parsePercentMatch(weeklyMatch[0]);
  }

  const warningLevel =
    (fiveHourPercent !== null && fiveHourPercent >= 75) ||
    (weeklyPercent !== null && weeklyPercent >= 75) ||
    /\bwarning|limited|near\b/i.test(combined)
      ? "warning"
      : "info";

  return {
    level: warningLevel,
    message: combined,
    fiveHourPercent,
    weeklyPercent
  };
}

function sendStreamEvent(webContents, payload) {
  if (!webContents || webContents.isDestroyed()) {
    return;
  }

  try {
    webContents.send("chat:streamEvent", payload);
  } catch (error) {
    logError("chat:sendStreamEvent", error);
  }
}

function startClaudeCliStream({
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

  const contextDirs = collectContextDirs(contextFiles || []);
  const allDirs = [
    ...new Set([...(Array.isArray(workspaceDirs) ? workspaceDirs : []), ...contextDirs])
  ];

  // forcedSessionId (used for image context) forces a fresh session
  const desiredSessionId = forcedSessionId
    ? forcedSessionId
    : (currentCliSession?.sessionId || resumeSessionId || "");

  const dirsKey = [...allDirs].sort().join("|");
  const currentDirsKey = [...(currentCliSession?.workspaceDirs ?? [])].sort().join("|");

  const needNewSession =
    !currentCliSession ||
    currentCliSession.dead ||
    currentCliSession.model !== (model || "") ||
    currentDirsKey !== dirsKey ||
    (forcedSessionId && currentCliSession.sessionId !== forcedSessionId) ||
    (resumeSessionId && !forcedSessionId && currentCliSession.sessionId !== resumeSessionId);

  if (needNewSession) {
    if (currentCliSession && !currentCliSession.dead) {
      currentCliSession.kill();
    }
    currentCliSession = new CliSession({
      model: model || "",
      effort: effort || "",
      workspaceDirs: allDirs,
      resumeSessionId: desiredSessionId
    });
  }

  const session = currentCliSession;
  session.setRequest(requestId, webContents, onSessionId, onSessionReset);

  const entry = {
    provider: "claude-cli",
    aborted: false,
    abort: () => {
      entry.aborted = true;
      session.abort();
    }
  };
  activeStreamRequests.set(requestId, entry);

  // Send start event
  sendStreamEvent(webContents, { requestId, type: "start", provider: "claude-cli" });

  // Forward cached init data (slash commands, permission mode) to this request
  if (session.initData) {
    if (session.initData.slashCommands.length > 0) {
      sendStreamEvent(webContents, {
        requestId, type: "slashCommands",
        provider: "claude-cli", commands: session.initData.slashCommands
      });
    }
    if (session.initData.permissionMode) {
      sendStreamEvent(webContents, {
        requestId, type: "status", provider: "claude-cli",
        permissionMode: session.initData.permissionMode, context: null
      });
    }
  }

  session.sendMessage(message);
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

  sendStreamEvent(webContents, {
    requestId,
    type: "start",
    provider: "anthropic-api"
  });
  sendStreamEvent(webContents, {
    requestId,
    type: "status",
    provider: "anthropic-api",
    permissionMode: "api-key",
    context: null
  });

  void (async () => {
    try {
      const content = await runAnthropicApi(messages, model, apiKey, controller.signal);
      const latestEntry = activeStreamRequests.get(requestId);
      if (latestEntry?.aborted) {
        activeStreamRequests.delete(requestId);
        sendStreamEvent(webContents, {
          requestId,
          type: "aborted",
          provider: "anthropic-api"
        });
        return;
      }

      sendStreamEvent(webContents, {
        requestId,
        type: "delta",
        delta: content,
        content,
        provider: "anthropic-api"
      });
      sendStreamEvent(webContents, {
        requestId,
        type: "done",
        content,
        provider: "anthropic-api"
      });
      activeStreamRequests.delete(requestId);
    } catch (error) {
      const latestEntry = activeStreamRequests.get(requestId);
      if (latestEntry?.aborted) {
        activeStreamRequests.delete(requestId);
        sendStreamEvent(webContents, {
          requestId,
          type: "aborted",
          provider: "anthropic-api"
        });
        return;
      }

      activeStreamRequests.delete(requestId);
      sendStreamEvent(webContents, {
        requestId,
        type: "error",
        error: error instanceof Error ? error.message : "Unknown streaming error.",
        provider: "anthropic-api"
      });
    }
  })();
}

function parseChatPayload(payload) {
  if (Array.isArray(payload)) {
    return { messages: payload, effort: "", contextFiles: [] };
  }

  if (!payload || typeof payload !== "object") {
    return { messages: [], effort: "", contextFiles: [] };
  }

  return {
    messages: Array.isArray(payload.messages) ? payload.messages : [],
    effort: typeof payload.effort === "string" ? payload.effort.trim() : "",
    contextFiles: normalizeContextFiles(payload.contextFiles)
  };
}

function runClaudeCli(messages, model, resumeSessionId, effort, contextFiles = [], forcedSessionId = "", workspaceDirs = []) {
  const prompt = resolveClaudeCliPrompt(messages, resumeSessionId);

  return new Promise((resolve, reject) => {
    const args = ["-p", prompt, "--output-format", "json"];
    if (typeof model === "string" && model.trim()) {
      args.push("--model", model.trim());
    }
    if (shouldApplyEffort(model, effort)) {
      args.push("--effort", effort.trim());
    }
    if (typeof resumeSessionId === "string" && resumeSessionId.trim()) {
      args.push("--resume", resumeSessionId.trim());
    }
    if (typeof forcedSessionId === "string" && forcedSessionId.trim()) {
      args.push("--session-id", forcedSessionId.trim());
    }
    const contextDirs = collectContextDirs(contextFiles);
    const addDirs = [...new Set([...workspaceDirs, ...contextDirs])];
    for (const dir of addDirs) {
      args.push("--add-dir", dir);
    }

    const { CLAUDECODE: _cc2, ...safeEnv2 } = process.env;
    const child = spawn("claude", args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: safeEnv2
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      reject(
        new Error(
          `Unable to execute Claude CLI: ${error.message}. Install CLI and run "claude login".`
        )
      );
    });

    child.on("close", (code) => {
      if (code !== 0) {
        const detail = buildClaudeCliErrorDetail(stdout, stderr, code);
        reject(new Error(`Claude CLI failed: ${detail}`));
        return;
      }

      resolve(parseClaudeResult(stdout));
    });
  });
}

function provideToolResponse(requestId, answer) {
  if (!currentCliSession || currentCliSession.dead) return false;
  if (currentCliSession.requestId !== requestId) return false;
  return currentCliSession.provideToolResponse(answer);
}

module.exports = {
  activeStreamRequests,
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
  startClaudeCliStream,
  startAnthropicPseudoStream,
  parseChatPayload,
  runClaudeCli,
  provideToolResponse
};
