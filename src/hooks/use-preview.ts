import { useCallback, useEffect, useRef, useState } from "react";

export interface UsePreviewReturn {
  previewUrl: string;
  previewHistory: string[];
  previewHistoryIndex: number;
  previewKey: number;
  onPreviewNavigate: (url: string) => void;
  onPreviewBack: () => void;
  onPreviewForward: () => void;
  onPreviewReload: () => void;
}

export function usePreview(
  threadId: string | null = null,
  initialUrl?: string,
  onUrlSave?: (url: string) => void
): UsePreviewReturn {
  const defaultUrl = initialUrl ?? "https://www.google.com";
  const [previewUrl, setPreviewUrl] = useState(defaultUrl);
  const [previewHistory, setPreviewHistory] = useState<string[]>([defaultUrl]);
  const [previewHistoryIndex, setPreviewHistoryIndex] = useState(0);
  const [previewKey, setPreviewKey] = useState(0);

  // Keep a ref to the latest onUrlSave to avoid stale closure in navigate callback
  const onUrlSaveRef = useRef(onUrlSave);
  useEffect(() => {
    onUrlSaveRef.current = onUrlSave;
  }, [onUrlSave]);

  // Reset preview state when the active thread changes
  const prevThreadIdRef = useRef(threadId);
  useEffect(() => {
    if (prevThreadIdRef.current === threadId) return;
    prevThreadIdRef.current = threadId;
    const url = initialUrl ?? "https://www.google.com";
    setPreviewUrl(url);
    setPreviewHistory([url]);
    setPreviewHistoryIndex(0);
    setPreviewKey((k) => k + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId]);

  const onPreviewNavigate = useCallback(
    (url: string) => {
      const normalized = url.trim();
      if (!normalized) {
        return;
      }
      const safeUrl = /^https?:\/\//i.test(normalized) ? normalized : `http://${normalized}`;
      onUrlSaveRef.current?.(safeUrl);
      setPreviewHistory((current) => {
        const nextHistory = [...current.slice(0, previewHistoryIndex + 1), safeUrl];
        setPreviewHistoryIndex(nextHistory.length - 1);
        return nextHistory;
      });
      setPreviewUrl(safeUrl);
    },
    [previewHistoryIndex]
  );

  const onPreviewBack = useCallback(() => {
    if (previewHistoryIndex <= 0) {
      return;
    }
    const nextIndex = previewHistoryIndex - 1;
    setPreviewHistoryIndex(nextIndex);
    setPreviewUrl(previewHistory[nextIndex]);
  }, [previewHistory, previewHistoryIndex]);

  const onPreviewForward = useCallback(() => {
    if (previewHistoryIndex >= previewHistory.length - 1) {
      return;
    }
    const nextIndex = previewHistoryIndex + 1;
    setPreviewHistoryIndex(nextIndex);
    setPreviewUrl(previewHistory[nextIndex]);
  }, [previewHistory, previewHistoryIndex]);

  const onPreviewReload = useCallback(() => {
    setPreviewKey((current) => current + 1);
  }, []);

  return {
    previewUrl,
    previewHistory,
    previewHistoryIndex,
    previewKey,
    onPreviewNavigate,
    onPreviewBack,
    onPreviewForward,
    onPreviewReload
  };
}
