import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, CircleAlert, Clock3, Copy, CopyCheck, Wrench } from "lucide-react";
import { Virtuoso } from "react-virtuoso";
import { SubagentTimeline } from "@/components/chat/subagent-timeline";
import { TeamPanel } from "@/components/chat/team-panel";
import {
  Attachment,
  AttachmentHoverCard,
  AttachmentHoverCardContent,
  AttachmentHoverCardTrigger,
  AttachmentInfo,
  AttachmentPreview,
  Attachments
} from "@/components/ai-elements/attachments";
import {
  Commit,
  CommitAuthor,
  CommitAuthorAvatar,
  CommitContent,
  CommitFile,
  CommitFileAdditions,
  CommitFileChanges,
  CommitFileDeletions,
  CommitFileIcon,
  CommitFileInfo,
  CommitFilePath,
  CommitFileStatus,
  CommitFiles,
  CommitHash,
  CommitHeader,
  CommitInfo,
  CommitMessage,
  CommitMetadata,
  CommitSeparator,
  CommitTimestamp
} from "@/components/ai-elements/commit";
import { Message, MessageContent, MessageResponse } from "@/components/ai-elements/message";
import { Reasoning, ReasoningContent, ReasoningTrigger } from "@/components/ai-elements/reasoning";
import { cn } from "@/lib/utils";
import { initialsFromName, toAttachmentData } from "@/lib/chat-utils";
import type { AgentSession } from "@/lib/chat-types";

type SessionMessage = AgentSession["messages"][number];
import { useGitStore } from "@/stores/git-store";

const EMPTY_ARRAY: never[] = [];

// ---------------------------------------------------------------------------
// Copy button — appears on hover, resets after 2s
// ---------------------------------------------------------------------------

function CopyButton({ content }: { content: string }) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleCopy = useCallback(() => {
    void navigator.clipboard.writeText(content).then(() => {
      setCopied(true);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCopied(false), 2000);
    });
  }, [content]);

  return (
    <button
      type="button"
      onClick={handleCopy}
      title="Copy response"
      className={cn(
        "flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] transition-all",
        copied
          ? "text-emerald-500"
          : "text-muted-foreground/30 hover:text-muted-foreground/70 hover:bg-muted/20"
      )}
    >
      {copied ? <CopyCheck className="size-3" /> : <Copy className="size-3" />}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

// ---------------------------------------------------------------------------
// File diff — shown inside expanded ToolPill for Edit/Write tools
// ---------------------------------------------------------------------------

const MAX_DIFF_LINES = 40;

function FileDiff({ item }: { item: AgentSession["toolTimeline"][number] }) {
  const raw = item.rawInput;
  if (!raw) return null;

  const filePath = typeof raw.file_path === "string" ? raw.file_path : null;
  const isWrite = item.name === "Write" || item.name === "CreateFile";
  const isEdit = item.name === "Edit" || item.name === "MultiEdit";

  if (isEdit && typeof raw.old_string === "string" && typeof raw.new_string === "string") {
    const oldLines = (raw.old_string as string).split("\n");
    const newLines = (raw.new_string as string).split("\n");
    const allLines = [
      ...oldLines.map((l) => ({ sign: "-" as const, text: l })),
      ...newLines.map((l) => ({ sign: "+" as const, text: l }))
    ];
    const visible = allLines.slice(0, MAX_DIFF_LINES);
    const hidden = allLines.length - visible.length;
    return (
      <div className="mt-1.5 overflow-hidden rounded-md border border-border/25 bg-muted/8 font-mono text-[10px]">
        {filePath && (
          <div className="border-b border-border/20 px-2.5 py-1 text-muted-foreground/40">
            {filePath}
          </div>
        )}
        <div className="max-h-48 overflow-y-auto px-2.5 py-1.5">
          {visible.map((line, i) => (
            <div
              key={i}
              className={cn(
                "whitespace-pre leading-5",
                line.sign === "-"
                  ? "text-destructive/60"
                  : "text-emerald-600/70 dark:text-emerald-400/70"
              )}
            >
              {line.sign} {line.text}
            </div>
          ))}
          {hidden > 0 && <div className="pt-1 text-muted-foreground/30">... +{hidden} linhas</div>}
        </div>
      </div>
    );
  }

  if (isWrite && typeof raw.content === "string") {
    const lines = (raw.content as string).split("\n");
    const visible = lines.slice(0, MAX_DIFF_LINES);
    const hidden = lines.length - visible.length;
    return (
      <div className="mt-1.5 overflow-hidden rounded-md border border-border/25 bg-muted/8 font-mono text-[10px]">
        {filePath && (
          <div className="border-b border-border/20 px-2.5 py-1 text-muted-foreground/40">
            {filePath}
          </div>
        )}
        <div className="max-h-48 overflow-y-auto px-2.5 py-1.5">
          {visible.map((line, i) => (
            <div
              key={i}
              className="whitespace-pre leading-5 text-emerald-600/70 dark:text-emerald-400/70"
            >
              + {line}
            </div>
          ))}
          {hidden > 0 && <div className="pt-1 text-muted-foreground/30">... +{hidden} linhas</div>}
        </div>
      </div>
    );
  }

  return null;
}

// ---------------------------------------------------------------------------
// Inline tool pill — compact, always visible; expandable diff for file tools
// ---------------------------------------------------------------------------

function ToolPill({ item }: { item: AgentSession["toolTimeline"][number] }) {
  const isDone = item.status === "completed";
  const isPending = item.status === "pending";
  const isError = item.status === "error";
  const summary = isDone ? item.resultSummary || item.inputSummary : item.inputSummary;
  const hasDiff = isDone && !!item.rawInput;
  const [diffOpen, setDiffOpen] = useState(false);

  return (
    <div className="flex flex-col">
      <div
        className={cn(
          "inline-flex w-fit items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] transition-all",
          isPending
            ? "border-blue-500/20 bg-blue-500/5"
            : isError
              ? "border-destructive/20 bg-destructive/5"
              : "border-border/25 bg-muted/10 opacity-50"
        )}
      >
        {isPending ? (
          <Clock3 className="size-3 shrink-0 animate-pulse text-blue-500/60" />
        ) : isError ? (
          <CircleAlert className="size-3 shrink-0 text-destructive/60" />
        ) : (
          <div className="size-3 shrink-0" />
        )}
        <span
          className={cn(
            "shrink-0 font-mono",
            isDone
              ? "text-muted-foreground/50 line-through decoration-muted-foreground/25"
              : isError
                ? "text-destructive/70"
                : "text-muted-foreground/70"
          )}
        >
          {item.name}
        </span>
        {summary ? (
          <span
            className={cn(
              "max-w-72 truncate",
              isError ? "text-destructive/50" : "text-muted-foreground/40"
            )}
          >
            {summary}
          </span>
        ) : null}
        {hasDiff ? (
          <button
            type="button"
            onClick={() => setDiffOpen((v) => !v)}
            className="ml-0.5 rounded p-0.5 text-muted-foreground/30 transition hover:text-muted-foreground/60"
          >
            <ChevronDown className={cn("size-3 transition-transform", diffOpen && "rotate-180")} />
          </button>
        ) : null}
      </div>
      {diffOpen && hasDiff ? <FileDiff item={item} /> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export type ChatMessagesProps = {
  session: AgentSession;
  chatContainerMax: string;
  showCommits?: boolean;
};

export function ChatMessages({
  session,
  chatContainerMax,
  showCommits = false
}: ChatMessagesProps) {
  const recentCommits = useGitStore((s) => s.recentCommits);
  const [reasoningOpen, setReasoningOpen] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const messages = session.messages;
  const toolTimeline = session.toolTimeline ?? EMPTY_ARRAY;
  const contentBlocks = session.contentBlocks;
  const subagents = session.subagents ?? EMPTY_ARRAY;
  const isThinking = session.isThinking ?? false;
  const reasoningText = session.reasoningText ?? "";
  const compactCount = session.compactCount ?? 0;
  const permissionDenials = session.permissionDenials ?? EMPTY_ARRAY;
  const sessionCostUsd = session.sessionCostUsd ?? null;
  const isRunning = session.status === "running" || session.status === "awaiting_approval";
  const runningStartedAt = session.runningStartedAt;

  // Elapsed time counter — active while running
  useEffect(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    if (runningStartedAt && isRunning) {
      setElapsedSeconds(Math.floor((Date.now() - runningStartedAt) / 1000));
      intervalRef.current = setInterval(() => {
        setElapsedSeconds(Math.floor((Date.now() - runningStartedAt) / 1000));
      }, 1000);
    } else {
      setElapsedSeconds(0);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [runningStartedAt, isRunning]);

  // Filter out hidden messages (e.g. auto-resume system prompts)
  const visibleMessages = useMemo(
    () => messages.filter((m) => !(m as { hidden?: boolean }).hidden),
    [messages]
  );

  const lastAssistantIdx = useMemo(() => {
    for (let i = visibleMessages.length - 1; i >= 0; i--) {
      if (visibleMessages[i].role === "assistant") return i;
    }
    return -1;
  }, [visibleMessages]);

  // Stable Header component — recreated only when commits change
  const Header = useMemo(() => {
    if (!showCommits || recentCommits.length === 0) return undefined;
    return function CommitsHeader() {
      return (
        <div className={cn("mx-auto w-full px-4 pt-4 lg:px-8", chatContainerMax)}>
          <div className="space-y-2 pb-5">
            {recentCommits.map((commit) => (
              <Commit
                className="border-border/70 bg-background"
                defaultOpen={false}
                key={commit.hash}
              >
                <CommitHeader>
                  <CommitAuthor>
                    <CommitAuthorAvatar initials={initialsFromName(commit.author)} />
                  </CommitAuthor>
                  <CommitInfo>
                    <CommitMessage>{commit.message}</CommitMessage>
                    <CommitMetadata>
                      <span>{commit.author}</span>
                      <CommitSeparator />
                      <CommitTimestamp date={new Date(commit.dateIso)} />
                      <CommitSeparator />
                      <CommitHash>{commit.shortHash}</CommitHash>
                    </CommitMetadata>
                  </CommitInfo>
                </CommitHeader>
                <CommitContent>
                  <CommitFiles>
                    {commit.files.map((file) => (
                      <CommitFile key={`${commit.hash}-${file.path}`}>
                        <CommitFileInfo>
                          <CommitFileStatus status={file.status} />
                          <CommitFileIcon />
                          <CommitFilePath>{file.path}</CommitFilePath>
                        </CommitFileInfo>
                        <CommitFileChanges>
                          <CommitFileAdditions count={file.additions} />
                          <CommitFileDeletions count={file.deletions} />
                        </CommitFileChanges>
                      </CommitFile>
                    ))}
                  </CommitFiles>
                </CommitContent>
              </Commit>
            ))}
          </div>
        </div>
      );
    };
  }, [showCommits, recentCommits, chatContainerMax]);

  // Footer component — recreated when session metadata changes
  const Footer = useMemo(() => {
    const cc = compactCount;
    const pd = permissionDenials;
    const cost = sessionCostUsd;
    const teamNamesVal = session.teamNames;
    const cmax = chatContainerMax;
    return function FooterSection() {
      return (
        <div className={cn("mx-auto w-full px-4 pb-6 lg:px-8", cmax)}>
          {cc > 0 ? (
            <div className="mb-2 text-center text-xs text-muted-foreground">
              Conversa compactada {cc > 1 ? `${cc}x` : ""}
            </div>
          ) : null}
          {pd.length > 0 ? (
            <div className="mb-2 rounded-lg border border-orange-500/30 bg-orange-500/10 p-3 space-y-1">
              <div className="text-xs font-semibold text-orange-600 dark:text-orange-400 uppercase tracking-wide">
                Ferramentas negadas
              </div>
              <div className="flex flex-wrap gap-1">
                {pd.map((denial, i) => (
                  <span
                    className="rounded-full bg-orange-500/20 px-2 py-0.5 text-xs text-orange-700 dark:text-orange-300"
                    key={i}
                  >
                    {denial}
                  </span>
                ))}
              </div>
            </div>
          ) : null}
          {cost != null ? (
            <div className="mb-2 text-center text-xs text-muted-foreground">
              Custo da sessão: ${cost.toFixed(4)} USD
            </div>
          ) : null}
          {teamNamesVal && teamNamesVal.length > 0 ? <TeamPanel teamNames={teamNamesVal} /> : null}
        </div>
      );
    };
  }, [compactCount, permissionDenials, sessionCostUsd, session.teamNames, chatContainerMax]);

  const virtuosoComponents = useMemo(() => ({ Header, Footer }), [Header, Footer]);

  const itemContent = (index: number, message: SessionMessage) => {
    const isLastAssistant = index === lastAssistantIdx;
    const isThisRunning = isLastAssistant && isRunning;
    const isAssistant = message.role === "assistant";

    // User messages mark the start of a new exchange → more breathing room
    const topPadding = index === 0 ? "pt-6" : message.role === "user" ? "pt-10" : "pt-3";

    return (
      <div className={cn("mx-auto w-full px-4 lg:px-8", chatContainerMax, topPadding)}>
        <Message className={isAssistant ? "w-full max-w-full" : undefined} from={message.role}>
          <MessageContent
            className={
              isAssistant ? "w-full max-w-[min(860px,100%)]" : "rounded-3xl bg-muted/70 px-4 py-3"
            }
          >
            {/* ── RUNNING: last assistant message ── */}
            {isThisRunning ? (
              <div className="space-y-3">
                {/* Reasoning */}
                {isThinking ? (
                  <Reasoning
                    isStreaming={isThinking}
                    defaultOpen={isThinking}
                    onOpenChange={setReasoningOpen}
                    open={reasoningOpen}
                  >
                    <ReasoningTrigger />
                    <ReasoningContent>{reasoningText || "Thinking..."}</ReasoningContent>
                  </Reasoning>
                ) : null}

                {/* Subagents */}
                {subagents.length > 0 ? (
                  <SubagentTimeline subagents={subagents} isRunning={isRunning} />
                ) : null}

                {/* ── Interleaved: contentBlocks available → render in order ── */}
                {contentBlocks && contentBlocks.length > 0 ? (
                  <>
                    {contentBlocks.map((block, i) =>
                      block.type === "text" ? (
                        <MessageResponse key={i} className="text-[15px] leading-7 text-current">
                          {block.text}
                        </MessageResponse>
                      ) : (
                        (() => {
                          const item = toolTimeline.find((t) => t.toolUseId === block.toolUseId);
                          return item ? <ToolPill key={block.toolUseId} item={item} /> : null;
                        })()
                      )
                    )}
                    {/* Text streaming after the last committed block */}
                    {(() => {
                      const textCommitted = contentBlocks
                        .filter((b) => b.type === "text")
                        .reduce(
                          (acc, b) => acc + (b as { type: "text"; text: string }).text.length,
                          0
                        );
                      const tail = message.content.slice(textCommitted);
                      return tail ? (
                        <MessageResponse className="text-[15px] leading-7 text-current">
                          {tail}
                        </MessageResponse>
                      ) : null;
                    })()}
                  </>
                ) : (
                  /* ── Fallback: no contentBlocks yet → old layout ── */
                  <>
                    {message.content.trim() ? (
                      <MessageResponse className="text-[15px] leading-7 text-current">
                        {message.content}
                      </MessageResponse>
                    ) : null}

                    {toolTimeline.length > 0 ? (
                      <div className="space-y-1">
                        <div className="flex items-center gap-1.5 pb-0.5">
                          <Wrench className="size-3 text-muted-foreground/25" />
                          {elapsedSeconds > 0 ? (
                            <span className="ml-auto font-mono text-[10px] text-muted-foreground/30 tabular-nums">
                              {elapsedSeconds >= 60
                                ? `${Math.floor(elapsedSeconds / 60)}m${String(elapsedSeconds % 60).padStart(2, "0")}s`
                                : `${elapsedSeconds}s`}
                            </span>
                          ) : null}
                        </div>
                        {toolTimeline.map((item) => (
                          <ToolPill key={item.toolUseId} item={item} />
                        ))}
                      </div>
                    ) : elapsedSeconds > 0 ? (
                      <span className="font-mono text-[10px] text-muted-foreground/30 tabular-nums">
                        {elapsedSeconds >= 60
                          ? `${Math.floor(elapsedSeconds / 60)}m${String(elapsedSeconds % 60).padStart(2, "0")}s`
                          : `${elapsedSeconds}s`}
                      </span>
                    ) : null}
                  </>
                )}

                {/* Timer — shown alongside blocks when tools are active */}
                {contentBlocks && contentBlocks.length > 0 && elapsedSeconds > 0 ? (
                  <span className="font-mono text-[10px] text-muted-foreground/30 tabular-nums">
                    {elapsedSeconds >= 60
                      ? `${Math.floor(elapsedSeconds / 60)}m${String(elapsedSeconds % 60).padStart(2, "0")}s`
                      : `${elapsedSeconds}s`}
                  </span>
                ) : null}
              </div>
            ) : (
              /* ── COMPLETED ── */
              <div className="space-y-2.5">
                {/* Reasoning history — collapsed, only for last assistant */}
                {isLastAssistant && reasoningText.trim() ? (
                  <Reasoning isStreaming={false} defaultOpen={false}>
                    <ReasoningTrigger />
                    <ReasoningContent>{reasoningText}</ReasoningContent>
                  </Reasoning>
                ) : null}

                {/* User attachments — inside bubble */}
                {message.role === "user" &&
                Array.isArray(message.attachments) &&
                message.attachments.length > 0 ? (
                  <Attachments variant="inline">
                    {message.attachments.map((file) => {
                      const item = toAttachmentData(file);
                      return (
                        <AttachmentHoverCard key={`${message.id}-${file.absolutePath}`}>
                          <AttachmentHoverCardTrigger asChild>
                            <Attachment data={item}>
                              <AttachmentPreview />
                              <AttachmentInfo />
                            </Attachment>
                          </AttachmentHoverCardTrigger>
                          <AttachmentHoverCardContent>
                            <Attachment data={item}>
                              <AttachmentPreview className="size-32" />
                            </Attachment>
                          </AttachmentHoverCardContent>
                        </AttachmentHoverCard>
                      );
                    })}
                  </Attachments>
                ) : null}

                {/* ── Interleaved blocks (completed) — renders when tools were used ── */}
                {isAssistant && contentBlocks && contentBlocks.length > 0 ? (
                  contentBlocks.map((block, i) =>
                    block.type === "text" ? (
                      <MessageResponse key={i} className="text-[15px] leading-7 text-current">
                        {block.text}
                      </MessageResponse>
                    ) : (
                      (() => {
                        const item = toolTimeline.find((t) => t.toolUseId === block.toolUseId);
                        return item ? <ToolPill key={block.toolUseId} item={item} /> : null;
                      })()
                    )
                  )
                ) : (
                  /* ── Fallback: no blocks → flat response ── */
                  <MessageResponse className="text-[15px] leading-7 text-current">
                    {message.content}
                  </MessageResponse>
                )}
              </div>
            )}
          </MessageContent>

          {/* ── Assistant actions — outside bubble, appear on hover ── */}
          {isAssistant && !isThisRunning ? (
            <div className="flex max-w-[min(860px,100%)] items-center gap-2 opacity-0 transition-opacity duration-150 group-hover:opacity-100">
              <CopyButton content={message.content} />
              {isLastAssistant && toolTimeline.length > 0 ? (
                <span className="flex items-center gap-1 text-[10px] text-muted-foreground/30">
                  <Wrench className="size-3" />
                  {toolTimeline.length} {toolTimeline.length === 1 ? "tool call" : "tool calls"}
                </span>
              ) : null}
            </div>
          ) : null}

          {/* ── Subagents — below actions for last assistant done ── */}
          {isAssistant && isLastAssistant && !isThisRunning && subagents.length > 0 ? (
            <div className="max-w-[min(860px,100%)]">
              <SubagentTimeline isRunning={false} subagents={subagents} />
            </div>
          ) : null}
        </Message>
      </div>
    );
  };

  return (
    <Virtuoso
      style={{ flex: 1 }}
      data={visibleMessages}
      initialTopMostItemIndex={Math.max(0, visibleMessages.length - 1)}
      followOutput={(isAtBottom) => (isRunning && isAtBottom ? "auto" : false)}
      itemContent={itemContent}
      increaseViewportBy={{ top: 400, bottom: 400 }}
      components={virtuosoComponents}
    />
  );
}
