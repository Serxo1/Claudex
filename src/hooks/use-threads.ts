import { useEffect, useMemo, useState } from "react";
import type { ChatMessage, ContextAttachment, Thread } from "@/lib/chat-types";
import { THREADS_STORAGE_KEY } from "@/lib/chat-types";

function makeMessage(
  role: "user" | "assistant",
  content: string,
  attachments?: ContextAttachment[]
): ChatMessage & { attachments?: ContextAttachment[] } {
  return {
    id: crypto.randomUUID(),
    role,
    content,
    attachments
  };
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
    if (!raw) {
      return [makeDefaultThread()];
    }

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [makeDefaultThread()];
    }

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
  if (!firstUserMessage) {
    return fallback;
  }
  const compact = firstUserMessage.content.replace(/\s+/g, " ").trim();
  return compact.length > 44 ? `${compact.slice(0, 44)}...` : compact;
}

export interface UseThreadsReturn {
  threads: Thread[];
  setThreads: React.Dispatch<React.SetStateAction<Thread[]>>;
  activeThreadId: string;
  setActiveThreadId: (id: string) => void;
  activeThread: Thread | null;
  messages: Array<ChatMessage & { attachments?: ContextAttachment[] }>;
  makeMessage: typeof makeMessage;
  deriveThreadTitle: typeof deriveThreadTitle;
}

export function useThreads(): UseThreadsReturn {
  const [threads, setThreads] = useState<Thread[]>(() => safeLoadThreads());
  const [activeThreadId, setActiveThreadId] = useState<string>("");

  useEffect(() => {
    if (!activeThreadId && threads[0]) {
      setActiveThreadId(threads[0].id);
    }
  }, [activeThreadId, threads]);

  const activeThread = useMemo(
    () => threads.find((thread) => thread.id === activeThreadId) ?? threads[0] ?? null,
    [activeThreadId, threads]
  );

  const messages = activeThread?.messages ?? [];

  useEffect(() => {
    try {
      localStorage.setItem(THREADS_STORAGE_KEY, JSON.stringify(threads));
    } catch {
      // Ignore local storage write failures.
    }
  }, [threads]);

  return {
    threads,
    setThreads,
    activeThreadId,
    setActiveThreadId,
    activeThread,
    messages,
    makeMessage,
    deriveThreadTitle
  };
}
