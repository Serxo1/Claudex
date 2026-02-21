import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "motion/react";
import {
  ChevronDown,
  CircleAlert,
  Clock3,
  Copy,
  CopyCheck,
  File,
  FileCode,
  Globe,
  Wrench
} from "lucide-react";
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
import {
  extractFilePaths,
  extractLocalhostUrls,
  initialsFromName,
  toAttachmentData
} from "@/lib/chat-utils";
import type { AgentSession } from "@/lib/chat-types";

type SessionMessage = AgentSession["messages"][number];
import { useGitStore } from "@/stores/git-store";

const EMPTY_ARRAY: never[] = [];

// ---------------------------------------------------------------------------
// Compact separator — inline divider shown when conversation was compacted
// ---------------------------------------------------------------------------

function CompactSeparator() {
  return (
    <div className="mx-auto flex w-full items-center gap-3 px-4 py-2 lg:px-8">
      <div className="h-px flex-1 bg-border/40" />
      <div className="flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/8 px-2.5 py-1 text-[11px] text-amber-600 dark:text-amber-400/80">
        <svg
          className="size-3 shrink-0"
          viewBox="0 0 16 16"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden
        >
          <path
            d="M8 2v4M8 10v4M2 8h4M10 8h4"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
        Conversa compactada aqui
      </div>
      <div className="h-px flex-1 bg-border/40" />
    </div>
  );
}

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
// File diff — prominent conversation-style block for Edit/Write tools
// ---------------------------------------------------------------------------

const FILE_DIFF_TOOLS = new Set(["Edit", "Write", "MultiEdit", "CreateFile"]);
const MAX_DIFF_LINES = 80;

function toRelativePath(absPath: string, workspaceDir: string): string {
  if (!workspaceDir) return absPath;
  const norm = (p: string) => p.replace(/\\/g, "/");
  const normAbs = norm(absPath);
  const normWs = norm(workspaceDir).replace(/\/+$/, "") + "/";
  return normAbs.startsWith(normWs) ? normAbs.slice(normWs.length) : absPath;
}

function FileDiff({
  item,
  workspaceDir
}: {
  item: AgentSession["toolTimeline"][number];
  workspaceDir?: string;
}) {
  const raw = item.rawInput;
  if (!raw) return null;

  const rawPath = typeof raw.file_path === "string" ? raw.file_path : null;
  const filePath = rawPath && workspaceDir ? toRelativePath(rawPath, workspaceDir) : rawPath;
  const isWrite = item.name === "Write" || item.name === "CreateFile";
  const isEdit = item.name === "Edit" || item.name === "MultiEdit";

  const buildEditLines = (oldStr: string, newStr: string): { sign: "-" | "+"; text: string }[] => [
    ...oldStr.split("\n").map((l) => ({ sign: "-" as const, text: l })),
    ...newStr.split("\n").map((l) => ({ sign: "+" as const, text: l }))
  ];

  let allLines: { sign: "-" | "+"; text: string }[] = [];

  if (isEdit) {
    if (Array.isArray(raw.edits)) {
      for (
        let i = 0;
        i < (raw.edits as Array<{ old_string: string; new_string: string }>).length;
        i++
      ) {
        const edit = (raw.edits as Array<{ old_string: string; new_string: string }>)[i];
        if (i > 0) allLines.push({ sign: "+" as const, text: "\u00b7\u00b7\u00b7" });
        allLines.push(...buildEditLines(edit.old_string ?? "", edit.new_string ?? ""));
      }
    } else if (typeof raw.old_string === "string" && typeof raw.new_string === "string") {
      allLines = buildEditLines(raw.old_string, raw.new_string);
    }
  } else if (isWrite && typeof raw.content === "string") {
    allLines = (raw.content as string).split("\n").map((l) => ({ sign: "+" as const, text: l }));
  }

  if (!allLines.length) return null;

  const visible = allLines.slice(0, MAX_DIFF_LINES);
  const hidden = allLines.length - visible.length;

  const isSeparator = (text: string) => text === "\u00b7\u00b7\u00b7";
  const badge = isWrite ? "Criado" : "Editado";
  const badgeClass = isWrite
    ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
    : "bg-blue-500/10 text-blue-600 dark:text-blue-400";

  return (
    <div className="w-full overflow-hidden rounded-xl border border-border/40 bg-background shadow-sm">
      {/* File header */}
      <div className="flex items-center gap-2 border-b border-border/30 bg-muted/20 px-3 py-2">
        <File className="size-3.5 shrink-0 text-muted-foreground/40" />
        <span className="flex-1 truncate font-mono text-[11px] text-muted-foreground/70">
          {filePath ?? item.name}
        </span>
        <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-medium", badgeClass)}>
          {badge}
        </span>
      </div>
      {/* Diff lines */}
      <div className="max-h-80 overflow-y-auto">
        {visible.map((line, i) =>
          isSeparator(line.text) ? (
            <div
              key={i}
              className="border-y border-border/15 bg-muted/10 px-3 py-0.5 font-mono text-[10px] text-muted-foreground/30"
            >
              ···
            </div>
          ) : (
            <div
              key={i}
              className={cn(
                "flex gap-2 px-3 font-mono text-[11px] leading-[1.7]",
                line.sign === "-"
                  ? "bg-red-500/[0.05] text-red-700 dark:text-red-400/80"
                  : "bg-emerald-500/[0.05] text-emerald-700 dark:text-emerald-400/80"
              )}
            >
              <span className="w-3 shrink-0 select-none text-muted-foreground/30">{line.sign}</span>
              <span className="whitespace-pre">{line.text}</span>
            </div>
          )
        )}
        {hidden > 0 && (
          <div className="px-3 py-1.5 font-mono text-[10px] text-muted-foreground/30">
            ... +{hidden} linhas
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tool card — pill header with chevron for all tools; file tools expand by default
// ---------------------------------------------------------------------------

function ToolCard({
  item,
  workspaceDir
}: {
  item: AgentSession["toolTimeline"][number];
  workspaceDir?: string;
}) {
  const isDone = item.status === "completed";
  const isPending = item.status === "pending";
  const isError = item.status === "error";
  const isFileTool = FILE_DIFF_TOOLS.has(item.name);
  const hasDiff = isFileTool && !!item.rawInput;
  const summary = isDone ? item.resultSummary || item.inputSummary : item.inputSummary;
  const expandedContent = hasDiff ? "diff" : item.resultSummary || item.inputSummary || null;
  const [open, setOpen] = useState(hasDiff);

  return (
    <div className="flex flex-col gap-1.5">
      {/* Pill header */}
      <button
        type="button"
        onClick={expandedContent ? () => setOpen((v) => !v) : undefined}
        className={cn(
          "inline-flex w-fit items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] transition-all",
          expandedContent ? "cursor-pointer hover:opacity-80" : "cursor-default",
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
        {expandedContent ? (
          <ChevronDown
            className={cn(
              "size-3 shrink-0 text-muted-foreground/30 transition-transform",
              open && "rotate-180"
            )}
          />
        ) : null}
      </button>

      {/* Expanded content */}
      {open && expandedContent ? (
        hasDiff ? (
          <FileDiff item={item} workspaceDir={workspaceDir} />
        ) : (
          <div className="max-w-xl rounded-lg border border-border/25 bg-muted/8 px-3 py-2 font-mono text-[11px] leading-relaxed text-muted-foreground/60">
            {item.resultSummary || item.inputSummary}
          </div>
        )
      ) : null}
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
  workspaceDir?: string;
  onOpenInPreview?: (url: string) => void;
  onOpenFile?: (relativePath: string) => void;
};

export function ChatMessages({
  session,
  chatContainerMax,
  showCommits = false,
  workspaceDir,
  onOpenInPreview,
  onOpenFile
}: ChatMessagesProps) {
  const recentCommits = useGitStore((s) => s.recentCommits);
  const [reasoningOpen, setReasoningOpen] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const initialMessageCount = useRef(
    session.messages.filter((m) => !(m as { hidden?: boolean }).hidden).length
  );

  const messages = session.messages;
  const toolTimeline = session.toolTimeline ?? EMPTY_ARRAY;
  const contentBlocks = session.contentBlocks;
  const subagents = session.subagents ?? EMPTY_ARRAY;
  const isThinking = session.isThinking ?? false;
  const reasoningText = session.reasoningText ?? "";
  const permissionDenials = session.permissionDenials ?? EMPTY_ARRAY;
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
      // Skip compact markers — they shouldn't be treated as real assistant messages
      if (
        visibleMessages[i].role === "assistant" &&
        !(visibleMessages[i] as { compact?: boolean }).compact
      )
        return i;
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
    const pd = permissionDenials;
    const teamNamesVal = session.teamNames;
    const cmax = chatContainerMax;
    return function FooterSection() {
      return (
        <div className={cn("mx-auto w-full px-4 pb-6 lg:px-8", cmax)}>
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
          {teamNamesVal && teamNamesVal.length > 0 ? <TeamPanel teamNames={teamNamesVal} /> : null}
        </div>
      );
    };
  }, [permissionDenials, session.teamNames, chatContainerMax]);

  const virtuosoComponents = useMemo(() => ({ Header, Footer }), [Header, Footer]);

  const itemContent = (index: number, message: SessionMessage) => {
    // Compact boundary marker — render as inline separator
    if ((message as { compact?: boolean }).compact) {
      return <CompactSeparator key={message.id} />;
    }

    const isLastAssistant = index === lastAssistantIdx;
    const isThisRunning = isLastAssistant && isRunning;
    const isAssistant = message.role === "assistant";

    // User messages mark the start of a new exchange → more breathing room
    const topPadding = index === 0 ? "pt-6" : message.role === "user" ? "pt-10" : "pt-3";

    const isNewMessage = index >= initialMessageCount.current;

    return (
      <motion.div
        className={cn("mx-auto w-full px-4 lg:px-8", chatContainerMax, topPadding)}
        initial={isNewMessage ? { opacity: 0, y: 6 } : false}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.18, ease: "easeOut" }}
      >
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
                          return item ? (
                            <ToolCard
                              key={block.toolUseId}
                              item={item}
                              workspaceDir={workspaceDir}
                            />
                          ) : null;
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
                          <ToolCard key={item.toolUseId} item={item} workspaceDir={workspaceDir} />
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

                {/* ── Interleaved blocks (completed) — per-message, self-contained ── */}
                {isAssistant && message.contentBlocks && message.contentBlocks.length > 0 ? (
                  message.contentBlocks.map((block, i) =>
                    block.type === "text" ? (
                      <MessageResponse key={i} className="text-[15px] leading-7 text-current">
                        {block.text}
                      </MessageResponse>
                    ) : (
                      (() => {
                        // Use per-message frozen tools (survive toolTimeline reset on new turns)
                        const msgTools = message.contentBlockTools ?? toolTimeline;
                        const item = msgTools.find((t) => t.toolUseId === block.toolUseId);
                        return item ? (
                          <ToolCard key={block.toolUseId} item={item} workspaceDir={workspaceDir} />
                        ) : null;
                      })()
                    )
                  )
                ) : (
                  /* ── Fallback: no blocks → flat response ── */
                  <MessageResponse className="text-[15px] leading-7 text-current">
                    {message.content}
                  </MessageResponse>
                )}

                {/* ── Localhost URL pills — only for completed assistant messages ── */}
                {isAssistant && onOpenInPreview
                  ? (() => {
                      const urls = extractLocalhostUrls(message.content);
                      if (!urls.length) return null;
                      return (
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          {urls.map((url) => (
                            <button
                              key={url}
                              type="button"
                              onClick={() => onOpenInPreview(url)}
                              className="inline-flex items-center gap-1 rounded-full border border-blue-500/30 bg-blue-500/8 px-2 py-0.5 text-[11px] text-blue-500 hover:bg-blue-500/15 transition-colors"
                            >
                              <Globe className="size-3" />
                              {url}
                            </button>
                          ))}
                        </div>
                      );
                    })()
                  : null}

                {/* ── File path chips — open in editor ── */}
                {isAssistant && onOpenFile
                  ? (() => {
                      const paths = extractFilePaths(message.content);
                      if (!paths.length) return null;
                      return (
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          {paths.map((p) => (
                            <button
                              key={p}
                              type="button"
                              onClick={() => onOpenFile(p)}
                              className="inline-flex items-center gap-1 rounded-full border border-border/40 bg-muted/20 px-2 py-0.5 text-[11px] text-muted-foreground/70 hover:bg-muted/40 hover:text-foreground transition-colors font-mono"
                            >
                              <FileCode className="size-3 shrink-0" />
                              {p}
                            </button>
                          ))}
                        </div>
                      );
                    })()
                  : null}
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
      </motion.div>
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
