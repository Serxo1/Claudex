import { TriangleAlert } from "lucide-react";
import {
  Context,
  ContextContent,
  ContextContentBody,
  ContextContentHeader,
  ContextTrigger
} from "@/components/ai-elements/context";
import { cn } from "@/lib/utils";
import type { AgentSession, ThreadContextUsage } from "@/lib/chat-types";

export type ContextUsageFooterProps = {
  contextUsage: ThreadContextUsage | null;
  limitsWarning: AgentSession["limitsWarning"];
  accumulatedCostUsd: number;
  model: string;
};

export function ContextUsageFooter({
  contextUsage,
  limitsWarning,
  accumulatedCostUsd,
  model
}: ContextUsageFooterProps) {
  const contextMaxTokens =
    contextUsage && contextUsage.maxTokens > 0 ? contextUsage.maxTokens : 200000;
  const contextUsedTokens = contextUsage?.usedTokens ?? 0;
  const contextPercent = contextUsage?.percent ?? 0;
  const hasContextUsage = Boolean(contextUsage);

  const contextColorClass =
    contextPercent >= 95
      ? "text-red-500 border-red-500/40"
      : contextPercent >= 80
        ? "text-amber-500 border-amber-500/40"
        : "";

  return (
    <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
      <div className="flex items-center gap-2">
        <Context maxTokens={contextMaxTokens} usedTokens={contextUsedTokens}>
          <ContextTrigger
            className={cn(
              "h-8 rounded-full border bg-muted/30 px-2 py-1 text-xs hover:bg-foreground/[0.08]",
              contextColorClass || "border-border/70"
            )}
          />
          <ContextContent className="w-64 rounded-xl border-border/70 bg-background">
            <ContextContentHeader />
            <ContextContentBody className="space-y-1.5 text-xs">
              <div className="flex items-center justify-between text-foreground/80">
                <span>Modelo</span>
                <span className="truncate pl-2 font-mono text-[11px]">{model || "--"}</span>
              </div>
              <div className="flex items-center justify-between text-foreground/70">
                <span>Usado</span>
                <span className="font-mono">
                  {hasContextUsage && contextUsage
                    ? contextUsage.usedTokens.toLocaleString()
                    : "--"}
                </span>
              </div>
              <div className="flex items-center justify-between text-foreground/70">
                <span className="pl-3 text-[11px]">↳ input</span>
                <span className="font-mono text-[11px] text-muted-foreground">
                  {hasContextUsage && contextUsage
                    ? contextUsage.inputTokens.toLocaleString()
                    : "--"}
                </span>
              </div>
              <div className="flex items-center justify-between text-foreground/70">
                <span className="pl-3 text-[11px]">↳ output</span>
                <span className="font-mono text-[11px] text-muted-foreground">
                  {hasContextUsage && contextUsage
                    ? contextUsage.outputTokens.toLocaleString()
                    : "--"}
                </span>
              </div>
              <div className="flex items-center justify-between text-foreground/70">
                <span className="pl-3 text-[11px]">↳ cache</span>
                <span className="font-mono text-[11px] text-muted-foreground">
                  {hasContextUsage && contextUsage
                    ? contextUsage.cacheReadInputTokens.toLocaleString()
                    : "--"}
                </span>
              </div>
              <div className="flex items-center justify-between text-foreground/80">
                <span>Máximo</span>
                <span className="font-mono">
                  {hasContextUsage && contextUsage
                    ? contextUsage.maxTokens.toLocaleString()
                    : contextMaxTokens.toLocaleString()}
                </span>
              </div>
              {accumulatedCostUsd > 0 ? (
                <div className="mt-1 flex items-center justify-between border-t border-border/40 pt-1.5 text-foreground/80">
                  <span>Custo acumulado</span>
                  <span className="font-mono text-emerald-600 dark:text-emerald-400">
                    ${accumulatedCostUsd.toFixed(4)}
                  </span>
                </div>
              ) : null}
            </ContextContentBody>
          </ContextContent>
        </Context>
        {limitsWarning ? (
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-full border px-2 py-1",
              "border-border/70 bg-muted/30 text-foreground"
            )}
            title={limitsWarning.message}
          >
            <TriangleAlert className="size-3.5" />
            <span>
              Limits
              {limitsWarning.fiveHourPercent != null ? ` 5h ${limitsWarning.fiveHourPercent}%` : ""}
              {limitsWarning.weeklyPercent != null ? ` • week ${limitsWarning.weeklyPercent}%` : ""}
            </span>
          </span>
        ) : null}
      </div>
    </div>
  );
}
