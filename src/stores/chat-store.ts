import { create } from "zustand";
import type {
  AgentSession,
  ContextAttachment,
  PendingApproval,
  PendingQuestion,
  TeamSnapshot,
  Thread
} from "@/lib/chat-types";
import { FALLBACK_SLASH_COMMANDS, THREADS_STORAGE_KEY } from "@/lib/chat-types";
import {
  appendReasoningLine,
  deriveThreadTitle,
  makeMessage,
  normalizeErrorMessage,
  patchSession,
  supportsMaxEffort
} from "@/lib/chat-utils";
import { makeDefaultThread, safeLoadThreads } from "@/lib/chat-persistence";
import { _activeStreams, createStreamHandler } from "@/lib/stream-handler";
import { handleTeamAllDone, manualResumeForTeam, resumeForTeamApprovals } from "@/lib/team-resume";
import type { FormEvent } from "react";
import { useSettingsStore } from "@/stores/settings-store";
import { useWorkspaceStore } from "@/stores/workspace-store";

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
  manualResumeForTeam: (teamName: string) => Promise<void>;
  resumeForTeamApprovals: (teamName: string, pendingAgents: string[]) => Promise<void>;
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
  deleteSession: (threadId: string, sessionId: string) => void;
  renameSession: (threadId: string, sessionId: string, title: string) => void;
  makeMessage: typeof makeMessage;
  deriveThreadTitle: typeof deriveThreadTitle;
};

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

  // ---------------------------------------------------------------------------
  // Thread / session navigation
  // ---------------------------------------------------------------------------

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

  // ---------------------------------------------------------------------------
  // Stream listener (delegates to stream-handler.ts)
  // ---------------------------------------------------------------------------

  initStreamListener: () => {
    const handler = createStreamHandler(
      set as Parameters<typeof createStreamHandler>[0],
      get as Parameters<typeof createStreamHandler>[1]
    );
    const unsubscribe = window.desktop.chat.onStreamEvent(handler);
    set({ _unsubscribeStream: unsubscribe });
  },

  cleanupStreamListener: () => {
    const { _unsubscribeStream } = get();
    if (_unsubscribeStream) _unsubscribeStream();
    for (const [requestId] of _activeStreams) {
      void window.desktop.chat.abortStream(requestId).catch(() => {});
    }
    _activeStreams.clear();
    set({ _unsubscribeStream: null });
  },

  // ---------------------------------------------------------------------------
  // Skills
  // ---------------------------------------------------------------------------

  loadSkills: async () => {
    try {
      const result = await window.desktop.workspace.getSkills();
      if (!result.ok) return;
      const entries: SkillEntry[] = result.skills.map((s) => ({
        name: s.name,
        description: s.description,
        type: s.type
      }));
      const extraNames = entries.map((e) => `/${e.name}`);
      const { slashCommands } = get();
      const merged = Array.from(new Set([...slashCommands, ...extraNames]));
      set({ skillEntries: entries, slashCommands: merged });
    } catch {
      // Ignore — skills are best-effort
    }
  },

  // ---------------------------------------------------------------------------
  // Approval actions
  // ---------------------------------------------------------------------------

  onApprove: async (approvalId, input) => {
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

  // ---------------------------------------------------------------------------
  // Submit (send message)
  // ---------------------------------------------------------------------------

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

    // Path A: continue an existing session (--resume)
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

    // Path B: new independent session
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
                thread.sessions.length === 0 && thread.title === "New thread"
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
  // Team completion (delegates to team-resume.ts)
  // ---------------------------------------------------------------------------

  initTeamCompletionListener: () => {
    return window.desktop.teams.onAllDone((payload) => {
      handleTeamAllDone(
        payload as TeamSnapshot & { teamName: string },
        set as Parameters<typeof handleTeamAllDone>[1],
        get as Parameters<typeof handleTeamAllDone>[2]
      );
    });
  },

  manualResumeForTeam: (teamName) =>
    manualResumeForTeam(
      teamName,
      set as Parameters<typeof manualResumeForTeam>[1],
      get as Parameters<typeof manualResumeForTeam>[2]
    ),

  resumeForTeamApprovals: (teamName, pendingAgents) =>
    resumeForTeamApprovals(
      teamName,
      pendingAgents,
      set as Parameters<typeof resumeForTeamApprovals>[2],
      get as Parameters<typeof resumeForTeamApprovals>[3]
    ),

  // ---------------------------------------------------------------------------
  // CRUD actions
  // ---------------------------------------------------------------------------

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

  deleteSession: (threadId, sessionId) => {
    set((state) => {
      const thread = state.threads.find((t) => t.id === threadId);
      if (!thread) return {};
      const remaining = thread.sessions.filter((s) => s.id !== sessionId);
      const updatedThread = { ...thread, sessions: remaining };

      let nextActiveSessionId = state.activeSessionId;
      if (state.activeThreadId === threadId && state.activeSessionId === sessionId) {
        const sorted = [...remaining].sort((a, b) => b.updatedAt - a.updatedAt);
        nextActiveSessionId = sorted[0]?.id ?? "";
      }

      return {
        threads: state.threads.map((t) => (t.id === threadId ? updatedThread : t)),
        activeSessionId: nextActiveSessionId
      };
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
