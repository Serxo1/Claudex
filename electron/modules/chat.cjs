const { randomUUID } = require("node:crypto");
const { spawn } = require("node:child_process");

const { collectContextDirs, normalizeContextFiles } = require("./workspace.cjs");
const { logError } = require("./logger.cjs");
const { ANTHROPIC_API_URL, ANTHROPIC_API_VERSION, MAX_TOKENS_DEFAULT, CONTEXT_WINDOW_DEFAULT } = require("./constants.cjs");

const activeStreamRequests = new Map();

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
  const prompt = resolveClaudeCliPrompt(messages, resumeSessionId);
  const args = [
    "-p",
    prompt,
    "--output-format",
    "stream-json",
    "--include-partial-messages",
    "--verbose"
  ];

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
  const contextDirs = collectContextDirs(contextFiles || []);
  const addDirs = [...new Set([...(Array.isArray(workspaceDirs) ? workspaceDirs : []), ...contextDirs])];
  for (const dir of addDirs) {
    args.push("--add-dir", dir);
  }

  const { CLAUDECODE: _cc, ...safeEnv } = process.env;
  const child = spawn("claude", args, {
    stdio: ["ignore", "pipe", "pipe"],
    env: safeEnv
  });

  const entry = {
    provider: "claude-cli",
    aborted: false,
    abort: () => {
      entry.aborted = true;
      child.kill("SIGTERM");
    }
  };
  activeStreamRequests.set(requestId, entry);

  sendStreamEvent(webContents, {
    requestId,
    type: "start",
    provider: "claude-cli"
  });

  let stdout = "";
  let stderr = "";
  let buffer = "";
  let streamedText = "";
  let finalText = "";
  let sessionId = "";
  let permissionMode = "";
  let finished = false;
  let errorSubtype = "";
  let sessionCostUsd = null;

  const finish = (eventPayload) => {
    if (finished) {
      return;
    }
    finished = true;
    activeStreamRequests.delete(requestId);
    sendStreamEvent(webContents, eventPayload);
  };

  const handleLine = (line) => {
    if (!line) {
      return;
    }

    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      return;
    }

    if (typeof parsed.session_id === "string" && parsed.session_id) {
      sessionId = parsed.session_id;
    }

    if (parsed.type === "system" && parsed.subtype === "init") {
      const slashCommands = Array.isArray(parsed.slash_commands)
        ? parsed.slash_commands.filter((command) => typeof command === "string" && command.trim())
        : [];
      if (slashCommands.length > 0) {
        sendStreamEvent(webContents, {
          requestId,
          type: "slashCommands",
          provider: "claude-cli",
          commands: slashCommands
        });
      }
      if (typeof parsed.permissionMode === "string" && parsed.permissionMode) {
        permissionMode = parsed.permissionMode;
        sendStreamEvent(webContents, {
          requestId,
          type: "status",
          provider: "claude-cli",
          permissionMode,
          context: null
        });
      }
      return;
    }

    if (parsed.type === "system" && parsed.subtype === "compact_boundary") {
      sendStreamEvent(webContents, {
        requestId,
        type: "compactBoundary",
        provider: "claude-cli"
      });
      return;
    }

    if (parsed.type === "system") {
      const limitsHint = extractLimitsHint(parsed);
      if (limitsHint) {
        sendStreamEvent(webContents, {
          requestId,
          type: "limits",
          provider: "claude-cli",
          level: limitsHint.level,
          message: limitsHint.message,
          fiveHourPercent: limitsHint.fiveHourPercent,
          weeklyPercent: limitsHint.weeklyPercent
        });
      }
    }

    if (
      parsed.type === "stream_event" &&
      parsed.event?.type === "content_block_delta" &&
      parsed.event?.delta?.type === "text_delta"
    ) {
      const delta = typeof parsed.event.delta.text === "string" ? parsed.event.delta.text : "";
      if (!delta) {
        return;
      }

      streamedText += delta;
      sendStreamEvent(webContents, {
        requestId,
        type: "delta",
        delta,
        content: streamedText,
        provider: "claude-cli"
      });
      return;
    }

    if (parsed.type === "assistant") {
      const blocks = Array.isArray(parsed.message?.content) ? parsed.message.content : [];
      for (const block of blocks) {
        if (!block || block.type !== "tool_use") {
          continue;
        }
        const toolUseId =
          typeof block.id === "string" && block.id.trim()
            ? block.id.trim()
            : typeof block.tool_use_id === "string" && block.tool_use_id.trim()
              ? block.tool_use_id.trim()
              : randomUUID();
        const name = typeof block.name === "string" && block.name.trim() ? block.name.trim() : "tool";
        const input =
          block.input && typeof block.input === "object" && !Array.isArray(block.input) ? block.input : null;

        sendStreamEvent(webContents, {
          requestId,
          type: "toolUse",
          provider: "claude-cli",
          toolUseId,
          name,
          input,
          timestamp: Date.now()
        });
      }

      const messageText = extractTextFromClaudeMessageContent(parsed.message?.content);
      if (messageText) {
        finalText = messageText;
      }

      if (typeof parsed.session_id === "string" && parsed.session_id) {
        sessionId = parsed.session_id;
      }
      return;
    }

    if (parsed.type === "user") {
      const blocks = Array.isArray(parsed.message?.content) ? parsed.message.content : [];
      for (const block of blocks) {
        if (!block || block.type !== "tool_result") {
          continue;
        }
        const toolUseId =
          typeof block.tool_use_id === "string" && block.tool_use_id.trim()
            ? block.tool_use_id.trim()
            : typeof block.toolUseId === "string" && block.toolUseId.trim()
              ? block.toolUseId.trim()
              : randomUUID();
        const isError = Boolean(block.is_error || block.isError);

        sendStreamEvent(webContents, {
          requestId,
          type: "toolResult",
          provider: "claude-cli",
          toolUseId,
          isError,
          content: block.content,
          timestamp: Date.now()
        });
      }
      return;
    }

    if (parsed.type === "result") {
      if (typeof parsed.result === "string" && parsed.result.trim()) {
        finalText = parsed.result.trim();
      }
      if (typeof parsed.session_id === "string" && parsed.session_id) {
        sessionId = parsed.session_id;
      }

      if (parsed.is_error) {
        errorSubtype = typeof parsed.subtype === "string" && parsed.subtype ? parsed.subtype : "error";
      }

      if (typeof parsed.total_cost_usd === "number" && Number.isFinite(parsed.total_cost_usd)) {
        sessionCostUsd = parsed.total_cost_usd;
      }

      if (Array.isArray(parsed.permission_denials) && parsed.permission_denials.length > 0) {
        sendStreamEvent(webContents, {
          requestId,
          type: "permissionDenials",
          provider: "claude-cli",
          denials: parsed.permission_denials.filter((d) => typeof d === "string" && d.trim())
        });
      }

      const usage = parsed.usage || {};
      const modelUsage = parsed.modelUsage || {};
      const primaryModel = Object.values(modelUsage)[0];
      const maxTokens =
        primaryModel && Number.isFinite(primaryModel.contextWindow)
          ? Number(primaryModel.contextWindow)
          : CONTEXT_WINDOW_DEFAULT;
      const inputTokens = Number(usage.input_tokens) || 0;
      const outputTokens = Number(usage.output_tokens) || 0;
      const cacheReadInputTokens = Number(usage.cache_read_input_tokens) || 0;
      const cacheCreationInputTokens = Number(usage.cache_creation_input_tokens) || 0;
      const usedTokens = inputTokens + outputTokens + cacheReadInputTokens + cacheCreationInputTokens;
      const percent =
        maxTokens > 0 ? Math.max(0, Math.min(100, Math.round((usedTokens / maxTokens) * 100))) : 0;

      sendStreamEvent(webContents, {
        requestId,
        type: "status",
        provider: "claude-cli",
        permissionMode: permissionMode || "unknown",
        context: {
          usedTokens,
          maxTokens,
          percent,
          inputTokens,
          outputTokens,
          cacheReadInputTokens,
          cacheCreationInputTokens
        }
      });
    }
  };

  child.stdout.on("data", (chunk) => {
    const text = chunk.toString();
    stdout += text;
    buffer += text;

    let newlineIndex = buffer.indexOf("\n");
    while (newlineIndex >= 0) {
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);
      handleLine(line);
      newlineIndex = buffer.indexOf("\n");
    }
  });

  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  child.on("error", (error) => {
    finish({
      requestId,
      type: "error",
      error: `Unable to execute Claude CLI: ${error.message}. Install CLI and run "claude login".`,
      provider: "claude-cli"
    });
  });

  child.on("close", (code) => {
    const pendingLine = buffer.trim();
    if (pendingLine) {
      handleLine(pendingLine);
    }

    const latestEntry = activeStreamRequests.get(requestId) || entry;
    if (latestEntry.aborted) {
      finish({
        requestId,
        type: "aborted",
        provider: "claude-cli"
      });
      return;
    }

    if (code !== 0) {
      const detail = buildClaudeCliErrorDetail(stdout, stderr, code);
      if (resumeSessionId && isRecoverableResumeError(detail) && typeof onSessionReset === "function") {
        onSessionReset();
      }
      finish({
        requestId,
        type: "error",
        error: `Claude CLI failed: ${detail}`,
        errorSubtype: errorSubtype || "error",
        provider: "claude-cli"
      });
      return;
    }

    let content = (finalText || streamedText || "").trim();
    if (!content && isSlashCommandPrompt(prompt)) {
      const command = prompt.trim().split(/\s+/)[0] || "/command";
      content = command === "/compact" ? "Compacted." : `${command} executed.`;
    }
    if (sessionId && typeof onSessionId === "function") {
      onSessionId(sessionId);
    }
    finish({
      requestId,
      type: "done",
      content,
      sessionCostUsd,
      provider: "claude-cli"
    });
  });
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
  const entry = activeStreamRequests.get(requestId);
  if (!entry || !entry.stdin || entry.aborted) return false;
  try {
    entry.stdin.write(`${answer}\n`);
    return true;
  } catch {
    return false;
  }
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
