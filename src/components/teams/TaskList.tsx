import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Clock, Loader2 } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import type { TodoItem } from "@/lib/chat-types";
import { useChatStore } from "@/stores/chat-store";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sortTodos(todos: TodoItem[]): TodoItem[] {
  const order: Record<string, number> = { in_progress: 0, pending: 1, completed: 2 };
  return [...todos].sort((a, b) => (order[a.status] ?? 1) - (order[b.status] ?? 1));
}

// ---------------------------------------------------------------------------
// Status icon
// ---------------------------------------------------------------------------

function StatusIcon({ status }: { status: TodoItem["status"] }) {
  switch (status) {
    case "in_progress":
      return <Loader2 className="mt-0.5 size-3.5 shrink-0 animate-spin text-yellow-500" />;
    case "completed":
      return <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-emerald-500" />;
    case "pending":
    default:
      return <Clock className="mt-0.5 size-3.5 shrink-0 text-blue-400/80" />;
  }
}

// ---------------------------------------------------------------------------
// TaskList — reads TodoWrite todos from the active Claude Code session
// Props: none — self-contained via useChatStore + IPC
// ---------------------------------------------------------------------------

export function TaskList() {
  // Get the sessionId of the most-recently-started session that has one
  const sessionId = useChatStore((s) => {
    const thread = s.threads.find((t) => t.id === s.activeThreadId) ?? s.threads[0] ?? null;
    if (!thread) return null;
    for (let i = thread.sessions.length - 1; i >= 0; i--) {
      if (thread.sessions[i].sessionId) return thread.sessions[i].sessionId!;
    }
    return null;
  });

  const [todos, setTodos] = useState<TodoItem[]>([]);
  const watchedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!sessionId) {
      setTodos([]);
      return;
    }
    if (watchedRef.current === sessionId) return;
    watchedRef.current = sessionId;

    void window.desktop.todos.watch(sessionId);

    const unsub = window.desktop.todos.onUpdate((payload) => {
      if (payload.sessionId === sessionId) {
        setTodos(payload.todos);
      }
    });

    return () => {
      unsub();
      void window.desktop.todos.unwatch(sessionId);
      watchedRef.current = null;
    };
  }, [sessionId]);

  const sorted = sortTodos(todos);
  const activeCount = todos.filter((t) => t.status !== "completed").length;
  const completedCount = todos.filter((t) => t.status === "completed").length;

  if (todos.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 px-4 py-10 text-center">
        <Clock className="size-8 text-muted-foreground/15" />
        <p className="text-[12px] text-muted-foreground/40 italic">
          {sessionId ? "Nenhuma task criada ainda." : "Sem sessão activa."}
        </p>
        {sessionId && (
          <p className="text-[11px] text-muted-foreground/30">
            Pede ao Claude para usar <code className="font-mono">TodoWrite</code>
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Summary bar */}
      <div className="flex shrink-0 items-center gap-2 border-b border-border/30 px-3 py-2">
        <span className="text-[11px] text-muted-foreground/70">
          {activeCount} activ{activeCount !== 1 ? "as" : "a"}
        </span>
        {completedCount > 0 && (
          <>
            <span className="text-muted-foreground/20">·</span>
            <span className="text-[11px] text-muted-foreground/40">
              {completedCount} concluída{completedCount !== 1 ? "s" : ""}
            </span>
          </>
        )}
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-0.5 py-2 pr-1">
          {sorted.map((todo, i) => {
            const dimmed = todo.status === "completed";
            return (
              <div
                key={i}
                className={cn(
                  "flex items-start gap-2.5 rounded-lg px-3 py-2 transition-colors",
                  todo.status === "in_progress" && "bg-yellow-500/5",
                  dimmed && "opacity-50"
                )}
              >
                <StatusIcon status={todo.status} />
                <div className="min-w-0 flex-1">
                  <p
                    className={cn(
                      "text-[12px] leading-relaxed",
                      dimmed ? "text-muted-foreground/50 line-through" : "text-foreground/80"
                    )}
                  >
                    {todo.content}
                  </p>
                  {todo.activeForm && todo.status === "in_progress" && (
                    <p className="mt-0.5 text-[10px] italic text-yellow-600/70 dark:text-yellow-400/60">
                      {todo.activeForm}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
}
