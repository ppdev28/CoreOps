import { useState, type FormEvent } from "react";
import { Lock, Server } from "lucide-react";
import { T } from "../lib/tokens";
import { login } from "../lib/api";

export default function LoginView() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || !username || !password) return;
    setBusy(true);
    setError(null);
    try {
      await login(username.trim(), password);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not sign in");
      setBusy(false);
    }
  };

  const field = {
    width: "100%",
    height: 38,
    padding: "0 12px",
    background: T.bg,
    border: `1px solid ${T.border}`,
    borderRadius: 8,
    color: T.text,
    fontSize: 13,
    outline: "none",
    boxSizing: "border-box" as const,
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        background: T.bg,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
    >
      <form
        onSubmit={submit}
        style={{
          width: "100%",
          maxWidth: 360,
          background: T.raised,
          border: `1px solid ${T.border}`,
          borderRadius: 12,
          padding: 24,
          display: "flex",
          flexDirection: "column",
          gap: 14,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div
            style={{
              width: 34,
              height: 34,
              borderRadius: 9,
              background: T.accent,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Server size={17} color="#fff" />
          </div>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: T.text }}>
              CoreOps
            </div>
            <div style={{ fontSize: 11, color: T.textDim }}>
              Sign in to continue
            </div>
          </div>
        </div>
        <label style={{ fontSize: 11, color: T.textSub }}>
          Username
          <input
            style={{ ...field, marginTop: 5 }}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            autoCapitalize="none"
            autoFocus
          />
        </label>
        <label style={{ fontSize: 11, color: T.textSub }}>
          Password
          <input
            style={{ ...field, marginTop: 5 }}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
        </label>
        {error && (
          <div
            role="alert"
            style={{
              fontSize: 12,
              color: T.red,
              background: `${T.red}14`,
              border: `1px solid ${T.red}38`,
              borderRadius: 7,
              padding: "8px 10px",
            }}
          >
            {error}
          </div>
        )}
        <button
          type="submit"
          disabled={busy || !username || !password}
          style={{
            height: 38,
            borderRadius: 8,
            border: "none",
            background: T.accent,
            color: "#fff",
            fontSize: 13,
            fontWeight: 600,
            cursor: busy ? "default" : "pointer",
            opacity: busy || !username || !password ? 0.6 : 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 7,
          }}
        >
          <Lock size={13} /> {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
