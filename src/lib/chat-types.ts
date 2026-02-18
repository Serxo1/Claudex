export type AuthMode = "api-key" | "claude-cli";
export type MessageRole = "user" | "assistant";
export type ChatProvider = "anthropic-api" | "claude-cli";
export type PermissionMode =
  | "acceptEdits"
  | "bypassPermissions"
  | "default"
  | "delegate"
  | "dontAsk"
  | "plan"
  | "api-key"
  | "unknown";

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  /** Mensagem interna (ex: auto-resume de team agents) — não renderizada no chat */
  hidden?: true;
}

export interface AppSettings {
  authMode: AuthMode;
  model: string;
  hasApiKey: boolean;
  hasClaudeCliSession?: boolean;
  preferredIde?: string;
  workspaceDirs?: string[];
}

export interface CliCheckResult {
  ok: boolean;
  message: string;
}

export interface ChatRequestPayload {
  messages: ChatMessage[];
  effort?: string;
  contextFiles?: ContextFileRef[];
  resumeSessionId?: string;
  workspaceDirs?: string[];
}

export interface ChatSendResult {
  content: string;
  provider: ChatProvider;
}

export interface ChatStreamStartResult {
  requestId: string;
  provider: ChatProvider;
}

export type ChatStreamEvent =
  | {
      requestId: string;
      type: "start";
      provider: ChatProvider;
    }
  | {
      requestId: string;
      type: "delta";
      delta: string;
      content: string;
      provider: ChatProvider;
    }
  | {
      requestId: string;
      type: "done";
      content: string;
      provider: ChatProvider;
      sessionCostUsd?: number | null;
      sessionId?: string;
    }
  | {
      requestId: string;
      type: "aborted";
      provider: ChatProvider;
    }
  | {
      requestId: string;
      type: "status";
      provider: ChatProvider;
      permissionMode: PermissionMode;
      context: {
        usedTokens: number;
        maxTokens: number;
        percent: number;
        inputTokens: number;
        outputTokens: number;
        cacheReadInputTokens: number;
        cacheCreationInputTokens: number;
      } | null;
    }
  | {
      requestId: string;
      type: "toolUse";
      provider: ChatProvider;
      toolUseId: string;
      name: string;
      input: Record<string, unknown> | null;
      timestamp: number;
    }
  | {
      requestId: string;
      type: "toolResult";
      provider: ChatProvider;
      toolUseId: string;
      isError: boolean;
      content: unknown;
      timestamp: number;
    }
  | {
      requestId: string;
      type: "slashCommands";
      provider: ChatProvider;
      commands: string[];
    }
  | {
      requestId: string;
      type: "error";
      error: string;
      provider: ChatProvider;
      errorSubtype?: string;
    }
  | {
      requestId: string;
      type: "limits";
      provider: ChatProvider;
      level: "info" | "warning";
      message: string;
      fiveHourPercent: number | null;
      weeklyPercent: number | null;
    }
  | {
      requestId: string;
      type: "compactBoundary";
      provider: ChatProvider;
    }
  | {
      requestId: string;
      type: "permissionDenials";
      provider: ChatProvider;
      denials: string[];
    }
  | {
      requestId: string;
      type: "approvalRequest";
      provider: ChatProvider;
      approvalId: string;
      toolName: string;
      input: Record<string, unknown>;
    }
  | {
      requestId: string;
      type: "askUser";
      provider: ChatProvider;
      approvalId: string;
      toolName: string;
      input: {
        questions: Array<{
          question: string;
          header: string;
          options: Array<{ label: string; description: string }>;
          multiSelect: boolean;
        }>;
      };
    }
  | {
      requestId: string;
      type: "sessionInfo";
      models: DynamicModel[];
      account: SessionAccountInfo;
    }
  | {
      requestId: string;
      type: "authStatus";
      isAuthenticating: boolean;
      error?: string;
    }
  | {
      requestId: string;
      type: "subagentStart";
      provider: ChatProvider;
      taskId: string;
      description: string;
      toolUseId?: string | null;
    }
  | {
      requestId: string;
      type: "subagentDone";
      provider: ChatProvider;
      taskId: string;
      status: "completed" | "failed" | "stopped";
      summary: string;
    };

export interface WorkspaceInfo {
  path: string;
  name: string;
  roots?: string[];
}

export interface WorkspaceFileTreeNode {
  path: string;
  name: string;
  type: "file" | "folder";
  children?: WorkspaceFileTreeNode[];
}

export interface WorkspaceFileTreeResult {
  rootPath: string;
  nodes: WorkspaceFileTreeNode[];
  truncated: boolean;
}

export interface WorkspaceRootTree {
  rootPath: string;
  rootName: string;
  nodes: WorkspaceFileTreeNode[];
  truncated: boolean;
}

export interface PickContextFileResult {
  canceled: boolean;
  absolutePath?: string;
  relativePath?: string;
  mediaType?: string;
  previewDataUrl?: string;
  isImage?: boolean;
}

export interface SavePastedImageResult {
  absolutePath: string;
  relativePath: string;
  mediaType: string;
  previewDataUrl?: string;
  isImage: boolean;
}

export interface WorkspaceReadFileResult {
  absolutePath: string;
  relativePath: string;
  content: string;
}

export interface WorkspaceWriteFileResult {
  ok: boolean;
  absolutePath: string;
  relativePath: string;
}

export interface ContextFileRef {
  absolutePath: string;
  relativePath: string;
  mediaType?: string;
  previewDataUrl?: string;
  isImage?: boolean;
}

export interface IdeCandidate {
  id: string;
  label: string;
  command?: string;
  icon?: string;
  iconDataUrl?: string;
}

export interface IdeInfo {
  available: IdeCandidate[];
  selectedId: string;
}

export interface GitSummary {
  isRepo: boolean;
  branch: string;
  branches: string[];
  additions: number;
  deletions: number;
}

export interface GitCommitFile {
  path: string;
  status: "added" | "modified" | "deleted" | "renamed";
  additions: number;
  deletions: number;
}

export interface GitCommitEntry {
  hash: string;
  shortHash: string;
  message: string;
  author: string;
  dateIso: string;
  files: GitCommitFile[];
}

export interface GitCommitResult {
  ok: boolean;
  output: string;
  summary: GitSummary;
}

export interface GitPrResult {
  ok: boolean;
  output: string;
}

export interface TerminalRunResult {
  command: string;
  code: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export type ThreadContextUsage = {
  usedTokens: number;
  maxTokens: number;
  percent: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
};

export type PendingApproval = {
  approvalId: string;
  toolName: string;
  input: Record<string, unknown>;
};

export type PendingQuestion = {
  approvalId: string;
  questions: Array<{
    question: string;
    header: string;
    options: Array<{ label: string; description: string }>;
    multiSelect: boolean;
  }>;
};

export type AgentSession = {
  id: string;
  threadId: string;
  title: string;
  messages: Array<ChatMessage & { attachments?: ContextAttachment[] }>;
  status: "idle" | "running" | "awaiting_approval" | "done" | "error";
  // Volatile — cleared on load from localStorage
  requestId?: string;
  pendingApproval?: PendingApproval | null;
  pendingQuestion?: PendingQuestion | null;
  isThinking?: boolean;
  runningStartedAt?: number;
  // Persisted
  sessionId?: string;
  contextUsage?: ThreadContextUsage | null;
  accumulatedCostUsd?: number;
  sessionCostUsd?: number | null;
  limitsWarning?: {
    level: "info" | "warning";
    message: string;
    fiveHourPercent: number | null;
    weeklyPercent: number | null;
  } | null;
  permissionMode?: PermissionMode;
  toolTimeline: ToolTimelineItem[];
  subagents: SubagentInfo[];
  reasoningText: string;
  compactCount: number;
  permissionDenials: string[];
  /** Team names created in this session via TeamCreate tool */
  teamNames?: string[];
  createdAt: number;
  updatedAt: number;
};

export type Thread = {
  id: string;
  title: string;
  updatedAt: number;
  workspaceDirs: string[];
  sessions: AgentSession[];
  status: "idle" | "running" | "needs_attention" | "done";
};

export type ContextAttachment = ContextFileRef;

export type ToolTimelineItem = {
  toolUseId: string;
  name: string;
  inputSummary: string;
  resultSummary: string;
  status: "pending" | "completed" | "error";
  startedAt: number;
  finishedAt: number | null;
};

export type SubagentInfo = {
  taskId: string;
  description: string;
  toolUseId?: string | null;
  /** "background" = spawned and running independently (team agent), no further tracking */
  status: "running" | "completed" | "failed" | "stopped" | "background";
  summary?: string;
  startedAt: number;
  finishedAt?: number;
};

// ---------------------------------------------------------------------------
// Team agent types (file-based coordination via ~/.claude/teams/ + ~/.claude/tasks/)
// ---------------------------------------------------------------------------

export type TeamMember = {
  agentId: string;
  name: string;
  agentType: string;
  model: string;
  joinedAt: number;
  tmuxPaneId?: string;
  cwd?: string;
};

export type TeamConfig = {
  name: string;
  description?: string;
  createdAt: number;
  leadAgentId: string;
  leadSessionId?: string;
  members: TeamMember[];
};

export type TeamTaskStatus = "pending" | "in_progress" | "completed" | "deleted";

export type TeamTask = {
  id: string;
  subject: string;
  description?: string;
  activeForm?: string;
  status: TeamTaskStatus;
  owner?: string;
  blocks?: string[];
  blockedBy?: string[];
};

export type TeamInboxMessage = {
  from: string;
  text: string;
  summary?: string;
  timestamp: string;
  read?: boolean;
};

export type TeamSnapshot = {
  teamName: string;
  config: TeamConfig | null;
  tasks: TeamTask[];
  inboxes: Record<string, TeamInboxMessage[]>;
};

export type EditorTab = {
  id: string;
  rootPath: string;
  relativePath: string;
  absolutePath: string;
  content: string;
  dirty: boolean;
  saving: boolean;
};

export type ModelOption = { value: string; label: string; releasedAt?: string };

export type DynamicModel = {
  value: string;
  displayName: string;
  description: string;
  supportsMaxEffort: boolean;
};

export type SessionAccountInfo = {
  email?: string;
  subscriptionType?: string;
  apiKeySource?: string;
};

export const MODEL_OPTIONS: ModelOption[] = [
  { value: "claude-sonnet-4-6", label: "Claude Sonnet 4.6", releasedAt: "2026-02-17" },
  { value: "claude-opus-4-6", label: "Claude Opus 4.6", releasedAt: "2026-02-05" },
  { value: "claude-haiku-4-5", label: "Claude Haiku 4.5", releasedAt: "2025-10-01" }
];

export const FALLBACK_SLASH_COMMANDS = [
  "compact",
  "context",
  "cost",
  "init",
  "review",
  "security-review",
  "insights",
  "debug"
];

export const SLASH_COMMAND_DESCRIPTIONS: Record<string, string> = {
  compact: "Compact the conversation to save context.",
  context: "Show current context and token usage details.",
  cost: "Show token and cost usage for the session.",
  init: "Initialize Claude project guidance in the repo.",
  review: "Run a code review workflow on current changes.",
  "security-review": "Run a focused security review.",
  insights: "Show session insights and suggestions.",
  debug: "Toggle or inspect debug behavior."
};

export const TERMINAL_REQUIRED_SLASH_COMMANDS = new Set([
  "review",
  "security-review",
  "pr-comments",
  "release-notes"
]);

export const THREADS_STORAGE_KEY = "claude-desktop-threads-v2";

// Derive thread status from its sessions
export function deriveThreadStatus(sessions: AgentSession[]): Thread["status"] {
  if (sessions.length === 0) return "idle";
  if (sessions.some((s) => s.status === "awaiting_approval")) return "needs_attention";
  if (sessions.some((s) => s.status === "running")) return "running";
  if (sessions.every((s) => s.status === "done" || s.status === "error" || s.status === "idle"))
    return sessions.some((s) => s.status === "done" || s.status === "error") ? "done" : "idle";
  return "idle";
}
