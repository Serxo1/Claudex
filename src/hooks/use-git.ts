import { useCallback, useState } from "react";
import type { GitCommitEntry, GitSummary } from "@/lib/chat-types";

export interface UseGitReturn {
  gitSummary: GitSummary;
  isGitBusy: boolean;
  recentCommits: GitCommitEntry[];
  commitMessage: string;
  setCommitMessage: (value: string) => void;
  prBase: string;
  setPrBase: (value: string) => void;
  refreshGitSummary: () => Promise<void>;
  refreshRecentCommits: () => Promise<void>;
  onCheckoutBranch: (branchName: string) => Promise<void>;
  onInitRepo: () => Promise<void>;
  onCommit: () => Promise<void>;
  onCreatePr: () => Promise<void>;
}

export function useGit(
  setStatus: (value: string) => void,
  refreshWorkspaceFileTree: () => Promise<void>
): UseGitReturn {
  const [gitSummary, setGitSummary] = useState<GitSummary>({
    isRepo: false,
    branch: "",
    branches: [],
    additions: 0,
    deletions: 0
  });
  const [isGitBusy, setIsGitBusy] = useState(false);
  const [recentCommits, setRecentCommits] = useState<GitCommitEntry[]>([]);
  const [commitMessage, setCommitMessage] = useState("");
  const [prBase, setPrBase] = useState("");

  const refreshGitSummary = useCallback(async () => {
    try {
      const summary = await window.desktop.git.getSummary();
      setGitSummary(summary);
    } catch {
      setGitSummary({ isRepo: false, branch: "", branches: [], additions: 0, deletions: 0 });
    }
  }, []);

  const refreshRecentCommits = useCallback(async () => {
    try {
      const commits = await window.desktop.git.getRecentCommits(5);
      setRecentCommits(commits);
    } catch {
      setRecentCommits([]);
    }
  }, []);

  const onCheckoutBranch = useCallback(
    async (branchName: string) => {
      setIsGitBusy(true);
      try {
        const summary = await window.desktop.git.checkoutBranch(branchName);
        setGitSummary(summary);
        setStatus(`Switched to branch ${branchName}.`);
      } catch (error) {
        setStatus((error as Error).message);
      } finally {
        setIsGitBusy(false);
      }
    },
    [setStatus]
  );

  const onInitRepo = useCallback(async () => {
    setIsGitBusy(true);
    try {
      const summary = await window.desktop.git.initRepo();
      setGitSummary(summary);
      await refreshRecentCommits();
      setStatus("Git repository initialized.");
    } catch (error) {
      setStatus((error as Error).message);
    } finally {
      setIsGitBusy(false);
    }
  }, [refreshRecentCommits, setStatus]);

  const onCommit = useCallback(async () => {
    if (!commitMessage.trim()) {
      setStatus("Commit message cannot be empty.");
      return;
    }

    setIsGitBusy(true);
    try {
      const result = await window.desktop.git.commit(commitMessage.trim());
      setCommitMessage("");
      setGitSummary(result.summary);
      await refreshRecentCommits();
      await refreshWorkspaceFileTree();
      setStatus(result.output || "Commit created.");
    } catch (error) {
      setStatus((error as Error).message);
    } finally {
      setIsGitBusy(false);
    }
  }, [commitMessage, refreshRecentCommits, refreshWorkspaceFileTree, setStatus]);

  const onCreatePr = useCallback(async () => {
    setIsGitBusy(true);
    try {
      const result = await window.desktop.git.createPr({ base: prBase.trim() || undefined });
      setStatus(result.output || "Pull request created.");
    } catch (error) {
      setStatus((error as Error).message);
    } finally {
      setIsGitBusy(false);
    }
  }, [prBase, setStatus]);

  return {
    gitSummary,
    isGitBusy,
    recentCommits,
    commitMessage,
    setCommitMessage,
    prBase,
    setPrBase,
    refreshGitSummary,
    refreshRecentCommits,
    onCheckoutBranch,
    onInitRepo,
    onCommit,
    onCreatePr
  };
}
