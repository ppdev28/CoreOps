import { useEffect, useRef, useState } from "react";
import { Plus, RefreshCw, Users, X } from "lucide-react";
import { listUsers, createUser } from "../lib/administration";
import { getSession, type AuthUser, type Role } from "../lib/auth";
import "../styles/administration.css";

export default function UserManagement() {
  const [users, setUsers] = useState<AuthUser[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [opened, setOpened] = useState(false);
  const [revision, setRevision] = useState(0);
  const admin = getSession()?.user.role === "admin";
  useEffect(() => {
    if (!admin) return;
    const controller = new AbortController();
    setLoading(true);
    void listUsers(controller.signal)
      .then((next) => {
        if (!controller.signal.aborted) {
          setUsers(next);
          setError("");
        }
      })
      .catch((e: unknown) => {
        if (!controller.signal.aborted)
          setError(e instanceof Error ? e.message : "Unable to load users.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [revision, admin]);
  if (!admin)
    return <p>Administrator access is required to manage CoreOps users.</p>;
  return (
    <section className="admin-panel" aria-label="CoreOps users">
      <div className="admin-panel-heading">
        <h3>
          <Users size={18} /> CoreOps users
        </h3>
        <button type="button" onClick={() => setOpened(true)}>
          <Plus size={16} /> Create user
        </button>
        <button
          type="button"
          disabled={loading}
          aria-label="Refresh users"
          onClick={() => setRevision((v) => v + 1)}
        >
          <RefreshCw size={16} />
        </button>
      </div>
      <p>
        Accounts for CoreOps access. These do not create Linux system users.
      </p>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {loading ? (
        <p role="status">Loading users…</p>
      ) : (
        <ul className="admin-users">
          {users.map((user) => (
            <li key={user.name}>
              <strong>{user.name}</strong>
              <span>{user.role}</span>
            </li>
          ))}
        </ul>
      )}
      {opened && (
        <CreateUserDialog
          onClose={() => setOpened(false)}
          onCreated={(user) => {
            setNotice(`Created ${user.name} (${user.role}).`);
            setOpened(false);
            setRevision((v) => v + 1);
          }}
        />
      )}
    </section>
  );
}
function CreateUserDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (user: AuthUser) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [role, setRole] = useState<Role>("viewer");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const lock = useRef(false);
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
      aria-labelledby="create-user-title"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (lock.current) return;
          if (password !== confirm) {
            setError("Passwords do not match.");
            return;
          }
          lock.current = true;
          setBusy(true);
          setError("");
          void createUser(name, password, role)
            .then((user) => {
              setPassword("");
              setConfirm("");
              onCreated(user);
            })
            .catch((cause: unknown) => {
              setError(
                cause instanceof Error
                  ? cause.message
                  : "User creation failed. Refresh the list before retrying.",
              );
              setPassword("");
              setConfirm("");
            })
            .finally(() => {
              lock.current = false;
              setBusy(false);
            });
        }}
      >
        <header>
          <h2 id="create-user-title">Create user</h2>
          <button
            type="button"
            disabled={busy}
            aria-label="Close create user"
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </header>
        <label>
          Username
          <input
            name="username"
            required
            maxLength={32}
            pattern="[A-Za-z0-9._\-]+"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label>
          Password
          <input
            name="password"
            type="password"
            required
            minLength={10}
            maxLength={1024}
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <label>
          Confirm password
          <input
            name="confirm-password"
            type="password"
            required
            minLength={10}
            maxLength={1024}
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </label>
        <label>
          Role
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as Role)}
          >
            <option value="viewer">Viewer — read only</option>
            <option value="operator">Operator — operate infrastructure</option>
            <option value="admin">Admin — full administration</option>
          </select>
        </label>
        <p>
          Use at least 10 characters. Admin accounts can manage users and
          privileged host operations.
        </p>
        {error && <p role="alert">{error}</p>}
        <footer>
          <button type="button" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" disabled={busy}>
            {busy ? "Creating…" : "Create user"}
          </button>
        </footer>
      </form>
    </dialog>
  );
}
