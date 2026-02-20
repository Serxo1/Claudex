import type { TeamInboxMessage } from "@/lib/chat-types";

export type TeamPermissionRequest = {
  requestId: string;
  agentId: string;
  toolName: string;
  input: Record<string, unknown>;
};

// Module-level tracking of already-responded permission requests (persists across renders)
const _handledPermissions = new Map<string, Set<string>>();

// Permission requests older than this are considered expired (agent already timed out)
const PERMISSION_EXPIRY_MS = 2 * 60 * 1000; // 2 minutes

export function markPermissionHandled(teamName: string, requestId: string): void {
  if (!_handledPermissions.has(teamName)) _handledPermissions.set(teamName, new Set());
  _handledPermissions.get(teamName)!.add(requestId);
}

export function isPermissionHandled(teamName: string, requestId: string): boolean {
  return _handledPermissions.get(teamName)?.has(requestId) ?? false;
}

/** Collect unprocessed permission_request messages from team-lead's inbox. */
export function getPendingApprovals(
  teamName: string,
  inboxes: Record<string, TeamInboxMessage[]>
): TeamPermissionRequest[] {
  const leadMessages = inboxes["team-lead"] ?? [];
  const pending: TeamPermissionRequest[] = [];
  const now = Date.now();
  for (const msg of leadMessages) {
    try {
      const p = JSON.parse(msg.text) as Record<string, unknown>;
      if (p.type !== "permission_request") continue;
      const requestId = typeof p.request_id === "string" ? p.request_id : "";
      if (!requestId || isPermissionHandled(teamName, requestId)) continue;
      // Skip expired requests — the agent already timed out waiting for a response
      const msgTime = msg.timestamp ? new Date(msg.timestamp).getTime() : 0;
      if (msgTime > 0 && now - msgTime > PERMISSION_EXPIRY_MS) {
        markPermissionHandled(teamName, requestId);
        continue;
      }
      pending.push({
        requestId,
        agentId: typeof p.agent_id === "string" ? p.agent_id : msg.from,
        toolName: typeof p.tool_name === "string" ? p.tool_name : "tool",
        input: (p.input as Record<string, unknown>) ?? {}
      });
    } catch {
      // not JSON
    }
  }
  return pending;
}
