import { create } from "zustand";
import type {
  ChatMessage,
  ChatStreamEvent,
  ContextAttachment,
  PermissionMode,
  Thread,
  ToolTimelineItem
} from "@/lib/chat-types";

export type PendingApproval = {
  approvalId: string;
  toolName: string;
  input: Record<string, unknown>;
};

export type PendingQuestion = {
  approvalId: string;
  questions: Array<{
    question: string;
    header: string;
    options: Array<{ label: string; description: string }>;
    multiSelect: boolean;
  }>;
};
import { FALLBACK_SLASH_COMMANDS, THREADS_STORAGE_KEY } from "@/lib/chat-types";
import {
  appendReasoningLine,
  isOpusModel,
  normalizeErrorMessage,
  summarizeToolInput,
  summarizeToolResult
} from "@/lib/chat-utils";
import type { FormEvent } from "react";
import { useSettingsStore } from "@/stores/settings-store";
import { useGitStore } from "@/stores/git-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { usePermissionsStore } from "@/stores/permissions-store";

function makeMessage(
  role: "user" | "assistant",
  content: string,
  attachments?: ContextAttachment[]
): ChatMessage & { attachments?: ContextAttachment[] } {
  return { id: crypto.randomUUID(), role, content, attachments };
}

function makeDefaultThread(): Thread {
  return {
    id: crypto.randomUUID(),
    title: "New thread",
    updatedAt: Date.now(),
    messages: [
      makeMessage("assistant", "Ready. Describe what you want to build and I will start coding.")
    ]
  };
}

function safeLoadThreads(): Thread[] {
  try {
    const raw = localStorage.getItem(THREADS_STORAGE_KEY);
    if (!raw) return [makeDefaultThread()];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [makeDefaultThread()];
    const threads = parsed
      .filter(
        (thread: Record<string, unknown>) =>
          thread && typeof thread.id === "string" && Array.isArray(thread.messages)
      )
      .map((thread: Record<string, unknown>) => ({
        id: thread.id as string,
        title:
          typeof thread.title === "string" && (thread.title as string).trim()
            ? (thread.title as string)
            : "New thread",
        updatedAt: typeof thread.updatedAt === "number" ? (thread.updatedAt as number) : Date.now(),
        accumulatedCostUsd:
          typeof thread.accumulatedCostUsd === "number"
            ? (thread.accumulatedCostUsd as number)
            : undefined,
        sessionId: typeof thread.sessionId === "string" ? (thread.sessionId as string) : undefined,
        messages: (thread.messages as Array<ChatMessage & { attachments?: ContextAttachment[] }>)
          .filter(
            (message: ChatMessage & { attachments?: ContextAttachment[] }) =>
              message &&
              typeof message.id === "string" &&
              (message.role === "user" || message.role === "assistant") &&
              typeof message.content === "string"
          )
          .map((message: ChatMessage & { attachments?: ContextAttachment[] }) => ({
            ...message,
            attachments: Array.isArray(message.attachments)
              ? message.attachments
                  .filter(
                    (file) =>
                      file &&
                      typeof file.absolutePath === "string" &&
                      typeof file.relativePath === "string"
                  )
                  .map((file) => ({
                    absolutePath: file.absolutePath,
                    relativePath: file.relativePath,
                    mediaType: typeof file.mediaType === "string" ? file.mediaType : "",
                    previewDataUrl:
                      typeof file.previewDataUrl === "string" ? file.previewDataUrl : "",
                    isImage: Boolean(file.isImage)
                  }))
              : undefined
          }))
      }))
      .filter((thread: Thread) => thread.messages.length > 0);
    return threads.length > 0 ? threads : [makeDefaultThread()];
  } catch {
    return [makeDefaultThread()];
  }
}

function deriveThreadTitle(messages: ChatMessage[], fallback = "New thread"): string {
  const firstUserMessage = messages.find(
    (message) => message.role === "user" && message.content.trim()
  );
  if (!firstUserMessage) return fallback;
  const compact = firstUserMessage.content.replace(/\s+/g, " ").trim();
  return compact.length > 44 ? `${compact.slice(0, 44)}...` : compact;
}

type ActiveStreamRef = { requestId: string; assistantMessageId: string; threadId: string } | null;

type ChatState = {
  threads: Thread[];
  activeThreadId: string;
  executionRequestId: string | null;
  executionAssistantMessageId: string | null;
  activeToolTimelineByRequest: Record<string, ToolTimelineItem[]>;
  reasoningText: string;
  reasoningOpen: boolean;
  isThinking: boolean;
  taskOpen: boolean;
  timelineOpen: boolean;
  slashCommands: string[];
  isSending: boolean;
  permissionMode: PermissionMode;
  contextUsage: {
    usedTokens: number;
    maxTokens: number;
    percent: number;
    inputTokens: number;
    outputTokens: number;
    cacheReadInputTokens: number;
    cacheCreationInputTokens: number;
  } | null;
  limitsWarning: {
    level: "info" | "warning";
    message: string;
    fiveHourPercent: number | null;
    weeklyPercent: number | null;
  } | null;
  compactCount: number;
  permissionDenials: string[];
  sessionCostUsd: number | null;
  pendingApproval: PendingApproval | null;
  pendingQuestion: PendingQuestion | null;

  // Internal ref (not reactive, just storage)
  _activeStreamRef: ActiveStreamRef;
  _unsubscribeStream: (() => void) | null;

  // Derived
  activeThread: Thread | null;
  messages: Array<ChatMessage & { attachments?: ContextAttachment[] }>;
  activeToolTimeline: ToolTimelineItem[];
  pendingTools: ToolTimelineItem[];
  completedTools: ToolTimelineItem[];

  // Actions
  setThreads: (value: Thread[] | ((current: Thread[]) => Thread[])) => void;
  setActiveThreadId: (id: string) => void;
  setReasoningOpen: (value: boolean) => void;
  setTaskOpen: (value: boolean) => void;
  setTimelineOpen: (value: boolean) => void;
  persistThreads: () => void;
  initStreamListener: () => void;
  cleanupStreamListener: () => void;
  onApprove: (approvalId: string, input: Record<string, unknown>) => Promise<void>;
  onDeny: (approvalId: string) => Promise<void>;
  onAnswerQuestion: (approvalId: string, answers: Record<string, string>) => Promise<void>;
  onAbortStream: () => Promise<void>;
  onSubmit: (
    message: {
      text: string;
      files: Array<{ filename?: string; mediaType?: string; url?: string }>;
    },
    event: FormEvent<HTMLFormElement>,
    effort?: string
  ) => Promise<void>;
  makeMessage: typeof makeMessage;
  deriveThreadTitle: typeof deriveThreadTitle;
};

export const useChatStore = create<ChatState>((set, get) => ({
  threads: safeLoadThreads(),
  activeThreadId: "",
  executionRequestId: null,
  executionAssistantMessageId: null,
  activeToolTimelineByRequest: {},
  reasoningText: "",
  reasoningOpen: false,
  isThinking: false,
  taskOpen: true,
  timelineOpen: true,
  slashCommands: FALLBACK_SLASH_COMMANDS,
  isSending: false,
  permissionMode: "unknown",
  contextUsage: null,
  limitsWarning: null,
  compactCount: 0,
  permissionDenials: [],
  sessionCostUsd: null,
  pendingApproval: null,
  pendingQuestion: null,

  _activeStreamRef: null,
  _unsubscribeStream: null,

  get activeThread() {
    const { threads, activeThreadId } = get();
    return threads.find((t) => t.id === activeThreadId) ?? threads[0] ?? null;
  },

  get messages() {
    const activeThread = get().activeThread;
    return activeThread?.messages ?? [];
  },

  get activeToolTimeline() {
    const { executionRequestId, activeToolTimelineByRequest } = get();
    return executionRequestId ? activeToolTimelineByRequest[executionRequestId] || [] : [];
  },

  get pendingTools() {
    return get().activeToolTimeline.filter((item) => item.status === "pending");
  },

  get completedTools() {
    return get().activeToolTimeline.filter((item) => item.status !== "pending");
  },

  setThreads: (value) =>
    set((state) => {
      const next = typeof value === "function" ? value(state.threads) : value;
      return { threads: next };
    }),

  setActiveThreadId: (id) => set({ activeThreadId: id }),
  setReasoningOpen: (value) => set({ reasoningOpen: value }),
  setTaskOpen: (value) => set({ taskOpen: value }),
  setTimelineOpen: (value) => set({ timelineOpen: value }),

  persistThreads: () => {
    try {
      localStorage.setItem(THREADS_STORAGE_KEY, JSON.stringify(get().threads));
    } catch {
      // Ignore
    }
  },

  initStreamListener: () => {
    const unsubscribe = window.desktop.chat.onStreamEvent((event: ChatStreamEvent) => {
      const active = get()._activeStreamRef;
      if (!active || event.requestId !== active.requestId) return;

      if (event.type === "slashCommands") {
        if (event.commands.length > 0) {
          set({ slashCommands: Array.from(new Set(event.commands)) });
        }
        return;
      }

      if (event.type === "status") {
        set({ permissionMode: event.permissionMode, contextUsage: event.context });
        return;
      }

      if (event.type === "limits") {
        set({
          limitsWarning: {
            level: event.level,
            message: event.message,
            fiveHourPercent: event.fiveHourPercent,
            weeklyPercent: event.weeklyPercent
          }
        });
        return;
      }

      if (event.type === "compactBoundary") {
        set((state) => ({ compactCount: state.compactCount + 1 }));
        return;
      }

      if (event.type === "permissionDenials") {
        set((state) => ({
          permissionDenials: [...new Set([...state.permissionDenials, ...event.denials])]
        }));
        return;
      }

      if (event.type === "approvalRequest") {
        // Auto-aprovação se existe regra persistida
        if (usePermissionsStore.getState().matchesRule(event.toolName, event.input)) {
          void window.desktop.chat.respondToApproval(event.approvalId, {
            behavior: "allow",
            updatedInput: event.input
          });
          return;
        }
        set({
          pendingApproval: {
            approvalId: event.approvalId,
            toolName: event.toolName,
            input: event.input
          }
        });
        return;
      }

      if (event.type === "askUser") {
        set({
          pendingQuestion: {
            approvalId: event.approvalId,
            questions: event.input.questions
          }
        });
        return;
      }

      if (event.type === "toolUse") {
        set((state) => {
          const currentItems = state.activeToolTimelineByRequest[event.requestId] || [];
          const nextSummary =
            event.name === "AskUserQuestion"
              ? JSON.stringify(event.input)
              : summarizeToolInput(event.input);
          const existingIndex = currentItems.findIndex(
            (item) => item.toolUseId === event.toolUseId
          );
          const nextItems: ToolTimelineItem[] =
            existingIndex >= 0
              ? currentItems.map((item, index) =>
                  index === existingIndex
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
          return {
            activeToolTimelineByRequest: {
              ...state.activeToolTimelineByRequest,
              [event.requestId]: nextItems
            },
            reasoningText: appendReasoningLine(state.reasoningText, `Calling ${event.name}...`),
            reasoningOpen: false,
            isThinking: true,
            taskOpen: true,
            timelineOpen: true
          };
        });
        return;
      }

      if (event.type === "toolResult") {
        set((state) => {
          const currentItems = state.activeToolTimelineByRequest[event.requestId] || [];
          const resultSummary = summarizeToolResult(event.content);
          const nextStatus: ToolTimelineItem["status"] = event.isError ? "error" : "completed";
          const existingIndex = currentItems.findIndex(
            (item) => item.toolUseId === event.toolUseId
          );
          const nextItems: ToolTimelineItem[] =
            existingIndex >= 0
              ? currentItems.map((item, index) =>
                  index === existingIndex
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
          return {
            activeToolTimelineByRequest: {
              ...state.activeToolTimelineByRequest,
              [event.requestId]: nextItems
            },
            reasoningText: appendReasoningLine(
              state.reasoningText,
              event.isError
                ? `Tool ${event.toolUseId} completed with error.`
                : `Tool ${event.toolUseId} completed.`
            )
          };
        });
        return;
      }

      if (event.type === "delta") {
        set((state) => {
          const nextThreads = state.threads.map((thread) => {
            if (thread.id !== active.threadId) return thread;
            const nextMessages = thread.messages.map((message) =>
              message.id === active.assistantMessageId
                ? { ...message, content: event.content }
                : message
            );
            return {
              ...thread,
              messages: nextMessages,
              updatedAt: Date.now(),
              title: deriveThreadTitle(nextMessages, thread.title)
            };
          });
          return { threads: nextThreads, isThinking: false, reasoningOpen: false };
        });
        return;
      }

      if (event.type === "done") {
        set((state) => {
          const nextThreads = state.threads.map((thread) => {
            if (thread.id !== active.threadId) return thread;
            const nextMessages = thread.messages.map((message) =>
              message.id === active.assistantMessageId
                ? { ...message, content: event.content }
                : message
            );
            const prevCost = thread.accumulatedCostUsd ?? 0;
            const addCost = event.sessionCostUsd ?? 0;
            return {
              ...thread,
              messages: nextMessages,
              updatedAt: Date.now(),
              title: deriveThreadTitle(nextMessages, thread.title),
              accumulatedCostUsd: prevCost + addCost,
              sessionId: event.sessionId ?? thread.sessionId
            };
          });
          return {
            threads: nextThreads,
            isSending: false,
            isThinking: false,
            reasoningOpen: false,
            taskOpen: false,
            timelineOpen: false,
            sessionCostUsd: event.sessionCostUsd ?? null,
            pendingApproval: null,
            pendingQuestion: null,
            _activeStreamRef: null
          };
        });
        useSettingsStore.getState().setStatus(`Reply via ${event.provider}.`);
        void Promise.all([
          useSettingsStore.getState().refreshSettings(),
          useGitStore.getState().refreshGitSummary(),
          useGitStore.getState().refreshRecentCommits(),
          useWorkspaceStore.getState().refreshWorkspaceFileTree()
        ]);
        return;
      }

      if (event.type === "aborted") {
        set({
          isSending: false,
          isThinking: false,
          reasoningOpen: false,
          taskOpen: false,
          timelineOpen: false,
          pendingApproval: null,
          pendingQuestion: null,
          _activeStreamRef: null
        });
        useSettingsStore.getState().setStatus("Response interrupted.");
        return;
      }

      if (event.type === "error") {
        const friendlyError = normalizeErrorMessage(event.error);
        const subtype = event.errorSubtype || "error";
        const baseMessage =
          subtype === "error_max_turns"
            ? "Limite de turnos atingido."
            : subtype === "error_max_budget_usd"
              ? "Limite de custo atingido."
              : friendlyError;
        set((state) => {
          const nextThreads = state.threads.map((thread) => {
            if (thread.id !== active.threadId) return thread;
            const nextMessages = thread.messages.map((message) =>
              message.id === active.assistantMessageId
                ? { ...message, content: `Error: ${baseMessage}` }
                : message
            );
            return {
              ...thread,
              messages: nextMessages,
              updatedAt: Date.now(),
              title: deriveThreadTitle(nextMessages, thread.title)
            };
          });
          return {
            threads: nextThreads,
            isSending: false,
            isThinking: false,
            reasoningOpen: false,
            taskOpen: false,
            timelineOpen: false,
            pendingApproval: null,
            pendingQuestion: null,
            _activeStreamRef: null
          };
        });
        useSettingsStore.getState().setStatus(baseMessage);
      }
    });

    set({ _unsubscribeStream: unsubscribe });
  },

  cleanupStreamListener: () => {
    const { _unsubscribeStream, _activeStreamRef } = get();
    if (_unsubscribeStream) _unsubscribeStream();
    if (_activeStreamRef) {
      void window.desktop.chat.abortStream(_activeStreamRef.requestId);
    }
    set({ _unsubscribeStream: null });
  },

  onApprove: async (approvalId, input) => {
    set({ pendingApproval: null });
    await window.desktop.chat.respondToApproval(approvalId, {
      behavior: "allow",
      updatedInput: input
    });
  },

  onDeny: async (approvalId) => {
    set({ pendingApproval: null });
    await window.desktop.chat.respondToApproval(approvalId, {
      behavior: "deny",
      message: "User denied."
    });
  },

  onAnswerQuestion: async (approvalId, answers) => {
    set({ pendingQuestion: null });
    await window.desktop.chat.respondToApproval(approvalId, {
      behavior: "allow",
      updatedInput: { answers }
    });
  },

  onAbortStream: async () => {
    const active = get()._activeStreamRef;
    if (!active) return;
    try {
      await window.desktop.chat.abortStream(active.requestId);
    } catch {
      // Ignore
    }
  },

  onSubmit: async (message, event, effort) => {
    event.preventDefault();
    const settings = useSettingsStore.getState().settings;
    const contextFiles = useWorkspaceStore.getState().contextFiles;

    const prompt = message.text.trim();
    const state = get();
    const activeThread = state.activeThread;

    if (!activeThread || !settings || !prompt) return;
    if (state.isSending) return;
    if (settings.authMode === "api-key" && !settings.hasApiKey) return;
    const isSlashCommand = /^\/\S+/.test(prompt);

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
    const nextMessages = [...activeThread.messages, userMessage];
    const messagesForSend = [
      ...activeThread.messages.map((msg) => ({ id: msg.id, role: msg.role, content: msg.content })),
      { id: userMessage.id, role: "user" as const, content: finalPrompt }
    ];

    set((s) => ({
      executionRequestId: null,
      executionAssistantMessageId: assistantMessage.id,
      activeToolTimelineByRequest: {},
      reasoningText: "Preparing execution...",
      reasoningOpen: false,
      isThinking: true,
      taskOpen: true,
      timelineOpen: true,
      contextUsage: null,
      permissionMode: "unknown",
      limitsWarning: null,
      compactCount: 0,
      permissionDenials: [],
      sessionCostUsd: null,
      isSending: true,
      threads: s.threads.map((thread) =>
        thread.id === threadId
          ? {
              ...thread,
              messages: [...nextMessages, assistantMessage],
              updatedAt: Date.now(),
              title: deriveThreadTitle(nextMessages, thread.title)
            }
          : thread
      )
    }));

    useWorkspaceStore.getState().setContextFiles([]);
    useSettingsStore.getState().setStatus("Starting stream...");

    try {
      const started = await window.desktop.chat.startStream({
        messages: messagesForSend,
        effort: isOpusModel(settings.model) && effort ? effort : undefined,
        contextFiles: contextForSend,
        resumeSessionId: activeThread.sessionId ?? ""
      });
      set({
        _activeStreamRef: {
          requestId: started.requestId,
          assistantMessageId: assistantMessage.id,
          threadId
        },
        executionRequestId: started.requestId,
        activeToolTimelineByRequest: { [started.requestId]: [] }
      });
      useSettingsStore.getState().setStatus(`Streaming via ${started.provider}...`);
    } catch (error) {
      const messageText = normalizeErrorMessage((error as Error).message);
      set((s) => ({
        threads: s.threads.map((thread) => {
          if (thread.id !== threadId) return thread;
          const patchedMessages = [
            ...nextMessages,
            { ...assistantMessage, content: `Error: ${messageText}` }
          ];
          return {
            ...thread,
            messages: patchedMessages,
            updatedAt: Date.now(),
            title: deriveThreadTitle(patchedMessages, thread.title)
          };
        }),
        isSending: false,
        executionRequestId: null,
        reasoningOpen: false,
        isThinking: false,
        _activeStreamRef: null
      }));
      useSettingsStore.getState().setStatus(messageText);
    }
  },

  makeMessage,
  deriveThreadTitle
}));
