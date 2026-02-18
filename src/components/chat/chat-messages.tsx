import { useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, CircleAlert, Clock3, ChevronDownIcon, Wrench } from "lucide-react";
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
import { Conversation, ConversationContent } from "@/components/ai-elements/conversation";
import { Message, MessageContent, MessageResponse } from "@/components/ai-elements/message";
import { Reasoning, ReasoningContent, ReasoningTrigger } from "@/components/ai-elements/reasoning";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { initialsFromName, toAttachmentData } from "@/lib/chat-utils";
import type { AgentSession } from "@/lib/chat-types";
import { useGitStore } from "@/stores/git-store";

const EMPTY_ARRAY: never[] = [];

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
  const [taskOpen, setTaskOpen] = useState(false);
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

  // The last assistant message is the one currently streaming (if running)
  const lastAssistantIdx = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "assistant") return i;
    }
    return -1;
  }, [messages]);

  const pendingTools = useMemo(
    () => toolTimeline.filter((item) => item.status === "pending"),
    [toolTimeline]
  );

  return (
    <Conversation className="min-h-0 flex-1">
      <ConversationContent
        className={cn("mx-auto w-full gap-5 px-4 pt-4 pb-6 lg:px-8", chatContainerMax)}
      >
        {showCommits && recentCommits.length > 0 ? (
          <div className="space-y-2">
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
        ) : null}

        {messages.map((message, index) => (
          <Message className="w-full max-w-full" from={message.role} key={message.id}>
            <MessageContent
              className={cn(
                "max-w-[min(880px,100%)] rounded-2xl border px-4 py-3 shadow-sm",
                message.role === "assistant"
                  ? "border-border/70 bg-background text-foreground"
                  : "border-border/50 bg-card text-foreground"
              )}
            >
              {message.role === "assistant" && index === lastAssistantIdx && isRunning ? (
                <div className="space-y-3">
                  {isThinking ? (
                    <Reasoning
                      defaultOpen={false}
                      isStreaming={isThinking}
                      onOpenChange={setReasoningOpen}
                      open={reasoningOpen}
                    >
                      <ReasoningTrigger />
                      <ReasoningContent>{reasoningText || "Thinking..."}</ReasoningContent>
                    </Reasoning>
                  ) : null}

                  {subagents.length > 0 ? (
                    <SubagentTimeline subagents={subagents} isRunning={isRunning} />
                  ) : null}

                  {toolTimeline.length > 0 ? (
                    <Collapsible onOpenChange={setTaskOpen} open={taskOpen}>
                      <CollapsibleTrigger className="group flex items-center gap-1.5 text-xs text-muted-foreground/60 transition-colors hover:text-muted-foreground">
                        <Wrench className="size-3 shrink-0" />
                        {isRunning && pendingTools.length > 0 ? (
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
                        {isRunning && elapsedSeconds > 0 ? (
                          <span className="ml-auto font-mono text-muted-foreground/40 tabular-nums">
                            {elapsedSeconds >= 60
                              ? `${Math.floor(elapsedSeconds / 60)}m${String(elapsedSeconds % 60).padStart(2, "0")}s`
                              : `${elapsedSeconds}s`}
                          </span>
                        ) : null}
                        <ChevronDownIcon className="size-3 transition-transform group-data-[state=open]:rotate-180" />
                      </CollapsibleTrigger>
                      <CollapsibleContent className="mt-1.5">
                        <div className="space-y-0.5 pl-1">
                          {toolTimeline.map((item) => (
                            <div
                              className="flex items-center gap-1.5 py-0.5 text-xs"
                              key={item.toolUseId}
                            >
                              {item.status === "pending" ? (
                                <Clock3 className="size-3 shrink-0 animate-pulse text-muted-foreground/50" />
                              ) : item.status === "error" ? (
                                <CircleAlert className="size-3 shrink-0 text-destructive/60" />
                              ) : (
                                <CheckCircle2 className="size-3 shrink-0 text-muted-foreground/30" />
                              )}
                              <span
                                className={cn(
                                  "shrink-0 font-mono",
                                  item.status === "error"
                                    ? "text-destructive/70"
                                    : "text-muted-foreground/50"
                                )}
                              >
                                {item.name}
                              </span>
                              <span className="truncate text-muted-foreground/35">
                                {item.status === "pending"
                                  ? item.inputSummary
                                  : item.resultSummary || item.inputSummary}
                              </span>
                            </div>
                          ))}
                        </div>
                      </CollapsibleContent>
                    </Collapsible>
                  ) : null}

                  {message.content.trim() ? (
                    <MessageResponse className="text-[14px] leading-6 text-current">
                      {message.content}
                    </MessageResponse>
                  ) : null}
                </div>
              ) : (
                <div className="space-y-2">
                  <MessageResponse className="text-[14px] leading-6 text-current">
                    {message.content}
                  </MessageResponse>
                  {message.role === "assistant" &&
                  index === lastAssistantIdx &&
                  subagents.length > 0 ? (
                    <div className="mt-3 border-t border-border/30 pt-3">
                      <SubagentTimeline isRunning={false} subagents={subagents} />
                    </div>
                  ) : null}
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
        ))}

        {compactCount > 0 ? (
          <div className="text-center text-xs text-muted-foreground">
            Conversa compactada {compactCount > 1 ? `${compactCount}x` : ""}
          </div>
        ) : null}

        {permissionDenials.length > 0 ? (
          <div className="rounded-lg border border-orange-500/30 bg-orange-500/10 p-3 space-y-1">
            <div className="text-xs font-semibold text-orange-600 dark:text-orange-400 uppercase tracking-wide">
              Ferramentas negadas
            </div>
            <div className="flex flex-wrap gap-1">
              {permissionDenials.map((denial, i) => (
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

        {sessionCostUsd != null ? (
          <div className="text-center text-xs text-muted-foreground">
            Custo da sessão: ${sessionCostUsd.toFixed(4)} USD
          </div>
        ) : null}

        {session.teamNames && session.teamNames.length > 0 ? (
          <TeamPanel teamNames={session.teamNames} />
        ) : null}
      </ConversationContent>
    </Conversation>
  );
}
