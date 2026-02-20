import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AgentSession, ThreadContextUsage } from "@/lib/chat-types";

export type ContextUsageFooterProps = {
  contextUsage: ThreadContextUsage | null;
  limitsWarning: AgentSession["limitsWarning"];
  accumulatedCostUsd: number;
  sessionCostUsd: number | null;
  model: string;
};

function fmtK(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`;
  return String(n);
}

function fmtCost(usd: number): string {
  if (usd === 0) return "$0";
  if (usd < 0.001) return `$${usd.toFixed(5)}`;
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(3)}`;
}

/** Segmented bar: shows input / cache-read / cache-create proportions */
function SegmentedBar({
  inputTokens,
  cacheRead,
  cacheCreate,
  maxTokens
}: {
  inputTokens: number;
  cacheRead: number;
  cacheCreate: number;
  maxTokens: number;
}) {
  if (maxTokens === 0) return null;
  const pct = (n: number) => Math.min(100, (n / maxTokens) * 100);
  const inputPct = pct(inputTokens);
  const readPct = pct(cacheRead);
  const createPct = pct(cacheCreate);
  const totalPct = Math.min(100, inputPct + readPct + createPct);

  return (
    <div className="relative h-2 w-full overflow-hidden rounded-full bg-muted/40">
      {/* Input (fresh) */}
      <div
        className="absolute left-0 top-0 h-full rounded-l-full bg-blue-500/60"
        style={{ width: `${inputPct}%` }}
      />
      {/* Cache read */}
      <div
        className="absolute top-0 h-full bg-emerald-500/60"
        style={{ left: `${inputPct}%`, width: `${readPct}%` }}
      />
      {/* Cache create */}
      <div
        className="absolute top-0 h-full bg-teal-500/50"
        style={{ left: `${inputPct + readPct}%`, width: `${createPct}%` }}
      />
      {/* Total marker line */}
      {totalPct > 0 && totalPct < 98 && (
        <div
          className="absolute top-0 h-full w-px bg-foreground/20"
          style={{ left: `${totalPct}%` }}
        />
      )}
    </div>
  );
}

export function ContextUsageFooter({
  contextUsage,
  limitsWarning,
  accumulatedCostUsd,
  sessionCostUsd,
  model
}: ContextUsageFooterProps) {
  const maxTokens =
    contextUsage?.maxTokens && contextUsage.maxTokens > 0 ? contextUsage.maxTokens : 200000;
  const usedTokens = contextUsage?.usedTokens ?? 0;
  const percent = contextUsage?.percent ?? 0;
  const inputTokens = contextUsage?.inputTokens ?? 0;
  const outputTokens = contextUsage?.outputTokens ?? 0;
  const cacheRead = contextUsage?.cacheReadInputTokens ?? 0;
  const cacheCreate = contextUsage?.cacheCreationInputTokens ?? 0;
  const hasData = Boolean(contextUsage);

  // Cache efficiency: what % of total input was served from cache
  const totalInputForCache = inputTokens + cacheRead + cacheCreate;
  const cacheEfficiency =
    totalInputForCache > 0 ? Math.round(((cacheRead + cacheCreate) / totalInputForCache) * 100) : 0;

  const barColorClass =
    percent >= 95 ? "bg-red-500" : percent >= 80 ? "bg-amber-500" : "bg-foreground/30";

  return (
    <div className="mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs text-muted-foreground">
      <div className="flex items-center gap-2">
        {/* Context trigger — mini inline bar + text */}
        <HoverCard openDelay={0} closeDelay={0}>
          <HoverCardTrigger asChild>
            <button
              type="button"
              className={cn(
                "flex items-center gap-2 rounded-full border bg-muted/30 px-2.5 py-1 text-xs hover:bg-foreground/[0.08] transition-colors",
                percent >= 95
                  ? "border-red-500/40 text-red-500"
                  : percent >= 80
                    ? "border-amber-500/40 text-amber-500"
                    : "border-border/70 text-foreground/60"
              )}
            >
              {/* Mini bar */}
              <div className="relative h-1.5 w-14 overflow-hidden rounded-full bg-muted/60">
                <div
                  className={cn("h-full rounded-full transition-all duration-700", barColorClass)}
                  style={{ width: `${Math.min(percent, 100)}%` }}
                />
              </div>
              <span className="tabular-nums">{hasData ? `${percent}%` : "—"}</span>
              {hasData && (
                <span className="text-muted-foreground/50">
                  {fmtK(usedTokens)}/{fmtK(maxTokens)}
                </span>
              )}
            </button>
          </HoverCardTrigger>

          <HoverCardContent
            className="w-72 rounded-xl border-border/70 bg-background p-3"
            side="top"
            align="start"
          >
            {/* Header */}
            <div className="mb-3 flex items-center justify-between">
              <span className="text-xs font-semibold text-foreground/80">Contexto</span>
              <span className="truncate pl-2 font-mono text-[10px] text-muted-foreground/60">
                {model || "—"}
              </span>
            </div>

            {/* Segmented bar */}
            <div className="mb-2">
              <SegmentedBar
                inputTokens={inputTokens}
                cacheRead={cacheRead}
                cacheCreate={cacheCreate}
                maxTokens={maxTokens}
              />
            </div>

            {/* Legend */}
            {hasData && (
              <div className="mb-3 flex gap-3 text-[10px] text-muted-foreground/60">
                <span className="flex items-center gap-1">
                  <span className="inline-block size-2 rounded-sm bg-blue-500/60" />
                  input
                </span>
                <span className="flex items-center gap-1">
                  <span className="inline-block size-2 rounded-sm bg-emerald-500/60" />
                  cache hit
                </span>
                <span className="flex items-center gap-1">
                  <span className="inline-block size-2 rounded-sm bg-teal-500/50" />
                  cache write
                </span>
              </div>
            )}

            {/* Token breakdown */}
            <div className="space-y-1">
              <Row
                label="Usado"
                value={hasData ? `${usedTokens.toLocaleString()} tok` : "—"}
                bold
              />
              <Row
                label="↳ input fresco"
                value={hasData ? inputTokens.toLocaleString() : "—"}
                sub
              />
              <Row label="↳ cache hit" value={hasData ? cacheRead.toLocaleString() : "—"} sub />
              <Row label="↳ cache write" value={hasData ? cacheCreate.toLocaleString() : "—"} sub />
              <Row
                label="Output gerado"
                value={hasData ? `${outputTokens.toLocaleString()} tok` : "—"}
                muted
              />
              <Row label="Máximo" value={maxTokens.toLocaleString()} bold />
              {hasData && cacheEfficiency > 0 && (
                <Row
                  label="Eficiência cache"
                  value={`${cacheEfficiency}%`}
                  highlight={cacheEfficiency >= 50}
                />
              )}
            </div>

            {/* Cost section */}
            {(sessionCostUsd != null || accumulatedCostUsd > 0) && (
              <div className="mt-3 space-y-1 border-t border-border/40 pt-2">
                {sessionCostUsd != null && (
                  <Row
                    label="Esta sessão"
                    value={fmtCost(sessionCostUsd)}
                    valueClass="text-emerald-600 dark:text-emerald-400"
                  />
                )}
                {accumulatedCostUsd > 0 && (
                  <Row
                    label="Acumulado"
                    value={fmtCost(accumulatedCostUsd)}
                    valueClass="text-foreground/70"
                  />
                )}
              </div>
            )}
          </HoverCardContent>
        </HoverCard>

        {/* Cost pill — always visible when there's a cost */}
        {accumulatedCostUsd > 0 && (
          <span className="font-mono text-[11px] text-muted-foreground/50">
            {fmtCost(accumulatedCostUsd)}
          </span>
        )}

        {/* Limits warning */}
        {limitsWarning && (
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-full border px-2 py-1",
              limitsWarning.level === "warning"
                ? "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400"
                : "border-border/70 bg-muted/30 text-foreground/70"
            )}
            title={limitsWarning.message}
          >
            <TriangleAlert className="size-3" />
            <span className="text-[10px]">
              {limitsWarning.fiveHourPercent != null ? `5h ${limitsWarning.fiveHourPercent}%` : ""}
              {limitsWarning.weeklyPercent != null
                ? `${limitsWarning.fiveHourPercent != null ? " · " : ""}semana ${limitsWarning.weeklyPercent}%`
                : ""}
            </span>
          </span>
        )}
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  bold,
  sub,
  muted,
  highlight,
  valueClass
}: {
  label: string;
  value: string;
  bold?: boolean;
  sub?: boolean;
  muted?: boolean;
  highlight?: boolean;
  valueClass?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-between",
        sub ? "pl-3 text-[10px] text-muted-foreground/60" : "text-xs",
        muted && "text-muted-foreground/50",
        bold && "text-foreground/80 font-medium"
      )}
    >
      <span>{label}</span>
      <span
        className={cn(
          "font-mono",
          highlight && "text-emerald-600 dark:text-emerald-400",
          valueClass
        )}
      >
        {value}
      </span>
    </div>
  );
}
