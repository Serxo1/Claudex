import type {
  AgentSession,
  ChatMessage,
  ContextAttachment,
  Thread,
  ToolTimelineItem
} from "@/lib/chat-types";
import { THREADS_STORAGE_KEY, deriveThreadStatus } from "@/lib/chat-types";

export const THREAD_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000; // 90 days

export function makeDefaultThread(): Thread {
  return {
    id: crypto.randomUUID(),
    title: "New thread",
    updatedAt: Date.now(),
    workspaceDirs: [],
    sessions: [],
    status: "idle"
  };
}

export function sanitizeSession(raw: Record<string, unknown>): AgentSession | null {
  if (!raw || typeof raw.id !== "string" || typeof raw.threadId !== "string") return null;

  const messages = (
    Array.isArray(raw.messages)
      ? (raw.messages as Array<ChatMessage & { attachments?: ContextAttachment[] }>)
      : []
  )
    .filter(
      (m) =>
        m &&
        typeof m.id === "string" &&
        (m.role === "user" || m.role === "assistant") &&
        typeof m.content === "string"
    )
    .map((m) => ({
      ...m,
      attachments: Array.isArray(m.attachments)
        ? m.attachments
            .filter(
              (f) => f && typeof f.absolutePath === "string" && typeof f.relativePath === "string"
            )
            .map((f) => ({
              absolutePath: f.absolutePath,
              relativePath: f.relativePath,
              mediaType: typeof f.mediaType === "string" ? f.mediaType : "",
              previewDataUrl: typeof f.previewDataUrl === "string" ? f.previewDataUrl : "",
              isImage: Boolean(f.isImage)
            }))
        : undefined
    }));

  const validStatuses = new Set(["idle", "running", "awaiting_approval", "done", "error"]);
  const rawStatus = raw.status as string;
  let status: AgentSession["status"] = validStatuses.has(rawStatus)
    ? (rawStatus as AgentSession["status"])
    : "done";
  if (status === "running" || status === "awaiting_approval") status = "idle";

  return {
    id: raw.id as string,
    threadId: raw.threadId as string,
    title: typeof raw.title === "string" ? raw.title : "Session",
    messages,
    status,
    requestId: undefined,
    pendingApproval: null,
    pendingQuestion: null,
    isThinking: false,
    sessionId: typeof raw.sessionId === "string" ? raw.sessionId : undefined,
    contextUsage:
      raw.contextUsage &&
      typeof raw.contextUsage === "object" &&
      typeof (raw.contextUsage as Record<string, unknown>).usedTokens === "number"
        ? (raw.contextUsage as AgentSession["contextUsage"])
        : null,
    accumulatedCostUsd:
      typeof raw.accumulatedCostUsd === "number" ? (raw.accumulatedCostUsd as number) : undefined,
    sessionCostUsd: null,
    limitsWarning: null,
    permissionMode: undefined,
    toolTimeline: Array.isArray(raw.toolTimeline)
      ? (raw.toolTimeline as ToolTimelineItem[])
          .filter((item) => item && typeof item.toolUseId === "string")
          .map((item) => ({
            ...item,
            rawInput: item.rawInput && typeof item.rawInput === "object" ? item.rawInput : undefined
          }))
      : [],
    subagents: [],
    reasoningText: typeof raw.reasoningText === "string" ? (raw.reasoningText as string) : "",
    compactCount: typeof raw.compactCount === "number" ? (raw.compactCount as number) : 0,
    permissionDenials: Array.isArray(raw.permissionDenials)
      ? (raw.permissionDenials as string[]).filter((d) => typeof d === "string")
      : [],
    teamNames: Array.isArray(raw.teamNames)
      ? (raw.teamNames as string[]).filter((v) => typeof v === "string")
      : undefined,
    contentBlocks: Array.isArray(raw.contentBlocks)
      ? (raw.contentBlocks as Array<{ type: string; text?: string; toolUseId?: string }>)
          .filter(
            (b) =>
              b &&
              ((b.type === "text" && typeof b.text === "string") ||
                (b.type === "tool" && typeof b.toolUseId === "string"))
          )
          .map((b) =>
            b.type === "text"
              ? ({ type: "text", text: b.text! } as const)
              : ({ type: "tool", toolUseId: b.toolUseId! } as const)
          )
      : undefined,
    createdAt: typeof raw.createdAt === "number" ? (raw.createdAt as number) : Date.now(),
    updatedAt: typeof raw.updatedAt === "number" ? (raw.updatedAt as number) : Date.now()
  };
}

export function shouldArchiveThread(thread: Thread): boolean {
  if (thread.sessions.length === 0) return false;
  if (thread.status === "running" || thread.status === "needs_attention") return false;
  return Date.now() - thread.updatedAt > THREAD_MAX_AGE_MS;
}

export function safeLoadThreads(): Thread[] {
  try {
    const raw = localStorage.getItem(THREADS_STORAGE_KEY);
    const legacyRaw = !raw ? localStorage.getItem("claude-desktop-threads-v1") : null;
    const source = raw || legacyRaw;

    if (!source) return [makeDefaultThread()];
    const parsed = JSON.parse(source);
    if (!Array.isArray(parsed)) return [makeDefaultThread()];

    const threads: Thread[] = parsed
      .filter((t: Record<string, unknown>) => t && typeof t.id === "string")
      .map((t: Record<string, unknown>) => {
        // Migrate old format: { messages, sessionId, accumulatedCostUsd, lastContextUsage }
        if (Array.isArray(t.messages) && !Array.isArray(t.sessions)) {
          const rawMessages = t.messages as Array<
            ChatMessage & { attachments?: ContextAttachment[] }
          >;
          const migratedSession: AgentSession = {
            id: crypto.randomUUID(),
            threadId: t.id as string,
            title: typeof t.title === "string" ? (t.title as string) : "Session",
            messages: rawMessages
              .filter(
                (m) =>
                  m &&
                  typeof m.id === "string" &&
                  (m.role === "user" || m.role === "assistant") &&
                  typeof m.content === "string"
              )
              .map((m) => ({
                ...m,
                attachments: Array.isArray(m.attachments)
                  ? m.attachments
                      .filter(
                        (f) =>
                          f &&
                          typeof f.absolutePath === "string" &&
                          typeof f.relativePath === "string"
                      )
                      .map((f) => ({
                        absolutePath: f.absolutePath,
                        relativePath: f.relativePath,
                        mediaType: typeof f.mediaType === "string" ? f.mediaType : "",
                        previewDataUrl:
                          typeof f.previewDataUrl === "string" ? f.previewDataUrl : "",
                        isImage: Boolean(f.isImage)
                      }))
                  : undefined
              })),
            status: "done",
            sessionId: typeof t.sessionId === "string" ? (t.sessionId as string) : undefined,
            contextUsage:
              t.lastContextUsage &&
              typeof (t.lastContextUsage as Record<string, unknown>).usedTokens === "number"
                ? (t.lastContextUsage as AgentSession["contextUsage"])
                : null,
            accumulatedCostUsd:
              typeof t.accumulatedCostUsd === "number"
                ? (t.accumulatedCostUsd as number)
                : undefined,
            toolTimeline: [],
            subagents: [],
            reasoningText: "",
            compactCount: 0,
            permissionDenials: [],
            createdAt: typeof t.updatedAt === "number" ? (t.updatedAt as number) : Date.now(),
            updatedAt: typeof t.updatedAt === "number" ? (t.updatedAt as number) : Date.now()
          };
          return {
            id: t.id as string,
            title: typeof t.title === "string" ? (t.title as string) : "New thread",
            updatedAt: typeof t.updatedAt === "number" ? (t.updatedAt as number) : Date.now(),
            workspaceDirs: [],
            sessions: migratedSession.messages.length > 0 ? [migratedSession] : [],
            status: "done" as Thread["status"]
          };
        }

        const sessions: AgentSession[] = Array.isArray(t.sessions)
          ? (t.sessions as Record<string, unknown>[])
              .map(sanitizeSession)
              .filter((s): s is AgentSession => s !== null)
          : [];

        return {
          id: t.id as string,
          title: typeof t.title === "string" ? (t.title as string) : "New thread",
          updatedAt: typeof t.updatedAt === "number" ? (t.updatedAt as number) : Date.now(),
          workspaceDirs: Array.isArray(t.workspaceDirs)
            ? (t.workspaceDirs as string[]).filter((d) => typeof d === "string")
            : [],
          sessions,
          status: deriveThreadStatus(sessions)
        };
      })
      .filter((_t: Thread) => true); // Keep all threads (empty and non-empty)

    const active = threads.filter((t) => !shouldArchiveThread(t));
    return active.length > 0 ? active : [makeDefaultThread()];
  } catch {
    return [makeDefaultThread()];
  }
}
