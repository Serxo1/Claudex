import {
  Bug,
  Shield,
  Layers,
  FileText,
  TestTube,
  Zap,
  ArrowUpRight,
  type LucideIcon
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

type ThreadTemplatesProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onApply: (prompt: string) => void;
};

type Template = {
  id: string;
  icon: LucideIcon;
  title: string;
  description: string;
  prompt: string;
  accent: string;
  accentBg: string;
  accentBorder: string;
  accentHover: string;
};

const TEMPLATES: Template[] = [
  {
    id: "code-reviewer",
    icon: Shield,
    title: "Code Reviewer",
    description: "Analisa bugs, segurança e qualidade com melhorias priorizadas.",
    prompt:
      "Review the current codebase for bugs, security issues, and code quality. Provide a prioritized list of improvements with code examples.",
    accent: "text-red-500",
    accentBg: "bg-red-500/10",
    accentBorder: "border-red-500/20 hover:border-red-500/40",
    accentHover: "hover:bg-red-500/[0.04]"
  },
  {
    id: "architect",
    icon: Layers,
    title: "Architect",
    description: "Avalia acoplamento, abstrações e cria um roadmap de refactoring.",
    prompt:
      "Analyze the project architecture. Identify coupling issues, suggest better abstractions, and create a refactoring roadmap.",
    accent: "text-blue-500",
    accentBg: "bg-blue-500/10",
    accentBorder: "border-blue-500/20 hover:border-blue-500/40",
    accentHover: "hover:bg-blue-500/[0.04]"
  },
  {
    id: "debug-assistant",
    icon: Bug,
    title: "Debug Assistant",
    description: "Rastreia causas raiz e fornece correcções passo a passo.",
    prompt:
      "I have an issue in this codebase. Analyze the error, trace the root cause through the code, and provide a step-by-step fix.",
    accent: "text-orange-500",
    accentBg: "bg-orange-500/10",
    accentBorder: "border-orange-500/20 hover:border-orange-500/40",
    accentHover: "hover:bg-orange-500/[0.04]"
  },
  {
    id: "documentation-writer",
    icon: FileText,
    title: "Documentation",
    description: "Gera README, comentários JSDoc e exemplos de uso.",
    prompt:
      "Generate comprehensive documentation: update the README, add JSDoc comments to public APIs, and create usage examples.",
    accent: "text-emerald-500",
    accentBg: "bg-emerald-500/10",
    accentBorder: "border-emerald-500/20 hover:border-emerald-500/40",
    accentHover: "hover:bg-emerald-500/[0.04]"
  },
  {
    id: "test-engineer",
    icon: TestTube,
    title: "Test Engineer",
    description: "Escreve testes unitários, de integração e edge cases.",
    prompt:
      "Write comprehensive tests: unit tests for pure functions, integration tests for key flows, and edge case coverage.",
    accent: "text-purple-500",
    accentBg: "bg-purple-500/10",
    accentBorder: "border-purple-500/20 hover:border-purple-500/40",
    accentHover: "hover:bg-purple-500/[0.04]"
  },
  {
    id: "performance-optimizer",
    icon: Zap,
    title: "Performance",
    description: "Perfila, identifica bottlenecks e implementa optimizações.",
    prompt:
      "Profile the application, identify the top 3 performance bottlenecks, and implement concrete optimizations.",
    accent: "text-yellow-500",
    accentBg: "bg-yellow-500/10",
    accentBorder: "border-yellow-500/20 hover:border-yellow-500/40",
    accentHover: "hover:bg-yellow-500/[0.04]"
  }
];

export function ThreadTemplates({ open, onOpenChange, onApply }: ThreadTemplatesProps) {
  const handleApply = (prompt: string) => {
    onApply(prompt);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg gap-0 p-0">
        {/* Header */}
        <div className="px-6 pt-6 pb-4">
          <DialogHeader>
            <DialogTitle className="text-base">Templates</DialogTitle>
            <DialogDescription className="text-xs">
              Escolhe um ponto de partida para a tua próxima sessão.
            </DialogDescription>
          </DialogHeader>
        </div>

        <div className="mx-6 h-px bg-border/40" />

        {/* Grid */}
        <div className="grid grid-cols-2 gap-2.5 p-6">
          {TEMPLATES.map((t) => {
            const Icon = t.icon;
            return (
              <button
                key={t.id}
                className={cn(
                  "group relative flex flex-col items-start gap-2.5 rounded-xl border p-3.5 text-left transition-all duration-150",
                  t.accentBorder,
                  t.accentHover
                )}
                onClick={() => handleApply(t.prompt)}
                type="button"
              >
                {/* Icon badge */}
                <div
                  className={cn("flex size-7 items-center justify-center rounded-lg", t.accentBg)}
                >
                  <Icon className={cn("size-3.5", t.accent)} />
                </div>

                {/* Text */}
                <div className="min-w-0">
                  <p className="text-xs font-semibold leading-tight text-foreground">{t.title}</p>
                  <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
                    {t.description}
                  </p>
                </div>

                {/* Arrow indicator */}
                <ArrowUpRight
                  className={cn(
                    "absolute top-3 right-3 size-3 opacity-0 transition-all duration-150 group-hover:opacity-100",
                    t.accent
                  )}
                />
              </button>
            );
          })}
        </div>

        {/* Footer */}
        <div className="flex justify-end border-t border-border/40 px-6 py-3">
          <button
            className="text-xs text-muted-foreground/60 transition hover:text-muted-foreground"
            onClick={() => onOpenChange(false)}
            type="button"
          >
            Cancelar
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
