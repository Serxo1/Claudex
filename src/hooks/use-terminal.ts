import { useCallback, useEffect, useRef, useState } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal as XTerm } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { isLikelyTerminalErrorLine, stripAnsiSequences } from "@/lib/chat-utils";

export interface UseTerminalReturn {
  terminalOpen: boolean;
  setTerminalOpen: (value: boolean | ((current: boolean) => boolean)) => void;
  terminalShellLabel: string;
  latestTerminalError: string;
  terminalContainerRef: React.RefObject<HTMLDivElement | null>;
  onOpenExternalTerminal: () => Promise<void>;
  onInsertLatestTerminalError: (
    setInput: React.Dispatch<React.SetStateAction<string>>,
    setStatus: (v: string) => void
  ) => void;
}

export function useTerminal(setStatus: (value: string) => void): UseTerminalReturn {
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [terminalShellLabel, setTerminalShellLabel] = useState("");
  const [latestTerminalError, setLatestTerminalError] = useState("");
  const terminalContainerRef = useRef<HTMLDivElement | null>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const terminalSessionIdRef = useRef<string | null>(null);
  const terminalBufferRef = useRef("");
  const latestTerminalErrorRef = useRef("");

  useEffect(() => {
    if (!terminalOpen || !terminalContainerRef.current) {
      return;
    }
    setTerminalShellLabel("");
    terminalBufferRef.current = "";

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
    term.open(terminalContainerRef.current);
    fitAddon.fit();
    term.focus();

    xtermRef.current = term;
    fitAddonRef.current = fitAddon;

    const unsubscribeData = window.desktop.terminal.onData((payload) => {
      if (payload.sessionId === terminalSessionIdRef.current) {
        term.write(payload.data);

        const cleanChunk = stripAnsiSequences(payload.data).replace(/\r/g, "\n");
        if (cleanChunk.trim()) {
          terminalBufferRef.current = `${terminalBufferRef.current}\n${cleanChunk}`;
          const lines = terminalBufferRef.current
            .split("\n")
            .map((line) => line.trim())
            .filter(Boolean)
            .slice(-120);
          terminalBufferRef.current = lines.join("\n");

          const latestMatch = [...lines].reverse().find((line) => isLikelyTerminalErrorLine(line));
          if (latestMatch && latestMatch !== latestTerminalErrorRef.current) {
            latestTerminalErrorRef.current = latestMatch;
            setLatestTerminalError(latestMatch);
          }
        }
      }
    });
    const unsubscribeExit = window.desktop.terminal.onExit((payload) => {
      if (payload.sessionId === terminalSessionIdRef.current) {
        term.writeln(`\r\n[process exited: ${payload.exitCode}]`);
        if (payload.exitCode !== 0) {
          const exitMessage = `Process exited with code ${payload.exitCode}`;
          latestTerminalErrorRef.current = exitMessage;
          setLatestTerminalError(exitMessage);
        }
      }
    });

    const disposeInput = term.onData((data) => {
      const sessionId = terminalSessionIdRef.current;
      if (!sessionId) {
        return;
      }
      void window.desktop.terminal.write({ sessionId, data });
    });

    const handleResize = () => {
      const addon = fitAddonRef.current;
      const sessionId = terminalSessionIdRef.current;
      if (!addon || !sessionId) {
        return;
      }
      addon.fit();
      void window.desktop.terminal.resize({ sessionId, cols: term.cols, rows: term.rows });
    };
    window.addEventListener("resize", handleResize);

    void (async () => {
      try {
        const session = await window.desktop.terminal.createSession({
          cols: term.cols,
          rows: term.rows
        });
        terminalSessionIdRef.current = session.sessionId;
        setTerminalShellLabel(session.shell || "");
        handleResize();
      } catch (error) {
        term.writeln(`\r\n\x1b[31mUnable to start terminal: ${(error as Error).message}\x1b[0m`);
      }
    })();

    return () => {
      window.removeEventListener("resize", handleResize);
      disposeInput.dispose();
      unsubscribeData();
      unsubscribeExit();
      const sessionId = terminalSessionIdRef.current;
      if (sessionId) {
        void window.desktop.terminal.close(sessionId);
        terminalSessionIdRef.current = null;
      }
      term.dispose();
      xtermRef.current = null;
      fitAddonRef.current = null;
      terminalBufferRef.current = "";
    };
  }, [terminalOpen]);

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
      if (!value) {
        return;
      }

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
    terminalShellLabel,
    latestTerminalError,
    terminalContainerRef,
    onOpenExternalTerminal,
    onInsertLatestTerminalError
  };
}
