import { type ReactNode, useEffect, useRef, useState } from "react";
import logo from "@/assets/logo.png";
import {
  ChevronRight,
  FolderOpen,
  FolderPlus,
  Globe,
  MessageSquare,
  PanelLeftClose,
  Plus,
  Search,
  Settings,
  Trash2,
  Workflow,
  X
} from "lucide-react";
import { AnimatedThemeToggler } from "@/components/ui/animated-theme-toggler";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { AgentSession, Thread } from "@/lib/chat-types";
import { useChatStore } from "@/stores/chat-store";

export type SidebarProps = {
  isOpen: boolean;
  onToggle: () => void;
  activePage: "chat" | "preview" | "skills";
  onSelectPage: (page: "chat" | "preview" | "skills") => void;
  /** Controlled from outside (Cmd+K) — when true, expands inline search */
  searchOpen?: boolean;
  onSearchClose?: () => void;
  /** Content rendered inside the inline collapsible settings panel */
  settingsContent?: ReactNode;
};

function timeAgo(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (minutes < 1) return "agora";
  if (hours < 1) return `${minutes}m`;
  if (days < 1) return `${hours}h`;
  return `${days}d`;
}

function sessionStatusClass(status: AgentSession["status"]): string {
  if (status === "running") return "text-blue-500";
  if (status === "awaiting_approval") return "text-yellow-500";
  if (status === "error") return "text-destructive/70";
  return "";
}

function threadStatusDot(status: Thread["status"]) {
  if (status === "needs_attention")
    return <span className="inline-flex size-1.5 shrink-0 rounded-full bg-red-500 animate-pulse" />;
  if (status === "running")
    return (
      <span className="inline-flex size-1.5 shrink-0 rounded-full bg-blue-500 animate-pulse" />
    );
  return null;
}

export function Sidebar({
  isOpen,
  onToggle,
  activePage,
  onSelectPage,
  searchOpen,
  onSearchClose,
  settingsContent
}: SidebarProps) {
  const threads = useChatStore((s) => s.threads);
  const activeThreadId = useChatStore((s) => s.activeThreadId);
  const setActiveThreadId = useChatStore((s) => s.setActiveThreadId);
  const createThread = useChatStore((s) => s.createThread);
  const deleteThread = useChatStore((s) => s.deleteThread);

  const activeSessionId = useChatStore((s) => s.activeSessionId);
  const setActiveSessionId = useChatStore((s) => s.setActiveSessionId);
  const renameSession = useChatStore((s) => s.renameSession);
  const deleteSession = useChatStore((s) => s.deleteSession);

  // Determine if the currently active session is running (blocks new session creation)
  const activeThread = threads.find((t) => t.id === activeThreadId);
  const activeSession = activeThread?.sessions.find((s) => s.id === activeSessionId);
  const isActiveSessionRunning =
    activeSession?.status === "running" || activeSession?.status === "awaiting_approval";

  const [editingSession, setEditingSession] = useState<{
    threadId: string;
    sessionId: string;
    value: string;
  } | null>(null);
  const editInputRef = useRef<HTMLInputElement>(null);

  const [collapsedThreads, setCollapsedThreads] = useState<Set<string>>(new Set());
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Open inline search when parent triggers (Cmd+K)
  useEffect(() => {
    if (searchOpen) {
      setIsSearching(true);
      setTimeout(() => searchInputRef.current?.focus(), 50);
    }
  }, [searchOpen]);

  const openSearch = () => {
    setIsSearching(true);
    setTimeout(() => searchInputRef.current?.focus(), 50);
  };

  const closeSearch = () => {
    setIsSearching(false);
    setSearchQuery("");
    onSearchClose?.();
  };

  const toggleCollapse = (threadId: string) => {
    setCollapsedThreads((prev) => {
      const next = new Set(prev);
      if (next.has(threadId)) next.delete(threadId);
      else next.add(threadId);
      return next;
    });
  };

  const sortedThreads = [...threads].sort((a, b) => b.updatedAt - a.updatedAt);

  // Filtered threads for inline search
  const q = searchQuery.trim().toLowerCase();
  const searchResults = q
    ? sortedThreads.filter(
        (t) =>
          t.title.toLowerCase().includes(q) ||
          t.sessions.some(
            (s) =>
              s.title.toLowerCase().includes(q) ||
              s.messages.some((m) => m.content.toLowerCase().includes(q))
          )
      )
    : sortedThreads;

  if (!isOpen) return null;

  return (
    <aside className="absolute inset-y-0 left-0 z-40 flex h-full w-[280px] shrink-0 flex-col border-r border-border/70 bg-white dark:bg-background/50 lg:static lg:z-auto">
      {/* App header — pt-8 to clear macOS traffic lights (hiddenInset titleBar) */}
      <div className="[-webkit-app-region:drag] flex items-center justify-between px-4 pt-8 pb-3">
        <div className="flex items-center gap-2 [-webkit-app-region:no-drag]">
          <img alt="Logo" className="size-5 rounded-md" src={logo} />
          <span className="text-sm font-semibold tracking-tight text-foreground">Claudex</span>
        </div>
        <Button
          className="[-webkit-app-region:no-drag] size-7 rounded-md text-muted-foreground hover:text-foreground"
          onClick={onToggle}
          size="icon-xs"
          variant="ghost"
        >
          <PanelLeftClose className="size-3.5" />
        </Button>
      </div>

      {/* New Thread button */}
      <div className="px-2 pb-1">
        <button
          className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm font-medium text-foreground/80 transition hover:bg-foreground/5 hover:text-foreground"
          onClick={() => void createThread()}
          type="button"
        >
          <FolderPlus className="size-4 shrink-0 text-muted-foreground/70" />
          <span>New Thread</span>
        </button>
      </div>

      {/* Nav pages */}
      <div className="space-y-0.5 px-2">
        <button
          className={cn(
            "flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm transition",
            activePage === "skills"
              ? "bg-foreground/10 text-foreground"
              : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
          )}
          onClick={() => onSelectPage("skills")}
          type="button"
        >
          <Workflow className="size-4 shrink-0" />
          <span>Skills</span>
        </button>
        <button
          className={cn(
            "flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm transition",
            activePage === "preview"
              ? "bg-foreground/10 text-foreground"
              : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
          )}
          onClick={() => onSelectPage(activePage === "preview" ? "chat" : "preview")}
          type="button"
        >
          <Globe className="size-4 shrink-0" />
          <span>Preview</span>
        </button>
      </div>

      <div className="mx-4 my-3 border-t border-border/40" />

      {/* Threads section */}
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex items-center justify-between px-4 pb-2">
          {isSearching ? (
            /* Inline search bar */
            <div className="flex flex-1 items-center gap-1.5">
              <Search className="size-3.5 shrink-0 text-muted-foreground" />
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") closeSearch();
                }}
                placeholder="Pesquisar..."
                className="min-w-0 flex-1 bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground/60"
              />
              <button
                className="flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground/60 transition hover:text-muted-foreground"
                onClick={closeSearch}
                type="button"
              >
                <X className="size-3" />
              </button>
            </div>
          ) : (
            /* Normal header */
            <>
              <span className="text-xs font-medium text-muted-foreground/70 uppercase tracking-[0.08em]">
                Threads
              </span>
              <div className="flex items-center gap-0.5">
                <Button
                  className="size-6 text-muted-foreground hover:text-foreground"
                  onClick={openSearch}
                  size="icon-xs"
                  title="Pesquisar threads (⌘K)"
                  type="button"
                  variant="ghost"
                >
                  <Search className="size-3.5" />
                </Button>
                <Button
                  className="size-6 text-muted-foreground hover:text-foreground"
                  onClick={createThread}
                  size="icon-xs"
                  title="Novo projecto"
                  type="button"
                  variant="ghost"
                >
                  <FolderPlus className="size-3.5" />
                </Button>
              </div>
            </>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-auto px-2 pb-2">
          {searchResults.length === 0 ? (
            <p className="px-3 py-6 text-center text-xs text-muted-foreground">
              {q ? (
                "Nenhum resultado encontrado"
              ) : (
                <>
                  Sem projectos. Clica em <FolderPlus className="inline size-3" /> para criar um.
                </>
              )}
            </p>
          ) : (
            searchResults.map((thread) => {
              const isActive = thread.id === activeThreadId;
              const hasSessions = thread.sessions.length > 0;
              const isCollapsed = collapsedThreads.has(thread.id);
              const isNewSessionActive = isActive && !hasSessions;

              return (
                <div key={thread.id} className="mb-0.5">
                  {/* Thread row */}
                  <div className="group flex items-center gap-0.5">
                    {/* Chevron toggle */}
                    <button
                      className="flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground/40 transition hover:text-muted-foreground"
                      onClick={() => toggleCollapse(thread.id)}
                      title={isCollapsed ? "Expandir" : "Colapsar"}
                      type="button"
                    >
                      <ChevronRight
                        className={cn(
                          "size-3 transition-transform duration-150",
                          !isCollapsed && "rotate-90"
                        )}
                      />
                    </button>

                    <button
                      className={cn(
                        "flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-1.5 py-1.5 text-left transition",
                        isActive
                          ? "text-foreground"
                          : "text-foreground/80 hover:text-foreground hover:bg-foreground/5"
                      )}
                      onClick={() => {
                        setActiveThreadId(thread.id);
                        if (isSearching) closeSearch();
                      }}
                      type="button"
                    >
                      <FolderOpen className="size-3.5 shrink-0 text-muted-foreground/60" />
                      <span className="flex-1 truncate text-sm font-medium leading-tight">
                        {thread.title === "New thread" ? (
                          <span className="italic text-muted-foreground">Novo projecto</span>
                        ) : (
                          thread.title
                        )}
                      </span>
                      {isNewSessionActive && (
                        <span className="shrink-0 text-[10px] text-muted-foreground/50">New</span>
                      )}
                      {threadStatusDot(thread.status)}
                    </button>

                    <button
                      className="invisible size-6 shrink-0 inline-flex items-center justify-center rounded text-muted-foreground/50 transition hover:bg-destructive/10 hover:text-destructive group-hover:visible"
                      onClick={() => deleteThread(thread.id)}
                      title="Apagar projecto"
                      type="button"
                    >
                      <Trash2 className="size-3" />
                    </button>
                  </div>

                  {/* Session list */}
                  {!isCollapsed && (
                    <div className="ml-5 border-l border-border/40 pl-2 mt-0.5 mb-1 space-y-0.5">
                      {/* Nova sessão — desactivado se há sessão activa nesta thread */}
                      {(() => {
                        const threadIsRunning = isActive && isActiveSessionRunning;
                        return (
                          <button
                            className={cn(
                              "flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-xs transition",
                              isActive && !activeSessionId
                                ? "bg-foreground/8 text-foreground font-medium"
                                : "text-muted-foreground hover:text-foreground hover:bg-foreground/5",
                              threadIsRunning &&
                                "cursor-not-allowed opacity-40 hover:bg-transparent hover:text-muted-foreground"
                            )}
                            disabled={threadIsRunning}
                            onClick={() => {
                              if (threadIsRunning) return;
                              setActiveThreadId(thread.id);
                              setActiveSessionId("");
                            }}
                            title={threadIsRunning ? "Aguarda o fim da sessão activa" : undefined}
                            type="button"
                          >
                            <Plus className="size-3 shrink-0 opacity-60" />
                            <span className="flex-1 truncate leading-snug">Nova sessão</span>
                          </button>
                        );
                      })()}

                      {[...thread.sessions]
                        .sort((a, b) => b.updatedAt - a.updatedAt)
                        .map((session) => {
                          const isEditing =
                            editingSession?.threadId === thread.id &&
                            editingSession?.sessionId === session.id;

                          const commitEdit = () => {
                            if (!editingSession) return;
                            renameSession(thread.id, session.id, editingSession.value);
                            setEditingSession(null);
                          };

                          if (isEditing) {
                            return (
                              <div
                                key={session.id}
                                className="flex items-center gap-1.5 rounded-md px-2 py-1"
                              >
                                <MessageSquare className="size-3 shrink-0 opacity-50 text-muted-foreground" />
                                <input
                                  ref={editInputRef}
                                  className="flex-1 min-w-0 bg-transparent text-xs text-foreground outline-none border-b border-primary/60 leading-snug"
                                  value={editingSession.value}
                                  onChange={(e) =>
                                    setEditingSession((prev) =>
                                      prev ? { ...prev, value: e.target.value } : null
                                    )
                                  }
                                  onBlur={commitEdit}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") commitEdit();
                                    if (e.key === "Escape") setEditingSession(null);
                                  }}
                                />
                              </div>
                            );
                          }

                          const isRunning =
                            session.status === "running" || session.status === "awaiting_approval";
                          return (
                            <div key={session.id} className="group/sess flex items-center gap-0.5">
                              <button
                                className={cn(
                                  "flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-2 py-1 text-left text-xs transition",
                                  isActive
                                    ? "text-foreground/90 hover:bg-foreground/5"
                                    : "text-muted-foreground hover:text-foreground hover:bg-foreground/5",
                                  sessionStatusClass(session.status)
                                )}
                                onClick={() => {
                                  setActiveThreadId(thread.id);
                                  setActiveSessionId(session.id);
                                }}
                                onDoubleClick={(e) => {
                                  e.stopPropagation();
                                  setEditingSession({
                                    threadId: thread.id,
                                    sessionId: session.id,
                                    value: session.title
                                  });
                                  setTimeout(() => editInputRef.current?.select(), 0);
                                }}
                                type="button"
                              >
                                <MessageSquare className="size-3 shrink-0 opacity-50" />
                                <span className="flex-1 truncate leading-snug">
                                  {session.title}
                                </span>
                                <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground/50">
                                  {timeAgo(session.updatedAt)}
                                </span>
                              </button>
                              {!isRunning && (
                                <button
                                  className="invisible size-5 shrink-0 inline-flex items-center justify-center rounded text-muted-foreground/40 transition hover:bg-destructive/10 hover:text-destructive group-hover/sess:visible"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    deleteSession(thread.id, session.id);
                                  }}
                                  title="Apagar sessão"
                                  type="button"
                                >
                                  <Trash2 className="size-2.5" />
                                </button>
                              )}
                            </div>
                          );
                        })}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Settings collapsible panel */}
      <div
        className={cn(
          "overflow-hidden transition-[max-height] duration-200 ease-in-out border-t border-border/60 bg-white dark:bg-background",
          isSettingsOpen ? "max-h-[600px]" : "max-h-0 border-t-0"
        )}
      >
        {settingsContent}
      </div>

      {/* Footer */}
      <div className="flex items-center gap-1 border-t border-border/60 px-3 py-3">
        <button
          className={cn(
            "flex flex-1 items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition",
            isSettingsOpen
              ? "bg-foreground/8 text-foreground"
              : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
          )}
          onClick={() => setIsSettingsOpen((v) => !v)}
          type="button"
        >
          <Settings className="size-4 shrink-0" />
          <span>Settings</span>
        </button>
        <AnimatedThemeToggler className="flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-accent hover:text-foreground [&>svg]:size-4" />
      </div>
    </aside>
  );
}
