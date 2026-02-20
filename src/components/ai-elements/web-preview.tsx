"use client";

import type { ComponentProps, ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { Camera, ChevronDownIcon, X } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  useEffect,
  useRef
} from "react";

// ---------------------------------------------------------------------------
// Console line type
// ---------------------------------------------------------------------------

export type ConsoleLine = {
  level: "log" | "warn" | "error";
  message: string;
  timestamp: number;
};

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

export interface WebPreviewContextValue {
  url: string;
  setUrl: (url: string) => void;
  consoleOpen: boolean;
  setConsoleOpen: (open: boolean) => void;
  logs: ConsoleLine[];
  addLog: (log: ConsoleLine) => void;
  clearLogs: () => void;
  isLoading: boolean;
  setIsLoading: (value: boolean) => void;
  screenshotFn: () => Promise<string | null>;
  setScreenshotFn: (fn: (() => Promise<string | null>) | null) => void;
}

const WebPreviewContext = createContext<WebPreviewContextValue | null>(null);

const useWebPreview = () => {
  const context = useContext(WebPreviewContext);
  if (!context) {
    throw new Error("WebPreview components must be used within a WebPreview");
  }
  return context;
};

export type WebPreviewProps = ComponentProps<"div"> & {
  defaultUrl?: string;
  onUrlChange?: (url: string) => void;
};

export const WebPreview = ({
  className,
  children,
  defaultUrl = "",
  onUrlChange,
  ...props
}: WebPreviewProps) => {
  const [url, setUrl] = useState(defaultUrl);
  const [consoleOpen, setConsoleOpen] = useState(false);
  const [logs, setLogs] = useState<ConsoleLine[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  // Screenshot fn stored in a ref to avoid React function-in-state issues
  const screenshotFnRef = useRef<(() => Promise<string | null>) | null>(null);

  const handleUrlChange = useCallback(
    (newUrl: string) => {
      setUrl(newUrl);
      onUrlChange?.(newUrl);
    },
    [onUrlChange]
  );

  const addLog = useCallback((log: ConsoleLine) => {
    setLogs((prev) => [...prev, log]);
  }, []);

  const clearLogs = useCallback(() => setLogs([]), []);

  const screenshotFn = useCallback(async () => {
    return screenshotFnRef.current ? await screenshotFnRef.current() : null;
  }, []);

  const setScreenshotFn = useCallback((fn: (() => Promise<string | null>) | null) => {
    screenshotFnRef.current = fn;
  }, []);

  const contextValue = useMemo<WebPreviewContextValue>(
    () => ({
      consoleOpen,
      setConsoleOpen,
      setUrl: handleUrlChange,
      url,
      logs,
      addLog,
      clearLogs,
      isLoading,
      setIsLoading,
      screenshotFn,
      setScreenshotFn
    }),
    [
      consoleOpen,
      handleUrlChange,
      url,
      logs,
      addLog,
      clearLogs,
      isLoading,
      screenshotFn,
      setScreenshotFn
    ]
  );

  return (
    <WebPreviewContext.Provider value={contextValue}>
      <div
        className={cn("flex size-full flex-col rounded-lg border bg-card", className)}
        {...props}
      >
        {children}
      </div>
    </WebPreviewContext.Provider>
  );
};

// ---------------------------------------------------------------------------
// Navigation bar
// ---------------------------------------------------------------------------

export type WebPreviewNavigationProps = ComponentProps<"div">;

export const WebPreviewNavigation = ({
  className,
  children,
  ...props
}: WebPreviewNavigationProps) => (
  <div className={cn("flex items-center gap-1 border-b p-2", className)} {...props}>
    {children}
  </div>
);

export type WebPreviewNavigationButtonProps = ComponentProps<typeof Button> & {
  tooltip?: string;
};

export const WebPreviewNavigationButton = ({
  onClick,
  disabled,
  tooltip,
  children,
  ...props
}: WebPreviewNavigationButtonProps) => (
  <TooltipProvider>
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          className="h-8 w-8 p-0 hover:text-foreground"
          disabled={disabled}
          onClick={onClick}
          size="sm"
          variant="ghost"
          {...props}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        <p>{tooltip}</p>
      </TooltipContent>
    </Tooltip>
  </TooltipProvider>
);

// ---------------------------------------------------------------------------
// URL input
// ---------------------------------------------------------------------------

export type WebPreviewUrlProps = ComponentProps<typeof Input>;

export const WebPreviewUrl = ({ value, onChange, onKeyDown, ...props }: WebPreviewUrlProps) => {
  const { url, setUrl } = useWebPreview();
  const [prevUrl, setPrevUrl] = useState(url);
  const [inputValue, setInputValue] = useState(url);

  // Sync input value with context URL when it changes externally (derived state pattern)
  if (url !== prevUrl) {
    setPrevUrl(url);
    setInputValue(url);
  }

  const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setInputValue(event.target.value);
    onChange?.(event);
  };

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Enter") {
        const target = event.target as HTMLInputElement;
        setUrl(target.value);
        target.blur();
      }
      onKeyDown?.(event);
    },
    [setUrl, onKeyDown]
  );

  return (
    <Input
      className="h-8 flex-1 text-sm"
      onChange={onChange ?? handleChange}
      onKeyDown={handleKeyDown}
      placeholder="Enter URL..."
      value={value ?? inputValue}
      {...props}
    />
  );
};

// ---------------------------------------------------------------------------
// Loading bar
// ---------------------------------------------------------------------------

export const WebPreviewLoadingBar = () => {
  const { isLoading } = useWebPreview();
  return (
    <div
      className={cn(
        "pointer-events-none absolute top-0 left-0 h-0.5 w-full overflow-hidden transition-opacity duration-300",
        isLoading ? "opacity-100" : "opacity-0"
      )}
    >
      <div className="h-full w-1/3 animate-[shimmer_1s_ease-in-out_infinite] bg-primary/70" />
    </div>
  );
};

// ---------------------------------------------------------------------------
// Body (webview / iframe)
// ---------------------------------------------------------------------------

export type WebPreviewBodyProps = ComponentProps<"iframe"> & {
  loading?: ReactNode;
  onScreenshotCaptured?: (dataUrl: string) => void;
};

export const WebPreviewBody = ({
  className,
  loading,
  src,
  onScreenshotCaptured: _onScreenshotCaptured,
  ...props
}: WebPreviewBodyProps) => {
  const { url, setUrl, addLog, clearLogs, setIsLoading, setScreenshotFn } = useWebPreview();
  const webviewRef = useRef<any>(null);

  useEffect(() => {
    const webview = webviewRef.current;
    if (!webview) return;

    const handleNavigate = (event: any) => {
      if (event.url && event.url !== url) setUrl(event.url);
    };
    const handleNewNavigate = () => clearLogs();
    const handleStartLoading = () => setIsLoading(true);
    const handleStopLoading = () => setIsLoading(false);
    const handleConsoleMessage = (event: any) => {
      const levelMap: Record<number, "log" | "warn" | "error"> = {
        0: "log",
        1: "warn",
        2: "error",
        3: "log"
      };
      const level = levelMap[event.level as number] ?? "log";
      addLog({ level, message: event.message as string, timestamp: Date.now() });
    };

    webview.addEventListener("did-navigate", handleNavigate);
    webview.addEventListener("did-navigate", handleNewNavigate);
    webview.addEventListener("did-navigate-in-page", handleNavigate);
    webview.addEventListener("did-start-loading", handleStartLoading);
    webview.addEventListener("did-stop-loading", handleStopLoading);
    webview.addEventListener("console-message", handleConsoleMessage);

    setScreenshotFn(async () => {
      const img = await (webviewRef.current as any)?.capturePage?.();
      return img ? (img.toDataURL() as string) : null;
    });

    return () => {
      webview.removeEventListener("did-navigate", handleNavigate);
      webview.removeEventListener("did-navigate", handleNewNavigate);
      webview.removeEventListener("did-navigate-in-page", handleNavigate);
      webview.removeEventListener("did-start-loading", handleStartLoading);
      webview.removeEventListener("did-stop-loading", handleStopLoading);
      webview.removeEventListener("console-message", handleConsoleMessage);
      setScreenshotFn(null);
    };
  }, [url, setUrl, addLog, clearLogs, setIsLoading, setScreenshotFn]);

  const isElectron =
    typeof navigator !== "undefined" && navigator.userAgent.toLowerCase().includes("electron");

  return (
    <div className="relative flex-1 overflow-hidden">
      <WebPreviewLoadingBar />
      {isElectron ? (
        <webview
          allowpopups={true}
          className={cn("flex size-full", className)}
          partition="persist:preview"
          ref={webviewRef}
          src={(src ?? url) || "about:blank"}
          style={{ width: "100%", height: "100%" }}
        />
      ) : (
        <iframe
          className={cn("size-full", className)}
          // oxlint-disable-next-line eslint-plugin-react(iframe-missing-sandbox)
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-presentation"
          src={(src ?? url) || undefined}
          title="Preview"
          {...props}
        />
      )}
      {loading}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Screenshot button (reads screenshotFn from context)
// ---------------------------------------------------------------------------

export type WebPreviewScreenshotButtonProps = {
  onCapture?: (dataUrl: string) => void;
  tooltip?: string;
};

export const WebPreviewScreenshotButton = ({
  onCapture,
  tooltip = "Enviar screenshot para o Claude"
}: WebPreviewScreenshotButtonProps) => {
  const { screenshotFn } = useWebPreview();
  return (
    <WebPreviewNavigationButton
      onClick={async () => {
        const dataUrl = await screenshotFn();
        if (dataUrl) onCapture?.(dataUrl);
      }}
      tooltip={tooltip}
    >
      <Camera className="size-4" />
    </WebPreviewNavigationButton>
  );
};

// ---------------------------------------------------------------------------
// Console
// ---------------------------------------------------------------------------

export type WebPreviewConsoleProps = ComponentProps<"div">;

export const WebPreviewConsole = ({ className, children, ...props }: WebPreviewConsoleProps) => {
  const { consoleOpen, setConsoleOpen, logs, clearLogs } = useWebPreview();

  return (
    <Collapsible
      className={cn("border-t bg-muted/50 font-mono text-sm", className)}
      onOpenChange={setConsoleOpen}
      open={consoleOpen}
      {...props}
    >
      <CollapsibleTrigger asChild>
        <Button
          className="flex w-full items-center justify-between p-4 text-left font-medium hover:bg-muted/50"
          variant="ghost"
        >
          Console
          <span className="ml-auto flex items-center gap-1.5">
            {logs.length > 0 ? (
              <span
                role="button"
                onClick={(e) => {
                  e.stopPropagation();
                  clearLogs();
                }}
                className="flex size-4 items-center justify-center rounded hover:bg-muted text-muted-foreground/60 hover:text-foreground"
                title="Clear console"
              >
                <X className="size-3" />
              </span>
            ) : null}
            <ChevronDownIcon
              className={cn(
                "h-4 w-4 transition-transform duration-200",
                consoleOpen && "rotate-180"
              )}
            />
          </span>
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent
        className={cn(
          "px-4 pb-4",
          "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 outline-none data-[state=closed]:animate-out data-[state=open]:animate-in"
        )}
      >
        <div className="max-h-48 space-y-1 overflow-y-auto">
          {logs.length === 0 ? (
            <p className="text-muted-foreground">No console output</p>
          ) : (
            logs.map((log, index) => (
              <div
                className={cn(
                  "text-xs",
                  log.level === "error" && "text-destructive",
                  log.level === "warn" && "text-yellow-600",
                  log.level === "log" && "text-foreground"
                )}
                key={`${log.timestamp}-${index}`}
              >
                <span className="text-muted-foreground">
                  {new Date(log.timestamp).toLocaleTimeString()}
                </span>{" "}
                {log.message}
              </div>
            ))
          )}
          {children}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
};
