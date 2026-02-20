import { ListChecks, Plus } from "lucide-react";
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
  showMaxEffort: boolean;
  showTodos: boolean;
  onToggleTodos: () => void;
  onAddContextFile: () => void | Promise<void>;
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
  showMaxEffort,
  showTodos,
  onToggleTodos,
  onAddContextFile,
  canSend,
  isBusy,
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

        <PromptInputSelect onValueChange={setEffort} value={effort}>
          <PromptInputSelectTrigger className="h-8 min-w-32 rounded-md border border-border/60 bg-muted/30 px-2 py-1 text-xs">
            <PromptInputSelectValue />
          </PromptInputSelectTrigger>
          <PromptInputSelectContent>
            <PromptInputSelectItem value="low">Low effort</PromptInputSelectItem>
            <PromptInputSelectItem value="medium">Medium effort</PromptInputSelectItem>
            <PromptInputSelectItem value="high">High effort</PromptInputSelectItem>
            {showMaxEffort ? (
              <PromptInputSelectItem value="max">Max effort</PromptInputSelectItem>
            ) : null}
          </PromptInputSelectContent>
        </PromptInputSelect>
      </PromptInputTools>

      <PromptInputSubmit
        className="rounded-full bg-foreground text-background hover:bg-foreground/90"
        disabled={!canSend || isBusy || isGitBusy}
        status="ready"
      />
    </PromptInputFooter>
  );
}
