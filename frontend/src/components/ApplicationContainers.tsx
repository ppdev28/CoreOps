import { useEffect, useState } from "react";
import { Box, ChevronRight, RefreshCw } from "lucide-react";
import { getContainers, type Container } from "../features/containers";
import { getSession } from "../lib/auth";
import { Card, CardHeader, StatusBadge } from "./ui";

export default function ApplicationContainers({
  ids,
  revision,
  onInspect,
}: {
  ids?: string[];
  revision: number;
  onInspect: (id: string) => void;
}) {
  const [inventory, setInventory] = useState<Container[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const membership = ids ? [...new Set(ids)].join(",") : null;
  const canInspect = ["admin", "operator"].includes(
    getSession()?.user.role ?? "",
  );
  useEffect(() => {
    if (membership === null || !membership) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError("");
    void getContainers(controller.signal)
      .then((next) => {
        if (!controller.signal.aborted) setInventory(next);
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted)
          setError(
            cause instanceof Error
              ? cause.message
              : "Unable to read application containers.",
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [membership, revision]);
  const byId = new Map(inventory?.map((c) => [c.id, c]));
  return (
    <Card>
      <CardHeader title="Application containers" />
      <div className="application-container-content" aria-busy={loading}>
        <p>
          Containers reported as members of this application. Open one to
          inspect its configuration, networks, mounts and environment.
        </p>
        {error && (
          <div role="alert">
            {error}
            {inventory
              ? " Showing the previous inventory; refresh the application to verify current state."
              : " Refresh the application to try again."}
          </div>
        )}
        {membership === null ? (
          <p role="status">
            Container membership is unavailable. Refresh the application.
          </p>
        ) : membership === "" ? (
          <p role="status">No container members were reported.</p>
        ) : !inventory && loading ? (
          <p role="status">
            <RefreshCw size={14} /> Loading application containers…
          </p>
        ) : (
          inventory && (
            <ul
              className="application-container-list"
              aria-label="Application containers"
            >
              {membership.split(",").map((id) => {
                const container = byId.get(id);
                return (
                  <li key={id}>
                    {container ? (
                      <>
                        <div className="application-container-heading">
                          <Box size={18} />
                          <strong>{container.name}</strong>
                          <StatusBadge status={container.status} />
                        </div>
                        <code className="application-container-image">
                          {container.image}
                        </code>
                        <dl>
                          <div>
                            <dt>Container ID</dt>
                            <dd>
                              <code>{container.id.slice(0, 12)}</code>
                            </dd>
                          </div>
                          <div>
                            <dt>Networks</dt>
                            <dd>{container.net}</dd>
                          </div>
                          <div>
                            <dt>Published ports</dt>
                            <dd>{container.ports}</dd>
                          </div>
                          <div>
                            <dt>Created</dt>
                            <dd>{container.created}</dd>
                          </div>
                        </dl>
                        {canInspect ? (
                          <button
                            type="button"
                            className="application-inspect"
                            onClick={() => onInspect(container.id)}
                            aria-label={`Inspect application container ${container.name}`}
                          >
                            Inspect container <ChevronRight size={15} />
                          </button>
                        ) : (
                          <small>
                            Operator access is required for configuration
                            details.
                          </small>
                        )}
                      </>
                    ) : (
                      <div role="status">
                        <strong>Container unavailable</strong>
                        <code>{id}</code>
                        <p>
                          This member is absent from the current Docker
                          inventory. Refresh the application to reconcile its
                          membership.
                        </p>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )
        )}
      </div>
    </Card>
  );
}
