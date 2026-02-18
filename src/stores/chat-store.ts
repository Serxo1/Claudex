import { create } from "zustand";
import type {
  AgentSession,
  ChatMessage,
  ChatStreamEvent,
  ContextAttachment,
  PendingApproval,
  PendingQuestion,
  TeamInboxMessage,
  TeamSnapshot,
  Thread,
  ToolTimelineItem
} from "@/lib/chat-types";
import { FALLBACK_SLASH_COMMANDS, THREADS_STORAGE_KEY, deriveThreadStatus } from "@/lib/chat-types";
import {
  appendReasoningLine,
  supportsMaxEffort,
  normalizeErrorMessage,
  summarizeToolInput,
  summarizeToolResult
} from "@/lib/chat-utils";
import type { FormEvent } from "react";
import { useSettingsStore } from "@/stores/settings-store";
import { useGitStore } from "@/stores/git-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { usePermissionsStore } from "@/stores/permissions-store";
import { useTeamStore } from "@/stores/team-store";

// ---------------------------------------------------------------------------
// Module-level stream tracker (not reactive — just for routing events)
// ---------------------------------------------------------------------------
const _activeStreams = new Map<string, { threadId: string; sessionId: string }>();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMessage(
  role: "user" | "assistant",
  content: string,
  attachments?: ContextAttachment[]
): ChatMessage & { attachments?: ContextAttachment[] } {
  return { id: crypto.randomUUID(), role, content, attachments };
}

function deriveThreadTitle(messages: ChatMessage[], fallback = "New thread"): string {
  const firstUserMessage = messages.find(
    (message) => message.role === "user" && message.content.trim()
  );
  if (!firstUserMessage) return fallback;
  const compact = firstUserMessage.content.replace(/\s+/g, " ").trim();
  return compact.length > 44 ? `${compact.slice(0, 44)}...` : compact;
}

function makeDefaultThread(): Thread {
  return {
    id: crypto.randomUUID(),
    title: "New thread",
    updatedAt: Date.now(),
    workspaceDirs: [],
    sessions: [],
    status: "idle"
  };
}

function sanitizeSession(raw: Record<string, unknown>): AgentSession | null {
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
  // On load: running/awaiting_approval → idle (stream is gone), error stays, done stays
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
    // Volatile — always cleared on load
    requestId: undefined,
    pendingApproval: null,
    pendingQuestion: null,
    isThinking: false,
    // Persisted
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
      ? (raw.toolTimeline as ToolTimelineItem[]).filter(
          (item) => item && typeof item.toolUseId === "string"
        )
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
    createdAt: typeof raw.createdAt === "number" ? (raw.createdAt as number) : Date.now(),
    updatedAt: typeof raw.updatedAt === "number" ? (raw.updatedAt as number) : Date.now()
  };
}

const THREAD_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000; // 90 days

function shouldArchiveThread(thread: Thread): boolean {
  // Keep threads with no sessions (new/empty ones), active threads, and recent ones
  if (thread.sessions.length === 0) return false;
  if (thread.status === "running" || thread.status === "needs_attention") return false;
  return Date.now() - thread.updatedAt > THREAD_MAX_AGE_MS;
}

function safeLoadThreads(): Thread[] {
  try {
    const raw = localStorage.getItem(THREADS_STORAGE_KEY);

    // Try legacy key migration
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

        // New format
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
      .filter((t: Thread) => t.sessions.length > 0 || true); // Keep empty threads too

    const active = threads.filter((t) => !shouldArchiveThread(t));
    return active.length > 0 ? active : [makeDefaultThread()];
  } catch {
    return [makeDefaultThread()];
  }
}

// ---------------------------------------------------------------------------
// Store types
// ---------------------------------------------------------------------------

export type SkillEntry = { name: string; description: string; type: "command" | "skill" };

type ChatState = {
  threads: Thread[];
  activeThreadId: string;
  activeSessionId: string;
  slashCommands: string[];
  skillEntries: SkillEntry[];
  _unsubscribeStream: (() => void) | null;

  // Actions
  setThreads: (value: Thread[] | ((current: Thread[]) => Thread[])) => void;
  setActiveThreadId: (id: string) => void;
  setActiveSessionId: (id: string) => void;
  createThread: () => Promise<void>;
  persistThreads: () => void;
  initStreamListener: () => void;
  cleanupStreamListener: () => void;
  initTeamCompletionListener: () => () => void;
  loadSkills: () => Promise<void>;
  onSubmit: (
    message: {
      text: string;
      files: Array<{ filename?: string; mediaType?: string; url?: string }>;
    },
    event: FormEvent<HTMLFormElement>,
    effort?: string,
    targetSessionId?: string | null
  ) => Promise<void>;
  onApprove: (approvalId: string, input: Record<string, unknown>) => Promise<void>;
  onDeny: (approvalId: string) => Promise<void>;
  onAnswerQuestion: (approvalId: string, answers: Record<string, string>) => Promise<void>;
  onAbortSession: (sessionId: string) => Promise<void>;
  addWorkspaceDirToThread: (threadId: string, dir: string) => void;
  removeWorkspaceDirFromThread: (threadId: string, dir: string) => void;
  deleteThread: (threadId: string) => void;
  renameSession: (threadId: string, sessionId: string, title: string) => void;
  makeMessage: typeof makeMessage;
  deriveThreadTitle: typeof deriveThreadTitle;
};

// ---------------------------------------------------------------------------
// Helper: update a specific session inside threads
// ---------------------------------------------------------------------------

function patchSession(
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

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

const _initialThreads = safeLoadThreads();

export const useChatStore = create<ChatState>((set, get) => ({
  threads: _initialThreads,
  activeThreadId: _initialThreads[0]?.id ?? "",
  activeSessionId: _initialThreads[0]?.sessions[_initialThreads[0].sessions.length - 1]?.id ?? "",
  slashCommands: FALLBACK_SLASH_COMMANDS,
  skillEntries: [],
  _unsubscribeStream: null,

  setThreads: (value) =>
    set((state) => {
      const next = typeof value === "function" ? value(state.threads) : value;
      return { threads: next };
    }),

  setActiveThreadId: (id) => {
    const { threads } = get();
    const thread = threads.find((t) => t.id === id);
    const lastSession = thread?.sessions[thread.sessions.length - 1];
    set({ activeThreadId: id, activeSessionId: lastSession?.id ?? "" });
  },

  setActiveSessionId: (id) => set({ activeSessionId: id }),

  createThread: async () => {
    const result = await window.desktop.workspace.pickDirectory();
    const newThread = makeDefaultThread();
    if (result.ok && result.path) {
      newThread.workspaceDirs = [result.path];
      const folderName = result.path.split("/").filter(Boolean).pop() ?? result.path;
      newThread.title = folderName;
    }
    set((state) => ({
      threads: [newThread, ...state.threads],
      activeThreadId: newThread.id,
      activeSessionId: ""
    }));
  },

  persistThreads: () => {
    try {
      localStorage.setItem(THREADS_STORAGE_KEY, JSON.stringify(get().threads));
    } catch {
      // Ignore
    }
  },

  initStreamListener: () => {
    const unsubscribe = window.desktop.chat.onStreamEvent((event: ChatStreamEvent) => {
      const location = _activeStreams.get(event.requestId);
      if (!location) return;

      const { threadId, sessionId } = location;

      if (event.type === "sessionInfo") {
        useSettingsStore.getState().setDynamicSessionInfo(event.models, event.account);
        return;
      }

      if (event.type === "authStatus" && event.error) {
        useSettingsStore.getState().setAuthExpired(true);
        return;
      }

      if (event.type === "slashCommands") {
        if (event.commands.length > 0) {
          set({ slashCommands: Array.from(new Set(event.commands)) });
        }
        return;
      }

      if (event.type === "status") {
        set((state) => ({
          threads: patchSession(state.threads, threadId, sessionId, {
            contextUsage: event.context,
            permissionMode: event.permissionMode,
            updatedAt: Date.now()
          })
        }));
        return;
      }

      if (event.type === "limits") {
        set((state) => ({
          threads: patchSession(state.threads, threadId, sessionId, {
            limitsWarning: {
              level: event.level,
              message: event.message,
              fiveHourPercent: event.fiveHourPercent,
              weeklyPercent: event.weeklyPercent
            }
          })
        }));
        return;
      }

      if (event.type === "compactBoundary") {
        set((state) => ({
          threads: patchSession(state.threads, threadId, sessionId, (s) => ({
            compactCount: s.compactCount + 1
          }))
        }));
        return;
      }

      if (event.type === "permissionDenials") {
        set((state) => ({
          threads: patchSession(state.threads, threadId, sessionId, (s) => ({
            permissionDenials: [...new Set([...s.permissionDenials, ...event.denials])]
          }))
        }));
        return;
      }

      if (event.type === "subagentStart") {
        set((state) => ({
          threads: patchSession(state.threads, threadId, sessionId, (s) => {
            // 1. Match by toolUseId (most reliable)
            const existingByToolUse = event.toolUseId
              ? s.subagents.find((a) => a.toolUseId === event.toolUseId)
              : null;
            if (existingByToolUse) {
              return {
                subagents: s.subagents.map((a) =>
                  a.toolUseId === event.toolUseId ? { ...a, taskId: event.taskId } : a
                )
              };
            }
            // 2. Match by agent name extracted from description
            //    task_started description format: "agentName: prompt..."
            //    toolUse description format: "[agentName] rawDesc"
            const nameFromDesc = event.description.split(":")[0].trim().toLowerCase();
            const existingByName = nameFromDesc
              ? s.subagents.find(
                  (a) =>
                    a.taskId === a.toolUseId && // created from toolUse, not yet linked
                    a.description.toLowerCase().includes(`[${nameFromDesc}]`)
                )
              : null;
            if (existingByName) {
              return {
                subagents: s.subagents.map((a) =>
                  a === existingByName ? { ...a, taskId: event.taskId } : a
                )
              };
            }
            // 3. Fallback: match by exact description
            const existingByDesc = s.subagents.find(
              (a) => a.description === event.description && a.taskId === a.toolUseId
            );
            if (existingByDesc) {
              return {
                subagents: s.subagents.map((a) =>
                  a === existingByDesc ? { ...a, taskId: event.taskId } : a
                )
              };
            }
            // 4. If an existing entry already covers this agent name, don't create duplicate
            if (
              nameFromDesc &&
              s.subagents.some((a) => a.description.toLowerCase().includes(`[${nameFromDesc}]`))
            ) {
              return {
                subagents: s.subagents.map((a) =>
                  a.description.toLowerCase().includes(`[${nameFromDesc}]`)
                    ? { ...a, taskId: event.taskId }
                    : a
                )
              };
            }
            // 5. Truly new subagent not yet tracked
            return {
              subagents: [
                ...s.subagents,
                {
                  taskId: event.taskId,
                  description: event.description,
                  toolUseId: event.toolUseId,
                  status: "running" as const,
                  startedAt: Date.now()
                }
              ]
            };
          })
        }));
        return;
      }

      if (event.type === "subagentDone") {
        set((state) => ({
          threads: patchSession(state.threads, threadId, sessionId, (s) => ({
            subagents: s.subagents.map((a) =>
              a.taskId === event.taskId || a.toolUseId === event.taskId
                ? { ...a, status: event.status, summary: event.summary, finishedAt: Date.now() }
                : a
            )
          }))
        }));
        return;
      }

      if (event.type === "approvalRequest") {
        // Auto-approve if rule exists
        if (usePermissionsStore.getState().matchesRule(event.toolName, event.input)) {
          void window.desktop.chat.respondToApproval(event.approvalId, {
            behavior: "allow",
            updatedInput: event.input
          });
          return;
        }
        set((state) => ({
          threads: patchSession(state.threads, threadId, sessionId, {
            status: "awaiting_approval",
            pendingApproval: {
              approvalId: event.approvalId,
              toolName: event.toolName,
              input: event.input
            },
            pendingQuestion: null
          })
        }));
        return;
      }

      if (event.type === "askUser") {
        set((state) => ({
          threads: patchSession(state.threads, threadId, sessionId, {
            status: "awaiting_approval",
            pendingQuestion: {
              approvalId: event.approvalId,
              questions: event.input.questions
            },
            pendingApproval: null
          })
        }));
        return;
      }

      if (event.type === "toolUse") {
        // TeamCreate: register team BEFORE the main set() to avoid state overwrite
        if (event.name === "TeamCreate") {
          const teamName = (event.input as Record<string, unknown> | null)?.team_name;
          if (typeof teamName === "string" && teamName) {
            set((state) => ({
              threads: patchSession(state.threads, threadId, sessionId, (sess) => ({
                teamNames: [...(sess.teamNames ?? []), teamName].filter(
                  (v, i, a) => a.indexOf(v) === i
                )
              }))
            }));
            // Give the SDK ~600 ms to write the config file, then start watching
            setTimeout(() => {
              useTeamStore.getState().trackTeam(teamName);
            }, 600);
          }
        }

        set((state) => ({
          threads: patchSession(state.threads, threadId, sessionId, (s) => {
            const currentItems = s.toolTimeline;
            const nextSummary =
              event.name === "AskUserQuestion"
                ? JSON.stringify(event.input)
                : summarizeToolInput(event.input);
            const existingIndex = currentItems.findIndex(
              (item) => item.toolUseId === event.toolUseId
            );
            const nextItems: ToolTimelineItem[] =
              existingIndex >= 0
                ? currentItems.map((item, i) =>
                    i === existingIndex
                      ? {
                          ...item,
                          name: event.name,
                          inputSummary: nextSummary,
                          status: "pending" as const
                        }
                      : item
                  )
                : [
                    ...currentItems,
                    {
                      toolUseId: event.toolUseId,
                      name: event.name,
                      inputSummary: nextSummary,
                      resultSummary: "",
                      status: "pending" as const,
                      startedAt: event.timestamp,
                      finishedAt: null
                    }
                  ];

            // Track Task tool uses as subagents
            let nextSubagents = s.subagents;
            if (
              event.name === "Task" &&
              !s.subagents.some((a) => a.toolUseId === event.toolUseId)
            ) {
              const inp = event.input as Record<string, unknown> | null;
              const agentName = typeof inp?.name === "string" && inp.name ? inp.name : null;
              const rawDesc =
                typeof inp?.description === "string" && (inp.description as string).trim()
                  ? (inp.description as string).trim()
                  : typeof inp?.prompt === "string"
                    ? (inp.prompt as string).trim().slice(0, 80)
                    : "Subagente";
              const displayDesc = agentName ? `[${agentName}] ${rawDesc}` : rawDesc;
              nextSubagents = [
                ...s.subagents,
                {
                  taskId: event.toolUseId,
                  description: displayDesc,
                  toolUseId: event.toolUseId,
                  status: "running" as const,
                  startedAt: event.timestamp
                }
              ];
            }

            return {
              toolTimeline: nextItems,
              subagents: nextSubagents,
              reasoningText: appendReasoningLine(s.reasoningText, `Calling ${event.name}...`),
              isThinking: true,
              status: "running" as const
            };
          })
        }));
        return;
      }

      if (event.type === "toolResult") {
        set((state) => ({
          threads: patchSession(state.threads, threadId, sessionId, (s) => {
            const currentItems = s.toolTimeline;
            const resultSummary = summarizeToolResult(event.content);
            const nextStatus: ToolTimelineItem["status"] = event.isError ? "error" : "completed";
            const existingIndex = currentItems.findIndex(
              (item) => item.toolUseId === event.toolUseId
            );
            const nextItems: ToolTimelineItem[] =
              existingIndex >= 0
                ? currentItems.map((item, i) =>
                    i === existingIndex
                      ? { ...item, status: nextStatus, resultSummary, finishedAt: event.timestamp }
                      : item
                  )
                : [
                    ...currentItems,
                    {
                      toolUseId: event.toolUseId,
                      name: "tool",
                      inputSummary: "No input payload.",
                      resultSummary,
                      status: nextStatus,
                      startedAt: event.timestamp,
                      finishedAt: event.timestamp
                    }
                  ];
            const toolName =
              currentItems.find((item) => item.toolUseId === event.toolUseId)?.name ?? "tool";

            // Update subagent status for Task tool results
            const isSpawned =
              typeof resultSummary === "string" && resultSummary.toLowerCase().includes("spawn");
            const nextSubagents = s.subagents.map((a) => {
              if (a.toolUseId !== event.toolUseId) return a;
              // Background/team agent: "Spawned successfully" → mark as "background"
              if (!event.isError && isSpawned) return { ...a, status: "background" as const };
              return {
                ...a,
                status: event.isError ? ("failed" as const) : ("completed" as const),
                summary: resultSummary || undefined,
                finishedAt: event.timestamp
              };
            });

            return {
              toolTimeline: nextItems,
              subagents: nextSubagents,
              reasoningText: appendReasoningLine(
                s.reasoningText,
                event.isError ? `${toolName} failed.` : `${toolName} done.`
              )
            };
          })
        }));
        return;
      }

      if (event.type === "delta") {
        set((state) => ({
          threads: patchSession(state.threads, threadId, sessionId, (s) => {
            // Find the last assistant message (the streaming one)
            const lastAssistantIdx = [...s.messages]
              .reverse()
              .findIndex((m) => m.role === "assistant");
            const streamingMsgIdx =
              lastAssistantIdx >= 0 ? s.messages.length - 1 - lastAssistantIdx : -1;
            const patchedMessages =
              streamingMsgIdx >= 0
                ? s.messages.map((msg, i) =>
                    i === streamingMsgIdx ? { ...msg, content: event.content } : msg
                  )
                : s.messages;
            return {
              messages: patchedMessages,
              isThinking: false,
              updatedAt: Date.now(),
              title: deriveThreadTitle(patchedMessages, s.title)
            };
          })
        }));
        return;
      }

      if (event.type === "done") {
        _activeStreams.delete(event.requestId);
        set((state) => ({
          threads: patchSession(state.threads, threadId, sessionId, (s) => {
            const lastAssistantIdx = [...s.messages]
              .reverse()
              .findIndex((m) => m.role === "assistant");
            const streamingMsgIdx =
              lastAssistantIdx >= 0 ? s.messages.length - 1 - lastAssistantIdx : -1;
            const patchedMessages =
              streamingMsgIdx >= 0
                ? s.messages.map((msg, i) =>
                    i === streamingMsgIdx ? { ...msg, content: event.content } : msg
                  )
                : s.messages;
            const prevCost = s.accumulatedCostUsd ?? 0;
            const addCost = event.sessionCostUsd ?? 0;
            return {
              messages: patchedMessages,
              status: "done" as const,
              requestId: undefined,
              pendingApproval: null,
              pendingQuestion: null,
              isThinking: false,
              runningStartedAt: undefined,
              sessionCostUsd: event.sessionCostUsd ?? null,
              accumulatedCostUsd: prevCost + addCost,
              sessionId: event.sessionId ?? s.sessionId,
              updatedAt: Date.now(),
              title: deriveThreadTitle(patchedMessages, s.title),
              // Any subagent still "running" when session ends was synchronous and timed out
              subagents: (s.subagents ?? []).map((a) =>
                a.status === "running"
                  ? { ...a, status: "completed" as const, finishedAt: Date.now() }
                  : a
              )
            };
          })
        }));
        useSettingsStore.getState().setStatus(`Reply via ${event.provider}.`);
        // Send native notification if the app is not focused
        try {
          const threadForNotify = get().threads.find((t) =>
            t.sessions.some((s) => s.id === sessionId)
          );
          const sessionForNotify = threadForNotify?.sessions.find((s) => s.id === sessionId);
          void window.desktop.app?.notify({
            title: sessionForNotify?.title ?? "Sessão concluída",
            body: threadForNotify?.title ?? "O agente terminou."
          });
        } catch {
          // Ignore notification errors
        }
        void Promise.all([
          useSettingsStore.getState().refreshSettings(),
          useGitStore.getState().refreshGitSummary(),
          useGitStore.getState().refreshRecentCommits(),
          useWorkspaceStore.getState().refreshWorkspaceFileTree()
        ]);
        return;
      }

      if (event.type === "aborted") {
        _activeStreams.delete(event.requestId);
        set((state) => ({
          threads: patchSession(state.threads, threadId, sessionId, (s) => ({
            status: "idle" as const,
            requestId: undefined,
            pendingApproval: null,
            pendingQuestion: null,
            isThinking: false,
            runningStartedAt: undefined,
            subagents: (s.subagents ?? []).map((a) =>
              a.status === "running"
                ? { ...a, status: "stopped" as const, finishedAt: Date.now() }
                : a
            )
          }))
        }));
        useSettingsStore.getState().setStatus("Response interrupted.");
        return;
      }

      if (event.type === "error") {
        _activeStreams.delete(event.requestId);
        const friendlyError = normalizeErrorMessage(event.error);
        const subtype = event.errorSubtype || "error";
        const baseMessage =
          subtype === "error_max_turns"
            ? "Limite de turnos atingido."
            : subtype === "error_max_budget_usd"
              ? "Limite de custo atingido."
              : friendlyError;
        set((state) => ({
          threads: patchSession(state.threads, threadId, sessionId, (s) => {
            const lastAssistantIdx = [...s.messages]
              .reverse()
              .findIndex((m) => m.role === "assistant");
            const streamingMsgIdx =
              lastAssistantIdx >= 0 ? s.messages.length - 1 - lastAssistantIdx : -1;
            const patchedMessages =
              streamingMsgIdx >= 0
                ? s.messages.map((msg, i) =>
                    i === streamingMsgIdx ? { ...msg, content: `Error: ${baseMessage}` } : msg
                  )
                : s.messages;
            return {
              messages: patchedMessages,
              status: "error" as const,
              requestId: undefined,
              pendingApproval: null,
              pendingQuestion: null,
              isThinking: false,
              runningStartedAt: undefined,
              updatedAt: Date.now(),
              subagents: (s.subagents ?? []).map((a) =>
                a.status === "running"
                  ? { ...a, status: "failed" as const, finishedAt: Date.now() }
                  : a
              )
            };
          })
        }));
        useSettingsStore.getState().setStatus(baseMessage);
      }
    });

    set({ _unsubscribeStream: unsubscribe });
  },

  cleanupStreamListener: () => {
    const { _unsubscribeStream } = get();
    if (_unsubscribeStream) _unsubscribeStream();
    // Abort all active streams
    for (const [requestId] of _activeStreams) {
      void window.desktop.chat.abortStream(requestId).catch(() => {});
    }
    _activeStreams.clear();
    set({ _unsubscribeStream: null });
  },

  loadSkills: async () => {
    try {
      const result = await window.desktop.workspace.getSkills();
      if (!result.ok) return;
      const entries: SkillEntry[] = result.skills.map((s) => ({
        name: s.name,
        description: s.description,
        type: s.type
      }));
      // Merge skill names into slashCommands list (for autocomplete)
      const extraNames = entries.map((e) => `/${e.name}`);
      const { slashCommands } = get();
      const merged = Array.from(new Set([...slashCommands, ...extraNames]));
      set({ skillEntries: entries, slashCommands: merged });
    } catch {
      // Ignore — skills are best-effort
    }
  },

  onApprove: async (approvalId, input) => {
    // Find session with this approvalId
    const { threads } = get();
    let foundThreadId: string | null = null;
    let foundSessionId: string | null = null;
    let toolName: string | null = null;
    for (const thread of threads) {
      for (const session of thread.sessions) {
        if (session.pendingApproval?.approvalId === approvalId) {
          foundThreadId = thread.id;
          foundSessionId = session.id;
          toolName = session.pendingApproval.toolName;
          break;
        }
      }
      if (foundSessionId) break;
    }
    if (foundThreadId && foundSessionId) {
      set((state) => ({
        threads: patchSession(state.threads, foundThreadId!, foundSessionId!, (s) => ({
          pendingApproval: null,
          status: "running" as const,
          reasoningText: appendReasoningLine(s.reasoningText, `${toolName} running...`)
        }))
      }));
    }
    await window.desktop.chat.respondToApproval(approvalId, {
      behavior: "allow",
      updatedInput: input
    });
  },

  onDeny: async (approvalId) => {
    const { threads } = get();
    let foundThreadId: string | null = null;
    let foundSessionId: string | null = null;
    let toolName: string | null = null;
    for (const thread of threads) {
      for (const session of thread.sessions) {
        if (session.pendingApproval?.approvalId === approvalId) {
          foundThreadId = thread.id;
          foundSessionId = session.id;
          toolName = session.pendingApproval.toolName;
          break;
        }
      }
      if (foundSessionId) break;
    }
    if (foundThreadId && foundSessionId) {
      set((state) => ({
        threads: patchSession(state.threads, foundThreadId!, foundSessionId!, (s) => ({
          pendingApproval: null,
          reasoningText: appendReasoningLine(s.reasoningText, `${toolName} denied.`)
        }))
      }));
    }
    await window.desktop.chat.respondToApproval(approvalId, {
      behavior: "deny",
      message: "User denied."
    });
  },

  onAnswerQuestion: async (approvalId, answers) => {
    const { threads } = get();
    let foundThreadId: string | null = null;
    let foundSessionId: string | null = null;
    for (const thread of threads) {
      for (const session of thread.sessions) {
        if (session.pendingQuestion?.approvalId === approvalId) {
          foundThreadId = thread.id;
          foundSessionId = session.id;
          break;
        }
      }
      if (foundSessionId) break;
    }
    if (foundThreadId && foundSessionId) {
      set((state) => ({
        threads: patchSession(state.threads, foundThreadId!, foundSessionId!, {
          pendingQuestion: null,
          status: "running" as const
        })
      }));
    }
    await window.desktop.chat.respondToApproval(approvalId, {
      behavior: "allow",
      updatedInput: { answers }
    });
  },

  onAbortSession: async (sessionId) => {
    // Find requestId for this session
    const { threads } = get();
    let requestId: string | undefined;
    for (const thread of threads) {
      const session = thread.sessions.find((s) => s.id === sessionId);
      if (session) {
        requestId = session.requestId;
        break;
      }
    }
    if (!requestId) return;
    try {
      await window.desktop.chat.abortStream(requestId);
    } catch {
      // Ignore
    }
  },

  onSubmit: async (message, event, effort, targetSessionId) => {
    event.preventDefault();
    const settings = useSettingsStore.getState().settings;
    const contextFiles = useWorkspaceStore.getState().contextFiles;

    const prompt = message.text.trim();
    const { threads, activeThreadId } = get();
    const activeThread = threads.find((t) => t.id === activeThreadId) ?? threads[0] ?? null;

    if (!activeThread || !settings || !prompt) return;
    if (settings.authMode === "api-key" && !settings.hasApiKey) return;

    const isSlashCommand = /^\/\S+/.test(prompt);

    // Persist pasted images
    const persistedPastedFiles: ContextAttachment[] = [];
    for (const file of message.files || []) {
      const dataUrl = typeof file?.url === "string" ? file.url : "";
      if (!dataUrl.startsWith("data:image/")) continue;
      try {
        const saved = await window.desktop.workspace.savePastedImage({
          dataUrl,
          filename: file.filename
        });
        persistedPastedFiles.push({
          absolutePath: saved.absolutePath,
          relativePath: saved.relativePath,
          mediaType: saved.mediaType,
          previewDataUrl: saved.previewDataUrl,
          isImage: saved.isImage
        });
      } catch (error) {
        useSettingsStore
          .getState()
          .setStatus(`Failed to store pasted image: ${(error as Error).message}`);
      }
    }

    const contextForSend = [...contextFiles, ...persistedPastedFiles].filter(
      (file, index, all) =>
        all.findIndex((other) => other.absolutePath === file.absolutePath) === index
    );

    const contextSuffix =
      !isSlashCommand && contextForSend.length > 0
        ? `\n\nContext files:\n${contextForSend
            .map((file) =>
              file.isImage
                ? `- ${file.absolutePath}`
                : `- ${file.relativePath} (${file.absolutePath})`
            )
            .join("\n")}`
        : "";
    const finalPrompt = `${prompt}${contextSuffix}`;

    const threadId = activeThread.id;
    const userMessage = makeMessage("user", prompt, contextForSend);
    const assistantMessage = makeMessage("assistant", "");
    const messagesForSend = [{ id: userMessage.id, role: "user" as const, content: finalPrompt }];

    useWorkspaceStore.getState().setContextFiles([]);
    useSettingsStore.getState().setStatus("Starting stream...");

    // -----------------------------------------------------------------------
    // Path A: continue an existing session (same Claude sessionId = --resume)
    // -----------------------------------------------------------------------
    if (targetSessionId) {
      const targetSession = activeThread.sessions.find((s) => s.id === targetSessionId);
      if (!targetSession) return;

      set((s) => ({
        threads: patchSession(s.threads, threadId, targetSessionId, (sess) => ({
          messages: [...sess.messages, userMessage, assistantMessage],
          status: "running" as const,
          isThinking: true,
          reasoningText: "Preparing execution...",
          toolTimeline: [],
          subagents: [],
          runningStartedAt: Date.now(),
          updatedAt: Date.now()
        }))
      }));

      try {
        const started = await window.desktop.chat.startStream({
          messages: messagesForSend,
          effort:
            supportsMaxEffort(settings.model, useSettingsStore.getState().dynamicModels) && effort
              ? effort
              : undefined,
          contextFiles: contextForSend,
          resumeSessionId: targetSession.sessionId ?? "",
          workspaceDirs: activeThread.workspaceDirs
        });

        _activeStreams.set(started.requestId, { threadId, sessionId: targetSessionId });
        set((s) => ({
          threads: patchSession(s.threads, threadId, targetSessionId, {
            requestId: started.requestId
          })
        }));
        useSettingsStore.getState().setStatus(`Streaming via ${started.provider}...`);
      } catch (error) {
        const messageText = normalizeErrorMessage((error as Error).message);
        set((s) => ({
          threads: patchSession(s.threads, threadId, targetSessionId, (sess) => ({
            messages: sess.messages.map((msg, i) =>
              i === sess.messages.length - 1 && msg.role === "assistant"
                ? { ...msg, content: `Error: ${messageText}` }
                : msg
            ),
            status: "error" as const,
            isThinking: false,
            reasoningText: ""
          }))
        }));
        useSettingsStore.getState().setStatus(messageText);
      }
      return;
    }

    // -----------------------------------------------------------------------
    // Path B: create a new independent session (fresh Claude sessionId)
    // -----------------------------------------------------------------------
    const newSessionId = crypto.randomUUID();
    const newSession: AgentSession = {
      id: newSessionId,
      threadId,
      title: deriveThreadTitle([userMessage], "New session"),
      messages: [userMessage, assistantMessage],
      status: "running",
      requestId: undefined,
      toolTimeline: [],
      subagents: [],
      reasoningText: "Preparing execution...",
      isThinking: true,
      runningStartedAt: Date.now(),
      compactCount: 0,
      permissionDenials: [],
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    set((s) => ({
      threads: s.threads.map((thread) =>
        thread.id === threadId
          ? {
              ...thread,
              sessions: [...thread.sessions, newSession],
              status: "running",
              updatedAt: Date.now(),
              title:
                thread.sessions.length === 0
                  ? deriveThreadTitle([userMessage], thread.title)
                  : thread.title
            }
          : thread
      )
    }));

    try {
      const started = await window.desktop.chat.startStream({
        messages: messagesForSend,
        effort:
          supportsMaxEffort(settings.model, useSettingsStore.getState().dynamicModels) && effort
            ? effort
            : undefined,
        contextFiles: contextForSend,
        resumeSessionId: "",
        workspaceDirs: activeThread.workspaceDirs
      });

      _activeStreams.set(started.requestId, { threadId, sessionId: newSessionId });
      set({ activeSessionId: newSessionId });
      set((s) => ({
        threads: patchSession(s.threads, threadId, newSessionId, { requestId: started.requestId })
      }));
      useSettingsStore.getState().setStatus(`Streaming via ${started.provider}...`);
    } catch (error) {
      const messageText = normalizeErrorMessage((error as Error).message);
      set((s) => ({
        threads: patchSession(s.threads, threadId, newSessionId, (sess) => ({
          messages: sess.messages.map((msg, i) =>
            i === sess.messages.length - 1 && msg.role === "assistant"
              ? { ...msg, content: `Error: ${messageText}` }
              : msg
          ),
          status: "error" as const,
          isThinking: false,
          reasoningText: ""
        }))
      }));
      useSettingsStore.getState().setStatus(messageText);
    }
  },

  // ---------------------------------------------------------------------------
  // Team completion — auto-resume main session when all tasks finish
  // ---------------------------------------------------------------------------

  initTeamCompletionListener: () => {
    return window.desktop.teams.onAllDone((payload) => {
      const snap = payload as TeamSnapshot & { teamName: string };
      const teamName = snap.teamName;

      const { threads } = get();

      // Find the thread+session that owns this team
      let foundThreadId: string | null = null;
      let foundSession: AgentSession | null = null;
      outer: for (const thread of threads) {
        for (const session of [...thread.sessions].reverse()) {
          if (session.teamNames?.includes(teamName)) {
            foundThreadId = thread.id;
            foundSession = session;
            break outer;
          }
        }
      }
      if (!foundThreadId || !foundSession) return;
      // Don't interrupt an active session
      if (foundSession.status === "running" || foundSession.status === "awaiting_approval") return;

      const threadWorkspaceDirs = threads.find((t) => t.id === foundThreadId)?.workspaceDirs ?? [];

      // Collect real messages from team-lead inbox (skip SDK internals)
      const leadInbox: TeamInboxMessage[] = snap.inboxes?.["team-lead"] ?? [];
      const realMessages = leadInbox.filter((msg) => {
        try {
          const p = JSON.parse(msg.text) as Record<string, unknown>;
          return p.type !== "idle_notification" && p.type !== "permission_request";
        } catch {
          return true;
        }
      });

      // Build inbox summary text
      const inboxText =
        realMessages.length > 0
          ? realMessages
              .map((m) => {
                const text = m.summary ?? m.text.slice(0, 600);
                return `**${m.from}:** ${text}`;
              })
              .join("\n\n")
          : "(sem mensagens dos agentes)";

      const prompt =
        `Os agentes do time "${teamName}" terminaram todas as tarefas.\n\n` +
        `Mensagens recebidas:\n\n${inboxText}\n\n` +
        `Resume os resultados e informa o utilizador do que foi concluído.`;

      const userMessage = makeMessage("user", prompt);
      const assistantMessage = makeMessage("assistant", "");
      const sessionId = foundSession.id;

      // Navigate to that thread + session
      set({ activeThreadId: foundThreadId, activeSessionId: sessionId });

      // Add messages and mark running
      set((s) => ({
        threads: patchSession(s.threads, foundThreadId!, sessionId, (sess) => ({
          messages: [...sess.messages, userMessage, assistantMessage],
          status: "running" as const,
          isThinking: true,
          reasoningText: "Recebendo resultados da equipa...",
          toolTimeline: [],
          subagents: [],
          runningStartedAt: Date.now(),
          updatedAt: Date.now()
        }))
      }));

      const settings = useSettingsStore.getState().settings;
      if (!settings) return;

      void window.desktop.chat
        .startStream({
          messages: [{ id: userMessage.id, role: "user" as const, content: prompt }],
          effort: undefined,
          contextFiles: [],
          resumeSessionId: foundSession.sessionId ?? "",
          workspaceDirs: threadWorkspaceDirs
        })
        .then((started) => {
          _activeStreams.set(started.requestId, { threadId: foundThreadId!, sessionId });
          set((s) => ({
            threads: patchSession(s.threads, foundThreadId!, sessionId, {
              requestId: started.requestId
            })
          }));
          useSettingsStore.getState().setStatus(`Equipa ${teamName} concluída — a resumir...`);
        })
        .catch((error) => {
          const messageText = normalizeErrorMessage((error as Error).message);
          set((s) => ({
            threads: patchSession(s.threads, foundThreadId!, sessionId, (sess) => ({
              messages: sess.messages.slice(0, -2),
              status: "error" as const,
              isThinking: false,
              reasoningText: ""
            }))
          }));
          useSettingsStore.getState().setStatus(messageText);
        });
    });
  },

  addWorkspaceDirToThread: (threadId, dir) => {
    set((state) => ({
      threads: state.threads.map((thread) =>
        thread.id === threadId && !thread.workspaceDirs.includes(dir)
          ? { ...thread, workspaceDirs: [...thread.workspaceDirs, dir] }
          : thread
      )
    }));
  },

  removeWorkspaceDirFromThread: (threadId, dir) => {
    set((state) => ({
      threads: state.threads.map((thread) =>
        thread.id === threadId
          ? { ...thread, workspaceDirs: thread.workspaceDirs.filter((d) => d !== dir) }
          : thread
      )
    }));
  },

  deleteThread: (threadId) => {
    set((state) => {
      const remaining = state.threads.filter((t) => t.id !== threadId);
      const nextActiveId =
        state.activeThreadId === threadId ? (remaining[0]?.id ?? "") : state.activeThreadId;
      return { threads: remaining, activeThreadId: nextActiveId };
    });
  },

  renameSession: (threadId, sessionId, title) => {
    set((state) => ({
      threads: state.threads.map((t) =>
        t.id !== threadId
          ? t
          : {
              ...t,
              sessions: t.sessions.map((s) =>
                s.id === sessionId ? { ...s, title: title.trim() || s.title } : s
              )
            }
      )
    }));
  },

  makeMessage,
  deriveThreadTitle
}));

// Re-export types for components that imported them from chat-store
export type { PendingApproval, PendingQuestion };
