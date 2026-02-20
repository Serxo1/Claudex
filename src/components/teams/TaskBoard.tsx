import { CheckCircle2, Clock3, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { TeamTask } from "@/lib/chat-types";

export function TaskBoard({ tasks }: { tasks: TeamTask[] }) {
  if (tasks.length === 0) return null;

  const grouped = {
    in_progress: tasks.filter((t) => t.status === "in_progress"),
    pending: tasks.filter((t) => t.status === "pending"),
    completed: tasks.filter((t) => t.status === "completed")
  };

  return (
    <div className="space-y-1.5">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/40">
        Tasks · {tasks.length} total
      </p>
      <div className="space-y-0.5">
        {[...grouped.in_progress, ...grouped.pending, ...grouped.completed].map((task) => (
          <div key={task.id} className="flex items-center gap-2 rounded-lg px-2 py-1">
            {task.status === "in_progress" ? (
              <Loader2 className="size-3 shrink-0 animate-spin text-blue-500" />
            ) : task.status === "completed" ? (
              <CheckCircle2 className="size-3 shrink-0 text-emerald-500/60" />
            ) : (
              <Clock3 className="size-3 shrink-0 text-muted-foreground/30" />
            )}
            <span
              className={cn(
                "min-w-0 flex-1 truncate text-[11px]",
                task.status === "completed"
                  ? "text-muted-foreground/40 line-through"
                  : "text-muted-foreground/70"
              )}
            >
              {task.subject}
            </span>
            {task.owner && (
              <span className="shrink-0 rounded bg-muted/30 px-1 py-0.5 text-[9px] text-muted-foreground/40">
                {task.owner}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
