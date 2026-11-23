import { Fragment, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Search } from "lucide-react";
import { Card, Th, Td } from "./ui";
import type { OpenPort } from "../lib/types";
import {
  protocol,
  portSource,
  bindType,
  portRanges,
  sourceNames,
} from "../lib/networkPorts";
import "../styles/network-ports.css";

export default function ListeningPorts({
  ports,
  loading,
}: {
  ports?: OpenPort[];
  loading: boolean;
}) {
  const [query, setQuery] = useState("");
  const [transport, setTransport] = useState("all");
  const [source, setSource] = useState("all");
  const [address, setAddress] = useState("all");
  const [state, setState] = useState("all");
  const [range, setRange] = useState("");
  const [groupBy, setGroupBy] = useState("protocol");
  const [order, setOrder] = useState("port");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const ranges = portRanges(range);
  const filtered = useMemo(() => {
    const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
    return (ports || [])
      .filter((port) => {
        if (
          !ranges ||
          (ranges.length &&
            !ranges.some(
              ([low, high]) => port.port >= low && port.port <= high,
            ))
        )
          return false;
        if (transport !== "all" && protocol(port) !== transport) return false;
        if (source !== "all" && portSource(port) !== source) return false;
        if (address !== "all" && bindType(port) !== address) return false;
        if (state !== "all" && port.state !== state) return false;
        const text = [
          port.port,
          port.proto,
          port.process,
          port.container,
          port.address,
          port.state,
          sourceNames[portSource(port)],
        ]
          .join(" ")
          .toLowerCase();
        return terms.every((term) => text.includes(term));
      })
      .sort((a, b) => {
        const numeric = a.port - b.port;
        if (order === "port-desc")
          return -numeric || a.address.localeCompare(b.address);
        if (order === "process")
          return a.process.localeCompare(b.process) || numeric;
        return (
          numeric ||
          protocol(a).localeCompare(protocol(b)) ||
          a.address.localeCompare(b.address)
        );
      });
  }, [ports, query, transport, source, address, state, range, order]);
  const groups = useMemo(() => {
    const result = new Map<string, OpenPort[]>();
    for (const port of filtered) {
      const key =
        groupBy === "protocol"
          ? protocol(port)
          : groupBy === "source"
            ? sourceNames[portSource(port)]
            : groupBy === "container"
              ? portSource(port) === "docker"
                ? port.container
                : sourceNames[portSource(port)]
              : groupBy === "process"
                ? !port.process || port.process === "—"
                  ? "Unknown process"
                  : port.process
                : "All bindings";
      const rows = result.get(key) || [];
      rows.push(port);
      result.set(key, rows);
    }
    return Array.from(result).sort(([a], [b]) => a.localeCompare(b));
  }, [filtered, groupBy]);
  const changed = (setter: (value: string) => void) => (value: string) => {
    setter(value);
    setCollapsed(new Set());
  };
  const reset = () => {
    setQuery("");
    setTransport("all");
    setSource("all");
    setAddress("all");
    setState("all");
    setRange("");
    setOrder("port");
    setCollapsed(new Set());
  };
  const active =
    !!query ||
    transport !== "all" ||
    source !== "all" ||
    address !== "all" ||
    state !== "all" ||
    !!range ||
    order !== "port";
  return (
    <Card>
      <section
        className="listening-ports"
        aria-label="Listening ports"
        aria-busy={loading}
      >
        <header className="ports-heading">
          <div>
            <h2>Listening ports</h2>
            <p>
              Observed socket bindings. Bind addresses do not prove external
              reachability.
            </p>
          </div>
          <label>
            Group by
            <select
              aria-label="Group by"
              value={groupBy}
              onChange={(e) => changed(setGroupBy)(e.target.value)}
            >
              <option value="protocol">Protocol</option>
              <option value="source">Source</option>
              <option value="container">Container</option>
              <option value="process">Process</option>
              <option value="none">No grouping</option>
            </select>
          </label>
        </header>
        <div className="ports-controls">
          <label className="ports-search">
            Search bindings
            <span>
              <Search size={14} />
              <input
                aria-label="Search listening ports"
                placeholder="Process, container, address…"
                value={query}
                onChange={(e) => changed(setQuery)(e.target.value)}
              />
            </span>
          </label>
          <label>
            Protocol
            <select
              aria-label="Protocol"
              value={transport}
              onChange={(e) => changed(setTransport)(e.target.value)}
            >
              <option value="all">All protocols</option>
              {Array.from(
                new Set([
                  ...(ports || []).map(protocol),
                  ...(transport === "all" ? [] : [transport]),
                ]),
              )
                .sort()
                .map((value) => (
                  <option key={value}>{value}</option>
                ))}
            </select>
          </label>
          <label>
            Source
            <select
              aria-label="Source"
              value={source}
              onChange={(e) => changed(setSource)(e.target.value)}
            >
              <option value="all">All sources</option>
              {Object.entries(sourceNames).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Bind address
            <select
              aria-label="Bind address"
              value={address}
              onChange={(e) => changed(setAddress)(e.target.value)}
            >
              <option value="all">All bindings</option>
              <option value="loopback">Loopback</option>
              <option value="wildcard">All interfaces</option>
              <option value="specific">Specific address</option>
              <option value="unknown">Unknown</option>
            </select>
          </label>
          <label>
            Socket state
            <select
              aria-label="Socket state"
              value={state}
              onChange={(e) => changed(setState)(e.target.value)}
            >
              <option value="all">All states</option>
              {Array.from(
                new Set([
                  ...(ports || []).map((p) => p.state),
                  ...(state === "all" ? [] : [state]),
                ]),
              )
                .sort()
                .map((value) => (
                  <option key={value}>{value}</option>
                ))}
            </select>
          </label>
          <label>
            Ports / ranges
            <input
              aria-label="Filter port numbers"
              value={range}
              maxLength={128}
              placeholder="80,443,8000-8100"
              aria-invalid={!ranges}
              aria-describedby={!ranges ? "port-range-error" : undefined}
              onChange={(e) => changed(setRange)(e.target.value)}
            />
          </label>
          <label>
            Sort ports
            <select
              aria-label="Sort ports"
              value={order}
              onChange={(e) => changed(setOrder)(e.target.value)}
            >
              <option value="port">Port low–high</option>
              <option value="port-desc">Port high–low</option>
              <option value="process">Process</option>
            </select>
          </label>
        </div>
        {!ranges && (
          <p role="alert" id="port-range-error">
            Use port numbers from 1 to 65535, separated by commas, or ranges
            such as 8000-8100.
          </p>
        )}
        <div className="ports-summary">
          <span role="status">
            {ports
              ? `${filtered.length} of ${ports.length} bindings · ${new Set(filtered.map((p) => p.port)).size} distinct port numbers`
              : loading
                ? "Reading listening sockets…"
                : "Listening socket inventory unavailable"}
          </span>
          <div>
            {active && (
              <button type="button" onClick={reset}>
                Clear filters
              </button>
            )}
            {groupBy !== "none" && groups.length > 0 && (
              <button
                type="button"
                onClick={() =>
                  setCollapsed(
                    collapsed.size
                      ? new Set()
                      : new Set(groups.map(([key]) => key)),
                  )
                }
              >
                {collapsed.size ? "Expand groups" : "Collapse groups"}
              </button>
            )}
          </div>
        </div>
        <div
          className="ports-table-scroll"
          tabIndex={0}
          aria-label="Listening ports table scroll area"
        >
          <table aria-label="Listening socket bindings">
            <thead>
              <tr>
                <Th mono>Port</Th>
                <Th>Protocol</Th>
                <Th>Process</Th>
                <Th>Container / source</Th>
                <Th mono>Bind address</Th>
                <Th>State</Th>
              </tr>
            </thead>
            <tbody>
              {groups.map(([key, rows]) => (
                <Fragment key={key}>
                  {groupBy !== "none" && (
                    <tr className="ports-group">
                      <th colSpan={6} scope="colgroup">
                        <button
                          type="button"
                          aria-expanded={!collapsed.has(key)}
                          onClick={() =>
                            setCollapsed((previous) => {
                              const next = new Set(previous);
                              next.has(key) ? next.delete(key) : next.add(key);
                              return next;
                            })
                          }
                        >
                          {collapsed.has(key) ? (
                            <ChevronRight size={14} />
                          ) : (
                            <ChevronDown size={14} />
                          )}
                          <strong>{key}</strong>
                          <span>
                            {rows.length} binding{rows.length !== 1 ? "s" : ""}
                          </span>
                        </button>
                      </th>
                    </tr>
                  )}
                  {(!collapsed.has(key) || groupBy === "none") &&
                    rows.map((port, i) => (
                      <tr
                        key={`${port.proto}-${port.port}-${port.address}-${i}`}
                      >
                        <Td mono>{port.port}</Td>
                        <Td dim>{port.proto}</Td>
                        <Td dim>{port.process || "—"}</Td>
                        <Td dim>
                          {portSource(port) === "host"
                            ? "Host / unmapped"
                            : portSource(port) === "unknown"
                              ? "Unknown"
                              : port.container}
                        </Td>
                        <Td mono dim>
                          {port.address}
                        </Td>
                        <Td>{port.state || "—"}</Td>
                      </tr>
                    ))}
                </Fragment>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={6} className="ports-empty">
                    {loading && !ports
                      ? "Reading listening sockets…"
                      : !ports
                        ? "Socket inventory is unavailable. Retry the network request."
                        : ports.length === 0
                          ? "No listening sockets were reported."
                          : "No bindings match these filters."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </Card>
  );
}
