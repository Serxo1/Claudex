import { useState, useEffect } from "react";
import { Check, Terminal, LogIn, RefreshCcw, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { useSettingsStore } from "@/stores/settings-store";

type SetupGuideProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialStep?: number;
};

const STEPS = [
  {
    icon: Terminal,
    title: "Instalar Claude Code",
    description: "Instala o CLI oficial da Anthropic globalmente."
  },
  {
    icon: LogIn,
    title: "Fazer login",
    description: "Autentica a sessão no terminal com o teu token Claude."
  },
  {
    icon: RefreshCcw,
    title: "Verificar conexão",
    description: "Confirma que a aplicação consegue comunicar com o CLI."
  }
];

export function SetupGuide({ open, onOpenChange, initialStep = 0 }: SetupGuideProps) {
  const [step, setStep] = useState(initialStep);
  const claudeCodeReady = useSettingsStore((s) => s.claudeCodeReady);
  const isBusy = useSettingsStore((s) => s.isBusy);
  const status = useSettingsStore((s) => s.status);
  const onTestCli = useSettingsStore((s) => s.onTestCli);

  useEffect(() => {
    if (open) setStep(initialStep);
  }, [open, initialStep]);

  useEffect(() => {
    if (open && claudeCodeReady === true) {
      const timer = window.setTimeout(() => onOpenChange(false), 1200);
      return () => window.clearTimeout(timer);
    }
  }, [open, claudeCodeReady, onOpenChange]);

  const currentStep = STEPS[step];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md gap-0 overflow-hidden p-0">
        {/* Header */}
        <div className="relative overflow-hidden px-6 pt-6 pb-5">
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-primary/8 via-transparent to-transparent" />
          <DialogHeader>
            <DialogTitle className="text-base">Configurar Claude Code</DialogTitle>
            <DialogDescription className="text-xs">
              Segue os passos para ligar a aplicação ao Claude Code CLI.
            </DialogDescription>
          </DialogHeader>
        </div>

        {/* Step progress bar */}
        <div className="flex items-center gap-0 px-6 pb-5">
          {STEPS.map((s, i) => {
            const Icon = s.icon;
            const isDone = i < step;
            const isActive = i === step;
            return (
              <div key={i} className="flex flex-1 items-center">
                <button
                  className={cn(
                    "flex size-7 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold transition-all duration-200",
                    isActive
                      ? "bg-primary text-primary-foreground shadow-lg shadow-primary/25 ring-4 ring-primary/15"
                      : isDone
                        ? "bg-emerald-500/20 text-emerald-500 ring-1 ring-emerald-500/30"
                        : "bg-muted/80 text-muted-foreground ring-1 ring-border/60"
                  )}
                  onClick={() => setStep(i)}
                  type="button"
                >
                  {isDone ? <Check className="size-3" /> : <Icon className="size-3" />}
                </button>
                {i < STEPS.length - 1 && (
                  <div className="relative mx-1 h-px flex-1">
                    <div className="absolute inset-0 bg-border/60" />
                    <div
                      className={cn(
                        "absolute inset-0 bg-emerald-500 transition-all duration-500",
                        isDone ? "w-full" : "w-0"
                      )}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Divider */}
        <div className="mx-6 h-px bg-border/40" />

        {/* Step content */}
        <div className="px-6 py-5">
          <div className="mb-3">
            <p className="text-sm font-medium text-foreground">{currentStep.title}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{currentStep.description}</p>
          </div>

          <div className="rounded-xl border border-border/40 bg-black/[0.03] p-4 dark:bg-white/[0.03]">
            {step === 0 && (
              <div className="space-y-3">
                <p className="text-xs text-muted-foreground">Instala via npm:</p>
                <div className="flex items-center gap-2 rounded-lg border border-border/50 bg-background/60 px-3 py-2.5 font-mono text-xs text-foreground dark:bg-black/40">
                  <span className="select-none text-muted-foreground/60">$</span>
                  <span className="select-all text-emerald-600 dark:text-emerald-400">
                    npm install -g @anthropic-ai/claude-code
                  </span>
                </div>
                <p className="text-[11px] text-muted-foreground/70">Requer Node.js 18+</p>
              </div>
            )}

            {step === 1 && (
              <div className="space-y-3">
                <p className="text-xs text-muted-foreground">Abre um terminal e executa:</p>
                <div className="flex items-center gap-2 rounded-lg border border-border/50 bg-background/60 px-3 py-2.5 font-mono text-xs dark:bg-black/40">
                  <span className="select-none text-muted-foreground/60">$</span>
                  <span className="select-all text-emerald-600 dark:text-emerald-400">claude</span>
                </div>
                <p className="text-xs text-muted-foreground">No prompt do CLI, digita:</p>
                <div className="flex items-center gap-2 rounded-lg border border-border/50 bg-background/60 px-3 py-2.5 font-mono text-xs dark:bg-black/40">
                  <span className="select-none text-primary/60">›</span>
                  <span className="select-all text-primary">/login</span>
                </div>
                <p className="text-[11px] text-muted-foreground/70">
                  Autentica com a tua conta Anthropic no browser que abre.
                </p>
              </div>
            )}

            {step === 2 && (
              <div className="space-y-3">
                {claudeCodeReady === true ? (
                  <div className="flex items-center gap-2.5 rounded-lg border border-emerald-500/25 bg-emerald-500/8 px-3 py-3">
                    <CheckCircle2 className="size-4 shrink-0 text-emerald-500" />
                    <p className="text-sm font-medium text-emerald-600 dark:text-emerald-400">
                      Claude Code está pronto!
                    </p>
                  </div>
                ) : (
                  <>
                    <p className="text-xs text-muted-foreground">
                      Clica para verificar se a conexão está funcional.
                    </p>
                    {claudeCodeReady === false && status && (
                      <p className="rounded-lg border border-destructive/20 bg-destructive/8 px-3 py-2 text-[11px] text-destructive">
                        {status}
                      </p>
                    )}
                  </>
                )}
                <Button
                  className="w-full"
                  disabled={isBusy || claudeCodeReady === true}
                  onClick={() => void onTestCli()}
                  type="button"
                >
                  {isBusy
                    ? "A verificar..."
                    : claudeCodeReady
                      ? "Verificado ✓"
                      : "Verificar conexão"}
                </Button>
              </div>
            )}
          </div>
        </div>

        {/* Footer navigation */}
        <div className="flex items-center justify-between border-t border-border/40 px-6 py-3">
          <Button
            className="h-7 text-xs"
            disabled={step === 0}
            onClick={() => setStep((s) => s - 1)}
            type="button"
            variant="ghost"
          >
            Anterior
          </Button>
          <span className="text-[11px] text-muted-foreground/50">
            {step + 1} / {STEPS.length}
          </span>
          {step < STEPS.length - 1 ? (
            <Button className="h-7 text-xs" onClick={() => setStep((s) => s + 1)} type="button">
              Próximo
            </Button>
          ) : (
            <Button
              className="h-7 text-xs"
              onClick={() => onOpenChange(false)}
              type="button"
              variant="ghost"
            >
              Fechar
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
