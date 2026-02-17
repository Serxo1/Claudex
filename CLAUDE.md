# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Visão Geral

Aplicação desktop estilo Claude usando Electron + React com duas estratégias de autenticação:
- **Modo API Key**: Chamadas diretas à API da Anthropic (`https://api.anthropic.com/v1/messages`)
- **Modo Claude CLI**: Delega requisições ao CLI oficial do Claude (usa sessão de login existente)

## Comandos Essenciais

```bash
# Instalar dependências
npm install

# Desenvolvimento (inicia renderer + electron concorrentemente)
npm run dev

# Build de produção
npm run build

# Verificação de tipos
npm run typecheck

# Executar app empacotado
npm start
```

## Arquitetura

### Processo Principal (Electron)
- **electron/main.cjs**: Processo principal Node.js com toda lógica de backend
  - Gerenciamento de configurações (salvas em `userData/settings.json` com `safeStorage` para API keys)
  - Integração com Claude CLI (`claude -p ... --output-format stream-json`)
  - Operações de workspace (árvore de arquivos, contexto multi-diretório)
  - Integração Git (status, commits, PRs via `gh`)
  - Sessões PTY para terminal embutido (usando `node-pty` quando disponível)
  - Streaming de eventos de chat via IPC

- **electron/preload.cjs**: Context bridge expondo API segura ao renderer via `window.desktop`

### Renderer (React + Vite)
- **src/App.tsx**: Ponto de entrada simples renderizando `<ChatShell />`
- **src/components/chat/chat-shell.tsx**: Container principal da UI de chat
- **src/components/ui/**: Componentes shadcn/ui (Tailwind v4 com sistema de design "new-york")
- **src/components/ai-elements/**: Componentes específicos para UI de IA (artifacts, code-block, terminal, tool, etc.)

### Comunicação IPC
O renderer comunica com o processo principal via handlers expostos em `window.desktop`:
- `settings.*`: Gerenciamento de configurações e autenticação
- `workspace.*`: Operações de workspace e contexto de arquivos
- `git.*`: Operações Git
- `terminal.*`: Gerenciamento de sessões PTY
- `chat.*`: Envio de mensagens e streaming de respostas
- `ide.*`: Detecção e abertura de IDEs (Cursor, VS Code, Windsurf, Zed, WebStorm)

### Streaming de Chat
- Modo API Key usa pseudo-streaming (resposta única seguida de evento `done`)
- Modo CLI usa `--output-format stream-json --include-partial-messages` para streaming real
- Eventos enviados via `chat:streamEvent` channel:
  - `start`: Início do stream
  - `delta`: Texto incremental
  - `toolUse`/`toolResult`: Execução de ferramentas
  - `status`: Modo de permissão e uso de tokens
  - `limits`: Avisos de quota (5-hour/weekly)
  - `done`/`error`/`aborted`: Estados finais

### Gerenciamento de Contexto
- Workspace principal: `process.cwd()` ao iniciar Electron
- Workspaces adicionais: Configuráveis via `settings.workspaceDirs`
- Arquivos de contexto incluem preview de imagens (até 5MB) como data URLs
- Imagens coladas salvas em `temp/claude-desktop-pastes/` com UUID único

## Patterns Importantes

### Path Aliases
Usa alias `@/*` mapeado para `./src/*` (configurado em `tsconfig.json` e `vite.config.ts`)

### Componentes shadcn/ui
Configuração em `components.json` (style: "new-york", Tailwind v4, CSS variables)
- Adicionar novos componentes: `npx shadcn@latest add <component>`

### Session Recovery
CLI mantém `claudeCliSessionId` persistente nas configurações
- Automaticamente resetado em erros de sessão inválida/expirada
- Desabilitado quando há contexto de imagens (usa UUID temporário)

### Terminal PTY
Prioriza `node-pty` para sessões PTY reais, fallback para pipes stdio se indisponível
- Shell detection: `$SHELL` → `/bin/zsh` → `/bin/bash` → `/bin/sh`
- Sessões gerenciadas em Map com limpeza automática ao sair

### Git Operations
- Todas operações executadas via `runCommand` com timeouts configuráveis
- PR creation usa `gh pr create --fill` (requer GitHub CLI instalado e autenticado)
- Commits fazem `git add -A` antes de commit

## Stack Tecnológico

- **Electron 37**: Desktop shell
- **React 19**: UI framework
- **Vite 7**: Build tool e dev server
- **TypeScript 5.9**: Type safety
- **Tailwind CSS 4**: Styling (com plugin Vite)
- **node-pty**: Terminal PTY (opcional, fallback para stdio pipes)
- **AI SDK**: `@ai-sdk/react` e `ai` para chat patterns
- **XTerm.js**: Emulador de terminal
- **Shiki**: Syntax highlighting
- **Streamdown**: Markdown rendering com suporte a código/matemática

## Notas de Desenvolvimento

- Dev server roda em porta fixa 5173 (`--strictPort`)
- Em modo dev, DevTools abrem automaticamente em janela separada
- Electron espera por `tcp:5173` antes de carregar (via `wait-on`)
- Build empacota renderer em `dist/`, Electron carrega de lá em produção
