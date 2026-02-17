# Claude Desktop-Style App (Electron + React)

Starter local app with:

- Electron desktop shell
- React + Vite frontend
- Tailwind CSS v4 with `shadcn/ui`-compatible setup
- Chat UI structured with AI Elements-like components
- Two auth modes:
  - Anthropic API Key
  - Claude Code CLI delegation (uses existing CLI login session)

## Why this architecture

`Electron` is practical for this use case because process/PTY integration with CLI tools is straightforward.  
For CLI auth mode, the app **delegates requests to `claude` CLI** and does not attempt to extract internal account tokens.

## Run

1. Install dependencies:

```bash
npm install
```

2. Start app:

```bash
npm run dev
```

## Auth modes

### API Key mode

- Save your Anthropic API key in app settings.
- Requests are sent directly to `https://api.anthropic.com/v1/messages`.

### Claude CLI mode

- Ensure `claude` is installed and logged in.
- App runs `claude -p ... --output-format json` and displays result.
- This uses the official CLI session rather than manually handling account secrets.

## Add official shadcn and AI Elements later

This scaffold includes compatible structure and local components so you can work offline.

When network is available:

```bash
npx shadcn@latest add button input
npx ai-elements@latest add conversation message prompt-input
```

## Notes

- This is an MVP scaffold (single-shot responses, no token streaming yet).
- Next step is implementing streaming via `stream-json` from Claude CLI and incremental UI updates.

