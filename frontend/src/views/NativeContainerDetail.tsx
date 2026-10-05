import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Box,
  Check,
  ChevronRight,
  CircleStop,
  Copy,
  Network,
  Play,
  RefreshCw,
  RotateCw,
  Server,
  Terminal,
} from "lucide-react";
import { T } from "../lib/tokens";
import { getContainerDetail, runContainerAction } from "../lib/api";
import type { ContainerDetailData, ContainerAction, ConfirmDialog } from "../lib/types";
import { Card, CardHeader, StatusBadge, Btn, HealthBadge } from "../components/ui";

type Tab = "Overview" | "Network" | "Mounts" | "Environment" | "Inspect";

export default function NativeContainerDetail({
  containerId,
  onBack,
  addToast,
  onConfirm,
}: {
  containerId: string;
  onBack: () => void;
  addToast: (m: string, t: any) => void;
  onConfirm: (d: ConfirmDialog) => void;
}) {
  const [container, setContainer] = useState<ContainerDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("Overview");
  const [pending, setPending] = useState<ContainerAction | null>(null);
  const [copied, setCopied] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      setContainer(await getContainerDetail(containerId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load container");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [containerId]);

  const state = container?.state?.toLowerCase() || "unknown";
  const status =
    state === "running" ? "running" :
    state === "paused" ? "paused" :
    state === "restarting" ? "restarting" : "stopped";

  const inspect = useMemo(
    () => (container ? JSON.stringify(container, null, 2) : ""),
    [container],
  );

  const action = async (next: ContainerAction) => {
    if (!container || pending) return;
    setPending(next);
    try {
      await runContainerAction(container.id, next);
      await load();
      addToast(
        next === "start"
          ? `${container.name} started`
          : next === "stop"
            ? `${container.name} stopped`
            : `${container.name} restarted`,
        "success",
      );
    } catch (err) {
      addToast(
        err instanceof Error ? err.message : `Unable to ${next} container`,
        "error",
      );
    } finally {
      setPending(null);
    }
  };

  const copyInspect = async () => {
    try {
      await navigator.clipboard.writeText(inspect);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      addToast("Unable to copy inspect JSON", "error");
    }
  };

  if (loading) {
    return (
      <div className="native-container-detail">
        <div className="native-container-detail-loading">Loading container…</div>
      </div>
    );
  }

  if (error || !container) {
    return (
      <div className="native-container-detail">
        <button className="native-container-back" onClick={onBack}>
          <ArrowLeft size={16} /> Containers
        </button>
        <Card>
          <div className="native-container-error">
            <Box size={22} />
            <strong>Unable to load container</strong>
            <span>{error || "Container not found"}</span>
            <Btn onClick={() => void load()} icon={<RefreshCw size={11} />}>
              Retry
            </Btn>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="native-container-detail">
      <button className="native-container-back" onClick={onBack}>
        <ArrowLeft size={16} />
        <span>Containers</span>
        <ChevronRight size={12} />
        <strong>{container.name}</strong>
      </button>

      <div className="native-container-detail-header">
        <div className="native-container-detail-title">
          <div className="native-container-detail-icon">
            <Box size={20} />
          </div>
          <div>
            <div className="native-container-name-row">
              <h1>{container.name}</h1>
              <StatusBadge status={status as any} />
            </div>
            <p>{container.image}</p>
            <code>{container.id.slice(0, 12)}</code>
          </div>
        </div>

        <div className="native-container-actions">
          {status !== "running" && (
            <Btn
              variant="primary"
              icon={<Play size={11} />}
              disabled={!!pending}
              onClick={() => void action("start")}
            >
              Start
            </Btn>
          )}
          {status === "running" && (
            <Btn
              variant="danger"
              icon={<CircleStop size={11} />}
              disabled={!!pending}
              onClick={() =>
                onConfirm({
                  title: `Stop "${container.name}"?`,
                  message: "The container will be stopped.",
                  action: "Stop container",
                  danger: true,
                  onConfirm: () => void action("stop"),
                })
              }
            >
              Stop
            </Btn>
          )}
          <Btn
            variant="warning"
            icon={<RotateCw size={11} />}
            disabled={!!pending}
            onClick={() => void action("restart")}
          >
            Restart
          </Btn>
          <Btn
            variant="secondary"
            icon={<Terminal size={11} />}
            onClick={() => addToast(`Terminal for ${container.name} — coming next`, "info")}
          >
            Terminal
          </Btn>
        </div>
      </div>

      <div className="native-container-tabs">
        {(["Overview", "Network", "Mounts", "Environment", "Inspect"] as Tab[]).map((item) => (
          <button
            key={item}
            className={tab === item ? "active" : ""}
            onClick={() => setTab(item)}
          >
            {item}
          </button>
        ))}
      </div>

      {tab === "Overview" && (
        <div className="native-container-grid">
          <Card>
            <CardHeader title="Container information" />
            <div className="native-detail-list">
              {[
                ["ID", container.id],
                ["Image", container.image],
                ["State", container.state],
                ["Created", new Date(container.created).toLocaleString()],
                ["Working directory", container.config.workingDir || "—"],
                ["Restart policy", container.restartPolicy || "—"],
              ].map(([label, value]) => (
                <div className="native-detail-row" key={label}>
                  <span>{label}</span>
                  <strong>{value}</strong>
                </div>
              ))}
            </div>
          </Card>

          <Card>
            <CardHeader title="Runtime" />
            <div className="native-runtime-grid">
              <div><Server size={16} /><span>State</span><strong>{container.state}</strong></div>
              <div><Network size={16} /><span>Networks</span><strong>{Object.keys(container.networks).length}</strong></div>
              <div><Box size={16} /><span>Mounts</span><strong>{container.mounts.length}</strong></div>
              <div><Terminal size={16} /><span>Command</span><strong>{container.config.cmd.join(" ") || "—"}</strong></div>
            </div>
          </Card>

          <Card>
            <CardHeader title="Command" />
            <div className="native-code-block">
              <div><span>ENTRYPOINT</span>{container.config.entrypoint.join(" ") || "—"}</div>
              <div><span>CMD</span>{container.config.cmd.join(" ") || "—"}</div>
            </div>
          </Card>

          <Card>
            <CardHeader title="Labels" />
            <div className="native-detail-list">
              {Object.entries(container.labels).length === 0 ? (
                <div className="native-empty-detail">No labels</div>
              ) : Object.entries(container.labels).map(([key, value]) => (
                <div className="native-detail-row" key={key}>
                  <span>{key}</span><strong>{value}</strong>
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}

      {tab === "Network" && (
        <Card>
          <CardHeader title="Network interfaces" />
          <div className="native-network-list">
            {Object.entries(container.networks).map(([name, network]) => (
              <div className="native-network-card" key={name}>
                <div className="native-network-card-title">
                  <Network size={15} />
                  <strong>{name}</strong>
                </div>
                <div><span>IP address</span><code>{network.IPAddress || "—"}</code></div>
                <div><span>MAC address</span><code>{network.MacAddress || "—"}</code></div>
                <div><span>Gateway</span><code>{network.Gateway || "—"}</code></div>
              </div>
            ))}
          </div>
          <div className="native-ports">
            <h3>Published ports</h3>
            {Object.entries(container.ports).length === 0 ? (
              <p>No published ports.</p>
            ) : Object.entries(container.ports).map(([port, bindings]) => (
              <div key={port}>
                <code>{port}</code>
                <span>→</span>
                <code>{bindings?.map((b) => `${b.HostIp || "0.0.0.0"}:${b.HostPort || "—"}`).join(", ") || "—"}</code>
              </div>
            ))}
          </div>
        </Card>
      )}

      {tab === "Mounts" && (
        <Card>
          <CardHeader title={`Mounts · ${container.mounts.length}`} />
          <div className="native-mount-list">
            {container.mounts.length === 0 ? (
              <div className="native-empty-detail">No mounts configured.</div>
            ) : container.mounts.map((mount, index) => (
              <div className="native-mount-card" key={`${mount.Destination}-${index}`}>
                <div className="native-mount-type">{mount.Type}</div>
                <div className="native-mount-path"><span>{mount.Source}</span><b>→</b><span>{mount.Destination}</span></div>
                <div className="native-mount-meta">
                  <span>{mount.RW ? "read/write" : "read-only"}</span>
                  <code>{mount.Mode || "default"}</code>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {tab === "Environment" && (
        <Card>
          <CardHeader title={`Environment · ${container.config.env.length}`} />
          <div className="native-env-list">
            {container.config.env.length === 0 ? (
              <div className="native-empty-detail">No environment variables.</div>
            ) : container.config.env.map((value, index) => {
              const split = value.indexOf("=");
              const key = split >= 0 ? value.slice(0, split) : value;
              const val = split >= 0 ? value.slice(split + 1) : "";
              return (
                <div className="native-env-row" key={`${key}-${index}`}>
                  <code>{key}</code><span>{val || "—"}</span>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {tab === "Inspect" && (
        <Card>
          <div className="native-inspect-header">
            <CardHeader title="Docker inspect" />
            <Btn variant="ghost" size="xs" icon={copied ? <Check size={11} /> : <Copy size={11} />} onClick={() => void copyInspect()}>
              {copied ? "Copied" : "Copy JSON"}
            </Btn>
          </div>
          <pre className="native-inspect">{inspect}</pre>
        </Card>
      )}
    </div>
  );
}
