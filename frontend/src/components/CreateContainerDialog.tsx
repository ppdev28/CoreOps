import { useEffect, useRef, useState, type FormEvent } from "react";
import { Box, Check, Plus, X } from "lucide-react";
import { Btn } from "./ui";
import {
  createContainer,
  type CreateContainerInput,
  type CreateContainerResult,
  type ComposeResult,
} from "../lib/api";
import "../styles/container-create.css";
import CreateComposeForm from "./CreateComposeForm";

type PortDraft = {
  id: number;
  hostIp: string;
  hostPort: string;
  containerPort: string;
  protocol: "tcp" | "udp";
};

export default function CreateContainerDialog({
  images,
  onClose,
  onCreated,
  onComposeCreated,
  onInspect,
}: {
  images: string[];
  onClose: () => void;
  onCreated: (result: CreateContainerResult) => Promise<void>;
  onComposeCreated: (result: ComposeResult) => Promise<void>;
  onInspect: (id: string) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const submitting = useRef(false);
  const nextPort = useRef(0);
  const [mode, setMode] = useState<"container" | "compose">("container");
  const [composeComplete, setComposeComplete] = useState(false);
  const [name, setName] = useState("");
  const [image, setImage] = useState("");
  const [environment, setEnvironment] = useState("");
  const [command, setCommand] = useState("");
  const [restartPolicy, setRestartPolicy] =
    useState<CreateContainerInput["restartPolicy"]>("no");
  const [start, setStart] = useState(false);
  const [ports, setPorts] = useState<PortDraft[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<CreateContainerResult | null>(null);

  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  useEffect(() => {
    if (!pending) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [pending]);

  const updatePort = (id: number, change: Partial<PortDraft>) =>
    setPorts((items) =>
      items.map((port) => (port.id === id ? { ...port, ...change } : port)),
    );
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (submitting.current || result) return;
    const variables = environment
      .split(/\r?\n/)
      .filter((line) => line.trim() !== "");
    const keys = variables.map((line) => line.slice(0, line.indexOf("=")));
    if (
      variables.some((line) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(line)) ||
      new Set(keys).size !== keys.length
    ) {
      setError("Use one NAME=value per line with unique variable names.");
      return;
    }
    submitting.current = true;
    setPending(true);
    setError("");
    try {
      const created = await createContainer({
        name: name.trim(),
        image: image.trim(),
        environment: variables,
        command: command ? command.split(/\r?\n/) : [],
        ports: ports.map(({ hostIp, hostPort, containerPort, protocol }) => ({
          hostIp: hostIp.trim(),
          hostPort: Number(hostPort),
          containerPort: Number(containerPort),
          protocol,
        })),
        restartPolicy,
        start,
      });
      setResult(created);
      await onCreated(created);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Unable to create container. Check the container list before retrying.",
      );
    } finally {
      submitting.current = false;
      setPending(false);
    }
  };

  return (
    <dialog
      ref={dialog}
      className="container-create-dialog"
      aria-labelledby="container-create-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!submitting.current && !pending) onClose();
      }}
      onClick={(event) => {
        if (
          event.target === event.currentTarget &&
          !submitting.current &&
          !pending
        )
          onClose();
      }}
    >
      <div className="container-create-surface">
        <header>
          <div>
            <h2 id="container-create-title">
              <Box size={20} /> Create container
            </h2>
            <p>Configure a new Docker container on this server.</p>
          </div>
          <button
            type="button"
            className="container-create-icon"
            aria-label="Close create container"
            disabled={pending}
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </header>
        <div
          className="container-create-modes"
          role="tablist"
          aria-label="Creation method"
        >
          {(["container", "compose"] as const).map((value, index) => (
            <button
              type="button"
              role="tab"
              id={`create-tab-${value}`}
              aria-controls={`create-panel-${value}`}
              aria-selected={mode === value}
              tabIndex={mode === value ? 0 : -1}
              disabled={pending || !!result || composeComplete}
              key={value}
              onClick={() => setMode(value)}
              onKeyDown={(event) => {
                if (
                  ["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)
                ) {
                  event.preventDefault();
                  const next =
                    event.key === "Home"
                      ? "container"
                      : event.key === "End"
                        ? "compose"
                        : index === 0
                          ? "compose"
                          : "container";
                  setMode(next);
                  document.getElementById(`create-tab-${next}`)?.focus();
                }
              }}
            >
              {value === "container" ? "Single container" : "Docker Compose"}
            </button>
          ))}
        </div>
        <div
          role="tabpanel"
          id="create-panel-compose"
          aria-labelledby="create-tab-compose"
          hidden={mode !== "compose"}
        >
          <CreateComposeForm
            active={mode === "compose"}
            images={images}
            onBusy={setPending}
            onComplete={() => setComposeComplete(true)}
            onCreated={onComposeCreated}
            onInspect={onInspect}
            onClose={onClose}
          />
        </div>
        <div
          role="tabpanel"
          id="create-panel-container"
          aria-labelledby="create-tab-container"
          hidden={mode !== "container"}
        >
          {result ? (
            <div className="container-create-result" role="status">
              <Check size={28} />
              <h3>{result.name} created</h3>
              <code>{result.id}</code>
              <p>
                {result.started
                  ? "Docker accepted the start request. Inspect the container to check its current state."
                  : result.startError ||
                    "The container was created without starting it."}
              </p>
              {result.warnings.map((warning, i) => (
                <p key={i} className="container-create-warning">
                  {warning}
                </p>
              ))}
              <div className="container-create-actions">
                <Btn onClick={onClose}>Close</Btn>
                <Btn variant="primary" onClick={() => onInspect(result.id)}>
                  Inspect container
                </Btn>
              </div>
            </div>
          ) : (
            <form onSubmit={(event) => void submit(event)} aria-busy={pending}>
              <fieldset disabled={pending}>
                <div className="container-create-grid">
                  <label>
                    Container name
                    <input
                      autoFocus
                      required
                      maxLength={128}
                      pattern="[a-zA-Z0-9][a-zA-Z0-9_.\-]*"
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                      placeholder="my-service"
                      autoComplete="off"
                    />
                  </label>
                  <label>
                    Image
                    <input
                      required
                      maxLength={512}
                      value={image}
                      onChange={(event) => setImage(event.target.value)}
                      placeholder="nginx:stable"
                      list="container-create-images"
                      autoComplete="off"
                    />
                    <datalist id="container-create-images">
                      {images.map((value) => (
                        <option key={value} value={value} />
                      ))}
                    </datalist>
                  </label>
                </div>
                <p className="container-create-help">
                  Use an image already present on this Docker host. Image
                  downloads are managed separately.
                </p>
                <section aria-label="Published ports">
                  <div className="container-create-section-heading">
                    <h3>Published ports</h3>
                    <button
                      type="button"
                      disabled={ports.length >= 32}
                      onClick={() =>
                        setPorts((items) => [
                          ...items,
                          {
                            id: nextPort.current++,
                            hostIp: "127.0.0.1",
                            hostPort: "",
                            containerPort: "",
                            protocol: "tcp",
                          },
                        ])
                      }
                    >
                      <Plus size={14} /> Add port
                    </button>
                  </div>
                  <p className="container-create-help">
                    Bindings default to 127.0.0.1. Use a server interface IP for
                    remote access, or 0.0.0.0 to publish on all IPv4 interfaces.
                  </p>
                  {ports.map((port, index) => (
                    <div className="container-create-port" key={port.id}>
                      <label>
                        Host IP
                        <input
                          aria-label={`Host IP ${index + 1}`}
                          required
                          value={port.hostIp}
                          onChange={(event) =>
                            updatePort(port.id, { hostIp: event.target.value })
                          }
                        />
                      </label>
                      <label>
                        Host port
                        <input
                          aria-label={`Host port ${index + 1}`}
                          required
                          type="number"
                          min="1"
                          max="65535"
                          value={port.hostPort}
                          onChange={(event) =>
                            updatePort(port.id, {
                              hostPort: event.target.value,
                            })
                          }
                        />
                      </label>
                      <label>
                        Container port
                        <input
                          aria-label={`Container port ${index + 1}`}
                          required
                          type="number"
                          min="1"
                          max="65535"
                          value={port.containerPort}
                          onChange={(event) =>
                            updatePort(port.id, {
                              containerPort: event.target.value,
                            })
                          }
                        />
                      </label>
                      <label>
                        Protocol
                        <select
                          aria-label={`Protocol ${index + 1}`}
                          value={port.protocol}
                          onChange={(event) =>
                            updatePort(port.id, {
                              protocol: event.target
                                .value as PortDraft["protocol"],
                            })
                          }
                        >
                          <option value="tcp">TCP</option>
                          <option value="udp">UDP</option>
                        </select>
                      </label>
                      <button
                        type="button"
                        className="container-create-icon"
                        aria-label={`Remove port ${index + 1}`}
                        onClick={() =>
                          setPorts((items) =>
                            items.filter((p) => p.id !== port.id),
                          )
                        }
                      >
                        <X size={16} />
                      </button>
                    </div>
                  ))}
                </section>
                <label>
                  Environment variables
                  <textarea
                    rows={3}
                    value={environment}
                    onChange={(event) => setEnvironment(event.target.value)}
                    placeholder={"TZ=Europe/Madrid\nAPP_MODE=production"}
                    spellCheck={false}
                    autoComplete="off"
                    maxLength={50000}
                  />
                  <span className="container-create-help">
                    One NAME=value per line. Values stay in this form until
                    submitted.
                  </span>
                </label>
                <details>
                  <summary>Command and restart policy</summary>
                  <label>
                    Command arguments
                    <textarea
                      rows={3}
                      value={command}
                      onChange={(event) => setCommand(event.target.value)}
                      placeholder={"sleep\n3600"}
                      spellCheck={false}
                      maxLength={50000}
                    />
                    <span className="container-create-help">
                      One argument per line, including the executable. Leave
                      empty to use the image command. No shell parsing.
                    </span>
                  </label>
                  <label>
                    Restart policy
                    <select
                      value={restartPolicy}
                      onChange={(event) =>
                        setRestartPolicy(
                          event.target
                            .value as CreateContainerInput["restartPolicy"],
                        )
                      }
                    >
                      <option value="no">No automatic restart</option>
                      <option value="unless-stopped">Unless stopped</option>
                      <option value="on-failure">On failure</option>
                      <option value="always">Always</option>
                    </select>
                  </label>
                </details>
                <label className="container-create-check">
                  <input
                    type="checkbox"
                    checked={start}
                    onChange={(event) => setStart(event.target.checked)}
                  />{" "}
                  Start after creation
                </label>
              </fieldset>
              {error && (
                <p className="container-create-error" role="alert">
                  {error}
                </p>
              )}
              <footer>
                <button
                  type="button"
                  className="container-create-cancel"
                  disabled={pending}
                  onClick={onClose}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="container-create-submit"
                  disabled={pending}
                >
                  {pending
                    ? "Creating…"
                    : start
                      ? "Create and start"
                      : "Create container"}
                </button>
              </footer>
            </form>
          )}
        </div>
      </div>
    </dialog>
  );
}
