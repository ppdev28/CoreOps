import { useEffect, useRef, useState } from "react";
import { Power, Moon, RotateCw, RefreshCw, X } from "lucide-react";
import {
  getPowerInfo,
  submitPower,
  type PowerAction,
  type PowerInfo,
} from "../lib/administration";
import { getSession } from "../lib/auth";
import { logout as signOut } from "../lib/api";
import "../styles/administration.css";

type ActionID = PowerAction;
type Info = PowerInfo;
const labels = { poweroff: "Shut down", suspend: "Suspend", reboot: "Restart" };
const icons = { poweroff: Power, suspend: Moon, reboot: RotateCw };

export default function PowerControls() {
  const [info, setInfo] = useState<Info | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const [selected, setSelected] = useState<ActionID | null>(null);
  const admin = getSession()?.user.role === "admin";
  useEffect(() => {
    if (!admin) return;
    const controller = new AbortController();
    setLoading(true);
    void getPowerInfo(controller.signal)
      .then((next) => {
        if (!controller.signal.aborted) {
          setInfo(next);
          setError("");
        }
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) {
          setInfo(null);
          setError(
            cause instanceof Error
              ? cause.message
              : "Host power controls are unavailable.",
          );
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [admin, revision]);
  if (!admin) return null;
  return (
    <section className="power-controls" aria-label="Host control center">
      <div className="power-heading">
        <strong>Control center</strong>
        <button
          type="button"
          aria-label="Refresh power controls"
          disabled={loading}
          onClick={() => setRevision((v) => v + 1)}
        >
          <RefreshCw size={14} />
        </button>
      </div>
      <small>
        {info
          ? `Server: ${info.hostname}`
          : loading
            ? "Checking host capabilities…"
            : "Host unavailable"}
      </small>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {(["poweroff", "suspend", "reboot"] as const).map((id) => {
        const action = info?.actions.find((a) => a.id === id);
        const Icon = icons[id];
        return (
          <div key={id}>
            <button
              className="power-action"
              type="button"
              disabled={loading || !action?.available || !!notice}
              onClick={() => setSelected(id)}
            >
              <Icon size={16} />
              {labels[id]}
            </button>
            {!loading && action?.reason && <small>{action.reason}</small>}
          </div>
        );
      })}
      {selected && info && (
        <PowerConfirmation
          action={selected}
          info={info}
          onClose={() => setSelected(null)}
          onAccepted={() => {
            setSelected(null);
            setNotice(
              "Request accepted. The host may disconnect. This does not confirm that the operation has finished.",
            );
          }}
        />
      )}
    </section>
  );
}
function PowerConfirmation({
  action,
  info,
  onClose,
  onAccepted,
}: {
  action: ActionID;
  info: Info;
  onClose: () => void;
  onAccepted: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [error, setError] = useState("");
  const locked = useRef(false);
  useEffect(() => {
    const element = dialog.current;
    const opener = document.activeElement as HTMLElement | null;
    element?.showModal();
    return () => {
      element?.close();
      opener?.focus();
    };
  }, []);
  return (
    <dialog
      className="admin-dialog"
      ref={dialog}
      aria-labelledby="power-confirm-title"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (locked.current || confirmation !== info.hostname || attempted)
            return;
          locked.current = true;
          setBusy(true);
          setAttempted(true);
          const bytes = crypto.getRandomValues(new Uint8Array(16));
          const requestId = Array.from(bytes, (b) =>
            b.toString(16).padStart(2, "0"),
          ).join("");
          void submitPower(info, action, requestId)
            .then(() => {
              onAccepted();
            })
            .catch((cause: unknown) =>
              setError(
                cause instanceof Error
                  ? cause.message
                  : "Request outcome is unconfirmed. Check the host before another request.",
              ),
            )
            .finally(() => {
              locked.current = false;
              setBusy(false);
            });
        }}
      >
        <header>
          <h2 id="power-confirm-title">
            {labels[action]} {info.hostname}?
          </h2>
          <button
            type="button"
            disabled={busy}
            aria-label="Close power confirmation"
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </header>
        <p>
          This affects the entire server, its applications and active sessions.
          The connection may close. For suspension, remote access will require
          the host to wake again.
        </p>
        <label>
          Type the server name to confirm
          <input
            aria-label="Confirm server name"
            required
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            value={confirmation}
            onChange={(e) => setConfirmation(e.target.value)}
            disabled={busy || attempted}
          />
        </label>
        <code>{info.hostname}</code>
        {error && <p role="alert">{error} No automatic retry was made.</p>}
        <footer>
          <button type="button" disabled={busy} onClick={onClose}>
            {attempted ? "Close" : "Cancel"}
          </button>
          {!attempted && (
            <button
              className="admin-danger"
              type="submit"
              disabled={busy || confirmation !== info.hostname}
            >
              {labels[action]} server
            </button>
          )}
          {busy && <span role="status">Submitting request…</span>}
        </footer>
      </form>
    </dialog>
  );
}

export function NativeControlCenter() {
  const [open, setOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener("coreops-control-center", show);
    return () => window.removeEventListener("coreops-control-center", show);
  }, []);
  useEffect(() => {
    if (open) dialog.current?.showModal();
  }, [open]);
  if (!open) return null;
  return (
    <dialog
      className="admin-dialog native-control-center"
      ref={dialog}
      aria-labelledby="native-control-title"
      onCancel={(e) => {
        e.preventDefault();
        setOpen(false);
      }}
    >
      <header>
        <h2 id="native-control-title">{getSession()?.user.name}</h2>
        <button
          type="button"
          aria-label="Close control center"
          onClick={() => setOpen(false)}
        >
          <X size={18} />
        </button>
      </header>
      <PowerControls />
      <button type="button" onClick={() => void signOut()}>
        Sign out
      </button>
    </dialog>
  );
}
