import { useCallback, useState } from "react";

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

export function usePreview(): UsePreviewReturn {
  const [previewUrl, setPreviewUrl] = useState("http://localhost:5173");
  const [previewHistory, setPreviewHistory] = useState<string[]>(["http://localhost:5173"]);
  const [previewHistoryIndex, setPreviewHistoryIndex] = useState(0);
  const [previewKey, setPreviewKey] = useState(0);

  const onPreviewNavigate = useCallback(
    (url: string) => {
      const normalized = url.trim();
      if (!normalized) {
        return;
      }
      const safeUrl = /^https?:\/\//i.test(normalized) ? normalized : `http://${normalized}`;
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
