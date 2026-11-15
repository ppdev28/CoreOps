import { useEffect, useRef, useState, type FormEvent } from "react";
import { Check, FileCode2, FileUp, RefreshCw } from "lucide-react";
import {
  createComposeProject,
  getComposeCapabilities,
  validateCompose,
  type ComposePreview,
  type ComposeResult,
} from "../lib/api";
import { Btn } from "./ui";

export default function CreateComposeForm({
  active,
  images,
  onBusy,
  onComplete,
  onCreated,
  onInspect,
  onClose,
}: {
  active: boolean;
  images: string[];
  onBusy: (busy: boolean) => void;
  onComplete: () => void;
  onCreated: (result: ComposeResult) => Promise<void>;
  onInspect: (id: string) => void;
  onClose: () => void;
}) {
  const [project, setProject] = useState("");
  const [compose, setCompose] = useState("");
  const [start, setStart] = useState(false);
  const [preview, setPreview] = useState<ComposePreview | null>(null);
  const [result, setResult] = useState<ComposeResult | null>(null);
  const [pending, setPending] = useState<"validate" | "create" | "file" | null>(
    null,
  );
  const [available, setAvailable] = useState<boolean | null>(null);
  const [capabilityError, setCapabilityError] = useState("");
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const busy = useRef(false);
  const projectInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!active) return;
    projectInput.current?.focus();
    const controller = new AbortController();
    void getComposeCapabilities(controller.signal).then(
      (capability) => {
        if (!controller.signal.aborted) {
          setAvailable(capability.available);
          setCapabilityError(capability.available ? "" : capability.reason);
        }
      },
      (cause) => {
        if (!controller.signal.aborted) {
          setAvailable(false);
          setCapabilityError(
            cause instanceof Error
              ? cause.message
              : "Unable to check Docker Compose availability",
          );
        }
      },
    );
    return () => controller.abort();
  }, [active, refresh]);
  const changeProject = (value: string) => {
    setProject(value);
    setPreview(null);
    setError("");
  };
  const changeCompose = (value: string) => {
    setCompose(value);
    setPreview(null);
    setError("");
  };
  const loadFile = async (file: File | undefined) => {
    if (!file || busy.current) return;
    if (file.size > 128 * 1024) {
      setPreview(null);
      setError("Compose files must be at most 128 KiB.");
      return;
    }
    busy.current = true;
    onBusy(true);
    setPending("file");
    try {
      changeCompose(
        new TextDecoder("utf-8", { fatal: true }).decode(
          await file.arrayBuffer(),
        ),
      );
    } catch {
      setPreview(null);
      setError(
        "Could not read this UTF-8 Compose file. Paste the document instead.",
      );
    } finally {
      busy.current = false;
      onBusy(false);
      setPending(null);
    }
  };
  const validate = async () => {
    if (busy.current || result) return;
    if (!/^[a-z0-9][a-z0-9_-]{0,62}$/.test(project.trim())) {
      setError(
        "Use a project name of 1–63 lowercase letters, digits, hyphens or underscores.",
      );
      return;
    }
    if (!compose.trim()) {
      setError("Paste a Compose document or load a YAML file.");
      return;
    }
    busy.current = true;
    onBusy(true);
    setPending("validate");
    setPreview(null);
    setError("");
    try {
      setPreview(
        await validateCompose({ project: project.trim(), compose, start }),
      );
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Compose validation failed",
      );
    } finally {
      busy.current = false;
      onBusy(false);
      setPending(null);
    }
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy.current || !preview || result) return;
    busy.current = true;
    onBusy(true);
    setPending("create");
    setError("");
    try {
      const created = await createComposeProject({
        project: project.trim(),
        compose,
        start,
        validationHash: preview.hash,
      });
      setResult(created);
      onComplete();
      await onCreated(created);
    } catch (cause) {
      setError(
        (cause instanceof Error
          ? cause.message
          : "Compose creation could not be confirmed") +
          " Refresh the container list before retrying an uncertain request.",
      );
    } finally {
      busy.current = false;
      onBusy(false);
      setPending(null);
    }
  };
  return (
    <div className="compose-create">
      {result ? (
        <div className="container-create-result" role="status">
          <Check size={28} />
          <h3>
            {result.state === "partial"
              ? "Project needs inspection"
              : result.state === "started"
                ? "Compose start requested"
                : "Compose project created"}
          </h3>
          <strong>{result.project}</strong>
          <p>
            {result.operationError ||
              (result.state === "started"
                ? "Docker accepted the start request. Check the observed container states below."
                : "The containers were created without starting them.")}
          </p>
          {result.containers.length > 0 && (
            <p>
              The project appears in Applications; its containers are listed in
              Containers.
            </p>
          )}
          {result.warnings.map((warning, index) => (
            <p className="container-create-warning" key={index}>
              {warning}
            </p>
          ))}
          <ul className="compose-created-containers">
            {result.containers.map((container) => (
              <li key={container.id}>
                <div>
                  <strong>{container.name}</strong>
                  <span>
                    {container.service} · {container.status}
                  </span>
                </div>
                <Btn onClick={() => onInspect(container.id)}>Inspect</Btn>
              </li>
            ))}
          </ul>
          {!result.containers.length && (
            <p>
              No containers could be confirmed. The project name is reserved;
              inspect the host before creating another project.
            </p>
          )}
          <div className="container-create-actions">
            <Btn variant="primary" onClick={onClose}>
              Back to containers
            </Btn>
          </div>
        </div>
      ) : (
        <form onSubmit={(event) => void submit(event)} aria-busy={!!pending}>
          {capabilityError && (
            <div className="container-create-error" role="alert">
              {capabilityError}
              <button
                className="container-create-cancel"
                type="button"
                onClick={() => {
                  setAvailable(null);
                  setCapabilityError("");
                  setRefresh((value) => value + 1);
                }}
              >
                Retry Compose check
              </button>
            </div>
          )}
          <fieldset disabled={!!pending}>
            <label>
              Project name
              <input
                ref={projectInput}
                value={project}
                maxLength={63}
                placeholder="my-stack"
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                onChange={(event) => changeProject(event.target.value)}
              />
            </label>
            <p className="container-create-help">
              Choose a new project name. Existing Compose applications are never
              updated by this dialog.
            </p>
            <section aria-label="Compose document">
              <div className="container-create-section-heading">
                <h3>
                  <FileCode2 size={15} /> Compose YAML
                </h3>
                <div className="compose-file-actions">
                  <input
                    ref={fileInput}
                    hidden
                    type="file"
                    accept=".yaml,.yml,.json,text/yaml,application/yaml,application/json"
                    aria-label="Load Compose file"
                    onChange={(event) => {
                      void loadFile(event.target.files?.[0]);
                      event.target.value = "";
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => fileInput.current?.click()}
                  >
                    <FileUp size={14} />
                    Load file
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      changeCompose(
                        `services:\n  web:\n    image: ${images.find((image) => image.startsWith("nginx:")) || images[0] || "nginx:alpine"}\n    ports:\n      - "8088:80"\n    restart: "no"\n`,
                      )
                    }
                  >
                    Example
                  </button>
                </div>
              </div>
              <label className="compose-editor-label">
                <span className="compose-visually-hidden">Compose YAML</span>
                <textarea
                  className="compose-editor"
                  value={compose}
                  onChange={(event) => changeCompose(event.target.value)}
                  placeholder={"services:\n  web:\n    image: nginx:alpine"}
                  spellCheck={false}
                  autoCapitalize="none"
                  autoCorrect="off"
                  wrap="off"
                  rows={13}
                />
              </label>
              <p className="container-create-help">
                Paste a standalone Compose file, up to 128 KiB. Use spaces for
                YAML indentation. Environment values must be explicit; use $$
                for variables evaluated inside a container.
              </p>
            </section>
            <p className="compose-scope-note">
              Local images only. Named/anonymous Docker volumes and project
              bridge networks are supported. Builds, host mounts, external
              files/resources and privileged options are not supported.
              Published ports default to 127.0.0.1 unless an IP is explicitly
              specified.
            </p>
            <label className="container-create-check">
              <input
                type="checkbox"
                checked={start}
                onChange={(event) => setStart(event.target.checked)}
              />
              Start services after creation
            </label>
            <button
              className="container-create-cancel compose-validate"
              type="button"
              disabled={available !== true || !!pending}
              onClick={() => void validate()}
            >
              {pending === "validate" ? (
                <RefreshCw size={14} className="compose-spin" />
              ) : (
                <Check size={14} />
              )}{" "}
              {pending === "validate"
                ? "Validating Compose…"
                : "Validate Compose"}
            </button>
            {available === null && (
              <p role="status" className="container-create-help">
                Checking Docker Compose…
              </p>
            )}
            {preview && (
              <section
                className="compose-preview"
                aria-label="Compose validation result"
              >
                <h3>
                  Valid configuration: {preview.services.length} service
                  {preview.services.length === 1 ? "" : "s"}
                </h3>
                <ul>
                  {preview.services.map((service) => (
                    <li key={service.name}>
                      <strong>{service.name}</strong>
                      <span>{service.image}</span>
                      {service.ports.map((port, index) => (
                        <code key={index}>{port}</code>
                      ))}
                    </li>
                  ))}
                </ul>
                {preview.volumes.length > 0 && (
                  <p>Project volumes: {preview.volumes.join(", ")}</p>
                )}
                {preview.warnings.map((warning, index) => (
                  <p className="container-create-help" key={index}>
                    {warning}
                  </p>
                ))}
              </section>
            )}
          </fieldset>
          {error && (
            <p role="alert" className="container-create-error">
              {error}
            </p>
          )}
          <footer>
            <button
              className="container-create-cancel"
              type="button"
              disabled={!!pending}
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              className="container-create-submit"
              type="submit"
              disabled={!preview || !!pending || available !== true}
            >
              {pending === "create"
                ? "Creating project…"
                : "Create Compose project"}
            </button>
          </footer>
        </form>
      )}
    </div>
  );
}
