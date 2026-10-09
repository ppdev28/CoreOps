import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import {
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  CornerDownLeft,
  Folder,
  History,
  Maximize2,
  Menu,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Search,
  Server,
  Settings2,
  ShieldCheck,
  Sparkles,
  Star,
  TerminalSquare,
  Trash2,
  X,
  Zap,
} from "lucide-react";
import { execTerminal, completeTerminal } from "../lib/api";

type CommandRecord = {
  id: string;
  command: string;
  output: string;
  exitCode: number;
  cwd: string;
  time: string;
};

type TerminalSession = {
  id: string;
  title: string;
  cwd: string;
  input: string;
  records: CommandRecord[];
  history: string[];
  historyIndex: number;
  running: boolean;
  completing: boolean;
};

const HOST_NAME = "homelab-server";
const HOST_USER = "pepe";
const HOME = "/home/pepe";
const QUICK_COMMANDS = [
  { label: "System overview", command: "hostnamectl && uptime && free -h", description: "Host, uptime and memory" },
  { label: "Disk usage", command: "df -h", description: "Mounted filesystems" },
  { label: "Memory", command: "free -h", description: "RAM and swap usage" },
  { label: "Running containers", command: "docker ps", description: "Active Docker containers" },
  { label: "Docker compose", command: "docker compose ls", description: "Compose projects" },
  { label: "Recent services", command: "systemctl --failed", description: "Failed system services" },
];

const newId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const displayPath = (path: string) => path === HOME ? "~" : path.startsWith(`${HOME}/`) ? path.replace(HOME, "~") : path;
const cleanAnsi = (value: string) =>
  value.replace(/\u001b(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007]*(?:\u0007|\u001b\\))/g, "").replace(/\r/g, "");
const makeSession = (n: number): TerminalSession => ({
  id: newId(),
  title: n === 1 ? "Shell" : `Shell ${n}`,
  cwd: HOME,
  input: "",
  records: [],
  history: [],
  historyIndex: -1,
  running: false,
  completing: false,
});

export default function TerminalView() {
  const [sessions, setSessions] = useState<TerminalSession[]>([makeSession(1)]);
  const [activeId, setActiveId] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [mobileHostsOpen, setMobileHostsOpen] = useState(false);
  const [full, setFull] = useState(false);
  const [panel, setPanel] = useState<"none" | "history" | "snippets">("none");
  const [copied, setCopied] = useState(false);
  const [commandFilter, setCommandFilter] = useState("");
  const [favoriteCommands, setFavoriteCommands] = useState<string[]>(["df -h", "docker ps"]);
  const [notice, setNotice] = useState("");
  const outputRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!activeId && sessions[0]) setActiveId(sessions[0].id);
  }, [activeId, sessions]);

  const active = sessions.find((s) => s.id === activeId) ?? sessions[0];
  const allCommands = useMemo(
    () => sessions.flatMap((s) => s.records.slice().reverse().map((r) => ({ ...r, sessionTitle: s.title }))).reverse(),
    [sessions],
  );
  const filteredCommands = allCommands.filter((r) =>
    `${r.command} ${r.output}`.toLowerCase().includes(commandFilter.toLowerCase()),
  );

  useEffect(() => {
    if (panel === "none") outputRef.current?.scrollTo({ top: outputRef.current.scrollHeight, behavior: "smooth" });
  }, [active?.records, active?.running, panel]);

  useEffect(() => {
    if (active && panel === "none") inputRef.current?.focus({ preventScroll: true });
  }, [activeId, panel]);

  const patchSession = (id: string, patch: Partial<TerminalSession>) =>
    setSessions((current) => current.map((s) => s.id === id ? { ...s, ...patch } : s));

  const addSession = () => {
    const next = makeSession(sessions.length + 1);
    setSessions((current) => [...current, next]);
    setActiveId(next.id);
    setPanel("none");
    setMobileHostsOpen(false);
  };

  const closeSession = (id: string) => {
    if (sessions.length === 1) {
      const reset = makeSession(1);
      setSessions([reset]);
      setActiveId(reset.id);
      return;
    }
    const next = sessions.filter((s) => s.id !== id);
    setSessions(next);
    if (activeId === id) setActiveId(next[next.length - 1].id);
  };

  const runCommand = async (provided?: string) => {
    if (!active || active.running) return;
    const command = (provided ?? active.input).trim();
    if (!command) return;

    const sessionId = active.id;
    const startCwd = active.cwd;
    const commandRecord: CommandRecord = {
      id: newId(),
      command,
      output: "",
      exitCode: 0,
      cwd: startCwd,
      time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    };

    if (/^clear(?:\s|$)/.test(command)) {
      patchSession(sessionId, {
        input: "",
        records: [],
        history: [command, ...active.history.filter((item) => item !== command)].slice(0, 100),
        historyIndex: -1,
      });
      if (command.trim() !== "clear") {
        // Preserve shell semantics for commands such as "clear && ..."
      } else {
        return;
      }
    }

    patchSession(sessionId, {
      input: "",
      running: true,
      history: [command, ...active.history.filter((item) => item !== command)].slice(0, 100),
      historyIndex: -1,
    });

    try {
      const result = await execTerminal(command, startCwd);
      const output = cleanAnsi(result.output || "");
      const record = { ...commandRecord, output, exitCode: result.exitCode ?? 0, cwd: result.cwd || startCwd };
      setSessions((current) => current.map((s) => s.id === sessionId
        ? { ...s, cwd: record.cwd, running: false, records: [...s.records, record] }
        : s));
    } catch (error) {
      const record = {
        ...commandRecord,
        output: error instanceof Error ? error.message : "Command failed",
        exitCode: 1,
      };
      setSessions((current) => current.map((s) => s.id === sessionId
        ? { ...s, running: false, records: [...s.records, record] }
        : s));
    }
  };

  const complete = async () => {
    if (!active || active.running || active.completing) return;
    const sessionId = active.id;
    const input = active.input;
    patchSession(sessionId, { completing: true });
    try {
      const candidates = await completeTerminal(input, active.cwd);
      if (candidates.length === 1) {
        const tokenStart = Math.max(input.lastIndexOf(" "), input.lastIndexOf("\t")) + 1;
        const value = candidates[0];
        patchSession(sessionId, { input: input.slice(0, tokenStart) + value + (value.endsWith("/") ? "" : " ") });
      } else if (candidates.length > 1) {
        const tokenStart = Math.max(input.lastIndexOf(" "), input.lastIndexOf("\t")) + 1;
        const token = input.slice(tokenStart);
        const prefix = candidates.reduce((p, item) => {
          let i = 0;
          while (i < p.length && i < item.length && p[i] === item[i]) i++;
          return p.slice(0, i);
        }, candidates[0]);
        if (prefix.length > token.length) patchSession(sessionId, { input: input.slice(0, tokenStart) + prefix });
        setNotice(`${candidates.length} completions available`);
      }
    } catch {
      setNotice("Completion is unavailable right now");
    } finally {
      patchSession(sessionId, { completing: false });
      inputRef.current?.focus();
    }
  };

  const insertText = (value: string) => {
    if (!active || active.running) return;
    patchSession(active.id, { input: active.input + value });
    inputRef.current?.focus();
  };

  const copyTranscript = async () => {
    if (!active) return;
    const transcript = active.records.map((r) =>
      `pepe@homelab-server:${displayPath(r.cwd)}$ ${r.command}${r.output ? `\n${r.output}` : ""}`,
    ).join("\n");
    try {
      await navigator.clipboard.writeText(transcript);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      setNotice("Clipboard access is unavailable in this context");
    }
  };

  const clearTerminal = () => {
    if (active) patchSession(active.id, { records: [], input: "" });
    setPanel("none");
  };

  const toggleFavorite = (command: string) => setFavoriteCommands((current) =>
    current.includes(command) ? current.filter((item) => item !== command) : [...current, command],
  );

  const handleInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (!active) return;
    if (event.key === "Enter") {
      event.preventDefault();
      void runCommand();
    } else if (event.key === "Tab") {
      event.preventDefault();
      void complete();
    } else if (event.key === "ArrowUp" && !active.input) {
      event.preventDefault();
      const index = Math.min(active.historyIndex + 1, active.history.length - 1);
      patchSession(active.id, { historyIndex: index, input: active.history[index] ?? "" });
    } else if (event.key === "ArrowDown" && active.historyIndex >= 0) {
      event.preventDefault();
      const index = active.historyIndex - 1;
      patchSession(active.id, { historyIndex: index, input: index < 0 ? "" : active.history[index] ?? "" });
    } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "l") {
      event.preventDefault();
      clearTerminal();
    } else if (event.key === "Escape") {
      patchSession(active.id, { input: "" });
    }
  };

  const shellContent = active ? (
    <div className="termx-workspace">
      <div className="termx-tabs">
        <div className="termx-tabs-scroll">
          {sessions.map((s) => (
            <button key={s.id} type="button" className={`termx-tab ${s.id === activeId ? "is-active" : ""}`} onClick={() => { setActiveId(s.id); setPanel("none"); }}>
              <TerminalSquare size={14} />
              <span>{s.title}</span>
              <span className="termx-tab-close" role="button" aria-label={`Close ${s.title}`} onClick={(e) => { e.stopPropagation(); closeSession(s.id); }}><X size={12} /></span>
            </button>
          ))}
          <button type="button" className="termx-tab-add" aria-label="New terminal" onClick={addSession}><Plus size={16} /></button>
        </div>
        <div className="termx-session-state"><span className="termx-state-dot" /> Shell ready</div>
      </div>

      <div className="termx-toolbar">
        <div className="termx-breadcrumb">
          <Server size={14} />
          <span>{HOST_NAME}</span>
          <ChevronRight size={13} />
          <Folder size={14} />
          <span className="termx-path">{displayPath(active.cwd)}</span>
        </div>
        <div className="termx-toolbar-actions">
          <button type="button" title="Command history" className={panel === "history" ? "is-selected" : ""} onClick={() => setPanel(panel === "history" ? "none" : "history")}><History size={15} /><span>History</span></button>
          <button type="button" title="Quick commands" className={panel === "snippets" ? "is-selected" : ""} onClick={() => setPanel(panel === "snippets" ? "none" : "snippets")}><Zap size={15} /><span>Quick commands</span></button>
          <button type="button" title="Copy transcript" onClick={() => void copyTranscript()}>{copied ? <Check size={15} /> : <Copy size={15} />}<span>{copied ? "Copied" : "Copy"}</span></button>
          <button type="button" title="Clear terminal" onClick={clearTerminal}><Trash2 size={15} /><span>Clear</span></button>
          <button type="button" title={full ? "Exit fullscreen" : "Fullscreen"} onClick={() => setFull(!full)}><Maximize2 size={15} /></button>
          <button type="button" title="More actions" onClick={() => setNotice("Tip: ↑ / ↓ recalls commands · Tab completes · Ctrl/⌘+L clears the view")}><MoreHorizontal size={16} /></button>
        </div>
      </div>

      {panel !== "none" && (
        <div className="termx-side-panel">
          <div className="termx-side-panel-head">
            <div>
              <strong>{panel === "history" ? "Command history" : "Quick commands"}</strong>
              <span>{panel === "history" ? "Run a previous command again" : "Useful server operations"}</span>
            </div>
            <button type="button" aria-label="Close panel" onClick={() => setPanel("none")}><X size={16} /></button>
          </div>
          <div className="termx-side-panel-search">
            <Search size={15} />
            <input value={commandFilter} onChange={(e) => setCommandFilter(e.target.value)} placeholder={panel === "history" ? "Search command history…" : "Filter quick commands…"} />
          </div>
          <div className="termx-side-panel-list">
            {panel === "history" ? filteredCommands.slice().reverse().map((r) => (
              <div className="termx-history-row" key={r.id}>
                <button type="button" className="termx-history-run" onClick={() => { patchSession(active.id, { input: r.command }); setPanel("none"); inputRef.current?.focus(); }}><CornerDownLeft size={14} /></button>
                <button type="button" className="termx-history-command" onClick={() => { patchSession(active.id, { input: r.command }); setPanel("none"); inputRef.current?.focus(); }}>
                  <code>{r.command}</code><span>{r.sessionTitle} · {r.time}</span>
                </button>
                <span className={`termx-exit-code ${r.exitCode === 0 ? "ok" : "bad"}`}>{r.exitCode}</span>
              </div>
            )) : QUICK_COMMANDS.filter((q) => `${q.label} ${q.command} ${q.description}`.toLowerCase().includes(commandFilter.toLowerCase())).map((q) => (
              <div className="termx-quick-row" key={q.command}>
                <button type="button" className="termx-quick-run" onClick={() => { void runCommand(q.command); setPanel("none"); }}><Zap size={14} /></button>
                <button type="button" className="termx-quick-main" onClick={() => { patchSession(active.id, { input: q.command }); setPanel("none"); inputRef.current?.focus(); }}>
                  <strong>{q.label}</strong><code>{q.command}</code><span>{q.description}</span>
                </button>
                <button type="button" className={`termx-fav ${favoriteCommands.includes(q.command) ? "is-favorite" : ""}`} aria-label="Toggle favorite command" onClick={() => toggleFavorite(q.command)}><Star size={15} fill={favoriteCommands.includes(q.command) ? "currentColor" : "none"} /></button>
              </div>
            ))}
            {panel === "history" && filteredCommands.length === 0 && <div className="termx-empty">No matching commands yet.</div>}
          </div>
        </div>
      )}

      <div className="termx-output" ref={outputRef} onClick={() => inputRef.current?.focus()}>
        {active.records.length === 0 && (
          <div className="termx-welcome">
            <div className="termx-welcome-icon"><TerminalSquare size={22} /></div>
            <h2>Welcome to {HOST_NAME}</h2>
            <p>Run a command to start working on your server.</p>
            <div className="termx-welcome-chips">
              <button type="button" onClick={() => { patchSession(active.id, { input: "hostnamectl" }); inputRef.current?.focus(); }}>hostnamectl <CornerDownLeft size={12} /></button>
              <button type="button" onClick={() => { patchSession(active.id, { input: "docker ps" }); inputRef.current?.focus(); }}>docker ps <CornerDownLeft size={12} /></button>
              <button type="button" onClick={() => { patchSession(active.id, { input: "df -h" }); inputRef.current?.focus(); }}>df -h <CornerDownLeft size={12} /></button>
            </div>
          </div>
        )}
        {active.records.map((record) => (
          <div className="termx-command-block" key={record.id}>
            <div className="termx-command-prompt">
              <span className="termx-prompt-user">{HOST_USER}@{HOST_NAME}</span><span className="termx-prompt-separator">:</span><span className="termx-prompt-path">{displayPath(record.cwd)}</span><span className="termx-prompt-symbol">$</span><span className="termx-command-text">{record.command}</span>
              <span className="termx-command-time">{record.time}</span>
            </div>
            {record.output && <pre className={`termx-command-output ${record.exitCode !== 0 ? "has-error" : ""}`}>{record.output}</pre>}
            {record.exitCode !== 0 && <div className="termx-command-status"><span /> Process exited with code {record.exitCode}</div>}
          </div>
        ))}
        {active.running && <div className="termx-running"><span className="termx-spinner" /> Executing command on {HOST_NAME}…</div>}
      </div>

      <div className="termx-input-area">
        <div className="termx-input-card">
          <div className="termx-input-prompt">
            <span>{HOST_USER}@{HOST_NAME}</span><b>:</b><span>{displayPath(active.cwd)}</span><strong>$</strong>
          </div>
          <input
            ref={inputRef}
            value={active.input}
            disabled={active.running}
            onChange={(e) => patchSession(active.id, { input: e.target.value, historyIndex: -1 })}
            onKeyDown={handleInputKeyDown}
            placeholder={active.running ? "Command running…" : "Type a command…"}
            aria-label="Command to execute on server"
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="send"
          />
          <button type="button" className="termx-run-button" disabled={active.running || !active.input.trim()} onClick={() => void runCommand()} aria-label="Run command">
            {active.running ? <span className="termx-spinner" /> : <CornerDownLeft size={17} />}
          </button>
        </div>
        <div className="termx-input-footer">
          <div className="termx-mobile-keys" aria-label="Terminal keyboard shortcuts">
            <button type="button" onClick={() => void complete()} disabled={active.running}>Tab</button>
            <button type="button" onClick={() => insertText(" | ")} disabled={active.running}>|</button>
            <button type="button" onClick={() => insertText(" && ")} disabled={active.running}>&&</button>
            <button type="button" onClick={() => insertText(" ~")} disabled={active.running}>~</button>
            <button type="button" onClick={() => insertText("sudo ")} disabled={active.running}>sudo</button>
            <button type="button" onClick={() => insertText(" --help")} disabled={active.running}>--help</button>
            <button type="button" onClick={() => void runCommand()} disabled={active.running || !active.input.trim()} aria-label="Run command"><CornerDownLeft size={15} /></button>
          </div>
          <div className="termx-hints"><span><kbd>Enter</kbd> run</span><span><kbd>↑</kbd><kbd>↓</kbd> history</span><span><kbd>Tab</kbd> complete</span><span><kbd>Ctrl/⌘ L</kbd> clear</span></div>
          <div className="termx-server-note"><ShieldCheck size={12} /> CoreOps server shell</div>
        </div>
      </div>
    </div>
  ) : null;

  return (
    <div className={`terminal-view termx-root ${full ? "termx-fullscreen" : ""} `}>
      {!full && (
        <header className="termx-app-header">
          <button type="button" className="termx-icon-button termx-mobile-menu" aria-label="Open hosts" onClick={() => setMobileHostsOpen(!mobileHostsOpen)}><Menu size={18} /></button>
          <div className="termx-app-brand"><div className="termx-brand-mark"><TerminalSquare size={18} /></div><div><strong>Terminal</strong><span>Secure server workspace</span></div></div>
          <div className="termx-header-host"><span className="termx-state-dot" /><Server size={15} /><strong>{HOST_NAME}</strong><ChevronDown size={14} /></div>
          <button type="button" className="termx-icon-button" title="New terminal" onClick={addSession}><Plus size={18} /></button>
        </header>
      )}
      <div className="termx-main">
        {!full && (
          <aside className={`termx-host-sidebar ${sidebarOpen ? "is-open" : "is-collapsed"} ${mobileHostsOpen ? "mobile-open" : ""}`}>
            <div className="termx-sidebar-top">
              <span>WORKSPACE</span>
              <button type="button" title={sidebarOpen ? "Collapse sidebar" : "Expand sidebar"} onClick={() => setSidebarOpen(!sidebarOpen)}>{sidebarOpen ? <PanelLeftClose size={15} /> : <PanelLeftOpen size={15} />}</button>
            </div>
            {sidebarOpen && <>
              <button type="button" className="termx-sidebar-search" onClick={() => { setPanel("history"); setMobileHostsOpen(false); }}>
                <Search size={15} /><span>Search commands & history</span><kbd>⌘ K</kbd>
              </button>
              <div className="termx-sidebar-section"><span>CONNECTIONS</span><button type="button" title="Add terminal" onClick={addSession}><Plus size={14} /></button></div>
              <button type="button" className="termx-host-card is-active" onClick={() => { setMobileHostsOpen(false); setPanel("none"); }}>
                <div className="termx-host-icon"><Server size={17} /></div>
                <div className="termx-host-meta"><strong>{HOST_NAME}</strong><span>CoreOps server</span><small><i /> Available through CoreOps</small></div>
                <Star size={14} className="termx-host-star" fill="currentColor" />
              </button>
              <div className="termx-sidebar-section termx-sidebar-section-spaced"><span>TERMINALS</span><button type="button" title="New terminal" onClick={addSession}><Plus size={14} /></button></div>
              {sessions.map((s) => <button type="button" key={s.id} className={`termx-sidebar-session ${s.id === activeId ? "is-active" : ""}`} onClick={() => { setActiveId(s.id); setPanel("none"); setMobileHostsOpen(false); }}>
                <TerminalSquare size={15} /><span>{s.title}</span><small>{s.records.length ? `${s.records.length} cmds` : "Ready"}</small>
              </button>)}
              <div className="termx-sidebar-section termx-sidebar-section-spaced"><span>FAVORITES</span><button type="button" title="Manage quick commands" onClick={() => setPanel("snippets")}><Plus size={14} /></button></div>
              {QUICK_COMMANDS.filter((q) => favoriteCommands.includes(q.command)).map((q) => <button type="button" className="termx-sidebar-favorite" key={q.command} onClick={() => { patchSession(active.id, { input: q.command }); setPanel("none"); inputRef.current?.focus(); }}><Star size={13} fill="currentColor" /><span>{q.label}</span></button>)}
              <div className="termx-sidebar-bottom">
                <div className="termx-avatar">C</div><div><strong>CoreOps</strong><span>Local shell profile</span></div><Settings2 size={15} />
              </div>
            </>}
            {!sidebarOpen && <div className="termx-collapsed-icons"><Server size={18} /><TerminalSquare size={18} /><Star size={17} /></div>}
          </aside>
        )}
        <main className="termx-terminal-main">
          {shellContent}
        </main>
      </div>
      {mobileHostsOpen && <button type="button" className="termx-mobile-backdrop" aria-label="Close hosts panel" onClick={() => setMobileHostsOpen(false)} />}
      {notice && <div className="termx-toast"><Sparkles size={14} />{notice}<button type="button" onClick={() => setNotice("")}><X size={14} /></button></div>}
    </div>
  );
}
