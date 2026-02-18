import { create } from "zustand";
import type { TeamConfig, TeamTask, TeamInboxMessage, TeamSnapshot } from "@/lib/chat-types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ActiveTeam = {
  teamName: string;
  config: TeamConfig | null;
  tasks: TeamTask[];
  /** agentName → messages[] */
  inboxes: Record<string, TeamInboxMessage[]>;
  /** Unix ms of last update */
  updatedAt: number;
};

type TeamStore = {
  teams: Record<string, ActiveTeam>;

  // Called when electron emits a full snapshot
  applySnapshot: (payload: TeamSnapshot & { teamName: string }) => void;

  // Load initial team list on startup
  loadInitial: () => Promise<void>;

  // Kick off a refresh for a specific team
  refresh: (teamName: string) => void;

  // Subscribe to live events from electron
  initListener: () => () => void;
};

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useTeamStore = create<TeamStore>((set, get) => ({
  teams: {},

  applySnapshot: (payload) => {
    const { teamName, config, tasks, inboxes } = payload;
    set((state) => ({
      teams: {
        ...state.teams,
        [teamName]: {
          teamName,
          config: config ?? null,
          tasks: tasks ?? [],
          inboxes: inboxes ?? {},
          updatedAt: Date.now()
        }
      }
    }));
  },

  loadInitial: async () => {
    try {
      const list = await window.desktop.teams.list();
      for (const { teamName } of list) {
        const snap = await window.desktop.teams.getSnapshot(teamName);
        if (snap) {
          get().applySnapshot({ ...snap, teamName });
        }
      }
    } catch {
      // Desktop API not ready yet
    }
  },

  refresh: (teamName) => {
    void window.desktop.teams.refresh(teamName);
  },

  initListener: () => {
    const unsub = window.desktop.teams.onSnapshot((payload) => {
      get().applySnapshot(payload);
    });
    // Load existing teams on init
    void get().loadInitial();
    return unsub;
  }
}));
