import { useState, useRef, useCallback, useMemo, useEffect } from "react";
import { Search } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { useChatStore } from "@/stores/chat-store";
import type { AgentSession } from "@/lib/chat-types";

type ThreadSearchProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (threadId: string, sessionId?: string) => void;
};

type SearchResult = {
  threadId: string;
  sessionId?: string;
  threadTitle: string;
  sessionTitle: string;
  excerpt: string;
};

const MAX_RESULTS = 12;
const RECENT_COUNT = 8;
const EXCERPT_LEN = 80;
const SEARCH_CONTENT_LEN = 300;

function getLastMessageContent(session: AgentSession): string {
  const msgs = session.messages;
  if (msgs.length === 0) return "";
  return msgs[msgs.length - 1].content.slice(0, SEARCH_CONTENT_LEN);
}

function highlightMatch(text: string, query: string): React.ReactNode {
  if (!query) return text;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return text;
  return (
    <>
      {text.slice(0, idx)}
      <span className="bg-yellow-500/30 text-foreground">
        {text.slice(idx, idx + query.length)}
      </span>
      {text.slice(idx + query.length)}
    </>
  );
}

function buildExcerpt(text: string, query: string): string {
  if (!query) return text.slice(0, EXCERPT_LEN);
  const lower = text.toLowerCase();
  const idx = lower.indexOf(query.toLowerCase());
  if (idx === -1) return text.slice(0, EXCERPT_LEN);
  const start = Math.max(0, idx - 20);
  const end = Math.min(text.length, start + EXCERPT_LEN);
  let excerpt = text.slice(start, end);
  if (start > 0) excerpt = "..." + excerpt;
  if (end < text.length) excerpt = excerpt + "...";
  return excerpt;
}

export function ThreadSearch({ open, onOpenChange, onSelect }: ThreadSearchProps) {
  const threads = useChatStore((s) => s.threads);
  const [query, setQuery] = useState("");
  const [activeIdx, setActiveIdx] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Reset state when opening
  useEffect(() => {
    if (open) {
      setQuery("");
      setActiveIdx(0);
    }
  }, [open]);

  const results = useMemo((): SearchResult[] => {
    const q = query.trim().toLowerCase();

    if (!q) {
      // Show most recent threads
      const sorted = [...threads].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, RECENT_COUNT);
      return sorted.map((t) => ({
        threadId: t.id,
        threadTitle: t.title,
        sessionTitle: t.sessions.length > 0 ? t.sessions[t.sessions.length - 1].title : "",
        excerpt: ""
      }));
    }

    const matches: SearchResult[] = [];

    for (const thread of threads) {
      if (matches.length >= MAX_RESULTS) break;

      // Match on thread title
      if (thread.title.toLowerCase().includes(q)) {
        matches.push({
          threadId: thread.id,
          threadTitle: thread.title,
          sessionTitle:
            thread.sessions.length > 0 ? thread.sessions[thread.sessions.length - 1].title : "",
          excerpt: buildExcerpt(thread.title, query)
        });
        continue;
      }

      // Match on sessions
      for (const session of thread.sessions) {
        if (matches.length >= MAX_RESULTS) break;

        const lastContent = getLastMessageContent(session);
        const sessionMatch = session.title.toLowerCase().includes(q);
        const contentMatch = lastContent.toLowerCase().includes(q);

        if (sessionMatch || contentMatch) {
          matches.push({
            threadId: thread.id,
            sessionId: session.id,
            threadTitle: thread.title,
            sessionTitle: session.title,
            excerpt: contentMatch
              ? buildExcerpt(lastContent, query)
              : buildExcerpt(session.title, query)
          });
          break;
        }
      }
    }

    return matches;
  }, [threads, query]);

  // Keep activeIdx in bounds
  useEffect(() => {
    if (activeIdx >= results.length) {
      setActiveIdx(Math.max(0, results.length - 1));
    }
  }, [results.length, activeIdx]);

  const handleSelect = useCallback(
    (result: SearchResult) => {
      onSelect(result.threadId, result.sessionId);
      onOpenChange(false);
    },
    [onSelect, onOpenChange]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIdx((i) => Math.min(i + 1, results.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIdx((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (results[activeIdx]) {
          handleSelect(results[activeIdx]);
        }
      }
    },
    [results, activeIdx, handleSelect]
  );

  // Scroll active item into view
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const item = list.children[activeIdx] as HTMLElement | undefined;
    item?.scrollIntoView({ block: "nearest" });
  }, [activeIdx]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md gap-0 p-0" showCloseButton={false}>
        <DialogHeader className="sr-only">
          <DialogTitle>Pesquisar threads</DialogTitle>
          <DialogDescription>Busca por threads e sessoes de chat</DialogDescription>
        </DialogHeader>

        {/* Search input */}
        <div className="flex items-center gap-2 border-b border-border/70 px-3 py-2.5">
          <Search className="size-4 shrink-0 text-muted-foreground" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActiveIdx(0);
            }}
            onKeyDown={handleKeyDown}
            placeholder="Pesquisar threads..."
            autoFocus
            className="flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
          />
        </div>

        {/* Results */}
        <div ref={listRef} className="max-h-80 overflow-y-auto py-1" role="listbox">
          {results.length === 0 && query.trim() && (
            <div className="px-3 py-6 text-center text-sm text-muted-foreground">
              Nenhum resultado encontrado
            </div>
          )}
          {results.map((result, idx) => (
            <button
              key={`${result.threadId}-${result.sessionId ?? "t"}`}
              type="button"
              role="option"
              aria-selected={idx === activeIdx}
              className={cn(
                "flex w-full flex-col gap-0.5 px-3 py-2 text-left transition-colors",
                idx === activeIdx ? "bg-accent text-accent-foreground" : "hover:bg-muted/50"
              )}
              onClick={() => handleSelect(result)}
              onMouseEnter={() => setActiveIdx(idx)}
            >
              <div className="flex items-baseline gap-1.5">
                <span className="truncate text-sm font-medium">
                  {highlightMatch(result.threadTitle, query)}
                </span>
                {result.sessionTitle && (
                  <span className="truncate text-xs text-muted-foreground">
                    / {highlightMatch(result.sessionTitle, query)}
                  </span>
                )}
              </div>
              {result.excerpt && (
                <span className="truncate text-xs text-muted-foreground">
                  {highlightMatch(result.excerpt, query)}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Footer hint */}
        <div className="flex items-center gap-3 border-t border-border/70 px-3 py-1.5 text-[10px] text-muted-foreground">
          <span>
            <kbd className="rounded border border-border/60 px-1 font-mono">↑↓</kbd> navegar
          </span>
          <span>
            <kbd className="rounded border border-border/60 px-1 font-mono">↵</kbd> seleccionar
          </span>
          <span>
            <kbd className="rounded border border-border/60 px-1 font-mono">esc</kbd> fechar
          </span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
