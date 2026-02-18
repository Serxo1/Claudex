import {
  ChevronDown,
  FolderCode,
  GitBranch,
  GitCommitHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  TerminalSquare
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { ideChipLabel } from "@/lib/chat-utils";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useGitStore } from "@/stores/git-store";
import { useChatStore } from "@/stores/chat-store";

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
  const commitMessage = useGitStore((s) => s.commitMessage);
  const setCommitMessage = useGitStore((s) => s.setCommitMessage);
  const onCommit = useGitStore((s) => s.onCommit);
  const onCreatePr = useGitStore((s) => s.onCreatePr);
  const prBase = useGitStore((s) => s.prBase);
  const setPrBase = useGitStore((s) => s.setPrBase);
  const onCheckoutBranch = useGitStore((s) => s.onCheckoutBranch);
  const onInitRepo = useGitStore((s) => s.onInitRepo);

  const threadTitle = useChatStore((s) => {
    const thread = s.threads.find((t) => t.id === s.activeThreadId) ?? s.threads[0] ?? null;
    return thread?.title ?? "New thread";
  });
  const messageCount = useChatStore((s) => {
    const thread = s.threads.find((t) => t.id === s.activeThreadId) ?? s.threads[0] ?? null;
    return thread?.messages.length ?? 0;
  });
  const activeThreadSessionId = useChatStore((s) => {
    const thread = s.threads.find((t) => t.id === s.activeThreadId) ?? s.threads[0] ?? null;
    return thread?.sessionId ?? null;
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
          {messageCount} messages
        </span>
        {activeThreadSessionId ? (
          <span className="hidden items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] text-emerald-600 dark:text-emerald-400 lg:inline-flex">
            <span className="size-1.5 rounded-full bg-emerald-500" />
            Sessão activa
          </span>
        ) : null}
      </div>

      <div className="flex items-center gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              className="rounded-full border-border/70 bg-muted/30"
              size="sm"
              type="button"
              variant="outline"
            >
              <span className="inline-flex size-5 items-center justify-center rounded-md border border-border bg-muted text-[10px] font-semibold">
                {ideChipLabel(ideInfo.selectedId)}
              </span>
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
                <DropdownMenuItem key={ide.id} onSelect={() => void onOpenIde(ide.id)}>
                  <span className="inline-flex size-5 items-center justify-center rounded-md border border-border bg-muted text-[10px] font-semibold">
                    {ideChipLabel(ide.id)}
                  </span>
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
                {workspacePath || "Workspace"}
              </span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {gitSummary.isRepo ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                className="rounded-full border-border/70 bg-muted/30"
                size="sm"
                type="button"
                variant="outline"
              >
                <GitBranch className="size-3.5" />
                {gitSummary.branch || "Commit"}
                <ChevronDown className="size-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="w-80 rounded-xl border-border/70 bg-background text-foreground"
            >
              <DropdownMenuLabel className="flex items-center gap-2">
                <GitBranch className="size-4" />
                Branches
              </DropdownMenuLabel>
              <DropdownMenuSeparator className="bg-foreground/10" />

              <div className="max-h-36 overflow-auto p-1">
                {gitSummary.branches.map((branch) => (
                  <DropdownMenuItem key={branch} onSelect={() => void onCheckoutBranch(branch)}>
                    <span>{branch}</span>
                    {branch === gitSummary.branch ? (
                      <span className="ml-auto text-xs text-muted-foreground">current</span>
                    ) : null}
                  </DropdownMenuItem>
                ))}
              </div>

              <DropdownMenuSeparator className="bg-foreground/10" />

              <div className="space-y-2 p-2" onClick={(event) => event.stopPropagation()}>
                <Input
                  className="h-8 border-border/70 bg-muted/30 text-xs"
                  onChange={(event) => setCommitMessage(event.target.value)}
                  placeholder="Commit message"
                  value={commitMessage}
                />
                <div className="flex gap-2">
                  <Button
                    className="h-8 flex-1 text-xs"
                    disabled={isGitBusy}
                    onClick={() => void onCommit()}
                    type="button"
                  >
                    <GitCommitHorizontal className="size-3.5" />
                    Commit all
                  </Button>
                  <Button
                    className="h-8 flex-1 text-xs"
                    disabled={isGitBusy}
                    onClick={() => void onCreatePr()}
                    type="button"
                    variant="outline"
                  >
                    Create PR
                  </Button>
                </div>
                <Input
                  className="h-8 border-border/70 bg-muted/30 text-xs"
                  onChange={(event) => setPrBase(event.target.value)}
                  placeholder="Base branch for PR (optional)"
                  value={prBase}
                />
              </div>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <Button
            className="rounded-full border-border/70 bg-muted/30"
            disabled={isGitBusy}
            onClick={() => void onInitRepo()}
            size="sm"
            type="button"
            variant="outline"
          >
            <GitBranch className="size-3.5" />
            Init
          </Button>
        )}

        <Button
          className="rounded-full border-border/70 bg-muted/30"
          onClick={onToggleTerminal}
          size="sm"
          type="button"
          variant="outline"
        >
          <TerminalSquare className="size-3.5" />
        </Button>
        <span className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-muted/30 px-2.5 py-1 text-xs">
          <span className="text-emerald-500">+{gitSummary.isRepo ? gitSummary.additions : 0}</span>
          <span className="text-red-500">-{gitSummary.isRepo ? gitSummary.deletions : 0}</span>
        </span>
      </div>
    </header>
  );
}
