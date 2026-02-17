import { create } from "zustand";
import type { GitCommitEntry, GitSummary } from "@/lib/chat-types";
import { useSettingsStore } from "@/stores/settings-store";
import { useWorkspaceStore } from "@/stores/workspace-store";

type GitState = {
  gitSummary: GitSummary;
  isGitBusy: boolean;
  recentCommits: GitCommitEntry[];
  commitMessage: string;
  prBase: string;

  setCommitMessage: (value: string) => void;
  setPrBase: (value: string) => void;
  refreshGitSummary: () => Promise<void>;
  refreshRecentCommits: () => Promise<void>;
  onCheckoutBranch: (branchName: string) => Promise<void>;
  onInitRepo: () => Promise<void>;
  onCommit: () => Promise<void>;
  onCreatePr: () => Promise<void>;
};

export const useGitStore = create<GitState>((set, get) => ({
  gitSummary: { isRepo: false, branch: "", branches: [], additions: 0, deletions: 0 },
  isGitBusy: false,
  recentCommits: [],
  commitMessage: "",
  prBase: "",

  setCommitMessage: (value) => set({ commitMessage: value }),
  setPrBase: (value) => set({ prBase: value }),

  refreshGitSummary: async () => {
    try {
      const summary = await window.desktop.git.getSummary();
      set({ gitSummary: summary });
    } catch {
      set({ gitSummary: { isRepo: false, branch: "", branches: [], additions: 0, deletions: 0 } });
    }
  },

  refreshRecentCommits: async () => {
    try {
      const commits = await window.desktop.git.getRecentCommits(5);
      set({ recentCommits: commits });
    } catch {
      set({ recentCommits: [] });
    }
  },

  onCheckoutBranch: async (branchName) => {
    set({ isGitBusy: true });
    try {
      const summary = await window.desktop.git.checkoutBranch(branchName);
      set({ gitSummary: summary });
      useSettingsStore.getState().setStatus(`Switched to branch ${branchName}.`);
    } catch (error) {
      useSettingsStore.getState().setStatus((error as Error).message);
    } finally {
      set({ isGitBusy: false });
    }
  },

  onInitRepo: async () => {
    set({ isGitBusy: true });
    try {
      const summary = await window.desktop.git.initRepo();
      set({ gitSummary: summary });
      await get().refreshRecentCommits();
      useSettingsStore.getState().setStatus("Git repository initialized.");
    } catch (error) {
      useSettingsStore.getState().setStatus((error as Error).message);
    } finally {
      set({ isGitBusy: false });
    }
  },

  onCommit: async () => {
    const { commitMessage } = get();
    if (!commitMessage.trim()) {
      useSettingsStore.getState().setStatus("Commit message cannot be empty.");
      return;
    }
    set({ isGitBusy: true });
    try {
      const result = await window.desktop.git.commit(commitMessage.trim());
      set({ commitMessage: "", gitSummary: result.summary });
      await get().refreshRecentCommits();
      await useWorkspaceStore.getState().refreshWorkspaceFileTree();
      useSettingsStore.getState().setStatus(result.output || "Commit created.");
    } catch (error) {
      useSettingsStore.getState().setStatus((error as Error).message);
    } finally {
      set({ isGitBusy: false });
    }
  },

  onCreatePr: async () => {
    const { prBase } = get();
    set({ isGitBusy: true });
    try {
      const result = await window.desktop.git.createPr({ base: prBase.trim() || undefined });
      useSettingsStore.getState().setStatus(result.output || "Pull request created.");
    } catch (error) {
      useSettingsStore.getState().setStatus((error as Error).message);
    } finally {
      set({ isGitBusy: false });
    }
  }
}));
