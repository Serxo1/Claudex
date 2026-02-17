import { useCallback, useState } from "react";
import type { AppSettings, AuthMode } from "@/lib/chat-types";

export interface UseSettingsReturn {
  settings: AppSettings | null;
  apiKeyDraft: string;
  isBusy: boolean;
  setApiKeyDraft: (value: string) => void;
  refreshSettings: () => Promise<void>;
  onAuthModeChange: (mode: AuthMode) => Promise<void>;
  onSetModel: (value: string) => Promise<void>;
  onSaveApiKey: () => Promise<void>;
  onClearApiKey: () => Promise<void>;
  onClearCliSession: () => Promise<void>;
  onTestCli: () => Promise<void>;
}

export function useSettings(setStatus: (value: string) => void): UseSettingsReturn {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [apiKeyDraft, setApiKeyDraft] = useState("");
  const [isBusy, setIsBusy] = useState(false);

  const refreshSettings = useCallback(async () => {
    const current = await window.desktop.settings.get();
    setSettings(current);
  }, []);

  const onAuthModeChange = useCallback(
    async (mode: AuthMode) => {
      setIsBusy(true);
      try {
        const updated = await window.desktop.settings.setAuthMode(mode);
        setSettings(updated);
        setStatus(`Auth mode updated: ${mode}`);
      } catch (error) {
        setStatus((error as Error).message);
      } finally {
        setIsBusy(false);
      }
    },
    [setStatus]
  );

  const onSetModel = useCallback(
    async (value: string) => {
      if (!value.trim()) {
        return;
      }
      setIsBusy(true);
      try {
        const updated = await window.desktop.settings.setModel(value.trim());
        setSettings(updated);
        setStatus(`Model set to ${updated.model}.`);
      } catch (error) {
        setStatus((error as Error).message);
      } finally {
        setIsBusy(false);
      }
    },
    [setStatus]
  );

  const onSaveApiKey = useCallback(async () => {
    setIsBusy(true);
    try {
      const updated = await window.desktop.settings.setApiKey(apiKeyDraft);
      setSettings(updated);
      setApiKeyDraft("");
      setStatus("API key saved.");
    } catch (error) {
      setStatus((error as Error).message);
    } finally {
      setIsBusy(false);
    }
  }, [apiKeyDraft, setStatus]);

  const onClearApiKey = useCallback(async () => {
    setIsBusy(true);
    try {
      const updated = await window.desktop.settings.clearApiKey();
      setSettings(updated);
      setApiKeyDraft("");
      setStatus("API key cleared.");
    } catch (error) {
      setStatus((error as Error).message);
    } finally {
      setIsBusy(false);
    }
  }, [setStatus]);

  const onClearCliSession = useCallback(async () => {
    setIsBusy(true);
    try {
      const updated = await window.desktop.settings.clearClaudeCliSession();
      setSettings(updated);
      setStatus("Claude CLI session reset.");
    } catch (error) {
      setStatus((error as Error).message);
    } finally {
      setIsBusy(false);
    }
  }, [setStatus]);

  const onTestCli = useCallback(async () => {
    setIsBusy(true);
    try {
      const result = await window.desktop.providers.testClaudeCli();
      setStatus(result.message);
    } catch (error) {
      setStatus((error as Error).message);
    } finally {
      setIsBusy(false);
    }
  }, [setStatus]);

  return {
    settings,
    apiKeyDraft,
    isBusy,
    setApiKeyDraft,
    refreshSettings,
    onAuthModeChange,
    onSetModel,
    onSaveApiKey,
    onClearApiKey,
    onClearCliSession,
    onTestCli
  };
}
