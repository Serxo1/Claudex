import { TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ThreadContextUsage } from "@/lib/chat-types";

export type ContextBannersProps = {
  contextPercent: number;
  contextUsage: ThreadContextUsage | null;
  latestTerminalError: string;
  onInsertTerminalError: () => void;
};

export function ContextBanners({
  contextPercent,
  contextUsage,
  latestTerminalError,
  onInsertTerminalError
}: ContextBannersProps) {
  return (
    <>
      {contextUsage && contextPercent >= 95 ? (
        <div className="mb-2 flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-600 dark:text-red-400">
          <TriangleAlert className="size-3.5 shrink-0" />
          <span>
            Contexto a {contextPercent}% — usa <strong>/compact</strong> para compactar a conversa.
          </span>
        </div>
      ) : contextUsage && contextPercent >= 80 ? (
        <div className="mb-2 flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-600 dark:text-amber-400">
          <TriangleAlert className="size-3.5 shrink-0" />
          <span>Contexto a {contextPercent}% — considera usar /compact em breve.</span>
        </div>
      ) : null}

      {latestTerminalError ? (
        <div className="mb-2 flex items-center justify-between gap-2 rounded-xl border border-border/70 bg-background px-3 py-2 text-xs text-foreground">
          <span className="truncate">Terminal error detected: {latestTerminalError}</span>
          <Button
            className="h-7 shrink-0 text-xs"
            onClick={onInsertTerminalError}
            type="button"
            variant="outline"
          >
            Add error to prompt
          </Button>
        </div>
      ) : null}
    </>
  );
}
