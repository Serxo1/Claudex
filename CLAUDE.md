# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Visão Geral

Aplicação desktop **"Claudex"** — wrapper visual para o **Claude Code CLI** (`@anthropic-ai/claude-agent-sdk`). Autentica exclusivamente via `claude login`. UI em português. Sem modo API key exposto na interface principal.

## Comandos Essenciais

```bash
npm install            # instalar dependências
npm run dev            # renderer (Vite :5173) + Electron em paralelo
npm run dist:win       # build de produção → MSI installer Windows
npm run typecheck      # tsc -b (sem emitir ficheiros)
npm start              # executar app já empacotado

npm test               # vitest run (uma vez)
npm run lint           # ESLint em src/
npm run lint:fix       # ESLint com auto-fix
npm run format         # Prettier em src/ e electron/
```

> **Pre-commit hook**: `lint-staged` corre Prettier + ESLint em `src/**/*.{ts,tsx}` e Prettier em `electron/**/*.cjs`.

## Arquitetura

### Processo Principal (Electron)

- **`electron/main.cjs`** — backend Node.js: settings (`userData/settings.json`, `safeStorage`), streaming SDK, workspace, Git, PTY, ACP servers, IPC handlers
- **`electron/preload.cjs`** — context bridge expondo `window.desktop.*` ao renderer
- **`electron/modules/chat.cjs`** — streaming SDK: `query()` de `@anthropic-ai/claude-agent-sdk`, tool timeline, subagents, logger. **SDK é `claude-agent-sdk`, não `claude-code`.**
- **`electron/modules/teams.cjs`** — watcher de `~/.claude/teams/` e `~/.claude/tasks/` via `fs.watch`; emite snapshots + `teams:allDone`; expõe `subscribe(callback)` para ACP gateways
- **`electron/modules/acp-server.cjs`** — servidor HTTP JSON-RPC 2.0 em `127.0.0.1:3579`; permite que editores externos (Zed, Neovim) usem o Electron como gateway Claude
- **`electron/modules/ibm-acp.cjs`** — REST+SSE gateway em `127.0.0.1:3580`; expõe snapshots de teams em tempo real e criação de sessões para clientes externos
- **`electron/modules/settings.cjs`** — leitura/escrita de `settings.json`; inclui `acpEnabled`, `acpPort`, `ibmAcpEnabled`, `ibmAcpPort`
- **`electron/modules/ide.cjs`** — detecção de IDEs: Cursor, VS Code, Windsurf, Zed, WebStorm; auto-detecção por comando ou path Windows/macOS

### Renderer (React + Vite) — Layout

```
App (100vh)
├─ Sidebar (280px, colapsável)
│  ├─ Header: logo + "Claudex" + collapse
│  ├─ "Nova Thread" button
│  ├─ Page nav: Chat | Preview (Globe) | Store (ShoppingBag)
│  ├─ Lista de Threads (Cmd+K para pesquisa inline)
│  └─ Settings panel (colapsável)
└─ Main (flex-1)
   ├─ HeaderBar
   ├─ Content:
   │  ├─ Left Panel (46% quando showRightPanel)
   │  │  └─ SessionStack → chat messages (virtualizado com react-virtuoso)
   │  └─ Right Panel (54%) — visível quando preview ativo ou editor tabs abertos
   │     ├─ WebPreview (Electron webview real, com barra URL + navegação)
   │     └─ Monaco Editor (tabs, auto-save)
   └─ Terminal (painel inferior, toggleável, PTY via node-pty)
```

**`showRightPanel`** = `activePage === "preview" || editorTabs.length > 0`

### Páginas principais

- **`chat`** (default) — chat + team panel + subagent timeline
- **`preview`** — browser real via Electron webview com back/forward/reload/URL bar
- **`store`** — marketplace de MCP servers, Skills e APIs (botão comentado na sidebar mas componente completo em `store-page.tsx`)

### Componentes-chave

- **`src/components/chat/chat-shell.tsx`** — orquestra stores, hooks, IPC listeners, layout
- **`src/components/chat/team-panel.tsx`** — UI completa de team agents: cards por agente, task board, aprovação de permissões, mensagens directas, botão manual resume
- **`src/components/chat/store-page.tsx`** — marketplace: filtros por categoria, instalar/desinstalar plugins, search, badges
- **`src/components/chat/prompt-area.tsx`** — área de input com suporte a attachments, context files, imagens coladas
- **`src/components/ai-elements/web-preview.tsx`** — webview browser com histórico e console
- **`src/components/ui/`** — shadcn/ui (style "new-york", Tailwind v4)
- **`src/components/ai-elements/`** — 65+ componentes de IA: artifacts, code-block (Shiki), reasoning, subagent-timeline, tool, etc.

### State Management (Zustand)

- **`src/stores/chat-store.ts`** — threads, sessions, streaming, aprovações, `teamNames` por sessão, auto-resume de teams, `manualResumeForTeam()`
- **`src/stores/settings-store.ts`** — settings, modelos dinâmicos, auth, `claudeCodeReady`, `acpStatus`, `ibmAcpStatus`, `setAcpConfig()`, `refreshAcpStatus()`
- **`src/stores/team-store.ts`** — snapshots activos; `sessionTeams: Set<string>` (guard contra snapshots de sessões antigas)
- **`src/stores/workspace-store.ts`** — file tree, editor tabs (Monaco), IDEs
- **`src/stores/git-store.ts`** — resumo Git, commits recentes
- **`src/stores/permissions-store.ts`** — permissões de ferramentas do Claude CLI

### Hooks

- **`src/hooks/use-terminal.ts`** — sessão PTY + XTerm.js
- **`src/hooks/use-preview.ts`** — controlo do webview (URL, navegação, histórico)
- **`src/hooks/use-workspace.ts`**, **`use-git.ts`**, **`use-settings.ts`** — helpers de domínio

### IPC (`window.desktop.*`)

| Namespace | Responsabilidade |
|-----------|-----------------|
| `settings.*` | Configurações, auth, `setAcpConfig` |
| `workspace.*` | File tree, contexto, IDE |
| `git.*` | Status, commits, PRs |
| `terminal.*` | Sessões PTY |
| `chat.*` | Streaming de mensagens |
| `ide.*` | Detecção e abertura de IDEs |
| `teams.*` | Snapshots, `onSnapshot`, `onAllDone`, permissões, mensagens |
| `acp.*` | Status e config do ACP server (porta 3579) |
| `ibmAcp.*` | Status do IBM ACP gateway (porta 3580) |

### Streaming de Chat

SDK mode usa `query()` de **`@anthropic-ai/claude-agent-sdk`** (não `claude-code`). Eventos via `chat:streamEvent`:

- `start` / `delta` / `done` / `error` / `aborted`
- `toolUse` / `toolResult` — tool timeline
- `status` — modo de permissão + tokens
- `limits` — avisos de quota (5-hour/weekly)
- `sessionInfo` — modelos dinâmicos + conta (via `q.initializationResult()`)
- `authStatus` — auth expirada
- `subagentStart` / `subagentDone` — subagentes síncronos
- `compactBoundary` / `permissionDenials` / `approvalRequest` / `askUser`

## Sistema de Team Agents

Coordenação via ficheiros em `~/.claude/`:

```
~/.claude/teams/{team}/config.json          → membros, leadAgentId, leadSessionId
~/.claude/teams/{team}/inboxes/{agent}.json → mensagens entre agentes
~/.claude/tasks/{team}/{id}.json            → tasks (pending/in_progress/completed/deleted)
```

**Fluxo:**
1. `TeamCreate` tool → `chat-store` regista `teamName` em `session.teamNames[]` + chama `trackTeam()` após 600 ms
2. `trackTeam` adiciona o team a `sessionTeams`, carrega snapshot inicial, activa watcher
3. `teams.cjs` emite `teams:snapshot` a cada mudança (debounce 200 ms) + chama `_subscribers` (ACP gateways)
4. Quando todas as tasks completam/deletam → `teams:allDone` (uma única vez por `_notifiedComplete`)
5. `chat-store.initTeamCompletionListener` recebe `allDone` → resume sessão com conteúdo real das inboxes

**Mensagens de inbox a filtrar:** `idle_notification`, `permission_request`, `shutdown_request`

**`SubagentInfo.status`:** `"background"` = team agent (spawn-and-detach); `"running"` = subagente síncrono

**Team Panel UI** (`team-panel.tsx`):
- Cards por agente com tasks activas, contador, últimas mensagens, input de mensagem directa
- Task board agrupado por status
- Aprovação de permissões com timeout de 2 min
- Botão "manual resume" quando team para mas tem mensagens reais

## ACP Servers (infraestrutura para clientes externos)

- **ACP Server** (`127.0.0.1:3579`) — JSON-RPC 2.0 para editores externos (Zed, Neovim) criarem sessões Claude via o Electron
- **IBM ACP Gateway** (`127.0.0.1:3580`) — REST+SSE para monitorização de teams por scripts externos
- Ambos arrancam automaticamente; configuráveis via Settings panel (toggle + porta)
- Cleanup completo no `before-quit` com `closeAllConnections()`

## Patterns Importantes

### `sanitizeSession` — Persistência em localStorage

`sanitizeSession` em `chat-store.ts` é o único local onde campos de `AgentSession` são restaurados do localStorage. **Ao adicionar um novo campo persistido a `AgentSession`, é obrigatório adicioná-lo aqui.** Campos voláteis são sempre limpos no load.

### Zustand — Nunca chamar `set()` dentro de outro `set()`

Causa overwrite silencioso. Side-effects (`set()`, `setTimeout`) devem estar **fora** do callback de derivação de estado.

### Session Resume

`AgentSession.sessionId` (UUID do SDK) passado como `resumeSessionId` no `startStream`. Resetado em erros de sessão inválida/expirada.

### Terminal PTY

Prioriza `node-pty`; fallback para pipes stdio. Shell: `$SHELL` → `/bin/zsh` → `/bin/bash`.

### Git Operations

`runCommand` com timeouts. PR via `gh pr create --fill`. Commits fazem `git add -A` implicitamente.

## Stack Tecnológico

**Electron 37** · **React 19** · **Vite 7** · **TypeScript 5.9** · **Tailwind CSS 4** · **Zustand 5** · **Monaco Editor** · **XTerm.js** · **Shiki** · **Streamdown** · **XyFlow** · **react-virtuoso** · **Vitest**

## Build & Packaging

- `npm run dist:win` → MSI Windows via electron-builder
- `asarUnpack`: `node-pty` e `@anthropic-ai/claude-agent-sdk` (necessário para Windows ASAR)
- Dev server porta fixa 5173 (`--strictPort`); Electron espera via `wait-on`
- DevTools abrem automaticamente em janela separada em dev
- Ficheiros `.cjs` no processo principal: CommonJS puro (sem ESM)
