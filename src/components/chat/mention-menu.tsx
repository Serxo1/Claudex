import { FileText } from "lucide-react";
import {
  PromptInputCommand,
  PromptInputCommandEmpty,
  PromptInputCommandGroup,
  PromptInputCommandItem,
  PromptInputCommandList
} from "@/components/ai-elements/prompt-input";
import { cn } from "@/lib/utils";
import type { FileMentionItem } from "@/hooks/use-prompt-autocomplete";

export type MentionMenuProps = {
  files: FileMentionItem[];
  selectedIndex: number;
  onSelect: (item: FileMentionItem) => void;
  onHover: (index: number) => void;
};

export function MentionMenu({ files, selectedIndex, onSelect, onHover }: MentionMenuProps) {
  return (
    <div className="mb-2 rounded-xl border border-border/70 bg-background">
      <PromptInputCommand className="bg-transparent">
        <PromptInputCommandList>
          <PromptInputCommandEmpty>No files found.</PromptInputCommandEmpty>
          <PromptInputCommandGroup heading="Context files">
            {files.map((item, index) => (
              <PromptInputCommandItem
                className={cn(
                  "flex items-start justify-between gap-3 rounded-md px-2 py-2",
                  index === selectedIndex ? "bg-foreground/10" : ""
                )}
                key={item.key}
                onMouseEnter={() => onHover(index)}
                onSelect={() => onSelect(item)}
                value={item.label}
              >
                <div className="flex min-w-0 items-start gap-2">
                  <FileText className="mt-0.5 size-3.5 shrink-0 text-foreground/80" />
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate text-sm">{item.label}</span>
                    <span className="truncate text-[11px] text-muted-foreground">
                      @ adds file to context
                    </span>
                  </div>
                </div>
              </PromptInputCommandItem>
            ))}
          </PromptInputCommandGroup>
        </PromptInputCommandList>
      </PromptInputCommand>
    </div>
  );
}
