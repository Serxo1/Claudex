# Claudex

**Claudex** is a desktop application that wraps the [Claude Code CLI](https://docs.anthropic.com/claude/claude-code) in a rich visual interface. Think of it as a native IDE-like shell for Claude — with streaming chat, a built-in Monaco editor, integrated terminal, web preview, Git source control, and multi-agent team support.

> Authentication is handled exclusively via `claude login`. No API keys required.

![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS-blue)
![License](https://img.shields.io/github/license/Serxo1/Claudex)
![Release](https://img.shields.io/github/v/release/Serxo1/Claudex)

---

## Features

- **Streaming chat** — real-time responses with tool use, reasoning blocks, and inline file diffs
- **Monaco editor** — open and edit files side-by-side with the chat, with auto-save
- **Integrated terminal** — full PTY shell (zsh/bash) docked at the bottom
- **Web preview** — embedded browser with real DevTools console and auto-navigate on localhost URLs
- **Source control panel** — staged/unstaged/untracked file groups, inline commit, push, pull, fetch, and PR creation via GitHub CLI
- **Team agents** — monitor and interact with multi-agent Claude Code teams in real time
- **Auto-updater** — background update checks with one-click install via GitHub Releases

---

## Requirements

- **Node.js 18+**
- **Claude Code CLI** installed and authenticated:

```bash
npm install -g @anthropic-ai/claude-code
claude login
```

---

## Download

Get the latest installer from the [Releases page](https://github.com/Serxo1/Claudex/releases):

| Platform | File |
|----------|------|
| Windows | `Claudex-Setup-x.y.z.exe` |
| macOS (Apple Silicon) | `Claudex-x.y.z-arm64.dmg` |

### macOS — Gatekeeper

The macOS build is not notarized. macOS will block it from opening directly. To bypass:

1. Download the `.dmg`, open it and drag **Claudex.app** to **Applications**
2. Open Terminal and run:

```bash
xattr -rd com.apple.quarantine /Applications/Claudex.app
```

3. Open Claudex normally from Launchpad or Finder

---

## Development

```bash
# Install dependencies
npm install

# Start dev server (Vite :5173 + Electron)
npm run dev

# Type check
npm run typecheck

# Lint
npm run lint

# Format
npm run format
```

---

## Build

```bash
# Windows (NSIS installer + MSI)
npm run dist:win

# macOS (DMG — arm64 + x64)
npm run dist:mac
```

Releases are built automatically via GitHub Actions when a version tag is pushed:

```bash
git tag v1.0.0
git push origin main --tags
```

---

## Stack

| Layer | Technology |
|-------|-----------|
| Shell | Electron 37 |
| UI | React 19 + Vite 7 + Tailwind CSS 4 |
| State | Zustand 5 |
| Editor | Monaco Editor |
| Terminal | node-pty + XTerm.js |
| Markdown | Streamdown + Shiki |
| AI SDK | `@anthropic-ai/claude-agent-sdk` |
| Updates | electron-updater |

---

## License

MIT
