import { useState } from "react";
import { AlertCircle, LayoutTemplate, Loader2, Square, Terminal } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AgentSession, Thread } from "@/lib/chat-types";
import { ChatMessages } from "@/components/chat/chat-messages";
import { ToolApproval, AskUserQuestion } from "@/components/chat/tool-approval";
import { PromptArea } from "@/components/chat/prompt-area";
import { AuthExpiredBanner } from "@/components/chat/auth-expired-banner";
import { ExportButton } from "@/components/chat/export-button";
import { ThreadTemplates } from "@/components/chat/thread-templates";
import { useChatStore } from "@/stores/chat-store";

export type SessionStackProps = {
  thread: Thread;
  chatContainerMax: string;
  modelOptions: Array<{ value: string; label: string; releasedAt?: string }>;
  latestTerminalError: string;
  onInsertLatestTerminalError: (setInput: React.Dispatch<React.SetStateAction<string>>) => void;
  setTerminalOpen: (value: boolean | ((current: boolean) => boolean)) => void;
};

const SUGGESTIONS = [
  { emoji: "🎮", text: "Build a classic Snake game in this repo." },
  { emoji: "📄", text: "Create a README that explains this project." },
  { emoji: "✏️", text: "Make a plan for what to build next." }
];

function EmptyState({
  onSuggest,
  onOpenTemplates
}: {
  onSuggest: (text: string) => void;
  onOpenTemplates: () => void;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-10 px-6 py-16 text-center">
      {/* Logo area */}
      <div className="flex flex-col items-center gap-3">
        <div className="relative flex size-14 items-center justify-center">
          <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-primary/20 to-primary/5 blur-xl" />
          <div className="relative flex size-14 items-center justify-center rounded-2xl border border-border/50 bg-background shadow-sm">
            <Terminal className="size-6 text-muted-foreground/70" />
          </div>
        </div>
        <div>
          <h2 className="text-xl font-semibold tracking-tight text-foreground">Let's build</h2>
          <p className="mt-0.5 text-sm text-muted-foreground/70">Claudex</p>
        </div>
      </div>

      {/* Suggestions */}
      <div className="w-full max-w-xl">
        <div className="mb-3 flex items-center justify-between">
          <button
            className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground/60 transition hover:bg-muted/40 hover:text-muted-foreground"
            onClick={onOpenTemplates}
            type="button"
          >
            <LayoutTemplate className="size-3" />
            Templates
          </button>
          <p className="text-xs text-muted-foreground/40">sugestões</p>
        </div>
        <div className="grid grid-cols-3 gap-2.5">
          {SUGGESTIONS.map((s) => (
            <button
              key={s.text}
              className="group flex flex-col gap-2.5 rounded-xl border border-border/50 bg-muted/10 p-3.5 text-left transition-all duration-150 hover:border-border/80 hover:bg-muted/25"
              onClick={() => onSuggest(s.text)}
              type="button"
            >
              <span className="text-lg">{s.emoji}</span>
              <span className="text-xs leading-relaxed text-foreground/70 group-hover:text-foreground/90">
                {s.text}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function SessionHeader({ session, threadTitle }: { session: AgentSession; threadTitle?: string }) {
  const onAbortSession = useChatStore((s) => s.onAbortSession);
  const isRunning = session.status === "running";
  const isAwaiting = session.status === "awaiting_approval";
  const isError = session.status === "error";

  return (
    <div className="flex items-center gap-2 border-b border-border/50 bg-muted/10 px-4 py-2">
      <span className="flex-1 truncate text-sm font-medium text-foreground/70">
        {session.title}
      </span>
      {isRunning && (
        <span className="flex items-center gap-1 text-[11px] text-blue-500">
          <Loader2 className="size-3 animate-spin" />
          em curso
        </span>
      )}
      {isAwaiting && (
        <span className="text-[11px] font-medium text-yellow-600 dark:text-yellow-400">
          aguarda aprovação
        </span>
      )}
      {isError && (
        <span className="flex items-center gap-1 text-[11px] text-destructive/80">
          <AlertCircle className="size-3" />
          erro
        </span>
      )}
      {(isRunning || isAwaiting) && session.requestId && (
        <Button
          className="h-6 text-[10px]"
          onClick={() => void onAbortSession(session.id)}
          size="sm"
          type="button"
          variant="ghost"
        >
          <Square className="size-3" />
          Parar
        </Button>
      )}
      <ExportButton session={session} threadTitle={threadTitle} />
    </div>
  );
}

export function SessionStack({
  thread,
  chatContainerMax,
  modelOptions,
  latestTerminalError,
  onInsertLatestTerminalError,
  setTerminalOpen
}: SessionStackProps) {
  const activeSessionId = useChatStore((s) => s.activeSessionId);
  const onApprove = useChatStore((s) => s.onApprove);
  const onDeny = useChatStore((s) => s.onDeny);
  const onAnswerQuestion = useChatStore((s) => s.onAnswerQuestion);

  const [input, setInput] = useState("");
  const [effort, setEffort] = useState("medium");
  const [isTemplatesOpen, setIsTemplatesOpen] = useState(false);

  // Active session for this thread
  const activeSession = thread.sessions.find((s) => s.id === activeSessionId) ?? null;

  // If active session belongs to a different thread, treat as null
  const currentSession = activeSession?.threadId === thread.id ? activeSession : null;

  const isBusy =
    currentSession?.status === "running" || currentSession?.status === "awaiting_approval";

  // targetSessionId: continue current session if it's idle/done/error
  const targetSessionId = currentSession && !isBusy ? currentSession.id : null;

  const hasSession = thread.sessions.length > 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <AuthExpiredBanner />
      <ThreadTemplates
        open={isTemplatesOpen}
        onOpenChange={setIsTemplatesOpen}
        onApply={(prompt) => setInput(prompt)}
      />
      {/* Main content area */}
      <div className="flex min-h-0 flex-1 flex-col overflow-auto">
        {!hasSession || !currentSession ? (
          <EmptyState
            onSuggest={(text) => setInput(text)}
            onOpenTemplates={() => setIsTemplatesOpen(true)}
          />
        ) : (
          <div className="flex min-h-0 flex-1 flex-col">
            <SessionHeader session={currentSession} threadTitle={thread.title} />
            <div className="min-h-0 flex-1 flex flex-col">
              <ChatMessages
                key={currentSession.id}
                chatContainerMax={chatContainerMax}
                session={currentSession}
                showCommits={false}
              />
            </div>
            {currentSession.pendingApproval && (
              <ToolApproval
                approval={currentSession.pendingApproval}
                onApprove={onApprove}
                onDeny={onDeny}
              />
            )}
            {currentSession.pendingQuestion && (
              <AskUserQuestion
                question={currentSession.pendingQuestion}
                onAnswer={onAnswerQuestion}
              />
            )}
          </div>
        )}
      </div>

      <PromptArea
        activeSession={currentSession}
        chatContainerMax={chatContainerMax}
        effort={effort}
        input={input}
        latestTerminalError={latestTerminalError}
        modelOptions={modelOptions}
        onInsertLatestTerminalError={() => onInsertLatestTerminalError(setInput)}
        setEffort={setEffort}
        setInput={setInput}
        setTerminalOpen={setTerminalOpen}
        targetSessionId={targetSessionId}
      />
    </div>
  );
}
