import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal as XTerm } from "@xterm/xterm";
import { isLikelyTerminalErrorLine, stripAnsiSequences } from "@/lib/chat-utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TabXtermState {
  xterm: XTerm;
  fitAddon: FitAddon;
  sessionId: string | null;
  cleanupResize: () => void;
  disposeInput: { dispose: () => void };
  unsubscribeData: () => void;
  unsubscribeExit: () => void;
  latestError: string;
}

export interface TerminalTab {
  id: string;
  label: string;
}

export interface UseTerminalTabsReturn {
  terminalOpen: boolean;
  setTerminalOpen: (v: boolean | ((c: boolean) => boolean)) => void;
  tabs: TerminalTab[];
  activeTabId: string;
  setActiveTabId: (id: string) => void;
  addTab: () => void;
  closeTab: (id: string) => void;
  getContainerCallback: (tabId: string) => (el: HTMLDivElement | null) => void;
  focusActiveTab: () => void;
  latestTerminalError: string;
  terminalShellLabel: string;
  onOpenExternalTerminal: () => Promise<void>;
  onInsertLatestTerminalError: (
    setInput: React.Dispatch<React.SetStateAction<string>>,
    setStatus: (v: string) => void
  ) => void;
}

let _tabSeq = 0;
function nextTabLabel() {
  return `Terminal ${++_tabSeq}`;
}
function newTabId() {
  return `tab-${Date.now()}-${_tabSeq}`;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useTerminalTabs(
  setStatus: (value: string) => void,
  cwd?: string
): UseTerminalTabsReturn {
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [tabs, setTabs] = useState<TerminalTab[]>([]);
  const [activeTabId, setActiveTabId] = useState("");
  const [latestTerminalError, setLatestTerminalError] = useState("");
  const [terminalShellLabel, setTerminalShellLabel] = useState("");

  // Mutable state maps — not in React state to avoid re-renders
  const xtermMapRef = useRef<Map<string, TabXtermState>>(new Map());
  const containerMapRef = useRef<Map<string, HTMLDivElement>>(new Map());

  // Stable refs for async closures
  const activeTabIdRef = useRef(activeTabId);
  useEffect(() => {
    activeTabIdRef.current = activeTabId;
  }, [activeTabId]);

  const tabsRef = useRef(tabs);
  useEffect(() => {
    tabsRef.current = tabs;
  }, [tabs]);

  // -------------------------------------------------------------------------
  // Initialize a new XTerm for a tab and create its PTY session
  // -------------------------------------------------------------------------

  function initXterm(tabId: string, container: HTMLDivElement) {
    if (xtermMapRef.current.has(tabId)) return;

    const term = new XTerm({
      cursorBlink: true,
      convertEol: true,
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
      fontSize: 12,
      theme: {
        background: "#000000",
        foreground: "#ffffff",
        cursor: "#ffffff",
        selectionBackground: "#ffffff33"
      }
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(container);
    // Check actual DOM visibility — avoids using stale activeTabIdRef
    if (container.offsetHeight > 0) {
      fitAddon.fit();
      term.focus();
    }

    const unsubscribeData = window.desktop.terminal.onData((payload) => {
      const state = xtermMapRef.current.get(tabId);
      if (!state || payload.sessionId !== state.sessionId) return;
      state.xterm.write(payload.data);

      const cleanChunk = stripAnsiSequences(payload.data).replace(/\r/g, "\n");
      if (cleanChunk.trim()) {
        const lines = cleanChunk
          .split("\n")
          .map((l) => l.trim())
          .filter(Boolean);
        const errorLine = [...lines].reverse().find((l) => isLikelyTerminalErrorLine(l));
        if (errorLine) {
          state.latestError = errorLine;
          if (activeTabIdRef.current === tabId) {
            setLatestTerminalError(errorLine);
          }
        }
      }
    });

    const unsubscribeExit = window.desktop.terminal.onExit((payload) => {
      const state = xtermMapRef.current.get(tabId);
      if (!state || payload.sessionId !== state.sessionId) return;
      state.xterm.writeln(`\r\n[process exited: ${payload.exitCode}]`);
      if (payload.exitCode !== 0) {
        const msg = `Process exited with code ${payload.exitCode}`;
        state.latestError = msg;
        if (activeTabIdRef.current === tabId) {
          setLatestTerminalError(msg);
        }
      }
    });

    const disposeInput = term.onData((data) => {
      const state = xtermMapRef.current.get(tabId);
      if (!state?.sessionId) return;
      void window.desktop.terminal.write({ sessionId: state.sessionId, data });
    });

    const handleResize = () => {
      const state = xtermMapRef.current.get(tabId);
      if (!state?.sessionId) return;
      state.fitAddon.fit();
      void window.desktop.terminal.resize({
        sessionId: state.sessionId,
        cols: state.xterm.cols,
        rows: state.xterm.rows
      });
    };
    window.addEventListener("resize", handleResize);

    // Re-focus XTerm when clicking anywhere on the container (e.g. padding area)
    const handleMouseDown = () => term.focus();
    container.addEventListener("mousedown", handleMouseDown);

    const state: TabXtermState = {
      xterm: term,
      fitAddon,
      sessionId: null,
      cleanupResize: () => {
        window.removeEventListener("resize", handleResize);
        container.removeEventListener("mousedown", handleMouseDown);
      },
      disposeInput,
      unsubscribeData,
      unsubscribeExit,
      latestError: ""
    };
    xtermMapRef.current.set(tabId, state);

    // Create PTY session
    void (async () => {
      try {
        const session = await window.desktop.terminal.createSession({
          cols: term.cols,
          rows: term.rows,
          ...(cwd ? { cwd } : {})
        });
        const s = xtermMapRef.current.get(tabId);
        if (!s) return; // tab was closed before session created
        s.sessionId = session.sessionId;
        if (activeTabIdRef.current === tabId) {
          setTerminalShellLabel(session.shell || "");
        }
        // Always sync PTY dimensions after session creation (don't rely on stale activeTabIdRef)
        if (container.offsetHeight > 0) {
          handleResize();
        }
      } catch (error) {
        term.writeln(`\r\n\x1b[31mUnable to start terminal: ${(error as Error).message}\x1b[0m`);
      }
    })();
  }

  // -------------------------------------------------------------------------
  // Cleanup a tab's XTerm + PTY session
  // -------------------------------------------------------------------------

  function destroyTab(tabId: string) {
    const state = xtermMapRef.current.get(tabId);
    if (!state) return;
    state.cleanupResize();
    state.disposeInput.dispose();
    state.unsubscribeData();
    state.unsubscribeExit();
    if (state.sessionId) {
      void window.desktop.terminal.close(state.sessionId);
    }
    state.xterm.dispose();
    xtermMapRef.current.delete(tabId);
    containerMapRef.current.delete(tabId);
  }

  // -------------------------------------------------------------------------
  // Fit the active tab after switching (requires DOM to be visible)
  // -------------------------------------------------------------------------

  useLayoutEffect(() => {
    if (!activeTabId) return;
    const state = xtermMapRef.current.get(activeTabId);
    if (!state) return;
    // Small delay: the container may have just become visible (display: block)
    // We use requestAnimationFrame to ensure the browser has re-laid out the element
    const raf = requestAnimationFrame(() => {
      state.fitAddon.fit();
      if (state.sessionId) {
        void window.desktop.terminal.resize({
          sessionId: state.sessionId,
          cols: state.xterm.cols,
          rows: state.xterm.rows
        });
      }
      state.xterm.focus();
      // Update error + shell label for the newly active tab
      setLatestTerminalError(state.latestError);
    });
    return () => cancelAnimationFrame(raf);
  }, [activeTabId]);

  // -------------------------------------------------------------------------
  // When terminal is opened: create first tab; when closed: destroy all
  // -------------------------------------------------------------------------

  useEffect(() => {
    if (terminalOpen) {
      if (tabsRef.current.length === 0) {
        // Will be created by addTab, which is called via this effect
        const id = newTabId();
        const label = nextTabLabel();
        setTabs([{ id, label }]);
        setActiveTabId(id);
        // XTerm init happens via container ref callback
      }
    } else {
      // Destroy all existing tabs
      for (const tabId of [...xtermMapRef.current.keys()]) {
        destroyTab(tabId);
      }
      setTabs([]);
      setActiveTabId("");
      setLatestTerminalError("");
      setTerminalShellLabel("");
      _tabSeq = 0;
    }
  }, [terminalOpen]);

  // -------------------------------------------------------------------------
  // Container ref callback — called when a tab's container mounts/unmounts
  // -------------------------------------------------------------------------

  const getContainerCallback = useCallback(
    (tabId: string) => (el: HTMLDivElement | null) => {
      if (el) {
        containerMapRef.current.set(tabId, el);
        // Initialize XTerm lazily — only if not already done
        if (!xtermMapRef.current.has(tabId)) {
          initXterm(tabId, el);
        }
      } else {
        containerMapRef.current.delete(tabId);
      }
    },
    []
  );

  // -------------------------------------------------------------------------
  // Public actions
  // -------------------------------------------------------------------------

  const addTab = useCallback(() => {
    const id = newTabId();
    const label = nextTabLabel();
    setTabs((prev) => [...prev, { id, label }]);
    setActiveTabId(id);
    // XTerm init happens when container mounts (ref callback)
  }, []);

  const closeTab = useCallback((tabId: string) => {
    destroyTab(tabId);
    setTabs((prev) => {
      const next = prev.filter((t) => t.id !== tabId);
      if (activeTabIdRef.current === tabId && next.length > 0) {
        // Switch to the last tab
        const newActive = next[next.length - 1].id;
        setActiveTabId(newActive);
      } else if (next.length === 0) {
        setTerminalOpen(false);
      }
      return next;
    });
  }, []);

  const focusActiveTab = useCallback(() => {
    const state = xtermMapRef.current.get(activeTabIdRef.current);
    if (state) state.xterm.focus();
  }, []);

  const onOpenExternalTerminal = useCallback(async () => {
    try {
      await window.desktop.terminal.openExternal();
      setStatus("Opened system terminal.");
    } catch (error) {
      setStatus((error as Error).message);
    }
  }, [setStatus]);

  const onInsertLatestTerminalError = useCallback(
    (setInput: React.Dispatch<React.SetStateAction<string>>, setStatusCb: (v: string) => void) => {
      const value = latestTerminalError.trim();
      if (!value) return;
      const snippet = `Please diagnose and fix this terminal error:\n\`\`\`\n${value}\n\`\`\``;
      setInput((current) => {
        const trimmed = current.trim();
        return trimmed ? `${trimmed}\n\n${snippet}` : snippet;
      });
      setStatusCb("Terminal error added to prompt.");
    },
    [latestTerminalError]
  );

  return {
    terminalOpen,
    setTerminalOpen,
    tabs,
    activeTabId,
    setActiveTabId,
    addTab,
    closeTab,
    getContainerCallback,
    focusActiveTab,
    latestTerminalError,
    terminalShellLabel,
    onOpenExternalTerminal,
    onInsertLatestTerminalError
  };
}
