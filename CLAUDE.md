# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Visão Geral

Aplicação desktop estilo Claude usando Electron + React. Autentica exclusivamente via **Claude CLI** (sessão de login do utilizador — `claude /login`). Não há modo API key exposto na UI.

## Comandos Essenciais

```bash
npm install            # instalar dependências
npm run dev            # renderer (Vite :5173) + Electron em paralelo
npm run build          # build de produção (renderer → dist/, depois Electron empacota)
npm run typecheck      # tsc -b (sem emitir ficheiros)
npm start              # executar app já empacotado

npm test               # vitest run (uma vez)
npm run test:watch     # vitest em modo watch

npm run lint           # ESLint em src/
npm run lint:fix       # ESLint com auto-fix
npm run format         # Prettier em src/ e electron/
npm run format:check   # verificar formatação sem alterar
```

> **Pre-commit hook**: `lint-staged` corre Prettier + ESLint em `src/**/*.{ts,tsx}` e Prettier em `electron/**/*.cjs` a cada commit.

## Arquitetura

### Processo Principal (Electron)

- **`electron/main.cjs`** — backend Node.js: configurações (`userData/settings.json`, `safeStorage`), streaming SDK, workspace, Git, PTY, IPC handlers
- **`electron/preload.cjs`** — context bridge expondo `window.desktop.*` ao renderer
- **`electron/modules/chat.cjs`** — lógica de streaming SDK: `query()`, tool timeline, subagents, team detection, logger
- **`electron/modules/teams.cjs`** — watcher de `~/.claude/teams/` e `~/.claude/tasks/` via `fs.watch`; emite snapshots + evento `teams:allDone` quando todas as tasks completam

### Renderer (React + Vite)

- **`src/App.tsx`** → `<ChatShell />` (único ponto de entrada)
- **`src/components/chat/chat-shell.tsx`** — orquestra stores, hooks, terminal, editor Monaco, painel de preview; inicializa todos os listeners IPC
- **`src/components/ui/`** — shadcn/ui (style "new-york", Tailwind v4)
- **`src/components/ai-elements/`** — componentes específicos de IA (artifacts, code-block, reasoning, subagent-timeline, etc.)
- **`src/components/chat/`** — componentes de chat: `chat-messages.tsx`, `team-panel.tsx`, `subagent-timeline.tsx`, `prompt-area.tsx`, etc.

### State Management (Zustand)

- **`src/stores/chat-store.ts`** — threads, sessions, streaming, aprovações, team names por sessão, auto-resume de equipas
- **`src/stores/settings-store.ts`** — configurações, modelos dinâmicos, estado de auth, `claudeCodeReady`
- **`src/stores/team-store.ts`** — snapshots de equipas activas; `sessionTeams: Set<string>` guarda quais teams pertencem à sessão actual
- **`src/stores/workspace-store.ts`** — árvore de ficheiros, editor tabs (Monaco), IDEs
- **`src/stores/git-store.ts`** — resumo Git e commits recentes
- **`src/stores/permissions-store.ts`** — permissões de ferramentas do Claude CLI

### Hooks

- **`src/hooks/use-terminal.ts`** — sessão PTY + XTerm.js
- **`src/hooks/use-preview.ts`** — Web Preview embutido
- **`src/hooks/use-workspace.ts`**, **`use-git.ts`**, **`use-settings.ts`** — helpers de domínio

### IPC (`window.desktop.*`)

| Namespace | Responsabilidade |
|-----------|-----------------|
| `settings.*` | Configurações e autenticação |
| `workspace.*` | Árvore de ficheiros, contexto, IDE |
| `git.*` | Status, commits, PRs |
| `terminal.*` | Sessões PTY |
| `chat.*` | Streaming de mensagens |
| `ide.*` | Detecção e abertura de IDEs |
| `teams.*` | Snapshots de equipas, `onSnapshot`, `onAllDone` |

### Streaming de Chat

SDK mode (Claude CLI) usa `query()` da `@anthropic-ai/claude-code`. Eventos enviados via `chat:streamEvent`:

- `start` / `delta` / `done` / `error` / `aborted`
- `toolUse` / `toolResult` — tool timeline
- `status` — modo de permissão + uso de tokens
- `limits` — avisos de quota (5-hour/weekly)
- `sessionInfo` — modelos dinâmicos + info de conta (via `q.initializationResult()`)
- `authStatus` — detecção de auth expirada
- `subagentStart` / `subagentDone` — subagentes síncronos
- `compactBoundary` / `permissionDenials` / `approvalRequest` / `askUser`

`startStream` no `chat.cjs` usa `query()` de `@anthropic-ai/claude-code`; o SDK escreve os ficheiros de coordenação do team agents automaticamente.

## Sistema de Team Agents

Os agentes de equipa coordenam-se via ficheiros em `~/.claude/`:

```
~/.claude/teams/{team}/config.json          → membros, leadAgentId, leadSessionId
~/.claude/teams/{team}/inboxes/{agent}.json → mensagens entre agentes
~/.claude/tasks/{team}/{id}.json            → tasks com status (pending/in_progress/completed/deleted)
```

**Fluxo:**
1. `TeamCreate` tool → `chat-store` regista o `teamName` em `session.teamNames[]` + chama `useTeamStore.getState().trackTeam(teamName)` após 600 ms
2. `trackTeam` adiciona o team a `sessionTeams` (guard contra snapshots de sessões antigas), carrega snapshot inicial e activa o watcher
3. `teams.cjs` emite `teams:snapshot` a cada mudança (debounce 200 ms)
4. Quando todas as tasks passam a `completed`/`deleted`, emite `teams:allDone` (uma única vez por `_notifiedComplete` Set)
5. `chat-store.initTeamCompletionListener` recebe `allDone` → resume automaticamente a sessão que criou a equipa com o conteúdo real da inbox (filtrando `idle_notification` e `permission_request`)

**Mensagens de inbox a filtrar (ruído SDK):** `idle_notification`, `permission_request`, `shutdown_request` — não são mensagens reais dos agentes.

**`SubagentInfo.status`** tem o valor `"background"` para agentes de equipa (spawn-and-detach); `"running"` é apenas para subagentes síncronos que aguardam resultado.

## Patterns Importantes

### `sanitizeSession` — Persistência em localStorage

`sanitizeSession` em `chat-store.ts` é o único local onde campos de `AgentSession` são restaurados do localStorage. **Ao adicionar um novo campo persistido a `AgentSession`, é obrigatório adicioná-lo aqui.** Campos voláteis (stream activo, approval pendente) são sempre limpos no load.

### Zustand — Nunca chamar `set()` dentro de outro `set()`

Chamar `set()` dentro do callback de outro `set()` causa overwrite silencioso: o `set()` exterior captura o estado em t0 e o seu resultado sobrescreve as alterações feitas pelo `set()` interior. Side-effects (chamadas a `set()`, `setTimeout`) devem estar **fora** do callback de derivação de estado.

### Session Resume

Claude CLI mantém `sessionId` (UUID da sessão SDK) em `AgentSession.sessionId`. Ao retomar uma sessão, passa-se como `resumeSessionId` no `startStream`. Resetado em erros de sessão inválida/expirada.

### Terminal PTY

Prioriza `node-pty`; fallback para pipes stdio. Shell: `$SHELL` → `/bin/zsh` → `/bin/bash`.

### Git Operations

`runCommand` com timeouts. PR creation via `gh pr create --fill`. Commits fazem `git add -A` implicitamente.

## Stack Tecnológico

**Electron 37** · **React 19** · **Vite 7** · **TypeScript 5.9** · **Tailwind CSS 4** · **Zustand 5** · **Monaco Editor** · **XTerm.js** · **Shiki** · **Streamdown** · **XyFlow** · **Vitest**

## Notas de Desenvolvimento

- Dev server porta fixa 5173 (`--strictPort`); Electron espera via `wait-on`
- DevTools abrem automaticamente em janela separada em modo dev
- Build: renderer → `dist/`, Electron carrega de lá em produção
- Ficheiros `.cjs` no processo principal: CommonJS puro (sem ESM, sem imports TypeScript)
