import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import type {
  AppSettings,
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
import { FALLBACK_SLASH_COMMANDS } from "@/lib/chat-types";
import {
  appendReasoningLine,
  isOpusModel,
  normalizeErrorMessage,
  summarizeToolInput,
  summarizeToolResult
} from "@/lib/chat-utils";

export interface UseChatStreamReturn {
  executionRequestId: string | null;
  executionAssistantMessageId: string | null;
  activeToolTimelineByRequest: Record<string, ToolTimelineItem[]>;
  activeToolTimeline: ToolTimelineItem[];
  pendingTools: ToolTimelineItem[];
  completedTools: ToolTimelineItem[];
  reasoningText: string;
  reasoningOpen: boolean;
  setReasoningOpen: (value: boolean) => void;
  isThinking: boolean;
  taskOpen: boolean;
  setTaskOpen: (value: boolean) => void;
  timelineOpen: boolean;
  setTimelineOpen: (value: boolean) => void;
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
  slashCommands: string[];
  isSending: boolean;
  pendingApproval: PendingApproval | null;
  pendingQuestion: PendingQuestion | null;
  onApprove: (approvalId: string, input: Record<string, unknown>) => Promise<void>;
  onDeny: (approvalId: string) => Promise<void>;
  onAnswerQuestion: (approvalId: string, answers: Record<string, string>) => Promise<void>;
  onAbortStream: () => Promise<void>;
  onSubmit: (
    message: {
      text: string;
      files: Array<{ filename?: string; mediaType?: string; url?: string }>;
    },
    event: FormEvent<HTMLFormElement>
  ) => Promise<void>;
}

export function useChatStream(
  settings: AppSettings | null,
  activeThread: Thread | null,
  setThreads: React.Dispatch<React.SetStateAction<Thread[]>>,
  setInput: React.Dispatch<React.SetStateAction<string>>,
  setContextFiles: React.Dispatch<React.SetStateAction<ContextAttachment[]>>,
  contextFiles: ContextAttachment[],
  effort: string,
  setStatus: (value: string) => void,
  refreshSettings: () => Promise<void>,
  refreshGitSummary: () => Promise<void>,
  refreshRecentCommits: () => Promise<void>,
  refreshWorkspaceFileTree: () => Promise<void>,
  makeMessage: (
    role: "user" | "assistant",
    content: string,
    attachments?: ContextAttachment[]
  ) => ChatMessage & { attachments?: ContextAttachment[] },
  deriveThreadTitle: (messages: ChatMessage[], fallback?: string) => string
): UseChatStreamReturn {
  const [executionRequestId, setExecutionRequestId] = useState<string | null>(null);
  const [executionAssistantMessageId, setExecutionAssistantMessageId] = useState<string | null>(
    null
  );
  const [activeToolTimelineByRequest, setActiveToolTimelineByRequest] = useState<
    Record<string, ToolTimelineItem[]>
  >({});
  const [reasoningOpen, setReasoningOpen] = useState(false);
  const [reasoningText, setReasoningText] = useState("");
  const [isThinking, setIsThinking] = useState(false);
  const [taskOpen, setTaskOpen] = useState(true);
  const [timelineOpen, setTimelineOpen] = useState(true);
  const [slashCommands, setSlashCommands] = useState<string[]>(FALLBACK_SLASH_COMMANDS);
  const [isSending, setIsSending] = useState(false);
  const [permissionMode, setPermissionMode] = useState<PermissionMode>("unknown");
  const [contextUsage, setContextUsage] = useState<UseChatStreamReturn["contextUsage"]>(null);
  const [limitsWarning, setLimitsWarning] = useState<UseChatStreamReturn["limitsWarning"]>(null);
  const [pendingApproval, setPendingApproval] = useState<PendingApproval | null>(null);
  const [pendingQuestion, setPendingQuestion] = useState<PendingQuestion | null>(null);

  const activeStreamRef = useRef<{
    requestId: string;
    assistantMessageId: string;
    threadId: string;
  } | null>(null);

  const activeToolTimeline = useMemo(
    () => (executionRequestId ? activeToolTimelineByRequest[executionRequestId] || [] : []),
    [activeToolTimelineByRequest, executionRequestId]
  );

  const pendingTools = useMemo(
    () => activeToolTimeline.filter((item) => item.status === "pending"),
    [activeToolTimeline]
  );

  const completedTools = useMemo(
    () => activeToolTimeline.filter((item) => item.status !== "pending"),
    [activeToolTimeline]
  );

  useEffect(() => {
    const unsubscribe = window.desktop.chat.onStreamEvent((event: ChatStreamEvent) => {
      const active = activeStreamRef.current;
      if (!active || event.requestId !== active.requestId) {
        return;
      }

      if (event.type === "slashCommands") {
        if (event.commands.length > 0) {
          setSlashCommands(Array.from(new Set(event.commands)));
        }
        return;
      }

      if (event.type === "status") {
        setPermissionMode(event.permissionMode);
        setContextUsage(event.context);
        return;
      }

      if (event.type === "limits") {
        setLimitsWarning({
          level: event.level,
          message: event.message,
          fiveHourPercent: event.fiveHourPercent,
          weeklyPercent: event.weeklyPercent
        });
        return;
      }

      if (event.type === "approvalRequest") {
        setPendingApproval({
          approvalId: event.approvalId,
          toolName: event.toolName,
          input: event.input
        });
        return;
      }

      if (event.type === "askUser") {
        setPendingQuestion({
          approvalId: event.approvalId,
          questions: event.input.questions
        });
        return;
      }

      if (event.type === "toolUse") {
        setActiveToolTimelineByRequest((current) => {
          const currentItems = current[event.requestId] || [];
          const nextSummary = summarizeToolInput(event.input);
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
          return { ...current, [event.requestId]: nextItems };
        });
        setReasoningText((current) => appendReasoningLine(current, `Calling ${event.name}...`));
        setReasoningOpen(false);
        setIsThinking(true);
        setTaskOpen(true);
        setTimelineOpen(true);
        return;
      }

      if (event.type === "toolResult") {
        setActiveToolTimelineByRequest((current) => {
          const currentItems = current[event.requestId] || [];
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
          return { ...current, [event.requestId]: nextItems };
        });
        setReasoningText((current) =>
          appendReasoningLine(
            current,
            event.isError
              ? `Tool ${event.toolUseId} completed with error.`
              : `Tool ${event.toolUseId} completed.`
          )
        );
        return;
      }

      if (event.type === "delta") {
        setIsThinking(false);
        setReasoningOpen(false);
        setThreads((current) =>
          current.map((thread) => {
            if (thread.id !== active.threadId) {
              return thread;
            }
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
          })
        );
        return;
      }

      if (event.type === "done") {
        setPendingApproval(null);
        setPendingQuestion(null);
        setThreads((current) =>
          current.map((thread) => {
            if (thread.id !== active.threadId) {
              return thread;
            }
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
          })
        );
        setStatus(`Reply via ${event.provider}.`);
        setIsSending(false);
        setIsThinking(false);
        setReasoningOpen(false);
        setTaskOpen(false);
        setTimelineOpen(false);
        activeStreamRef.current = null;
        void Promise.all([
          refreshSettings(),
          refreshGitSummary(),
          refreshRecentCommits(),
          refreshWorkspaceFileTree()
        ]);
        return;
      }

      if (event.type === "aborted") {
        setPendingApproval(null);
        setPendingQuestion(null);
        setStatus("Response interrupted.");
        setIsSending(false);
        setIsThinking(false);
        setReasoningOpen(false);
        setTaskOpen(false);
        setTimelineOpen(false);
        activeStreamRef.current = null;
        return;
      }

      if (event.type === "error") {
        setPendingApproval(null);
        setPendingQuestion(null);
        const friendlyError = normalizeErrorMessage(event.error);
        setThreads((current) =>
          current.map((thread) => {
            if (thread.id !== active.threadId) {
              return thread;
            }
            const nextMessages = thread.messages.map((message) =>
              message.id === active.assistantMessageId
                ? { ...message, content: `Error: ${friendlyError}` }
                : message
            );
            return {
              ...thread,
              messages: nextMessages,
              updatedAt: Date.now(),
              title: deriveThreadTitle(nextMessages, thread.title)
            };
          })
        );
        setStatus(friendlyError);
        setIsSending(false);
        setIsThinking(false);
        setReasoningOpen(false);
        setTaskOpen(false);
        setTimelineOpen(false);
        activeStreamRef.current = null;
      }
    });

    return unsubscribe;
  }, [
    deriveThreadTitle,
    refreshGitSummary,
    refreshRecentCommits,
    refreshSettings,
    refreshWorkspaceFileTree,
    setStatus,
    setThreads
  ]);

  useEffect(() => {
    return () => {
      const active = activeStreamRef.current;
      if (active) {
        void window.desktop.chat.abortStream(active.requestId);
      }
    };
  }, []);

  useEffect(() => {
    if (isSending) {
      setTaskOpen(true);
      setTimelineOpen(true);
      return;
    }
    if (activeToolTimeline.length > 0) {
      setTaskOpen(false);
      setTimelineOpen(false);
    }
  }, [activeToolTimeline.length, isSending]);

  const onApprove = useCallback(async (approvalId: string, input: Record<string, unknown>) => {
    setPendingApproval(null);
    await window.desktop.chat.respondToApproval(approvalId, {
      behavior: "allow",
      updatedInput: input
    });
  }, []);

  const onDeny = useCallback(async (approvalId: string) => {
    setPendingApproval(null);
    await window.desktop.chat.respondToApproval(approvalId, {
      behavior: "deny",
      message: "User denied."
    });
  }, []);

  const onAnswerQuestion = useCallback(
    async (approvalId: string, answers: Record<string, string>) => {
      setPendingQuestion(null);
      await window.desktop.chat.respondToApproval(approvalId, {
        behavior: "allow",
        updatedInput: { answers }
      });
    },
    []
  );

  const onAbortStream = useCallback(async () => {
    const active = activeStreamRef.current;
    if (!active) {
      return;
    }
    try {
      await window.desktop.chat.abortStream(active.requestId);
    } catch {
      // Ignore abort transport errors.
    }
  }, []);

  const onSubmit = useCallback(
    async (
      message: {
        text: string;
        files: Array<{ filename?: string; mediaType?: string; url?: string }>;
      },
      event: FormEvent<HTMLFormElement>
    ) => {
      event.preventDefault();
      const prompt = message.text.trim();
      if (!activeThread || !settings || !prompt) {
        return;
      }
      if (isSending || !prompt) {
        return;
      }
      if (settings.authMode === "api-key" && !settings.hasApiKey) {
        return;
      }
      const isSlashCommand = /^\/\S+/.test(prompt);

      const persistedPastedFiles: ContextAttachment[] = [];
      for (const file of message.files || []) {
        const dataUrl = typeof file?.url === "string" ? file.url : "";
        if (!dataUrl.startsWith("data:image/")) {
          continue;
        }

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
          setStatus(`Failed to store pasted image: ${(error as Error).message}`);
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
      const effortValue = isOpusModel(settings.model) ? effort : undefined;

      const threadId = activeThread.id;
      const userMessage = makeMessage("user", prompt, contextForSend);
      const assistantMessage = makeMessage("assistant", "");
      const nextMessages = [...activeThread.messages, userMessage];
      const messagesForSend = [
        ...activeThread.messages.map((msg) => ({
          id: msg.id,
          role: msg.role,
          content: msg.content
        })),
        { id: userMessage.id, role: "user" as const, content: finalPrompt }
      ];

      setExecutionRequestId(null);
      setExecutionAssistantMessageId(assistantMessage.id);
      setActiveToolTimelineByRequest({});
      setReasoningText("Preparing execution...");
      setReasoningOpen(false);
      setIsThinking(true);
      setTaskOpen(true);
      setTimelineOpen(true);
      setContextUsage(null);
      setPermissionMode("unknown");
      setLimitsWarning(null);

      setThreads((current) =>
        current.map((thread) =>
          thread.id === threadId
            ? {
                ...thread,
                messages: [...nextMessages, assistantMessage],
                updatedAt: Date.now(),
                title: deriveThreadTitle(nextMessages, thread.title)
              }
            : thread
        )
      );

      setInput("");
      setContextFiles([]);
      setIsSending(true);
      setStatus("Starting stream...");

      try {
        const started = await window.desktop.chat.startStream({
          messages: messagesForSend,
          effort: effortValue,
          contextFiles: contextForSend
        });
        activeStreamRef.current = {
          requestId: started.requestId,
          assistantMessageId: assistantMessage.id,
          threadId
        };
        setExecutionRequestId(started.requestId);
        setActiveToolTimelineByRequest({ [started.requestId]: [] });
        setStatus(`Streaming via ${started.provider}...`);
      } catch (error) {
        const messageText = normalizeErrorMessage((error as Error).message);
        setThreads((current) =>
          current.map((thread) => {
            if (thread.id !== threadId) {
              return thread;
            }
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
          })
        );
        setStatus(messageText);
        activeStreamRef.current = null;
        setIsSending(false);
        setExecutionRequestId(null);
        setReasoningOpen(false);
        setIsThinking(false);
      }
    },
    [
      activeThread,
      contextFiles,
      deriveThreadTitle,
      effort,
      isSending,
      makeMessage,
      setContextFiles,
      setInput,
      setStatus,
      setThreads,
      settings
    ]
  );

  return {
    executionRequestId,
    executionAssistantMessageId,
    activeToolTimelineByRequest,
    activeToolTimeline,
    pendingTools,
    completedTools,
    reasoningText,
    reasoningOpen,
    setReasoningOpen,
    isThinking,
    taskOpen,
    setTaskOpen,
    timelineOpen,
    setTimelineOpen,
    permissionMode,
    contextUsage,
    limitsWarning,
    slashCommands,
    isSending,
    pendingApproval,
    pendingQuestion,
    onApprove,
    onDeny,
    onAnswerQuestion,
    onAbortStream,
    onSubmit
  };
}
