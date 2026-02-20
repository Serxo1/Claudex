import { useRef, useState, useEffect, useMemo } from "react";
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  FolderCode,
  GitBranch,
  GitCommitHorizontal,
  GitPullRequest,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
  TerminalSquare
} from "lucide-react";
import type { GitChangedFile } from "@/lib/chat-types";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { ideChipLabel } from "@/lib/chat-utils";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useGitStore } from "@/stores/git-store";
import { useChatStore } from "@/stores/chat-store";

function IdeIcon({ id, iconDataUrl }: { id?: string; iconDataUrl?: string }) {
  if (iconDataUrl) {
    return (
      <span className="inline-flex size-5 items-center justify-center rounded-md border border-border bg-muted">
        <img alt={id} className="size-3.5 object-contain" src={iconDataUrl} />
      </span>
    );
  }
  return (
    <span className="inline-flex size-5 items-center justify-center rounded-md border border-border bg-muted text-[10px] font-semibold">
      {ideChipLabel(id)}
    </span>
  );
}

export type HeaderBarProps = {
  isSidebarOpen: boolean;
  onToggleSidebar: () => void;
  onOpenSidebar: () => void;
  terminalOpen?: boolean;
  onToggleTerminal: () => void;
};

export function HeaderBar({
  isSidebarOpen,
  onToggleSidebar,
  onOpenSidebar,
  onToggleTerminal
}: HeaderBarProps) {
  const ideInfo = useWorkspaceStore((s) => s.ideInfo);
  const onOpenIde = useWorkspaceStore((s) => s.onOpenIde);
  const workspacePath = useWorkspaceStore((s) => s.workspace?.path || "");

  const gitSummary = useGitStore((s) => s.gitSummary);
  const isGitBusy = useGitStore((s) => s.isGitBusy);
  const onInitRepo = useGitStore((s) => s.onInitRepo);

  const threadTitle = useChatStore((s) => {
    const thread = s.threads.find((t) => t.id === s.activeThreadId) ?? s.threads[0] ?? null;
    return thread?.title ?? "New thread";
  });

  const threadWorkspaceDir = useChatStore((s) => {
    const thread = s.threads.find((t) => t.id === s.activeThreadId) ?? s.threads[0] ?? null;
    return thread?.workspaceDirs[0] ?? "";
  });

  const sessionTotal = useChatStore((s) => {
    const thread = s.threads.find((t) => t.id === s.activeThreadId) ?? s.threads[0] ?? null;
    return thread?.sessions.length ?? 0;
  });

  const sessionRunning = useChatStore((s) => {
    const thread = s.threads.find((t) => t.id === s.activeThreadId) ?? s.threads[0] ?? null;
    return (
      thread?.sessions.filter(
        (sess) => sess.status === "running" || sess.status === "awaiting_approval"
      ).length ?? 0
    );
  });

  return (
    <header className="flex h-14 items-center justify-between border-b border-border/70 px-4 lg:px-6">
      <div className="flex min-w-0 items-center gap-2">
        <Button
          className="lg:hidden"
          onClick={onToggleSidebar}
          size="icon-sm"
          type="button"
          variant="ghost"
        >
          {isSidebarOpen ? (
            <PanelLeftClose className="size-4" />
          ) : (
            <PanelLeftOpen className="size-4" />
          )}
        </Button>
        {!isSidebarOpen ? (
          <Button
            className="hidden text-muted-foreground lg:inline-flex"
            onClick={onOpenSidebar}
            size="icon-sm"
            type="button"
            variant="ghost"
          >
            <PanelLeftOpen className="size-4" />
          </Button>
        ) : null}
        <h1 className="truncate text-sm font-semibold lg:text-base">{threadTitle}</h1>
        <span className="hidden text-sm text-muted-foreground lg:inline">
          {sessionTotal} {sessionTotal === 1 ? "sessão" : "sessões"}
        </span>
        {sessionRunning > 0 ? (
          <span className="hidden items-center gap-1 rounded-full border border-blue-500/30 bg-blue-500/10 px-2 py-0.5 text-[10px] text-blue-600 dark:text-blue-400 lg:inline-flex">
            <span className="size-1.5 rounded-full bg-blue-500 animate-pulse" />
            {sessionRunning} {sessionRunning === 1 ? "activa" : "activas"}
          </span>
        ) : null}
      </div>

      <div className="flex items-center gap-2">
        {/* IDE Dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              className="rounded-full border-border/70 bg-muted/30"
              size="sm"
              type="button"
              variant="outline"
            >
              <IdeIcon
                id={ideInfo.selectedId}
                iconDataUrl={
                  ideInfo.available.find((i) => i.id === ideInfo.selectedId)?.iconDataUrl
                }
              />
              Open
              <ChevronDown className="size-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            className="w-60 rounded-xl border-border/70 bg-background text-foreground"
          >
            <DropdownMenuLabel className="text-xs tracking-wide text-muted-foreground uppercase">
              Open Project In
            </DropdownMenuLabel>
            <DropdownMenuSeparator className="bg-foreground/10" />
            {ideInfo.available.length === 0 ? (
              <DropdownMenuItem
                className="text-muted-foreground"
                onSelect={(event) => event.preventDefault()}
              >
                No IDE found on PATH
              </DropdownMenuItem>
            ) : (
              ideInfo.available.map((ide) => (
                <DropdownMenuItem
                  key={ide.id}
                  onSelect={() => void onOpenIde(ide.id, threadWorkspaceDir || undefined)}
                >
                  <IdeIcon id={ide.id} iconDataUrl={ide.iconDataUrl} />
                  <span>{ide.label}</span>
                  {ide.id === ideInfo.selectedId ? (
                    <span className="ml-auto text-xs text-muted-foreground">selected</span>
                  ) : null}
                </DropdownMenuItem>
              ))
            )}
            <DropdownMenuSeparator className="bg-foreground/10" />
            <DropdownMenuItem onSelect={(event) => event.preventDefault()}>
              <FolderCode className="size-4" />
              <span className="truncate text-xs text-muted-foreground">
                {threadWorkspaceDir || workspacePath || "Workspace"}
              </span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Source Control panel OR Init button */}
        {gitSummary.isRepo ? (
          <SourceControlPanel workspaceDir={threadWorkspaceDir} />
        ) : (
          <Button
            className="rounded-full border-border/70 bg-muted/30"
            disabled={isGitBusy}
            onClick={() => void onInitRepo(threadWorkspaceDir || undefined)}
            size="sm"
            type="button"
            variant="outline"
          >
            <GitBranch className="size-3.5" />
            Init
          </Button>
        )}

        {/* Terminal */}
        <Button
          className="rounded-full border-border/70 bg-muted/30"
          onClick={onToggleTerminal}
          size="sm"
          type="button"
          variant="outline"
        >
          <TerminalSquare className="size-3.5" />
        </Button>

        {/* Diff indicator (static) */}
        <span className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-muted/30 px-2.5 py-1 text-xs tabular-nums">
          <span className="text-emerald-500">+{gitSummary.isRepo ? gitSummary.additions : 0}</span>
          <span className="text-red-500">-{gitSummary.isRepo ? gitSummary.deletions : 0}</span>
        </span>
      </div>
    </header>
  );
}

/* ─── Source Control Panel ─────────────────────────────────────────────────── */

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  added: { label: "A", color: "text-emerald-400", bg: "bg-emerald-500/15" },
  modified: { label: "M", color: "text-amber-400", bg: "bg-amber-500/15" },
  deleted: { label: "D", color: "text-red-400", bg: "bg-red-500/15" },
  renamed: { label: "R", color: "text-blue-400", bg: "bg-blue-500/15" },
  untracked: { label: "U", color: "text-emerald-400", bg: "bg-emerald-500/15" }
};

function fileNameAndDir(filePath: string) {
  const sep = filePath.lastIndexOf("/");
  if (sep === -1) return { name: filePath, dir: "" };
  return { name: filePath.slice(sep + 1), dir: filePath.slice(0, sep) };
}

function FileRow({ file, onOpen }: { file: GitChangedFile; onOpen: (path: string) => void }) {
  const cfg = STATUS_CONFIG[file.status] ?? STATUS_CONFIG.modified;
  const { name, dir } = fileNameAndDir(file.path);
  return (
    <button
      type="button"
      onClick={() => onOpen(file.path)}
      className="group flex w-full items-center gap-2 px-3 py-1 text-left transition-colors hover:bg-muted/40"
    >
      <span
        className={`inline-flex size-4 shrink-0 items-center justify-center rounded text-[10px] font-bold ${cfg.color} ${cfg.bg}`}
      >
        {cfg.label}
      </span>
      <span className="min-w-0 flex-1 truncate text-[12px]">
        <span className="font-medium text-foreground/90">{name}</span>
        {dir && <span className="ml-1.5 text-muted-foreground/50">{dir}</span>}
      </span>
    </button>
  );
}

function FileGroup({
  title,
  files,
  onOpen,
  defaultOpen = true
}: {
  title: string;
  files: GitChangedFile[];
  onOpen: (path: string) => void;
  defaultOpen?: boolean;
}) {
  const [expanded, setExpanded] = useState(defaultOpen);
  if (files.length === 0) return null;
  return (
    <div>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-1 px-3 py-1.5 text-[11px] font-semibold text-muted-foreground/70 hover:text-muted-foreground transition-colors"
      >
        <ChevronRight className={`size-3 transition-transform ${expanded ? "rotate-90" : ""}`} />
        <span>{title}</span>
        <span className="ml-auto rounded-full bg-muted/50 px-1.5 py-0.5 text-[10px] font-medium tabular-nums">
          {files.length}
        </span>
      </button>
      {expanded &&
        files.map((f) => <FileRow key={`${f.path}-${f.staged}`} file={f} onOpen={onOpen} />)}
    </div>
  );
}

function SourceControlPanel({ workspaceDir }: { workspaceDir: string }) {
  const changedFiles = useGitStore((s) => s.changedFiles);
  const gitSummary = useGitStore((s) => s.gitSummary);
  const commitMessage = useGitStore((s) => s.commitMessage);
  const setCommitMessage = useGitStore((s) => s.setCommitMessage);
  const onCommit = useGitStore((s) => s.onCommit);
  const onPush = useGitStore((s) => s.onPush);
  const onPull = useGitStore((s) => s.onPull);
  const onFetch = useGitStore((s) => s.onFetch);
  const onCreatePr = useGitStore((s) => s.onCreatePr);
  const onCheckoutBranch = useGitStore((s) => s.onCheckoutBranch);
  const isGitBusy = useGitStore((s) => s.isGitBusy);
  const prBase = useGitStore((s) => s.prBase);
  const setPrBase = useGitStore((s) => s.setPrBase);

  const [open, setOpen] = useState(false);
  const [branchesOpen, setBranchesOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const { staged, changes, untracked } = useMemo(() => {
    const s: GitChangedFile[] = [];
    const c: GitChangedFile[] = [];
    const u: GitChangedFile[] = [];
    for (const f of changedFiles) {
      if (f.status === "untracked") u.push(f);
      else if (f.staged) s.push(f);
      else c.push(f);
    }
    return { staged: s, changes: c, untracked: u };
  }, [changedFiles]);

  const handleOpenFile = (relativePath: string) => {
    if (!workspaceDir) return;
    const ws = useWorkspaceStore.getState();
    const match = ws.fileMentionIndex.find((item) => item.relativePath === relativePath);
    if (match) {
      void ws.onOpenEditorFile(match.key);
    } else {
      const sep = workspaceDir.includes("\\") ? "\\" : "/";
      void ws.openFileByAbsolutePath(`${workspaceDir}${sep}${relativePath.replace(/\//g, sep)}`);
    }
  };

  const totalFiles = changedFiles.length;
  const cwd = workspaceDir || undefined;

  return (
    <div ref={ref} className="relative">
      {/* Trigger: branch button */}
      <Button
        className="rounded-full border-border/70 bg-muted/30"
        onClick={() => setOpen((v) => !v)}
        size="sm"
        type="button"
        variant="outline"
      >
        <GitBranch className="size-3.5" />
        {gitSummary.branch || "main"}
        {totalFiles > 0 && (
          <span className="flex size-4 items-center justify-center rounded-full bg-blue-500/20 text-[10px] font-bold text-blue-400 tabular-nums">
            {totalFiles > 99 ? "99" : totalFiles}
          </span>
        )}
        <ChevronDown className={`size-3.5 transition-transform ${open ? "rotate-180" : ""}`} />
      </Button>

      {/* Panel */}
      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 w-[340px] overflow-hidden rounded-xl border border-border/60 bg-background shadow-xl">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-border/40 px-3 py-2">
            <div className="flex items-center gap-2">
              <GitBranch className="size-3.5 text-muted-foreground/60" />
              <span className="text-xs font-semibold">Source Control</span>
            </div>
            <div className="flex items-center gap-0.5">
              <button
                type="button"
                onClick={() => void onFetch(cwd)}
                disabled={isGitBusy}
                className="rounded p-1 text-muted-foreground/50 hover:bg-muted/40 hover:text-muted-foreground transition-colors disabled:opacity-40"
                title="Fetch"
              >
                <RefreshCw className={`size-3 ${isGitBusy ? "animate-spin" : ""}`} />
              </button>
              <button
                type="button"
                onClick={() => void onPull(cwd)}
                disabled={isGitBusy}
                className="rounded p-1 text-muted-foreground/50 hover:bg-muted/40 hover:text-muted-foreground transition-colors disabled:opacity-40"
                title="Pull"
              >
                <ArrowDown className="size-3" />
              </button>
              <button
                type="button"
                onClick={() => void onPush(cwd)}
                disabled={isGitBusy}
                className="rounded p-1 text-muted-foreground/50 hover:bg-muted/40 hover:text-muted-foreground transition-colors disabled:opacity-40"
                title="Push"
              >
                <ArrowUp className="size-3" />
              </button>
            </div>
          </div>

          {/* Branch selector */}
          <div className="border-b border-border/30">
            <button
              type="button"
              onClick={() => setBranchesOpen((v) => !v)}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-[11px] hover:bg-muted/30 transition-colors"
            >
              <GitBranch className="size-3 text-muted-foreground/40" />
              <span className="font-medium text-foreground/80">{gitSummary.branch}</span>
              <ChevronRight
                className={`ml-auto size-3 text-muted-foreground/40 transition-transform ${branchesOpen ? "rotate-90" : ""}`}
              />
            </button>
            {branchesOpen && (
              <div className="max-h-32 overflow-y-auto border-t border-border/20 py-0.5">
                {gitSummary.branches.map((branch) => (
                  <button
                    key={branch}
                    type="button"
                    onClick={() => {
                      void onCheckoutBranch(branch, cwd);
                      setBranchesOpen(false);
                    }}
                    className="flex w-full items-center gap-2 px-6 py-1 text-[11px] text-muted-foreground hover:bg-muted/30 hover:text-foreground transition-colors"
                  >
                    <span className="truncate">{branch}</span>
                    {branch === gitSummary.branch && (
                      <span className="ml-auto shrink-0 text-[10px] text-blue-400">current</span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Commit area */}
          <div className="border-b border-border/30 p-2" onClick={(e) => e.stopPropagation()}>
            <input
              className="mb-1.5 h-7 w-full rounded-md border border-border/50 bg-muted/20 px-2 text-[11px] placeholder:text-muted-foreground/40 focus:border-blue-500/50 focus:outline-none"
              onChange={(e) => setCommitMessage(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && commitMessage.trim()) {
                  e.preventDefault();
                  void onCommit(cwd);
                }
              }}
              placeholder="Commit message"
              value={commitMessage}
            />
            <div className="flex gap-1.5">
              <Button
                className="h-7 flex-1 text-[11px]"
                disabled={isGitBusy || !commitMessage.trim()}
                onClick={() => void onCommit(cwd)}
                size="sm"
                type="button"
              >
                <GitCommitHorizontal className="size-3" />
                Commit All
              </Button>
              <Button
                className="h-7 text-[11px]"
                disabled={isGitBusy}
                onClick={() => void onCreatePr(cwd)}
                size="sm"
                type="button"
                variant="outline"
              >
                <GitPullRequest className="size-3" />
                PR
              </Button>
            </div>
            <input
              className="mt-1.5 h-7 w-full rounded-md border border-border/50 bg-muted/20 px-2 text-[11px] placeholder:text-muted-foreground/40 focus:border-blue-500/50 focus:outline-none"
              onChange={(e) => setPrBase(e.target.value)}
              placeholder="Base branch for PR (optional)"
              value={prBase}
            />
          </div>

          {/* File groups */}
          {totalFiles === 0 ? (
            <div className="px-3 py-6 text-center text-[11px] text-muted-foreground/50">
              Nenhuma alteração detectada
            </div>
          ) : (
            <div className="max-h-72 overflow-y-auto py-1">
              <FileGroup title="Staged Changes" files={staged} onOpen={handleOpenFile} />
              <FileGroup title="Changes" files={changes} onOpen={handleOpenFile} />
              <FileGroup title="Untracked Files" files={untracked} onOpen={handleOpenFile} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
