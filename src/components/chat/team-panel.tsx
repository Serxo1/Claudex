import { useEffect, useRef, useState } from "react";
import {
  ArrowDownToLine,
  CheckCircle2,
  ChevronDown,
  Clock3,
  Loader2,
  Mail,
  Send,
  Users
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useTeamStore, type ActiveTeam } from "@/stores/team-store";
import { useChatStore } from "@/stores/chat-store";
import { ToolApproval } from "@/components/chat/tool-approval";
import type { PendingApproval } from "@/stores/chat-store";
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
  messages,
  teamName
}: {
  member: { name: string; agentType: string; model: string };
  tasks: TeamTask[];
  messages: TeamInboxMessage[];
  teamName: string;
}) {
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
// Pending approvals helpers
// ---------------------------------------------------------------------------

type TeamPermissionRequest = {
  requestId: string;
  agentId: string;
  toolName: string;
  input: Record<string, unknown>;
};

// Module-level tracking of already-responded permission requests (persists across renders)
const _handledPermissions = new Map<string, Set<string>>();

// Permission requests older than this are considered expired (agent already timed out)
const PERMISSION_EXPIRY_MS = 2 * 60 * 1000; // 2 minutes

function markPermissionHandled(teamName: string, requestId: string) {
  if (!_handledPermissions.has(teamName)) _handledPermissions.set(teamName, new Set());
  _handledPermissions.get(teamName)!.add(requestId);
}

function isPermissionHandled(teamName: string, requestId: string): boolean {
  return _handledPermissions.get(teamName)?.has(requestId) ?? false;
}

/** Collect unprocessed permission_request messages from team-lead's inbox. */
function getPendingApprovals(
  teamName: string,
  inboxes: Record<string, TeamInboxMessage[]>
): TeamPermissionRequest[] {
  const leadMessages = inboxes["team-lead"] ?? [];
  const pending: TeamPermissionRequest[] = [];
  const now = Date.now();
  for (const msg of leadMessages) {
    try {
      const p = JSON.parse(msg.text) as Record<string, unknown>;
      if (p.type !== "permission_request") continue;
      const requestId = typeof p.request_id === "string" ? p.request_id : "";
      if (!requestId || isPermissionHandled(teamName, requestId)) continue;
      // Skip expired requests — the agent already timed out waiting for a response
      const msgTime = msg.timestamp ? new Date(msg.timestamp).getTime() : 0;
      if (msgTime > 0 && now - msgTime > PERMISSION_EXPIRY_MS) {
        markPermissionHandled(teamName, requestId);
        continue;
      }
      pending.push({
        requestId,
        agentId: typeof p.agent_id === "string" ? p.agent_id : msg.from,
        toolName: typeof p.tool_name === "string" ? p.tool_name : "tool",
        input: (p.input as Record<string, unknown>) ?? {}
      });
    } catch {
      // not JSON
    }
  }
  return pending;
}

// ---------------------------------------------------------------------------
// Single team section
// ---------------------------------------------------------------------------

function TeamSection({ team }: { team: ActiveTeam }) {
  const { config, tasks, inboxes } = team;
  const [collapsed, setCollapsed] = useState(false);
  const [resuming, setResuming] = useState(false);
  const [, forceUpdate] = useState(0);
  const manualResumeForTeam = useChatStore((s) => s.manualResumeForTeam);

  // Re-evaluate pending approvals every 30s so expired ones disappear automatically
  useEffect(() => {
    const interval = setInterval(() => forceUpdate((n) => n + 1), 30_000);
    return () => clearInterval(interval);
  }, []);

  if (!config) return null;

  const members = config.members.filter((m) => m.agentType !== "team-lead");
  const lead = config.members.find((m) => m.agentType === "team-lead");
  const activeTasks = tasks.filter((t) => t.status === "in_progress");
  const allDone =
    tasks.length > 0 && tasks.every((t) => t.status === "completed" || t.status === "deleted");
  const pendingApprovals = getPendingApprovals(team.teamName, inboxes);

  // Real messages from agents in team-lead's inbox (non-SDK-internal)
  const leadInboxMessages = inboxes["team-lead"] ?? [];
  const realLeadMessages = leadInboxMessages.filter((msg) => {
    try {
      const p = JSON.parse(msg.text) as Record<string, unknown>;
      return (
        p.type !== "idle_notification" &&
        p.type !== "permission_request" &&
        p.type !== "shutdown_request"
      );
    } catch {
      return true;
    }
  });
  // Show manual resume button when: agents sent messages, no pending approvals blocking, not all tasks done via TaskUpdate
  const showManualResume = realLeadMessages.length > 0 && pendingApprovals.length === 0 && !allDone;

  const handlePermission = async (perm: TeamPermissionRequest, behavior: "allow" | "deny") => {
    markPermissionHandled(team.teamName, perm.requestId);
    await window.desktop.teams.respondToPermission({
      teamName: team.teamName,
      agentId: perm.agentId,
      requestId: perm.requestId,
      behavior
    });
  };

  const handleManualResume = async () => {
    setResuming(true);
    await manualResumeForTeam(team.teamName);
    setResuming(false);
  };

  return (
    <div className="space-y-2">
      {/* Team header — clicável para colapsar/expandir */}
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        className="flex w-full items-center gap-2 rounded-lg px-0.5 py-0.5 text-left transition hover:bg-muted/10"
      >
        <div
          className={cn(
            "flex size-5 shrink-0 items-center justify-center rounded-full",
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
        <div className="min-w-0 flex-1">
          <span className="text-xs font-semibold text-foreground/80">{config.name}</span>
          {config.description && !collapsed && (
            <span className="ml-2 text-[10px] text-muted-foreground/40 truncate">
              {config.description}
            </span>
          )}
        </div>
        {/* Pills de estado — visíveis mesmo colapsado */}
        {pendingApprovals.length > 0 && (
          <span className="flex items-center gap-1 rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-400">
            {pendingApprovals.length} aprovação{pendingApprovals.length !== 1 ? "s" : ""}
          </span>
        )}
        {activeTasks.length > 0 && pendingApprovals.length === 0 && (
          <span className="flex items-center gap-1 rounded-full bg-blue-500/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-blue-500">
            <span className="size-1.5 animate-pulse rounded-full bg-blue-500" />
            {activeTasks.length} em curso
          </span>
        )}
        {allDone && pendingApprovals.length === 0 && (
          <span className="rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-emerald-600 dark:text-emerald-400">
            concluído
          </span>
        )}
        <ChevronDown
          className={cn(
            "size-3 shrink-0 text-muted-foreground/40 transition-transform duration-200",
            collapsed && "-rotate-90"
          )}
        />
      </button>

      {/* Aprovações pendentes — sempre visíveis mesmo colapsado */}
      {pendingApprovals.map((perm) => {
        const approval: PendingApproval = {
          approvalId: perm.requestId,
          toolName: perm.toolName,
          input: perm.input
        };
        return (
          <ToolApproval
            key={perm.requestId}
            approval={approval}
            onApprove={async (_, input) => handlePermission({ ...perm, input }, "allow")}
            onDeny={async () => handlePermission(perm, "deny")}
          />
        );
      })}

      {/* Corpo colapsável */}
      {!collapsed && (
        <div className="space-y-3">
          {/* Agent grid */}
          {(members.length > 0 || lead) && (
            <div className={cn("grid gap-2", members.length >= 2 ? "grid-cols-2" : "grid-cols-1")}>
              {/* Lead card (se tiver tasks ou mensagens) */}
              {lead && (tasks.some((t) => t.owner === lead.name) || inboxes[lead.name]?.length) ? (
                <AgentCard
                  key={lead.agentId}
                  member={lead}
                  tasks={tasks}
                  messages={inboxes[lead.name] ?? []}
                  teamName={team.teamName}
                />
              ) : null}
              {members.map((m) => (
                <AgentCard
                  key={m.agentId}
                  member={m}
                  tasks={tasks}
                  messages={inboxes[m.name] ?? []}
                  teamName={team.teamName}
                />
              ))}
            </div>
          )}

          {/* Task board */}
          {tasks.length > 0 && <TaskBoard tasks={tasks} />}

          {/* Manual resume — fallback quando agentes reportaram mas não chamaram TaskUpdate */}
          {showManualResume && (
            <button
              className={cn(
                "flex w-full items-center justify-center gap-2 rounded-xl border border-emerald-500/25 bg-emerald-500/[0.04] px-3 py-2 text-xs font-semibold text-emerald-600 transition dark:text-emerald-400",
                resuming ? "opacity-50" : "hover:bg-emerald-500/10"
              )}
              disabled={resuming}
              onClick={() => void handleManualResume()}
              type="button"
            >
              {resuming ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <ArrowDownToLine className="size-3.5" />
              )}
              {resuming ? "A retomar sessão…" : "Receber resultados"}
            </button>
          )}
        </div>
      )}
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
