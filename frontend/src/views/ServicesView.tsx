import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Layers,
  Play,
  Square,
  RotateCw,
  Search,
  RefreshCw,
  AlertTriangle,
} from "lucide-react";
import { T } from "../lib/tokens";
import { getServices, runServiceAction, type ServiceAction } from "../lib/api";
import type { ConfirmDialog, SystemService } from "../lib/types";
import {
  Card,
  Btn,
  Th,
  Td,
  EmptyState,
  Input,
  FilterToggle,
} from "../components/ui";

export default function ServicesView({
  addToast,
  onConfirm,
}: {
  addToast: (m: string, t: any) => void;
  onConfirm: (d: ConfirmDialog) => void;
}) {
  const [services, setServices] = useState<SystemService[]>([]);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<
    "all" | "active" | "inactive" | "failed"
  >("all");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);

  const load = useCallback(async (refresh = false) => {
    if (refresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      setServices(await getServices());
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Unable to load system services",
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const rows = useMemo(
    () =>
      services.filter(
        (s) =>
          (s.name.toLowerCase().includes(search.toLowerCase()) ||
            s.description.toLowerCase().includes(search.toLowerCase())) &&
          (filter === "all" || s.status === filter),
      ),
    [services, search, filter],
  );

  const counts = useMemo(
    () => ({
      active: services.filter((s) => s.status === "active").length,
      inactive: services.filter((s) => s.status === "inactive").length,
      failed: services.filter((s) => s.status === "failed").length,
    }),
    [services],
  );

  const action = (service: SystemService, operation: ServiceAction) => {
    const verb =
      operation === "start"
        ? "Started"
        : operation === "stop"
          ? "Stopped"
          : "Restarted";
    const execute = async () => {
      setPending(`${service.name}:${operation}`);
      try {
        await runServiceAction(service.name, operation);
        addToast(`${verb} ${service.name}`, "success");
        await load(true);
      } catch (err) {
        addToast(
          err instanceof Error
            ? err.message
            : `Failed to ${operation} ${service.name}`,
          "error",
        );
      } finally {
        setPending(null);
      }
    };
    if (operation === "stop") {
      onConfirm({
        title: `Stop ${service.name}?`,
        message: "This will stop the systemd unit on the server.",
        action: "Stop",
        danger: true,
        onConfirm: () => {
          void execute();
        },
      });
    } else void execute();
  };

  const statusColor = (s: string) =>
    s === "active" ? T.green : s === "failed" ? T.red : T.textDim;
  const busy = (name: string, op: ServiceAction) => pending === `${name}:${op}`;

  return (
    <div style={{ padding: "22px 24px" }}>
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 16,
          marginBottom: 18,
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
            Services
          </h1>
          <p style={{ fontSize: 12, color: T.textDim, marginTop: 2 }}>
            systemd units and background services running on this server.
          </p>
        </div>
        <Btn
          size="sm"
          variant="secondary"
          icon={<RefreshCw size={12} className={refreshing ? "spin" : ""} />}
          onClick={() => void load(true)}
          disabled={loading || refreshing}
        >
          Refresh
        </Btn>
      </div>

      <div
        style={{ display: "flex", gap: 10, marginBottom: 14, flexWrap: "wrap" }}
      >
        {[
          { label: "Active", value: counts.active, color: T.green },
          { label: "Inactive", value: counts.inactive, color: T.textDim },
          { label: "Failed", value: counts.failed, color: T.red },
        ].map((s) => (
          <div
            data-surface="panel"
            key={s.label}
            style={{
              padding: "8px 14px",
              background: T.raised,
              border: `1px solid ${T.border}`,
              borderRadius: 8,
              display: "flex",
              gap: 8,
              alignItems: "baseline",
            }}
          >
            <span
              style={{
                fontSize: 18,
                fontWeight: 700,
                color: s.color,
                fontFamily: "JetBrains Mono,monospace",
                lineHeight: 1,
              }}
            >
              {s.value}
            </span>
            <span
              style={{
                fontSize: 11,
                color: T.textDim,
                textTransform: "uppercase",
                letterSpacing: "0.05em",
              }}
            >
              {s.label}
            </span>
          </div>
        ))}
      </div>

      <div
        style={{
          display: "flex",
          gap: 8,
          marginBottom: 14,
          alignItems: "center",
          flexWrap: "wrap",
        }}
      >
        <Input
          value={search}
          onChange={setSearch}
          placeholder="Search services…"
          icon={<Search size={12} />}
          style={{ maxWidth: 260 }}
        />
        <FilterToggle
          options={[
            { label: "All", value: "all" },
            { label: "Active", value: "active" },
            { label: "Inactive", value: "inactive" },
            { label: "Failed", value: "failed" },
          ]}
          value={filter}
          onChange={setFilter}
        />
      </div>

      {error && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 9,
            padding: "10px 12px",
            marginBottom: 12,
            background: `${T.red}0d`,
            border: `1px solid ${T.red}35`,
            borderRadius: 8,
            color: T.red,
            fontSize: 12,
          }}
        >
          <AlertTriangle size={14} />
          <span style={{ flex: 1 }}>{error}</span>
          <Btn size="xs" variant="secondary" onClick={() => void load()}>
            Retry
          </Btn>
        </div>
      )}

      <Card>
        <div style={{ overflowX: "auto" }}>
          <table
            style={{ width: "100%", borderCollapse: "collapse", minWidth: 680 }}
          >
            <thead>
              <tr style={{ background: T.bg }}>
                <Th>Name</Th>
                <Th>Description</Th>
                <Th>Status</Th>
                <Th>Enabled</Th>
                <Th mono>CPU time</Th>
                <Th mono>Memory</Th>
                <Th>Uptime</Th>
                <Th></Th>
              </tr>
            </thead>
            <tbody>
              {loading &&
                !services.length &&
                Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i}>
                    <Td>
                      <span
                        className="skeleton"
                        style={{ width: 130, height: 12, display: "block" }}
                      />
                    </Td>
                    <Td>
                      <span
                        className="skeleton"
                        style={{ width: 180, height: 12, display: "block" }}
                      />
                    </Td>
                    <Td>
                      <span
                        className="skeleton"
                        style={{ width: 60, height: 12, display: "block" }}
                      />
                    </Td>
                    <Td>
                      <span
                        className="skeleton"
                        style={{ width: 55, height: 12, display: "block" }}
                      />
                    </Td>
                    <Td mono>
                      <span
                        className="skeleton"
                        style={{ width: 45, height: 12, display: "block" }}
                      />
                    </Td>
                    <Td mono>
                      <span
                        className="skeleton"
                        style={{ width: 55, height: 12, display: "block" }}
                      />
                    </Td>
                    <Td>
                      <span
                        className="skeleton"
                        style={{ width: 55, height: 12, display: "block" }}
                      />
                    </Td>
                    <Td />
                  </tr>
                ))}
              {!loading &&
                rows.map((s) => (
                  <tr
                    key={s.id}
                    onMouseEnter={(e) =>
                      (e.currentTarget.style.background = T.hover)
                    }
                    onMouseLeave={(e) =>
                      (e.currentTarget.style.background = "transparent")
                    }
                  >
                    <Td>
                      <span
                        style={{
                          fontFamily: "JetBrains Mono,monospace",
                          fontSize: 12,
                          fontWeight: 600,
                          color: T.text,
                        }}
                      >
                        {s.name}
                      </span>
                    </Td>
                    <Td dim>{s.description || "—"}</Td>
                    <Td>
                      <span
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 5,
                        }}
                      >
                        <span
                          style={{
                            width: 6,
                            height: 6,
                            borderRadius: "50%",
                            background: statusColor(s.status),
                          }}
                        />
                        <span
                          style={{
                            fontSize: 11,
                            fontWeight: 600,
                            color: statusColor(s.status),
                            textTransform: "capitalize",
                          }}
                        >
                          {s.status}
                        </span>
                      </span>
                    </Td>
                    <Td>
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 600,
                          color: s.enabled ? T.green : T.textDim,
                        }}
                      >
                        {s.enabled ? "Enabled" : "Disabled"}
                      </span>
                    </Td>
                    <Td mono dim>
                      {s.cpu}
                    </Td>
                    <Td mono dim>
                      {s.memory}
                    </Td>
                    <Td dim>{s.uptime}</Td>
                    <Td>
                      <div style={{ display: "flex", gap: 4 }}>
                        {s.status === "active" ? (
                          <Btn
                            size="xs"
                            variant="danger"
                            icon={<Square size={10} />}
                            disabled={pending !== null}
                            onClick={() => action(s, "stop")}
                          />
                        ) : (
                          <Btn
                            size="xs"
                            variant="secondary"
                            icon={<Play size={10} />}
                            disabled={pending !== null}
                            onClick={() => action(s, "start")}
                          />
                        )}
                        <Btn
                          size="xs"
                          variant="secondary"
                          icon={<RotateCw size={10} />}
                          disabled={pending !== null}
                          onClick={() => action(s, "restart")}
                        />
                      </div>
                    </Td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        {!loading && rows.length === 0 && (
          <EmptyState
            icon={<Layers size={28} />}
            title="No services found"
            sub="Adjust your search or filter criteria."
          />
        )}
      </Card>
      <style>{`.skeleton{background:${T.overlay};border-radius:4px;animation:pulse 1.5s ease-in-out infinite}.spin{animation:spin 800ms linear infinite}@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}
