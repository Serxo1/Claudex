import { useRef, useState } from "react";
import { CheckCircle2, Clock3, Loader2, Mail, Send } from "lucide-react";
import { cn } from "@/lib/utils";
import type { TeamTask, TeamInboxMessage } from "@/lib/chat-types";
import { getLatestDisplayMessage } from "@/lib/team-inbox-utils";

type AgentCardProps = {
  member: { name: string; agentType: string; model: string };
  tasks: TeamTask[];
  messages: TeamInboxMessage[];
  teamName: string;
};

export function AgentCard({ member, tasks, messages, teamName }: AgentCardProps) {
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Match by owner OR by subject when task has no owner (lead assigned task to agent by name)
  const myTasks = tasks.filter(
    (t) => t.owner === member.name || (!t.owner && t.subject === member.name)
  );
  const activeTasks = myTasks.filter((t) => t.status === "in_progress");
  const pendingTasks = myTasks.filter((t) => t.status === "pending");
  const doneTasks = myTasks.filter((t) => t.status === "completed");
  const isActive = activeTasks.length > 0;
  // Agent is alive if it has in_progress or pending tasks (hasn't finished yet)
  const isAlive = activeTasks.length > 0 || pendingTasks.length > 0;
  const isLead = member.agentType === "team-lead";

  const handleSend = async () => {
    const content = message.trim();
    if (!content || sending) return;
    setSending(true);
    await window.desktop.teams.sendMessage({ teamName, agentName: member.name, content });
    setMessage("");
    setSending(false);
    inputRef.current?.focus();
  };

  const latestMessage = getLatestDisplayMessage(messages);

  return (
    <div
      className={cn(
        "relative flex flex-col gap-2 overflow-hidden rounded-xl border p-3 transition-all",
        isActive
          ? "border-blue-500/25 bg-blue-500/[0.03] dark:border-blue-500/20"
          : doneTasks.length > 0 && activeTasks.length === 0
            ? "border-emerald-500/20 bg-emerald-500/[0.02]"
            : "border-border/40 bg-muted/[0.02]"
      )}
    >
      {/* Shimmer for active */}
      {isActive && (
        <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-xl">
          <div className="animate-shimmer absolute -inset-x-full top-0 h-full w-[200%] bg-gradient-to-r from-transparent via-blue-500/5 to-transparent" />
        </div>
      )}

      {/* Header */}
      <div className="flex items-center gap-2">
        <div
          className={cn(
            "flex size-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold",
            isLead
              ? "bg-violet-500/15 text-violet-600 dark:text-violet-400"
              : "bg-blue-500/10 text-blue-600 dark:text-blue-400"
          )}
        >
          {member.name[0]?.toUpperCase() ?? "?"}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-semibold text-foreground/80">{member.name}</p>
          <p className="truncate text-[10px] text-muted-foreground/40">
            {member.model.replace("claude-", "").replace(/-\d{8}$/, "")}
          </p>
        </div>
        {isActive ? (
          <Loader2 className="size-3 shrink-0 animate-spin text-blue-500" />
        ) : doneTasks.length > 0 ? (
          <CheckCircle2 className="size-3 shrink-0 text-emerald-500" />
        ) : null}
      </div>

      {/* Active task */}
      {activeTasks.length > 0 && (
        <div className="space-y-1">
          {activeTasks.map((task) => (
            <div
              key={task.id}
              className="rounded-lg border border-blue-500/15 bg-blue-500/[0.04] px-2 py-1.5"
            >
              <p className="line-clamp-2 text-[11px] font-medium text-blue-700 dark:text-blue-300">
                {task.activeForm || task.subject}
              </p>
            </div>
          ))}
        </div>
      )}

      {/* Done tasks summary */}
      {doneTasks.length > 0 && activeTasks.length === 0 && (
        <div className="flex items-center gap-1.5 text-[11px] text-emerald-600 dark:text-emerald-400">
          <CheckCircle2 className="size-3 shrink-0" />
          <span>
            {doneTasks.length} tarefa{doneTasks.length !== 1 ? "s" : ""} concluída
            {doneTasks.length !== 1 ? "s" : ""}
          </span>
        </div>
      )}

      {/* Pending tasks (no owner yet or pending) */}
      {myTasks.filter((t) => t.status === "pending").length > 0 && (
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground/50">
          <Clock3 className="size-3 shrink-0" />
          <span>
            {myTasks.filter((t) => t.status === "pending").length} pendente
            {myTasks.filter((t) => t.status === "pending").length !== 1 ? "s" : ""}
          </span>
        </div>
      )}

      {/* Latest inbox message (real messages only — system noise filtered out) */}
      {latestMessage && (
        <div
          className={cn(
            "rounded-lg border px-2 py-1.5",
            latestMessage.parsed.isSystem
              ? "border-border/20 bg-muted/5"
              : "border-border/30 bg-muted/10"
          )}
        >
          <div className="mb-0.5 flex items-center gap-1 text-[9px] text-muted-foreground/40">
            <Mail className="size-2.5" />
            <span className="truncate">
              {latestMessage.from} → {member.name}
            </span>
          </div>
          <p
            className={cn(
              "line-clamp-2 text-[11px]",
              latestMessage.parsed.isSystem
                ? "italic text-muted-foreground/40"
                : "text-muted-foreground/70"
            )}
          >
            {latestMessage.parsed.text}
          </p>
        </div>
      )}

      {/* Compose area — visible while agent is alive (active or pending tasks) */}
      {isAlive && (
        <div className="flex items-center gap-1.5">
          <input
            ref={inputRef}
            type="text"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void handleSend();
              }
            }}
            placeholder={
              isActive
                ? `Mensagem para ${member.name}…`
                : `${member.name} está a aguardar trabalho…`
            }
            className="min-w-0 flex-1 rounded-lg border border-border/30 bg-muted/10 px-2 py-1 text-[11px] text-foreground/80 placeholder:text-muted-foreground/30 focus:border-blue-500/40 focus:outline-none disabled:opacity-50"
            disabled={sending}
          />
          <button
            type="button"
            onClick={() => void handleSend()}
            disabled={!message.trim() || sending}
            className={cn(
              "flex size-6 shrink-0 items-center justify-center rounded-lg border transition",
              message.trim() && !sending
                ? "border-blue-500/30 bg-blue-500/10 text-blue-500 hover:bg-blue-500/20"
                : "border-border/20 bg-muted/5 text-muted-foreground/20"
            )}
          >
            {sending ? <Loader2 className="size-3 animate-spin" /> : <Send className="size-3" />}
          </button>
        </div>
      )}
    </div>
  );
}
