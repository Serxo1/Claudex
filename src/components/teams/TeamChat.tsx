import { useEffect, useRef, useState } from "react";
import { Send, Users } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { TeamInboxMessage, TeamMember, TeamTask } from "@/lib/chat-types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TeamChatProps = {
  teamName: string;
  members: TeamMember[];
  tasks: TeamTask[];
  inboxes: Record<string, TeamInboxMessage[]>;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const AVATAR_COLORS = [
  "bg-blue-500/20 text-blue-700 dark:text-blue-300",
  "bg-violet-500/20 text-violet-700 dark:text-violet-300",
  "bg-emerald-500/20 text-emerald-700 dark:text-emerald-300",
  "bg-amber-500/20 text-amber-700 dark:text-amber-300",
  "bg-rose-500/20 text-rose-700 dark:text-rose-300",
  "bg-cyan-500/20 text-cyan-700 dark:text-cyan-300",
  "bg-orange-500/20 text-orange-700 dark:text-orange-300",
  "bg-indigo-500/20 text-indigo-700 dark:text-indigo-300"
];

function avatarColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) {
    h = (h << 5) - h + name.charCodeAt(i);
    h |= 0;
  }
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}

function initials(name: string): string {
  const parts = name.trim().split(/[-_\s]+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

function timeAgo(isoString: string | undefined): string {
  if (!isoString) return "";
  const ts = new Date(isoString).getTime();
  if (isNaN(ts)) return "";
  const diff = Date.now() - ts;
  if (diff < 60_000) return "agora";
  if (diff < 3_600_000) return `há ${Math.floor(diff / 60_000)}min`;
  if (diff < 86_400_000) return `há ${Math.floor(diff / 3_600_000)}h`;
  return `há ${Math.floor(diff / 86_400_000)}d`;
}

// ---------------------------------------------------------------------------
// Unified message aggregation
// ---------------------------------------------------------------------------

type UnifiedMsg = {
  key: string;
  from: string;
  to: string;
  text: string;
  summary?: string;
  timestamp: number;
  isUser: boolean; // from === "user" (sent via Claudex UI)
};

/**
 * Parse inbox message text to displayable content.
 * Returns null to filter out SDK-internal noise.
 */
function parseText(msg: TeamInboxMessage): string | null {
  try {
    const p = JSON.parse(msg.text) as Record<string, unknown>;
    const type = p.type as string | undefined;
    if (type === "idle_notification") return null;
    if (type === "permission_request") return null;
    if (type === "shutdown_request") return null;
    if (type === "plan_approval_request") return null;
    if (type === "message" && typeof p.content === "string")
      return (p.content as string).trim() || null;
    // Unknown JSON — use summary if available
    if (msg.summary) return msg.summary;
    return null;
  } catch {
    // Plain text
    return msg.summary || msg.text.slice(0, 500) || null;
  }
}

function aggregateMessages(inboxes: Record<string, TeamInboxMessage[]>): UnifiedMsg[] {
  const msgs: UnifiedMsg[] = [];
  // Deduplicate user broadcasts: same text sent to multiple agents within 5s
  const seenUserMsgs = new Set<string>();

  for (const [recipient, messages] of Object.entries(inboxes)) {
    messages.forEach((msg, idx) => {
      const text = parseText(msg);
      if (!text) return;

      const ts = msg.timestamp ? new Date(msg.timestamp).getTime() : 0;

      if (msg.from === "user") {
        const dedupKey = `${text}__${Math.floor(ts / 5000)}`;
        if (seenUserMsgs.has(dedupKey)) return;
        seenUserMsgs.add(dedupKey);
      }

      msgs.push({
        key: `${recipient}-${idx}-${msg.from}-${ts}`,
        from: msg.from,
        to: recipient,
        text,
        summary: msg.summary,
        timestamp: ts,
        isUser: msg.from === "user"
      });
    });
  }

  // Sort chronologically; fall back to insertion order for same timestamp
  return msgs.sort((a, b) => a.timestamp - b.timestamp);
}

// ---------------------------------------------------------------------------
// Typing indicator — shown when an agent has an active in_progress task
// ---------------------------------------------------------------------------

function TypingIndicator({ agentName }: { agentName: string }) {
  return (
    <div className="flex items-end gap-2">
      <Avatar className={cn("size-7 shrink-0", avatarColor(agentName))}>
        <AvatarFallback className={cn("text-[10px] font-bold", avatarColor(agentName))}>
          {initials(agentName)}
        </AvatarFallback>
      </Avatar>
      <div className="rounded-2xl rounded-bl-sm bg-muted px-3 py-2">
        <span className="text-[10px] text-muted-foreground/40 block mb-0.5">{agentName}</span>
        <span className="flex gap-1 items-center h-4">
          {[0, 200, 400].map((delay) => (
            <span
              key={delay}
              className="size-1.5 rounded-full bg-muted-foreground/40 animate-bounce"
              style={{ animationDelay: `${delay}ms` }}
            />
          ))}
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Single message bubble
// ---------------------------------------------------------------------------

function MessageBubble({ msg, tick }: { msg: UnifiedMsg; tick: number }) {
  void tick; // consumed to refresh timeAgo

  if (msg.isUser) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[75%]">
          <div className="rounded-2xl rounded-br-sm bg-primary px-3 py-2">
            <p className="text-[12px] text-primary-foreground leading-relaxed">{msg.text}</p>
          </div>
          <p className="mt-0.5 text-right text-[10px] text-muted-foreground/40">
            {timeAgo(new Date(msg.timestamp).toISOString())}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-end gap-2">
      <Avatar className={cn("size-7 shrink-0 text-[10px]", avatarColor(msg.from))}>
        <AvatarFallback className={cn("text-[10px] font-bold", avatarColor(msg.from))}>
          {initials(msg.from)}
        </AvatarFallback>
      </Avatar>
      <div className="max-w-[75%]">
        <p className="mb-0.5 text-[10px] text-muted-foreground/50 px-1">
          {msg.from}
          {msg.to !== "team-lead" && <span className="text-muted-foreground/30"> → {msg.to}</span>}
        </p>
        <div className="rounded-2xl rounded-bl-sm bg-muted px-3 py-2">
          <p className="text-[12px] text-foreground/80 leading-relaxed whitespace-pre-wrap break-words">
            {msg.text}
          </p>
        </div>
        <p className="mt-0.5 text-[10px] text-muted-foreground/40 px-1">
          {timeAgo(new Date(msg.timestamp).toISOString())}
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// TeamChat — exported component
// ---------------------------------------------------------------------------

export function TeamChat({ teamName, members, tasks, inboxes }: TeamChatProps) {
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [recipient, setRecipient] = useState<string>("__all__");
  const [tick, setTick] = useState(0);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Refresh timestamps every minute
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  const messages = aggregateMessages(inboxes);

  // Auto-scroll when new messages arrive
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  // Agents that currently have in_progress tasks
  const thinkingAgents = members
    .map((m) => m.name)
    .filter((name) => tasks.some((t) => t.status === "in_progress" && t.owner === name));

  // Active agents for the recipient select (non-lead, have tasks or inboxes)
  const activeAgents = members.filter(
    (m) =>
      m.agentType !== "team-lead" &&
      (tasks.some((t) => t.owner === m.name) || inboxes[m.name]?.length > 0)
  );

  // Online count: agents with in_progress tasks
  const onlineCount = thinkingAgents.length;

  const handleSend = async () => {
    const content = input.trim();
    if (!content || sending) return;

    setSending(true);
    try {
      if (recipient === "__all__") {
        // Broadcast to all active agents
        await Promise.all(
          activeAgents.map((a) =>
            window.desktop.teams.sendMessage({
              teamName,
              agentName: a.name,
              content
            })
          )
        );
      } else {
        await window.desktop.teams.sendMessage({
          teamName,
          agentName: recipient,
          content
        });
      }
      setInput("");
      inputRef.current?.focus();
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-border/30 px-3 py-2">
        <Users className="size-3.5 shrink-0 text-muted-foreground/60" />
        <span className="flex-1 text-xs font-semibold text-foreground/80 truncate">{teamName}</span>
        {onlineCount > 0 && (
          <Badge
            variant="outline"
            className="shrink-0 border-emerald-500/25 bg-emerald-500/10 px-1.5 py-0 text-[10px] text-emerald-600 dark:text-emerald-400"
          >
            <span className="mr-1 size-1.5 rounded-full bg-emerald-500 inline-block animate-pulse" />
            {onlineCount} activo{onlineCount !== 1 ? "s" : ""}
          </Badge>
        )}
      </div>

      {/* Messages */}
      <ScrollArea className="flex-1 min-h-0">
        <div className="space-y-3 px-3 py-3">
          {messages.length === 0 && (
            <p className="text-center text-[12px] text-muted-foreground/40 italic py-6">
              Nenhuma mensagem ainda. Inicia uma conversa abaixo.
            </p>
          )}

          {messages.map((msg) => (
            <MessageBubble key={msg.key} msg={msg} tick={tick} />
          ))}

          {/* Typing indicators for thinking agents */}
          {thinkingAgents.map((name) => (
            <TypingIndicator key={name} agentName={name} />
          ))}

          <div ref={bottomRef} />
        </div>
      </ScrollArea>

      {/* Input area */}
      <div className="flex items-center gap-1.5 border-t border-border/30 px-2 py-2">
        {/* Recipient select */}
        <Select value={recipient} onValueChange={setRecipient}>
          <SelectTrigger className="h-8 w-[110px] shrink-0 text-[11px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="z-[200]">
            <SelectItem value="__all__" className="text-[11px]">
              Todos
            </SelectItem>
            {activeAgents.map((a) => (
              <SelectItem key={a.agentId} value={a.name} className="text-[11px]">
                {a.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void handleSend();
            }
          }}
          placeholder={
            recipient === "__all__"
              ? "Mensagem para todos os agentes…"
              : `Mensagem para ${recipient}…`
          }
          className="h-8 flex-1 text-[12px]"
          disabled={sending}
        />

        <Button
          type="button"
          size="icon"
          variant={input.trim() ? "default" : "ghost"}
          className="size-8 shrink-0"
          disabled={!input.trim() || sending}
          onClick={() => void handleSend()}
        >
          <Send className="size-3.5" />
        </Button>
      </div>
    </div>
  );
}
