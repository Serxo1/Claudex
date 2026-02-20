# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Visão Geral

Aplicação desktop **"Claudex"** — wrapper visual para o **Claude Code CLI** (`@anthropic-ai/claude-agent-sdk`). Autentica exclusivamente via `claude login`. UI em português. Sem modo API key exposto na interface principal.

## Comandos Essenciais

```bash
npm install            # instalar dependências
npm run dev            # renderer (Vite :5173) + Electron em paralelo
npm run dist:win       # build de produção → NSIS + MSI installer Windows
npm run dist:mac       # build de produção → DMG macOS (arm64 + x64)
npm run typecheck      # tsc -b (sem emitir ficheiros)
npm start              # executar app já empacotado

npm test               # vitest run (uma vez)
npm run lint           # ESLint em src/
npm run lint:fix       # ESLint com auto-fix
npm run format         # Prettier em src/ e electron/
```

> **Pre-commit hook**: `lint-staged` corre Prettier + ESLint em `src/**/*.{ts,tsx}` e Prettier em `electron/**/*.cjs`.

## Fluxo Git & Releases

**Repo**: `https://github.com/Serxo1/Claudex` · branch principal: `main`

### Commit e push normal

```bash
npm run typecheck          # verificar antes de commitar
git add <ficheiros>
git commit -m "tipo: descrição"
git push origin <branch>
```

### Criar um release público (CI faz build automático)

```bash
# 1. Actualizar version em package.json (ex: "0.1.0" → "0.2.0")
# 2. Commit + tag + push
git add package.json
git commit -m "chore: release v0.2.0"
git tag v0.2.0
git push origin main --tags
```

O GitHub Actions (`.github/workflows/release.yml`) faz build Windows + macOS e publica o GitHub Release automaticamente. O `electron-updater` nos clientes detecta o novo release via `GH_TOKEN` (secret configurado no repo).

> **Nunca fazer force-push em `main`** — os instaladores publicados referenciam os commits por hash.

## Peculiaridades da Build (electron-builder)

### Ícones

- O campo `icon` aceita **PNG** — o electron-builder converte automaticamente para `.icns` (macOS) e `.ico` (Windows).
- **Nunca** referenciar `.png` em `nsis.installerIcon` / `nsis.uninstallerIcon` — o NSIS exige `.ico` e falha com "invalid icon file". Omitir essas propriedades; o electron-builder usa o ícone principal convertido.
- Se quiseres um ícone `.ico` personalizado para o instalador, gera-o manualmente com ImageMagick e coloca em `build/icon.ico`.

### Code signing Windows

- As propriedades `certificateFile` e `signingHashAlgorithms` **não existem** no schema do electron-builder 26.x.
- Os campos correctos são `cscLink` (path ou base64 do `.pfx`) e `cscKeyPassword`. Colocá-los em `win` no `package.json` ou via env vars `CSC_LINK` / `CSC_KEY_PASSWORD`.
- Sem certificado: não adicionar essas propriedades — a build funciona sem assinatura, apenas com aviso de segurança no Windows.

### Code signing + Notarização macOS

- Requer certificado **"Developer ID Application"** da Apple Developer account exportado como `.p12`.
- Notarização é feita automaticamente via `mac.notarize: true` no `package.json` (electron-builder 26.x). **Não usar objecto** `{ teamId: "..." }` — essa sintaxe não é válida nesta versão e quebra também a build Windows.
- Secrets necessários no GitHub Actions (e localmente para `dist:mac`):
  - `CSC_LINK` — base64 do `.p12`: `base64 -i cert.p12 | tr -d '\n'`
  - `CSC_KEY_PASSWORD` — password do `.p12`
  - `APPLE_ID` — email da Apple Developer account
  - `APPLE_APP_SPECIFIC_PASSWORD` — gerado em appleid.apple.com → App-Specific Passwords
  - `APPLE_TEAM_ID` — Team ID em developer.apple.com/account → Membership
- `hardenedRuntime: true` e o `build/entitlements.mac.plist` são **obrigatórios** para a notarização aceitar o binário.
- Sem esses secrets: a build compila mas o Gatekeeper bloqueia a abertura no macOS.

### SDK e dependências nativas

- `@anthropic-ai/claude-agent-sdk` está **pinned** sem `^` (`"0.2.45"`) — não fazer upgrade automático; testar manualmente antes de alterar.
- `node-pty` e `@anthropic-ai/claude-agent-sdk` estão em `asarUnpack` — **obrigatório** para funcionarem fora do ASAR no Windows.
- `electron-updater` tem de estar em `dependencies` (não `devDependencies`) para o electron-builder o incluir no pacote.

### GitHub Actions

- O workflow só dispara em tags `v*` — um push normal para `main` **não** gera release.
- Se um tag for criado antes das Actions estarem activas (ou antes do repo ser público), o evento é perdido. Solução: apagar e recriar o tag.
  ```bash
  git tag -d v0.x.y && git push origin :refs/tags/v0.x.y
  git tag v0.x.y && git push origin v0.x.y
  ```
- O secret `GH_TOKEN` no repo é **obrigatório** para publicar o release. Sem ele a build compila mas falha na publicação.
- O repo tem de ser **público** ou ter GitHub Actions activadas em Settings para o workflow correr.

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
   ├─ Content
   │  ├─ Left Panel (25–75% quando showRightPanel, arrastável)
   │  │  └─ SessionStack → chat messages (virtualizado com react-virtuoso)
   │  ├─ Drag handle (1px, cursor-col-resize) — posição persiste em localStorage `split-pct`
   │  └─ Right Panel (flex-1) — visível quando preview ativo ou editor tabs abertos
   │     ├─ WebPreview (Electron webview real, console real, loading bar, screenshot)
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
- **`src/components/ai-elements/web-preview.tsx`** — webview browser; `WebPreviewContext` expõe `url`, `consoleOpen`, `logs: ConsoleLine[]`, `isLoading`, `screenshotFn`. Console real via `console-message` event; loading bar animada; `WebPreviewScreenshotButton` captura webview e passa dataUrl para `onCapture`.
- **`src/components/ui/`** — shadcn/ui (style "new-york", Tailwind v4)
- **`src/components/ai-elements/`** — 65+ componentes de IA: artifacts, code-block (Shiki), reasoning, subagent-timeline, tool, etc.

### State Management (Zustand)

- **`src/stores/chat-store.ts`** — threads, sessions, streaming, aprovações, `teamNames` por sessão, auto-resume de teams, `manualResumeForTeam()`, `setThreadPreviewUrl()`
- **`src/stores/settings-store.ts`** — settings, modelos dinâmicos, auth, `claudeCodeReady`, `acpStatus`, `ibmAcpStatus`, `setAcpConfig()`, `refreshAcpStatus()`
- **`src/stores/team-store.ts`** — snapshots activos; `sessionTeams: Set<string>` (guard contra snapshots de sessões antigas)
- **`src/stores/workspace-store.ts`** — file tree, editor tabs (Monaco), IDEs
- **`src/stores/git-store.ts`** — resumo Git, commits recentes
- **`src/stores/permissions-store.ts`** — permissões de ferramentas do Claude CLI

### Hooks

- **`src/hooks/use-terminal.ts`** — sessão PTY + XTerm.js
- **`src/hooks/use-preview.ts`** — controlo do webview (URL, navegação, histórico); thread-aware: `usePreview(threadId, initialUrl, onUrlSave)` — reset de estado ao mudar de thread, persiste URL por thread via callback `onUrlSave`
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

### Persistência em localStorage

**`AgentSession`** — `sanitizeSession` em `chat-persistence.ts` é o único local onde campos são restaurados do localStorage. **Ao adicionar um novo campo persistido a `AgentSession`, é obrigatório adicioná-lo aqui.** Campos voláteis são sempre limpos no load.

**`Thread`** — campos adicionados ao tipo `Thread` (ex: `previewUrl?: string`) são persistidos automaticamente via `persistThreads()` (JSON.stringify). Não precisam de sanitização; são opcionais por definição.

### Zustand — Nunca chamar `set()` dentro de outro `set()`

Causa overwrite silencioso. Side-effects (`set()`, `setTimeout`) devem estar **fora** do callback de derivação de estado.

### Session Resume

`AgentSession.sessionId` (UUID do SDK) passado como `resumeSessionId` no `startStream`. Resetado em erros de sessão inválida/expirada.

### Terminal PTY

Prioriza `node-pty`; fallback para pipes stdio. Shell: `$SHELL` → `/bin/zsh` → `/bin/bash`.

### Auto-Preview de URLs localhost

`extractLocalhostUrls(text)` em `chat-utils.ts` extrai URLs `localhost`/`127.0.0.1` de texto. `chat-shell.tsx` monitoriza o último conteúdo `assistant` e navega automaticamente para o primeiro URL novo, fazendo `setActivePage("preview")`. Pills inline clicáveis são renderizadas em mensagens completadas via `onOpenInPreview` prop (`ChatMessages` → `SessionStack` → `ChatShell`).

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
