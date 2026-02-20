import { create } from "zustand";
import type {
  ContextAttachment,
  EditorTab,
  IdeInfo,
  WorkspaceFileTreeNode,
  WorkspaceInfo,
  WorkspaceRootTree
} from "@/lib/chat-types";
import { shortFileLabel } from "@/lib/chat-utils";
import { useSettingsStore } from "@/stores/settings-store";
import { useGitStore } from "@/stores/git-store";

export type FileMentionItem = {
  key: string;
  label: string;
  search: string;
  rootPath: string;
  relativePath: string;
};

type WorkspaceState = {
  workspace: WorkspaceInfo | null;
  fileTrees: WorkspaceRootTree[];
  selectedTreePath: string;
  fileMentionIndex: FileMentionItem[];
  expandedFilePaths: Set<string>;
  editorTabs: EditorTab[];
  activeEditorTabId: string;
  editorAutoSave: boolean;
  contextFiles: ContextAttachment[];
  ideInfo: IdeInfo;

  setSelectedTreePath: (value: string) => void;
  setExpandedFilePaths: (value: Set<string>) => void;
  setActiveEditorTabId: (value: string) => void;
  setEditorAutoSave: (value: boolean | ((current: boolean) => boolean)) => void;
  setContextFiles: (
    value: ContextAttachment[] | ((current: ContextAttachment[]) => ContextAttachment[])
  ) => void;
  refreshWorkspace: () => Promise<void>;
  refreshWorkspaceFileTree: () => Promise<void>;
  refreshIdeInfo: () => Promise<void>;
  onAddContextFile: () => Promise<void>;
  onAddSelectedTreeFileToContext: () => Promise<void>;
  onAddTreePathToContext: (treePath: string) => Promise<void>;
  onRemoveTreePathFromContext: (treePath: string) => Promise<void>;
  onOpenEditorFile: (treePath: string) => Promise<void>;
  openFileByAbsolutePath: (absolutePath: string) => Promise<void>;
  onEditorTabContentChange: (tabId: string, content: string) => void;
  onSaveEditorTab: (tabId: string) => Promise<void>;
  onCloseEditorTab: (tabId: string) => void;
  onAddWorkspaceDir: () => Promise<void>;
  onRemoveWorkspaceDir: (rootPath: string) => Promise<void>;
  onCopyRelativePath: (relativePath: string) => void;
  onOpenIde: (ideId: string, workspaceDir?: string) => Promise<void>;
  activeEditorTab: EditorTab | null;
};

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  workspace: null,
  fileTrees: [],
  selectedTreePath: "",
  fileMentionIndex: [],
  expandedFilePaths: new Set(),
  editorTabs: [],
  activeEditorTabId: "",
  editorAutoSave: true,
  contextFiles: [],
  ideInfo: { available: [], selectedId: "cursor" },

  get activeEditorTab() {
    const { editorTabs, activeEditorTabId } = get();
    return editorTabs.find((tab) => tab.id === activeEditorTabId) || null;
  },

  setSelectedTreePath: (value) => set({ selectedTreePath: value }),
  setExpandedFilePaths: (value) => set({ expandedFilePaths: value }),
  setActiveEditorTabId: (value) => set({ activeEditorTabId: value }),
  setEditorAutoSave: (value) =>
    set((state) => ({
      editorAutoSave: typeof value === "function" ? value(state.editorAutoSave) : value
    })),
  setContextFiles: (value) =>
    set((state) => ({
      contextFiles: typeof value === "function" ? value(state.contextFiles) : value
    })),

  refreshWorkspace: async () => {
    const info = await window.desktop.workspace.getInfo();
    set({ workspace: info });
  },

  refreshWorkspaceFileTree: async () => {
    try {
      const roots = await window.desktop.workspace.getFileTrees({ maxDepth: 5, maxEntries: 2500 });
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

      const { selectedTreePath } = get();
      const updates: Partial<WorkspaceState> = {
        fileTrees: roots || [],
        fileMentionIndex: indexItems
      };

      if (!selectedTreePath && roots[0]?.nodes?.[0]) {
        const findFirstFile = (nodes: WorkspaceFileTreeNode[], rootPath: string): string => {
          for (const node of nodes) {
            if (node.type === "file") return `${rootPath}::${node.path}`;
            const nested = findFirstFile(node.children || [], rootPath);
            if (nested) return nested;
          }
          return "";
        };
        updates.selectedTreePath = findFirstFile(roots[0].nodes, roots[0].rootPath);
      }

      set(updates);
    } catch {
      set({ fileTrees: [] });
    }
  },

  refreshIdeInfo: async () => {
    try {
      const info = await window.desktop.ide.getInfo();
      set({ ideInfo: info });
    } catch {
      set({ ideInfo: { available: [], selectedId: "cursor" } });
    }
  },

  onAddContextFile: async () => {
    const setStatus = useSettingsStore.getState().setStatus;
    try {
      const result = await window.desktop.workspace.pickContextFile();
      if (result.canceled || !result.absolutePath || !result.relativePath) return;
      const { absolutePath, relativePath, mediaType, previewDataUrl, isImage } = result;
      set((state) => {
        if (state.contextFiles.some((file) => file.absolutePath === absolutePath)) return state;
        return {
          contextFiles: [
            ...state.contextFiles,
            { absolutePath, relativePath, mediaType, previewDataUrl, isImage }
          ]
        };
      });
      setStatus(`Context added: ${relativePath}`);
    } catch (error) {
      setStatus((error as Error).message);
    }
  },

  onAddSelectedTreeFileToContext: async () => {
    const setStatus = useSettingsStore.getState().setStatus;
    const { selectedTreePath } = get();
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
      if (result.canceled || !result.absolutePath || !result.relativePath) return;
      const { absolutePath, relativePath, mediaType, previewDataUrl, isImage } = result;
      set((state) => {
        if (state.contextFiles.some((file) => file.absolutePath === absolutePath)) return state;
        return {
          contextFiles: [
            ...state.contextFiles,
            { absolutePath, relativePath, mediaType, previewDataUrl, isImage }
          ]
        };
      });
      setStatus(`Context added: ${relativePath}`);
    } catch (error) {
      setStatus((error as Error).message);
    }
  },

  onAddTreePathToContext: async (treePath) => {
    const setStatus = useSettingsStore.getState().setStatus;
    const [rootPath, treeRelativePath] = treePath.split("::");
    if (!rootPath || !treeRelativePath) {
      setStatus("Invalid file selection.");
      return;
    }
    try {
      const result = await window.desktop.workspace.resolveContextFile(
        `${rootPath}/${treeRelativePath}`
      );
      if (result.canceled || !result.absolutePath || !result.relativePath) return;
      const { absolutePath, relativePath, mediaType, previewDataUrl, isImage } = result;
      set((state) => {
        if (state.contextFiles.some((file) => file.absolutePath === absolutePath)) return state;
        return {
          contextFiles: [
            ...state.contextFiles,
            { absolutePath, relativePath, mediaType, previewDataUrl, isImage }
          ]
        };
      });
      setStatus(`Context added: ${relativePath}`);
    } catch (error) {
      setStatus((error as Error).message);
    }
  },

  onRemoveTreePathFromContext: async (treePath) => {
    const setStatus = useSettingsStore.getState().setStatus;
    const [rootPath, treeRelativePath] = treePath.split("::");
    if (!rootPath || !treeRelativePath) {
      setStatus("Invalid file selection.");
      return;
    }
    try {
      const result = await window.desktop.workspace.resolveContextFile(
        `${rootPath}/${treeRelativePath}`
      );
      if (result.canceled || !result.absolutePath) return;
      set((state) => ({
        contextFiles: state.contextFiles.filter((file) => file.absolutePath !== result.absolutePath)
      }));
      setStatus(`Context removed: ${treeRelativePath}`);
    } catch (error) {
      setStatus((error as Error).message);
    }
  },

  onCopyRelativePath: (relativePath) => {
    if (!relativePath.trim()) return;
    const setStatus = useSettingsStore.getState().setStatus;
    void (async () => {
      try {
        await navigator.clipboard.writeText(relativePath);
        setStatus(`Copied path: ${relativePath}`);
      } catch {
        setStatus("Unable to copy path.");
      }
    })();
  },

  onOpenEditorFile: async (treePath) => {
    const setStatus = useSettingsStore.getState().setStatus;
    const { fileMentionIndex, editorTabs } = get();
    const match = fileMentionIndex.find((item) => item.key === treePath);
    if (!match) return;
    const existing = editorTabs.find((tab) => tab.id === treePath);
    if (existing) {
      set({ activeEditorTabId: existing.id });
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
      set((state) => ({
        editorTabs: [...state.editorTabs, nextTab],
        activeEditorTabId: nextTab.id
      }));
      setStatus(`Opened ${match.relativePath}`);
    } catch (error) {
      setStatus((error as Error).message);
    }
  },

  openFileByAbsolutePath: async (absolutePath) => {
    const setStatus = useSettingsStore.getState().setStatus;
    const tabId = `abs::${absolutePath}`;
    const { editorTabs } = get();
    const existing = editorTabs.find((tab) => tab.id === tabId);
    if (existing) {
      set({ activeEditorTabId: existing.id });
      return;
    }
    try {
      const result = await window.desktop.workspace.readFile(absolutePath);
      // Derive rootPath/relativePath from the absolute path
      const sep = absolutePath.includes("\\") ? "\\" : "/";
      const parts = absolutePath.replace(/\\/g, "/").split("/");
      const relativePath = parts[parts.length - 1];
      const rootPath = parts.slice(0, -1).join(sep);
      const nextTab: EditorTab = {
        id: tabId,
        rootPath,
        relativePath: result.relativePath || relativePath,
        absolutePath: result.absolutePath || absolutePath,
        content: result.content,
        dirty: false,
        saving: false
      };
      set((state) => ({
        editorTabs: [...state.editorTabs, nextTab],
        activeEditorTabId: nextTab.id
      }));
      setStatus(`Opened ${relativePath}`);
    } catch (error) {
      setStatus((error as Error).message);
    }
  },

  onEditorTabContentChange: (tabId, content) => {
    set((state) => ({
      editorTabs: state.editorTabs.map((tab) =>
        tab.id === tabId ? { ...tab, content, dirty: true } : tab
      )
    }));
  },

  onSaveEditorTab: async (tabId) => {
    const setStatus = useSettingsStore.getState().setStatus;
    const { editorTabs } = get();
    const tab = editorTabs.find((item) => item.id === tabId);
    if (!tab || !tab.dirty || tab.saving) return;

    set((state) => ({
      editorTabs: state.editorTabs.map((item) =>
        item.id === tabId ? { ...item, saving: true } : item
      )
    }));
    try {
      await window.desktop.workspace.writeFile({
        filePath: tab.absolutePath,
        content: tab.content
      });
      set((state) => ({
        editorTabs: state.editorTabs.map((item) =>
          item.id === tabId ? { ...item, dirty: false, saving: false } : item
        )
      }));
      setStatus(`Saved ${tab.relativePath}`);
      void Promise.all([
        get().refreshWorkspaceFileTree(),
        useGitStore.getState().refreshGitSummary()
      ]);
    } catch (error) {
      set((state) => ({
        editorTabs: state.editorTabs.map((item) =>
          item.id === tabId ? { ...item, saving: false } : item
        )
      }));
      setStatus((error as Error).message);
    }
  },

  onCloseEditorTab: (tabId) => {
    const { editorTabs } = get();
    const tab = editorTabs.find((item) => item.id === tabId);
    if (tab?.dirty) {
      const shouldClose = window.confirm(`Discard unsaved changes in ${tab.relativePath}?`);
      if (!shouldClose) return;
    }
    set((state) => {
      const remaining = state.editorTabs.filter((item) => item.id !== tabId);
      const nextActiveId =
        state.activeEditorTabId === tabId
          ? remaining[remaining.length - 1]?.id || ""
          : state.activeEditorTabId;
      return { editorTabs: remaining, activeEditorTabId: nextActiveId };
    });
  },

  onAddWorkspaceDir: async () => {
    const setStatus = useSettingsStore.getState().setStatus;
    try {
      const result = await window.desktop.workspace.addDirectory();
      if (!result.ok || !result.path) return;
      await Promise.all([
        useSettingsStore.getState().refreshSettings(),
        get().refreshWorkspaceFileTree()
      ]);
      setStatus(`Workspace folder added: ${result.path}`);
    } catch (error) {
      setStatus((error as Error).message);
    }
  },

  onRemoveWorkspaceDir: async (rootPath) => {
    const setStatus = useSettingsStore.getState().setStatus;
    const { workspace } = get();
    if (!rootPath.trim() || rootPath === workspace?.path) return;
    try {
      await window.desktop.workspace.removeDirectory(rootPath);
      await Promise.all([
        useSettingsStore.getState().refreshSettings(),
        get().refreshWorkspace(),
        get().refreshWorkspaceFileTree()
      ]);
      setStatus(`Workspace folder removed: ${rootPath}`);
    } catch (error) {
      setStatus((error as Error).message);
    }
  },

  onOpenIde: async (ideId, workspaceDir) => {
    const setStatus = useSettingsStore.getState().setStatus;
    try {
      await window.desktop.ide.openProject(workspaceDir ? { ideId, workspaceDir } : ideId);
      await Promise.all([get().refreshIdeInfo(), useSettingsStore.getState().refreshSettings()]);
      setStatus(`Opened workspace in ${ideId}.`);
    } catch (error) {
      setStatus((error as Error).message);
    }
  }
}));
