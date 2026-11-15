import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  RefreshCw,
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Router,
  Server,
} from "lucide-react";
import { T } from "../lib/tokens";
import { getNetwork } from "../lib/api";
import type { NetworkOverview } from "../lib/types";
import { Card, Btn, Th, Td } from "../components/ui";

function bytes(value: number) {
  if (!value) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(
    Math.floor(Math.log(value) / Math.log(1024)),
    units.length - 1,
  );
  return `${(value / 1024 ** i).toFixed(i > 1 ? 1 : 0)} ${units[i]}`;
}

function TopoNode({
  label,
  sub,
  color = T.border,
  icon,
}: {
  label: string;
  sub?: string;
  color?: string;
  icon?: ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 5,
      }}
    >
      <div
        data-surface="panel"
        style={{
          padding: "9px 16px",
          background: T.raised,
          border: `1px solid ${color}`,
          borderRadius: 8,
          textAlign: "center",
          minWidth: 135,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
            fontSize: 12,
            fontWeight: 600,
            color: T.text,
          }}
        >
          {icon}
          {label}
        </div>
        {sub && (
          <div
            style={{
              fontSize: 10,
              color: T.textDim,
              fontFamily: "JetBrains Mono,monospace",
              marginTop: 3,
            }}
          >
            {sub}
          </div>
        )}
      </div>
    </div>
  );
}
function Arrow() {
  return (
    <div
      style={{
        width: 1,
        height: 18,
        background: T.borderStrong,
        margin: "0 auto",
      }}
    />
  );
}

export default function NetworkView() {
  const [data, setData] = useState<NetworkOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (refresh = false) => {
    if (refresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      setData(await getNetwork());
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to load network information",
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

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
            Network
          </h1>
          <p style={{ fontSize: 12, color: T.textDim, marginTop: 2 }}>
            Interfaces, open ports, and network topology from the server.
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

      <div
        data-layout="sidebar"
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0,1fr) 260px",
          gap: 14,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <Card>
            <CardHeader title="Network interfaces" />
            <div style={{ overflowX: "auto" }}>
              <table
                style={{
                  width: "100%",
                  borderCollapse: "collapse",
                  minWidth: 760,
                }}
              >
                <thead>
                  <tr style={{ background: T.bg }}>
                    <Th>Interface</Th>
                    <Th mono>IP address</Th>
                    <Th mono>MAC</Th>
                    <Th>State</Th>
                    <Th>Speed</Th>
                    <Th mono right>
                      <span
                        style={{
                          display: "inline-flex",
                          gap: 4,
                          alignItems: "center",
                        }}
                      >
                        RX <ArrowDown size={10} />
                      </span>
                    </Th>
                    <Th mono right>
                      <span
                        style={{
                          display: "inline-flex",
                          gap: 4,
                          alignItems: "center",
                        }}
                      >
                        TX <ArrowUp size={10} />
                      </span>
                    </Th>
                  </tr>
                </thead>
                <tbody>
                  {loading && !data
                    ? Array.from({ length: 3 }).map((_, i) => (
                        <tr key={i}>
                          <Td>
                            <span className="skeleton" />
                          </Td>
                          <Td mono>
                            <span className="skeleton" />
                          </Td>
                          <Td mono>
                            <span className="skeleton" />
                          </Td>
                          <Td>
                            <span className="skeleton" />
                          </Td>
                          <Td>
                            <span className="skeleton" />
                          </Td>
                          <Td mono right>
                            <span className="skeleton" />
                          </Td>
                          <Td mono right>
                            <span className="skeleton" />
                          </Td>
                        </tr>
                      ))
                    : data?.interfaces.map((iface) => (
                        <tr
                          key={iface.name}
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
                                fontWeight: 700,
                                color: T.text,
                                fontSize: 12,
                              }}
                            >
                              {iface.name}
                            </span>
                          </Td>
                          <Td mono dim>
                            {iface.ip}
                          </Td>
                          <Td mono dim>
                            {iface.mac || "—"}
                          </Td>
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
                                  background:
                                    iface.state === "UP" ? T.green : T.textDim,
                                }}
                              />
                              <span
                                style={{
                                  fontSize: 11,
                                  fontWeight: 600,
                                  color:
                                    iface.state === "UP" ? T.green : T.textDim,
                                }}
                              >
                                {iface.state}
                              </span>
                            </span>
                          </Td>
                          <Td dim>{iface.speed}</Td>
                          <Td mono dim right>
                            {bytes(iface.rxBytes)}
                          </Td>
                          <Td mono dim right>
                            {bytes(iface.txBytes)}
                          </Td>
                        </tr>
                      ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card>
            <CardHeader title="Listening ports" />
            <div style={{ overflowX: "auto" }}>
              <table
                style={{
                  width: "100%",
                  borderCollapse: "collapse",
                  minWidth: 650,
                }}
              >
                <thead>
                  <tr style={{ background: T.bg }}>
                    <Th mono>Port</Th>
                    <Th>Proto</Th>
                    <Th>Process</Th>
                    <Th>Container</Th>
                    <Th mono>Address</Th>
                    <Th>State</Th>
                  </tr>
                </thead>
                <tbody>
                  {loading && !data
                    ? Array.from({ length: 5 }).map((_, i) => (
                        <tr key={i}>
                          <Td mono>
                            <span className="skeleton" />
                          </Td>
                          <Td>
                            <span className="skeleton" />
                          </Td>
                          <Td>
                            <span className="skeleton" />
                          </Td>
                          <Td>
                            <span className="skeleton" />
                          </Td>
                          <Td mono>
                            <span className="skeleton" />
                          </Td>
                          <Td>
                            <span className="skeleton" />
                          </Td>
                        </tr>
                      ))
                    : data?.ports.map((p, i) => (
                        <tr key={`${p.proto}-${p.port}-${i}`}>
                          <Td mono>
                            <span style={{ fontWeight: 700, color: T.accent }}>
                              {p.port}
                            </span>
                          </Td>
                          <Td dim>{p.proto}</Td>
                          <Td dim>{p.process}</Td>
                          <Td dim>{p.container}</Td>
                          <Td mono dim>
                            {p.address}
                          </Td>
                          <Td>
                            <span
                              style={{
                                fontSize: 11,
                                fontWeight: 600,
                                color: T.green,
                              }}
                            >
                              {p.state}
                            </span>
                          </Td>
                        </tr>
                      ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>

        <Card>
          <CardHeader title="Topology" />
          <div
            style={{
              padding: "20px 16px",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
            }}
          >
            {loading && !data ? (
              <>
                <TopoNode
                  label="Server"
                  sub="Loading…"
                  icon={<Server size={13} />}
                />
                <Arrow />
                <TopoNode
                  label="Network"
                  sub="Loading…"
                  icon={<Router size={13} />}
                />
              </>
            ) : (
              data && (
                <>
                  <TopoNode
                    label="Internet / Gateway"
                    sub={data.topology.gateway}
                    icon={<Router size={13} />}
                    color={T.borderStrong}
                  />
                  <Arrow />
                  <TopoNode
                    label="Server"
                    sub={data.topology.host}
                    icon={<Server size={13} />}
                    color={T.accent}
                  />
                  <Arrow />
                  <div
                    style={{
                      width: "100%",
                      border: `1px solid ${T.border}`,
                      borderRadius: 8,
                      padding: "10px 12px",
                      background: T.bg,
                    }}
                  >
                    <div
                      style={{
                        fontSize: 10,
                        fontWeight: 700,
                        color: T.textDim,
                        textTransform: "uppercase",
                        letterSpacing: "0.08em",
                        marginBottom: 8,
                      }}
                    >
                      Docker bridge · {data.topology.dockerBridge}
                    </div>
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 5,
                      }}
                    >
                      {data.topology.containers.length ? (
                        data.topology.containers.map((c) => (
                          <div
                            data-surface="panel"
                            key={`${c.name}-${c.ip}`}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 6,
                              padding: "5px 8px",
                              background: T.raised,
                              borderRadius: 5,
                              border: `1px solid ${T.border}`,
                            }}
                          >
                            <span
                              style={{
                                width: 5,
                                height: 5,
                                borderRadius: "50%",
                                background: T.green,
                                flexShrink: 0,
                              }}
                            />
                            <span
                              style={{
                                fontSize: 11,
                                color: T.textSub,
                                fontFamily: "JetBrains Mono,monospace",
                              }}
                            >
                              {c.name || "container"} · {c.ip}
                            </span>
                          </div>
                        ))
                      ) : (
                        <div style={{ fontSize: 11, color: T.textDim }}>
                          No running containers on a Docker network.
                        </div>
                      )}
                    </div>
                  </div>
                </>
              )
            )}
          </div>
        </Card>
      </div>
      <style>{`.skeleton{display:block;width:75px;height:12px;background:${T.overlay};border-radius:4px;animation:pulse 1.5s ease-in-out infinite}.spin{animation:spin 800ms linear infinite}@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}

function CardHeader({ title }: { title: string }) {
  return (
    <div
      style={{ padding: "12px 14px", borderBottom: `1px solid ${T.border}` }}
    >
      <span
        style={{
          fontSize: 11,
          fontWeight: 700,
          color: T.textDim,
          textTransform: "uppercase",
          letterSpacing: "0.07em",
        }}
      >
        {title}
      </span>
    </div>
  );
}
