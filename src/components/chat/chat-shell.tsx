import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, ExternalLink, Plus, RefreshCcw, Save, X } from "lucide-react";
import {
  WebPreview,
  WebPreviewBody,
  WebPreviewConsole,
  WebPreviewNavigation,
  WebPreviewNavigationButton,
  WebPreviewScreenshotButton,
  WebPreviewUrl
} from "@/components/ai-elements/web-preview";
import MonacoEditor from "@monaco-editor/react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { MODEL_OPTIONS } from "@/lib/chat-types";
import { extractLocalhostUrls, languageFromPath, shortFileLabel } from "@/lib/chat-utils";

import { useTerminalTabs } from "@/hooks/use-terminal-tabs";
import { usePreview } from "@/hooks/use-preview";

import { useSettingsStore } from "@/stores/settings-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useGitStore } from "@/stores/git-store";
import { useChatStore } from "@/stores/chat-store";

import { SettingsContent } from "@/components/chat/settings-menu";
import { Sidebar } from "@/components/chat/sidebar";
import { HeaderBar } from "@/components/chat/header-bar";
import { SessionStack } from "@/components/chat/session-stack";
import { NewModelAnnouncement } from "@/components/chat/new-model-announcement";
import { StorePage } from "@/components/chat/store-page";
import { SetupScreen } from "@/components/chat/setup-screen";

export function ChatShell() {
  const [activePage, setActivePage] = useState<"chat" | "preview" | "store">("chat");
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<{ version: string; downloaded: boolean } | null>(
    null
  );

  // Resizable split panel
  const [splitPct, setSplitPct] = useState(() => {
    const v = localStorage.getItem("split-pct");
    return v ? Math.max(30, Math.min(70, parseFloat(v))) : 46;
  });
  const splitPctRef = useRef(splitPct);
  useEffect(() => {
    splitPctRef.current = splitPct;
  }, [splitPct]);

  const setStatus = useSettingsStore((s) => s.setStatus);
  const settings = useSettingsStore((s) => s.settings);
  const refreshSettings = useSettingsStore((s) => s.refreshSettings);
  const onTestCli = useSettingsStore((s) => s.onTestCli);
  const claudeCodeReady = useSettingsStore((s) => s.claudeCodeReady);
  const isBusy = useSettingsStore((s) => s.isBusy);
  const dynamicModels = useSettingsStore((s) => s.dynamicModels);

  const editorTabs = useWorkspaceStore((s) => s.editorTabs);
  const activeEditorTabId = useWorkspaceStore((s) => s.activeEditorTabId);
  const editorAutoSave = useWorkspaceStore((s) => s.editorAutoSave);
  const refreshWorkspace = useWorkspaceStore((s) => s.refreshWorkspace);
  const refreshWorkspaceFileTree = useWorkspaceStore((s) => s.refreshWorkspaceFileTree);
  const refreshIdeInfo = useWorkspaceStore((s) => s.refreshIdeInfo);

  const refreshGitSummary = useGitStore((s) => s.refreshGitSummary);
  const refreshRecentCommits = useGitStore((s) => s.refreshRecentCommits);

  const threads = useChatStore((s) => s.threads);
  const activeThreadId = useChatStore((s) => s.activeThreadId);
  const setActiveThreadId = useChatStore((s) => s.setActiveThreadId);
  const initStreamListener = useChatStore((s) => s.initStreamListener);
  const cleanupStreamListener = useChatStore((s) => s.cleanupStreamListener);
  const initTeamCompletionListener = useChatStore((s) => s.initTeamCompletionListener);
  const persistThreads = useChatStore((s) => s.persistThreads);
  const loadSkills = useChatStore((s) => s.loadSkills);
  const setThreadPreviewUrl = useChatStore((s) => s.setThreadPreviewUrl);

  const activeThreadWorkspaceDir = useMemo(
    () => threads.find((t) => t.id === activeThreadId)?.workspaceDirs[0] ?? undefined,
    [threads, activeThreadId]
  );
  const activeThreadWorkspaceDirRef = useRef(activeThreadWorkspaceDir);
  useEffect(() => {
    activeThreadWorkspaceDirRef.current = activeThreadWorkspaceDir;
  }, [activeThreadWorkspaceDir]);

  const activeThread = useMemo(
    () => threads.find((t) => t.id === activeThreadId) ?? threads[0] ?? null,
    [threads, activeThreadId]
  );

  const activeThreadPreviewUrl = activeThread?.previewUrl;

  const terminalHook = useTerminalTabs(setStatus, activeThreadWorkspaceDir);

  // Thread-aware preview hook — persists URL per thread
  const previewHook = usePreview(
    activeThreadId || null,
    activeThreadPreviewUrl,
    useCallback(
      (url: string) => {
        if (activeThreadId) setThreadPreviewUrl(activeThreadId, url);
      },
      [activeThreadId, setThreadPreviewUrl]
    )
  );

  const activeEditorTab = useMemo(
    () => editorTabs.find((tab) => tab.id === activeEditorTabId) || null,
    [editorTabs, activeEditorTabId]
  );

  // Initialize activeThreadId
  useEffect(() => {
    if (!activeThreadId && threads[0]) {
      setActiveThreadId(threads[0].id);
    }
  }, [activeThreadId, threads, setActiveThreadId]);

  // Refresh git info on thread switch
  useEffect(() => {
    if (activeThreadId) {
      void Promise.all([
        refreshGitSummary(activeThreadWorkspaceDir),
        refreshRecentCommits(activeThreadWorkspaceDir)
      ]);
    }
  }, [activeThreadId, activeThreadWorkspaceDir]);

  // Persist threads to localStorage
  useEffect(() => {
    persistThreads();
  }, [threads, persistThreads]);

  // Init stream listener
  useEffect(() => {
    initStreamListener();
    return () => cleanupStreamListener();
  }, [initStreamListener, cleanupStreamListener]);

  // Auto-resume session when a team finishes all tasks
  useEffect(() => {
    const unsub = initTeamCompletionListener();
    return unsub;
  }, [initTeamCompletionListener]);

  // Load skills from installed plugins
  useEffect(() => {
    void loadSkills();
  }, [loadSkills]);

  // Initial load
  useEffect(() => {
    void (async () => {
      try {
        await Promise.all([
          refreshSettings(),
          refreshWorkspace(),
          refreshIdeInfo(),
          refreshWorkspaceFileTree(),
          onTestCli()
        ]);
        setStatus("Ready.");
      } catch (error) {
        setStatus((error as Error).message);
      }
    })();
  }, []);

  // Polling
  useEffect(() => {
    const timer = window.setInterval(() => {
      const dir = activeThreadWorkspaceDirRef.current;
      void Promise.all([
        refreshGitSummary(dir),
        refreshRecentCommits(dir),
        refreshWorkspaceFileTree()
      ]);
    }, 10000);
    return () => window.clearInterval(timer);
  }, []);

  // Auto-updater listeners
  useEffect(() => {
    const unsubAvailable = window.desktop.app.onUpdateAvailable((info) => {
      setUpdateInfo({ version: info.version, downloaded: false });
    });
    const unsubDownloaded = window.desktop.app.onUpdateDownloaded((info) => {
      setUpdateInfo({ version: info.version, downloaded: true });
    });
    return () => {
      unsubAvailable();
      unsubDownloaded();
    };
  }, []);

  // Global keyboard shortcuts
  useEffect(() => {
    const onGlobalKeyDown = (event: KeyboardEvent) => {
      const isMod = event.metaKey || event.ctrlKey;
      // Cmd+K — open inline search in sidebar
      if (isMod && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setIsSidebarOpen(true);
        setIsSearchOpen(true);
      }
    };
    window.addEventListener("keydown", onGlobalKeyDown);
    return () => window.removeEventListener("keydown", onGlobalKeyDown);
  }, []);

  // Editor keyboard shortcut (Cmd+S)
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const isSave = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s";
      if (!isSave || !activeEditorTab) return;
      event.preventDefault();
      void useWorkspaceStore.getState().onSaveEditorTab(activeEditorTab.id);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeEditorTab]);

  // Editor auto-save
  useEffect(() => {
    if (!editorAutoSave || !activeEditorTab || !activeEditorTab.dirty || activeEditorTab.saving)
      return;
    const timer = window.setTimeout(() => {
      void useWorkspaceStore.getState().onSaveEditorTab(activeEditorTab.id);
    }, 900);
    return () => window.clearTimeout(timer);
  }, [
    editorAutoSave,
    activeEditorTab?.id,
    activeEditorTab?.content,
    activeEditorTab?.dirty,
    activeEditorTab?.saving
  ]);

  // Auto-navigate preview when Claude mentions a localhost URL
  const lastAssistantContent = useMemo(() => {
    const msgs = activeThread?.sessions.at(-1)?.messages ?? [];
    return [...msgs].reverse().find((m) => m.role === "assistant" && m.content)?.content ?? "";
  }, [activeThread]);

  const autoNavRef = useRef("");
  // Reset auto-nav guard when thread changes
  useEffect(() => {
    autoNavRef.current = "";
  }, [activeThreadId]);

  useEffect(() => {
    const urls = extractLocalhostUrls(lastAssistantContent);
    if (urls[0] && urls[0] !== autoNavRef.current) {
      autoNavRef.current = urls[0];
      previewHook.onPreviewNavigate(urls[0]);
      // Auto-switch to preview unless user is on store page
      setActivePage((p) => (p === "store" ? p : "preview"));
    }
  }, [lastAssistantContent]);

  const modelOptions = useMemo(() => {
    if (dynamicModels.length > 0) {
      const options = dynamicModels.map((m) => ({ value: m.value, label: m.displayName }));
      // If the current model isn't in the dynamic list, add it so the selector stays consistent
      if (settings?.model && !options.some((o) => o.value === settings.model)) {
        options.unshift({ value: settings.model, label: settings.model });
      }
      return options;
    }
    // Fallback to static options before first session
    const options = [...MODEL_OPTIONS];
    if (settings?.model && !options.some((option) => option.value === settings.model)) {
      options.unshift({ value: settings.model, label: settings.model });
    }
    return options;
  }, [dynamicModels, settings?.model]);

  // Handle "Open in preview" from chat messages
  const handleOpenInPreview = useCallback(
    (url: string) => {
      previewHook.onPreviewNavigate(url);
      setActivePage("preview");
    },
    [previewHook]
  );

  // Handle screenshot from preview — saves and attaches to context
  const handleScreenshot = useCallback(async (dataUrl: string) => {
    try {
      const saved = await window.desktop.workspace.savePastedImage({
        dataUrl,
        filename: "preview-screenshot.png"
      });
      useWorkspaceStore.getState().setContextFiles((prev) => [
        ...prev,
        {
          absolutePath: saved.absolutePath,
          relativePath: saved.relativePath,
          mediaType: saved.mediaType,
          previewDataUrl: dataUrl,
          isImage: true
        }
      ]);
    } catch (error) {
      setStatus(`Screenshot failed: ${(error as Error).message}`);
    }
  }, []);

  // Drag handle for resizing split panel
  const handleDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startPct = splitPctRef.current;
    const container = (e.currentTarget as HTMLElement).parentElement!;
    const totalW = container.offsetWidth;

    const onMove = (ev: MouseEvent) => {
      const newPct = startPct + ((ev.clientX - startX) / totalW) * 100;
      setSplitPct(Math.max(25, Math.min(75, newPct)));
    };
    const onUp = () => {
      localStorage.setItem("split-pct", String(splitPctRef.current));
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, []);

  const showRightPanel = activePage === "preview" || editorTabs.length > 0;
  const chatContainerMax = showRightPanel ? "max-w-none" : "max-w-4xl";

  return (
    <main className="relative flex h-screen w-screen overflow-hidden text-foreground">
      <NewModelAnnouncement />

      {/* Setup / onboarding overlay — shown when CLI is not detected */}
      {claudeCodeReady === false && <SetupScreen isVerifying={isBusy} onVerify={onTestCli} />}

      {/* Update banner */}
      {updateInfo && (
        <div className="absolute top-0 left-0 right-0 z-40 flex items-center justify-between gap-3 bg-blue-600 px-4 py-2 text-sm text-white shadow-md">
          <span>
            {updateInfo.downloaded
              ? `Claudex ${updateInfo.version} transferido — reinicia para instalar.`
              : `Claudex ${updateInfo.version} disponível — a transferir...`}
          </span>
          <div className="flex items-center gap-2">
            {updateInfo.downloaded && (
              <button
                className="rounded bg-white/20 px-3 py-0.5 font-medium hover:bg-white/30 transition-colors"
                onClick={() => void window.desktop.app.installUpdate()}
                type="button"
              >
                Reiniciar e instalar
              </button>
            )}
            <button
              className="opacity-70 hover:opacity-100 transition-opacity"
              onClick={() => setUpdateInfo(null)}
              title="Dispensar"
              type="button"
            >
              ✕
            </button>
          </div>
        </div>
      )}
      {isSidebarOpen ? (
        <button
          className="absolute inset-0 z-30 bg-black/45 lg:hidden"
          onClick={() => setIsSidebarOpen(false)}
          type="button"
        />
      ) : null}

      <Sidebar
        activePage={activePage}
        isOpen={isSidebarOpen}
        searchOpen={isSearchOpen}
        onSearchClose={() => setIsSearchOpen(false)}
        onSelectPage={setActivePage}
        onToggle={() => setIsSidebarOpen(false)}
        settingsContent={<SettingsContent />}
      />

      <section className="flex min-w-0 flex-1 flex-col bg-background">
        <HeaderBar
          isSidebarOpen={isSidebarOpen}
          onToggleSidebar={() => setIsSidebarOpen((current) => !current)}
          onOpenSidebar={() => setIsSidebarOpen(true)}
          terminalOpen={terminalHook.terminalOpen}
          onToggleTerminal={() => terminalHook.setTerminalOpen((current) => !current)}
        />

        {activePage === "store" ? (
          <div className="flex-1 min-h-0 overflow-hidden">
            <StorePage />
          </div>
        ) : (
          <div className={cn("min-h-0 flex flex-1", showRightPanel ? "flex-row" : "flex-col")}>
            {/* Left panel */}
            <div
              className={cn("min-h-0 flex flex-col", !showRightPanel && "flex-1")}
              style={
                showRightPanel
                  ? { width: `${splitPct}%`, minWidth: "300px", flexShrink: 0 }
                  : undefined
              }
            >
              {activeThread ? (
                <SessionStack
                  chatContainerMax={chatContainerMax}
                  latestTerminalError={terminalHook.latestTerminalError}
                  modelOptions={modelOptions}
                  onInsertLatestTerminalError={(setInputFn) =>
                    terminalHook.onInsertLatestTerminalError(setInputFn, setStatus)
                  }
                  setTerminalOpen={terminalHook.setTerminalOpen}
                  thread={activeThread}
                  onOpenInPreview={handleOpenInPreview}
                />
              ) : (
                <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
                  Seleciona ou cria uma thread na sidebar.
                </div>
              )}
            </div>

            {showRightPanel ? (
              <>
                {/* Drag handle */}
                <div
                  className="w-1 shrink-0 cursor-col-resize bg-border/40 transition-colors hover:bg-primary/40"
                  onMouseDown={handleDragStart}
                />

                {/* Right panel */}
                <div className="min-h-0 flex-1 bg-background p-3 lg:p-4">
                  {activePage === "preview" ? (
                    <WebPreview
                      className="h-full border-border/60 bg-background"
                      defaultUrl={previewHook.previewUrl}
                      onUrlChange={previewHook.onPreviewNavigate}
                    >
                      <WebPreviewNavigation className="border-border bg-background">
                        <WebPreviewNavigationButton
                          disabled={previewHook.previewHistoryIndex <= 0}
                          onClick={previewHook.onPreviewBack}
                          tooltip="Back"
                        >
                          <ChevronLeft className="size-4" />
                        </WebPreviewNavigationButton>
                        <WebPreviewNavigationButton
                          disabled={
                            previewHook.previewHistoryIndex >= previewHook.previewHistory.length - 1
                          }
                          onClick={previewHook.onPreviewForward}
                          tooltip="Forward"
                        >
                          <ChevronRight className="size-4" />
                        </WebPreviewNavigationButton>
                        <WebPreviewNavigationButton
                          onClick={previewHook.onPreviewReload}
                          tooltip="Reload"
                        >
                          <RefreshCcw className="size-4" />
                        </WebPreviewNavigationButton>
                        <WebPreviewUrl />
                        <WebPreviewScreenshotButton onCapture={handleScreenshot} />
                        <WebPreviewNavigationButton
                          onClick={() => window.open(previewHook.previewUrl, "_blank")}
                          tooltip="Open in browser"
                        >
                          <ExternalLink className="size-4" />
                        </WebPreviewNavigationButton>
                      </WebPreviewNavigation>
                      <WebPreviewBody
                        key={`preview-${previewHook.previewKey}`}
                        src={previewHook.previewUrl}
                      />
                      <WebPreviewConsole />
                    </WebPreview>
                  ) : (
                    <div className="flex h-full flex-col overflow-hidden rounded-lg border border-border/60 bg-background">
                      <div className="flex items-center gap-1 overflow-x-auto border-b border-border px-2 py-1.5">
                        {editorTabs.map((tab) => (
                          <button
                            className={cn(
                              "inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs",
                              tab.id === activeEditorTabId
                                ? "border-border bg-foreground/10 text-foreground"
                                : "border-border bg-muted/30 text-foreground/80 hover:bg-foreground/[0.07]"
                            )}
                            key={tab.id}
                            onClick={() =>
                              useWorkspaceStore.getState().setActiveEditorTabId(tab.id)
                            }
                            type="button"
                          >
                            <span className="truncate max-w-56">
                              {shortFileLabel(tab.relativePath)}
                            </span>
                            {tab.dirty ? <span className="text-foreground/80">&#8226;</span> : null}
                            <span
                              className="inline-flex size-4 items-center justify-center rounded hover:bg-foreground/10"
                              onClick={(event) => {
                                event.stopPropagation();
                                useWorkspaceStore.getState().onCloseEditorTab(tab.id);
                              }}
                              role="button"
                            >
                              <X className="size-3" />
                            </span>
                          </button>
                        ))}
                      </div>
                      {activeEditorTab ? (
                        <>
                          <div className="flex items-center justify-between border-b border-border px-3 py-1.5 text-xs text-muted-foreground">
                            <span className="truncate">{activeEditorTab.absolutePath}</span>
                            <div className="flex items-center gap-2">
                              <Button
                                className={cn(
                                  "h-7 text-xs",
                                  editorAutoSave ? "border-border/60 text-foreground" : ""
                                )}
                                onClick={() =>
                                  useWorkspaceStore
                                    .getState()
                                    .setEditorAutoSave((current) => !current)
                                }
                                type="button"
                                variant="outline"
                              >
                                Auto-save {editorAutoSave ? "On" : "Off"}
                              </Button>
                              <Button
                                className="h-7 text-xs"
                                disabled={!activeEditorTab.dirty || activeEditorTab.saving}
                                onClick={() =>
                                  void useWorkspaceStore
                                    .getState()
                                    .onSaveEditorTab(activeEditorTab.id)
                                }
                                type="button"
                                variant="outline"
                              >
                                <Save className="size-3.5" />
                                {activeEditorTab.saving ? "Saving..." : "Save"}
                              </Button>
                            </div>
                          </div>
                          <div className="min-h-0 flex-1">
                            <MonacoEditor
                              height="100%"
                              language={languageFromPath(activeEditorTab.relativePath)}
                              onChange={(value) =>
                                useWorkspaceStore
                                  .getState()
                                  .onEditorTabContentChange(activeEditorTab.id, value ?? "")
                              }
                              options={{
                                automaticLayout: true,
                                fontFamily: "Menlo, Monaco, 'Courier New', monospace",
                                fontSize: 13,
                                minimap: { enabled: false },
                                scrollBeyondLastLine: false,
                                tabSize: 2,
                                wordWrap: "off"
                              }}
                              theme="vs-dark"
                              value={activeEditorTab.content}
                            />
                          </div>
                        </>
                      ) : (
                        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
                          Select a file to start editing.
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </>
            ) : null}
          </div>
        )}

        {terminalHook.terminalOpen ? (
          <div className="border-t border-border/70 bg-background px-3 py-3 lg:px-6">
            <div className={cn("mx-auto w-full", chatContainerMax)}>
              <div className="rounded-lg border border-border/60 bg-background">
                {/* Tab bar */}
                <div className="flex items-center gap-1 border-b border-border px-2 py-1.5">
                  <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
                    {terminalHook.tabs.map((tab) => (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() => terminalHook.setActiveTabId(tab.id)}
                        className={cn(
                          "inline-flex shrink-0 items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs transition",
                          tab.id === terminalHook.activeTabId
                            ? "border-border bg-foreground/10 text-foreground"
                            : "border-transparent text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
                        )}
                      >
                        <span className="font-mono">{tab.label}</span>
                        <span
                          role="button"
                          className="inline-flex size-4 items-center justify-center rounded hover:bg-foreground/10 text-muted-foreground/50"
                          onClick={(e) => {
                            e.stopPropagation();
                            terminalHook.closeTab(tab.id);
                          }}
                        >
                          <X className="size-2.5" />
                        </span>
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => terminalHook.addTab()}
                      className="inline-flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground/50 hover:bg-foreground/5 hover:text-foreground transition"
                      title="Novo terminal"
                    >
                      <Plus className="size-3" />
                    </button>
                  </div>
                  <div className="flex shrink-0 items-center gap-2 pl-1">
                    <span className="font-mono text-[10px] text-muted-foreground/50">
                      {terminalHook.terminalShellLabel || ""}
                    </span>
                    <Button
                      className="h-7 text-xs"
                      onClick={() => void terminalHook.onOpenExternalTerminal()}
                      type="button"
                      variant="outline"
                    >
                      Open app
                    </Button>
                  </div>
                </div>
                {/* Terminal containers — all rendered, active one visible */}
                <div className="relative h-80 w-full">
                  {terminalHook.tabs.map((tab) => (
                    <div
                      key={tab.id}
                      ref={terminalHook.getContainerCallback(tab.id)}
                      className="absolute inset-0 p-2"
                      style={{ display: tab.id === terminalHook.activeTabId ? "block" : "none" }}
                    />
                  ))}
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </section>
    </main>
  );
}
