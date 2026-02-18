import { type ReactNode } from "react";
import logo from "@/assets/logo.png";
import {
  FolderOpen,
  FolderPlus,
  Globe,
  ListFilter,
  PanelLeftClose,
  Trash2,
  Workflow
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
  settingsMenu: ReactNode;
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
  settingsMenu
}: SidebarProps) {
  const threads = useChatStore((s) => s.threads);
  const activeThreadId = useChatStore((s) => s.activeThreadId);
  const setActiveThreadId = useChatStore((s) => s.setActiveThreadId);
  const createThread = useChatStore((s) => s.createThread);
  const deleteThread = useChatStore((s) => s.deleteThread);

  const setActiveSessionId = useChatStore((s) => s.setActiveSessionId);

  const sortedThreads = [...threads].sort((a, b) => b.updatedAt - a.updatedAt);

  if (!isOpen) return null;

  return (
    <aside className="absolute inset-y-0 left-0 z-40 flex h-full w-[280px] shrink-0 flex-col border-r border-border/70 bg-background/80 backdrop-blur-xl backdrop-saturate-150 lg:static lg:z-auto">
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
          <span className="text-xs font-medium text-muted-foreground/70 uppercase tracking-[0.08em]">
            Threads
          </span>
          <div className="flex items-center gap-0.5">
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
            <Button
              className="size-6 text-muted-foreground hover:text-foreground"
              size="icon-xs"
              title="Filtrar"
              type="button"
              variant="ghost"
            >
              <ListFilter className="size-3.5" />
            </Button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto px-2 pb-2">
          {sortedThreads.length === 0 ? (
            <p className="px-3 py-6 text-center text-xs text-muted-foreground">
              Sem projectos. Clica em <FolderPlus className="inline size-3" /> para criar um.
            </p>
          ) : (
            sortedThreads.map((thread) => {
              const isActive = thread.id === activeThreadId;

              return (
                <div key={thread.id} className="mb-0.5">
                  {/* Project row */}
                  <div className="group flex items-center gap-1">
                    <button
                      className={cn(
                        "flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left transition",
                        isActive
                          ? "text-foreground"
                          : "text-foreground/80 hover:text-foreground hover:bg-foreground/5"
                      )}
                      onClick={() => setActiveThreadId(thread.id)}
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
                      {thread.sessions.length === 0 && (
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
                  {thread.sessions.length > 0 && (
                    <div className="ml-3.5 border-l border-border/40 pl-2.5 mt-0.5 mb-1 space-y-0.5">
                      {[...thread.sessions]
                        .sort((a, b) => b.updatedAt - a.updatedAt)
                        .map((session) => (
                          <button
                            key={session.id}
                            className={cn(
                              "flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-xs transition",
                              isActive
                                ? "text-foreground/90 hover:bg-foreground/5"
                                : "text-muted-foreground hover:text-foreground hover:bg-foreground/5",
                              sessionStatusClass(session.status)
                            )}
                            onClick={() => {
                              setActiveThreadId(thread.id);
                              setActiveSessionId(session.id);
                            }}
                            type="button"
                          >
                            <span className="flex-1 truncate leading-snug">{session.title}</span>
                            <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground/50">
                              {timeAgo(session.updatedAt)}
                            </span>
                          </button>
                        ))}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center gap-1 border-t border-border/60 px-3 py-3">
        <div className="flex-1">{settingsMenu}</div>
        <AnimatedThemeToggler className="flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-accent hover:text-foreground [&>svg]:size-4" />
      </div>
    </aside>
  );
}
