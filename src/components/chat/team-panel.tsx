import { useEffect } from "react";
import { CheckCircle2, Clock3, Loader2, Mail, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTeamStore, type ActiveTeam } from "@/stores/team-store";
import type { TeamTask, TeamInboxMessage } from "@/lib/chat-types";

// ---------------------------------------------------------------------------
// Inbox message helpers
// ---------------------------------------------------------------------------

type ParsedInbox = { text: string; isSystem: boolean };

/** Parse an inbox message text. Returns null to skip SDK-internal messages. */
function parseInboxMessage(msg: TeamInboxMessage): ParsedInbox | null {
  try {
    const parsed = JSON.parse(msg.text) as Record<string, unknown>;
    const type = parsed.type as string | undefined;
    if (type === "idle_notification") return null; // skip — SDK internal
    if (type === "permission_request") {
      return { text: `Aguarda aprovação: ${parsed.tool_name ?? "tool"}`, isSystem: true };
    }
    if (type === "message" && typeof parsed.content === "string") {
      return { text: parsed.content.slice(0, 200), isSystem: false };
    }
    if (type === "shutdown_request") {
      return { text: "Pedido de encerramento", isSystem: true };
    }
    // Unknown JSON — show summary if available, otherwise skip
    if (msg.summary) return { text: msg.summary, isSystem: false };
    return null;
  } catch {
    // Plain text message — show it
    return { text: msg.summary || msg.text.slice(0, 200), isSystem: false };
  }
}

/** Find the last non-skipped message to display in the card. */
function getLatestDisplayMessage(
  messages: TeamInboxMessage[]
): (TeamInboxMessage & { parsed: ParsedInbox }) | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const parsed = parseInboxMessage(messages[i]);
    if (parsed) return { ...messages[i], parsed };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Agent card — one per team member
// ---------------------------------------------------------------------------

function AgentCard({
  member,
  tasks,
  messages
}: {
  member: { name: string; agentType: string; model: string };
  tasks: TeamTask[];
  messages: TeamInboxMessage[];
}) {
  // Match by owner OR by subject when task has no owner (lead assigned task to agent by name)
  const myTasks = tasks.filter(
    (t) => t.owner === member.name || (!t.owner && t.subject === member.name)
  );
  const activeTasks = myTasks.filter((t) => t.status === "in_progress");
  const doneTasks = myTasks.filter((t) => t.status === "completed");
  const isActive = activeTasks.length > 0;
  const isLead = member.agentType === "team-lead";

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
    </div>
  );
}

// ---------------------------------------------------------------------------
// Task board — compact list of all tasks
// ---------------------------------------------------------------------------

function TaskBoard({ tasks }: { tasks: TeamTask[] }) {
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

// ---------------------------------------------------------------------------
// Single team section
// ---------------------------------------------------------------------------

function TeamSection({ team }: { team: ActiveTeam }) {
  const { config, tasks, inboxes } = team;
  if (!config) return null;

  const members = config.members.filter((m) => m.agentType !== "team-lead");
  const lead = config.members.find((m) => m.agentType === "team-lead");
  const activeTasks = tasks.filter((t) => t.status === "in_progress");
  const allDone =
    tasks.length > 0 && tasks.every((t) => t.status === "completed" || t.status === "deleted");

  return (
    <div className="space-y-3">
      {/* Team header */}
      <div className="flex items-center gap-2">
        <div
          className={cn(
            "flex size-5 items-center justify-center rounded-full",
            allDone
              ? "bg-emerald-500/15"
              : activeTasks.length > 0
                ? "bg-blue-500/10"
                : "bg-muted/30"
          )}
        >
          <Users
            className={cn(
              "size-3",
              allDone
                ? "text-emerald-500"
                : activeTasks.length > 0
                  ? "text-blue-500"
                  : "text-muted-foreground/50"
            )}
          />
        </div>
        <div className="flex-1 min-w-0">
          <span className="text-xs font-semibold text-foreground/80">{config.name}</span>
          {config.description && (
            <span className="ml-2 text-[10px] text-muted-foreground/40 truncate">
              {config.description}
            </span>
          )}
        </div>
        {activeTasks.length > 0 && (
          <span className="flex items-center gap-1 rounded-full bg-blue-500/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-blue-500">
            <span className="size-1.5 animate-pulse rounded-full bg-blue-500" />
            {activeTasks.length} em curso
          </span>
        )}
        {allDone && (
          <span className="rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-emerald-600 dark:text-emerald-400">
            concluído
          </span>
        )}
      </div>

      {/* Agent grid */}
      {(members.length > 0 || lead) && (
        <div
          className={cn(
            "grid gap-2",
            members.length >= 3
              ? "grid-cols-2"
              : members.length >= 2
                ? "grid-cols-2"
                : "grid-cols-1"
          )}
        >
          {/* Lead card (if has tasks or messages) */}
          {lead && (tasks.some((t) => t.owner === lead.name) || inboxes[lead.name]?.length) ? (
            <AgentCard
              key={lead.agentId}
              member={lead}
              tasks={tasks}
              messages={inboxes[lead.name] ?? []}
            />
          ) : null}
          {members.map((m) => (
            <AgentCard key={m.agentId} member={m} tasks={tasks} messages={inboxes[m.name] ?? []} />
          ))}
        </div>
      )}

      {/* Task board */}
      {tasks.length > 0 && <TaskBoard tasks={tasks} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// TeamPanel — root component, scoped to teams created in this session
// ---------------------------------------------------------------------------

type TeamPanelProps = {
  teamNames: string[];
};

export function TeamPanel({ teamNames }: TeamPanelProps) {
  const teams = useTeamStore((s) => s.teams);
  const initListener = useTeamStore((s) => s.initListener);
  const trackTeam = useTeamStore((s) => s.trackTeam);

  useEffect(() => {
    const unsub = initListener();
    return unsub;
  }, [initListener]);

  // Re-track teams on mount (handles page reload where teamNames come from localStorage
  // but sessionTeams in the store is empty, so snapshots would be rejected)
  useEffect(() => {
    for (const name of teamNames) {
      trackTeam(name);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Only show teams that belong to this session
  const activeTeams = teamNames
    .map((name) => teams[name])
    .filter(Boolean)
    .sort((a, b) => b.updatedAt - a.updatedAt);

  if (activeTeams.length === 0) return null;

  return (
    <div className="space-y-5">
      {activeTeams.map((team) => (
        <TeamSection key={team.teamName} team={team} />
      ))}
    </div>
  );
}
