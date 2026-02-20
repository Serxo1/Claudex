import { create } from "zustand";
import type { GitChangedFile, GitCommitEntry, GitSummary } from "@/lib/chat-types";
import { useSettingsStore } from "@/stores/settings-store";
import { useWorkspaceStore } from "@/stores/workspace-store";

type GitState = {
  gitSummary: GitSummary;
  changedFiles: GitChangedFile[];
  isGitBusy: boolean;
  recentCommits: GitCommitEntry[];
  commitMessage: string;
  prBase: string;

  setCommitMessage: (value: string) => void;
  setPrBase: (value: string) => void;
  refreshGitSummary: (workspaceDir?: string) => Promise<void>;
  refreshRecentCommits: (workspaceDir?: string) => Promise<void>;
  onCheckoutBranch: (branchName: string, workspaceDir?: string) => Promise<void>;
  onInitRepo: (workspaceDir?: string) => Promise<void>;
  onCommit: (workspaceDir?: string) => Promise<void>;
  onPush: (workspaceDir?: string) => Promise<void>;
  onPull: (workspaceDir?: string) => Promise<void>;
  onFetch: (workspaceDir?: string) => Promise<void>;
  onCreatePr: (workspaceDir?: string) => Promise<void>;
};

export const useGitStore = create<GitState>((set, get) => ({
  gitSummary: { isRepo: false, branch: "", branches: [], additions: 0, deletions: 0 },
  changedFiles: [],
  isGitBusy: false,
  recentCommits: [],
  commitMessage: "",
  prBase: "",

  setCommitMessage: (value) => set({ commitMessage: value }),
  setPrBase: (value) => set({ prBase: value }),

  refreshGitSummary: async (workspaceDir) => {
    try {
      const [summary, files] = await Promise.all([
        window.desktop.git.getSummary(workspaceDir),
        window.desktop.git.getChangedFiles(null, workspaceDir).catch(() => [] as GitChangedFile[])
      ]);
      set({ gitSummary: summary, changedFiles: files });
    } catch {
      set({
        gitSummary: { isRepo: false, branch: "", branches: [], additions: 0, deletions: 0 },
        changedFiles: []
      });
    }
  },

  refreshRecentCommits: async (workspaceDir) => {
    try {
      const commits = await window.desktop.git.getRecentCommits(5, workspaceDir);
      set({ recentCommits: commits });
    } catch {
      set({ recentCommits: [] });
    }
  },

  onCheckoutBranch: async (branchName, workspaceDir) => {
    set({ isGitBusy: true });
    try {
      const summary = await window.desktop.git.checkoutBranch(branchName, workspaceDir);
      set({ gitSummary: summary });
      useSettingsStore.getState().setStatus(`Switched to branch ${branchName}.`);
    } catch (error) {
      useSettingsStore.getState().setStatus((error as Error).message);
    } finally {
      set({ isGitBusy: false });
    }
  },

  onInitRepo: async (workspaceDir) => {
    set({ isGitBusy: true });
    try {
      const summary = await window.desktop.git.initRepo(workspaceDir);
      set({ gitSummary: summary });
      await get().refreshRecentCommits(workspaceDir);
      useSettingsStore.getState().setStatus("Git repository initialized.");
    } catch (error) {
      useSettingsStore.getState().setStatus((error as Error).message);
    } finally {
      set({ isGitBusy: false });
    }
  },

  onCommit: async (workspaceDir) => {
    const { commitMessage } = get();
    if (!commitMessage.trim()) {
      useSettingsStore.getState().setStatus("Commit message cannot be empty.");
      return;
    }
    set({ isGitBusy: true });
    try {
      const result = await window.desktop.git.commit(commitMessage.trim(), workspaceDir);
      set({ commitMessage: "", gitSummary: result.summary, changedFiles: [] });
      await get().refreshRecentCommits(workspaceDir);
      await useWorkspaceStore.getState().refreshWorkspaceFileTree();
      useSettingsStore.getState().setStatus(result.output || "Commit created.");
    } catch (error) {
      useSettingsStore.getState().setStatus((error as Error).message);
    } finally {
      set({ isGitBusy: false });
    }
  },

  onPush: async (workspaceDir) => {
    set({ isGitBusy: true });
    try {
      const result = await window.desktop.git.push(workspaceDir);
      useSettingsStore.getState().setStatus(result.output || "Pushed.");
    } catch (error) {
      useSettingsStore.getState().setStatus((error as Error).message);
    } finally {
      set({ isGitBusy: false });
    }
  },

  onPull: async (workspaceDir) => {
    set({ isGitBusy: true });
    try {
      const result = await window.desktop.git.pull(workspaceDir);
      set({ gitSummary: result.summary });
      await get().refreshRecentCommits(workspaceDir);
      useSettingsStore.getState().setStatus(result.output || "Pulled.");
    } catch (error) {
      useSettingsStore.getState().setStatus((error as Error).message);
    } finally {
      set({ isGitBusy: false });
    }
  },

  onFetch: async (workspaceDir) => {
    set({ isGitBusy: true });
    try {
      const result = await window.desktop.git.fetch(workspaceDir);
      useSettingsStore.getState().setStatus(result.output || "Fetched.");
    } catch (error) {
      useSettingsStore.getState().setStatus((error as Error).message);
    } finally {
      set({ isGitBusy: false });
    }
  },

  onCreatePr: async (workspaceDir) => {
    const { prBase } = get();
    set({ isGitBusy: true });
    try {
      const result = await window.desktop.git.createPr({
        base: prBase.trim() || undefined,
        cwd: workspaceDir
      });
      useSettingsStore.getState().setStatus(result.output || "Pull request created.");
    } catch (error) {
      useSettingsStore.getState().setStatus((error as Error).message);
    } finally {
      set({ isGitBusy: false });
    }
  }
}));
