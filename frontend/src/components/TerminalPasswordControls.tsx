import { useEffect, useRef, useState } from "react";
import { KeyRound, Settings2, X } from "lucide-react";
import { ApiError } from "../shared/api/client";
import {
  terminalPasswordStatus,
  saveTerminalPassword,
  forgetTerminalPassword,
  revealTerminalPassword,
  isSafeTerminalPassword,
} from "../lib/terminalPasswords";
import "../styles/terminal-passwords.css";

export default function TerminalPasswordControls({
  target,
  label,
  visible,
  disabled,
  onPaste,
}: {
  target: string | null;
  label: string;
  visible: boolean;
  disabled: boolean;
  onPaste: (password: string, target: string) => boolean;
}) {
  const [saved, setSaved] = useState(false),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false),
    [password, setPassword] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [revision, setRevision] = useState(0);
  const dialog = useRef<HTMLDialogElement>(null),
    pending = useRef<AbortController | null>(null),
    lock = useRef(false);
  const context = useRef({ target, visible });
  context.current = { target, visible };
  useEffect(() => {
    const controller = new AbortController();
    if (!target || !visible) {
      setLoading(false);
      return () => controller.abort();
    }
    setLoading(true);
    void terminalPasswordStatus(target, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) {
          setSaved(result.saved);
          setError("");
        }
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) {
          setSaved(false);
          setError(
            cause instanceof ApiError && cause.status === 404
              ? "Password storage requires the updated CoreOps API. Rebuild/restart the backend."
              : cause instanceof Error
                ? cause.message
                : "Saved password status unavailable.",
          );
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [target, visible, revision]);
  useEffect(() => () => pending.current?.abort(), []);
  useEffect(() => {
    if (!visible) {
      pending.current?.abort();
      setOpen(false);
      setPassword("");
      setNotice("");
    }
  }, [visible]);
  useEffect(() => {
    if (!open) return;
    const element = dialog.current,
      opener = document.activeElement as HTMLElement | null;
    element?.showModal();
    return () => {
      element?.close();
      opener?.focus();
    };
  }, [open]);
  const close = () => {
    if (lock.current) return;
    setPassword("");
    setOpen(false);
  };
  const operation = async (action: "paste" | "save" | "forget") => {
    if (!target || !visible || lock.current || disabled) return;
    if (action === "save" && !isSafeTerminalPassword(password)) {
      setError("Use 1–1024 bytes without line breaks or control characters.");
      return;
    }
    const captured = target,
      controller = new AbortController();
    pending.current = controller;
    lock.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (action === "paste") {
        const result = await revealTerminalPassword(
          captured,
          controller.signal,
        );
        if (
          controller.signal.aborted ||
          context.current.target !== captured ||
          !context.current.visible
        )
          return;
        if (!isSafeTerminalPassword(result.password))
          throw new Error(
            "Stored password is not safe to paste. Replace it in password settings.",
          );
        if (!onPaste(result.password, captured))
          throw new Error(
            "The terminal changed or disconnected. Password was not pasted.",
          );
        result.password = "";
        setNotice(
          "Password pasted without Enter. Verify the active prompt before submitting.",
        );
      } else if (action === "save") {
        const result = await saveTerminalPassword(
          captured,
          password,
          controller.signal,
        );
        if (controller.signal.aborted) return;
        if (!result.saved)
          throw new Error("The API did not confirm password storage.");
        setSaved(true);
        setPassword("");
        setOpen(false);
        setNotice("Password saved encrypted. Use the key button to paste it.");
      } else {
        await forgetTerminalPassword(captured, controller.signal);
        if (controller.signal.aborted) return;
        setSaved(false);
        setPassword("");
        setNotice("Saved password removed.");
      }
    } catch (cause) {
      if (!controller.signal.aborted) {
        if (action === "save") setPassword("");
        setError(
          cause instanceof Error
            ? cause.message
            : "Password operation failed. Check saved status before retrying.",
        );
        if (cause instanceof ApiError && cause.status === 404) setSaved(false);
      }
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  return (
    <div className="pty-password-controls">
      <button
        type="button"
        aria-label={saved ? "Paste saved password" : "Save terminal password"}
        title={
          saved
            ? "Paste saved password without Enter"
            : "Save a password for this terminal target"
        }
        disabled={disabled || !target || loading || busy}
        onPointerDown={(e) => e.preventDefault()}
        onClick={() => {
          if (error || !saved) setOpen(true);
          else void operation("paste");
        }}
      >
        <KeyRound size={16} />
      </button>
      {(saved || error) && (
        <button
          type="button"
          aria-label="Manage terminal password"
          title="Manage saved password"
          disabled={disabled || busy || !target}
          onClick={() => {
            setPassword("");
            setOpen(true);
          }}
        >
          <Settings2 size={15} />
        </button>
      )}
      {(notice || (error && !open)) && (
        <div className="pty-password-notice" role={error ? "alert" : "status"}>
          <span>{error || notice}</span>
          <button
            type="button"
            aria-label="Dismiss password message"
            onClick={() => {
              setError("");
              setNotice("");
            }}
          >
            <X size={14} />
          </button>
        </div>
      )}
      {open && (
        <dialog
          ref={dialog}
          className="pty-password-dialog"
          aria-labelledby="terminal-password-title"
          onCancel={(e) => {
            e.preventDefault();
            close();
          }}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void operation("save");
            }}
          >
            <header>
              <h2 id="terminal-password-title">Terminal password</h2>
              <button
                type="button"
                aria-label="Close terminal password"
                disabled={busy}
                onClick={close}
              >
                <X size={18} />
              </button>
            </header>
            <p className="pty-password-target">{label}</p>
            <p>
              Stored encrypted on this CoreOps server for your account and this
              terminal target. The key button pastes without Enter. Check the
              active prompt; a shell can display or record pasted text.
            </p>
            <label>
              {saved ? "Replace saved password" : "Password"}
              <input
                type="password"
                name="terminal-password"
                autoComplete="new-password"
                autoCapitalize="off"
                spellCheck={false}
                maxLength={1024}
                required
                value={password}
                disabled={busy}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            <p>
              {saved
                ? "A password is saved. Its value is not displayed."
                : "No password is saved for this target."}
            </p>
            {error && <p role="alert">{error}</p>}
            <footer>
              <button
                type="button"
                disabled={busy}
                onClick={() => setRevision((value) => value + 1)}
              >
                Refresh status
              </button>
              {saved && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void operation("forget")}
                >
                  Forget password
                </button>
              )}
              <button type="submit" disabled={busy || !password}>
                {busy ? "Working…" : "Save password"}
              </button>
            </footer>
          </form>
        </dialog>
      )}
    </div>
  );
}
