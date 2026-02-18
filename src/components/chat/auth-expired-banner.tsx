import { useState } from "react";
import { TriangleAlert, X, ArrowRight } from "lucide-react";
import { useSettingsStore } from "@/stores/settings-store";
import { SetupGuide } from "@/components/chat/setup-guide";

export function AuthExpiredBanner() {
  const authExpired = useSettingsStore((s) => s.authExpired);
  const setAuthExpired = useSettingsStore((s) => s.setAuthExpired);
  const [showGuide, setShowGuide] = useState(false);

  if (!authExpired) return null;

  return (
    <>
      <div className="relative flex items-center gap-3 overflow-hidden border-b border-amber-500/20 bg-amber-500/[0.06] px-4 py-2.5 backdrop-blur-sm dark:border-amber-500/15 dark:bg-amber-500/[0.05]">
        {/* Subtle gradient edge */}
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-amber-500/10 via-transparent to-transparent" />

        <div className="flex size-5 shrink-0 items-center justify-center rounded-full bg-amber-500/15">
          <TriangleAlert className="size-3 text-amber-600 dark:text-amber-400" />
        </div>

        <span className="relative flex-1 text-xs font-medium text-amber-700 dark:text-amber-400">
          Sessão Claude Code expirada.
        </span>

        <button
          className="relative flex items-center gap-1 text-xs font-medium text-amber-700 transition hover:text-amber-900 dark:text-amber-400 dark:hover:text-amber-300"
          onClick={() => setShowGuide(true)}
          type="button"
        >
          Renovar login
          <ArrowRight className="size-3" />
        </button>

        <div className="mx-1 h-3.5 w-px bg-amber-500/30" />

        <button
          className="relative flex size-5 items-center justify-center rounded text-amber-600/60 transition hover:bg-amber-500/10 hover:text-amber-700 dark:text-amber-400/60 dark:hover:text-amber-400"
          onClick={() => setAuthExpired(false)}
          type="button"
        >
          <X className="size-3.5" />
        </button>
      </div>

      <SetupGuide initialStep={1} open={showGuide} onOpenChange={setShowGuide} />
    </>
  );
}
