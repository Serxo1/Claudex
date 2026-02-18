import { useState } from "react";
import {
  Bot,
  CheckCircle2,
  ChevronDown,
  Loader2,
  Radio,
  Users,
  XCircle,
  StopCircle
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { SubagentInfo } from "@/lib/chat-types";

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m${String(s % 60).padStart(2, "0")}s`;
}

function AgentCard({ agent }: { agent: SubagentInfo }) {
  const [summaryOpen, setSummaryOpen] = useState(false);

  const isRunning = agent.status === "running";
  const isBackground = agent.status === "background";
  const isDone = agent.status === "completed";
  const isFailed = agent.status === "failed";

  const duration =
    agent.finishedAt && agent.startedAt ? formatDuration(agent.finishedAt - agent.startedAt) : null;

  return (
    <div
      className={cn(
        "group relative overflow-hidden rounded-xl border transition-all duration-200",
        isRunning
          ? "border-blue-500/25 bg-blue-500/[0.04] dark:border-blue-500/20 dark:bg-blue-500/[0.04]"
          : isBackground
            ? "border-violet-500/20 bg-violet-500/[0.03] dark:border-violet-500/15"
            : isDone
              ? "border-emerald-500/20 bg-emerald-500/[0.03] dark:border-emerald-500/15"
              : isFailed
                ? "border-destructive/25 bg-destructive/[0.04]"
                : "border-border/40 bg-muted/5"
      )}
    >
      {/* Running shimmer */}
      {isRunning && (
        <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-xl">
          <div className="animate-shimmer absolute -inset-x-full top-0 h-full w-[200%] bg-gradient-to-r from-transparent via-blue-500/5 to-transparent" />
        </div>
      )}

      <div className="flex items-start gap-2.5 px-3 py-2.5">
        {/* Status icon */}
        <div className="mt-0.5 shrink-0">
          {isRunning ? (
            <Loader2 className="size-3.5 animate-spin text-blue-500" />
          ) : isBackground ? (
            <Radio className="size-3.5 text-violet-500" />
          ) : isDone ? (
            <CheckCircle2 className="size-3.5 text-emerald-500" />
          ) : isFailed ? (
            <XCircle className="size-3.5 text-destructive" />
          ) : (
            <StopCircle className="size-3.5 text-muted-foreground/50" />
          )}
        </div>

        {/* Content */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p
              className={cn(
                "flex-1 truncate text-xs font-medium leading-snug",
                isRunning
                  ? "text-blue-700 dark:text-blue-300"
                  : isBackground
                    ? "text-violet-700 dark:text-violet-300"
                    : isDone
                      ? "text-emerald-700 dark:text-emerald-300"
                      : isFailed
                        ? "text-destructive"
                        : "text-muted-foreground"
              )}
            >
              {agent.description}
            </p>

            {/* Status label */}
            {isRunning ? (
              <span className="shrink-0 text-[10px] font-mono text-blue-500/60 tabular-nums">
                em curso
              </span>
            ) : isBackground ? (
              <span className="shrink-0 text-[10px] font-mono text-violet-500/60 tabular-nums">
                independente
              </span>
            ) : duration ? (
              <span className="shrink-0 text-[10px] font-mono text-muted-foreground/40 tabular-nums">
                {duration}
              </span>
            ) : null}

            {/* Summary toggle */}
            {(isDone || isFailed) && agent.summary && (
              <button
                className="flex size-4 shrink-0 items-center justify-center rounded text-muted-foreground/40 transition hover:text-muted-foreground"
                onClick={() => setSummaryOpen((v) => !v)}
                type="button"
              >
                <ChevronDown
                  className={cn(
                    "size-3 transition-transform duration-150",
                    summaryOpen && "rotate-180"
                  )}
                />
              </button>
            )}
          </div>

          {/* Summary */}
          {summaryOpen && agent.summary && (
            <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground/70 line-clamp-4">
              {agent.summary}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

type SubagentTimelineProps = {
  subagents: SubagentInfo[];
  isRunning?: boolean;
};

export function SubagentTimeline({ subagents, isRunning }: SubagentTimelineProps) {
  const [showAll, setShowAll] = useState(false);

  if (subagents.length === 0) return null;

  const runningAgents = subagents.filter((a) => a.status === "running");
  const backgroundAgents = subagents.filter((a) => a.status === "background");
  const finishedAgents = subagents.filter(
    (a) => a.status !== "running" && a.status !== "background"
  );
  const isTeam = subagents.length > 1;

  // While running: show active + last 2 finished; when done: show all or collapsed
  const visibleAgents =
    isRunning && !showAll
      ? [
          ...runningAgents,
          ...backgroundAgents,
          ...finishedAgents.slice(-Math.min(2, finishedAgents.length))
        ]
      : subagents;

  const hiddenCount = subagents.length - visibleAgents.length;

  return (
    <div className="space-y-2">
      {/* Header */}
      <div className="flex items-center gap-1.5">
        {isTeam ? (
          <Users className="size-3 shrink-0 text-muted-foreground/50" />
        ) : (
          <Bot className="size-3 shrink-0 text-muted-foreground/50" />
        )}
        <span className="text-[11px] font-medium text-muted-foreground/60">
          {isTeam ? "Team agents" : "Subagent"}
        </span>
        {runningAgents.length > 0 && (
          <span className="flex items-center gap-1 rounded-full bg-blue-500/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-blue-500">
            <span className="size-1.5 animate-pulse rounded-full bg-blue-500" />
            {runningAgents.length} em curso
          </span>
        )}
        {backgroundAgents.length > 0 && (
          <span className="flex items-center gap-1 rounded-full bg-violet-500/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-violet-600 dark:text-violet-400">
            <Radio className="size-2.5" />
            {backgroundAgents.length} independente{backgroundAgents.length !== 1 ? "s" : ""}
          </span>
        )}
        {!isRunning && finishedAgents.length > 0 && (
          <span className="rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-emerald-600 dark:text-emerald-400">
            {finishedAgents.length} concluído{finishedAgents.length !== 1 ? "s" : ""}
          </span>
        )}
        <span className="ml-auto text-[10px] text-muted-foreground/30 tabular-nums">
          {subagents.length} total
        </span>
      </div>

      {/* Cards */}
      <div
        className={cn(
          "grid gap-1.5",
          isTeam && runningAgents.length + backgroundAgents.length > 1
            ? "grid-cols-2"
            : "grid-cols-1"
        )}
      >
        {visibleAgents.map((agent) => (
          <AgentCard agent={agent} key={agent.taskId} />
        ))}
      </div>

      {/* Show more / less */}
      {hiddenCount > 0 && (
        <button
          className="text-[11px] text-muted-foreground/50 transition hover:text-muted-foreground"
          onClick={() => setShowAll(true)}
          type="button"
        >
          +{hiddenCount} anteriores
        </button>
      )}
      {showAll && subagents.length > 3 && (
        <button
          className="text-[11px] text-muted-foreground/50 transition hover:text-muted-foreground"
          onClick={() => setShowAll(false)}
          type="button"
        >
          Mostrar menos
        </button>
      )}
    </div>
  );
}
