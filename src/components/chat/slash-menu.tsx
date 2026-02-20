import { TerminalSquare } from "lucide-react";
import {
  PromptInputCommand,
  PromptInputCommandEmpty,
  PromptInputCommandGroup,
  PromptInputCommandItem,
  PromptInputCommandList
} from "@/components/ai-elements/prompt-input";
import { cn } from "@/lib/utils";
import { SLASH_COMMAND_DESCRIPTIONS } from "@/lib/chat-types";
import { slashCommandNeedsTerminal } from "@/lib/chat-utils";

export type SlashMenuProps = {
  commands: string[];
  selectedIndex: number;
  onSelect: (cmd: string) => void;
  onHover: (index: number) => void;
};

export function SlashMenu({ commands, selectedIndex, onSelect, onHover }: SlashMenuProps) {
  return (
    <div className="mb-2 rounded-xl border border-border/70 bg-background">
      <PromptInputCommand className="bg-transparent">
        <PromptInputCommandList>
          <PromptInputCommandEmpty>No slash commands found.</PromptInputCommandEmpty>
          <PromptInputCommandGroup heading="Slash commands">
            {commands.map((command, index) => (
              <PromptInputCommandItem
                className={cn(
                  "flex items-start justify-between gap-3 rounded-md px-2 py-2",
                  index === selectedIndex ? "bg-foreground/10" : ""
                )}
                key={command}
                onMouseEnter={() => onHover(index)}
                onSelect={() => onSelect(command)}
                value={command}
              >
                <div className="flex min-w-0 items-start gap-2">
                  {slashCommandNeedsTerminal(command) ? (
                    <TerminalSquare className="mt-0.5 size-3.5 shrink-0 text-foreground/80" />
                  ) : null}
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate text-sm">/{command}</span>
                    <span className="truncate text-[11px] text-muted-foreground">
                      {SLASH_COMMAND_DESCRIPTIONS[command] ||
                        (command.includes(":") ? "Plugin slash command." : "Claude CLI command.")}
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
