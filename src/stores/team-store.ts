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
  /** Teams explicitly triggered in this session (via TeamCreate tool) */
  sessionTeams: Set<string>;

  // Called when electron emits a full snapshot — only stored if team is in sessionTeams
  applySnapshot: (payload: TeamSnapshot & { teamName: string }) => void;

  // Register a new team for this session and load its snapshot
  trackTeam: (teamName: string) => void;

  // Subscribe to live events from electron
  initListener: () => () => void;
};

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useTeamStore = create<TeamStore>((set, get) => ({
  teams: {},
  sessionTeams: new Set(),

  applySnapshot: (payload) => {
    const { teamName } = payload;
    // Only show teams that were explicitly created/triggered in this session
    if (!get().sessionTeams.has(teamName)) return;
    const { config, tasks, inboxes } = payload;
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

  trackTeam: (teamName) => {
    if (!teamName) return;
    // Register as a session team so snapshots are accepted
    set((state) => ({ sessionTeams: new Set([...state.sessionTeams, teamName]) }));
    // Load initial snapshot and start watching
    void window.desktop.teams.refresh(teamName);
    void window.desktop.teams.getSnapshot(teamName).then((snap) => {
      if (snap) get().applySnapshot({ ...snap, teamName });
    });
  },

  initListener: () => {
    // Only listen for live snapshot events — no auto-loading of old teams
    const unsub = window.desktop.teams.onSnapshot((payload) => {
      get().applySnapshot(payload);
    });
    return unsub;
  }
}));
