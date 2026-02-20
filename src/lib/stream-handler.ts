import type {
  AgentSession,
  ChatStreamEvent,
  ContentBlock,
  Thread,
  ToolTimelineItem
} from "@/lib/chat-types";
import { normalizeToAcp } from "@/lib/acp-events";
import {
  appendReasoningLine,
  deriveThreadTitle,
  normalizeErrorMessage,
  patchSession,
  stripLoneSurrogates,
  summarizeToolInput,
  summarizeToolResult
} from "@/lib/chat-utils";
import { useSettingsStore } from "@/stores/settings-store";
import { useGitStore } from "@/stores/git-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useTeamStore } from "@/stores/team-store";
import { usePermissionsStore } from "@/stores/permissions-store";

// ---------------------------------------------------------------------------
// Module-level stream tracker (not reactive — just for routing events)
// ---------------------------------------------------------------------------

export const _activeStreams = new Map<string, { threadId: string; sessionId: string }>();

/** requestId → teamName for auto-resume streams (cleanup on run.done) */
export const _autoResumeTeams = new Map<string, string>();

// ---------------------------------------------------------------------------
// Minimal state shape needed by set/get (avoids circular dep with chat-store)
// ---------------------------------------------------------------------------

type S = { threads: Thread[]; slashCommands: string[] };
type Setter = (fn: (s: S) => Partial<S>) => void;
type Getter = () => S;

// ---------------------------------------------------------------------------
// Main factory
// ---------------------------------------------------------------------------

export function createStreamHandler(
  set: Setter,
  get: Getter,
  onRunDone?: (threadId: string, sessionId: string) => void
) {
  return (event: ChatStreamEvent) => {
    const acp = normalizeToAcp(event);

    // Session-level events — handled before location check
    switch (acp.type) {
      case "session.info":
        useSettingsStore.getState().setDynamicSessionInfo(acp.raw.models, acp.raw.account);
        return;
      case "session.auth_expired":
        if (acp.raw.error) useSettingsStore.getState().setAuthExpired(true);
        return;
      case "session.commands":
        if (acp.raw.commands.length > 0) {
          set((_s) => ({ slashCommands: Array.from(new Set(acp.raw.commands)) as string[] }));
        }
        return;
    }

    const location = _activeStreams.get(event.requestId);
    if (!location) return;
    const { threadId, sessionId } = location;

    switch (acp.type) {
      case "run.start": {
        set((s) => ({
          threads: patchSession(s.threads, threadId, sessionId, {
            isThinking: true,
            status: "running" as const,
            contentBlocks: [] as ContentBlock[]
          })
        }));
        // Record git HEAD hash at session start for session diff
        {
          const startThread = get().threads.find((t) => t.id === threadId);
          const startCwd = startThread?.workspaceDirs[0];
          if (startCwd) {
            void window.desktop.git
              .getHeadHash(startCwd)
              .then((hash) => {
                if (!hash) return;
                set((s) => ({
                  threads: patchSession(s.threads, threadId, sessionId, { sessionStartHash: hash })
                }));
              })
              .catch(() => {
                /* ignore */
              });
          }
        }
        return;
      }

      case "run.status": {
        set((s) => ({
          threads: patchSession(s.threads, threadId, sessionId, {
            contextUsage: acp.raw.context,
            permissionMode: acp.raw.permissionMode,
            updatedAt: Date.now()
          })
        }));
        return;
      }

      case "run.limits": {
        set((s) => ({
          threads: patchSession(s.threads, threadId, sessionId, {
            limitsWarning: {
              level: acp.raw.level,
              message: acp.raw.message,
              fiveHourPercent: acp.raw.fiveHourPercent,
              weeklyPercent: acp.raw.weeklyPercent
            }
          })
        }));
        return;
      }

      case "run.compact": {
        set((s) => ({
          threads: patchSession(s.threads, threadId, sessionId, (sess) => {
            const marker = {
              id: crypto.randomUUID(),
              role: "assistant" as const,
              content: "",
              compact: true as const
            };
            return {
              compactCount: sess.compactCount + 1,
              messages: [...sess.messages, marker],
              reasoningText: appendReasoningLine(sess.reasoningText, "⚡ Compactando conversa...")
            };
          })
        }));
        return;
      }

      case "run.permission_denied": {
        set((s) => ({
          threads: patchSession(s.threads, threadId, sessionId, (sess) => ({
            permissionDenials: [...new Set([...sess.permissionDenials, ...acp.raw.denials])]
          }))
        }));
        return;
      }

      case "run.subagent_start": {
        set((s) => ({
          threads: patchSession(s.threads, threadId, sessionId, (sess) => {
            const existingByToolUse = acp.raw.toolUseId
              ? sess.subagents.find((a) => a.toolUseId === acp.raw.toolUseId)
              : null;
            if (existingByToolUse) {
              return {
                subagents: sess.subagents.map((a) =>
                  a.toolUseId === acp.raw.toolUseId ? { ...a, taskId: acp.raw.taskId } : a
                )
              };
            }
            return {
              subagents: [
                ...sess.subagents,
                {
                  taskId: acp.raw.taskId,
                  description: acp.raw.description,
                  toolUseId: acp.raw.toolUseId,
                  status: "running" as const,
                  startedAt: Date.now()
                }
              ]
            };
          })
        }));
        return;
      }

      case "run.subagent_done": {
        set((s) => ({
          threads: patchSession(s.threads, threadId, sessionId, (sess) => ({
            subagents: sess.subagents.map((a) =>
              a.taskId === acp.raw.taskId || a.toolUseId === acp.raw.taskId
                ? { ...a, status: acp.raw.status, summary: acp.raw.summary, finishedAt: Date.now() }
                : a
            )
          }))
        }));
        return;
      }

      case "run.approval_request": {
        if (usePermissionsStore.getState().matchesRule(acp.raw.toolName, acp.raw.input)) {
          void window.desktop.chat.respondToApproval(acp.raw.approvalId, {
            behavior: "allow",
            updatedInput: acp.raw.input
          });
          return;
        }
        set((s) => ({
          threads: patchSession(s.threads, threadId, sessionId, {
            status: "awaiting_approval",
            pendingApproval: {
              approvalId: acp.raw.approvalId,
              toolName: acp.raw.toolName,
              input: acp.raw.input
            },
            pendingQuestion: null
          })
        }));
        return;
      }

      case "run.ask_user": {
        set((s) => ({
          threads: patchSession(s.threads, threadId, sessionId, {
            status: "awaiting_approval",
            pendingQuestion: {
              approvalId: acp.raw.approvalId,
              questions: acp.raw.input.questions
            },
            pendingApproval: null
          })
        }));
        return;
      }

      case "run.tool_use": {
        // TeamCreate: register team BEFORE the main set() to avoid state overwrite
        if (acp.raw.name === "TeamCreate") {
          const teamName = (acp.raw.input as Record<string, unknown> | null)?.team_name;
          if (typeof teamName === "string" && teamName) {
            set((s) => ({
              threads: patchSession(s.threads, threadId, sessionId, (sess) => ({
                teamNames: [...(sess.teamNames ?? []), teamName].filter(
                  (v, i, a) => a.indexOf(v) === i
                )
              }))
            }));
            setTimeout(() => {
              useTeamStore.getState().trackTeam(teamName);
            }, 600);
          }
        }

        set((s) => ({
          threads: patchSession(s.threads, threadId, sessionId, (sess) => {
            const currentItems = sess.toolTimeline;
            const nextSummary =
              acp.raw.name === "AskUserQuestion"
                ? JSON.stringify(acp.raw.input)
                : summarizeToolInput(acp.raw.input);
            // Store raw input only for file manipulation tools (diff display)
            const FILE_DIFF_TOOLS = new Set(["Edit", "Write", "MultiEdit"]);
            const rawInput =
              FILE_DIFF_TOOLS.has(acp.raw.name) && acp.raw.input ? acp.raw.input : undefined;

            const existingIndex = currentItems.findIndex(
              (item) => item.toolUseId === acp.raw.toolUseId
            );
            const nextItems: ToolTimelineItem[] =
              existingIndex >= 0
                ? currentItems.map((item, i) =>
                    i === existingIndex
                      ? {
                          ...item,
                          name: acp.raw.name,
                          inputSummary: nextSummary,
                          status: "pending" as const,
                          rawInput: rawInput ?? item.rawInput
                        }
                      : item
                  )
                : [
                    ...currentItems,
                    {
                      toolUseId: acp.raw.toolUseId,
                      name: acp.raw.name,
                      inputSummary: nextSummary,
                      resultSummary: "",
                      status: "pending" as const,
                      startedAt: acp.raw.timestamp,
                      finishedAt: null,
                      rawInput
                    }
                  ];

            // Track Task tool uses as subagents
            let nextSubagents = sess.subagents;
            if (
              acp.raw.name === "Task" &&
              !sess.subagents.some((a) => a.toolUseId === acp.raw.toolUseId)
            ) {
              const inp = acp.raw.input as Record<string, unknown> | null;
              const agentName = typeof inp?.name === "string" && inp.name ? inp.name : null;
              const rawDesc =
                typeof inp?.description === "string" && (inp.description as string).trim()
                  ? (inp.description as string).trim()
                  : typeof inp?.prompt === "string"
                    ? (inp.prompt as string).trim().slice(0, 80)
                    : "Subagente";
              const displayDesc = agentName ? `[${agentName}] ${rawDesc}` : rawDesc;
              nextSubagents = [
                ...sess.subagents,
                {
                  taskId: acp.raw.toolUseId,
                  description: displayDesc,
                  toolUseId: acp.raw.toolUseId,
                  status: "running" as const,
                  startedAt: acp.raw.timestamp
                }
              ];
            }

            // Build interleaved contentBlocks: snapshot text before this tool
            const prevBlocks = sess.contentBlocks ?? [];
            const textCommitted = prevBlocks
              .filter((b) => b.type === "text")
              .reduce((acc, b) => acc + (b as { type: "text"; text: string }).text.length, 0);
            const lastMsg = [...sess.messages].reverse().find((m) => m.role === "assistant");
            const textSoFar = lastMsg?.content ?? "";
            const newText = textSoFar.slice(textCommitted);
            const newBlocks: ContentBlock[] = [...prevBlocks];
            if (newText) newBlocks.push({ type: "text", text: newText });
            newBlocks.push({ type: "tool", toolUseId: acp.raw.toolUseId });

            return {
              toolTimeline: nextItems,
              subagents: nextSubagents,
              isThinking: true,
              status: "running" as const,
              contentBlocks: newBlocks,
              reasoningText: appendReasoningLine(sess.reasoningText, `⚙ ${acp.raw.name}...`)
            };
          })
        }));
        return;
      }

      case "run.tool_result": {
        set((s) => ({
          threads: patchSession(s.threads, threadId, sessionId, (sess) => {
            const currentItems = sess.toolTimeline;
            const resultSummary = summarizeToolResult(acp.raw.content);
            const nextStatus: ToolTimelineItem["status"] = acp.raw.isError ? "error" : "completed";
            const existingIndex = currentItems.findIndex(
              (item) => item.toolUseId === acp.raw.toolUseId
            );
            const nextItems: ToolTimelineItem[] =
              existingIndex >= 0
                ? currentItems.map((item, i) =>
                    i === existingIndex
                      ? {
                          ...item,
                          status: nextStatus,
                          resultSummary,
                          finishedAt: acp.raw.timestamp
                        }
                      : item
                  )
                : [
                    ...currentItems,
                    {
                      toolUseId: acp.raw.toolUseId,
                      name: "tool",
                      inputSummary: "No input payload.",
                      resultSummary,
                      status: nextStatus,
                      startedAt: acp.raw.timestamp,
                      finishedAt: acp.raw.timestamp
                    }
                  ];
            const isSpawned =
              typeof resultSummary === "string" && resultSummary.toLowerCase().includes("spawn");
            const nextSubagents = sess.subagents.map((a) => {
              if (a.toolUseId !== acp.raw.toolUseId) return a;
              if (!acp.raw.isError && isSpawned) return { ...a, status: "background" as const };
              return {
                ...a,
                status: acp.raw.isError ? ("failed" as const) : ("completed" as const),
                summary: resultSummary || undefined,
                finishedAt: acp.raw.timestamp
              };
            });

            const completedItem = currentItems.find((item) => item.toolUseId === acp.raw.toolUseId);
            const toolLabel = completedItem?.name ?? "tool";
            const shortResult = resultSummary ? resultSummary.slice(0, 60) : "";
            const completionLine = shortResult
              ? `✓ ${toolLabel}: ${shortResult}`
              : `✓ ${toolLabel}`;

            return {
              toolTimeline: nextItems,
              subagents: nextSubagents,
              reasoningText: appendReasoningLine(sess.reasoningText, completionLine)
            };
          })
        }));
        return;
      }

      case "run.delta": {
        set((s) => ({
          threads: patchSession(s.threads, threadId, sessionId, (sess) => {
            const lastAssistantIdx = [...sess.messages]
              .reverse()
              .findIndex((m) => m.role === "assistant");
            const streamingMsgIdx =
              lastAssistantIdx >= 0 ? sess.messages.length - 1 - lastAssistantIdx : -1;
            const safeContent = stripLoneSurrogates(acp.raw.content);
            const patchedMessages =
              streamingMsgIdx >= 0
                ? sess.messages.map((msg, i) =>
                    i === streamingMsgIdx ? { ...msg, content: safeContent } : msg
                  )
                : sess.messages;
            return {
              messages: patchedMessages,
              isThinking: false,
              updatedAt: Date.now(),
              title:
                sess.title === "New thread" || sess.title === "Session" || !sess.title
                  ? deriveThreadTitle(patchedMessages, sess.title)
                  : sess.title
            };
          })
        }));
        return;
      }

      case "run.done": {
        _activeStreams.delete(acp.raw.requestId);
        set((s) => ({
          threads: patchSession(s.threads, threadId, sessionId, (sess) => {
            const lastAssistantIdx = [...sess.messages]
              .reverse()
              .findIndex((m) => m.role === "assistant");
            const streamingMsgIdx =
              lastAssistantIdx >= 0 ? sess.messages.length - 1 - lastAssistantIdx : -1;
            const safeContent = stripLoneSurrogates(acp.raw.content);
            const patchedMessages =
              streamingMsgIdx >= 0
                ? sess.messages.map((msg, i) =>
                    i === streamingMsgIdx ? { ...msg, content: safeContent } : msg
                  )
                : sess.messages;
            // Finalize contentBlocks: append remaining text after last tool
            const prevBlocks = sess.contentBlocks ?? [];
            const hasToolBlocks = prevBlocks.some((b) => b.type === "tool");
            let finalBlocks: ContentBlock[] | undefined;
            if (hasToolBlocks) {
              const textCommitted = prevBlocks
                .filter((b) => b.type === "text")
                .reduce((acc, b) => acc + (b as { type: "text"; text: string }).text.length, 0);
              const remainingText = safeContent.slice(textCommitted);
              finalBlocks = remainingText
                ? [...prevBlocks, { type: "text", text: remainingText }]
                : prevBlocks;
            }

            // Freeze finalBlocks + relevant tool items into the last assistant message.
            // Tool items are snapshotted here so the message is self-contained even after
            // toolTimeline is reset on the next turn.
            const frozenMessages = (() => {
              if (streamingMsgIdx < 0 || !finalBlocks) return patchedMessages;
              const toolIds = new Set(
                finalBlocks.filter((b) => b.type === "tool").map((b) => b.toolUseId)
              );
              const contentBlockTools = sess.toolTimeline.filter((t) => toolIds.has(t.toolUseId));
              return patchedMessages.map((msg, i) =>
                i === streamingMsgIdx
                  ? { ...msg, contentBlocks: finalBlocks, contentBlockTools }
                  : msg
              );
            })();

            const prevCost = sess.accumulatedCostUsd ?? 0;
            const addCost = acp.raw.sessionCostUsd ?? 0;
            return {
              messages: frozenMessages,
              status: "done" as const,
              contentBlocks: finalBlocks,
              requestId: undefined,
              pendingApproval: null,
              pendingQuestion: null,
              isThinking: false,
              runningStartedAt: undefined,
              sessionCostUsd: acp.raw.sessionCostUsd ?? null,
              accumulatedCostUsd: prevCost + addCost,
              sessionId: acp.raw.sessionId ?? sess.sessionId,
              updatedAt: Date.now(),
              title:
                sess.title === "New thread" || sess.title === "Session" || !sess.title
                  ? deriveThreadTitle(patchedMessages, sess.title)
                  : sess.title,
              subagents: (sess.subagents ?? []).map((a: AgentSession["subagents"][number]) =>
                a.status === "running"
                  ? { ...a, status: "completed" as const, finishedAt: Date.now() }
                  : a
              )
            };
          })
        }));
        useSettingsStore.getState().setStatus(`Reply via ${acp.raw.provider}.`);
        try {
          const threads = get().threads;
          const threadForNotify = threads.find((t) => t.sessions.some((s) => s.id === sessionId));
          const sessionForNotify = threadForNotify?.sessions.find((s) => s.id === sessionId);
          void window.desktop.app?.notify({
            title: sessionForNotify?.title ?? "Sessão concluída",
            body: threadForNotify?.title ?? "O agente terminou."
          });
        } catch {
          // Ignore notification errors
        }
        const doneThread = get().threads.find((t) => t.sessions.some((s) => s.id === sessionId));
        const doneWorkspaceDir = doneThread?.workspaceDirs[0];
        void Promise.all([
          useSettingsStore.getState().refreshSettings(),
          useGitStore.getState().refreshGitSummary(doneWorkspaceDir),
          useGitStore.getState().refreshRecentCommits(doneWorkspaceDir),
          useWorkspaceStore.getState().refreshWorkspaceFileTree()
        ]);
        // Cleanup team files if this was an auto-resume stream
        const autoResumeTeam = _autoResumeTeams.get(acp.raw.requestId);
        if (autoResumeTeam) {
          _autoResumeTeams.delete(acp.raw.requestId);
          void window.desktop.teams.deleteTeam(autoResumeTeam);
        }
        onRunDone?.(threadId, sessionId);
        // Compute session changed files after session ends
        void (async () => {
          try {
            const doneThreadForDiff = get().threads.find((t) => t.id === threadId);
            const doneSessionForDiff = doneThreadForDiff?.sessions.find((s) => s.id === sessionId);
            const diffCwd = doneThreadForDiff?.workspaceDirs[0];
            if (!diffCwd) return;
            const startHash = doneSessionForDiff?.sessionStartHash ?? null;
            const fileObjs = await window.desktop.git.getChangedFiles(startHash, diffCwd);
            const filePaths = fileObjs.map((f) => f.path);
            if (filePaths.length > 0) {
              set((s) => ({
                threads: patchSession(s.threads, threadId, sessionId, {
                  sessionChangedFiles: filePaths
                })
              }));
            }
          } catch {
            /* ignore */
          }
        })();
        return;
      }

      case "run.aborted": {
        _activeStreams.delete(acp.raw.requestId);
        set((s) => ({
          threads: patchSession(s.threads, threadId, sessionId, (sess) => ({
            status: "idle" as const,
            requestId: undefined,
            pendingApproval: null,
            pendingQuestion: null,
            isThinking: false,
            runningStartedAt: undefined,
            queuedMessage: null,
            subagents: (sess.subagents ?? []).map((a) =>
              a.status === "running"
                ? { ...a, status: "stopped" as const, finishedAt: Date.now() }
                : a
            )
          }))
        }));
        useSettingsStore.getState().setStatus("Response interrupted.");
        return;
      }

      case "run.error": {
        _activeStreams.delete(acp.raw.requestId);
        const friendlyError = normalizeErrorMessage(acp.raw.error);
        const subtype = acp.raw.errorSubtype || "error";
        const baseMessage =
          subtype === "error_max_turns"
            ? "Limite de turnos atingido."
            : subtype === "error_max_budget_usd"
              ? "Limite de custo atingido."
              : friendlyError;
        set((s) => ({
          threads: patchSession(s.threads, threadId, sessionId, (sess) => {
            const lastAssistantIdx = [...sess.messages]
              .reverse()
              .findIndex((m) => m.role === "assistant");
            const streamingMsgIdx =
              lastAssistantIdx >= 0 ? sess.messages.length - 1 - lastAssistantIdx : -1;
            const patchedMessages =
              streamingMsgIdx >= 0
                ? sess.messages.map((msg, i) =>
                    i === streamingMsgIdx ? { ...msg, content: `Error: ${baseMessage}` } : msg
                  )
                : sess.messages;
            return {
              messages: patchedMessages,
              status: "error" as const,
              requestId: undefined,
              pendingApproval: null,
              pendingQuestion: null,
              isThinking: false,
              runningStartedAt: undefined,
              queuedMessage: null,
              updatedAt: Date.now(),
              subagents: (sess.subagents ?? []).map((a) =>
                a.status === "running"
                  ? { ...a, status: "failed" as const, finishedAt: Date.now() }
                  : a
              )
            };
          })
        }));
        useSettingsStore.getState().setStatus(baseMessage);
        return;
      }
    }
  };
}
