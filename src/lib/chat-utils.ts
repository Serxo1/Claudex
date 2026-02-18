import type { AttachmentData } from "@/components/ai-elements/attachments";
import type { ContextAttachment, DynamicModel, PermissionMode } from "@/lib/chat-types";
import { TERMINAL_REQUIRED_SLASH_COMMANDS } from "@/lib/chat-types";

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

export function supportsMaxEffort(modelId: string, dynamicModels: DynamicModel[]): boolean {
  const found = dynamicModels.find((m) => m.value === modelId);
  return found ? found.supportsMaxEffort : /opus/i.test(modelId);
}

export function slashCommandNeedsTerminal(command: string): boolean {
  return TERMINAL_REQUIRED_SLASH_COMMANDS.has(command);
}
