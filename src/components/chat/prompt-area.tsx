import {
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent
} from "react";
import { FileText, Plus, TerminalSquare, TriangleAlert } from "lucide-react";
import type { AttachmentData } from "@/components/ai-elements/attachments";
import {
  Attachment,
  AttachmentHoverCard,
  AttachmentHoverCardContent,
  AttachmentHoverCardTrigger,
  AttachmentInfo,
  AttachmentPreview,
  AttachmentRemove,
  Attachments
} from "@/components/ai-elements/attachments";
import {
  Context,
  ContextContent,
  ContextContentBody,
  ContextContentHeader,
  ContextTrigger
} from "@/components/ai-elements/context";
import {
  PromptInput,
  PromptInputBody,
  PromptInputButton,
  PromptInputCommand,
  PromptInputCommandEmpty,
  PromptInputCommandGroup,
  PromptInputCommandItem,
  PromptInputCommandList,
  PromptInputFooter,
  PromptInputSelect,
  PromptInputSelectContent,
  PromptInputSelectItem,
  PromptInputSelectTrigger,
  PromptInputSelectValue,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools
} from "@/components/ai-elements/prompt-input";
import { Suggestion, Suggestions } from "@/components/ai-elements/suggestion";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { SLASH_COMMAND_DESCRIPTIONS } from "@/lib/chat-types";
import {
  ComposerPromptAttachments,
  formatPermissionMode,
  isOpusModel,
  slashCommandNeedsTerminal,
  toAttachmentData
} from "@/lib/chat-utils";
import { useSettingsStore } from "@/stores/settings-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useGitStore } from "@/stores/git-store";
import { useChatStore } from "@/stores/chat-store";

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
  modelOptions
}: PromptAreaProps) {
  const settings = useSettingsStore((s) => s.settings);
  const isBusy = useSettingsStore((s) => s.isBusy);
  const status = useSettingsStore((s) => s.status);
  const onSetModel = useSettingsStore((s) => s.onSetModel);

  const contextFiles = useWorkspaceStore((s) => s.contextFiles);
  const setContextFiles = useWorkspaceStore((s) => s.setContextFiles);
  const fileMentionIndex = useWorkspaceStore((s) => s.fileMentionIndex);
  const onAddContextFile = useWorkspaceStore((s) => s.onAddContextFile);

  const isGitBusy = useGitStore((s) => s.isGitBusy);

  const messages = useChatStore((s) => {
    const thread = s.threads.find((t) => t.id === s.activeThreadId) ?? s.threads[0] ?? null;
    return thread?.messages ?? EMPTY_ARRAY;
  });
  const isSending = useChatStore((s) => s.isSending);
  const slashCommands = useChatStore((s) => s.slashCommands);
  const permissionMode = useChatStore((s) => s.permissionMode);
  const contextUsage = useChatStore((s) => s.contextUsage);
  const limitsWarning = useChatStore((s) => s.limitsWarning);
  const onAbortStream = useChatStore((s) => s.onAbortStream);
  const onSubmit = useChatStore((s) => s.onSubmit);

  const [mentionSelectedIndex, setMentionSelectedIndex] = useState(0);
  const [slashSelectedIndex, setSlashSelectedIndex] = useState(0);

  const showEffortSelector = isOpusModel(settings?.model || "");
  const contextAttachmentItems = useMemo<AttachmentData[]>(
    () => contextFiles.map((file) => toAttachmentData(file)),
    [contextFiles]
  );

  const canSend = useMemo(() => {
    if (!settings) return false;
    if (isSending || !input.trim()) return false;
    if (settings.authMode === "api-key" && !settings.hasApiKey) return false;
    return true;
  }, [input, isSending, settings]);

  const deferredInput = useDeferredValue(input);
  const slashMatch = useMemo(() => deferredInput.match(/^\/([^\s]*)$/), [deferredInput]);
  const slashQuery = slashMatch ? slashMatch[1].toLowerCase() : null;
  const filteredSlashCommands = useMemo(() => {
    if (slashQuery === null) return [];
    const query = slashQuery.trim();
    return slashCommands.filter((command) => command.toLowerCase().includes(query)).slice(0, 10);
  }, [slashCommands, slashQuery]);

  const mentionMatch = useMemo(() => deferredInput.match(/(?:^|\s)@([^\s]*)$/), [deferredInput]);
  const mentionQuery = mentionMatch ? mentionMatch[1].toLowerCase() : null;
  const filteredMentionFiles = useMemo(() => {
    if (mentionQuery === null) return [];
    const query = mentionQuery.trim();
    if (!query) return fileMentionIndex.slice(0, 12);
    return fileMentionIndex.filter((item) => item.search.includes(query)).slice(0, 12);
  }, [fileMentionIndex, mentionQuery]);

  const isMentionMenuOpen = mentionQuery !== null && filteredMentionFiles.length > 0;
  const isSlashMenuOpen =
    settings?.authMode === "claude-cli" && slashQuery !== null && filteredSlashCommands.length > 0;

  const lastAssistantMessage = useMemo(
    () => [...messages].reverse().find((message) => message.role === "assistant"),
    [messages]
  );
  const userMessageCount = useMemo(
    () => messages.filter((message) => message.role === "user").length,
    [messages]
  );

  const hideSuggestions =
    deferredInput.trim().length >= 80 ||
    deferredInput.trim().split(/\s+/).length > 16 ||
    isSlashMenuOpen ||
    isMentionMenuOpen;

  const suggestions = useMemo(() => {
    if (hideSuggestions) return [];
    if (userMessageCount === 0) {
      return [
        "Map this repository and summarize the architecture.",
        "Create a prioritized TODO list for the next milestone.",
        "Review this project and suggest immediate quick wins."
      ];
    }
    if (lastAssistantMessage?.content.trim().startsWith("Error:")) {
      return [
        "Retry with a smaller scope and fewer files.",
        "Run diagnostics for this error and propose a fix plan.",
        "Try the same task without tool calls."
      ];
    }
    if (lastAssistantMessage?.content.trim()) {
      return [
        "Apply these changes now.",
        "Write tests for the last changes.",
        "Summarize the remaining risks."
      ];
    }
    return [];
  }, [hideSuggestions, lastAssistantMessage?.content, userMessageCount]);

  useEffect(() => {
    setSlashSelectedIndex(0);
  }, [slashQuery]);

  useEffect(() => {
    setMentionSelectedIndex(0);
  }, [mentionQuery]);

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
        setMentionSelectedIndex((current) => (current + 1) % filteredMentionFiles.length);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setMentionSelectedIndex(
          (current) => (current - 1 + filteredMentionFiles.length) % filteredMentionFiles.length
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
      setSlashSelectedIndex((current) => (current + 1) % filteredSlashCommands.length);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setSlashSelectedIndex(
        (current) => (current - 1 + filteredSlashCommands.length) % filteredSlashCommands.length
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
    void onSubmit(message, event, effort);
    setInput("");
  };

  const providerLabel =
    settings?.authMode === "claude-cli"
      ? settings?.hasClaudeCliSession
        ? "Claude CLI Session (persistent)"
        : "Claude CLI Session"
      : "Anthropic API";

  const activeThread = useChatStore(
    (s) => s.threads.find((t) => t.id === s.activeThreadId) ?? s.threads[0] ?? null
  );
  const accumulatedCostUsd = activeThread?.accumulatedCostUsd ?? 0;

  const contextMaxTokens =
    contextUsage && contextUsage.maxTokens > 0 ? contextUsage.maxTokens : 200000;
  const contextUsedTokens = contextUsage?.usedTokens ?? 0;
  const contextPercent = contextUsage?.percent ?? 0;
  const hasContextUsage = Boolean(contextUsage);

  const contextColorClass =
    contextPercent >= 95
      ? "text-red-500 border-red-500/40"
      : contextPercent >= 80
        ? "text-amber-500 border-amber-500/40"
        : "";

  return (
    <div
      className={cn(
        "border-t border-border/70 bg-background px-3 pt-3 pb-3 lg:px-6",
        chatContainerMax,
        "mx-auto w-full"
      )}
    >
      {isMentionMenuOpen ? (
        <div className="mb-2 rounded-xl border border-border/70 bg-background">
          <PromptInputCommand className="bg-transparent">
            <PromptInputCommandList>
              <PromptInputCommandEmpty>No files found.</PromptInputCommandEmpty>
              <PromptInputCommandGroup heading="Context files">
                {filteredMentionFiles.map((item, index) => (
                  <PromptInputCommandItem
                    className={cn(
                      "flex items-start justify-between gap-3 rounded-md px-2 py-2",
                      index === mentionSelectedIndex ? "bg-foreground/10" : ""
                    )}
                    key={item.key}
                    onMouseEnter={() => setMentionSelectedIndex(index)}
                    onSelect={() => void applyMentionFile(item)}
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
      ) : null}

      {isSlashMenuOpen ? (
        <div className="mb-2 rounded-xl border border-border/70 bg-background">
          <PromptInputCommand className="bg-transparent">
            <PromptInputCommandList>
              <PromptInputCommandEmpty>No slash commands found.</PromptInputCommandEmpty>
              <PromptInputCommandGroup heading="Slash commands">
                {filteredSlashCommands.map((command, index) => (
                  <PromptInputCommandItem
                    className={cn(
                      "flex items-start justify-between gap-3 rounded-md px-2 py-2",
                      index === slashSelectedIndex ? "bg-foreground/10" : ""
                    )}
                    key={command}
                    onMouseEnter={() => setSlashSelectedIndex(index)}
                    onSelect={() => applySlashCommand(command)}
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
                            (command.includes(":")
                              ? "Plugin slash command."
                              : "Claude CLI command.")}
                        </span>
                      </div>
                    </div>
                  </PromptInputCommandItem>
                ))}
              </PromptInputCommandGroup>
            </PromptInputCommandList>
          </PromptInputCommand>
        </div>
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

      {contextUsage && contextPercent >= 95 ? (
        <div className="mb-2 flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-600 dark:text-red-400">
          <TriangleAlert className="size-3.5 shrink-0" />
          <span>
            Contexto a {contextPercent}% — usa <strong>/compact</strong> para compactar a conversa.
          </span>
        </div>
      ) : contextUsage && contextPercent >= 80 ? (
        <div className="mb-2 flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-600 dark:text-amber-400">
          <TriangleAlert className="size-3.5 shrink-0" />
          <span>Contexto a {contextPercent}% — considera usar /compact em breve.</span>
        </div>
      ) : null}

      {latestTerminalError ? (
        <div className="mb-2 flex items-center justify-between gap-2 rounded-xl border border-border/70 bg-background px-3 py-2 text-xs text-foreground">
          <span className="truncate">Terminal error detected: {latestTerminalError}</span>
          <Button
            className="h-7 shrink-0 text-xs"
            onClick={onInsertLatestTerminalError}
            type="button"
            variant="outline"
          >
            Add error to prompt
          </Button>
        </div>
      ) : null}

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
            placeholder="Ask for follow-up changes"
            rows={2}
            value={input}
          />
          <ComposerPromptAttachments />
          {contextAttachmentItems.length > 0 ? (
            <Attachments className="mt-2 w-full" variant="inline">
              {contextAttachmentItems.map((item) => (
                <AttachmentHoverCard key={item.id}>
                  <AttachmentHoverCardTrigger asChild>
                    <Attachment
                      data={item}
                      onRemove={() =>
                        setContextFiles((current) =>
                          current.filter((file) => file.absolutePath !== item.id)
                        )
                      }
                      title={
                        contextFiles.find((file) => file.absolutePath === item.id)?.relativePath ||
                        item.id
                      }
                    >
                      <AttachmentPreview />
                      <AttachmentInfo />
                      <AttachmentRemove />
                    </Attachment>
                  </AttachmentHoverCardTrigger>
                  <AttachmentHoverCardContent>
                    <Attachment data={item}>
                      <AttachmentPreview className="size-32" />
                    </Attachment>
                  </AttachmentHoverCardContent>
                </AttachmentHoverCard>
              ))}
            </Attachments>
          ) : null}
        </PromptInputBody>

        <PromptInputFooter className="border-t border-border/70 pt-2">
          <PromptInputTools>
            <PromptInputButton
              className="text-muted-foreground hover:text-foreground"
              onClick={() => void onAddContextFile()}
              tooltip="Add context file"
            >
              <Plus className="size-4" />
            </PromptInputButton>

            <PromptInputSelect
              onValueChange={(value) => void onSetModel(value)}
              value={settings?.model || "sonnet"}
            >
              <PromptInputSelectTrigger className="h-8 min-w-56 rounded-md border border-border/60 bg-muted/30 px-2 py-1 text-xs">
                <PromptInputSelectValue />
              </PromptInputSelectTrigger>
              <PromptInputSelectContent>
                {modelOptions.map((model) => (
                  <PromptInputSelectItem key={model.value} value={model.value}>
                    <span className="flex items-center gap-2">
                      {model.label}
                      {isModelNew(model.releasedAt) ? (
                        <span className="rounded-full bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-emerald-500">
                          NEW
                        </span>
                      ) : null}
                    </span>
                  </PromptInputSelectItem>
                ))}
              </PromptInputSelectContent>
            </PromptInputSelect>

            {showEffortSelector ? (
              <PromptInputSelect onValueChange={setEffort} value={effort}>
                <PromptInputSelectTrigger className="h-8 min-w-32 rounded-md border border-border/60 bg-muted/30 px-2 py-1 text-xs">
                  <PromptInputSelectValue />
                </PromptInputSelectTrigger>
                <PromptInputSelectContent>
                  <PromptInputSelectItem value="low">Low effort</PromptInputSelectItem>
                  <PromptInputSelectItem value="medium">Medium effort</PromptInputSelectItem>
                  <PromptInputSelectItem value="high">High effort</PromptInputSelectItem>
                </PromptInputSelectContent>
              </PromptInputSelect>
            ) : null}
          </PromptInputTools>

          <PromptInputSubmit
            className="rounded-full bg-foreground text-background hover:bg-foreground/90"
            disabled={isSending ? false : !canSend || isBusy || isGitBusy}
            onStop={() => void onAbortStream()}
            status={isSending ? "streaming" : "ready"}
          />
        </PromptInputFooter>
      </PromptInput>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <div className="flex items-center gap-2">
          <Context maxTokens={contextMaxTokens} usedTokens={contextUsedTokens}>
            <ContextTrigger
              className={cn(
                "h-8 rounded-full border bg-muted/30 px-2 py-1 text-xs hover:bg-foreground/[0.08]",
                contextColorClass || "border-border/70"
              )}
            />
            <ContextContent className="w-64 rounded-xl border-border/70 bg-background">
              <ContextContentHeader />
              <ContextContentBody className="space-y-1.5 text-xs">
                <div className="flex items-center justify-between text-foreground/80">
                  <span>Modelo</span>
                  <span className="truncate pl-2 font-mono text-[11px]">
                    {settings?.model || "--"}
                  </span>
                </div>
                <div className="flex items-center justify-between text-foreground/70">
                  <span>Usado</span>
                  <span className="font-mono">
                    {hasContextUsage && contextUsage
                      ? contextUsage.usedTokens.toLocaleString()
                      : "--"}
                  </span>
                </div>
                <div className="flex items-center justify-between text-foreground/70">
                  <span className="pl-3 text-[11px]">↳ input</span>
                  <span className="font-mono text-[11px] text-muted-foreground">
                    {hasContextUsage && contextUsage
                      ? contextUsage.inputTokens.toLocaleString()
                      : "--"}
                  </span>
                </div>
                <div className="flex items-center justify-between text-foreground/70">
                  <span className="pl-3 text-[11px]">↳ output</span>
                  <span className="font-mono text-[11px] text-muted-foreground">
                    {hasContextUsage && contextUsage
                      ? contextUsage.outputTokens.toLocaleString()
                      : "--"}
                  </span>
                </div>
                <div className="flex items-center justify-between text-foreground/70">
                  <span className="pl-3 text-[11px]">↳ cache</span>
                  <span className="font-mono text-[11px] text-muted-foreground">
                    {hasContextUsage && contextUsage
                      ? contextUsage.cacheReadInputTokens.toLocaleString()
                      : "--"}
                  </span>
                </div>
                <div className="flex items-center justify-between text-foreground/80">
                  <span>Máximo</span>
                  <span className="font-mono">
                    {hasContextUsage && contextUsage
                      ? contextUsage.maxTokens.toLocaleString()
                      : contextMaxTokens.toLocaleString()}
                  </span>
                </div>
                {accumulatedCostUsd > 0 ? (
                  <div className="mt-1 flex items-center justify-between border-t border-border/40 pt-1.5 text-foreground/80">
                    <span>Custo acumulado</span>
                    <span className="font-mono text-emerald-600 dark:text-emerald-400">
                      ${accumulatedCostUsd.toFixed(4)}
                    </span>
                  </div>
                ) : null}
              </ContextContentBody>
            </ContextContent>
          </Context>
          <span className="rounded-full border border-border/70 bg-muted/30 px-2 py-1 text-foreground">
            {formatPermissionMode(permissionMode)}
          </span>
          <span className="rounded-full border border-border/70 bg-muted/30 px-2 py-1">
            {providerLabel}
          </span>
          {limitsWarning ? (
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-full border px-2 py-1",
                "border-border/70 bg-muted/30 text-foreground"
              )}
              title={limitsWarning.message}
            >
              <TriangleAlert className="size-3.5" />
              <span>
                Limits
                {limitsWarning.fiveHourPercent != null
                  ? ` 5h ${limitsWarning.fiveHourPercent}%`
                  : ""}
                {limitsWarning.weeklyPercent != null
                  ? ` • week ${limitsWarning.weeklyPercent}%`
                  : ""}
              </span>
            </span>
          ) : null}
        </div>
        <span className="truncate">{status}</span>
      </div>
    </div>
  );
}
