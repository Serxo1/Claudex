import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CircleAlert, Clock3, ChevronDownIcon, Copy, CopyCheck, Wrench } from "lucide-react";
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
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
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
// Tool timeline row — shared between running and done states
// ---------------------------------------------------------------------------

function ToolTimelineRow({ item }: { item: AgentSession["toolTimeline"][number] }) {
  const isDone = item.status === "completed";
  const isPending = item.status === "pending";
  const isError = item.status === "error";

  return (
    <div className={cn("flex items-center gap-1.5 py-0.5 text-xs", isDone && "opacity-35")}>
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
            ? "text-muted-foreground/50 line-through decoration-muted-foreground/30"
            : isError
              ? "text-destructive/70"
              : "text-muted-foreground/70"
        )}
      >
        {item.name}
      </span>
      <span
        className={cn(
          "min-w-0 truncate",
          isError
            ? "text-destructive/50"
            : isDone
              ? "text-muted-foreground/30"
              : "text-muted-foreground/40"
        )}
      >
        {isPending ? item.inputSummary : item.resultSummary || item.inputSummary}
      </span>
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
  // Auto-open while running; user can collapse manually
  const [taskOpen, setTaskOpen] = useState(session.status === "running");
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const messages = session.messages;
  const toolTimeline = session.toolTimeline ?? EMPTY_ARRAY;
  const subagents = session.subagents ?? EMPTY_ARRAY;
  const isThinking = session.isThinking ?? false;
  const reasoningText = session.reasoningText ?? "";
  const compactCount = session.compactCount ?? 0;
  const permissionDenials = session.permissionDenials ?? EMPTY_ARRAY;
  const sessionCostUsd = session.sessionCostUsd ?? null;
  const isRunning = session.status === "running" || session.status === "awaiting_approval";
  const runningStartedAt = session.runningStartedAt;

  // Auto-open tool timeline when session starts running
  useEffect(() => {
    if (isRunning) setTaskOpen(true);
  }, [isRunning]);

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

  const pendingTools = useMemo(
    () => toolTimeline.filter((item) => item.status === "pending"),
    [toolTimeline]
  );

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

    return (
      <div
        className={cn(
          "mx-auto w-full px-4 lg:px-8",
          chatContainerMax,
          index === 0 ? "pt-4" : "pt-5"
        )}
      >
        <Message className="w-full max-w-full" from={message.role}>
          <MessageContent
            className={cn(
              "max-w-[min(880px,100%)] rounded-2xl border px-4 py-3 shadow-sm",
              message.role === "assistant"
                ? "border-border/70 bg-background text-foreground"
                : "border-border/50 bg-card text-foreground"
            )}
          >
            {/* ── RUNNING: last assistant message ── */}
            {isThisRunning ? (
              <div className="space-y-3">
                {/* Reasoning — auto-opens when thinking starts */}
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

                {/* Tool timeline — auto-opens, shows active tool + elapsed */}
                {toolTimeline.length > 0 ? (
                  <Collapsible onOpenChange={setTaskOpen} open={taskOpen}>
                    <CollapsibleTrigger className="group flex items-center gap-1.5 text-xs text-muted-foreground/60 transition-colors hover:text-muted-foreground">
                      <Wrench className="size-3 shrink-0" />
                      {pendingTools.length > 0 ? (
                        <>
                          <span className="shrink-0 font-mono">
                            {pendingTools[pendingTools.length - 1]?.name}
                          </span>
                          <span className="max-w-56 truncate text-muted-foreground/40">
                            {pendingTools[pendingTools.length - 1]?.inputSummary}
                          </span>
                        </>
                      ) : (
                        <span>
                          {toolTimeline.length}{" "}
                          {toolTimeline.length === 1 ? "ferramenta" : "ferramentas"}
                        </span>
                      )}
                      {elapsedSeconds > 0 ? (
                        <span className="ml-auto font-mono text-muted-foreground/40 tabular-nums">
                          {elapsedSeconds >= 60
                            ? `${Math.floor(elapsedSeconds / 60)}m${String(elapsedSeconds % 60).padStart(2, "0")}s`
                            : `${elapsedSeconds}s`}
                        </span>
                      ) : null}
                      <ChevronDownIcon className="size-3 transition-transform group-data-[state=open]:rotate-180" />
                    </CollapsibleTrigger>
                    <CollapsibleContent className="mt-1.5">
                      <div className="space-y-0 pl-1">
                        {toolTimeline.map((item) => (
                          <ToolTimelineRow key={item.toolUseId} item={item} />
                        ))}
                      </div>
                    </CollapsibleContent>
                  </Collapsible>
                ) : null}

                {/* Partial content while streaming */}
                {message.content.trim() ? (
                  <MessageResponse className="text-[14px] leading-6 text-current">
                    {message.content}
                  </MessageResponse>
                ) : null}
              </div>
            ) : (
              /* ── COMPLETED / non-last messages ── */
              <div className="space-y-2">
                {/* Reasoning history — collapsed, only for last assistant */}
                {isLastAssistant && reasoningText.trim() ? (
                  <Reasoning isStreaming={false} defaultOpen={false}>
                    <ReasoningTrigger />
                    <ReasoningContent>{reasoningText}</ReasoningContent>
                  </Reasoning>
                ) : null}

                <MessageResponse className="text-[14px] leading-6 text-current">
                  {message.content}
                </MessageResponse>

                {/* Copy + tool history row */}
                {message.role === "assistant" && (
                  <div className="flex items-center gap-2 pt-0.5">
                    <CopyButton content={message.content} />

                    {/* Tool history — collapsed summary for last assistant */}
                    {isLastAssistant && toolTimeline.length > 0 ? (
                      <Collapsible>
                        <CollapsibleTrigger className="group flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] text-muted-foreground/30 transition-all hover:bg-muted/20 hover:text-muted-foreground/70">
                          <Wrench className="size-3" />
                          {toolTimeline.length} {toolTimeline.length === 1 ? "tool" : "tools"}
                          <ChevronDownIcon className="size-3 transition-transform group-data-[state=open]:rotate-180" />
                        </CollapsibleTrigger>
                        <CollapsibleContent className="mt-1.5">
                          <div className="space-y-0 rounded-lg border border-border/30 bg-muted/5 p-2 pl-2">
                            {toolTimeline.map((item) => (
                              <ToolTimelineRow key={item.toolUseId} item={item} />
                            ))}
                          </div>
                        </CollapsibleContent>
                      </Collapsible>
                    ) : null}
                  </div>
                )}

                {/* Subagents — for last assistant, done state */}
                {message.role === "assistant" && isLastAssistant && subagents.length > 0 ? (
                  <div className="mt-3 border-t border-border/30 pt-3">
                    <SubagentTimeline isRunning={false} subagents={subagents} />
                  </div>
                ) : null}

                {/* User attachments */}
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
              </div>
            )}
          </MessageContent>
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
