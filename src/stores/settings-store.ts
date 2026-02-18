import { create } from "zustand";
import type { AppSettings, AuthMode, DynamicModel, SessionAccountInfo } from "@/lib/chat-types";

const DYNAMIC_MODELS_KEY = "claude-desktop-dynamic-models-v1";
const KNOWN_MODEL_VALUES_KEY = "claude-desktop-known-model-values-v1";

function loadPersistedModels(): DynamicModel[] {
  try {
    const raw = localStorage.getItem(DYNAMIC_MODELS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (m): m is DynamicModel =>
        m &&
        typeof m.value === "string" &&
        typeof m.displayName === "string" &&
        typeof m.description === "string" &&
        typeof m.supportsMaxEffort === "boolean"
    );
  } catch {
    return [];
  }
}

function loadKnownModelValues(): string[] {
  try {
    const raw = localStorage.getItem(KNOWN_MODEL_VALUES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

type SettingsState = {
  settings: AppSettings | null;
  apiKeyDraft: string;
  isBusy: boolean;
  status: string;
  dynamicModels: DynamicModel[];
  accountInfo: SessionAccountInfo | null;
  authExpired: boolean;
  claudeCodeReady: boolean | null;
  // Known model values ever seen (persisted) — used for new-model detection
  knownModelValues: string[];
  // Models that appeared for the first time this session — triggers announcement
  newlyDiscoveredModels: DynamicModel[];

  setStatus: (value: string) => void;
  setApiKeyDraft: (value: string) => void;
  refreshSettings: () => Promise<void>;
  onAuthModeChange: (mode: AuthMode) => Promise<void>;
  onSetModel: (value: string) => Promise<void>;
  onSaveApiKey: () => Promise<void>;
  onClearApiKey: () => Promise<void>;
  onClearCliSession: () => Promise<void>;
  onTestCli: () => Promise<void>;
  setDynamicSessionInfo: (models: DynamicModel[], account: SessionAccountInfo) => void;
  setAuthExpired: (expired: boolean) => void;
  setClaudeCodeReady: (ready: boolean) => void;
  dismissNewModels: () => void;
};

const _persistedModels = loadPersistedModels();
const _knownModelValues = loadKnownModelValues();

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: null,
  apiKeyDraft: "",
  isBusy: false,
  status: "Loading settings...",
  dynamicModels: _persistedModels,
  accountInfo: null,
  authExpired: false,
  claudeCodeReady: null,
  knownModelValues: _knownModelValues,
  newlyDiscoveredModels: [],

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
      set({ status: result.message, claudeCodeReady: result.ok });
    } catch (error) {
      set({ status: (error as Error).message, claudeCodeReady: false });
    } finally {
      set({ isBusy: false });
    }
  },

  setDynamicSessionInfo: (models, account) => {
    const { knownModelValues } = get();
    const validModels = models.filter((m) => m.value);

    // Detect truly new models (never seen before)
    const knownSet = new Set(knownModelValues);
    const isFirstEverLoad = knownModelValues.length === 0;
    const newModels = isFirstEverLoad
      ? [] // first load — populate silently, no announcement
      : validModels.filter((m) => !knownSet.has(m.value));

    // Merge known values and persist
    const updatedKnown = [...new Set([...knownModelValues, ...validModels.map((m) => m.value)])];
    try {
      localStorage.setItem(DYNAMIC_MODELS_KEY, JSON.stringify(validModels));
      localStorage.setItem(KNOWN_MODEL_VALUES_KEY, JSON.stringify(updatedKnown));
    } catch {
      // Ignore storage errors
    }

    set({
      dynamicModels: validModels,
      accountInfo: account,
      knownModelValues: updatedKnown,
      newlyDiscoveredModels: newModels
    });
  },

  setAuthExpired: (expired) => set({ authExpired: expired }),
  setClaudeCodeReady: (ready) => set({ claudeCodeReady: ready }),
  dismissNewModels: () => set({ newlyDiscoveredModels: [] })
}));
