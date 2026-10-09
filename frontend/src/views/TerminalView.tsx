import { useState, useRef, useEffect } from "react";
import {
  Plus,
  Trash2,
  Maximize2,
  RefreshCw,
  Copy,
  ChevronDown,
  CornerDownLeft,
} from "lucide-react";
import { T } from "../lib/tokens";
import { Btn } from "../components/ui";
import { completeTerminal, execTerminal } from "../lib/api";

interface Session {
  id: string;
  title: string;
  lines: string[];
  input: string;
  cwd: string;
  running: boolean;
  completing: boolean;
}

function mkSession(n: number): Session {
  return {
    id: String(n),
    title: `Terminal ${n}`,
    lines: [
      "Connected to homelab-server",
      "Interactive shell — commands execute on the server.",
      "",
    ],
    input: "",
    cwd: "/home/pepe",
    running: false,
    completing: false,
  };
}

const ANSI_PATTERN =
  /\u001b(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007]*(?:\u0007|\u001b\\))/g;
const hasClearSequence = (output: string) =>
  /\u001b\[[0-9;]*[23]?J/.test(output);
const stripAnsi = (output: string) =>
  output.replace(ANSI_PATTERN, "").replace(/\r/g, "");
const longestCommonPrefix = (values: string[]) => {
  if (!values.length) return "";
  let prefix = values[0];
  for (const value of values.slice(1)) {
    let i = 0;
    while (i < prefix.length && i < value.length && prefix[i] === value[i]) i++;
    prefix = prefix.slice(0, i);
    if (!prefix) break;
  }
  return prefix;
};

export default function TerminalView() {
  const [sessions, setSessions] = useState<Session[]>([mkSession(1)]);
  const [active, setActive] = useState("1");
  const [full, setFull] = useState(false);
  const [copied, setCopied] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const sess = sessions.find((s) => s.id === active);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [sess?.lines, sess?.running]);
  useEffect(() => {
    inputRef.current?.focus();
  }, [active]);

  const update = (patch: Partial<Session>) =>
    setSessions((prev) =>
      prev.map((s) => (s.id === active ? { ...s, ...patch } : s)),
    );
  const addSession = () => {
    const n = sessions.reduce((m, s) => Math.max(m, Number(s.id)), 0) + 1;
    const s = mkSession(n);
    setSessions((prev) => [...prev, s]);
    setActive(s.id);
  };
  const closeSession = (id: string) => {
    if (sessions.length === 1) return;
    const rest = sessions.filter((s) => s.id !== id);
    setSessions(rest);
    if (active === id) setActive(rest[rest.length - 1].id);
  };
  const clear = () => update({ lines: [], input: "" });
  const reconnect = () =>
    update({
      lines: [
        "Connected to homelab-server",
        "Interactive shell — commands execute on the server.",
        "",
      ],
      cwd: "/home/pepe",
    });

  const submit = async () => {
    if (!sess || sess.running || !sess.input.trim()) return;
    const command = sess.input;
    const prompt = `pepe@homelab-server:${sess.cwd.replace("/home/pepe", "~")}$ ${command}`;
    update({ input: "", running: true, lines: [...sess.lines, prompt] });
    try {
      const result = await execTerminal(command, sess.cwd);
      const output = result.output || "";
      const cleared =
        hasClearSequence(output) ||
        /^\s*clear\s*(?:;|&&|$)/.test(command.trim());
      const cleanOutput = stripAnsi(output);
      const nextLines = [
        ...(cleared ? [] : sess.lines),
        prompt,
        ...(cleanOutput ? cleanOutput.split("\n") : []),
      ];
      setSessions((prev) =>
        prev.map((s) =>
          s.id === active
            ? {
                ...s,
                cwd: result.cwd || s.cwd,
                running: false,
                lines: [
                  ...nextLines,
                  `pepe@homelab-server:${(result.cwd || s.cwd).replace("/home/pepe", "~")}$ `,
                ],
              }
            : s,
        ),
      );
    } catch (error) {
      setSessions((prev) =>
        prev.map((s) =>
          s.id === active
            ? {
                ...s,
                running: false,
                lines: [
                  ...s.lines,
                  `CoreOps: ${error instanceof Error ? error.message : "command failed"}`,
                  `pepe@homelab-server:${s.cwd.replace("/home/pepe", "~")}$ `,
                ],
              }
            : s,
        ),
      );
    }
  };

  const tabComplete = async () => {
    if (!sess || sess.running || sess.completing) return;
    update({ completing: true });
    try {
      const candidates = await completeTerminal(sess.input, sess.cwd);
      if (candidates.length === 1) {
        const tokenStart =
          Math.max(sess.input.lastIndexOf(" "), sess.input.lastIndexOf("\t")) +
          1;
        const replacement = candidates[0];
        update({
          input:
            sess.input.slice(0, tokenStart) +
            replacement +
            (replacement.endsWith("/") ? "" : " "),
        });
      } else if (candidates.length > 1) {
        const tokenStart =
          Math.max(sess.input.lastIndexOf(" "), sess.input.lastIndexOf("\t")) +
          1;
        const currentToken = sess.input.slice(tokenStart);
        const prefix = longestCommonPrefix(candidates);
        if (prefix.length > currentToken.length)
          update({ input: sess.input.slice(0, tokenStart) + prefix });
      }
    } catch {
      // Completion is best-effort; a failed completion request must not disrupt the shell.
    } finally {
      update({ completing: false });
    }
  };

  const insertSnippet = (snippet: string) => {
    if (!sess || sess.running) return;
    update({ input: `${sess.input}${snippet}` });
    inputRef.current?.focus();
  };

  const copyOutput = async () => {
    if (!sess) return;
    try {
      await navigator.clipboard.writeText(sess.lines.join("\n"));
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {}
  };

  return (
    <div
      className="terminal-view"
      style={{
        padding: full ? 0 : "22px 24px",
        display: "flex",
        flexDirection: "column",
        height: "100%",
      }}
    >
      {!full && (
        <div
          className="terminal-page-header"
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            marginBottom: 14,
            flexWrap: "wrap",
            gap: 8,
          }}
        >
          <div>
            <h1
              style={{
                fontSize: 17,
                fontWeight: 700,
                color: T.text,
                letterSpacing: "-0.02em",
              }}
            >
              Terminal
            </h1>
            <p style={{ fontSize: 12, color: T.textDim, marginTop: 2 }}>
              Integrated shell on homelab-server.
            </p>
          </div>
          <div className="terminal-toolbar-actions" style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <Btn
              variant="secondary"
              size="xs"
              icon={<RefreshCw size={11} />}
              onClick={reconnect}
            >
              Reconnect
            </Btn>
            <Btn variant="ghost" size="xs" onClick={clear}>
              Clear
            </Btn>
            <Btn
              variant="ghost"
              size="xs"
              icon={<Copy size={11} />}
              onClick={copyOutput}
            >
              {copied ? "Copied" : "Copy"}
            </Btn>
            <Btn
              variant="ghost"
              size="xs"
              icon={<Maximize2 size={11} />}
              onClick={() => setFull((v) => !v)}
            >
              Fullscreen
            </Btn>
            <Btn
              variant="secondary"
              size="xs"
              icon={<Plus size={11} />}
              onClick={addSession}
            >
              New session
            </Btn>
          </div>
        </div>
      )}
      <div
        className="terminal-panel"
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          background: T.bg,
          border: `1px solid ${T.border}`,
          borderRadius: full ? 0 : 10,
          overflow: "hidden",
          ...(full ? { position: "fixed", inset: 0, zIndex: 500 } : {}),
        }}
      >
        <div
          className="terminal-session-bar"
          style={{
            display: "flex",
            alignItems: "center",
            background: T.raised,
            borderBottom: `1px solid ${T.border}`,
          }}
        >
          <div className="terminal-session-tabs" style={{ display: "flex", flex: 1, overflowX: "auto" }}>
            {sessions.map((s) => (
              <div
                key={s.id}
                onClick={() => setActive(s.id)}
                className={`terminal-session-tab${active === s.id ? " active" : ""}`}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setActive(s.id); }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 7,
                  padding: "8px 14px",
                  cursor: "pointer",
                  borderRight: `1px solid ${T.border}`,
                  background: active === s.id ? T.bg : "none",
                }}
              >
                <span
                  style={{
                    fontSize: 12,
                    fontWeight: 500,
                    color: active === s.id ? T.text : T.textDim,
                  }}
                >
                  {s.title}
                </span>
                {sessions.length > 1 && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      closeSession(s.id);
                    }}
                    style={{
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                      color: T.textDim,
                      padding: 1,
                    }}
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "0 12px",
            }}
          >
            <span
              style={{
                width: 7,
                height: 7,
                borderRadius: "50%",
                background: sess?.running ? T.yellow : T.green,
              }}
            />
            <span style={{ fontSize: 10, color: T.textDim }}>
              {sess?.running ? "Running" : "Connected"}
            </span>
            <ChevronDown size={12} color={T.textDim} />
          </div>
        </div>
        {sess && (
          <div
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              minHeight: 0,
            }}
          >
            <div
              className="terminal-output"
              style={{
                flex: 1,
                overflowY: "auto",
                padding: "14px 16px",
                cursor: "text",
              }}
              onClick={() => inputRef.current?.focus()}
            >
              <div
                style={{
                  fontFamily: "JetBrains Mono,monospace",
                  fontSize: 12.5,
                  lineHeight: 1.75,
                }}
              >
                {sess.lines.map((line, i) => (
                  <div
                    key={i}
                    style={{
                      color: line.startsWith("CoreOps:")
                        ? T.red
                        : line.startsWith("Connected")
                          ? T.green
                          : T.textSub,
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-all",
                    }}
                  >
                    {line || "\u00a0"}
                  </div>
                ))}
                <div ref={bottomRef} />
              </div>
            </div>
            <div
              className="terminal-command-row"
              style={{
                display: "flex",
                alignItems: "center",
                padding: "9px 16px",
                borderTop: `1px solid ${T.border}`,
                fontFamily: "JetBrains Mono,monospace",
                fontSize: 12.5,
              }}
            >
              <span
                className="terminal-prompt"
                style={{ color: T.green, whiteSpace: "pre" }}
              >{`pepe@homelab-server:${sess.cwd.replace("/home/pepe", "~")}$ `}</span>
              <input
                ref={inputRef}
                value={sess.input}
                disabled={sess.running}
                onChange={(e) => update({ input: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void submit();
                  } else if (e.key === "Tab") {
                    e.preventDefault();
                    void tabComplete();
                  }
                }}
                className="terminal-command-input"
                aria-label="Command to execute on server"
                enterKeyHint="send"
                style={{
                  flex: 1,
                  background: "none",
                  border: "none",
                  outline: "none",
                  color: T.text,
                  fontFamily: "JetBrains Mono,monospace",
                  fontSize: 12.5,
                  caretColor: T.green,
                }}
                spellCheck={false}
                autoCapitalize="off"
                autoCorrect="off"
              />
              {sess.running && (
                <span style={{ fontSize: 10, color: T.yellow }}>
                  executing…
                </span>
              )}
              {sess.completing && (
                <span style={{ fontSize: 10, color: T.textDim }}>tab…</span>
              )}
            </div>
            <div className="terminal-mobile-keybar" aria-label="Terminal shortcuts">
              <button type="button" onClick={() => void tabComplete()} disabled={sess.running || sess.completing}>Tab</button>
              <button type="button" onClick={() => insertSnippet(" | ")} disabled={sess.running}>|</button>
              <button type="button" onClick={() => insertSnippet(" && ")} disabled={sess.running}>{"&&"}</button>
              <button type="button" onClick={() => insertSnippet(" / ")} disabled={sess.running}>/</button>
              <button type="button" onClick={() => insertSnippet(" ~")} disabled={sess.running}>~</button>
              <button type="button" onClick={() => insertSnippet(" ..")} disabled={sess.running}>..</button>
              <button type="button" onClick={() => insertSnippet("sudo ")} disabled={sess.running}>sudo</button>
              <button type="button" className="terminal-mobile-run" onClick={() => void submit()} disabled={sess.running || !sess.input.trim()} aria-label="Run command"><CornerDownLeft size={17} /></button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
