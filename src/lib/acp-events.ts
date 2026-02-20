import type { ChatStreamEvent } from "@/lib/chat-types";

// ---------------------------------------------------------------------------
// ACP-normalized event schema
//
// run.*     → stream lifecycle / content events (tied to a requestId)
// session.* → meta events (not tied to a specific run)
//
// Usage:
//   const acp = normalizeToAcp(rawEvent);
//   switch (acp.type) { case "run.delta": ... }
// ---------------------------------------------------------------------------

export type AcpEvent =
  // Session-level meta events
  | { type: "session.info"; raw: Extract<ChatStreamEvent, { type: "sessionInfo" }> }
  | { type: "session.auth_expired"; raw: Extract<ChatStreamEvent, { type: "authStatus" }> }
  | { type: "session.commands"; raw: Extract<ChatStreamEvent, { type: "slashCommands" }> }
  // Run lifecycle
  | { type: "run.start"; raw: Extract<ChatStreamEvent, { type: "start" }> }
  | { type: "run.delta"; raw: Extract<ChatStreamEvent, { type: "delta" }> }
  | { type: "run.done"; raw: Extract<ChatStreamEvent, { type: "done" }> }
  | { type: "run.error"; raw: Extract<ChatStreamEvent, { type: "error" }> }
  | { type: "run.aborted"; raw: Extract<ChatStreamEvent, { type: "aborted" }> }
  // Run metadata
  | { type: "run.status"; raw: Extract<ChatStreamEvent, { type: "status" }> }
  | { type: "run.limits"; raw: Extract<ChatStreamEvent, { type: "limits" }> }
  | { type: "run.compact"; raw: Extract<ChatStreamEvent, { type: "compactBoundary" }> }
  | { type: "run.permission_denied"; raw: Extract<ChatStreamEvent, { type: "permissionDenials" }> }
  // Tool events
  | { type: "run.tool_use"; raw: Extract<ChatStreamEvent, { type: "toolUse" }> }
  | { type: "run.tool_result"; raw: Extract<ChatStreamEvent, { type: "toolResult" }> }
  | { type: "run.approval_request"; raw: Extract<ChatStreamEvent, { type: "approvalRequest" }> }
  | { type: "run.ask_user"; raw: Extract<ChatStreamEvent, { type: "askUser" }> }
  // Subagent events
  | { type: "run.subagent_start"; raw: Extract<ChatStreamEvent, { type: "subagentStart" }> }
  | { type: "run.subagent_done"; raw: Extract<ChatStreamEvent, { type: "subagentDone" }> }
  // Fallback
  | { type: "run.unknown"; raw: ChatStreamEvent };

export function normalizeToAcp(raw: ChatStreamEvent): AcpEvent {
  switch (raw.type) {
    case "sessionInfo":
      return { type: "session.info", raw };
    case "authStatus":
      return { type: "session.auth_expired", raw };
    case "slashCommands":
      return { type: "session.commands", raw };
    case "start":
      return { type: "run.start", raw };
    case "delta":
      return { type: "run.delta", raw };
    case "done":
      return { type: "run.done", raw };
    case "error":
      return { type: "run.error", raw };
    case "aborted":
      return { type: "run.aborted", raw };
    case "status":
      return { type: "run.status", raw };
    case "limits":
      return { type: "run.limits", raw };
    case "compactBoundary":
      return { type: "run.compact", raw };
    case "permissionDenials":
      return { type: "run.permission_denied", raw };
    case "toolUse":
      return { type: "run.tool_use", raw };
    case "toolResult":
      return { type: "run.tool_result", raw };
    case "approvalRequest":
      return { type: "run.approval_request", raw };
    case "askUser":
      return { type: "run.ask_user", raw };
    case "subagentStart":
      return { type: "run.subagent_start", raw };
    case "subagentDone":
      return { type: "run.subagent_done", raw };
    default:
      return { type: "run.unknown", raw };
  }
}
