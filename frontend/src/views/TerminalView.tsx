import { useEffect, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Copy,
  Eraser,
  Plus,
  Search,
  TerminalSquare,
  X,
} from "lucide-react";
import { Terminal, type ITheme } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { checkTerminalAvailability, openTerminalSession } from "../lib/api";
import { getSession } from "../lib/auth";
import "@xterm/xterm/css/xterm.css";
import "../styles/terminal.css";

type Pane = { id: number; title: string };
type Handle = {
  input: (data: string) => void;
  clear: () => void;
  copy: () => void;
  search: () => void;
  zoom: (delta: number) => void;
};
function terminalTheme(): ITheme {
  const css = getComputedStyle(document.documentElement);
  const color = (name: string) =>
    css.getPropertyValue(`--coreops-${name}`).trim();
  return {
    background: color("bg"),
    foreground: color("text"),
    cursor: color("text"),
    cursorAccent: color("bg"),
    selectionBackground: color("borderStrong"),
    black: "#3b3b3b",
    red: "#d35f5f",
    green: "#63ad79",
    yellow: "#c09b42",
    blue: "#638ec9",
    magenta: "#b478bd",
    cyan: "#4da6a6",
    white: "#c7c7c7",
    brightBlack: "#777777",
    brightRed: "#f08080",
    brightGreen: "#93d09c",
    brightYellow: "#e8c578",
    brightBlue: "#8eb5e9",
    brightMagenta: "#d0a2dc",
    brightCyan: "#8bd0d0",
    brightWhite: "#f2f2f2",
  };
}
function TerminalPane({
  pane,
  active,
  visible,
  handles,
  onTitle,
}: {
  pane: Pane;
  active: boolean;
  visible: boolean;
  handles: React.RefObject<Map<number, Handle>>;
  onTitle: (id: number, title: string) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const terminal = useRef<Terminal | null>(null);
  const fit = useRef<FitAddon | null>(null);
  const search = useRef<SearchAddon | null>(null);
  const live = useRef(false);
  const [state, setState] = useState("connecting");
  const [detail, setDetail] = useState("Connecting to the server…");
  const [findOpen, setFindOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [notice, setNotice] = useState("");
  useEffect(() => {
    if (!container.current) return;
    let disposed = false;
    let ended = false;
    let connected = false;
    const term = new Terminal({
      cursorBlink: true,
      fontFamily: '"JetBrains Mono", monospace',
      fontSize: 14,
      lineHeight: 1.2,
      scrollback: 5000,
      theme: terminalTheme(),
      allowProposedApi: false,
      screenReaderMode: true,
    });
    const fitAddon = new FitAddon();
    const searchAddon = new SearchAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(searchAddon);
    term.loadAddon(
      new WebLinksAddon((event, uri) => {
        if (!(event.ctrlKey || event.metaKey)) return;
        const url = new URL(uri);
        if (url.protocol === "https:" || url.protocol === "http:")
          window.open(url.href, "_blank", "noopener,noreferrer");
      }),
    );
    term.open(container.current);
    // Remote escape sequences must not read or overwrite the browser clipboard.
    const clipboard = term.parser.registerOscHandler(52, () => true);
    terminal.current = term;
    fit.current = fitAddon;
    search.current = searchAddon;
    fitAddon.fit();
    const socket = openTerminalSession(term.cols, term.rows);
    const control = (data: object) => {
      if (socket.readyState === WebSocket.OPEN)
        socket.send(JSON.stringify(data));
    };
    const input = (data: string) => {
      if (!live.current || socket.readyState !== WebSocket.OPEN) return;
      const bytes = new TextEncoder().encode(data);
      for (let i = 0; i < bytes.length; i += 16384) {
        if (socket.bufferedAmount > 1024 * 1024) {
          setDetail("Input buffer full. Check the server before retrying.");
          ended = true;
          live.current = false;
          setState("error");
          socket.close();
          return;
        }
        socket.send(bytes.slice(i, i + 16384));
      }
    };
    const copy = () => {
      const text = term.getSelection();
      if (!text) {
        setNotice("Select terminal text to copy.");
        return;
      }
      if (!navigator.clipboard) {
        setNotice("Use your browser’s Copy command.");
        return;
      }
      void navigator.clipboard.writeText(text).then(
        () => setNotice("Selection copied."),
        () => setNotice("Use your browser’s Copy command."),
      );
    };
    handles.current.set(pane.id, {
      input: (data) => {
        input(data);
        term.focus();
      },
      clear: () => term.clear(),
      copy,
      search: () => setFindOpen((value) => !value),
      zoom: (delta) => {
        term.options.fontSize = Math.max(
          10,
          Math.min(24, (term.options.fontSize ?? 14) + delta),
        );
        fitAddon.fit();
      },
    });
    term.attachCustomKeyEventHandler((event) => {
      if (event.type !== "keydown") return true;
      if (
        (event.metaKey || (event.ctrlKey && event.shiftKey)) &&
        event.key.toLowerCase() === "f"
      ) {
        event.preventDefault();
        setFindOpen(true);
        return false;
      }
      if (
        (event.metaKey || (event.ctrlKey && event.shiftKey)) &&
        event.key.toLowerCase() === "c" &&
        term.hasSelection()
      ) {
        event.preventDefault();
        copy();
        return false;
      }
      if (event.metaKey && event.key.toLowerCase() === "k") {
        event.preventDefault();
        term.clear();
        return false;
      }
      return true;
    });
    const data = term.onData(input);
    const binary = term.onBinary((value) => {
      if (live.current && socket.readyState === WebSocket.OPEN)
        socket.send(Uint8Array.from(value, (c) => c.charCodeAt(0)));
    });
    const resize = term.onResize(({ cols, rows }) => {
      if (live.current) control({ type: "resize", cols, rows });
    });
    const title = term.onTitleChange((value) =>
      onTitle(
        pane.id,
        value.replace(/[\x00-\x1f\x7f]/g, "").slice(0, 80) || "Shell",
      ),
    );
    const timeout = window.setTimeout(() => {
      if (!live.current && !disposed && !ended) {
        ended = true;
        setState("error");
        setDetail("Connection timed out. Check the API and WebSocket proxy.");
        socket.close();
      }
    }, 10000);
    socket.onmessage = (event: MessageEvent<string | ArrayBuffer>) => {
      if (disposed) return;
      if (event.data instanceof ArrayBuffer) {
        term.write(new Uint8Array(event.data), () => control({ type: "ack" }));
        return;
      }
      try {
        const message = JSON.parse(event.data);
        if (message.type === "ready") {
          connected = true;
          clearTimeout(timeout);
          live.current = true;
          setState("connected");
          setDetail(`${message.user}@${message.host} · ${message.shell}`);
          control({ type: "resize", cols: term.cols, rows: term.rows });
          if (container.current?.offsetParent) term.focus();
        } else if (message.type === "exit") {
          ended = true;
          live.current = false;
          setState("exited");
          setDetail(
            `Shell exited with code ${message.code}. Open a new terminal to continue.`,
          );
        } else if (message.type === "error") {
          ended = true;
          live.current = false;
          setState("error");
          setDetail(String(message.message));
          socket.close();
        }
      } catch {
        ended = true;
        setState("error");
        setDetail("Invalid terminal response.");
        socket.close();
      }
    };
    socket.onclose = (event) => {
      live.current = false;
      clearTimeout(timeout);
      if (!disposed && !ended) {
        setState("disconnected");
        term.options.cursorBlink = false;
        term.options.disableStdin = true;
        setDetail(
          connected
            ? `The connection closed (code ${event.code}). Open a new terminal to continue.`
            : "WebSocket connection failed before the shell started. Check the proxy upgrade and allowed Origin configuration.",
        );
      }
    };
    const observer = new ResizeObserver(() => {
      if (
        container.current &&
        container.current.clientWidth > 0 &&
        container.current.clientHeight > 0
      )
        fitAddon.fit();
    });
    observer.observe(container.current);
    const applyTheme = () => {
      term.options.theme = terminalTheme();
    };
    window.addEventListener("coreops-theme-applied", applyTheme);
    return () => {
      disposed = true;
      live.current = false;
      clearTimeout(timeout);
      observer.disconnect();
      window.removeEventListener("coreops-theme-applied", applyTheme);
      handles.current.delete(pane.id);
      socket.close();
      data.dispose();
      binary.dispose();
      resize.dispose();
      title.dispose();
      clipboard.dispose();
      term.dispose();
    };
  }, [pane.id, handles, onTitle]);
  useEffect(() => {
    if (active && visible) {
      const frame = requestAnimationFrame(() => {
        fit.current?.fit();
        terminal.current?.focus();
      });
      return () => cancelAnimationFrame(frame);
    }
  }, [active, visible]);
  return (
    <div
      className="pty-pane"
      hidden={!active}
      role="tabpanel"
      id={`terminal-panel-${pane.id}`}
      aria-labelledby={`terminal-tab-${pane.id}`}
    >
      {findOpen && (
        <form
          className="pty-find"
          onSubmit={(e) => {
            e.preventDefault();
            search.current?.findNext(query);
          }}
        >
          <input
            autoFocus
            aria-label="Find in terminal"
            placeholder="Find in terminal…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              search.current?.findNext(e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setFindOpen(false);
                terminal.current?.focus();
              }
            }}
          />
          <button
            type="button"
            aria-label="Previous match"
            onClick={() => search.current?.findPrevious(query)}
          >
            <ArrowUp size={15} />
          </button>
          <button type="submit" aria-label="Next match">
            <ArrowDown size={15} />
          </button>
          <button
            type="button"
            aria-label="Close search"
            onClick={() => {
              search.current?.clearDecorations();
              setFindOpen(false);
              terminal.current?.focus();
            }}
          >
            <X size={15} />
          </button>
        </form>
      )}
      <div
        className="pty-emulator"
        ref={container}
        data-terminal-input
        data-state={state}
        aria-label="Server terminal"
      />
      <div className="pty-status" role="status">
        <span data-state={state}>
          {state === "connected"
            ? "Connected"
            : state === "connecting"
              ? "Connecting"
              : state === "exited"
                ? "Exited"
                : state === "error"
                  ? "Error"
                  : "Disconnected"}
        </span>
        <span>{notice || detail}</span>
      </div>
    </div>
  );
}
export default function TerminalView({
  visible = true,
}: {
  visible?: boolean;
}) {
  const [panes, setPanes] = useState<Pane[]>([{ id: 1, title: "Shell 1" }]);
  const [active, setActive] = useState(1);
  const counter = useRef(1);
  const root = useRef<HTMLDivElement>(null);
  const handles = useRef(new Map<number, Handle>());
  const [pendingClose, setPendingClose] = useState<number | null>(null);
  const [availability, setAvailability] = useState("checking");
  const [connectionError, setConnectionError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const onTitle = useRef((id: number, title: string) =>
    setPanes((all) =>
      all.map((pane) => (pane.id === id ? { ...pane, title } : pane)),
    ),
  ).current;
  useEffect(() => {
    if (getSession()?.user.role !== "admin") return;
    const controller = new AbortController();
    setAvailability("checking");
    void checkTerminalAvailability(controller.signal).then(
      () => {
        if (!controller.signal.aborted) setAvailability("ready");
      },
      (error: unknown) => {
        if (!controller.signal.aborted) {
          setAvailability("error");
          setConnectionError(
            error instanceof Error
              ? error.message
              : "Unable to check terminal availability.",
          );
        }
      },
    );
    return () => controller.abort();
  }, [attempt]);
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!visible || !viewport) return;
    const resize = () => {
      if (root.current && viewport.scale === 1) {
        const top = Math.max(
          0,
          root.current.getBoundingClientRect().top - viewport.offsetTop,
        );
        root.current.style.maxHeight = `${Math.max(96, viewport.height - top)}px`;
      }
    };
    resize();
    viewport.addEventListener("resize", resize);
    viewport.addEventListener("scroll", resize);
    return () => {
      viewport.removeEventListener("resize", resize);
      viewport.removeEventListener("scroll", resize);
    };
  }, [visible]);
  useEffect(() => {
    if (
      !panes.length ||
      availability !== "ready" ||
      getSession()?.user.role !== "admin"
    )
      return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [panes.length, availability]);
  if (getSession()?.user.role !== "admin")
    return (
      <div className="pty-unavailable" role="status">
        <TerminalSquare size={28} />
        <h2>Administrator access required</h2>
        <p>
          The terminal runs commands on the server with the CoreOps service
          account’s permissions.
        </p>
      </div>
    );
  const add = () => {
    const id = ++counter.current;
    setPanes((all) => [...all, { id, title: `Shell ${id}` }]);
    setActive(id);
  };
  const close = (id: number) => {
    setPanes((all) => all.filter((pane) => pane.id !== id));
    if (active === id) setActive(panes.find((pane) => pane.id !== id)?.id ?? 0);
    setPendingClose(null);
  };
  const run = (action: keyof Handle, value?: string) => {
    const handle = handles.current.get(active);
    if (action === "input") handle?.input(value ?? "");
    else if (action === "zoom") handle?.zoom(Number(value));
    else handle?.[action]();
  };
  return (
    <div
      ref={root}
      className="pty-terminal"
      style={{ display: visible ? undefined : "none" }}
      onKeyDownCapture={(event) => {
        if (
          event.ctrlKey &&
          event.shiftKey &&
          event.key.toLowerCase() === "t"
        ) {
          event.preventDefault();
          event.stopPropagation();
          if (panes.length < 4) add();
        } else if (
          event.ctrlKey &&
          event.shiftKey &&
          event.key.toLowerCase() === "w"
        ) {
          event.preventDefault();
          event.stopPropagation();
          setPendingClose(active);
        } else if (
          (event.ctrlKey && ["PageUp", "PageDown"].includes(event.key)) ||
          ((event.target as HTMLElement).getAttribute("role") === "tab" &&
            ["ArrowLeft", "ArrowRight"].includes(event.key))
        ) {
          event.preventDefault();
          event.stopPropagation();
          const delta = ["PageUp", "ArrowLeft"].includes(event.key) ? -1 : 1;
          const pane =
            panes[
              (panes.findIndex((p) => p.id === active) + delta + panes.length) %
                panes.length
            ];
          if (pane) {
            setActive(pane.id);
            document.getElementById(`terminal-tab-${pane.id}`)?.focus();
          }
        }
      }}
    >
      <div className="pty-toolbar">
        <div className="pty-tabs" role="tablist" aria-label="Terminal sessions">
          {panes.map((pane) => (
            <div
              className="pty-tab"
              data-active={active === pane.id}
              key={pane.id}
            >
              <button
                id={`terminal-tab-${pane.id}`}
                type="button"
                role="tab"
                aria-selected={active === pane.id}
                aria-controls={`terminal-panel-${pane.id}`}
                onClick={() => setActive(pane.id)}
              >
                <TerminalSquare size={14} />
                <span>{pane.title}</span>
              </button>
              <button
                type="button"
                aria-label={`Close ${pane.title}`}
                title="Close terminal"
                onClick={() => setPendingClose(pane.id)}
              >
                <X size={13} />
              </button>
            </div>
          ))}
        </div>
        <button
          type="button"
          aria-label="New terminal"
          title="New terminal (maximum four)"
          disabled={panes.length >= 4 || availability !== "ready"}
          onClick={add}
        >
          <Plus size={17} />
        </button>
        <div className="pty-tools">
          <button
            type="button"
            title="Copy selection"
            aria-label="Copy selection"
            disabled={!panes.length}
            onClick={() => run("copy")}
          >
            <Copy size={15} />
          </button>
          <button
            type="button"
            title="Find in terminal"
            aria-label="Find in terminal"
            disabled={!panes.length}
            onClick={() => run("search")}
          >
            <Search size={15} />
          </button>
          <button
            type="button"
            title="Clear scrollback"
            aria-label="Clear scrollback"
            disabled={!panes.length}
            onClick={() => run("clear")}
          >
            <Eraser size={15} />
          </button>
          <button
            type="button"
            aria-label="Decrease terminal font"
            disabled={!panes.length}
            onClick={() => run("zoom", "-1")}
          >
            A−
          </button>
          <button
            type="button"
            aria-label="Increase terminal font"
            disabled={!panes.length}
            onClick={() => run("zoom", "1")}
          >
            A+
          </button>
        </div>
      </div>
      {pendingClose !== null && (
        <div className="pty-close-prompt" role="alert">
          <span>Close this shell and stop its foreground process?</span>
          <button type="button" onClick={() => setPendingClose(null)}>
            Cancel
          </button>
          <button type="button" onClick={() => close(pendingClose)}>
            Close shell
          </button>
        </div>
      )}
      {availability !== "ready" && (
        <div
          className="pty-empty"
          role={availability === "error" ? "alert" : "status"}
        >
          <TerminalSquare size={28} />
          <h2>
            {availability === "error"
              ? "Terminal unavailable"
              : "Checking terminal…"}
          </h2>
          <p>
            {availability === "error"
              ? connectionError
              : "Connecting to the CoreOps API."}
          </p>
          {availability === "error" && (
            <button
              type="button"
              onClick={() => setAttempt((value) => value + 1)}
            >
              Retry connection
            </button>
          )}
        </div>
      )}
      {availability === "ready" &&
        panes.map((pane) => (
          <TerminalPane
            key={pane.id}
            pane={pane}
            active={active === pane.id}
            visible={visible}
            handles={handles}
            onTitle={onTitle}
          />
        ))}
      {availability === "ready" && !panes.length && (
        <div className="pty-empty">
          <TerminalSquare size={32} />
          <h2>No open terminals</h2>
          <p>Open an interactive shell on this server.</p>
          <button type="button" onClick={add}>
            New terminal
          </button>
        </div>
      )}
      {availability === "ready" && !!panes.length && (
        <div className="pty-keys" aria-label="Terminal keyboard shortcuts">
          {[
            ["Esc", "\x1b"],
            ["Tab", "\t"],
            ["Ctrl C", "\x03"],
            ["Ctrl D", "\x04"],
            ["Ctrl Z", "\x1a"],
            ["Ctrl L", "\x0c"],
            ["↑", "\x1b[A"],
            ["↓", "\x1b[B"],
            ["←", "\x1b[D"],
            ["→", "\x1b[C"],
            ["Enter", "\r"],
          ].map(([label, value]) => (
            <button
              type="button"
              key={label}
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => run("input", value)}
            >
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
