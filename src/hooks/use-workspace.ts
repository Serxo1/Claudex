import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  ContextAttachment,
  EditorTab,
  IdeInfo,
  WorkspaceFileTreeNode,
  WorkspaceInfo,
  WorkspaceRootTree
} from "@/lib/chat-types";
import { shortFileLabel } from "@/lib/chat-utils";

export type FileMentionItem = {
  key: string;
  label: string;
  search: string;
  rootPath: string;
  relativePath: string;
};

export interface UseWorkspaceReturn {
  workspace: WorkspaceInfo | null;
  fileTrees: WorkspaceRootTree[];
  selectedTreePath: string;
  setSelectedTreePath: (value: string) => void;
  fileMentionIndex: FileMentionItem[];
  expandedFilePaths: Set<string>;
  setExpandedFilePaths: (value: Set<string>) => void;
  editorTabs: EditorTab[];
  activeEditorTabId: string;
  setActiveEditorTabId: (value: string) => void;
  activeEditorTab: EditorTab | null;
  contextFiles: ContextAttachment[];
  setContextFiles: React.Dispatch<React.SetStateAction<ContextAttachment[]>>;
  ideInfo: IdeInfo;
  editorAutoSave: boolean;
  setEditorAutoSave: (value: boolean | ((current: boolean) => boolean)) => void;
  refreshWorkspace: () => Promise<void>;
  refreshWorkspaceFileTree: () => Promise<void>;
  refreshIdeInfo: () => Promise<void>;
  onAddContextFile: () => Promise<void>;
  onAddSelectedTreeFileToContext: () => Promise<void>;
  onAddTreePathToContext: (treePath: string) => Promise<void>;
  onRemoveTreePathFromContext: (treePath: string) => Promise<void>;
  onOpenEditorFile: (treePath: string) => Promise<void>;
  onEditorTabContentChange: (tabId: string, content: string) => void;
  onSaveEditorTab: (tabId: string) => Promise<void>;
  onCloseEditorTab: (tabId: string) => void;
  onAddWorkspaceDir: () => Promise<void>;
  onRemoveWorkspaceDir: (rootPath: string) => Promise<void>;
  onCopyRelativePath: (relativePath: string) => void;
  onOpenIde: (ideId: string) => Promise<void>;
}

export function useWorkspace(
  setStatus: (value: string) => void,
  refreshSettings: () => Promise<void>,
  refreshGitSummary: () => Promise<void>
): UseWorkspaceReturn {
  const [workspace, setWorkspace] = useState<WorkspaceInfo | null>(null);
  const [fileTrees, setFileTrees] = useState<WorkspaceRootTree[]>([]);
  const [selectedTreePath, setSelectedTreePath] = useState("");
  const [fileMentionIndex, setFileMentionIndex] = useState<FileMentionItem[]>([]);
  const [expandedFilePaths, setExpandedFilePaths] = useState<Set<string>>(new Set());
  const [editorTabs, setEditorTabs] = useState<EditorTab[]>([]);
  const [activeEditorTabId, setActiveEditorTabId] = useState("");
  const [editorAutoSave, setEditorAutoSave] = useState(true);
  const [contextFiles, setContextFiles] = useState<ContextAttachment[]>([]);
  const [ideInfo, setIdeInfo] = useState<IdeInfo>({ available: [], selectedId: "cursor" });

  const activeEditorTab = useMemo(
    () => editorTabs.find((tab) => tab.id === activeEditorTabId) || null,
    [editorTabs, activeEditorTabId]
  );

  const refreshWorkspace = useCallback(async () => {
    const info = await window.desktop.workspace.getInfo();
    setWorkspace(info);
  }, []);

  const refreshWorkspaceFileTree = useCallback(async () => {
    try {
      const roots = await window.desktop.workspace.getFileTrees({ maxDepth: 5, maxEntries: 2500 });
      setFileTrees(roots || []);
      const indexItems: FileMentionItem[] = [];
      const visit = (rootPath: string, nodes: WorkspaceFileTreeNode[]) => {
        for (const node of nodes) {
          if (node.type === "file") {
            const label = `${shortFileLabel(rootPath)} / ${node.path}`;
            indexItems.push({
              key: `${rootPath}::${node.path}`,
              label,
              search: label.toLowerCase(),
              rootPath,
              relativePath: node.path
            });
            continue;
          }
          visit(rootPath, node.children || []);
        }
      };
      for (const root of roots || []) {
        visit(root.rootPath, root.nodes || []);
      }
      setFileMentionIndex(indexItems);
      if (!selectedTreePath && roots[0]?.nodes?.[0]) {
        const findFirstFile = (nodes: WorkspaceFileTreeNode[], rootPath: string): string => {
          for (const node of nodes) {
            if (node.type === "file") {
              return `${rootPath}::${node.path}`;
            }
            const nested = findFirstFile(node.children || [], rootPath);
            if (nested) {
              return nested;
            }
          }
          return "";
        };
        setSelectedTreePath(findFirstFile(roots[0].nodes, roots[0].rootPath));
      }
    } catch {
      setFileTrees([]);
    }
  }, [selectedTreePath]);

  const refreshIdeInfo = useCallback(async () => {
    try {
      const info = await window.desktop.ide.getInfo();
      setIdeInfo(info);
    } catch {
      setIdeInfo({ available: [], selectedId: "cursor" });
    }
  }, []);

  const onAddContextFile = useCallback(async () => {
    try {
      const result = await window.desktop.workspace.pickContextFile();
      if (result.canceled || !result.absolutePath || !result.relativePath) {
        return;
      }
      const { absolutePath, relativePath, mediaType, previewDataUrl, isImage } = result;
      setContextFiles((current) => {
        if (current.some((file) => file.absolutePath === absolutePath)) {
          return current;
        }
        return [...current, { absolutePath, relativePath, mediaType, previewDataUrl, isImage }];
      });
      setStatus(`Context added: ${relativePath}`);
    } catch (error) {
      setStatus((error as Error).message);
    }
  }, [setStatus]);

  const onAddSelectedTreeFileToContext = useCallback(async () => {
    if (!selectedTreePath) {
      setStatus("Select a file from the tree first.");
      return;
    }
    const [rootPath, treeRelativePath] = selectedTreePath.split("::");
    if (!rootPath || !treeRelativePath) {
      setStatus("Invalid file selection.");
      return;
    }

    try {
      const result = await window.desktop.workspace.resolveContextFile(
        `${rootPath}/${treeRelativePath}`
      );
      if (result.canceled || !result.absolutePath || !result.relativePath) {
        return;
      }
      const { absolutePath, relativePath, mediaType, previewDataUrl, isImage } = result;
      setContextFiles((current) => {
        if (current.some((file) => file.absolutePath === absolutePath)) {
          return current;
        }
        return [...current, { absolutePath, relativePath, mediaType, previewDataUrl, isImage }];
      });
      setStatus(`Context added: ${relativePath}`);
    } catch (error) {
      setStatus((error as Error).message);
    }
  }, [selectedTreePath, setStatus]);

  const onAddTreePathToContext = useCallback(
    async (treePath: string) => {
      const [rootPath, treeRelativePath] = treePath.split("::");
      if (!rootPath || !treeRelativePath) {
        setStatus("Invalid file selection.");
        return;
      }

      try {
        const result = await window.desktop.workspace.resolveContextFile(
          `${rootPath}/${treeRelativePath}`
        );
        if (result.canceled || !result.absolutePath || !result.relativePath) {
          return;
        }
        const { absolutePath, relativePath, mediaType, previewDataUrl, isImage } = result;
        setContextFiles((current) => {
          if (current.some((file) => file.absolutePath === absolutePath)) {
            return current;
          }
          return [...current, { absolutePath, relativePath, mediaType, previewDataUrl, isImage }];
        });
        setStatus(`Context added: ${relativePath}`);
      } catch (error) {
        setStatus((error as Error).message);
      }
    },
    [setStatus]
  );

  const onRemoveTreePathFromContext = useCallback(
    async (treePath: string) => {
      const [rootPath, treeRelativePath] = treePath.split("::");
      if (!rootPath || !treeRelativePath) {
        setStatus("Invalid file selection.");
        return;
      }

      try {
        const result = await window.desktop.workspace.resolveContextFile(
          `${rootPath}/${treeRelativePath}`
        );
        if (result.canceled || !result.absolutePath) {
          return;
        }
        setContextFiles((current) =>
          current.filter((file) => file.absolutePath !== result.absolutePath)
        );
        setStatus(`Context removed: ${treeRelativePath}`);
      } catch (error) {
        setStatus((error as Error).message);
      }
    },
    [setStatus]
  );

  const onCopyRelativePath = useCallback(
    (relativePath: string) => {
      if (!relativePath.trim()) {
        return;
      }
      void (async () => {
        try {
          await navigator.clipboard.writeText(relativePath);
          setStatus(`Copied path: ${relativePath}`);
        } catch {
          setStatus("Unable to copy path.");
        }
      })();
    },
    [setStatus]
  );

  const onOpenEditorFile = useCallback(
    async (treePath: string) => {
      const match = fileMentionIndex.find((item) => item.key === treePath);
      if (!match) {
        return;
      }
      const existing = editorTabs.find((tab) => tab.id === treePath);
      if (existing) {
        setActiveEditorTabId(existing.id);
        return;
      }

      try {
        const result = await window.desktop.workspace.readFile(
          `${match.rootPath}/${match.relativePath}`
        );
        const nextTab: EditorTab = {
          id: treePath,
          rootPath: match.rootPath,
          relativePath: match.relativePath,
          absolutePath: result.absolutePath,
          content: result.content,
          dirty: false,
          saving: false
        };
        setEditorTabs((current) => [...current, nextTab]);
        setActiveEditorTabId(nextTab.id);
        setStatus(`Opened ${match.relativePath}`);
      } catch (error) {
        setStatus((error as Error).message);
      }
    },
    [editorTabs, fileMentionIndex, setStatus]
  );

  const onEditorTabContentChange = useCallback((tabId: string, content: string) => {
    setEditorTabs((current) =>
      current.map((tab) => (tab.id === tabId ? { ...tab, content, dirty: true } : tab))
    );
  }, []);

  const onSaveEditorTab = useCallback(
    async (tabId: string) => {
      const tab = editorTabs.find((item) => item.id === tabId);
      if (!tab || !tab.dirty || tab.saving) {
        return;
      }

      setEditorTabs((current) =>
        current.map((item) => (item.id === tabId ? { ...item, saving: true } : item))
      );
      try {
        await window.desktop.workspace.writeFile({
          filePath: tab.absolutePath,
          content: tab.content
        });
        setEditorTabs((current) =>
          current.map((item) =>
            item.id === tabId ? { ...item, dirty: false, saving: false } : item
          )
        );
        setStatus(`Saved ${tab.relativePath}`);
        void Promise.all([refreshWorkspaceFileTree(), refreshGitSummary()]);
      } catch (error) {
        setEditorTabs((current) =>
          current.map((item) => (item.id === tabId ? { ...item, saving: false } : item))
        );
        setStatus((error as Error).message);
      }
    },
    [editorTabs, refreshGitSummary, refreshWorkspaceFileTree, setStatus]
  );

  const onCloseEditorTab = useCallback(
    (tabId: string) => {
      const tab = editorTabs.find((item) => item.id === tabId);
      if (tab?.dirty) {
        const shouldClose = window.confirm(`Discard unsaved changes in ${tab.relativePath}?`);
        if (!shouldClose) {
          return;
        }
      }

      setEditorTabs((current) => {
        const remaining = current.filter((item) => item.id !== tabId);
        setActiveEditorTabId((currentActive) => {
          if (currentActive !== tabId) {
            return currentActive;
          }
          return remaining[remaining.length - 1]?.id || "";
        });
        return remaining;
      });
    },
    [editorTabs]
  );

  const onAddWorkspaceDir = useCallback(async () => {
    try {
      const result = await window.desktop.workspace.addDirectory();
      if (!result.ok || !result.path) {
        return;
      }
      await Promise.all([refreshSettings(), refreshWorkspaceFileTree()]);
      setStatus(`Workspace folder added: ${result.path}`);
    } catch (error) {
      setStatus((error as Error).message);
    }
  }, [refreshSettings, refreshWorkspaceFileTree, setStatus]);

  const onRemoveWorkspaceDir = useCallback(
    async (rootPath: string) => {
      if (!rootPath.trim() || rootPath === workspace?.path) {
        return;
      }
      try {
        await window.desktop.workspace.removeDirectory(rootPath);
        await Promise.all([refreshSettings(), refreshWorkspace(), refreshWorkspaceFileTree()]);
        setStatus(`Workspace folder removed: ${rootPath}`);
      } catch (error) {
        setStatus((error as Error).message);
      }
    },
    [refreshSettings, refreshWorkspace, refreshWorkspaceFileTree, setStatus, workspace?.path]
  );

  const onOpenIde = useCallback(
    async (ideId: string) => {
      try {
        await window.desktop.ide.openProject(ideId);
        await Promise.all([refreshIdeInfo(), refreshSettings()]);
        setStatus(`Opened workspace in ${ideId}.`);
      } catch (error) {
        setStatus((error as Error).message);
      }
    },
    [refreshIdeInfo, refreshSettings, setStatus]
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const isSave = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s";
      if (!isSave || !activeEditorTab) {
        return;
      }
      event.preventDefault();
      void onSaveEditorTab(activeEditorTab.id);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeEditorTab, onSaveEditorTab]);

  useEffect(() => {
    if (!editorAutoSave || !activeEditorTab || !activeEditorTab.dirty || activeEditorTab.saving) {
      return;
    }
    const timer = window.setTimeout(() => {
      void onSaveEditorTab(activeEditorTab.id);
    }, 900);
    return () => window.clearTimeout(timer);
  }, [
    editorAutoSave,
    activeEditorTab?.id,
    activeEditorTab?.content,
    activeEditorTab?.dirty,
    activeEditorTab?.saving,
    onSaveEditorTab
  ]);

  return {
    workspace,
    fileTrees,
    selectedTreePath,
    setSelectedTreePath,
    fileMentionIndex,
    expandedFilePaths,
    setExpandedFilePaths,
    editorTabs,
    activeEditorTabId,
    setActiveEditorTabId,
    activeEditorTab,
    contextFiles,
    setContextFiles,
    ideInfo,
    editorAutoSave,
    setEditorAutoSave,
    refreshWorkspace,
    refreshWorkspaceFileTree,
    refreshIdeInfo,
    onAddContextFile,
    onAddSelectedTreeFileToContext,
    onAddTreePathToContext,
    onRemoveTreePathFromContext,
    onOpenEditorFile,
    onEditorTabContentChange,
    onSaveEditorTab,
    onCloseEditorTab,
    onAddWorkspaceDir,
    onRemoveWorkspaceDir,
    onCopyRelativePath,
    onOpenIde
  };
}
