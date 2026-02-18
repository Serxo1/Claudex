import { Sparkles, Zap, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription
} from "@/components/ui/dialog";
import { useSettingsStore } from "@/stores/settings-store";
import { cn } from "@/lib/utils";

export function NewModelAnnouncement() {
  const newlyDiscoveredModels = useSettingsStore((s) => s.newlyDiscoveredModels);
  const dismissNewModels = useSettingsStore((s) => s.dismissNewModels);
  const onSetModel = useSettingsStore((s) => s.onSetModel);

  const isOpen = newlyDiscoveredModels.length > 0;

  function handleTryModel(value: string) {
    void onSetModel(value);
    dismissNewModels();
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && dismissNewModels()}>
      <DialogContent className="max-w-sm gap-0 overflow-hidden p-0" showCloseButton={false}>
        {/* Decorative gradient header */}
        <div className="relative overflow-hidden px-6 pt-6 pb-5">
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-violet-500/12 via-transparent to-blue-500/8" />
          <div className="pointer-events-none absolute -top-6 -right-6 size-32 rounded-full bg-violet-500/10 blur-2xl" />
          <DialogHeader>
            <div className="mb-2 flex items-center gap-2.5">
              <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500/25 to-blue-500/20 ring-1 ring-violet-500/20">
                <Sparkles className="size-4 text-violet-400" />
              </div>
              <DialogTitle className="text-base">
                {newlyDiscoveredModels.length === 1
                  ? "Novo modelo disponível"
                  : `${newlyDiscoveredModels.length} novos modelos`}
              </DialogTitle>
            </div>
            <DialogDescription className="text-xs leading-relaxed">
              A tua conta desbloqueou novos modelos Claude. Podes usá-los já.
            </DialogDescription>
          </DialogHeader>
        </div>

        {/* Divider */}
        <div className="mx-6 h-px bg-border/50" />

        {/* Model cards */}
        <div className="space-y-2 px-6 py-4">
          {newlyDiscoveredModels.map((model) => (
            <div
              key={model.value}
              className={cn(
                "group relative flex items-center gap-3 rounded-xl border p-3 transition-all duration-150",
                model.supportsMaxEffort
                  ? "border-violet-500/20 bg-violet-500/5 hover:border-violet-500/35 hover:bg-violet-500/8"
                  : "border-blue-500/20 bg-blue-500/5 hover:border-blue-500/35 hover:bg-blue-500/8"
              )}
            >
              {/* Icon */}
              <div
                className={cn(
                  "flex size-8 shrink-0 items-center justify-center rounded-lg",
                  model.supportsMaxEffort
                    ? "bg-violet-500/15 text-violet-400"
                    : "bg-blue-500/15 text-blue-400"
                )}
              >
                <Zap className="size-3.5" />
              </div>

              {/* Info */}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-semibold leading-none">{model.displayName}</p>
                  {model.supportsMaxEffort && (
                    <span className="inline-flex items-center gap-0.5 rounded-full bg-violet-500/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-violet-400">
                      <Sparkles className="size-2" />
                      Max
                    </span>
                  )}
                </div>
                {model.description && (
                  <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground line-clamp-1">
                    {model.description}
                  </p>
                )}
              </div>

              {/* Action */}
              <Button
                className={cn(
                  "h-7 shrink-0 gap-1 text-xs transition-all",
                  model.supportsMaxEffort
                    ? "border-violet-500/30 hover:border-violet-500/50 hover:bg-violet-500/10 hover:text-violet-400"
                    : "border-blue-500/30 hover:border-blue-500/50 hover:bg-blue-500/10 hover:text-blue-400"
                )}
                onClick={() => handleTryModel(model.value)}
                size="sm"
                type="button"
                variant="outline"
              >
                Usar
                <ArrowRight className="size-3 opacity-60" />
              </Button>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="flex justify-end border-t border-border/40 px-6 py-3">
          <Button
            className="h-7 text-xs text-muted-foreground"
            onClick={dismissNewModels}
            type="button"
            variant="ghost"
          >
            Fechar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
