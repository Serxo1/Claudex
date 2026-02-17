import { useMemo } from "react";
import { CheckCircle2, CircleAlert, Clock3, Wrench } from "lucide-react";
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
  ChainOfThought,
  ChainOfThoughtContent,
  ChainOfThoughtHeader,
  ChainOfThoughtStep
} from "@/components/ai-elements/chain-of-thought";
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
import {
  Queue,
  QueueItem,
  QueueItemContent,
  QueueItemDescription,
  QueueItemIndicator,
  QueueList,
  QueueSection,
  QueueSectionContent,
  QueueSectionLabel,
  QueueSectionTrigger
} from "@/components/ai-elements/queue";
import { Reasoning, ReasoningContent, ReasoningTrigger } from "@/components/ai-elements/reasoning";
import { Task, TaskContent, TaskItem, TaskTrigger } from "@/components/ai-elements/task";
import { cn } from "@/lib/utils";
import { initialsFromName, toAttachmentData } from "@/lib/chat-utils";
import { useGitStore } from "@/stores/git-store";
import { useChatStore } from "@/stores/chat-store";

const EMPTY_ARRAY: never[] = [];

export type ChatMessagesProps = {
  activePage: "chat" | "preview";
  taskTitle: string;
  chatContainerMax: string;
};

export function ChatMessages({ activePage, taskTitle, chatContainerMax }: ChatMessagesProps) {
  const recentCommits = useGitStore((s) => s.recentCommits);

  const messages = useChatStore((s) => {
    const thread = s.threads.find((t) => t.id === s.activeThreadId) ?? s.threads[0] ?? null;
    return thread?.messages ?? EMPTY_ARRAY;
  });
  const executionAssistantMessageId = useChatStore((s) => s.executionAssistantMessageId);
  const isThinking = useChatStore((s) => s.isThinking);
  const reasoningOpen = useChatStore((s) => s.reasoningOpen);
  const setReasoningOpen = useChatStore((s) => s.setReasoningOpen);
  const reasoningText = useChatStore((s) => s.reasoningText);
  const activeToolTimeline = useChatStore((s) =>
    s.executionRequestId
      ? (s.activeToolTimelineByRequest[s.executionRequestId] ?? EMPTY_ARRAY)
      : EMPTY_ARRAY
  );
  const pendingTools = useMemo(
    () => activeToolTimeline.filter((item) => item.status === "pending"),
    [activeToolTimeline]
  );
  const completedTools = useMemo(
    () => activeToolTimeline.filter((item) => item.status !== "pending"),
    [activeToolTimeline]
  );
  const taskOpen = useChatStore((s) => s.taskOpen);
  const setTaskOpen = useChatStore((s) => s.setTaskOpen);
  const timelineOpen = useChatStore((s) => s.timelineOpen);
  const setTimelineOpen = useChatStore((s) => s.setTimelineOpen);
  const compactCount = useChatStore((s) => s.compactCount);
  const permissionDenials = useChatStore((s) => s.permissionDenials);
  const sessionCostUsd = useChatStore((s) => s.sessionCostUsd);

  return (
    <Conversation className="min-h-0 flex-1">
      <ConversationContent
        className={cn("mx-auto w-full gap-5 px-4 pt-4 pb-6 lg:px-8", chatContainerMax)}
      >
        {activePage === "chat" && recentCommits.length > 0 ? (
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

        {messages.map((message) => (
          <Message className="w-full max-w-full" from={message.role} key={message.id}>
            <MessageContent
              className={cn(
                "max-w-[min(880px,100%)] rounded-2xl border px-4 py-3 shadow-sm",
                message.role === "assistant"
                  ? "border-border/70 bg-background text-white"
                  : "border-white/10 bg-card text-foreground"
              )}
            >
              {message.role === "assistant" && message.id === executionAssistantMessageId ? (
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

                  {activeToolTimeline.length > 0 ? (
                    <>
                      <Task onOpenChange={setTaskOpen} open={taskOpen}>
                        <TaskTrigger title={taskTitle} />
                        <TaskContent>
                          {activeToolTimeline.map((item) => (
                            <TaskItem key={`task-${item.toolUseId}`}>
                              {item.status === "pending"
                                ? "Running"
                                : item.status === "error"
                                  ? "Failed"
                                  : "Completed"}{" "}
                              {item.name}
                            </TaskItem>
                          ))}
                        </TaskContent>
                      </Task>

                      <Queue>
                        <QueueSection defaultOpen>
                          <QueueSectionTrigger>
                            <QueueSectionLabel
                              count={pendingTools.length}
                              icon={<Clock3 className="size-3.5" />}
                              label="Pending"
                            />
                          </QueueSectionTrigger>
                          <QueueSectionContent>
                            <QueueList>
                              {pendingTools.map((item) => (
                                <QueueItem key={`pending-${item.toolUseId}`}>
                                  <div className="flex items-start gap-2">
                                    <QueueItemIndicator />
                                    <QueueItemContent>{item.name}</QueueItemContent>
                                  </div>
                                  <QueueItemDescription>{item.inputSummary}</QueueItemDescription>
                                </QueueItem>
                              ))}
                            </QueueList>
                          </QueueSectionContent>
                        </QueueSection>

                        <QueueSection defaultOpen>
                          <QueueSectionTrigger>
                            <QueueSectionLabel
                              count={completedTools.length}
                              icon={<Wrench className="size-3.5" />}
                              label="Completed"
                            />
                          </QueueSectionTrigger>
                          <QueueSectionContent>
                            <QueueList>
                              {completedTools.map((item) => (
                                <QueueItem key={`completed-${item.toolUseId}`}>
                                  <div className="flex items-start gap-2">
                                    <QueueItemIndicator completed />
                                    <QueueItemContent completed>{item.name}</QueueItemContent>
                                  </div>
                                  <QueueItemDescription completed>
                                    {item.status === "error"
                                      ? `Completed with error: ${item.resultSummary}`
                                      : item.resultSummary}
                                  </QueueItemDescription>
                                </QueueItem>
                              ))}
                            </QueueList>
                          </QueueSectionContent>
                        </QueueSection>
                      </Queue>

                      <ChainOfThought onOpenChange={setTimelineOpen} open={timelineOpen}>
                        <ChainOfThoughtHeader>Tool execution timeline</ChainOfThoughtHeader>
                        <ChainOfThoughtContent>
                          {activeToolTimeline.map((item) => (
                            <ChainOfThoughtStep
                              description={
                                item.status === "pending"
                                  ? item.inputSummary
                                  : item.resultSummary || item.inputSummary
                              }
                              icon={
                                item.status === "pending"
                                  ? Clock3
                                  : item.status === "error"
                                    ? CircleAlert
                                    : CheckCircle2
                              }
                              key={`timeline-${item.toolUseId}`}
                              label={item.status === "error" ? `${item.name} (error)` : item.name}
                              status={item.status === "pending" ? "active" : "complete"}
                            />
                          ))}
                        </ChainOfThoughtContent>
                      </ChainOfThought>
                    </>
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
                  key={i}
                  className="rounded-full bg-orange-500/20 px-2 py-0.5 text-xs text-orange-700 dark:text-orange-300"
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
      </ConversationContent>
    </Conversation>
  );
}
