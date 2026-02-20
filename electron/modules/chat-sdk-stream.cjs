// ---------------------------------------------------------------------------
// chat-sdk-stream.cjs — SDK streaming via @anthropic-ai/claude-agent-sdk
// ---------------------------------------------------------------------------

const { randomUUID } = require("node:crypto");

const { collectContextDirs } = require("./workspace.cjs");
const {
  logSDKStart,
  logSDKTool,
  logSDKToolResult,
  logSDKSubagentStart,
  logSDKSubagentDone,
  logSDKDone,
  logSDKAborted
} = require("./logger.cjs");
const { CONTEXT_WINDOW_DEFAULT } = require("./constants.cjs");
const { getPluginConfigs } = require("./skills.cjs");
const {
  sendStreamEvent,
  getLatestUserPrompt,
  isSlashCommandPrompt,
  isRecoverableResumeError,
  shouldApplyEffort,
  extractTextFromClaudeMessageContent,
  extractLimitsHint
} = require("./chat-utils.cjs");

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
  onSessionReset,
  activeStreamRequests,
  pendingApprovals,
  getSdk,
  resolveClaudeCodeCliPath
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

  logSDKStart(requestId, model, cwd, message);

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
  // Track per-call context window usage from message_start (NOT cumulative result.usage)
  let latestCallInputTokens = 0;
  let latestCallCacheReadTokens = 0;
  let latestCallCacheCreationTokens = 0;
  let latestCallOutputTokens = 0;
  // SDK session log tracking
  const sessionStartMs = Date.now();
  const toolInfo = new Map(); // toolUseId -> { name, startMs }
  let activeTaskDepth = 0; // indentation level: >0 means inside a Task execution

  const { query } = await getSdk();

  try {
    const pluginConfigs = getPluginConfigs();
    const pathToClaudeCodeExecutable = resolveClaudeCodeCliPath();
    const sdkOptions = {
      model: model || undefined,
      cwd,
      additionalDirectories: additionalDirectories.length > 0 ? additionalDirectories : undefined,
      resume: resumeSessionId || undefined,
      sessionId: forcedSessionId || undefined,
      abortController,
      includePartialMessages: true,
      canUseTool,
      plugins: pluginConfigs.length > 0 ? pluginConfigs : undefined,
      settingSources: ["user"],
      ...(pathToClaudeCodeExecutable ? { pathToClaudeCodeExecutable } : {})
    };

    if (shouldApplyEffort(model, effort)) {
      sdkOptions.effortLevel = effort;
    }

    const q = query({ prompt: message, options: sdkOptions });

    // Resolve session info in parallel — does not block the stream
    if (typeof q.initializationResult === "function") {
      q.initializationResult().then((info) => {
        if (!info) return;
        const models = Array.isArray(info.models)
          ? info.models
              .map((m) => {
                // Prefer the actual model ID (e.g. "claude-opus-4-6") over a display-style value
                const modelId = m.modelId || m.id || m.value || "";
                const displayName = m.displayName || m.label || m.name || m.value || modelId;
                return {
                  value: modelId,
                  displayName,
                  description: m.description || "",
                  supportsMaxEffort: /opus/i.test(modelId)
                };
              })
              .filter((m) => m.value)
          : [];
        sendStreamEvent(webContents, {
          requestId, type: "sessionInfo",
          models, account: info.account || {}
        });
      }).catch(() => {});
    }

    for await (const msg of q) {
      if (entry.aborted) break;

      if (msg.type === "auth_status") {
        sendStreamEvent(webContents, {
          requestId, type: "authStatus",
          isAuthenticating: Boolean(msg.isAuthenticating),
          error: typeof msg.error === "string" ? msg.error : undefined
        });
        continue;
      }

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

      if (msg.type === "system" && msg.subtype === "task_started") {
        const taskId = typeof msg.task_id === "string" ? msg.task_id : String(Date.now());
        const desc = typeof msg.description === "string" && msg.description.trim()
          ? msg.description.trim() : "Subagente a executar...";
        logSDKSubagentStart(taskId, desc);
        sendStreamEvent(webContents, {
          requestId, type: "subagentStart", provider: "claude-cli",
          taskId,
          description: desc,
          toolUseId: typeof msg.tool_use_id === "string" ? msg.tool_use_id : null
        });
        continue;
      }

      if (msg.type === "system" && msg.subtype === "task_notification") {
        const taskStatus = msg.status === "failed" || msg.status === "stopped"
          ? msg.status : "completed";
        const summary = typeof msg.summary === "string" ? msg.summary.trim() : "";
        const taskId = typeof msg.task_id === "string" ? msg.task_id : "";
        logSDKSubagentDone(taskId, taskStatus, summary);
        sendStreamEvent(webContents, {
          requestId, type: "subagentDone", provider: "claude-cli",
          taskId,
          status: taskStatus,
          summary
        });
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

        // Capture per-call input tokens from message_start (resets each API call)
        if (ev?.type === "message_start" && ev.message?.usage) {
          const u = ev.message.usage;
          latestCallInputTokens = Number(u.input_tokens) || 0;
          latestCallCacheReadTokens = Number(u.cache_read_input_tokens) || 0;
          latestCallCacheCreationTokens = Number(u.cache_creation_input_tokens) || 0;
          latestCallOutputTokens = 0; // reset for this call
        }

        // Capture per-call output tokens from message_delta
        if (ev?.type === "message_delta" && ev.usage) {
          latestCallOutputTokens = Number(ev.usage.output_tokens) || 0;
        }

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
          const toolName = block.name || "tool";
          toolInfo.set(toolUseId, { name: toolName, startMs: Date.now() });
          // Build a short summary for the log
          const inp = block.input && typeof block.input === "object" ? block.input : {};
          let inputLog = "";
          if (toolName === "Task") {
            const agentName = inp.name ? `[${inp.name}] ` : "";
            inputLog = `${agentName}${inp.description || inp.prompt?.slice(0, 60) || ""}`;
          } else if (toolName === "TeamCreate") {
            inputLog = `team_name=${inp.team_name || "?"}`;
          } else {
            const keys = Object.keys(inp).slice(0, 2);
            inputLog = keys.map((k) => `${k}=${String(inp[k]).slice(0, 30)}`).join(" ");
          }
          const logDepth = activeTaskDepth;
          if (toolName === "Task" || toolName === "TeamCreate") activeTaskDepth++;
          logSDKTool(requestId, toolName, inputLog, logDepth);
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
          const tInfo = toolInfo.get(toolUseId) || { name: "tool", startMs: null };
          const durationMs = tInfo.startMs ? Date.now() - tInfo.startMs : null;
          if (tInfo.name === "Task" || tInfo.name === "TeamCreate") {
            activeTaskDepth = Math.max(0, activeTaskDepth - 1);
          }
          toolInfo.delete(toolUseId);
          // Extract a brief result text for the log
          let resultLog = "";
          if (Array.isArray(block.content)) {
            const textBlock = block.content.find((b) => b.type === "text");
            resultLog = textBlock?.text?.slice(0, 80) || "";
          } else if (typeof block.content === "string") {
            resultLog = block.content.slice(0, 80);
          }
          logSDKToolResult(requestId, tInfo.name, Boolean(block.is_error), resultLog, durationMs, activeTaskDepth);
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

        // Token usage — use per-call values from message_start/message_delta stream events.
        // msg.usage is CUMULATIVE across all API calls in the session and would give >100%.
        const modelUsage = msg.modelUsage || {};
        const primaryModel = Object.values(modelUsage)[0];
        const maxTokens = primaryModel && Number.isFinite(primaryModel.contextWindow)
          ? Number(primaryModel.contextWindow) : CONTEXT_WINDOW_DEFAULT;
        const inputTokens = latestCallInputTokens;
        const outputTokens = latestCallOutputTokens;
        const cacheReadInputTokens = latestCallCacheReadTokens;
        const cacheCreationInputTokens = latestCallCacheCreationTokens;
        // Context window usage = input tokens only (fresh + cache read/write).
        // Output tokens are generated by the model and do NOT consume the input context window.
        const usedTokens = inputTokens + cacheReadInputTokens + cacheCreationInputTokens;
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

        const totalIn = (msg.usage?.input_tokens ?? latestCallInputTokens) || 0;
        const totalOut = (msg.usage?.output_tokens ?? latestCallOutputTokens) || 0;

        if (msg.is_error) {
          const errorMsg = msg.result || (Array.isArray(msg.errors) ? msg.errors.join(", ") : "Unknown error");
          if (sessionId && isRecoverableResumeError(errorMsg) && typeof onSessionReset === "function") {
            onSessionReset();
          }
          logSDKDone(requestId, Date.now() - sessionStartMs, totalIn, totalOut, sessionCostUsd, true);
          sendStreamEvent(webContents, {
            requestId, type: "error",
            error: `Claude CLI failed: ${errorMsg}`,
            errorSubtype: msg.subtype || "error",
            provider: "claude-cli"
          });
          return;
        }

        let content = (streamedText || finalText || "").trim();
        if (!content && isSlashCommandPrompt(message)) {
          const command = message.trim().split(/\s+/)[0] || "/command";
          content = command === "/compact" ? "Compacted." : `${command} executed.`;
        }

        logSDKDone(requestId, Date.now() - sessionStartMs, totalIn, totalOut, sessionCostUsd, false);
        sendStreamEvent(webContents, {
          requestId, type: "done",
          content, sessionCostUsd,
          sessionId: sessionId || undefined,
          provider: "claude-cli"
        });
      }
    }
  } catch (err) {
    activeStreamRequests.delete(requestId);
    if (entry.aborted) {
      logSDKAborted(requestId);
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

module.exports = { startSDKStream };
