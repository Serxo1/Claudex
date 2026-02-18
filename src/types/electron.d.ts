import type {
  AppSettings,
  AuthMode,
  ChatMessage,
  ChatRequestPayload,
  ChatStreamEvent,
  ChatStreamStartResult,
  ChatSendResult,
  CliCheckResult,
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
  WorkspaceInfo
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
        getSummary: () => Promise<GitSummary>;
        getRecentCommits: (limit?: number) => Promise<GitCommitEntry[]>;
        initRepo: () => Promise<GitSummary>;
        checkoutBranch: (branchName: string) => Promise<GitSummary>;
        commit: (message: string) => Promise<GitCommitResult>;
        createPr: (payload?: {
          title?: string;
          body?: string;
          base?: string;
        }) => Promise<GitPrResult>;
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
    };
  }
}

export {};
