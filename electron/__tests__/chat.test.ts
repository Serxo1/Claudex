import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const chat = require("../modules/chat.cjs");

const {
  parseClaudeOutput,
  parseClaudeResult,
  parseClaudeErrorSummary,
  buildClaudeCliErrorDetail,
  isRecoverableResumeError,
  shouldApplyEffort,
  extractLimitsHint,
  parsePercentMatch,
  toAnthropicMessages,
  buildCliPrompt,
  getLatestUserPrompt,
  isSlashCommandPrompt,
  parseChatPayload,
  extractTextFromClaudeMessageContent
} = chat;

describe("toAnthropicMessages", () => {
  it("maps user/assistant messages to Anthropic format", () => {
    const messages = [
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi" }
    ];
    const result = toAnthropicMessages(messages);
    expect(result).toEqual([
      { role: "user", content: [{ type: "text", text: "hello" }] },
      { role: "assistant", content: [{ type: "text", text: "hi" }] }
    ]);
  });

  it("filters out non-user/assistant messages", () => {
    const messages = [
      { role: "system", content: "sys" },
      { role: "user", content: "hi" }
    ];
    expect(toAnthropicMessages(messages)).toHaveLength(1);
  });
});

describe("buildCliPrompt", () => {
  it("formats multi-turn conversation", () => {
    const messages = [
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" }
    ];
    const result = buildCliPrompt(messages);
    expect(result).toBe("User: hi\n\nAssistant: hello\n\nAssistant:");
  });

  it("handles single message", () => {
    const result = buildCliPrompt([{ role: "user", content: "test" }]);
    expect(result).toBe("User: test\n\nAssistant:");
  });
});

describe("getLatestUserPrompt", () => {
  it("returns last user message", () => {
    const messages = [
      { role: "user", content: "first" },
      { role: "assistant", content: "reply" },
      { role: "user", content: "second" }
    ];
    expect(getLatestUserPrompt(messages)).toBe("second");
  });

  it("returns empty string when no user messages", () => {
    expect(getLatestUserPrompt([{ role: "assistant", content: "hi" }])).toBe("");
    expect(getLatestUserPrompt([])).toBe("");
  });

  it("skips empty user messages", () => {
    const messages = [
      { role: "user", content: "first" },
      { role: "user", content: "   " }
    ];
    expect(getLatestUserPrompt(messages)).toBe("first");
  });
});

describe("isSlashCommandPrompt", () => {
  it("returns true for slash commands", () => {
    expect(isSlashCommandPrompt("/compact")).toBe(true);
    expect(isSlashCommandPrompt("  /review  ")).toBe(true);
  });

  it("returns false for regular text", () => {
    expect(isSlashCommandPrompt("hello")).toBe(false);
    expect(isSlashCommandPrompt("")).toBe(false);
    expect(isSlashCommandPrompt(123)).toBe(false);
  });
});

describe("parseClaudeOutput", () => {
  it("returns empty for blank input", () => {
    expect(parseClaudeOutput("")).toBe("");
    expect(parseClaudeOutput("   ")).toBe("");
  });

  it("extracts result field from JSON", () => {
    expect(parseClaudeOutput('{"result": "hello"}')).toBe("hello");
  });

  it("extracts output field from JSON", () => {
    expect(parseClaudeOutput('{"output": "world"}')).toBe("world");
  });

  it("extracts text from content array", () => {
    const json = JSON.stringify({
      content: [{ type: "text", text: "from content" }]
    });
    expect(parseClaudeOutput(json)).toBe("from content");
  });

  it("returns raw text for non-JSON", () => {
    expect(parseClaudeOutput("plain text")).toBe("plain text");
  });

  it("parses last-line JSON when full text is not valid JSON", () => {
    const raw = "some junk\n" + JSON.stringify({ result: "found" });
    expect(parseClaudeOutput(raw)).toBe("found");
  });
});

describe("parseClaudeResult", () => {
  it("returns empty for blank", () => {
    expect(parseClaudeResult("")).toEqual({ content: "", sessionId: "" });
  });

  it("extracts content and sessionId", () => {
    const json = JSON.stringify({
      result: "answer",
      session_id: "abc-123"
    });
    expect(parseClaudeResult(json)).toEqual({
      content: "answer",
      sessionId: "abc-123"
    });
  });

  it("extracts output field", () => {
    const json = JSON.stringify({ output: "hi", session_id: "sid" });
    expect(parseClaudeResult(json)).toEqual({ content: "hi", sessionId: "sid" });
  });

  it("extracts from content array", () => {
    const json = JSON.stringify({
      content: [{ type: "text", text: "msg" }],
      session_id: "s1"
    });
    expect(parseClaudeResult(json)).toEqual({ content: "msg", sessionId: "s1" });
  });
});

describe("parseClaudeErrorSummary", () => {
  it("returns empty for blank", () => {
    expect(parseClaudeErrorSummary("")).toBe("");
    expect(parseClaudeErrorSummary(null)).toBe("");
  });

  it("extracts from JSON result", () => {
    expect(parseClaudeErrorSummary('{"result": "err msg"}')).toBe("err msg");
  });

  it("extracts from regex match on result field", () => {
    const raw = 'some garbage "result": "found it" more garbage';
    expect(parseClaudeErrorSummary(raw)).toBe("found it");
  });

  it("extracts from regex match on text field", () => {
    const raw = 'garbage "text": "text value" more';
    expect(parseClaudeErrorSummary(raw)).toBe("text value");
  });
});

describe("buildClaudeCliErrorDetail", () => {
  it("detects prompt too long", () => {
    expect(buildClaudeCliErrorDetail("Prompt is too long", "", 1)).toBe("Prompt is too long");
    expect(buildClaudeCliErrorDetail("", "Prompt is too long", 1)).toBe("Prompt is too long");
  });

  it("parses error from stdout", () => {
    expect(buildClaudeCliErrorDetail('{"result": "bad"}', "", 1)).toBe("bad");
  });

  it("falls back to stderr", () => {
    expect(buildClaudeCliErrorDetail("", "something went wrong", 1)).toBe("something went wrong");
  });

  it("truncates long stderr", () => {
    const long = "x".repeat(400);
    const result = buildClaudeCliErrorDetail("", long, 1);
    expect(result.length).toBe(320);
    expect(result.endsWith("...")).toBe(true);
  });

  it("falls back to exit code", () => {
    expect(buildClaudeCliErrorDetail("", "", 42)).toBe("exit code 42");
  });
});

describe("isRecoverableResumeError", () => {
  it("returns true for session-related errors", () => {
    expect(isRecoverableResumeError("session id not found")).toBe(true);
    expect(isRecoverableResumeError("Session ID does not exist")).toBe(true);
    expect(isRecoverableResumeError("session id invalid")).toBe(true);
    expect(isRecoverableResumeError("session id expired")).toBe(true);
  });

  it("returns false for other errors", () => {
    expect(isRecoverableResumeError("network error")).toBe(false);
    expect(isRecoverableResumeError("")).toBe(false);
    expect(isRecoverableResumeError(null)).toBe(false);
  });
});

describe("shouldApplyEffort", () => {
  it("returns true for opus model with effort", () => {
    expect(shouldApplyEffort("claude-opus-4-6", "high")).toBe(true);
  });

  it("returns false for non-opus model", () => {
    expect(shouldApplyEffort("claude-sonnet-4-5", "high")).toBe(false);
  });

  it("returns false for empty effort", () => {
    expect(shouldApplyEffort("claude-opus-4-6", "")).toBe(false);
    expect(shouldApplyEffort("claude-opus-4-6", null)).toBe(false);
  });

  it("returns false for empty model", () => {
    expect(shouldApplyEffort("", "high")).toBe(false);
    expect(shouldApplyEffort(null, "high")).toBe(false);
  });
});

describe("parsePercentMatch", () => {
  it("extracts percentage from string", () => {
    expect(parsePercentMatch("75%")).toBe(75);
    expect(parsePercentMatch("used 50 %")).toBe(50);
  });

  it("clamps to 0-100", () => {
    expect(parsePercentMatch("150%")).toBe(100);
    expect(parsePercentMatch("0%")).toBe(0);
  });

  it("returns null for no match", () => {
    expect(parsePercentMatch("no percent")).toBeNull();
    expect(parsePercentMatch(null)).toBeNull();
    expect(parsePercentMatch(123 as unknown as string)).toBeNull();
  });
});

describe("extractLimitsHint", () => {
  it("returns null for non-system messages", () => {
    expect(extractLimitsHint(null)).toBeNull();
    expect(extractLimitsHint({ type: "assistant" })).toBeNull();
  });

  it("returns null when no limit keywords present", () => {
    expect(extractLimitsHint({ type: "system", message: "hello" })).toBeNull();
  });

  it("extracts 5-hour percent", () => {
    const result = extractLimitsHint({
      type: "system",
      message: "5-hour usage at 80%"
    });
    expect(result).not.toBeNull();
    expect(result!.fiveHourPercent).toBe(80);
    expect(result!.level).toBe("warning");
  });

  it("extracts weekly percent", () => {
    const result = extractLimitsHint({
      type: "system",
      message: "weekly usage at 30%"
    });
    expect(result).not.toBeNull();
    expect(result!.weeklyPercent).toBe(30);
    expect(result!.level).toBe("info");
  });

  it("marks warning when percent >= 75", () => {
    const result = extractLimitsHint({
      type: "system",
      message: "weekly usage at 80%"
    });
    expect(result!.level).toBe("warning");
  });

  it("marks warning when 'warning' keyword present", () => {
    const result = extractLimitsHint({
      type: "system",
      message: "rate limit warning"
    });
    expect(result!.level).toBe("warning");
  });
});

describe("extractTextFromClaudeMessageContent", () => {
  it("joins text parts", () => {
    const content = [
      { type: "text", text: "hello" },
      { type: "text", text: "world" }
    ];
    expect(extractTextFromClaudeMessageContent(content)).toBe("hello\nworld");
  });

  it("filters non-text parts", () => {
    const content = [
      { type: "tool_use", name: "test" },
      { type: "text", text: "only text" }
    ];
    expect(extractTextFromClaudeMessageContent(content)).toBe("only text");
  });

  it("returns empty for non-array", () => {
    expect(extractTextFromClaudeMessageContent(null)).toBe("");
    expect(extractTextFromClaudeMessageContent("string")).toBe("");
  });
});

describe("parseChatPayload", () => {
  it("handles array input as messages", () => {
    const arr = [{ role: "user", content: "hi" }];
    expect(parseChatPayload(arr)).toEqual({
      messages: arr,
      effort: "",
      contextFiles: []
    });
  });

  it("handles null/invalid input", () => {
    expect(parseChatPayload(null)).toEqual({
      messages: [],
      effort: "",
      contextFiles: []
    });
  });

  it("extracts messages, effort, contextFiles from object", () => {
    const payload = {
      messages: [{ role: "user", content: "test" }],
      effort: " high ",
      contextFiles: [
        { absolutePath: "/foo/bar.ts", relativePath: "bar.ts" }
      ]
    };
    const result = parseChatPayload(payload);
    expect(result.messages).toHaveLength(1);
    expect(result.effort).toBe("high");
    expect(result.contextFiles).toHaveLength(1);
    expect(result.contextFiles[0].absolutePath).toBe("/foo/bar.ts");
  });
});
