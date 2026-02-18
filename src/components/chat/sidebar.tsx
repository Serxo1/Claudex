import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ComponentProps,
  type ReactNode
} from "react";
import logo from "@/assets/logo.png";
import {
  Bot,
  FileText,
  FolderMinus,
  FolderPlus,
  Globe,
  PanelLeftClose,
  Plus,
  RefreshCcw,
  Workflow,
  X
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { FileTree, FileTreeFile, FileTreeFolder } from "@/components/ai-elements/file-tree";
import {
  Snippet,
  SnippetAddon,
  SnippetCopyButton,
  SnippetInput,
  SnippetText
} from "@/components/ai-elements/snippet";
import { AnimatedThemeToggler } from "@/components/ui/animated-theme-toggler";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { WorkspaceFileTreeNode } from "@/lib/chat-types";
import { useWorkspaceStore } from "@/stores/workspace-store";

const sidebarNav: Array<{ id: "chat" | "skills" | "preview"; label: string; icon: LucideIcon }> = [
  { id: "chat", label: "Chat", icon: Bot },
  { id: "skills", label: "Skills", icon: Workflow },
  { id: "preview", label: "Preview", icon: Globe }
];

export type SidebarProps = {
  isOpen: boolean;
  onToggle: () => void;
  activePage: "chat" | "preview";
  onSelectPage: (page: "chat" | "preview") => void;
  settingsMenu: React.ReactNode;
};

export function Sidebar({
  isOpen,
  onToggle,
  activePage,
  onSelectPage,
  settingsMenu
}: SidebarProps) {
  const fileTrees = useWorkspaceStore((s) => s.fileTrees);
  const primaryRootPath = useWorkspaceStore((s) => s.workspace?.path || "");
  const selectedTreePath = useWorkspaceStore((s) => s.selectedTreePath);
  const setSelectedTreePath = useWorkspaceStore((s) => s.setSelectedTreePath);
  const expandedFilePaths = useWorkspaceStore((s) => s.expandedFilePaths);
  const setExpandedFilePaths = useWorkspaceStore((s) => s.setExpandedFilePaths);
  const onAddSelectedFileToContext = useWorkspaceStore((s) => s.onAddSelectedTreeFileToContext);
  const onAddTreePathToContext = useWorkspaceStore((s) => s.onAddTreePathToContext);
  const onRemoveTreePathFromContext = useWorkspaceStore((s) => s.onRemoveTreePathFromContext);
  const onOpenTreePathInEditor = useWorkspaceStore((s) => s.onOpenEditorFile);
  const onCopyRelativePath = useWorkspaceStore((s) => s.onCopyRelativePath);
  const onAddWorkspaceDir = useWorkspaceStore((s) => s.onAddWorkspaceDir);
  const onRemoveWorkspaceDir = useWorkspaceStore((s) => s.onRemoveWorkspaceDir);
  const refreshWorkspaceFileTree = useWorkspaceStore((s) => s.refreshWorkspaceFileTree);

  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    treePath: string;
    relativePath: string;
  } | null>(null);

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("click", close);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [contextMenu]);

  const renderTreeNode = useCallback((node: WorkspaceFileTreeNode, rootPath: string): ReactNode => {
    const fullPath = `${rootPath}::${node.path}`;
    if (node.type === "folder") {
      return (
        <FileTreeFolder key={fullPath} name={node.name} path={fullPath}>
          {(node.children || []).map((child) => renderTreeNode(child, rootPath))}
        </FileTreeFolder>
      );
    }
    return (
      <FileTreeFile
        key={fullPath}
        name={node.name}
        onMouseDown={(event) => {
          if (event.button === 2) {
            event.preventDefault();
            event.stopPropagation();
          }
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setContextMenu({
            x: event.clientX,
            y: event.clientY,
            treePath: fullPath,
            relativePath: node.path
          });
        }}
        path={fullPath}
      />
    );
  }, []);

  const removableRoots = useMemo(
    () => fileTrees.filter((root) => root.rootPath !== primaryRootPath),
    [fileTrees, primaryRootPath]
  );

  const renderedFileTree = useMemo(
    () =>
      fileTrees.map((root) => (
        <FileTreeFolder
          key={`root::${root.rootPath}`}
          name={root.rootName}
          path={`root::${root.rootPath}`}
        >
          {root.nodes.map((node) => renderTreeNode(node, root.rootPath))}
        </FileTreeFolder>
      )),
    [fileTrees, renderTreeNode]
  );

  if (!isOpen) return null;

  const quickSnippet = selectedTreePath.includes("::")
    ? selectedTreePath.replace("::", "/")
    : primaryRootPath;

  return (
    <aside className="absolute inset-y-0 left-0 z-40 flex h-full w-[320px] shrink-0 flex-col border-r border-border/70 bg-background lg:static lg:z-auto">
      <div className="flex items-center justify-between px-5 pt-4">
        <div className="flex items-center gap-2">
          <img alt="Logo" className="size-6 rounded-lg" src={logo} />
          <span className="text-sm font-semibold tracking-tight text-foreground">Claudex</span>
        </div>
        <Button
          className="size-7 rounded-md text-muted-foreground hover:text-foreground"
          onClick={onToggle}
          size="icon-xs"
          variant="ghost"
        >
          <PanelLeftClose className="size-3.5" />
        </Button>
      </div>

      <nav className="mt-4 space-y-1 px-3">
        {sidebarNav.map((item) => {
          if (item.id === "skills") {
            const Icon = item.icon;
            return (
              <button
                className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground transition hover:bg-foreground/5 hover:text-foreground"
                key={item.id}
                type="button"
              >
                <Icon className="size-4" />
                <span>{item.label}</span>
              </button>
            );
          }
          const Icon = item.icon;
          return (
            <button
              className={cn(
                "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm transition",
                activePage === item.id
                  ? "bg-foreground/10 text-foreground"
                  : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
              )}
              key={item.id}
              onClick={() => onSelectPage(item.id as "chat" | "preview")}
              type="button"
            >
              <Icon className="size-4" />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>

      <div className="mt-6 flex min-h-0 flex-1 flex-col px-4">
        <div className="mb-2 flex items-center justify-between text-xs font-medium text-muted-foreground/80 uppercase tracking-[0.08em]">
          <span>Files</span>
          <div className="flex items-center gap-1">
            <Button
              className="size-6"
              onClick={() => void onAddWorkspaceDir()}
              size="icon-xs"
              type="button"
              variant="ghost"
            >
              <FolderPlus className="size-3.5" />
            </Button>
            <Button
              className="size-6"
              onClick={() => void refreshWorkspaceFileTree()}
              size="icon-xs"
              type="button"
              variant="ghost"
            >
              <RefreshCcw className="size-3.5" />
            </Button>
            <Button
              className="size-6"
              onClick={() => void onAddSelectedFileToContext()}
              size="icon-xs"
              type="button"
              variant="ghost"
            >
              <Plus className="size-3.5" />
            </Button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto rounded-xl border border-border/70 bg-background p-2">
          <div className="mb-2 space-y-1">
            {removableRoots.map((root) => (
              <div
                className="flex items-center justify-between rounded border border-border bg-muted/30 px-2 py-1"
                key={`root-pill-${root.rootPath}`}
              >
                <span className="truncate text-[11px] text-foreground/80">{root.rootName}</span>
                <button
                  className="inline-flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
                  onClick={() => void onRemoveWorkspaceDir(root.rootPath)}
                  title="Remove folder from workspace"
                  type="button"
                >
                  <FolderMinus className="size-3.5" />
                </button>
              </div>
            ))}
          </div>

          <FileTree
            className="border-0 bg-transparent text-xs"
            expanded={expandedFilePaths}
            onExpandedChange={setExpandedFilePaths}
            onSelect={
              ((value: string) => {
                setSelectedTreePath(value);
                void useWorkspaceStore.getState().onOpenEditorFile(value);
              }) as unknown as ComponentProps<typeof FileTree>["onSelect"]
            }
            selectedPath={selectedTreePath}
          >
            {renderedFileTree}
          </FileTree>
        </div>

        <div className="mt-3 space-y-2">
          <p className="text-[11px] text-muted-foreground uppercase tracking-[0.08em]">
            Quick snippet
          </p>
          <Snippet code={quickSnippet}>
            <SnippetAddon>
              <SnippetText>
                <FileText className="size-3.5" />
              </SnippetText>
            </SnippetAddon>
            <SnippetInput />
            <SnippetCopyButton />
          </Snippet>
        </div>
      </div>

      <div className="mt-auto flex items-center gap-1 border-t border-border/60 px-3 py-3">
        <div className="flex-1">{settingsMenu}</div>
        <AnimatedThemeToggler className="flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-accent hover:text-foreground [&>svg]:size-4" />
      </div>

      {contextMenu ? (
        <div
          className="fixed z-[100] min-w-40 rounded-md border border-border/70 bg-background p-1 shadow-xl"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button
            className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-foreground/90 hover:bg-foreground/10"
            onClick={() => {
              void onOpenTreePathInEditor(contextMenu.treePath);
              setContextMenu(null);
            }}
            type="button"
          >
            <FileText className="size-3.5" />
            Open in editor
          </button>
          <button
            className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-foreground/90 hover:bg-foreground/10"
            onClick={() => {
              onCopyRelativePath(contextMenu.relativePath);
              setContextMenu(null);
            }}
            type="button"
          >
            <FileText className="size-3.5" />
            Copy relative path
          </button>
          <button
            className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-foreground/90 hover:bg-foreground/10"
            onClick={() => {
              void onAddTreePathToContext(contextMenu.treePath);
              setContextMenu(null);
            }}
            type="button"
          >
            <Plus className="size-3.5" />
            Add to context
          </button>
          <button
            className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-foreground/90 hover:bg-foreground/10"
            onClick={() => {
              void onRemoveTreePathFromContext(contextMenu.treePath);
              setContextMenu(null);
            }}
            type="button"
          >
            <X className="size-3.5" />
            Remove from context
          </button>
        </div>
      ) : null}
    </aside>
  );
}
