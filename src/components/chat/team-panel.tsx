import { useEffect, useState } from "react";
import { ArrowDownToLine, ChevronDown, Loader2, MessageSquare, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTeamStore, type ActiveTeam } from "@/stores/team-store";
import { useChatStore } from "@/stores/chat-store";
import { ToolApproval } from "@/components/chat/tool-approval";
import { DraggableWindow } from "@/components/teams/DraggableWindow";
import { TeamChat } from "@/components/teams/TeamChat";
import { AgentCard } from "@/components/teams/AgentCard";
import { TaskBoard } from "@/components/teams/TaskBoard";
import type { PendingApproval } from "@/stores/chat-store";
import { getPendingApprovals, markPermissionHandled } from "@/lib/team-permission-utils";
import type { TeamPermissionRequest } from "@/lib/team-permission-utils";

// ---------------------------------------------------------------------------
// Single team section
// ---------------------------------------------------------------------------

function TeamSection({ team }: { team: ActiveTeam }) {
  const { config, tasks, inboxes } = team;
  const [collapsed, setCollapsed] = useState(false);
  const [resuming, setResuming] = useState(false);
  const [, forceUpdate] = useState(0);
  const [showTeamChat, setShowTeamChat] = useState(false);
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
      {/* Team header */}
      <div className="flex items-center gap-0.5">
        {/* Collapse toggle — ocupa o espaço restante */}
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          className="flex flex-1 items-center gap-2 rounded-lg px-0.5 py-0.5 text-left transition hover:bg-muted/10"
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

        {/* Botões de janela flutuante */}
        <button
          type="button"
          title="Chat"
          onClick={() => setShowTeamChat((v) => !v)}
          className={cn(
            "flex size-6 shrink-0 items-center justify-center rounded-md transition",
            showTeamChat
              ? "bg-violet-500/15 text-violet-500"
              : "text-muted-foreground/40 hover:bg-muted/20 hover:text-muted-foreground"
          )}
        >
          <MessageSquare className="size-3" />
        </button>
      </div>

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

          {/* Manual resume — aparece APENAS se o time travar (inativo mas não concluído) */}
          {showManualResume && activeTasks.length === 0 && (
            <div className="flex animate-in fade-in zoom-in duration-300">
              <button
                className={cn(
                  "flex w-full items-center justify-center gap-2 rounded-xl border border-amber-500/25 bg-amber-500/[0.04] px-3 py-2 text-xs font-semibold text-amber-600 transition dark:text-amber-400",
                  resuming ? "opacity-50" : "hover:bg-amber-500/10"
                )}
                disabled={resuming}
                onClick={() => void handleManualResume()}
                type="button"
                title="O time parece ter parado. Clique para forçar a verificação de mensagens."
              >
                {resuming ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <ArrowDownToLine className="size-3.5" />
                )}
                {resuming ? "A retomar..." : "O time parou? Clique para continuar"}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Janelas flutuantes arrastáveis */}
      {showTeamChat && (
        <DraggableWindow
          title={`${config.name} — Chat`}
          icon={<MessageSquare className="size-3.5" />}
          onClose={() => setShowTeamChat(false)}
          defaultPosition={{ x: window.innerWidth * 0.52, y: window.innerHeight * 0.18 }}
          width={380}
          height={480}
        >
          <TeamChat
            teamName={team.teamName}
            members={config.members}
            tasks={tasks}
            inboxes={inboxes}
          />
        </DraggableWindow>
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
