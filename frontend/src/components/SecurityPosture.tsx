import { useEffect, useRef, useState } from "react";
import { Card, CardHeader, Btn } from "./ui";
import {
  getSecurityPosture,
  getSSHPolicy,
  type SecurityPosture as Posture,
  type SSHPolicy,
} from "../lib/security";
const known = (v: boolean | null | undefined, yes: string, no: string) =>
  v === true ? yes : v === false ? no : "Unknown";
export default function SecurityPosture() {
  const [data, setData] = useState<Posture | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [revision, setRevision] = useState(0);
  const [user, setUser] = useState(""),
    [address, setAddress] = useState(""),
    [host, setHost] = useState(""),
    [policy, setPolicy] = useState<SSHPolicy | null>(null),
    [policyError, setPolicyError] = useState(""),
    [policyBusy, setPolicyBusy] = useState(false);
  const policyController = useRef<AbortController | null>(null);
  useEffect(() => {
    const c = new AbortController();
    setLoading(true);
    getSecurityPosture(c.signal)
      .then((p) => {
        if (c.signal.aborted) return;
        if (!p.apt || !Array.isArray(p.sensors))
          throw new Error("Detailed evidence is not supported by this API");
        setData(p);
        setError("");
      })
      .catch((e) => {
        if (!c.signal.aborted)
          setError(e.message || "Detailed evidence unavailable");
      })
      .finally(() => {
        if (!c.signal.aborted) setLoading(false);
      });
    return () => c.abort();
  }, [revision]);
  useEffect(() => () => policyController.current?.abort(), []);
  const inspectPolicy = async () => {
    policyController.current?.abort();
    const c = new AbortController();
    policyController.current = c;
    setPolicyBusy(true);
    setPolicy(null);
    setPolicyError("");
    try {
      const p = await getSSHPolicy(user, address, host, c.signal);
      if (!c.signal.aborted) setPolicy(p);
    } catch (e) {
      if (!c.signal.aborted)
        setPolicyError(
          e instanceof Error ? e.message : "SSH context unavailable",
        );
    } finally {
      if (!c.signal.aborted) setPolicyBusy(false);
    }
  };
  return (
    <Card>
      <div className="security-evidence-heading">
        <CardHeader
          title="Protection coverage"
          action={
            <Btn
              size="sm"
              disabled={loading}
              onClick={() => setRevision((v) => v + 1)}
            >
              {loading ? "Reading…" : "Refresh evidence"}
            </Btn>
          }
        />
      </div>
      <div className="security-items security-evidence">
        <p>
          Configured services and evidence are assessed separately. A running
          service does not prove that every threat is covered.
        </p>
        {error && (
          <p role="alert" className="security-warning">
            {error}
            {data ? " Previous evidence may be stale." : ""}
          </p>
        )}
        {data && (
          <>
            <div className="security-evidence-grid">
              <section>
                <h3>Automatic patching</h3>
                {data.sources["apt-health"]?.state !== "ok" && (
                  <p className="security-warning">
                    {data.sources["apt-health"]?.detail ||
                      "APT evidence incomplete"}
                  </p>
                )}
                <dl>
                  <dt>Engine</dt>
                  <dd>
                    {known(data.apt.installed, "Installed", "Not installed")}
                  </dd>
                  <dt>Last timer run</dt>
                  <dd>{data.apt.lastRun || "Not reported"}</dd>
                  <dt>Run result</dt>
                  <dd>{data.apt.lastResult || "Not reported"}</dd>
                  <dt>Reboot</dt>
                  <dd>
                    {known(
                      data.apt.rebootRequired,
                      "Required — plan a restart",
                      "Not currently required",
                    )}
                  </dd>
                </dl>
                {data.apt.rebootRequired === true && (
                  <p className="security-warning">
                    A reboot is pending. Review Updates and the host control
                    center before scheduling a restart.
                  </p>
                )}
                <h4>Allowed origins</h4>
                {data.apt.origins.length ? (
                  data.apt.origins.map((v, i) => (
                    <code className="security-evidence-line" key={i}>
                      {v}
                    </code>
                  ))
                ) : (
                  <p>
                    No origins reported; security patch coverage is unverified.
                  </p>
                )}
                <h4>Package exclusions</h4>
                <p>
                  {data.apt.exclusions.length
                    ? data.apt.exclusions.join(", ")
                    : "No package exclusions reported"}
                </p>
                <p>
                  Timer success is not proof that every pending package was
                  installed.
                </p>
              </section>
              <section>
                <h3>Detection sensors</h3>
                <div className="security-sensors">
                  {data.sensors.map((s) => (
                    <article key={s.id}>
                      <strong>{s.label}</strong>
                      <span>
                        {s.kind} ·{" "}
                        {known(
                          s.installed,
                          s.scheduled === true
                            ? "Scheduled"
                            : known(s.active, "Running", "Not running"),
                          "Not installed",
                        )}
                      </span>
                      <p>{s.detail}</p>
                      {s.lastRun && (
                        <p>
                          Last run: {s.lastRun} ·{" "}
                          {s.lastResult || "Result unknown"}
                        </p>
                      )}
                      {s.id === "clamav-daemon" && (
                        <p>
                          Signature file updated:{" "}
                          {s.signatureUpdatedAt || "Unknown"}
                        </p>
                      )}
                    </article>
                  ))}
                </div>
              </section>
            </div>
            <section>
              <h3>fail2ban jail evidence</h3>
              {data.sources["fail2ban-details"]?.state !== "ok" ? (
                <p className="security-warning">
                  {data.sources["fail2ban-details"]?.detail ||
                    "Update the restricted Security helper to inspect each jail"}
                </p>
              ) : (
                <>
                  {!data.jails.length && <p>No active jails returned.</p>}
                  <div className="security-evidence-grid">
                    {data.jails.map((j) => (
                      <article key={j.name}>
                        <h4>{j.name}</h4>
                        <p>
                          {j.status.state}:{" "}
                          {j.status.detail ||
                            "Configuration read; enforcement has not been tested"}
                        </p>
                        <dl>
                          <dt>Banned</dt>
                          <dd>
                            {j.currentlyBanned} current · {j.totalBanned} total
                          </dd>
                          <dt>Threshold</dt>
                          <dd>
                            {j.maxRetry} attempts / {j.findTime}s · ban{" "}
                            {j.banTime}s
                          </dd>
                          <dt>Regexes</dt>
                          <dd>{j.failRegexCount}</dd>
                          <dt>Log paths</dt>
                          <dd>{j.logPaths.join("; ") || "Not reported"}</dd>
                          <dt>Journal</dt>
                          <dd>{j.journalMatch || "Not reported"}</dd>
                          <dt>Actions</dt>
                          <dd>{j.actions || "No action reported"}</dd>
                        </dl>
                      </article>
                    ))}
                  </div>
                  {data.jailsTruncated && (
                    <p>
                      Only the first eight jails are shown; coverage is
                      incomplete.
                    </p>
                  )}
                </>
              )}
            </section>
            <section>
              <h3>Firewall chains and Docker</h3>
              {data.sources.nft?.state !== "ok" && (
                <p className="security-warning">
                  {data.sources.nft?.detail ||
                    "Privileged firewall rules are unavailable; update the restricted helper"}
                </p>
              )}
              <p>
                UFW status alone does not assess Docker forwarding, NAT or
                external reachability. These are observed rules, not a network
                penetration test.
              </p>
              {!!data.chains.length && (
                <details>
                  <summary>
                    {data.chains.length} observed chains — inspect policies
                  </summary>
                  <div className="security-table-scroll">
                    <table>
                      <thead>
                        <tr>
                          {[
                            "Family / table",
                            "Chain",
                            "Hook / policy",
                            "Rules",
                          ].map((v) => (
                            <th key={v}>{v}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {data.chains.map((c, i) => (
                          <tr key={i}>
                            <td>
                              {c.family} / {c.table}
                            </td>
                            <td>{c.name}</td>
                            <td>
                              {c.hook || "—"} / {c.policy || "—"}
                            </td>
                            <td>{c.rules}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              )}
            </section>
          </>
        )}
        <section>
          <h3>Evaluate effective OpenSSH policy</h3>
          <p>
            Evaluate Match rules for a Linux user and remote address. The
            supplied host name is not verified by reverse DNS. Tailscale SSH
            uses its separate tailnet policy.
          </p>
          <form
            className="security-filter-grid"
            onSubmit={(e) => {
              e.preventDefault();
              void inspectPolicy();
            }}
          >
            <label>
              Linux user
              <input
                aria-label="SSH policy Linux user"
                value={user}
                onChange={(e) => setUser(e.target.value)}
                required
                maxLength={33}
                autoCapitalize="off"
                autoComplete="off"
              />
            </label>
            <label>
              Remote IP
              <input
                aria-label="SSH policy remote address"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                required
                maxLength={45}
                placeholder="192.0.2.10 or IPv6"
                autoCapitalize="off"
                autoComplete="off"
              />
            </label>
            <label>
              Remote host (optional)
              <input
                aria-label="SSH policy remote host"
                value={host}
                onChange={(e) => setHost(e.target.value)}
                maxLength={253}
                autoCapitalize="off"
                autoComplete="off"
              />
            </label>
            <Btn size="sm" disabled={policyBusy}>
              {policyBusy ? "Evaluating…" : "Evaluate policy"}
            </Btn>
          </form>
          {policyError && (
            <p role="alert" className="security-warning">
              {policyError}
            </p>
          )}
          {policy && (
            <div role="status">
              <p>
                {policy.context.user} from {policy.context.address} ·{" "}
                {policy.source.state}
              </p>
              {policy.source.state !== "ok" ? (
                <p className="security-warning">{policy.source.detail}</p>
              ) : (
                <>
                  <dl>
                    <dt>Methods</dt>
                    <dd>{policy.authenticationMethods || "Not reported"}</dd>
                    <dt>AllowUsers</dt>
                    <dd>{policy.allowUsers || "No directive reported"}</dd>
                    <dt>DenyUsers</dt>
                    <dd>{policy.denyUsers || "No directive reported"}</dd>
                  </dl>
                  {policy.checks.map((c) => (
                    <p key={c.id}>
                      <strong>
                        {c.label}:{" "}
                        {c.ok === true
                          ? "Pass"
                          : c.ok === false
                            ? "Needs attention"
                            : "Unknown"}
                      </strong>{" "}
                      · {c.detail}
                    </p>
                  ))}
                </>
              )}
            </div>
          )}
        </section>
      </div>
    </Card>
  );
}
