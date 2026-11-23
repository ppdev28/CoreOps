import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw, Network, ExternalLink, X, Search } from "lucide-react";
import { getSession } from "../lib/auth";
import {
  changeTailscale,
  getTailscale,
  tailscaleRequest,
  type TailscaleChanges,
  type TailscalePreferences,
  type TailscaleRequest,
  type TailscaleSnapshot,
} from "../lib/tailscale";
import "../styles/tailscale.css";

type Draft = Pick<
  TailscalePreferences,
  "hostname" | "acceptDNS" | "acceptRoutes" | "ssh" | "shieldsUp"
>;
const labels: Record<keyof Draft, string> = {
  hostname: "Device hostname",
  acceptDNS: "Use Tailscale DNS",
  acceptRoutes: "Accept subnet routes",
  ssh: "Tailscale SSH",
  shieldsUp: "Block incoming connections",
};
const hints: Record<Exclude<keyof Draft, "hostname">, string> = {
  acceptDNS:
    "Accept DNS settings supplied by the tailnet. Changes can affect name resolution.",
  acceptRoutes:
    "Use routes advertised by other tailnet devices. Existing routes can change.",
  ssh: "Allow Tailscale SSH according to tailnet policy. Disabling this can close Tailscale SSH access.",
  shieldsUp:
    "Reject incoming tailnet connections. Enabling this can interrupt remote access.",
};
const draftOf = (p: TailscalePreferences): Draft => ({
  hostname: p.hostname,
  acceptDNS: p.acceptDNS,
  acceptRoutes: p.acceptRoutes,
  ssh: p.ssh,
  shieldsUp: p.shieldsUp,
});
const actionTitles = {
  connect: "Connect Tailscale",
  disconnect: "Disconnect Tailscale",
  configure: "Apply Tailscale preferences",
  login: "Prepare Tailscale sign-in",
};
const peerStatus = (online: boolean | null) =>
  online === null ? "Unknown" : online ? "Online" : "Offline";
function displayTime(raw?: string) {
  if (!raw) return "Not reported";
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? "Not reported" : date.toLocaleString();
}

export default function TailscaleSettings() {
  const admin = getSession()?.user.role === "admin";
  const [data, setData] = useState<TailscaleSnapshot | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [form, setForm] = useState<Draft | null>(null),
    [baseline, setBaseline] = useState<Draft | null>(null),
    [baseRevision, setBaseRevision] = useState("");
  const [pending, setPending] = useState<TailscaleRequest | null>(null),
    [busy, setBusy] = useState(false),
    [actionError, setActionError] = useState("");
  const [search, setSearch] = useState(""),
    [filter, setFilter] = useState("all"),
    [shown, setShown] = useState(20);
  const reader = useRef<AbortController | null>(null),
    writer = useRef<AbortController | null>(null),
    lock = useRef(false);
  const load = useCallback(async () => {
    reader.current?.abort();
    const controller = new AbortController();
    reader.current = controller;
    setLoading(true);
    try {
      const next = await getTailscale(controller.signal);
      if (controller.signal.aborted) return null;
      setData(next);
      setError("");
      return next;
    } catch (cause) {
      if (!controller.signal.aborted)
        setError(
          cause instanceof Error
            ? cause.message
            : "Unable to read Tailscale. Previous data may be stale.",
        );
      return null;
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, []);
  useEffect(() => {
    if (admin) void load();
    return () => {
      reader.current?.abort();
      writer.current?.abort();
    };
  }, [admin, load]);
  const dirty = !!form && JSON.stringify(form) !== JSON.stringify(baseline);
  useEffect(() => {
    if (data?.preferences && (!dirty || !form)) {
      const next = draftOf(data.preferences);
      setForm(next);
      setBaseline(next);
      setBaseRevision(data.revision);
    }
  }, [data]);
  const staleDraft = dirty && !!data && baseRevision !== data.revision;
  const allowed =
    !!data?.available &&
    !!data.permission.available &&
    !loading &&
    !error &&
    !busy;
  const reloadDraft = () => {
    if (!data?.preferences) return;
    const next = draftOf(data.preferences);
    setForm(next);
    setBaseline(next);
    setBaseRevision(data.revision);
  };
  const changes: TailscaleChanges = {};
  if (form && baseline) {
    for (const key of Object.keys(labels) as (keyof Draft)[]) {
      if (form[key] !== baseline[key] && form[key] !== null) {
        if (key === "hostname") changes.hostname = form.hostname!;
        else changes[key] = form[key] as boolean;
      }
    }
  }
  const openAction = (action: TailscaleRequest["action"]) => {
    if (!data || !allowed) return;
    setActionError("");
    setPending(
      tailscaleRequest(data, action, action === "configure" ? changes : {}),
    );
  };
  const submit = async () => {
    if (!pending || lock.current) return;
    lock.current = true;
    setBusy(true);
    setActionError("");
    setNotice("");
    const controller = new AbortController();
    writer.current = controller;
    try {
      const result = await changeTailscale(pending, controller.signal);
      if (controller.signal.aborted) return;
      if (
        !result.accepted ||
        result.requestId !== pending.requestId ||
        result.action !== pending.action
      )
        throw new Error(
          "The host did not confirm this request. Refresh status before trying again.",
        );
      const accepted = pending;
      setPending(null);
      setForm(null);
      setBaseline(null);
      setNotice(
        "Request accepted. Check the current daemon state below; acceptance does not prove the network has finished changing.",
      );
      const fresh = await load();
      if (accepted.action === "configure" && fresh?.preferences) {
        const verified = Object.entries(accepted.changes).every(
          ([key, value]) =>
            fresh.preferences![key as keyof TailscalePreferences] === value,
        );
        if (verified) setNotice("Tailscale preferences verified on the host.");
      }
    } catch (cause) {
      if (!controller.signal.aborted)
        setActionError(
          cause instanceof Error
            ? cause.message
            : "Request outcome is uncertain. Check host access and refresh status before another request.",
        );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  if (!admin)
    return <p>Administrator access is required to manage Tailscale.</p>;
  const peers = (data?.peers || []).filter((peer) => {
    const status = peerStatus(peer.online).toLowerCase();
    if (filter !== "all" && status !== filter) return false;
    const text = [peer.name, peer.dnsName, peer.os, ...peer.ips]
      .join(" ")
      .toLowerCase();
    return search
      .toLowerCase()
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .every((term) => text.includes(term));
  });
  return (
    <section
      className="tailscale-settings"
      aria-label="Tailscale management"
      aria-busy={loading}
    >
      <header className="tailscale-heading">
        <div>
          <Network size={21} />
          <div>
            <h3>Tailscale on this server</h3>
            <p>
              Device connection, local preferences and visible tailnet peers.
            </p>
          </div>
        </div>
        <button
          type="button"
          disabled={loading || busy}
          onClick={() => void load()}
        >
          <RefreshCw size={15} />
          {loading ? "Refreshing…" : "Refresh Tailscale"}
        </button>
      </header>
      {error && (
        <p className="tailscale-alert" role="alert">
          {error}{" "}
          {data
            ? "The previous snapshot may be stale. Changes are disabled until a successful refresh."
            : ""}
        </p>
      )}
      {notice && (
        <p className="tailscale-notice" role="status">
          {notice}
        </p>
      )}
      {loading && !data ? (
        <p role="status">Reading local tailscaled…</p>
      ) : !data ? null : !data.available ? (
        <div className="tailscale-panel">
          <h4>Tailscale unavailable</h4>
          <p>{data.detail || "The local daemon could not be read."}</p>
          <p>
            Install/start Tailscale on the host and check access for the CoreOps
            service account.
          </p>
          <a
            href="https://tailscale.com/download/linux"
            target="_blank"
            rel="noopener noreferrer"
          >
            Tailscale installation instructions <ExternalLink size={13} />
          </a>
        </div>
      ) : (
        <>
          <div className="tailscale-panel">
            <div className="tailscale-state">
              <strong>{data.state}</strong>
              <span data-online={data.online === true}>
                {peerStatus(data.online)}
              </span>
              {data.version && <small>Version {data.version}</small>}
            </div>
            <dl className="tailscale-device">
              <div>
                <dt>Host</dt>
                <dd>{data.hostname || "Not reported"}</dd>
              </div>
              <div>
                <dt>Tailnet</dt>
                <dd>{data.tailnet || "Not reported"}</dd>
              </div>
              <div>
                <dt>MagicDNS name</dt>
                <dd>
                  <code>{data.dnsName || "Not reported"}</code>
                </dd>
              </div>
              <div>
                <dt>Tailscale IPs</dt>
                <dd>
                  {data.ips.length
                    ? data.ips.map((ip) => <code key={ip}>{ip}</code>)
                    : "Not reported"}
                </dd>
              </div>
              <div>
                <dt>Exit node</dt>
                <dd>{data.preferences?.exitNode || "Not reported / none"}</dd>
              </div>
              <div>
                <dt>Advertised routes</dt>
                <dd>
                  {data.preferences?.advertiseRoutes.length
                    ? data.preferences.advertiseRoutes.map((route) => (
                        <code key={route}>{route}</code>
                      ))
                    : "No routes reported"}
                </dd>
              </div>
            </dl>
            {data.detail && (
              <p className="tailscale-alert" role="status">
                {data.detail}
              </p>
            )}
            {data.health.length > 0 && (
              <div className="tailscale-health">
                <h4>Daemon warnings</h4>
                <ul>
                  {data.health.map((warning, i) => (
                    <li key={i}>{warning}</li>
                  ))}
                </ul>
              </div>
            )}
            {!data.permission.available && (
              <div className="tailscale-permission" role="status">
                <strong>Management needs host permission</strong>
                <p>{data.permission.reason}</p>
                <p>
                  A host administrator can install{" "}
                  <code>deploy/install-tailscale-helper.sh</code> for the API
                  service account. Installation does not change the connection.
                </p>
              </div>
            )}
            <div className="tailscale-actions">
              {data.state === "Stopped" && (
                <button
                  type="button"
                  disabled={
                    !allowed ||
                    !data.nodeId ||
                    data.preferences?.wantRunning !== false
                  }
                  onClick={() => openAction("connect")}
                >
                  Connect Tailscale
                </button>
              )}
              {(data.state === "Running" || data.state === "Starting") && (
                <button
                  type="button"
                  className="tailscale-danger"
                  disabled={!allowed || data.preferences?.wantRunning !== true}
                  onClick={() => openAction("disconnect")}
                >
                  Disconnect Tailscale
                </button>
              )}
              {data.state === "NeedsLogin" && (
                <button
                  type="button"
                  disabled={!allowed}
                  onClick={() => openAction("login")}
                >
                  Prepare sign-in
                </button>
              )}
              {data.state === "NeedsMachineAuth" && (
                <p>
                  Device approval is required in the tailnet administration
                  console.
                </p>
              )}
              {data.signInUrl && !error && !loading && (
                <a
                  className="tailscale-link-button"
                  href={data.signInUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Open Tailscale sign-in <ExternalLink size={13} />
                </a>
              )}
              {data.adminUrl && (
                <a
                  href={data.adminUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Tailnet administration <ExternalLink size={13} />
                </a>
              )}
            </div>
            <p className="tailscale-caption">
              Disconnect keeps this device identity, but can interrupt CoreOps,
              Tailscale SSH and other remote sessions. Tailnet policies and
              device approvals remain in Tailscale.
            </p>
          </div>
          <div className="tailscale-panel">
            <h4>Local preferences</h4>
            <p>
              Only changed fields are sent. Existing exit nodes, route
              advertisements and other settings are preserved.
            </p>
            {form && data.preferences ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  openAction("configure");
                }}
              >
                <label className="tailscale-hostname-label">
                  Device hostname
                  <input
                    aria-label="Tailscale device hostname"
                    value={form.hostname ?? ""}
                    maxLength={63}
                    placeholder={data.hostname}
                    pattern={"[A-Za-z0-9]([A-Za-z0-9\\-]{0,61}[A-Za-z0-9])?"}
                    disabled={!allowed || form.hostname === null || staleDraft}
                    autoCapitalize="off"
                    autoComplete="off"
                    spellCheck={false}
                    onChange={(e) =>
                      setForm({ ...form, hostname: e.target.value })
                    }
                  />
                  <small>
                    Use a DNS label with letters, digits and hyphens (up to 63
                    characters). Leave empty to use the operating system
                    hostname.
                  </small>
                </label>
                {(
                  ["acceptDNS", "acceptRoutes", "ssh", "shieldsUp"] as const
                ).map((key) => (
                  <label className="tailscale-preference" key={key}>
                    <span>
                      <strong>{labels[key]}</strong>
                      <small>
                        {hints[key]}
                        {form[key] === null
                          ? " This preference is unavailable."
                          : ""}
                      </small>
                    </span>
                    <input
                      type="checkbox"
                      role="switch"
                      aria-label={labels[key]}
                      checked={form[key] === true}
                      disabled={!allowed || form[key] === null || staleDraft}
                      onChange={(e) =>
                        setForm({ ...form, [key]: e.target.checked })
                      }
                    />
                  </label>
                ))}
                {staleDraft && (
                  <p className="tailscale-alert" role="alert">
                    The host changed while you were editing. Reload preferences
                    before applying changes.
                  </p>
                )}
                <footer className="tailscale-actions">
                  <button
                    type="button"
                    disabled={busy || loading || !data.preferences}
                    onClick={reloadDraft}
                  >
                    Reload preferences
                  </button>
                  <button
                    type="submit"
                    disabled={
                      !allowed ||
                      !dirty ||
                      staleDraft ||
                      Object.keys(changes).length === 0 ||
                      !(data.state === "Running" || data.state === "Stopped")
                    }
                  >
                    Review changes
                  </button>
                </footer>
              </form>
            ) : (
              <p>Preferences unavailable.</p>
            )}
          </div>
          <div className="tailscale-panel tailscale-peer-panel">
            <h4>
              Visible devices <span>{data.peerCount}</span>
            </h4>
            <p>
              Devices visible to this node under the tailnet policy. This is not
              a list of every device registered in the account.
            </p>
            <div className="tailscale-peer-filters">
              <label>
                Search devices
                <span>
                  <Search size={14} />
                  <input
                    aria-label="Search Tailscale devices"
                    placeholder="Name, IP or operating system…"
                    value={search}
                    onChange={(e) => {
                      setSearch(e.target.value);
                      setShown(20);
                    }}
                  />
                </span>
              </label>
              <label>
                Device state
                <select
                  aria-label="Tailscale device state"
                  value={filter}
                  onChange={(e) => {
                    setFilter(e.target.value);
                    setShown(20);
                  }}
                >
                  <option value="all">All states</option>
                  <option value="online">Online</option>
                  <option value="offline">Offline</option>
                  <option value="unknown">Unknown</option>
                </select>
              </label>
            </div>
            {data.peersTruncated && (
              <p role="status">
                The API limited this snapshot to {data.peers.length} devices.
                Narrower tailnet policy or host-side tools may be needed for a
                larger inventory.
              </p>
            )}
            <ul className="tailscale-peers" aria-label="Tailscale devices">
              {peers.slice(0, shown).map((peer, i) => (
                <li key={peer.id || `${peer.dnsName}-${i}`}>
                  <div className="tailscale-peer-heading">
                    <strong>
                      {peer.name || peer.dnsName || "Unnamed device"}
                    </strong>
                    <span data-online={peer.online === true}>
                      {peerStatus(peer.online)}
                    </span>
                  </div>
                  <p>{peer.dnsName || "DNS name not reported"}</p>
                  <div className="tailscale-peer-ips">
                    {peer.ips.map((ip) => (
                      <code key={ip}>{ip}</code>
                    ))}
                  </div>
                  <dl>
                    <div>
                      <dt>OS</dt>
                      <dd>{peer.os || "Not reported"}</dd>
                    </div>
                    <div>
                      <dt>Last seen</dt>
                      <dd>{displayTime(peer.lastSeen)}</dd>
                    </div>
                    {peer.exitNode && (
                      <div>
                        <dt>Routing</dt>
                        <dd>Current exit node</dd>
                      </div>
                    )}
                  </dl>
                </li>
              ))}
            </ul>
            {peers.length === 0 && (
              <p role="status">No visible devices match these filters.</p>
            )}
            <div className="tailscale-peer-summary">
              <span>
                {Math.min(shown, peers.length)} of {peers.length} matching
                devices
              </span>
              {shown < peers.length && (
                <button
                  type="button"
                  onClick={() => setShown((value) => value + 20)}
                >
                  Show more devices
                </button>
              )}
            </div>
          </div>
        </>
      )}
      {pending && (
        <TailscaleConfirmation
          request={pending}
          busy={busy}
          error={actionError}
          onClose={() => {
            if (!lock.current) {
              setPending(null);
              setActionError("");
            }
          }}
          onSubmit={() => void submit()}
        />
      )}
    </section>
  );
}
function TailscaleConfirmation({
  request,
  busy,
  error,
  onClose,
  onSubmit,
}: {
  request: TailscaleRequest;
  busy: boolean;
  error: string;
  onClose: () => void;
  onSubmit: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [confirm, setConfirm] = useState("");
  const [attempted, setAttempted] = useState(false);
  useEffect(() => {
    const element = dialog.current,
      opener = document.activeElement as HTMLElement | null;
    element?.showModal();
    return () => {
      element?.close();
      opener?.focus();
    };
  }, []);
  return (
    <dialog
      className="tailscale-confirmation"
      ref={dialog}
      aria-labelledby="tailscale-confirm-title"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (confirm !== request.hostname || attempted || busy) return;
          setAttempted(true);
          onSubmit();
        }}
      >
        <header>
          <h2 id="tailscale-confirm-title">{actionTitles[request.action]}?</h2>
          <button
            type="button"
            aria-label="Close Tailscale confirmation"
            disabled={busy}
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </header>
        <p>
          This changes Tailscale on <strong>{request.hostname}</strong>.
          Network, DNS or SSH changes can disconnect this page and remote
          sessions. Arrange another way to reach the host before continuing.
        </p>
        {request.action === "disconnect" && (
          <p>
            Device identity is retained. This is a disconnect, not a logout.
          </p>
        )}
        {request.action === "login" && (
          <p>
            This starts a sign-in flow on the host. Complete it using the
            sign-in link from a refreshed status. No auth key or password is
            entered in CoreOps.
          </p>
        )}
        {request.action === "configure" && (
          <ul>
            {Object.entries(request.changes).map(([key, value]) => (
              <li key={key}>
                <strong>{labels[key as keyof Draft]}:</strong>{" "}
                {typeof value === "boolean"
                  ? value
                    ? "Enabled"
                    : "Disabled"
                  : value || "Operating system default"}
              </li>
            ))}
          </ul>
        )}
        <label>
          Type the host name to confirm
          <input
            aria-label="Confirm Tailscale host name"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            disabled={busy || attempted}
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            required
          />
        </label>
        <code>{request.hostname}</code>
        {error && (
          <p role="alert">
            {error} No automatic retry was made. Close this review and refresh
            status.
          </p>
        )}
        <footer>
          <button type="button" disabled={busy} onClick={onClose}>
            {attempted ? "Close" : "Cancel"}
          </button>
          {!attempted && (
            <button
              type="submit"
              className="tailscale-danger"
              disabled={busy || confirm !== request.hostname}
            >
              Confirm Tailscale change
            </button>
          )}
          {busy && <span role="status">Submitting request…</span>}
        </footer>
      </form>
    </dialog>
  );
}
