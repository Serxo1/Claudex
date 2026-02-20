import {
  useRef,
  useMemo,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent
} from "react";
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
import {
  supportsEffort,
  supportsMaxEffort,
  slashCommandNeedsTerminal,
  toAttachmentData
} from "@/lib/chat-utils";
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
  workspaceDir?: string;
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
  targetSessionId,
  workspaceDir
}: PromptAreaProps) {
  const settings = useSettingsStore((s) => s.settings);
  const onSetModel = useSettingsStore((s) => s.onSetModel);
  const dynamicModels = useSettingsStore((s) => s.dynamicModels);

  const contextFiles = useWorkspaceStore((s) => s.contextFiles);
  const setContextFiles = useWorkspaceStore((s) => s.setContextFiles);
  const fileMentionIndex = useWorkspaceStore((s) => s.fileMentionIndex);
  const onAddContextFile = useWorkspaceStore((s) => s.onAddContextFile);

  const isGitBusy = useGitStore((s) => s.isGitBusy);

  const slashCommands = useChatStore((s) => s.slashCommands);
  const onSubmit = useChatStore((s) => s.onSubmit);
  const enqueueMessage = useChatStore((s) => s.enqueueMessage);
  const cancelQueuedMessage = useChatStore((s) => s.cancelQueuedMessage);

  const isBusy =
    activeSession?.status === "running" || activeSession?.status === "awaiting_approval";
  const queuedMessage = activeSession?.queuedMessage ?? null;
  const activeSessionId = activeSession?.id;

  const contextUsage = activeSession?.contextUsage ?? null;
  const limitsWarning = activeSession?.limitsWarning ?? null;
  const accumulatedCostUsd = activeSession?.accumulatedCostUsd ?? 0;
  const sessionCostUsd = activeSession?.sessionCostUsd ?? null;
  const lastMessages = activeSession?.messages ?? EMPTY_ARRAY;

  const [showTodos, setShowTodos] = useState(false);
  const [historyIdx, setHistoryIdx] = useState(-1);
  // Keep ref so it's accessible inside event handlers without stale closure issues
  const historyIdxRef = useRef(-1);
  historyIdxRef.current = historyIdx;

  // Ordered list of user messages (oldest → newest) for history navigation
  const userMessages = useMemo(
    () => lastMessages.filter((m) => m.role === "user" && m.content.trim()),
    [lastMessages]
  );

  function handleOpenClaudeMd() {
    if (!workspaceDir) return;
    void (async () => {
      const ws = useWorkspaceStore.getState();
      await ws.refreshWorkspaceFileTree();
      const fresh = useWorkspaceStore.getState();
      // Search by relativePath to avoid rootPath format mismatch on Windows
      const match = fresh.fileMentionIndex.find((item) => item.relativePath === "CLAUDE.md");
      if (match) {
        void fresh.onOpenEditorFile(match.key);
      }
    })();
  }

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
  const showEffort = supportsEffort(currentModel);
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
    // Prompt history navigation (↑/↓) — only when menus are closed
    if (!isMentionMenuOpen && !isSlashMenuOpen) {
      const idx = historyIdxRef.current;
      if (event.key === "ArrowUp" && (input.trim() === "" || idx > -1)) {
        const nextIdx = Math.min(idx + 1, userMessages.length - 1);
        if (nextIdx >= 0 && nextIdx < userMessages.length) {
          event.preventDefault();
          const msg = userMessages[userMessages.length - 1 - nextIdx];
          setInput(msg.content);
          historyIdxRef.current = nextIdx;
          setHistoryIdx(nextIdx);
          return;
        }
      }
      if (event.key === "ArrowDown" && idx > -1) {
        event.preventDefault();
        if (idx <= 0) {
          setInput("");
          historyIdxRef.current = -1;
          setHistoryIdx(-1);
        } else {
          const nextIdx = idx - 1;
          const msg = userMessages[userMessages.length - 1 - nextIdx];
          setInput(msg.content);
          historyIdxRef.current = nextIdx;
          setHistoryIdx(nextIdx);
        }
        return;
      }
    }

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
    if (isBusy && activeSessionId && message.text.trim()) {
      // Queue the message instead of creating a new session
      enqueueMessage(activeSessionId, message.text, contextFiles, effort);
      useWorkspaceStore.getState().setContextFiles([]);
      setInput("");
      return;
    }
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

      {queuedMessage && activeSessionId ? (
        <div className="mb-2 flex items-center gap-2 rounded-xl border border-blue-500/25 bg-blue-500/8 px-3 py-2 text-xs">
          <svg
            className="size-3.5 shrink-0 text-blue-500/60"
            viewBox="0 0 16 16"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            aria-hidden
          >
            <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.5" />
            <path
              d="M8 5v3.5l2 1.5"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
          <span className="flex-1 truncate text-blue-600 dark:text-blue-400">
            Em fila:{" "}
            <span className="text-foreground/70">
              {queuedMessage.text.length > 60
                ? `${queuedMessage.text.slice(0, 60)}…`
                : queuedMessage.text}
            </span>
          </span>
          <button
            type="button"
            onClick={() => cancelQueuedMessage(activeSessionId)}
            className="shrink-0 rounded p-0.5 text-muted-foreground/50 hover:bg-foreground/10 hover:text-foreground/70"
            title="Cancelar mensagem em fila"
          >
            <svg
              className="size-3"
              viewBox="0 0 12 12"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              aria-hidden
            >
              <path
                d="M2 2l8 8M10 2l-8 8"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>
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
            onChange={(event) => {
              setInput(event.target.value);
              // Reset history navigation when user types manually
              if (historyIdxRef.current !== -1) {
                historyIdxRef.current = -1;
                setHistoryIdx(-1);
              }
            }}
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
          showEffort={showEffort}
          showMaxEffort={showMaxEffort}
          showTodos={showTodos}
          onToggleTodos={() => setShowTodos((v) => !v)}
          onAddContextFile={onAddContextFile}
          onOpenClaudeMd={workspaceDir ? handleOpenClaudeMd : undefined}
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
        sessionCostUsd={sessionCostUsd}
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
