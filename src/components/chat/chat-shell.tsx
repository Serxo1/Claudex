import { useEffect, useMemo, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  RefreshCcw,
  Save,
  Settings,
  X
} from "lucide-react";
import {
  WebPreview,
  WebPreviewBody,
  WebPreviewConsole,
  WebPreviewNavigation,
  WebPreviewNavigationButton,
  WebPreviewUrl
} from "@/components/ai-elements/web-preview";
import MonacoEditor from "@monaco-editor/react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { MODEL_OPTIONS } from "@/lib/chat-types";
import { languageFromPath, shortFileLabel } from "@/lib/chat-utils";

import { useTerminal } from "@/hooks/use-terminal";
import { usePreview } from "@/hooks/use-preview";

import { useSettingsStore } from "@/stores/settings-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useGitStore } from "@/stores/git-store";
import { useChatStore } from "@/stores/chat-store";

import { SettingsMenu } from "@/components/chat/settings-menu";
import { Sidebar } from "@/components/chat/sidebar";
import { HeaderBar } from "@/components/chat/header-bar";
import { SessionStack } from "@/components/chat/session-stack";

export function ChatShell() {
  const [activePage, setActivePage] = useState<"chat" | "preview" | "skills">("chat");
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);

  const setStatus = useSettingsStore((s) => s.setStatus);
  const settings = useSettingsStore((s) => s.settings);
  const refreshSettings = useSettingsStore((s) => s.refreshSettings);

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
  const persistThreads = useChatStore((s) => s.persistThreads);
  const loadSkills = useChatStore((s) => s.loadSkills);

  const activeThreadWorkspaceDir = useMemo(
    () => threads.find((t) => t.id === activeThreadId)?.workspaceDirs[0] ?? undefined,
    [threads, activeThreadId]
  );
  const terminalHook = useTerminal(setStatus, activeThreadWorkspaceDir);
  const previewHook = usePreview();

  const activeEditorTab = useMemo(
    () => editorTabs.find((tab) => tab.id === activeEditorTabId) || null,
    [editorTabs, activeEditorTabId]
  );

  const activeThread = useMemo(
    () => threads.find((t) => t.id === activeThreadId) ?? threads[0] ?? null,
    [threads, activeThreadId]
  );

  // Initialize activeThreadId
  useEffect(() => {
    if (!activeThreadId && threads[0]) {
      setActiveThreadId(threads[0].id);
    }
  }, [activeThreadId, threads, setActiveThreadId]);

  // Persist threads to localStorage
  useEffect(() => {
    persistThreads();
  }, [threads, persistThreads]);

  // Init stream listener
  useEffect(() => {
    initStreamListener();
    return () => cleanupStreamListener();
  }, [initStreamListener, cleanupStreamListener]);

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
          refreshGitSummary(),
          refreshIdeInfo(),
          refreshWorkspaceFileTree(),
          refreshRecentCommits()
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
      void Promise.all([refreshGitSummary(), refreshRecentCommits(), refreshWorkspaceFileTree()]);
    }, 10000);
    return () => window.clearInterval(timer);
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

  const modelOptions = useMemo(() => {
    const options = [...MODEL_OPTIONS];
    if (settings?.model && !options.some((option) => option.value === settings.model)) {
      options.unshift({ value: settings.model, label: settings.model });
    }
    return options;
  }, [settings?.model]);

  const showRightPanel = activePage === "preview" || editorTabs.length > 0;
  const chatContainerMax = showRightPanel ? "max-w-none" : "max-w-4xl";

  return (
    <main className="relative flex h-screen w-screen overflow-hidden bg-background text-foreground">
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
        onSelectPage={setActivePage}
        onToggle={() => setIsSidebarOpen(false)}
        settingsMenu={
          <SettingsMenu align="start">
            <button
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground transition hover:bg-foreground/5 hover:text-foreground"
              type="button"
            >
              <Settings className="size-4" />
              <span>Settings</span>
            </button>
          </SettingsMenu>
        }
      />

      <section className="flex min-w-0 flex-1 flex-col bg-background">
        <HeaderBar
          isSidebarOpen={isSidebarOpen}
          onToggleSidebar={() => setIsSidebarOpen((current) => !current)}
          onOpenSidebar={() => setIsSidebarOpen(true)}
          terminalOpen={terminalHook.terminalOpen}
          onToggleTerminal={() => terminalHook.setTerminalOpen((current) => !current)}
        />

        <div className={cn("min-h-0 flex flex-1", showRightPanel ? "flex-row" : "flex-col")}>
          <div
            className={cn(
              "min-h-0 flex flex-1 flex-col",
              showRightPanel ? "w-[46%] min-w-[420px] shrink-0 border-r border-border/70" : ""
            )}
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
              />
            ) : (
              <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
                Seleciona ou cria uma thread na sidebar.
              </div>
            )}
          </div>

          {showRightPanel ? (
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
                    <WebPreviewUrl
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          previewHook.onPreviewNavigate((event.target as HTMLInputElement).value);
                        }
                      }}
                      value={previewHook.previewUrl}
                    />
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
                  <WebPreviewConsole logs={[]} />
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
                        onClick={() => useWorkspaceStore.getState().setActiveEditorTabId(tab.id)}
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
                              useWorkspaceStore.getState().setEditorAutoSave((current) => !current)
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
                              void useWorkspaceStore.getState().onSaveEditorTab(activeEditorTab.id)
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
          ) : null}
        </div>

        {terminalHook.terminalOpen ? (
          <div className="border-t border-border/70 bg-background px-3 py-3 lg:px-6">
            <div className={cn("mx-auto w-full", chatContainerMax)}>
              <div className="rounded-lg border border-border/60 bg-background">
                <div className="flex items-center justify-between border-b border-border px-4 py-2">
                  <div className="truncate text-xs">
                    <span className="font-semibold text-foreground">Terminal</span>
                    <span className="ml-1 font-mono text-muted-foreground">
                      {terminalHook.terminalShellLabel || ""}
                    </span>
                  </div>
                  <Button
                    className="h-7 text-xs"
                    onClick={() => void terminalHook.onOpenExternalTerminal()}
                    type="button"
                    variant="outline"
                  >
                    Open app
                  </Button>
                </div>
                <div className="h-80 w-full p-2" ref={terminalHook.terminalContainerRef} />
              </div>
            </div>
          </div>
        ) : null}
      </section>
    </main>
  );
}
