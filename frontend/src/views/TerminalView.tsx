import { useCallback, useEffect, useRef, useState } from "react";
import {
  Maximize2,
  Minimize2,
  Minus,
  Plus,
  RotateCcw,
  Search,
  X,
} from "lucide-react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import "@xterm/xterm/css/xterm.css";
import { T } from "../lib/tokens";

const INITIAL_FONT_SIZE = 16;
const MIN_FONT_SIZE = 10;
const MAX_FONT_SIZE = 32;
const INITIAL_SCROLLBACK = 50_000;

type Appearance = "Black" | "Dark" | "Light";
type ConnectionStatus = "Connected" | "Reconnecting..." | "Disconnected";

type TerminalTheme = {
  background: string;
  foreground: string;
  cursor: string;
  selectionBackground: string;
  black: string;
  red: string;
  green: string;
  yellow: string;
  blue: string;
  magenta: string;
  cyan: string;
  white: string;
  brightBlack: string;
  brightRed: string;
  brightGreen: string;
  brightYellow: string;
  brightBlue: string;
  brightMagenta: string;
  brightCyan: string;
  brightWhite: string;
};

const THEMES: Record<Appearance, TerminalTheme> = {
  Black: {
    background: "#000000",
    foreground: "#e5e7eb",
    cursor: "#e5e7eb",
    selectionBackground: "#334155",
    black: "#000000",
    red: "#ff5f56",
    green: "#63d471",
    yellow: "#f5c451",
    blue: "#5eb5ff",
    magenta: "#c084fc",
    cyan: "#4fd1c5",
    white: "#d5d8df",
    brightBlack: "#667085",
    brightRed: "#ff7b72",
    brightGreen: "#7ee787",
    brightYellow: "#f2cc60",
    brightBlue: "#79c0ff",
    brightMagenta: "#d8b4fe",
    brightCyan: "#67e8f9",
    brightWhite: "#ffffff",
  },
  Dark: {
    background: "#101217",
    foreground: "#d5d8df",
    cursor: "#d5d8df",
    selectionBackground: "#374151",
    black: "#111318",
    red: "#ef4444",
    green: "#22c55e",
    yellow: "#f59e0b",
    blue: "#3b82f6",
    magenta: "#a78bfa",
    cyan: "#22d3ee",
    white: "#cbd5e1",
    brightBlack: "#64748b",
    brightRed: "#f87171",
    brightGreen: "#4ade80",
    brightYellow: "#fbbf24",
    brightBlue: "#60a5fa",
    brightMagenta: "#c4b5fd",
    brightCyan: "#67e8f9",
    brightWhite: "#f8fafc",
  },
  Light: {
    background: "#f8fafc",
    foreground: "#172033",
    cursor: "#172033",
    selectionBackground: "#bfdbfe",
    black: "#172033",
    red: "#dc2626",
    green: "#15803d",
    yellow: "#a16207",
    blue: "#1d4ed8",
    magenta: "#7e22ce",
    cyan: "#0f766e",
    white: "#e2e8f0",
    brightBlack: "#475569",
    brightRed: "#b91c1c",
    brightGreen: "#166534",
    brightYellow: "#854d0e",
    brightBlue: "#1e40af",
    brightMagenta: "#6b21a8",
    brightCyan: "#115e59",
    brightWhite: "#ffffff",
  },
};

type TerminalTab = {
  id: string;
  title: string;
  sessionId?: string;
};

type TerminalSessionProps = {
  active: boolean;
  fontSize: number;
  appearance: Appearance;
  sessionId?: string;
  onSessionId: (sessionId: string) => void;
  onTitle: (title: string) => void;
  onStatus: (status: ConnectionStatus) => void;
};

function websocketUrl(sessionId?: string) {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const url = new URL(
    "/api/v1/terminal/ws",
    `${protocol}//${window.location.host}`,
  );
  if (sessionId) url.searchParams.set("sessionId", sessionId);
  return url.toString();
}

function TerminalSession({
  active,
  fontSize,
  appearance,
  sessionId: initialSessionId,
  onSessionId,
  onTitle,
  onStatus,
}: TerminalSessionProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const searchRef = useRef<SearchAddon | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const sessionIdRef = useRef(initialSessionId);
  const reconnectTimerRef = useRef<number | null>(null);
  const heartbeatRef = useRef<number | null>(null);
  const disposedRef = useRef(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const send = useCallback((message: Record<string, unknown>) => {
    const socket = socketRef.current;
    if (socket?.readyState === WebSocket.OPEN)
      socket.send(JSON.stringify(message));
  }, []);

  const fitAndResize = useCallback(() => {
    const fit = fitRef.current;
    const terminal = terminalRef.current;
    if (!fit || !terminal || !containerRef.current) return;
    try {
      fit.fit();
      send({ type: "resize", cols: terminal.cols, rows: terminal.rows });
    } catch {
      // The container can be temporarily hidden while switching tabs.
    }
  }, [send]);

  const copySelection = useCallback(async () => {
    const terminal = terminalRef.current;
    if (!terminal?.hasSelection()) return;
    try {
      await navigator.clipboard.writeText(terminal.getSelection());
      terminal.clearSelection();
    } catch {
      // Clipboard permissions can reject writes; keep the terminal usable.
    }
  }, []);

  const pasteClipboard = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) send({ type: "input", data: text });
    } catch {
      // Clipboard access may be unavailable outside a secure browser context.
    }
  }, [send]);

  useEffect(() => {
    if (!containerRef.current) return;

    const terminal = new Terminal({
      allowTransparency: false,
      convertEol: false,
      cursorBlink: true,
      cursorStyle: "block",
      disableStdin: false,
      fontFamily:
        "JetBrains Mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
      fontSize,
      letterSpacing: 0,
      lineHeight: 1.15,
      scrollback: INITIAL_SCROLLBACK,
      smoothScrollDuration: 0,
      theme: THEMES[appearance],
    });
    const fit = new FitAddon();
    const search = new SearchAddon();
    const unicode11 = new Unicode11Addon();
    const links = new WebLinksAddon();

    terminal.loadAddon(fit);
    terminal.loadAddon(search);
    terminal.loadAddon(unicode11);
    terminal.loadAddon(links);
    terminal.unicode.activeVersion = "11";
    terminal.open(containerRef.current);

    try {
      const webgl = new WebglAddon();
      webgl.onContextLoss(() => webgl.dispose());
      terminal.loadAddon(webgl);
    } catch {
      // xterm.js keeps its normal renderer when WebGL2 is unavailable.
    }

    terminalRef.current = terminal;
    fitRef.current = fit;
    searchRef.current = search;

    const resizeObserver = new ResizeObserver(() =>
      requestAnimationFrame(fitAndResize),
    );
    resizeObserver.observe(containerRef.current);

    const dataDisposable = terminal.onData((data) =>
      send({ type: "input", data }),
    );
    const resizeDisposable = terminal.onResize(({ cols, rows }) =>
      send({ type: "resize", cols, rows }),
    );
    const titleDisposable = terminal.onTitleChange((title) => {
      if (title.trim()) onTitle(title.trim());
    });

    terminal.attachCustomKeyEventHandler((event) => {
      const modifier = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      if (
        modifier &&
        event.shiftKey &&
        key === "c" &&
        event.type === "keydown"
      ) {
        void copySelection();
        return false;
      }
      if (
        modifier &&
        event.shiftKey &&
        key === "v" &&
        event.type === "keydown"
      ) {
        void pasteClipboard();
        return false;
      }
      if (
        modifier &&
        !event.shiftKey &&
        key === "f" &&
        event.type === "keydown"
      ) {
        setSearchOpen(true);
        return false;
      }
      if (
        modifier &&
        !event.shiftKey &&
        key === "v" &&
        event.type === "keydown"
      ) {
        void pasteClipboard();
        return false;
      }
      if (
        modifier &&
        !event.shiftKey &&
        key === "c" &&
        event.type === "keydown" &&
        terminal.hasSelection()
      ) {
        void copySelection();
        return false;
      }
      return true;
    });

    const connect = () => {
      if (disposedRef.current) return;
      onStatus("Reconnecting...");
      const socket = new WebSocket(websocketUrl(sessionIdRef.current));
      socket.binaryType = "arraybuffer";
      socketRef.current = socket;

      socket.onopen = () => {
        onStatus("Connected");
        fitAndResize();
        if (heartbeatRef.current) window.clearInterval(heartbeatRef.current);
        heartbeatRef.current = window.setInterval(
          () => send({ type: "ping" }),
          20_000,
        );
      };

      socket.onmessage = async (event) => {
        if (typeof event.data === "string") {
          try {
            const message = JSON.parse(event.data) as {
              type?: string;
              sessionId?: string;
              shell?: string;
              message?: string;
            };
            if (message.type === "ready" && message.sessionId) {
              sessionIdRef.current = message.sessionId;
              onSessionId(message.sessionId);
              if (message.shell)
                onTitle(message.shell.split("/").pop() || "Terminal");
              return;
            }
            if (message.type === "error") {
              terminal.write(
                `\r\n[CoreOps] ${message.message || "Terminal error"}\r\n`,
              );
            }
          } catch {
            terminal.write(event.data);
          }
          return;
        }
        const data =
          event.data instanceof ArrayBuffer
            ? event.data
            : await event.data.arrayBuffer();
        terminal.write(new Uint8Array(data));
      };

      socket.onclose = () => {
        if (heartbeatRef.current) {
          window.clearInterval(heartbeatRef.current);
          heartbeatRef.current = null;
        }
        if (disposedRef.current) {
          onStatus("Disconnected");
          return;
        }
        onStatus("Reconnecting...");
        reconnectTimerRef.current = window.setTimeout(connect, 1000);
      };

      socket.onerror = () => onStatus("Reconnecting...");
    };

    connect();
    requestAnimationFrame(fitAndResize);

    return () => {
      disposedRef.current = true;
      resizeObserver.disconnect();
      dataDisposable.dispose();
      resizeDisposable.dispose();
      titleDisposable.dispose();
      if (reconnectTimerRef.current)
        window.clearTimeout(reconnectTimerRef.current);
      if (heartbeatRef.current) window.clearInterval(heartbeatRef.current);
      const socket = socketRef.current;
      if (socket?.readyState === WebSocket.OPEN)
        socket.send(JSON.stringify({ type: "close" }));
      socket?.close();
      terminal.dispose();
      terminalRef.current = null;
    };
    // The PTY session is created once per mounted tab.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) return;
    terminal.options.fontSize = fontSize;
    terminal.options.theme = THEMES[appearance];
    requestAnimationFrame(fitAndResize);
  }, [appearance, fitAndResize, fontSize]);

  useEffect(() => {
    if (active) {
      requestAnimationFrame(() => {
        fitAndResize();
        terminalRef.current?.focus();
      });
    }
  }, [active, fitAndResize]);

  useEffect(() => {
    if (searchOpen) requestAnimationFrame(() => terminalRef.current?.focus());
  }, [searchOpen]);

  const runSearch = (direction: "next" | "previous") => {
    if (!searchQuery || !searchRef.current) return;
    if (direction === "next") searchRef.current.findNext(searchQuery);
    else searchRef.current.findPrevious(searchQuery);
  };

  return (
    <div style={{ position: "relative", height: "100%", minHeight: 0 }}>
      <div
        ref={containerRef}
        className="coreops-xterm"
        style={{ height: "100%", minHeight: 0 }}
      />
      {searchOpen && (
        <div style={searchPanelStyle}>
          <Search size={13} color={T.textDim} />
          <input
            autoFocus
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter")
                runSearch(event.shiftKey ? "previous" : "next");
              if (event.key === "Escape") {
                setSearchOpen(false);
                setSearchQuery("");
                searchRef.current?.clearDecorations();
                terminalRef.current?.focus();
              }
            }}
            placeholder="Search terminal"
            style={searchInputStyle}
          />
          <button
            type="button"
            onClick={() => runSearch("previous")}
            aria-label="Previous match"
            style={searchButtonStyle}
          >
            ↑
          </button>
          <button
            type="button"
            onClick={() => runSearch("next")}
            aria-label="Next match"
            style={searchButtonStyle}
          >
            ↓
          </button>
          <button
            type="button"
            onClick={() => {
              setSearchOpen(false);
              setSearchQuery("");
              searchRef.current?.clearDecorations();
              terminalRef.current?.focus();
            }}
            aria-label="Close search"
            style={searchButtonStyle}
          >
            <X size={12} />
          </button>
        </div>
      )}
    </div>
  );
}

const searchPanelStyle = {
  position: "absolute",
  top: 12,
  right: 12,
  display: "flex",
  alignItems: "center",
  gap: 5,
  padding: 5,
  border: `1px solid ${T.borderStrong}`,
  borderRadius: 6,
  background: T.raised,
  boxShadow: "0 8px 24px rgba(0,0,0,.28)",
} as const;

const searchInputStyle = {
  width: 190,
  border: "none",
  outline: "none",
  background: "transparent",
  color: T.text,
  fontFamily: "JetBrains Mono, monospace",
  fontSize: 11,
} as const;

const searchButtonStyle = {
  width: 23,
  height: 23,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  border: "none",
  borderRadius: 4,
  background: "transparent",
  color: T.textDim,
  cursor: "pointer",
  fontSize: 12,
} as const;

function makeTab(index: number): TerminalTab {
  return { id: crypto.randomUUID(), title: `Terminal ${index}` };
}

export default function TerminalView() {
  const [fontSize, setFontSize] = useState(
    () =>
      Number(localStorage.getItem("coreops-terminal-font-size")) ||
      INITIAL_FONT_SIZE,
  );
  const [appearance, setAppearance] = useState<Appearance>(
    () =>
      (localStorage.getItem("coreops-terminal-appearance") as Appearance) ||
      "Black",
  );
  const [tabs, setTabs] = useState<TerminalTab[]>(() => [makeTab(1)]);
  const [activeTab, setActiveTab] = useState("");
  const [status, setStatus] = useState<Record<string, ConnectionStatus>>({});
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    setActiveTab(tabs[0]?.id || "");
  }, []);

  useEffect(() => {
    localStorage.setItem("coreops-terminal-font-size", String(fontSize));
  }, [fontSize]);

  useEffect(() => {
    localStorage.setItem("coreops-terminal-appearance", appearance);
  }, [appearance]);

  const reset = () => {
    setFontSize(INITIAL_FONT_SIZE);
    setAppearance("Black");
  };

  const addTab = () => {
    setTabs((current) => {
      const tab = makeTab(current.length + 1);
      setActiveTab(tab.id);
      return [...current, tab];
    });
  };

  const closeTab = (id: string) => {
    setTabs((current) => {
      if (current.length === 1) return current;
      const index = current.findIndex((tab) => tab.id === id);
      const next = current.filter((tab) => tab.id !== id);
      if (activeTab === id)
        setActiveTab(next[Math.max(0, index - 1)]?.id || next[0]?.id || "");
      return next;
    });
  };

  return (
    <div
      style={{
        height: fullscreen ? "100vh" : "100%",
        width: fullscreen ? "100vw" : "100%",
        position: fullscreen ? "fixed" : "relative",
        inset: fullscreen ? 0 : undefined,
        zIndex: fullscreen ? 2000 : undefined,
        display: "flex",
        flexDirection: "column",
        background: T.bg,
        color: T.text,
      }}
    >
      <div style={toolbarStyle}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            minWidth: 0,
            gap: 14,
          }}
        >
          <span style={locationStyle}>
            {tabs.find((tab) => tab.id === activeTab)?.title || "Terminal"}
          </span>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 2,
              minWidth: 0,
            }}
          >
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  height: 28,
                  padding: "0 8px",
                  border: "none",
                  borderBottom: `2px solid ${activeTab === tab.id ? T.accent : "transparent"}`,
                  background: activeTab === tab.id ? T.active : "transparent",
                  color: activeTab === tab.id ? T.text : T.textDim,
                  fontSize: 11,
                  cursor: "pointer",
                }}
              >
                {tab.title}
                {tabs.length > 1 && (
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={(event) => {
                      event.stopPropagation();
                      closeTab(tab.id);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        event.stopPropagation();
                        closeTab(tab.id);
                      }
                    }}
                    aria-label={`Close ${tab.title}`}
                    style={{ display: "inline-flex", color: T.textDim }}
                  >
                    <X size={11} />
                  </span>
                )}
              </button>
            ))}
            <button
              type="button"
              onClick={addTab}
              aria-label="New terminal"
              style={{ ...searchButtonStyle, width: 27, height: 27 }}
            >
              +
            </button>
          </div>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            color: T.textDim,
            fontSize: 11,
            whiteSpace: "nowrap",
          }}
        >
          <span
            style={{
              color: status[activeTab] === "Connected" ? T.green : T.textDim,
            }}
          >
            {status[activeTab] || "Connecting..."}
          </span>
          <span>Font size</span>
          <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <button
              type="button"
              onClick={() =>
                setFontSize((size) => Math.max(MIN_FONT_SIZE, size - 1))
              }
              disabled={fontSize <= MIN_FONT_SIZE}
              aria-label="Decrease font size"
              style={toolbarButtonStyle}
            >
              <Minus size={12} />
            </button>
            <span
              style={{
                width: 24,
                textAlign: "center",
                color: T.textSub,
                fontFamily: "JetBrains Mono, monospace",
              }}
            >
              {fontSize}
            </span>
            <button
              type="button"
              onClick={() =>
                setFontSize((size) => Math.min(MAX_FONT_SIZE, size + 1))
              }
              disabled={fontSize >= MAX_FONT_SIZE}
              aria-label="Increase font size"
              style={toolbarButtonStyle}
            >
              <Plus size={12} />
            </button>
          </div>
          <span>Appearance</span>
          <select
            value={appearance}
            onChange={(event) =>
              setAppearance(event.target.value as Appearance)
            }
            aria-label="Terminal appearance"
            style={selectStyle}
          >
            <option value="Black">Black</option>
            <option value="Dark">Dark</option>
            <option value="Light">Light</option>
          </select>
          <button type="button" onClick={reset} style={toolbarTextButtonStyle}>
            <RotateCcw size={11} />
            Reset
          </button>
          <button
            type="button"
            onClick={() => setFullscreen((value) => !value)}
            aria-label={fullscreen ? "Exit fullscreen" : "Fullscreen"}
            style={toolbarTextButtonStyle}
          >
            {fullscreen ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
          </button>
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0, padding: 12, background: T.bg }}>
        <div
          style={{
            height: "100%",
            minHeight: 0,
            overflow: "hidden",
            border: `1px solid ${T.border}`,
            borderRadius: 7,
            background: THEMES[appearance].background,
          }}
        >
          {tabs.map((tab) => (
            <div
              key={tab.id}
              style={{
                display: tab.id === activeTab ? "block" : "none",
                height: "100%",
              }}
            >
              <TerminalSession
                active={tab.id === activeTab}
                fontSize={fontSize}
                appearance={appearance}
                sessionId={tab.sessionId}
                onSessionId={(sessionId) =>
                  setTabs((current) =>
                    current.map((item) =>
                      item.id === tab.id ? { ...item, sessionId } : item,
                    ),
                  )
                }
                onTitle={(title) =>
                  setTabs((current) =>
                    current.map((item) =>
                      item.id === tab.id
                        ? { ...item, title: title || item.title }
                        : item,
                    ),
                  )
                }
                onStatus={(nextStatus) =>
                  setStatus((current) => ({ ...current, [tab.id]: nextStatus }))
                }
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const toolbarStyle = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  minHeight: 48,
  padding: "0 14px 0 20px",
  borderBottom: `1px solid ${T.border}`,
  background: T.raised,
  flexShrink: 0,
  gap: 18,
} as const;

const locationStyle = {
  color: T.textSub,
  fontFamily: "JetBrains Mono, ui-monospace, SFMono-Regular, Menlo, monospace",
  fontSize: 12,
  whiteSpace: "nowrap",
} as const;

const toolbarButtonStyle = {
  width: 24,
  height: 24,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  border: `1px solid ${T.border}`,
  borderRadius: 4,
  background: "transparent",
  color: T.textSub,
  cursor: "pointer",
} as const;

const toolbarTextButtonStyle = {
  height: 26,
  display: "inline-flex",
  alignItems: "center",
  gap: 5,
  padding: "0 7px",
  border: "none",
  background: "transparent",
  color: T.textDim,
  fontSize: 11,
  cursor: "pointer",
} as const;

const selectStyle = {
  height: 26,
  minWidth: 74,
  padding: "0 7px",
  border: `1px solid ${T.border}`,
  borderRadius: 4,
  background: T.bg,
  color: T.textSub,
  fontSize: 11,
  outline: "none",
  cursor: "pointer",
} as const;
