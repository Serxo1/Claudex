// ---------------------------------------------------------------------------
// chat-anthropic.cjs — Anthropic API pseudo-stream
// ---------------------------------------------------------------------------

const { ANTHROPIC_API_URL, ANTHROPIC_API_VERSION, MAX_TOKENS_DEFAULT } = require("./constants.cjs");
const { sendStreamEvent } = require("./chat-utils.cjs");

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

function startAnthropicPseudoStream({ webContents, requestId, messages, model, apiKey, activeStreamRequests }) {
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

module.exports = {
  toAnthropicMessages,
  runAnthropicApi,
  startAnthropicPseudoStream
};
