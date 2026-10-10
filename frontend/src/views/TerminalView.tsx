import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { CornerDownLeft, Plus, TerminalSquare, X } from "lucide-react";
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

const newId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const displayPath = (path: string) => path === HOME ? "~" : path.startsWith(`${HOME}/`) ? path.replace(HOME, "~") : path;
const cleanAnsi = (value: string) =>
  value.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "").replace(/\r/g, "");
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
  const [notice, setNotice] = useState("");
  const outputRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!activeId && sessions[0]) setActiveId(sessions[0].id);
  }, [activeId, sessions]);

  const active = sessions.find((s) => s.id === activeId) ?? sessions[0];

  useEffect(() => {
    outputRef.current?.scrollTo({ top: outputRef.current.scrollHeight, behavior: "smooth" });
  }, [active?.records, active?.running]);

  useEffect(() => {
    if (active) inputRef.current?.focus({ preventScroll: true });
  }, [activeId]);

  const patchSession = (id: string, patch: Partial<TerminalSession>) =>
    setSessions((current) => current.map((s) => s.id === id ? { ...s, ...patch } : s));

  const addSession = () => {
    const next = makeSession(sessions.length + 1);
    setSessions((current) => [...current, next]);
    setActiveId(next.id);
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
    if (activeId === id) setActiveId(next[Math.max(0, next.length - 1)].id);
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

    if (command === "clear") {
      patchSession(sessionId, {
        input: "",
        records: [],
        history: [command, ...active.history.filter((item) => item !== command)].slice(0, 100),
        historyIndex: -1,
      });
      return;
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
        const tokenStart = Math.max(input.lastIndexOf(" "), input.lastIndexOf("\\t")) + 1;
        const value = candidates[0];
        patchSession(sessionId, { input: input.slice(0, tokenStart) + value + (value.endsWith("/") ? "" : " ") });
      } else if (candidates.length > 1) {
        const tokenStart = Math.max(input.lastIndexOf(" "), input.lastIndexOf("\\t")) + 1;
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

  const clearTerminal = () => {
    if (active) patchSession(active.id, { records: [], input: "" });
  };

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

  return (
    <div className="terminal-view termx-root termx-immersive">
      <div className="termx-tabs">
        <div className="termx-tabs-scroll">
          {sessions.map((s) => (
            <button key={s.id} type="button" className={`termx-tab ${s.id === activeId ? "is-active" : ""}`} onClick={() => setActiveId(s.id)}>
              <TerminalSquare size={14} />
              <span>{s.title}</span>
              <span className="termx-tab-close" role="button" aria-label={`Close ${s.title}`} onClick={(e) => { e.stopPropagation(); closeSession(s.id); }}><X size={12} /></span>
            </button>
          ))}
          <button type="button" className="termx-tab-add" aria-label="New terminal" title="New terminal" onClick={addSession}><Plus size={16} /></button>
        </div>
      </div>

      {active && <>
        <div className="termx-output" ref={outputRef} onClick={() => inputRef.current?.focus()}>
          {active.records.length === 0 && (
            <div className="termx-welcome">
              <div className="termx-welcome-icon"><TerminalSquare size={22} /></div>
              <h2>{HOST_NAME}</h2>
              <p>Connected shell · {displayPath(active.cwd)}</p>
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
          {active.running && <div className="termx-running"><span className="termx-spinner" /> Executing command…</div>}
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
            <div className="termx-server-note">CoreOps · {HOST_NAME}</div>
          </div>
        </div>
      </>}
      {notice && <div className="termx-toast">{notice}<button type="button" onClick={() => setNotice("")}><X size={14} /></button></div>}
    </div>
  );
}
