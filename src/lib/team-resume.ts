import type { AgentSession, TeamInboxMessage, TeamSnapshot, Thread } from "@/lib/chat-types";
import {
  makeMessage,
  normalizeErrorMessage,
  patchSession,
  stripLoneSurrogates
} from "@/lib/chat-utils";
import { _activeStreams, _autoResumeTeams } from "@/lib/stream-handler";
import { useSettingsStore } from "@/stores/settings-store";

// ---------------------------------------------------------------------------
// Minimal state shape needed by set/get (avoids circular dep with chat-store)
// ---------------------------------------------------------------------------

type S = { threads: Thread[]; activeThreadId: string; activeSessionId: string };
type Setter = (fn: (s: S) => Partial<S>) => void;
type Getter = () => S;

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

export function filterRealMessages(messages: TeamInboxMessage[]): TeamInboxMessage[] {
  return messages.filter((msg) => {
    try {
      const p = JSON.parse(msg.text) as Record<string, unknown>;
      return (
        p.type !== "idle_notification" &&
        p.type !== "permission_request" &&
        p.type !== "shutdown_request"
      );
    } catch {
      return true;
    }
  });
}

export function buildInboxText(messages: TeamInboxMessage[]): string {
  if (messages.length === 0) return "(sem mensagens dos agentes)";
  return messages
    .map((m) => {
      const text = stripLoneSurrogates(m.text.slice(0, 4000));
      return `**${m.from}:** ${text}`;
    })
    .join("\n\n");
}

const TEAM_PROMPT_SUFFIX =
  `Apresenta ao utilizador o conteúdo COMPLETO e DETALHADO do que cada agente reportou acima. ` +
  `Não faças meta-comentários do tipo "o agente gerou um relatório" ou "foram produzidos entregáveis" — ` +
  `mostra o conteúdo real: findings, análises, listas, código, recomendações, exactamente como os agentes os escreveram. ` +
  `Se um agente produziu uma lista de problemas, mostra essa lista. Se produziu recomendações, mostra essas recomendações. ` +
  `O utilizador não tem acesso às mensagens dos agentes — tu és o único canal para o conteúdo real deles. ` +
  `Não chames nenhuma tool de limpeza (TeamDelete, SendMessage, Bash) — foca-te apenas em apresentar os resultados.`;

function buildTeamDonePrompt(teamName: string, inboxText: string): string {
  return (
    `Os agentes do time "${teamName}" terminaram todas as tarefas.\n\n` +
    `Mensagens recebidas dos agentes:\n\n${inboxText}\n\n` +
    TEAM_PROMPT_SUFFIX
  );
}

function findSessionForTeam(
  threads: Thread[],
  teamName: string
): { foundThreadId: string; foundSession: AgentSession } | null {
  for (const thread of [...threads]) {
    for (const session of [...thread.sessions].reverse()) {
      if (session.teamNames?.includes(teamName)) {
        return { foundThreadId: thread.id, foundSession: session };
      }
    }
  }
  return null;
}

function applyRunningPatch(
  set: Setter,
  foundThreadId: string,
  sessionId: string,
  userMessage: ReturnType<typeof makeMessage>,
  assistantMessage: ReturnType<typeof makeMessage>,
  reasoningText: string
) {
  set((s) => ({
    threads: patchSession(s.threads, foundThreadId, sessionId, (sess) => ({
      messages: [...sess.messages, userMessage, assistantMessage],
      status: "running" as const,
      isThinking: true,
      reasoningText,
      toolTimeline: [],
      subagents: [],
      runningStartedAt: Date.now(),
      updatedAt: Date.now()
    }))
  }));
}

// ---------------------------------------------------------------------------
// handleTeamAllDone — called from initTeamCompletionListener
// ---------------------------------------------------------------------------

export function handleTeamAllDone(
  payload: TeamSnapshot & { teamName: string },
  set: Setter,
  get: Getter
): void {
  const teamName = payload.teamName;
  const { threads } = get();

  const found = findSessionForTeam(threads, teamName);
  if (!found) return;
  const { foundThreadId, foundSession } = found;
  if (foundSession.status === "running" || foundSession.status === "awaiting_approval") return;

  const threadWorkspaceDirs = threads.find((t) => t.id === foundThreadId)?.workspaceDirs ?? [];
  const leadInbox: TeamInboxMessage[] = payload.inboxes?.["team-lead"] ?? [];
  const realMessages = filterRealMessages(leadInbox);
  const inboxText = buildInboxText(realMessages);
  const prompt = buildTeamDonePrompt(teamName, inboxText);

  const userMessage = { ...makeMessage("user", prompt), hidden: true as const };
  const assistantMessage = makeMessage("assistant", "");
  const sessionId = foundSession.id;

  set((_s) => ({ activeThreadId: foundThreadId, activeSessionId: sessionId }) as Partial<S>);
  applyRunningPatch(
    set,
    foundThreadId,
    sessionId,
    userMessage,
    assistantMessage,
    "Recebendo resultados da equipa..."
  );

  const settings = useSettingsStore.getState().settings;
  if (!settings) return;

  void window.desktop.chat
    .startStream({
      messages: [{ id: userMessage.id, role: "user" as const, content: prompt }],
      effort: undefined,
      contextFiles: [],
      resumeSessionId: "",
      workspaceDirs: threadWorkspaceDirs
    })
    .then((started) => {
      _activeStreams.set(started.requestId, { threadId: foundThreadId, sessionId });
      _autoResumeTeams.set(started.requestId, teamName);
      set((s) => ({
        threads: patchSession(s.threads, foundThreadId, sessionId, {
          requestId: started.requestId
        })
      }));
      useSettingsStore.getState().setStatus(`Equipa ${teamName} concluída — a resumir...`);
    })
    .catch((error: Error) => {
      const messageText = normalizeErrorMessage(error.message);
      set((s) => ({
        threads: patchSession(s.threads, foundThreadId, sessionId, (sess) => ({
          messages: sess.messages.slice(0, -2),
          status: "error" as const,
          isThinking: false,
          reasoningText: ""
        }))
      }));
      useSettingsStore.getState().setStatus(messageText);
    });
}

// ---------------------------------------------------------------------------
// manualResumeForTeam — triggered by the "manual resume" button in team panel
// ---------------------------------------------------------------------------

export async function manualResumeForTeam(
  teamName: string,
  set: Setter,
  get: Getter
): Promise<void> {
  const { threads } = get();

  const found = findSessionForTeam(threads, teamName);
  if (!found) return;
  const { foundThreadId, foundSession } = found;
  if (foundSession.status === "running" || foundSession.status === "awaiting_approval") return;

  const threadWorkspaceDirs = threads.find((t) => t.id === foundThreadId)?.workspaceDirs ?? [];

  const teamSnap = await window.desktop.teams.getSnapshot(teamName);
  const leadInbox: TeamInboxMessage[] = teamSnap?.inboxes?.["team-lead"] ?? [];
  const realMessages = filterRealMessages(leadInbox);
  const inboxText = buildInboxText(realMessages);
  const prompt = buildTeamDonePrompt(teamName, inboxText);

  const userMessage = { ...makeMessage("user", prompt), hidden: true as const };
  const assistantMessage = makeMessage("assistant", "");
  const sessionId = foundSession.id;

  set((_s) => ({ activeThreadId: foundThreadId, activeSessionId: sessionId }) as Partial<S>);
  applyRunningPatch(
    set,
    foundThreadId,
    sessionId,
    userMessage,
    assistantMessage,
    "Recebendo resultados da equipa..."
  );

  const settings = useSettingsStore.getState().settings;
  if (!settings) return;

  try {
    const started = await window.desktop.chat.startStream({
      messages: [{ id: userMessage.id, role: "user" as const, content: prompt }],
      effort: undefined,
      contextFiles: [],
      resumeSessionId: "",
      workspaceDirs: threadWorkspaceDirs
    });
    _activeStreams.set(started.requestId, { threadId: foundThreadId, sessionId });
    _autoResumeTeams.set(started.requestId, teamName);
    set((s) => ({
      threads: patchSession(s.threads, foundThreadId, sessionId, {
        requestId: started.requestId
      })
    }));
    useSettingsStore.getState().setStatus(`A resumir resultados do time ${teamName}...`);
  } catch (error) {
    const messageText = normalizeErrorMessage((error as Error).message);
    set((s) => ({
      threads: patchSession(s.threads, foundThreadId, sessionId, (sess) => ({
        messages: sess.messages.slice(0, -2),
        status: "error" as const,
        isThinking: false,
        reasoningText: ""
      }))
    }));
    useSettingsStore.getState().setStatus(messageText);
  }
}

// ---------------------------------------------------------------------------
// resumeForTeamApprovals — triggered when team agents are blocked on permissions
// ---------------------------------------------------------------------------

export async function resumeForTeamApprovals(
  teamName: string,
  pendingAgents: string[],
  set: Setter,
  get: Getter
): Promise<void> {
  const { threads } = get();

  const found = findSessionForTeam(threads, teamName);
  if (!found) return;
  const { foundThreadId, foundSession } = found;
  if (foundSession.status === "running" || foundSession.status === "awaiting_approval") return;

  const threadWorkspaceDirs = threads.find((t) => t.id === foundThreadId)?.workspaceDirs ?? [];
  const agentsList = pendingAgents.join(", ");
  const prompt =
    `Os agentes do time "${teamName}" estão bloqueados à espera de aprovação de ferramentas.\n\n` +
    `Agentes com pedidos pendentes: ${agentsList}\n\n` +
    `Verifica a tua inbox do time, lê os pedidos de permissão e aprova os que são necessários para que os agentes possam continuar.`;

  const userMessage = makeMessage("user", prompt);
  const assistantMessage = makeMessage("assistant", "");
  const sessionId = foundSession.id;

  set((_s) => ({ activeThreadId: foundThreadId, activeSessionId: sessionId }) as Partial<S>);
  applyRunningPatch(
    set,
    foundThreadId,
    sessionId,
    userMessage,
    assistantMessage,
    "A processar aprovações pendentes..."
  );

  const settings = useSettingsStore.getState().settings;
  if (!settings) return;

  try {
    const started = await window.desktop.chat.startStream({
      messages: [{ id: userMessage.id, role: "user" as const, content: prompt }],
      effort: undefined,
      contextFiles: [],
      resumeSessionId: "",
      workspaceDirs: threadWorkspaceDirs
    });
    _activeStreams.set(started.requestId, { threadId: foundThreadId, sessionId });
    set((s) => ({
      threads: patchSession(s.threads, foundThreadId, sessionId, {
        requestId: started.requestId
      })
    }));
  } catch (error) {
    const messageText = normalizeErrorMessage((error as Error).message);
    set((s) => ({
      threads: patchSession(s.threads, foundThreadId, sessionId, (sess) => ({
        messages: sess.messages.slice(0, -2),
        status: "error" as const,
        isThinking: false,
        reasoningText: ""
      }))
    }));
    useSettingsStore.getState().setStatus(messageText);
  }
}
