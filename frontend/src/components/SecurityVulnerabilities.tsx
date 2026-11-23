import { useEffect, useRef, useState } from "react";
import { Card, CardHeader, Btn } from "./ui";
import { getSession } from "../lib/auth";
import {
  getScanCapabilities,
  getScanJobs,
  startScan,
  type ScanCapabilities,
  type ScanJob,
} from "../lib/security";
import type { ConfirmDialog } from "../lib/types";
export default function SecurityVulnerabilities({
  onConfirm,
}: {
  onConfirm: (dialog: ConfirmDialog) => void;
}) {
  const admin = getSession()?.user.role === "admin";
  const [caps, setCaps] = useState<ScanCapabilities | null>(null),
    [jobs, setJobs] = useState<ScanJob[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [revision, setRevision] = useState(0),
    [target, setTarget] = useState("host"),
    [hostname, setHostname] = useState(""),
    [severity, setSeverity] = useState("all"),
    [search, setSearch] = useState(""),
    [selected, setSelected] = useState("");
  const lock = useRef(false),
    mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    const c = new AbortController();
    setLoading(true);
    void (async () => {
      try {
        const cap = await getScanCapabilities(c.signal);
        if (!Array.isArray(cap.targets))
          throw new Error("Vulnerability scanning is unavailable in this API");
        const records = await getScanJobs(c.signal);
        if (!Array.isArray(records))
          throw new Error("Scan history is unavailable");
        if (c.signal.aborted) return;
        setCaps(cap);
        setJobs(records);
        setError("");
      } catch (e) {
        if (!c.signal.aborted)
          setError(e instanceof Error ? e.message : "Scanner unavailable");
      } finally {
        if (!c.signal.aborted) setLoading(false);
      }
    })();
    return () => c.abort();
  }, [revision]);
  const running = jobs.some((j) => j.status === "running");
  useEffect(() => {
    if (!running) return;
    const c = new AbortController();
    const timer = window.setInterval(() => {
      void getScanJobs(c.signal)
        .then((records) => {
          if (!c.signal.aborted && Array.isArray(records)) setJobs(records);
        })
        .catch((e) => {
          if (!c.signal.aborted)
            setError(e.message || "Scan status unavailable");
        });
    }, 2000);
    return () => {
      c.abort();
      clearInterval(timer);
    };
  }, [running]);
  const submit = () => {
    if (!caps || hostname !== caps.hostname || lock.current || busy) return;
    const reviewed = caps,
      chosen = target;
    onConfirm({
      title: "Run vulnerability scan",
      action: "Start scan",
      requireConfirmation: true,
      message: `Scan ${chosen === "host" ? "host OS packages" : chosen} on ${reviewed.hostname}. The scanner may download its vulnerability database. No packages or containers will be changed.`,
      onConfirm: () => {
        if (lock.current) return;
        lock.current = true;
        setBusy(true);
        setError("");
        void startScan(reviewed, chosen)
          .then((job) => {
            if (!mounted.current) return;
            setJobs((old) => [job, ...old.filter((j) => j.id !== job.id)]);
            setSelected(job.id);
            setHostname("");
          })
          .catch((e) => {
            if (mounted.current)
              setError(
                (e.message || "Scan request not confirmed") +
                  ". Refresh scan status before trying again; requests are not automatically retried.",
              );
          })
          .finally(() => {
            lock.current = false;
            if (mounted.current) setBusy(false);
          });
      },
    });
  };
  const job = jobs.find((j) => j.id === selected) || jobs[0];
  const report = job?.report;
  const findings = (report?.vulnerabilities || []).filter(
    (v) =>
      (severity === "all" || v.severity === severity) &&
      `${v.id} ${v.package} ${v.title} ${v.target}`
        .toLowerCase()
        .includes(search.toLowerCase().trim()),
  );
  const dbDate = report?.databaseUpdatedAt
    ? new Date(report.databaseUpdatedAt)
    : null;
  const staleDB =
    report &&
    (!dbDate ||
      Number.isNaN(dbDate.getTime()) ||
      Date.now() - dbDate.getTime() > 72 * 3600000);
  return (
    <Card>
      <div className="security-evidence-heading">
        <CardHeader
          title="Vulnerabilities"
          action={
            <Btn
              size="sm"
              disabled={loading || busy}
              onClick={() => setRevision((v) => v + 1)}
            >
              {loading ? "Reading…" : "Refresh scanner"}
            </Btn>
          }
        />
      </div>
      <div className="security-items security-evidence">
        <p>
          On-demand CVE analysis of host OS packages and immutable local images.
          A completed scan reports known advisories for supported packages; it
          does not detect every threat or automatically apply fixes.
        </p>
        {error && (
          <p role="alert" className="security-warning">
            {error}
          </p>
        )}
        {caps && (
          <>
            <p>{caps.available ? caps.version : caps.reason}</p>
            {admin ? (
              <form
                className="security-filter-grid"
                onSubmit={(e) => {
                  e.preventDefault();
                  submit();
                }}
              >
                <label>
                  Scan target
                  <select
                    aria-label="Vulnerability scan target"
                    value={target}
                    onChange={(e) => setTarget(e.target.value)}
                    disabled={!caps.available || busy || running}
                  >
                    {caps.targets.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Confirm host: {caps.hostname || "unavailable"}
                  <input
                    aria-label="Confirm vulnerability scan hostname"
                    value={hostname}
                    onChange={(e) => setHostname(e.target.value)}
                    disabled={!caps.available || busy || running}
                    autoComplete="off"
                    autoCapitalize="off"
                    spellCheck={false}
                  />
                </label>
                <Btn
                  size="sm"
                  disabled={
                    !caps.available ||
                    busy ||
                    running ||
                    loading ||
                    !!error ||
                    hostname !== caps.hostname ||
                    !caps.targets.some((t) => t.id === target)
                  }
                >
                  {busy || running ? "Scan pending…" : "Review scan"}
                </Btn>
              </form>
            ) : (
              <p>
                Only an administrator can start scans. Existing reports remain
                available for review.
              </p>
            )}
          </>
        )}
        {!!jobs.length && (
          <label>
            Scan history
            <select
              aria-label="Vulnerability scan history"
              value={job?.id || ""}
              onChange={(e) => setSelected(e.target.value)}
            >
              {jobs.map((j) => (
                <option key={j.id} value={j.id}>
                  {j.status} · {new Date(j.startedAt).toLocaleString()} ·{" "}
                  {j.target === "host" ? "Host OS" : j.target.slice(0, 19)}
                </option>
              ))}
            </select>
          </label>
        )}
        {job && (
          <p role="status">
            {job.status} · Started {new Date(job.startedAt).toLocaleString()}
            {job.finishedAt
              ? ` · Finished ${new Date(job.finishedAt).toLocaleString()}`
              : ""}
          </p>
        )}
        {job?.error && <p className="security-warning">{job.error}</p>}
        {report && (
          <>
            <p>{report.coverage}</p>
            <p>
              {report.packages} supported packages · OS:{" "}
              {report.os || "Not reported"} · Scan:{" "}
              {new Date(report.scannedAt).toLocaleString()} · Database:{" "}
              {report.databaseUpdatedAt || "Unknown"}
            </p>
            {staleDB && (
              <p className="security-warning">
                Database freshness is unknown or older than 72 hours. A clean
                finding list does not prove current vulnerability coverage.
              </p>
            )}
            {report.endOfLife && (
              <p className="security-warning">
                The scanner reports this OS as end of life. Vulnerability
                coverage may be incomplete.
              </p>
            )}
            <p>
              {report.uniqueAdvisories ?? "Not reported"} distinct advisories ·{" "}
              {report.fixAvailable ?? "Not reported"} package/advisory pairs
              with a published fix. Severity counts count package/advisory
              pairs, including installed kernel versions that may not be loaded.
            </p>
            <div className="security-severities">
              {["CRITICAL", "HIGH", "MEDIUM", "LOW", "UNKNOWN"].map((s) => (
                <span key={s}>
                  {s}: {report.counts[s] || 0}
                </span>
              ))}
            </div>
            <div className="security-filter-grid">
              <label>
                Severity
                <select
                  aria-label="Vulnerability severity"
                  value={severity}
                  onChange={(e) => setSeverity(e.target.value)}
                >
                  {["all", "CRITICAL", "HIGH", "MEDIUM", "LOW", "UNKNOWN"].map(
                    (s) => (
                      <option value={s} key={s}>
                        {s === "all" ? "All severities" : s}
                      </option>
                    ),
                  )}
                </select>
              </label>
              <label>
                Search findings
                <input
                  aria-label="Search vulnerabilities"
                  placeholder="CVE, package or title…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </label>
            </div>
            {report.truncated && (
              <p className="security-warning">
                The report contains more than 1,000 findings. Counts include all
                findings; this table prioritizes the 1,000 most severe findings
                and published fixes.
              </p>
            )}
            <div className="security-table-scroll">
              <table aria-label="Vulnerability findings">
                <thead>
                  <tr>
                    {[
                      "Severity",
                      "Advisory / package",
                      "Installed",
                      "Fixed",
                      "Target",
                    ].map((v) => (
                      <th key={v}>{v}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {findings.map((v, i) => (
                    <tr key={`${v.id}-${v.package}-${i}`}>
                      <td>{v.severity}</td>
                      <td>
                        {v.url ? (
                          <a
                            href={v.url}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            {v.id}
                          </a>
                        ) : (
                          v.id
                        )}
                        <br />
                        {v.package}
                        <p>{v.title}</p>
                      </td>
                      <td>{v.installed}</td>
                      <td>{v.fixed || "No fix published"}</td>
                      <td>{v.target}</td>
                    </tr>
                  ))}
                  {!findings.length && (
                    <tr>
                      <td colSpan={5}>
                        {report.vulnerabilities.length
                          ? "No findings match these filters."
                          : "No known vulnerabilities returned for this scan's supported package inventory."}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
        {!jobs.length && !loading && (
          <p>
            No scan has completed in this API process. No clean security result
            is claimed.
          </p>
        )}
      </div>
    </Card>
  );
}
