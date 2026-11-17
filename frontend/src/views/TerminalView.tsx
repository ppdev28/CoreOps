import { useEffect, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Copy,
  Eraser,
  Keyboard,
  KeyboardOff,
  Maximize2,
  Minimize2,
  MoreHorizontal,
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
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../components/ui/popover";
import "@xterm/xterm/css/xterm.css";
import "../styles/terminal.css";

export type ContainerTerminalRequest = {
  requestId: number;
  containerId: string;
  name: string;
};
type Pane = {
  id: number;
  title: string;
  containerId?: string;
  containerName?: string;
  ended?: boolean;
};
type Handle = {
  input: (data: string) => void;
  clear: () => void;
  copy: () => void;
  search: () => void;
  zoom: (delta: number) => void;
  keyboard: () => void;
};
function touchInput() {
  return (
    window.matchMedia("(pointer: coarse)").matches ||
    window.matchMedia("(max-width: 767px)").matches
  );
}
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
  onInputFocus,
  onEnded,
}: {
  pane: Pane;
  active: boolean;
  visible: boolean;
  handles: React.RefObject<Map<number, Handle>>;
  onTitle: (id: number, title: string) => void;
  onInputFocus: (id: number, focused: boolean) => void;
  onEnded: (id: number) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const terminal = useRef<Terminal | null>(null);
  const fit = useRef<(() => void) | null>(null);
  const search = useRef<SearchAddon | null>(null);
  const live = useRef(false);
  const [state, setState] = useState("connecting");
  const [detail, setDetail] = useState("Connecting to the server…");
  const [findOpen, setFindOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [notice, setNotice] = useState("");
  const [dimensions, setDimensions] = useState("");
  useEffect(() => {
    if (!container.current) return;
    let disposed = false;
    let ended = false;
    let connected = false;
    const term = new Terminal({
      cursorBlink: true,
      fontFamily: '"JetBrains Mono", monospace',
      fontSize:
        container.current.clientWidth < 480
          ? 12
          : container.current.clientWidth < 900
            ? 13
            : 14,
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
    let fitFrame = 0;
    const fitNow = () => {
      if (
        disposed ||
        !container.current?.offsetParent ||
        container.current.clientHeight <= 0 ||
        container.current.clientWidth <= 0
      )
        return;
      const size = fitAddon.proposeDimensions();
      if (!size || !Number.isFinite(size.cols) || !Number.isFinite(size.rows))
        return;
      const cols = Math.max(2, Math.min(500, size.cols));
      const rows = Math.max(1, Math.min(250, size.rows));
      if (term.cols !== cols || term.rows !== rows) term.resize(cols, rows);
      setDimensions(`${cols} × ${rows}`);
    };
    const scheduleFit = () => {
      if (fitFrame) return;
      fitFrame = requestAnimationFrame(() => {
        fitFrame = 0;
        fitNow();
      });
    };
    fit.current = scheduleFit;
    search.current = searchAddon;
    fitNow();
    void document.fonts.ready.then(() => {
      if (!disposed) scheduleFit();
    });
    const focusInput = () => onInputFocus(pane.id, true);
    const blurInput = () => onInputFocus(pane.id, false);
    const textarea = term.textarea;
    if (textarea) {
      textarea.setAttribute("autocapitalize", "off");
      textarea.setAttribute("autocorrect", "off");
      textarea.setAttribute("inputmode", "text");
      textarea.setAttribute("enterkeyhint", "enter");
      textarea.spellcheck = false;
      textarea.addEventListener("focus", focusInput);
      textarea.addEventListener("blur", blurInput);
    }
    const socket = openTerminalSession(term.cols, term.rows, pane.containerId);
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
      input,
      keyboard: () => {
        if (document.activeElement === term.textarea) term.blur();
        else term.focus();
      },
      clear: () => term.clear(),
      copy,
      search: () => setFindOpen((value) => !value),
      zoom: (delta) => {
        term.options.fontSize = Math.max(
          10,
          Math.min(24, (term.options.fontSize ?? 14) + delta),
        );
        scheduleFit();
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
    const title = term.onTitleChange(
      (value) =>
        !pane.containerId &&
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
          setDetail(
            `${pane.containerName ? `${pane.containerName} · ` : ""}${message.user}@${message.host} · ${message.shell}`,
          );
          control({ type: "resize", cols: term.cols, rows: term.rows });
          if (container.current?.offsetParent && !touchInput()) term.focus();
        } else if (message.type === "exit") {
          onEnded(pane.id);
          ended = true;
          live.current = false;
          setState("exited");
          setDetail(
            `Shell exited with code ${message.code}. Open a new terminal to continue.`,
          );
        } else if (message.type === "error") {
          onEnded(pane.id);
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
      if (!disposed) onEnded(pane.id);
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
    const observer = new ResizeObserver(scheduleFit);
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
      cancelAnimationFrame(fitFrame);
      fit.current = null;
      textarea?.removeEventListener("focus", focusInput);
      textarea?.removeEventListener("blur", blurInput);
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
  }, [
    pane.id,
    pane.containerId,
    pane.containerName,
    onEnded,
    handles,
    onTitle,
    onInputFocus,
  ]);
  useEffect(() => {
    if (active && visible) {
      const frame = requestAnimationFrame(() => {
        fit.current?.();
        if (!touchInput()) terminal.current?.focus();
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
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
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
        data-terminal-input
        data-state={state}
        aria-label={
          pane.containerName
            ? `Container terminal: ${pane.containerName}`
            : "Server terminal"
        }
      >
        <div className="pty-surface" ref={container} />
      </div>
      <div
        className="pty-status"
        role="status"
        data-state={state}
        data-notice={!!notice}
      >
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
        <span className="pty-status-detail" title={notice || detail}>
          {notice || detail}
        </span>
        <span className="pty-dimensions" aria-label="Terminal size">
          {dimensions}
        </span>
      </div>
    </div>
  );
}
export default function TerminalView({
  visible = true,
  containerRequest,
  onRequestHandled,
}: {
  visible?: boolean;
  containerRequest?: ContainerTerminalRequest | null;
  onRequestHandled?: () => void;
}) {
  const [panes, setPanes] = useState<Pane[]>(() =>
    containerRequest ? [] : [{ id: 1, title: "Shell 1" }],
  );
  const [active, setActive] = useState(1);
  const counter = useRef(1);
  const handledRequest = useRef(0);
  const [requestError, setRequestError] = useState("");
  const panesRef = useRef(panes);
  panesRef.current = panes;
  useEffect(() => {
    if (
      !containerRequest ||
      handledRequest.current === containerRequest.requestId ||
      getSession()?.user.role !== "admin"
    )
      return;
    const controller = new AbortController();
    setRequestError("");
    const existing = panesRef.current.find(
      (p) => p.containerId === containerRequest.containerId && !p.ended,
    );
    if (existing) {
      setActive(existing.id);
      handledRequest.current = containerRequest.requestId;
      onRequestHandled?.();
      return;
    }
    if (panesRef.current.length >= 4) {
      setRequestError(
        "Four terminals are already open. Close a tab and open the container terminal again.",
      );
      handledRequest.current = containerRequest.requestId;
      onRequestHandled?.();
      return;
    }
    void checkTerminalAvailability(
      controller.signal,
      containerRequest.containerId,
    )
      .then(() => {
        if (controller.signal.aborted) return;
        const id = ++counter.current;
        setPanes((all) => [
          ...all,
          {
            id,
            title: containerRequest.name,
            containerId: containerRequest.containerId,
            containerName: containerRequest.name,
          },
        ]);
        setActive(id);
        handledRequest.current = containerRequest.requestId;
        onRequestHandled?.();
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setRequestError(
          error instanceof Error
            ? error.message
            : "Unable to open container terminal.",
        );
        handledRequest.current = containerRequest.requestId;
        onRequestHandled?.();
      });
    return () => controller.abort();
  }, [containerRequest, onRequestHandled]);
  const onEnded = useRef((id: number) =>
    setPanes((all) =>
      all.map((pane) =>
        pane.id === id && !pane.ended
          ? {
              ...pane,
              ended: true,
              title: pane.containerId ? `${pane.title} (ended)` : pane.title,
            }
          : pane,
      ),
    ),
  ).current;
  const root = useRef<HTMLDivElement>(null);
  const handles = useRef(new Map<number, Handle>());
  const [pendingClose, setPendingClose] = useState<number | null>(null);
  const [availability, setAvailability] = useState("checking");
  const [connectionError, setConnectionError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [focusMode, setFocusMode] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [inputFocused, setInputFocused] = useState<number | null>(null);
  const tabs = useRef<HTMLDivElement>(null);
  const onInputFocus = useRef((id: number, focused: boolean) => {
    setInputFocused((current) =>
      focused ? id : current === id ? null : current,
    );
  }).current;
  useEffect(() => {
    if (!visible) {
      setFocusMode(false);
      setToolsOpen(false);
      return;
    }
    tabs.current
      ?.querySelector('[aria-selected="true"]')
      ?.closest(".pty-tab")
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [active, panes, visible]);
  useEffect(() => {
    if (!visible || !focusMode) return;
    const escape = (event: KeyboardEvent) => {
      if (
        event.key === "Escape" &&
        !event.defaultPrevented &&
        !(event.target as HTMLElement).closest(
          "[data-terminal-input], .pty-find",
        )
      ) {
        event.preventDefault();
        setFocusMode(false);
      }
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [visible, focusMode]);
  const onTitle = useRef((id: number, title: string) =>
    setPanes((all) =>
      all.map((pane) => (pane.id === id ? { ...pane, title } : pane)),
    ),
  ).current;
  useEffect(() => {
    if (getSession()?.user.role !== "admin") return;
    const controller = new AbortController();
    setAvailability("checking");
    void Promise.all([
      checkTerminalAvailability(controller.signal),
      // Measure xterm only after the local monospace face is ready. Otherwise
      // the first PTY dimensions can use fallback font metrics.
      document.fonts.load('14px "JetBrains Mono"').catch(() => []),
    ]).then(
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
    if (!visible) return;
    const viewport = window.visualViewport;
    let frame = 0;
    const measure = () => {
      frame = 0;
      if (!root.current || (viewport && viewport.scale !== 1)) return;
      const top = viewport?.offsetTop ?? 0;
      const bottom = top + (viewport?.height ?? window.innerHeight);
      const parentTop =
        root.current.parentElement?.getBoundingClientRect().top ?? 0;
      const offset = focusMode ? 0 : Math.max(0, top - parentTop);
      const start = focusMode ? top : parentTop + offset;
      root.current.style.setProperty("--pty-content-offset", `${offset}px`);
      root.current.style.setProperty(
        "--pty-viewport-height",
        `${Math.max(96, bottom - start)}px`,
      );
      root.current.style.setProperty("--pty-viewport-top", `${top}px`);
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    measure();
    const observer = new ResizeObserver(schedule);
    if (root.current) observer.observe(root.current);
    window.addEventListener("resize", schedule);
    viewport?.addEventListener("resize", schedule);
    viewport?.addEventListener("scroll", schedule);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", schedule);
      viewport?.removeEventListener("resize", schedule);
      viewport?.removeEventListener("scroll", schedule);
    };
  }, [visible, focusMode]);
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
    if (containerRequest || panes.length >= 4) return;
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
  const tools = (withLabels = false) => {
    const actions = [
      {
        label: "Copy selection",
        icon: <Copy size={16} />,
        action: () => run("copy"),
      },
      {
        label: "Find in terminal",
        icon: <Search size={16} />,
        action: () => run("search"),
      },
      {
        label: "Clear scrollback",
        icon: <Eraser size={16} />,
        action: () => run("clear"),
      },
      {
        label: "Decrease terminal font",
        icon: <span>A−</span>,
        action: () => run("zoom", "-1"),
      },
      {
        label: "Increase terminal font",
        icon: <span>A+</span>,
        action: () => run("zoom", "1"),
      },
      {
        label: focusMode ? "Exit terminal focus mode" : "Focus terminal",
        icon: focusMode ? <Minimize2 size={16} /> : <Maximize2 size={16} />,
        action: () => setFocusMode((value) => !value),
      },
    ];
    return actions.map(({ label, icon, action }) => (
      <button
        key={label}
        type="button"
        aria-label={label}
        title={label}
        disabled={
          !panes.length &&
          label !== "Focus terminal" &&
          label !== "Exit terminal focus mode"
        }
        onPointerDown={(event) => event.preventDefault()}
        onClick={() => {
          setToolsOpen(false);
          action();
        }}
      >
        {icon}
        {withLabels && <span>{label}</span>}
      </button>
    ));
  };
  return (
    <div
      ref={root}
      className={`pty-terminal ${focusMode ? "pty-focus-mode" : ""}`}
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
      {requestError && (
        <div className="pty-close-prompt" role="alert">
          <span>{requestError}</span>
          <button type="button" onClick={() => setRequestError("")}>
            Dismiss
          </button>
        </div>
      )}
      <div className="pty-toolbar">
        <div
          className="pty-tabs"
          ref={tabs}
          role="tablist"
          aria-label="Terminal sessions"
        >
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
                tabIndex={active === pane.id ? 0 : -1}
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
          className="pty-new-terminal"
          aria-label="New terminal"
          title="New terminal (maximum four)"
          disabled={
            panes.length >= 4 || availability !== "ready" || !!containerRequest
          }
          onClick={add}
        >
          <Plus size={17} />
        </button>
        <div className="pty-tools">{tools()}</div>
        <Popover open={toolsOpen && visible} onOpenChange={setToolsOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="pty-more"
              aria-label="Terminal actions"
              title="Terminal actions"
            >
              <MoreHorizontal size={18} />
            </button>
          </PopoverTrigger>
          <PopoverContent
            className="pty-action-menu"
            align="end"
            collisionPadding={8}
            aria-label="Terminal actions"
            onCloseAutoFocus={(event) => {
              if (document.activeElement?.closest(".pty-find"))
                event.preventDefault();
            }}
          >
            {tools(true)}
          </PopoverContent>
        </Popover>
      </div>
      {pendingClose !== null && (
        <div className="pty-close-prompt" role="alert">
          <span>
            {panes.find((p) => p.id === pendingClose)?.containerId
              ? "Disconnect this container terminal? Processes inside the container may continue. Use exit to end the shell first."
              : "Close this shell and stop its foreground process?"}
          </span>
          <button type="button" onClick={() => setPendingClose(null)}>
            Cancel
          </button>
          <button type="button" onClick={() => close(pendingClose)}>
            {panes.find((p) => p.id === pendingClose)?.containerId
              ? "Disconnect terminal"
              : "Close shell"}
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
            onInputFocus={onInputFocus}
            onEnded={onEnded}
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
        <div
          className="pty-keys"
          role="group"
          aria-label="Terminal keyboard shortcuts"
        >
          <button
            type="button"
            className="pty-keyboard-toggle"
            aria-label={
              inputFocused === active
                ? "Dismiss terminal keyboard"
                : "Show terminal keyboard"
            }
            title={
              inputFocused === active ? "Dismiss keyboard" : "Show keyboard"
            }
            onPointerDown={(event) => event.preventDefault()}
            onClick={() => run("keyboard")}
          >
            {inputFocused === active ? (
              <KeyboardOff size={18} />
            ) : (
              <Keyboard size={18} />
            )}
          </button>
          <div className="pty-key-scroll">
            {[
              ["Esc", "\x1b"],
              ["Tab", "\t"],
              ["Ctrl C", "\x03"],
              ["↑", "\x1b[A"],
              ["↓", "\x1b[B"],
              ["←", "\x1b[D"],
              ["→", "\x1b[C"],
              ["Ctrl D", "\x04"],
              ["Ctrl Z", "\x1a"],
              ["Ctrl L", "\x0c"],
            ].map(([label, value]) => (
              <button
                type="button"
                key={label}
                aria-label={
                  (
                    {
                      "↑": "Arrow up",
                      "↓": "Arrow down",
                      "←": "Arrow left",
                      "→": "Arrow right",
                    } as Record<string, string>
                  )[label] || label
                }
                onPointerDown={(e) => e.preventDefault()}
                onClick={() => run("input", value)}
              >
                {label}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="pty-enter-key"
            aria-label="Enter"
            onPointerDown={(event) => event.preventDefault()}
            onClick={() => run("input", "\r")}
          >
            ↵
          </button>
        </div>
      )}
    </div>
  );
}
