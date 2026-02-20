import type { AttachmentData } from "@/components/ai-elements/attachments";
import type {
  AgentSession,
  ChatMessage,
  ContextAttachment,
  DynamicModel,
  PermissionMode,
  Thread
} from "@/lib/chat-types";
import { TERMINAL_REQUIRED_SLASH_COMMANDS, deriveThreadStatus } from "@/lib/chat-types";

// ---------------------------------------------------------------------------
// String / message helpers (also used by stream-handler and team-resume)
// ---------------------------------------------------------------------------

/** Remove lone Unicode surrogates — valid in JS strings but invalid in JSON. */
export function stripLoneSurrogates(str: string): string {
  return str.replace(/[\uD800-\uDFFF]/g, (char, index, s: string) => {
    const code = char.charCodeAt(0);
    if (code <= 0xdbff) {
      const next = s.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) return char;
    } else {
      const prev = s.charCodeAt(index - 1);
      if (prev >= 0xd800 && prev <= 0xdbff) return char;
    }
    return "\uFFFD";
  });
}

export function makeMessage(
  role: "user" | "assistant",
  content: string,
  attachments?: ContextAttachment[]
): ChatMessage & { attachments?: ContextAttachment[] } {
  return { id: crypto.randomUUID(), role, content, attachments };
}

export function deriveThreadTitle(messages: ChatMessage[], fallback = "New thread"): string {
  const first = messages.find((m) => m.role === "user" && m.content.trim());
  if (!first) return fallback;
  const compact = first.content.replace(/\s+/g, " ").trim();
  return compact.length > 44 ? `${compact.slice(0, 44)}...` : compact;
}

/** Immutably patch a specific session inside the threads array. */
export function patchSession(
  threads: Thread[],
  threadId: string,
  sessionId: string,
  patch: Partial<AgentSession> | ((s: AgentSession) => Partial<AgentSession>)
): Thread[] {
  return threads.map((thread) => {
    if (thread.id !== threadId) return thread;
    const sessions = thread.sessions.map((session) => {
      if (session.id !== sessionId) return session;
      const updates = typeof patch === "function" ? patch(session) : patch;
      return { ...session, ...updates };
    });
    return { ...thread, sessions, status: deriveThreadStatus(sessions) };
  });
}

export function formatPermissionMode(mode: PermissionMode): string {
  switch (mode) {
    case "plan":
      return "Plan mode";
    case "dontAsk":
      return "Don't ask";
    case "acceptEdits":
    case "default":
      return "Ask edits";
    case "bypassPermissions":
      return "Full access";
    case "delegate":
      return "Delegate";
    case "api-key":
      return "API key";
    default:
      return "Unknown";
  }
}

export function summarizeForUi(value: unknown, fallback: string): string {
  if (typeof value === "string") {
    const compact = value.replace(/\s+/g, " ").trim();
    if (compact) {
      return compact.length > 120 ? `${compact.slice(0, 117)}...` : compact;
    }
    return fallback;
  }

  if (value == null) {
    return fallback;
  }

  try {
    const serialized = JSON.stringify(value);
    if (!serialized) {
      return fallback;
    }
    return serialized.length > 120 ? `${serialized.slice(0, 117)}...` : serialized;
  } catch {
    return fallback;
  }
}

const TOOL_INPUT_KEY_PRIORITY = [
  "command", // Bash
  "file_path", // Read, Write, Edit
  "pattern", // Glob, Grep
  "description", // Task
  "prompt", // generic
  "query", // generic
  "path" // generic
];

export function summarizeToolInput(input: Record<string, unknown> | null): string {
  if (!input) return "No input payload.";

  // Try priority keys first — extract just the meaningful value
  for (const key of TOOL_INPUT_KEY_PRIORITY) {
    const val = input[key];
    if (typeof val === "string" && val.trim()) {
      return summarizeForUi(val.trim(), "No input payload.");
    }
  }

  // Fallback: find first non-empty string value in the object
  for (const val of Object.values(input)) {
    if (typeof val === "string" && val.trim()) {
      return summarizeForUi(val.trim(), "No input payload.");
    }
  }

  return summarizeForUi(input, "No input payload.");
}

export function summarizeToolResult(content: unknown): string {
  if (Array.isArray(content) && content.length > 0) {
    const firstItem = content[0];
    if (firstItem && typeof firstItem === "object" && "text" in firstItem) {
      return summarizeForUi(
        (firstItem as { text?: unknown }).text,
        "Tool returned an empty response."
      );
    }
  }
  return summarizeForUi(content, "Tool finished.");
}

export function appendReasoningLine(current: string, line: string): string {
  const compact = line.trim();
  if (!compact) {
    return current;
  }
  if (!current) {
    return compact;
  }

  const lines = current.split("\n").filter(Boolean);
  const next = [...lines, compact].slice(-6);
  return next.join("\n");
}

export function shortFileLabel(value: string): string {
  const normalized = value.replaceAll("\\", "/");
  const parts = normalized.split("/").filter(Boolean);
  return parts[parts.length - 1] || value;
}

export function initialsFromName(value: string): string {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return "??";
  }
  return parts
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || "")
    .join("");
}

export function languageFromPath(filePath: string): string {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".ts")) return "typescript";
  if (lower.endsWith(".tsx")) return "typescript";
  if (lower.endsWith(".js")) return "javascript";
  if (lower.endsWith(".jsx")) return "javascript";
  if (lower.endsWith(".json")) return "json";
  if (lower.endsWith(".css")) return "css";
  if (lower.endsWith(".html")) return "html";
  if (lower.endsWith(".md")) return "markdown";
  if (lower.endsWith(".yml") || lower.endsWith(".yaml")) return "yaml";
  if (lower.endsWith(".sh")) return "shell";
  return "plaintext";
}

export function stripAnsiSequences(value: string): string {
  return value.replace(
    // eslint-disable-next-line no-control-regex
    /\u001b(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g,
    ""
  );
}

export function isLikelyTerminalErrorLine(line: string): boolean {
  const value = line.trim();
  if (!value) {
    return false;
  }

  if (/^\[process exited:\s*0\]$/i.test(value)) {
    return false;
  }

  const errorPattern =
    /\b(error|erro|exception|traceback|fatal|panic|failed|failure|npm err!|typeerror|referenceerror|syntaxerror|enoent|eacces|econn|permission denied|command not found)\b/i;
  return errorPattern.test(value);
}

export function normalizeErrorMessage(message: string): string {
  if (!message) {
    return "Unknown error.";
  }
  if (/Prompt is too long/i.test(message)) {
    return "Prompt is too long";
  }

  const resultMatch = message.match(/"result"\s*:\s*"([^"]+)"/);
  if (resultMatch?.[1]) {
    return resultMatch[1];
  }
  const textMatch = message.match(/"text"\s*:\s*"([^"]+)"/);
  if (textMatch?.[1]) {
    return textMatch[1];
  }
  return message.length > 240 ? `${message.slice(0, 237)}...` : message;
}

export function toAttachmentData(file: ContextAttachment): AttachmentData {
  return {
    id: file.absolutePath,
    type: "file",
    filename: shortFileLabel(file.relativePath),
    mediaType: file.mediaType || "text/plain",
    url: file.previewDataUrl || (file.isImage ? `file://${encodeURI(file.absolutePath)}` : "")
  };
}

export function ideChipLabel(ideId?: string): string {
  switch (ideId) {
    case "cursor":
      return "Cu";
    case "vscode":
      return "VS";
    case "windsurf":
      return "Ws";
    case "zed":
      return "Zd";
    case "webstorm":
      return "Wb";
    case "antigravity":
      return "Ag";
    default:
      return "IDE";
  }
}

export function isOpusModel(model: string): boolean {
  return /opus/i.test(model);
}

export function supportsEffort(modelId: string): boolean {
  return !/haiku/i.test(modelId);
}

export function supportsMaxEffort(modelId: string, dynamicModels: DynamicModel[]): boolean {
  const found = dynamicModels.find((m) => m.value === modelId);
  return found ? found.supportsMaxEffort : /opus/i.test(modelId);
}

export function slashCommandNeedsTerminal(command: string): boolean {
  return TERMINAL_REQUIRED_SLASH_COMMANDS.has(command);
}

export function extractLocalhostUrls(text: string): string[] {
  const re = /https?:\/\/(localhost|127\.0\.0\.1)(:\d+)([^\s"')>\]]*)/g;
  return [...new Set(Array.from(text.matchAll(re), (m) => m[0]))];
}

/**
 * Extract relative file paths from assistant text (e.g. `src/foo.ts`, `CLAUDE.md`).
 * Skips URLs and only matches common code/config extensions.
 */
export function extractFilePaths(text: string): string[] {
  // Match relative paths with common extensions; exclude http(s) URLs
  const re =
    /(?<![:/\\])(?:^|[\s"'`([{,])((\w[-\w]*\/)*\w[-\w]*\.(?:ts|tsx|js|jsx|cjs|mjs|json|md|py|css|scss|html|vue|svelte|go|rs|yaml|yml|toml|sh|bash|zsh|env))(?=[\s"'`)\]},]|$)/gm;
  const results = new Set<string>();
  for (const m of text.matchAll(re)) {
    const path = m[1].trim();
    // Skip if looks like a URL fragment
    if (path.includes("://")) continue;
    results.add(path);
  }
  return [...results];
}
