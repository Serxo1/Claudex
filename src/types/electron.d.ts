import type {
  AppSettings,
  AuthMode,
  ChatMessage,
  ChatRequestPayload,
  ChatStreamEvent,
  ChatStreamStartResult,
  ChatSendResult,
  CliCheckResult,
  GitChangedFile,
  GitCommitResult,
  GitCommitEntry,
  GitPrResult,
  GitSummary,
  IdeInfo,
  PickContextFileResult,
  SavePastedImageResult,
  WorkspaceReadFileResult,
  WorkspaceFileTreeResult,
  WorkspaceRootTree,
  WorkspaceWriteFileResult,
  WorkspaceInfo,
  TeamMember,
  TeamConfig,
  TeamTask,
  TeamInboxMessage,
  TeamSnapshot,
  TodoItem
} from "@/lib/chat-types";

declare global {
  interface Window {
    desktop: {
      settings: {
        get: () => Promise<AppSettings>;
        setAuthMode: (authMode: AuthMode) => Promise<AppSettings>;
        setModel: (model: string) => Promise<AppSettings>;
        setPreferredIde: (ideId: string) => Promise<AppSettings>;
        setApiKey: (apiKey: string) => Promise<AppSettings>;
        clearApiKey: () => Promise<AppSettings>;
        clearClaudeCliSession: () => Promise<AppSettings>;
      };
      providers: {
        testClaudeCli: () => Promise<CliCheckResult>;
      };
      workspace: {
        getInfo: () => Promise<WorkspaceInfo>;
        getFileTree: (payload?: {
          maxDepth?: number;
          maxEntries?: number;
        }) => Promise<WorkspaceFileTreeResult>;
        getFileTrees: (payload?: {
          maxDepth?: number;
          maxEntries?: number;
        }) => Promise<WorkspaceRootTree[]>;
        addDirectory: () => Promise<{ ok: boolean; path?: string; dirs: string[] }>;
        pickDirectory: () => Promise<{ ok: boolean; path: string | null }>;
        removeDirectory: (dirPath: string) => Promise<{ ok: boolean; dirs: string[] }>;
        pickContextFile: () => Promise<PickContextFileResult>;
        resolveContextFile: (relativePath: string) => Promise<PickContextFileResult>;
        readFile: (filePath: string) => Promise<WorkspaceReadFileResult>;
        writeFile: (payload: {
          filePath: string;
          content: string;
        }) => Promise<WorkspaceWriteFileResult>;
        savePastedImage: (payload: {
          dataUrl: string;
          filename?: string;
        }) => Promise<SavePastedImageResult>;
        getSkills: () => Promise<{
          ok: boolean;
          skills: Array<{
            name: string;
            description: string;
            type: "command" | "skill";
            body: string;
          }>;
        }>;
      };
      ide: {
        getInfo: () => Promise<IdeInfo>;
        openProject: (
          payload: string | { ideId: string; workspaceDir?: string }
        ) => Promise<{ ok: boolean; ideId: string }>;
      };
      git: {
        getSummary: (cwd?: string) => Promise<GitSummary>;
        getRecentCommits: (limit?: number, cwd?: string) => Promise<GitCommitEntry[]>;
        initRepo: (cwd?: string) => Promise<GitSummary>;
        checkoutBranch: (branchName: string, cwd?: string) => Promise<GitSummary>;
        commit: (message: string, cwd?: string) => Promise<GitCommitResult>;
        push: (cwd?: string) => Promise<{ ok: boolean; output: string }>;
        pull: (cwd?: string) => Promise<{ ok: boolean; output: string; summary: GitSummary }>;
        fetch: (cwd?: string) => Promise<{ ok: boolean; output: string }>;
        createPr: (payload?: {
          title?: string;
          body?: string;
          base?: string;
          cwd?: string;
        }) => Promise<GitPrResult>;
        getHeadHash: (cwd?: string) => Promise<string | null>;
        getChangedFiles: (since?: string | null, cwd?: string) => Promise<GitChangedFile[]>;
      };
      terminal: {
        createSession: (payload?: {
          cols?: number;
          rows?: number;
          cwd?: string;
        }) => Promise<{ sessionId: string; cwd: string; shell: string }>;
        write: (payload: { sessionId: string; data: string }) => Promise<{ ok: boolean }>;
        resize: (payload: {
          sessionId: string;
          cols: number;
          rows: number;
        }) => Promise<{ ok: boolean }>;
        close: (sessionId: string) => Promise<{ ok: boolean }>;
        openExternal: () => Promise<{ ok: boolean }>;
        onData: (callback: (payload: { sessionId: string; data: string }) => void) => () => void;
        onExit: (
          callback: (payload: { sessionId: string; exitCode: number; signal: number }) => void
        ) => () => void;
      };
      chat: {
        send: (payload: ChatRequestPayload | ChatMessage[]) => Promise<ChatSendResult>;
        startStream: (
          payload: ChatRequestPayload | ChatMessage[]
        ) => Promise<ChatStreamStartResult>;
        abortStream: (requestId: string) => Promise<{ ok: boolean }>;
        respondToApproval: (approvalId: string, response: unknown) => Promise<{ ok: boolean }>;
        onStreamEvent: (callback: (event: ChatStreamEvent) => void) => () => void;
      };
      app: {
        notify: (payload: { title: string; body?: string }) => Promise<{ ok: boolean }>;
        checkForUpdates: () => Promise<{ ok: boolean; error?: string }>;
        installUpdate: () => Promise<{ ok: boolean }>;
        onUpdateAvailable: (
          callback: (payload: { version: string; releaseNotes: string | null }) => void
        ) => () => void;
        onUpdateDownloaded: (callback: (payload: { version: string }) => void) => () => void;
      };
      mcp: {
        getServers: () => Promise<
          Array<{
            name: string;
            type: "mcp" | "plugin";
            enabled: boolean;
            status: "connected" | "error" | "disconnected";
            command?: string;
            description?: string;
          }>
        >;
        openConfigFile: () => Promise<{ ok: boolean; error?: string }>;
      };
      debug: {
        openDevTools: () => Promise<void>;
      };
      teams: {
        list: () => Promise<Array<{ teamName: string; config: TeamConfig }>>;
        getSnapshot: (teamName: string) => Promise<TeamSnapshot | null>;
        refresh: (teamName: string) => Promise<void>;
        onSnapshot: (
          callback: (payload: TeamSnapshot & { teamName: string }) => void
        ) => () => void;
        onAllDone: (callback: (payload: TeamSnapshot & { teamName: string }) => void) => () => void;
        respondToPermission: (payload: {
          teamName: string;
          agentId: string;
          requestId: string;
          behavior: "allow" | "deny";
        }) => Promise<{ ok: boolean; error?: string }>;
        sendMessage: (payload: {
          teamName: string;
          agentName: string;
          content: string;
        }) => Promise<{ ok: boolean; error?: string }>;
        deleteTeam: (teamName: string) => Promise<{ ok: boolean; error?: string }>;
      };
      todos: {
        read: (sessionId: string) => Promise<TodoItem[]>;
        watch: (sessionId: string) => Promise<void>;
        unwatch: (sessionId: string) => Promise<void>;
        onUpdate: (
          callback: (payload: { sessionId: string; todos: TodoItem[] }) => void
        ) => () => void;
      };
    };
  }
}

export {};
