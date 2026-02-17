import { create } from "zustand";
import type { AppSettings, AuthMode } from "@/lib/chat-types";

type SettingsState = {
  settings: AppSettings | null;
  apiKeyDraft: string;
  isBusy: boolean;
  status: string;

  setStatus: (value: string) => void;
  setApiKeyDraft: (value: string) => void;
  refreshSettings: () => Promise<void>;
  onAuthModeChange: (mode: AuthMode) => Promise<void>;
  onSetModel: (value: string) => Promise<void>;
  onSaveApiKey: () => Promise<void>;
  onClearApiKey: () => Promise<void>;
  onClearCliSession: () => Promise<void>;
  onTestCli: () => Promise<void>;
};

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: null,
  apiKeyDraft: "",
  isBusy: false,
  status: "Loading settings...",

  setStatus: (value) => set({ status: value }),
  setApiKeyDraft: (value) => set({ apiKeyDraft: value }),

  refreshSettings: async () => {
    const current = await window.desktop.settings.get();
    set({ settings: current });
  },

  onAuthModeChange: async (mode) => {
    set({ isBusy: true });
    try {
      const updated = await window.desktop.settings.setAuthMode(mode);
      set({ settings: updated, status: `Auth mode updated: ${mode}` });
    } catch (error) {
      set({ status: (error as Error).message });
    } finally {
      set({ isBusy: false });
    }
  },

  onSetModel: async (value) => {
    if (!value.trim()) return;
    set({ isBusy: true });
    try {
      const updated = await window.desktop.settings.setModel(value.trim());
      set({ settings: updated, status: `Model set to ${updated.model}.` });
    } catch (error) {
      set({ status: (error as Error).message });
    } finally {
      set({ isBusy: false });
    }
  },

  onSaveApiKey: async () => {
    const { apiKeyDraft } = get();
    set({ isBusy: true });
    try {
      const updated = await window.desktop.settings.setApiKey(apiKeyDraft);
      set({ settings: updated, apiKeyDraft: "", status: "API key saved." });
    } catch (error) {
      set({ status: (error as Error).message });
    } finally {
      set({ isBusy: false });
    }
  },

  onClearApiKey: async () => {
    set({ isBusy: true });
    try {
      const updated = await window.desktop.settings.clearApiKey();
      set({ settings: updated, apiKeyDraft: "", status: "API key cleared." });
    } catch (error) {
      set({ status: (error as Error).message });
    } finally {
      set({ isBusy: false });
    }
  },

  onClearCliSession: async () => {
    set({ isBusy: true });
    try {
      const updated = await window.desktop.settings.clearClaudeCliSession();
      set({ settings: updated, status: "Claude CLI session reset." });
    } catch (error) {
      set({ status: (error as Error).message });
    } finally {
      set({ isBusy: false });
    }
  },

  onTestCli: async () => {
    set({ isBusy: true });
    try {
      const result = await window.desktop.providers.testClaudeCli();
      set({ status: result.message });
    } catch (error) {
      set({ status: (error as Error).message });
    } finally {
      set({ isBusy: false });
    }
  }
}));
