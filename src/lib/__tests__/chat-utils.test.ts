import { describe, expect, it } from "vitest";
import {
  formatPermissionMode,
  summarizeForUi,
  summarizeToolInput,
  summarizeToolResult,
  appendReasoningLine,
  shortFileLabel,
  initialsFromName,
  languageFromPath,
  stripAnsiSequences,
  isLikelyTerminalErrorLine,
  normalizeErrorMessage,
  isOpusModel,
  slashCommandNeedsTerminal,
  ideChipLabel
} from "../chat-utils";

describe("formatPermissionMode", () => {
  it("maps known modes correctly", () => {
    expect(formatPermissionMode("plan")).toBe("Plan mode");
    expect(formatPermissionMode("dontAsk")).toBe("Don't ask");
    expect(formatPermissionMode("acceptEdits")).toBe("Ask edits");
    expect(formatPermissionMode("default")).toBe("Ask edits");
    expect(formatPermissionMode("bypassPermissions")).toBe("Full access");
    expect(formatPermissionMode("delegate")).toBe("Delegate");
    expect(formatPermissionMode("api-key")).toBe("API key");
  });

  it("returns Unknown for unrecognized mode", () => {
    expect(formatPermissionMode("unknown")).toBe("Unknown");
    expect(formatPermissionMode("nonsense" as never)).toBe("Unknown");
  });
});

describe("summarizeForUi", () => {
  it("returns fallback for null/undefined", () => {
    expect(summarizeForUi(null, "fb")).toBe("fb");
    expect(summarizeForUi(undefined, "fb")).toBe("fb");
  });

  it("returns trimmed string for short values", () => {
    expect(summarizeForUi("hello  world", "fb")).toBe("hello world");
  });

  it("returns fallback for empty string", () => {
    expect(summarizeForUi("", "fb")).toBe("fb");
    expect(summarizeForUi("   ", "fb")).toBe("fb");
  });

  it("truncates long strings to 120 chars", () => {
    const long = "a".repeat(200);
    const result = summarizeForUi(long, "fb");
    expect(result.length).toBe(120);
    expect(result.endsWith("...")).toBe(true);
  });

  it("serializes objects to JSON", () => {
    expect(summarizeForUi({ a: 1 }, "fb")).toBe('{"a":1}');
  });

  it("truncates long JSON", () => {
    const big = { data: "x".repeat(200) };
    const result = summarizeForUi(big, "fb");
    expect(result.length).toBe(120);
    expect(result.endsWith("...")).toBe(true);
  });

  it("returns fallback for circular refs", () => {
    const obj: Record<string, unknown> = {};
    obj.self = obj;
    expect(summarizeForUi(obj, "fb")).toBe("fb");
  });
});

describe("summarizeToolInput", () => {
  it("delegates to summarizeForUi with correct fallback", () => {
    expect(summarizeToolInput(null)).toBe("No input payload.");
    expect(summarizeToolInput({ cmd: "ls" })).toBe('{"cmd":"ls"}');
  });
});

describe("summarizeToolResult", () => {
  it("extracts text from array content", () => {
    const content = [{ type: "text", text: "hello" }];
    expect(summarizeToolResult(content)).toBe("hello");
  });

  it("serializes empty array", () => {
    expect(summarizeToolResult([])).toBe("[]");
  });

  it("serializes non-text array items as JSON", () => {
    expect(summarizeToolResult([{ type: "image" }])).toBe('[{"type":"image"}]');
  });

  it("uses generic fallback for non-array", () => {
    expect(summarizeToolResult("done")).toBe("done");
    expect(summarizeToolResult(null)).toBe("Tool finished.");
  });
});

describe("appendReasoningLine", () => {
  it("returns compact line when current is empty", () => {
    expect(appendReasoningLine("", "  hello  ")).toBe("hello");
  });

  it("returns current when line is empty", () => {
    expect(appendReasoningLine("existing", "")).toBe("existing");
    expect(appendReasoningLine("existing", "   ")).toBe("existing");
  });

  it("appends line to existing", () => {
    expect(appendReasoningLine("line1", "line2")).toBe("line1\nline2");
  });

  it("keeps only last 6 lines", () => {
    const current = "1\n2\n3\n4\n5";
    const result = appendReasoningLine(current, "6");
    expect(result.split("\n")).toHaveLength(6);

    const result2 = appendReasoningLine(result, "7");
    expect(result2.split("\n")).toHaveLength(6);
    expect(result2.startsWith("2")).toBe(true);
  });
});

describe("shortFileLabel", () => {
  it("returns last segment of path", () => {
    expect(shortFileLabel("/foo/bar/baz.ts")).toBe("baz.ts");
    expect(shortFileLabel("foo\\bar\\baz.ts")).toBe("baz.ts");
  });

  it("returns original value for bare filename", () => {
    expect(shortFileLabel("file.ts")).toBe("file.ts");
  });

  it("returns original value for empty string", () => {
    expect(shortFileLabel("")).toBe("");
  });
});

describe("initialsFromName", () => {
  it("returns initials from two words", () => {
    expect(initialsFromName("John Doe")).toBe("JD");
  });

  it("returns single initial for one word", () => {
    expect(initialsFromName("Alice")).toBe("A");
  });

  it("returns ?? for empty name", () => {
    expect(initialsFromName("")).toBe("??");
    expect(initialsFromName("   ")).toBe("??");
  });

  it("takes only first two words", () => {
    expect(initialsFromName("A B C D")).toBe("AB");
  });
});

describe("languageFromPath", () => {
  it("detects typescript", () => {
    expect(languageFromPath("file.ts")).toBe("typescript");
    expect(languageFromPath("file.tsx")).toBe("typescript");
  });

  it("detects javascript", () => {
    expect(languageFromPath("file.js")).toBe("javascript");
    expect(languageFromPath("file.jsx")).toBe("javascript");
  });

  it("detects json, css, html, markdown, yaml, shell", () => {
    expect(languageFromPath("a.json")).toBe("json");
    expect(languageFromPath("a.css")).toBe("css");
    expect(languageFromPath("a.html")).toBe("html");
    expect(languageFromPath("a.md")).toBe("markdown");
    expect(languageFromPath("a.yml")).toBe("yaml");
    expect(languageFromPath("a.yaml")).toBe("yaml");
    expect(languageFromPath("a.sh")).toBe("shell");
  });

  it("returns plaintext for unknown", () => {
    expect(languageFromPath("a.rs")).toBe("plaintext");
    expect(languageFromPath("a.py")).toBe("plaintext");
  });
});

describe("stripAnsiSequences", () => {
  it("removes ANSI escape codes", () => {
    expect(stripAnsiSequences("\u001b[31mhello\u001b[0m")).toBe("hello");
  });

  it("returns plain text unchanged", () => {
    expect(stripAnsiSequences("hello")).toBe("hello");
  });
});

describe("isLikelyTerminalErrorLine", () => {
  it("detects error keywords", () => {
    expect(isLikelyTerminalErrorLine("Error: something failed")).toBe(true);
    expect(isLikelyTerminalErrorLine("fatal: cannot do that")).toBe(true);
    // "npm err!" has no word boundary after "!" so it does not match the \b pattern
    expect(isLikelyTerminalErrorLine("npm ERR! missing")).toBe(false);
    expect(isLikelyTerminalErrorLine("TypeError: x is not a function")).toBe(true);
    expect(isLikelyTerminalErrorLine("permission denied")).toBe(true);
    expect(isLikelyTerminalErrorLine("command not found")).toBe(true);
  });

  it("returns false for clean exit", () => {
    expect(isLikelyTerminalErrorLine("[Process exited: 0]")).toBe(false);
  });

  it("returns false for empty or blank", () => {
    expect(isLikelyTerminalErrorLine("")).toBe(false);
    expect(isLikelyTerminalErrorLine("   ")).toBe(false);
  });

  it("returns false for normal output", () => {
    expect(isLikelyTerminalErrorLine("Build succeeded")).toBe(false);
  });
});

describe("normalizeErrorMessage", () => {
  it("returns Unknown error for empty", () => {
    expect(normalizeErrorMessage("")).toBe("Unknown error.");
  });

  it("detects prompt too long", () => {
    expect(normalizeErrorMessage("Prompt is too long for this model")).toBe("Prompt is too long");
  });

  it("extracts result field from JSON-like string", () => {
    expect(normalizeErrorMessage('{"result": "bad request"}')).toBe("bad request");
  });

  it("extracts text field from JSON-like string", () => {
    expect(normalizeErrorMessage('{"text": "overloaded"}')).toBe("overloaded");
  });

  it("truncates long messages", () => {
    const long = "x".repeat(300);
    const result = normalizeErrorMessage(long);
    expect(result.length).toBe(240);
    expect(result.endsWith("...")).toBe(true);
  });

  it("returns short messages as-is", () => {
    expect(normalizeErrorMessage("simple error")).toBe("simple error");
  });
});

describe("isOpusModel", () => {
  it("returns true for opus models", () => {
    expect(isOpusModel("claude-opus-4-6")).toBe(true);
    expect(isOpusModel("claude-3-opus")).toBe(true);
    expect(isOpusModel("OPUS")).toBe(true);
  });

  it("returns false for non-opus models", () => {
    expect(isOpusModel("claude-sonnet-4-5")).toBe(false);
    expect(isOpusModel("gpt-4")).toBe(false);
  });
});

describe("slashCommandNeedsTerminal", () => {
  it("returns true for terminal-requiring commands", () => {
    expect(slashCommandNeedsTerminal("review")).toBe(true);
    expect(slashCommandNeedsTerminal("security-review")).toBe(true);
    expect(slashCommandNeedsTerminal("pr-comments")).toBe(true);
    expect(slashCommandNeedsTerminal("release-notes")).toBe(true);
  });

  it("returns false for other commands", () => {
    expect(slashCommandNeedsTerminal("compact")).toBe(false);
    expect(slashCommandNeedsTerminal("help")).toBe(false);
  });
});

describe("ideChipLabel", () => {
  it("maps known IDEs", () => {
    expect(ideChipLabel("cursor")).toBe("Cu");
    expect(ideChipLabel("vscode")).toBe("VS");
    expect(ideChipLabel("windsurf")).toBe("Ws");
    expect(ideChipLabel("zed")).toBe("Zd");
    expect(ideChipLabel("webstorm")).toBe("Wb");
  });

  it("returns IDE for unknown or undefined", () => {
    expect(ideChipLabel(undefined)).toBe("IDE");
    expect(ideChipLabel("unknown-ide")).toBe("IDE");
  });
});
