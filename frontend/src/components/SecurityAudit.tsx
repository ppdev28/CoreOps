import { useEffect, useState } from "react";
import { Card, CardHeader, Btn } from "./ui";
import { request } from "../shared/api/client";
import { getSession } from "../lib/auth";
interface Integrity {
  state: string;
  records: number;
  legacyRecords: number;
  files: number;
  retention: string;
  detail: string;
  sequence: number;
  lastHash: string;
}
export default function SecurityAudit() {
  const [data, setData] = useState<Integrity | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [controller, setController] = useState<AbortController | null>(null);
  useEffect(() => () => controller?.abort(), [controller]);
  if (getSession()?.user.role !== "admin") return null;
  const verify = async () => {
    controller?.abort();
    const c = new AbortController();
    setController(c);
    setBusy(true);
    setData(null);
    setError("");
    try {
      const result = await request<Integrity>("/audit/integrity", {
        signal: c.signal,
      });
      if (!c.signal.aborted) setData(result);
    } catch (e) {
      if (!c.signal.aborted)
        setError(e instanceof Error ? e.message : "Audit verification failed");
    } finally {
      if (!c.signal.aborted) setBusy(false);
    }
  };
  return (
    <Card>
      <div className="security-evidence-heading">
        <CardHeader
          title="Audit integrity and retention"
          action={
            <Btn size="sm" disabled={busy} onClick={() => void verify()}>
              {busy ? "Verifying…" : "Verify audit chain"}
            </Btn>
          }
        />
      </div>
      <div className="security-items security-evidence">
        <p>
          Security actions require a durable intent before dispatch. Retained
          audit files use a local SHA-256 chain and bounded rotation. This does
          not replace an external append-only audit sink.
        </p>
        {error && (
          <p role="alert" className="security-warning">
            {error}
          </p>
        )}
        {data && (
          <div role="status">
            <strong>{data.state}</strong>
            <p>
              {data.records} retained records · {data.legacyRecords} legacy
              records · {data.files} files · last sequence {data.sequence}
            </p>
            <p>{data.retention}</p>
            <p>{data.detail}</p>
          </div>
        )}
      </div>
    </Card>
  );
}
