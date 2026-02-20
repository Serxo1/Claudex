import { useMemo, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { ListChecks } from "lucide-react";
import {
  PromptInput,
  PromptInputBody,
  PromptInputTextarea
} from "@/components/ai-elements/prompt-input";
import { Suggestion, Suggestions } from "@/components/ai-elements/suggestion";
import { DraggableWindow } from "@/components/teams/DraggableWindow";
import { TaskList } from "@/components/teams/TaskList";
import { cn } from "@/lib/utils";
import type { AgentSession } from "@/lib/chat-types";
import { ComposerPromptAttachments } from "@/components/chat/composer-attachments";
import { MentionMenu } from "@/components/chat/mention-menu";
import { SlashMenu } from "@/components/chat/slash-menu";
import { ContextBanners } from "@/components/chat/context-banners";
import { ContextUsageFooter } from "@/components/chat/context-usage-footer";
import { PromptContextAttachments } from "@/components/chat/prompt-context-attachments";
import { PromptFooterToolbar } from "@/components/chat/prompt-footer-toolbar";
import { supportsMaxEffort, slashCommandNeedsTerminal, toAttachmentData } from "@/lib/chat-utils";
import { useSettingsStore } from "@/stores/settings-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useGitStore } from "@/stores/git-store";
import { useChatStore } from "@/stores/chat-store";
import { usePromptAutocomplete } from "@/hooks/use-prompt-autocomplete";
import { usePromptSuggestions } from "@/hooks/use-prompt-suggestions";

const EMPTY_ARRAY: never[] = [];

export type PromptAreaProps = {
  input: string;
  setInput: React.Dispatch<React.SetStateAction<string>>;
  effort: string;
  setEffort: (value: string) => void;
  latestTerminalError: string;
  onInsertLatestTerminalError: () => void;
  setTerminalOpen: (value: boolean | ((current: boolean) => boolean)) => void;
  chatContainerMax: string;
  modelOptions: Array<{ value: string; label: string; releasedAt?: string }>;
  activeSession?: AgentSession | null;
  // If set, submit continues this session (--resume); if null/undefined, creates new session
  targetSessionId?: string | null;
};

function isModelNew(releasedAt?: string): boolean {
  if (!releasedAt) return false;
  const TWO_WEEKS_MS = 14 * 24 * 60 * 60 * 1000;
  return Date.now() - new Date(releasedAt).getTime() < TWO_WEEKS_MS;
}

export function PromptArea({
  input,
  setInput,
  effort,
  setEffort,
  latestTerminalError,
  onInsertLatestTerminalError,
  setTerminalOpen,
  chatContainerMax,
  modelOptions,
  activeSession,
  targetSessionId
}: PromptAreaProps) {
  const settings = useSettingsStore((s) => s.settings);
  const isBusy = useSettingsStore((s) => s.isBusy);
  const onSetModel = useSettingsStore((s) => s.onSetModel);
  const dynamicModels = useSettingsStore((s) => s.dynamicModels);

  const contextFiles = useWorkspaceStore((s) => s.contextFiles);
  const setContextFiles = useWorkspaceStore((s) => s.setContextFiles);
  const fileMentionIndex = useWorkspaceStore((s) => s.fileMentionIndex);
  const onAddContextFile = useWorkspaceStore((s) => s.onAddContextFile);

  const isGitBusy = useGitStore((s) => s.isGitBusy);

  const slashCommands = useChatStore((s) => s.slashCommands);
  const onSubmit = useChatStore((s) => s.onSubmit);

  const contextUsage = activeSession?.contextUsage ?? null;
  const limitsWarning = activeSession?.limitsWarning ?? null;
  const accumulatedCostUsd = activeSession?.accumulatedCostUsd ?? 0;
  const lastMessages = activeSession?.messages ?? EMPTY_ARRAY;

  const [showTodos, setShowTodos] = useState(false);

  const {
    filteredSlashCommands,
    filteredMentionFiles,
    isMentionMenuOpen,
    isSlashMenuOpen,
    mentionSelectedIndex,
    slashSelectedIndex,
    setMentionSelectedIndex,
    setSlashSelectedIndex
  } = usePromptAutocomplete(input, slashCommands, fileMentionIndex, settings);

  const suggestions = usePromptSuggestions(input, lastMessages, isSlashMenuOpen, isMentionMenuOpen);

  const currentModel = settings?.model || "";
  const showMaxEffort = supportsMaxEffort(currentModel, dynamicModels);
  const activeModelOptions =
    dynamicModels.length > 0
      ? dynamicModels.map((m) => ({ value: m.value, label: m.displayName }))
      : modelOptions;

  const contextAttachmentItems = useMemo(
    () => contextFiles.map((file) => toAttachmentData(file)),
    [contextFiles]
  );

  const canSend = useMemo(() => {
    if (!settings) return false;
    if (!input.trim()) return false;
    if (settings.authMode === "api-key" && !settings.hasApiKey) return false;
    return true;
  }, [input, settings]);

  function applySlashCommand(command: string) {
    const normalized = command.startsWith("/") ? command.slice(1) : command;
    setInput(`/${normalized} `);
    if (slashCommandNeedsTerminal(normalized)) {
      setTerminalOpen(true);
    }
  }

  async function applyMentionFile(value: {
    rootPath: string;
    relativePath: string;
    label: string;
  }) {
    try {
      const result = await window.desktop.workspace.resolveContextFile(
        `${value.rootPath}/${value.relativePath}`
      );
      if (!result.canceled && result.absolutePath && result.relativePath) {
        const { absolutePath, relativePath, mediaType, previewDataUrl, isImage } = result;
        setContextFiles((current) => {
          if (current.some((file) => file.absolutePath === absolutePath)) return current;
          return [...current, { absolutePath, relativePath, mediaType, previewDataUrl, isImage }];
        });
      }
      setInput((current) => current.replace(/(?:^|\s)@[^\s]*$/, " "));
    } catch {
      // Ignore errors
    }
  }

  function onPromptInputKeyDown(event: ReactKeyboardEvent<HTMLTextAreaElement>) {
    if (isMentionMenuOpen) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setMentionSelectedIndex((i) => (i + 1) % filteredMentionFiles.length);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setMentionSelectedIndex(
          (i) => (i - 1 + filteredMentionFiles.length) % filteredMentionFiles.length
        );
        return;
      }
      if (event.key === "Tab" || event.key === "Enter") {
        const selected = filteredMentionFiles[mentionSelectedIndex] ?? filteredMentionFiles[0];
        if (selected) {
          event.preventDefault();
          void applyMentionFile(selected);
          return;
        }
      }
    }
    if (!isSlashMenuOpen) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setSlashSelectedIndex((i) => (i + 1) % filteredSlashCommands.length);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setSlashSelectedIndex(
        (i) => (i - 1 + filteredSlashCommands.length) % filteredSlashCommands.length
      );
      return;
    }
    if (event.key === "Tab" || event.key === "Enter") {
      const selected = filteredSlashCommands[slashSelectedIndex] ?? filteredSlashCommands[0];
      if (selected) {
        event.preventDefault();
        applySlashCommand(selected);
      }
    }
  }

  const handleSubmit = (
    message: {
      text: string;
      files: Array<{ filename?: string; mediaType?: string; url?: string }>;
    },
    event: FormEvent<HTMLFormElement>
  ) => {
    void onSubmit(message, event, effort, targetSessionId);
    setInput("");
  };

  return (
    <div
      className={cn(
        "border-t border-border/70 bg-background px-3 pt-3 pb-3 lg:px-6",
        chatContainerMax,
        "mx-auto w-full"
      )}
    >
      {isMentionMenuOpen ? (
        <MentionMenu
          files={filteredMentionFiles}
          selectedIndex={mentionSelectedIndex}
          onSelect={(item) => void applyMentionFile(item)}
          onHover={setMentionSelectedIndex}
        />
      ) : null}

      {isSlashMenuOpen ? (
        <SlashMenu
          commands={filteredSlashCommands}
          selectedIndex={slashSelectedIndex}
          onSelect={applySlashCommand}
          onHover={setSlashSelectedIndex}
        />
      ) : null}

      {suggestions.length > 0 ? (
        <Suggestions className="mb-2">
          {suggestions.map((suggestion) => (
            <Suggestion
              className="border-border/70 bg-muted/30 text-foreground/90 hover:bg-foreground/[0.08]"
              key={suggestion}
              onClick={(value) => setInput(value)}
              suggestion={suggestion}
              variant="outline"
            />
          ))}
        </Suggestions>
      ) : null}

      <ContextBanners
        contextPercent={contextUsage?.percent ?? 0}
        contextUsage={contextUsage}
        latestTerminalError={latestTerminalError}
        onInsertTerminalError={onInsertLatestTerminalError}
      />

      <PromptInput
        className={cn(
          "[&>[data-slot=input-group]]:rounded-3xl",
          "[&>[data-slot=input-group]]:border-border/70",
          "[&>[data-slot=input-group]]:bg-background",
          "[&>[data-slot=input-group]]:px-2 [&>[data-slot=input-group]]:py-1",
          "[&>[data-slot=input-group]]:shadow-xl",
          "[&>[data-slot=input-group]]:has-[[data-slot=input-group-control]:focus-visible]:ring-0",
          "[&>[data-slot=input-group]]:has-[[data-slot=input-group-control]:focus-visible]:border-border/70"
        )}
        onSubmit={handleSubmit}
      >
        <PromptInputBody>
          <PromptInputTextarea
            className="min-h-20 text-[15px] placeholder:text-muted-foreground/50"
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={onPromptInputKeyDown}
            placeholder="Nova sessão — descreve o que queres fazer"
            rows={2}
            value={input}
          />
          <ComposerPromptAttachments />
          <PromptContextAttachments
            items={contextAttachmentItems}
            contextFiles={contextFiles}
            onRemove={(absolutePath) =>
              setContextFiles((current) =>
                current.filter((file) => file.absolutePath !== absolutePath)
              )
            }
          />
        </PromptInputBody>

        <PromptFooterToolbar
          modelOptions={activeModelOptions}
          currentModel={currentModel}
          onSetModel={onSetModel}
          effort={effort}
          setEffort={setEffort}
          showMaxEffort={showMaxEffort}
          showTodos={showTodos}
          onToggleTodos={() => setShowTodos((v) => !v)}
          onAddContextFile={onAddContextFile}
          canSend={canSend}
          isBusy={isBusy}
          isGitBusy={isGitBusy}
          isModelNew={isModelNew}
        />
      </PromptInput>

      <ContextUsageFooter
        contextUsage={contextUsage}
        limitsWarning={limitsWarning}
        accumulatedCostUsd={accumulatedCostUsd}
        model={currentModel}
      />

      {showTodos && (
        <DraggableWindow
          title="Tasks"
          icon={<ListChecks className="size-3.5" />}
          onClose={() => setShowTodos(false)}
          defaultPosition={{ x: window.innerWidth * 0.5 - 170, y: window.innerHeight * 0.25 }}
          width={340}
          height={420}
        >
          <TaskList />
        </DraggableWindow>
      )}
    </div>
  );
}
