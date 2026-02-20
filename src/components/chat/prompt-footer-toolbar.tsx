import { FileText, ListChecks, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  PromptInputButton,
  PromptInputFooter,
  PromptInputSelect,
  PromptInputSelectContent,
  PromptInputSelectItem,
  PromptInputSelectTrigger,
  PromptInputSelectValue,
  PromptInputSubmit,
  PromptInputTools
} from "@/components/ai-elements/prompt-input";

export type ModelOption = { value: string; label: string; releasedAt?: string };

export type PromptFooterToolbarProps = {
  modelOptions: ModelOption[];
  currentModel: string;
  onSetModel: (value: string) => void | Promise<void>;
  effort: string;
  setEffort: (value: string) => void;
  showEffort: boolean;
  showMaxEffort: boolean;
  showTodos: boolean;
  onToggleTodos: () => void;
  onAddContextFile: () => void | Promise<void>;
  onOpenClaudeMd?: () => void;
  canSend: boolean;
  isBusy: boolean;
  isGitBusy: boolean;
  isModelNew: (releasedAt?: string) => boolean;
};

export function PromptFooterToolbar({
  modelOptions,
  currentModel,
  onSetModel,
  effort,
  setEffort,
  showEffort,
  showMaxEffort,
  showTodos,
  onToggleTodos,
  onAddContextFile,
  onOpenClaudeMd,
  canSend,
  isGitBusy,
  isModelNew
}: PromptFooterToolbarProps) {
  return (
    <PromptInputFooter className="border-t border-border/70 pt-2">
      <PromptInputTools>
        <PromptInputButton
          className="text-muted-foreground hover:text-foreground"
          onClick={() => void onAddContextFile()}
          tooltip="Add context file"
        >
          <Plus className="size-4" />
        </PromptInputButton>

        <PromptInputButton
          className={showTodos ? "text-foreground" : "text-muted-foreground hover:text-foreground"}
          onClick={onToggleTodos}
          tooltip="Tasks (TodoWrite)"
        >
          <ListChecks className="size-4" />
        </PromptInputButton>

        {onOpenClaudeMd ? (
          <PromptInputButton
            className="text-muted-foreground hover:text-foreground"
            onClick={onOpenClaudeMd}
            tooltip="Editar CLAUDE.md"
          >
            <FileText className="size-4" />
          </PromptInputButton>
        ) : null}

        <PromptInputSelect
          onValueChange={(value) => void onSetModel(value)}
          value={currentModel || "sonnet"}
        >
          <PromptInputSelectTrigger className="h-8 min-w-56 rounded-md border border-border/60 bg-muted/30 px-2 py-1 text-xs">
            <PromptInputSelectValue />
          </PromptInputSelectTrigger>
          <PromptInputSelectContent>
            {modelOptions.map((model) => (
              <PromptInputSelectItem key={model.value} value={model.value}>
                <span className="flex items-center gap-2">
                  {model.label}
                  {"releasedAt" in model && isModelNew(model.releasedAt) ? (
                    <span className="rounded-full bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-emerald-500">
                      NEW
                    </span>
                  ) : null}
                </span>
              </PromptInputSelectItem>
            ))}
          </PromptInputSelectContent>
        </PromptInputSelect>

        {showEffort ? (
          <div className="inline-flex items-center gap-px rounded-md border border-border/60 bg-muted/30 p-0.5">
            {(showMaxEffort
              ? (["low", "medium", "high", "max"] as const)
              : (["low", "medium", "high"] as const)
            ).map((level) => (
              <button
                key={level}
                type="button"
                onClick={() => setEffort(level)}
                className={cn(
                  "h-6 rounded px-2 text-[11px] font-medium capitalize transition-colors",
                  effort === level
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {level === "medium"
                  ? "Med"
                  : level === "max"
                    ? "Max"
                    : level === "low"
                      ? "Lo"
                      : "Hi"}
              </button>
            ))}
          </div>
        ) : null}
      </PromptInputTools>

      <PromptInputSubmit
        className="rounded-full bg-foreground text-background hover:bg-foreground/90"
        disabled={!canSend || isGitBusy}
        status="ready"
      />
    </PromptInputFooter>
  );
}
