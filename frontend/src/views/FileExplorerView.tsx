import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
} from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  Download,
  Trash2,
  File,
  Folder,
  FolderOpen,
  Home,
  Link,
  LoaderCircle,
  RefreshCw,
  Search,
  Shield,
  Upload,
  X,
} from "lucide-react";
import { Capacitor } from "@capacitor/core";
import { getSession } from "../lib/auth";
import {
  downloadFile,
  deleteFile,
  fileSize,
  listFiles,
  uploadFile,
  type FileListing,
  type ServerFile,
} from "../lib/files";
import { T } from "../lib/tokens";
import type { ConfirmDialog } from "../lib/types";
import "../styles/files.css";
import FileViewer from "../components/FileViewer";

type Transfer = {
  id: number;
  name: string;
  path: string;
  percent: number;
  status: "queued" | "uploading" | "done" | "error" | "cancelled";
  error?: string;
};
const parentPath = (path: string) =>
  path.slice(0, path.lastIndexOf("/")) || "/";
const date = (value: string) => new Date(value).toLocaleString();
const message = (error: unknown) =>
  error instanceof Error ? error.message : "Unable to complete the operation";

export default function FileExplorerView({
  active,
  onConfirm,
}: {
  active: boolean;
  onConfirm: (dialog: ConfirmDialog) => void;
}) {
  const admin = getSession()?.user.role === "admin";
  const [path, setPath] = useState("/");
  const [pathInput, setPathInput] = useState("/");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [hidden, setHidden] = useState(false);
  const [sort, setSort] = useState("name");
  const [order, setOrder] = useState("asc");
  const [offset, setOffset] = useState(0);
  const [listing, setListing] = useState<FileListing | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [uploading, setUploading] = useState(false);
  const deletingRef = useRef(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [viewing, setViewing] = useState<ServerFile | null>(null);
  const [previous, setPrevious] = useState<string[]>([]);
  const picker = useRef<HTMLInputElement>(null);
  const uploadController = useRef<AbortController | null>(null);
  const nextId = useRef(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      uploadController.current?.abort();
    };
  }, []);
  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(search);
      setOffset(0);
    }, 250);
    return () => clearTimeout(timer);
  }, [search]);
  useEffect(() => {
    if (!admin || !active) return;
    const controller = new AbortController();
    setLoading(true);
    setError("");
    listFiles(
      { path, q: query, hidden, sort, order, offset },
      controller.signal,
    )
      .then((data) => {
        if (!controller.signal.aborted) {
          setListing(data);
          setPathInput(data.path);
        }
      })
      .catch((err: unknown) => {
        if (!controller.signal.aborted) setError(message(err));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [path, query, hidden, sort, order, offset, refresh, admin, active]);

  const navigate = useCallback(
    (destination: string) => {
      destination = `/${destination
        .split("/")
        .filter((part) => part && part !== ".")
        .join("/")}`;
      if (destination !== path) setPrevious((items) => [...items, path]);
      setPath(destination);
      setPathInput(destination);
      setOffset(0);
      setSearch("");
      setQuery("");
      setNotice("");
    },
    [path],
  );
  const back = () => {
    const destination = previous.at(-1);
    if (destination === undefined) return;
    setPrevious((items) => items.slice(0, -1));
    setPath(destination);
    setPathInput(destination);
    setOffset(0);
    setSearch("");
    setQuery("");
    setNotice("");
  };
  useEffect(() => {
    if (!active) return;
    const handleBack = () =>
      previous.length ? back() : navigate(parentPath(path));
    window.addEventListener("coreops-files-back", handleBack);
    return () => window.removeEventListener("coreops-files-back", handleBack);
  }, [active, path, previous, navigate]);
  useEffect(() => {
    if (!uploading) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [uploading]);
  const askDelete = (file: ServerFile) => {
    if (
      deletingRef.current ||
      loading ||
      uploading ||
      !file.version ||
      listing?.path !== path
    )
      return;
    onConfirm({
      title: "Delete file permanently?",
      message: `Server: ${listing.root}. File: ${file.path}. This permanently removes this file. There is no recycle bin.`,
      action: "Delete file",
      danger: true,
      requireConfirmation: true,
      onConfirm: () => {
        if (deletingRef.current) return;
        deletingRef.current = true;
        setDeleting(file.path);
        setNotice("");
        void deleteFile(file)
          .then(() => {
            if (mounted.current) {
              setListing((old) =>
                old
                  ? {
                      ...old,
                      entries: old.entries.filter((e) => e.path !== file.path),
                    }
                  : old,
              );
              setNotice(`Deleted ${file.path}`);
              setRefresh((v) => v + 1);
            }
          })
          .catch((e) => {
            if (mounted.current) setNotice(`Delete failed: ${message(e)}`);
          })
          .finally(() => {
            deletingRef.current = false;
            if (mounted.current) setDeleting(null);
          });
      },
    });
  };
  const startUpload = async (files: File[]) => {
    if (
      !files.length ||
      uploadController.current ||
      !listing ||
      loading ||
      error ||
      listing.path !== path
    )
      return;
    if (files.length > 100) {
      setNotice("Select up to 100 files at a time.");
      return;
    }
    const controller = new AbortController();
    uploadController.current = controller;
    const destination = listing.path;
    const batch = files.map((file) => ({
      id: ++nextId.current,
      name: file.name,
      path: destination,
      percent: 0,
      status: "queued" as const,
    }));
    setTransfers(batch);
    setUploading(true);
    setNotice("");
    const update = (id: number, value: Partial<Transfer>) => {
      if (mounted.current)
        setTransfers((items) =>
          items.map((item) => (item.id === id ? { ...item, ...value } : item)),
        );
    };
    try {
      for (let index = 0; index < files.length; index++) {
        const file = files[index],
          item = batch[index];
        if (controller.signal.aborted) {
          update(item.id, { status: "cancelled" });
          continue;
        }
        if (file.size > listing.maxUploadBytes) {
          update(item.id, {
            status: "error",
            error: `Exceeds the ${fileSize(listing.maxUploadBytes)} limit`,
          });
          continue;
        }
        update(item.id, { status: "uploading" });
        try {
          await uploadFile(file, destination, controller.signal, (percent) =>
            update(item.id, { percent }),
          );
          update(item.id, { status: "done", percent: 100 });
        } catch (err) {
          update(item.id, {
            status: controller.signal.aborted ? "cancelled" : "error",
            error: controller.signal.aborted ? undefined : message(err),
          });
        }
      }
    } finally {
      uploadController.current = null;
      if (mounted.current) {
        setUploading(false);
        setRefresh((value) => value + 1);
      }
    }
  };
  const startDownload = async (file: ServerFile) => {
    if (downloading) return;
    setDownloading(file.path);
    setNotice("");
    try {
      await downloadFile(file);
      if (mounted.current)
        setNotice(
          Capacitor.getPlatform() === "android"
            ? `Saved ${file.name}`
            : `Download started: ${file.name}`,
        );
    } catch (err) {
      if (mounted.current) setNotice(message(err));
    } finally {
      if (mounted.current) setDownloading(null);
    }
  };
  const drop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    const items = Array.from(event.dataTransfer.items);
    if (items.some((item) => item.webkitGetAsEntry?.()?.isDirectory)) {
      setNotice("Upload files individually; folder uploads are not supported.");
      return;
    }
    void startUpload(Array.from(event.dataTransfer.files));
  };
  const variables = {
    "--fe-bg": T.bg,
    "--fe-panel": T.raised,
    "--fe-hover": T.hover,
    "--fe-border": T.border,
    "--fe-text": T.text,
    "--fe-muted": T.textSub,
    "--fe-accent": T.accent,
    "--fe-error": T.red,
  } as CSSProperties;
  if (!admin)
    return (
      <section hidden={!active} className="files-view" style={variables}>
        <div className="files-state">
          <Shield size={32} />
          <h1>File explorer</h1>
          <p>Sign in as an administrator to access server files.</p>
        </div>
      </section>
    );
  const ready = !loading && !error && listing?.path === path;
  const parts = path.split("/").filter(Boolean);
  return (
    <section
      hidden={!active}
      data-file-explorer-active={active}
      data-can-go-back={path !== "/" || previous.length > 0}
      className={`files-view${dragging ? " files-dragging" : ""}`}
      style={variables}
      aria-label="Server file explorer"
      onDragOver={(event) => {
        event.preventDefault();
        if (ready && !uploading) setDragging(true);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null))
          setDragging(false);
      }}
      onDrop={drop}
    >
      <div className="files-heading">
        <div>
          <h1>
            <FolderOpen size={23} /> File explorer
          </h1>
          <p>Browse, transfer and delete files on your server.</p>
        </div>
        <button
          className="files-primary"
          onClick={() => picker.current?.click()}
          disabled={!ready || uploading}
        >
          <Upload size={17} /> Upload files
        </button>
        <input
          ref={picker}
          type="file"
          multiple
          hidden
          aria-label="Select files to upload"
          onChange={(event) => {
            void startUpload(Array.from(event.target.files || []));
            event.target.value = "";
          }}
        />
      </div>
      <div className="files-panel">
        <div className="files-location">
          <div className="files-navigation">
            <button
              onClick={back}
              disabled={!previous.length}
              title="Back"
              aria-label="Back"
            >
              <ArrowLeft size={18} />
            </button>
            <button
              onClick={() => navigate(parentPath(path))}
              disabled={path === "/"}
              title="Parent directory"
              aria-label="Parent directory"
            >
              <ArrowUp size={18} />
            </button>
            <button
              onClick={() => setRefresh((value) => value + 1)}
              disabled={loading}
              title="Refresh"
              aria-label="Refresh files"
            >
              <RefreshCw size={17} className={loading ? "files-spin" : ""} />
            </button>
          </div>
          <form
            className="files-path"
            onSubmit={(event) => {
              event.preventDefault();
              const value = pathInput.trim();
              if (value) navigate(value.startsWith("/") ? value : `/${value}`);
            }}
          >
            <label className="files-sr-only" htmlFor="files-path">
              Directory path relative to server root
            </label>
            <input
              id="files-path"
              value={pathInput}
              onChange={(event) => setPathInput(event.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
            <button
              type="submit"
              aria-label="Open directory"
              title="Open directory"
            >
              <ChevronRight size={18} />
            </button>
          </form>
        </div>
        <nav className="files-breadcrumbs" aria-label="Directory breadcrumbs">
          <button onClick={() => navigate("/")} aria-label="File root">
            <Home size={15} />
            <span>Root</span>
          </button>
          {parts.map((part, index) => (
            <span className="files-crumb" key={index}>
              <ChevronRight size={13} />
              <button
                aria-current={
                  index === parts.length - 1 ? "location" : undefined
                }
                onClick={() =>
                  navigate(`/${parts.slice(0, index + 1).join("/")}`)
                }
                title={part}
              >
                {part}
              </button>
            </span>
          ))}
        </nav>
        <div className="files-filters">
          <label className="files-search">
            <Search size={16} />
            <span className="files-sr-only">Search this directory</span>
            <input
              type="search"
              placeholder="Search this directory…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          <label className="files-hidden">
            <input
              type="checkbox"
              checked={hidden}
              onChange={(event) => {
                setHidden(event.target.checked);
                setOffset(0);
              }}
            />{" "}
            Hidden files
          </label>
          <label className="files-sort">
            <span className="files-sr-only">Sort by</span>
            <select
              value={sort}
              onChange={(event) => {
                setSort(event.target.value);
                setOffset(0);
              }}
            >
              <option value="name">Name</option>
              <option value="modified">Modified</option>
              <option value="size">Size</option>
            </select>
          </label>
          <button
            onClick={() => {
              setOrder((value) => (value === "asc" ? "desc" : "asc"));
              setOffset(0);
            }}
            aria-label={order === "asc" ? "Sort descending" : "Sort ascending"}
            title={order === "asc" ? "Sort descending" : "Sort ascending"}
          >
            {order === "asc" ? <ArrowDown size={17} /> : <ArrowUp size={17} />}
          </button>
        </div>
        <div className="files-content" aria-busy={loading}>
          {loading ? (
            <div className="files-state" role="status">
              <LoaderCircle className="files-spin" size={28} />
              <p>Loading files…</p>
            </div>
          ) : error ? (
            <div className="files-state" role="alert">
              <p className="files-error">{error}</p>
              <button onClick={() => setRefresh((value) => value + 1)}>
                Try again
              </button>
            </div>
          ) : listing?.entries.length === 0 ? (
            <div className="files-state">
              <FolderOpen size={36} />
              <h2>{query ? "No matching files" : "This folder is empty"}</h2>
              <p>
                {query
                  ? "Try another search or show hidden files."
                  : "Upload files here or drop them from your computer."}
              </p>
            </div>
          ) : (
            <>
              <div className="files-table-head" aria-hidden="true">
                <span>Name</span>
                <span>Size</span>
                <span>Modified</span>
                <span>Permissions</span>
                <span />
              </div>
              <ul className="files-list" aria-label="Files">
                {listing?.entries.map((file) => (
                  <li key={file.path} className="files-row">
                    <button
                      className="files-entry"
                      disabled={
                        file.kind !== "directory" && file.kind !== "file"
                      }
                      onClick={() =>
                        file.kind === "directory"
                          ? navigate(file.path)
                          : setViewing(file)
                      }
                      title={file.name}
                      aria-label={`${file.kind === "directory" ? "Open folder" : file.kind === "file" ? "View file" : file.kind}: ${file.name}`}
                    >
                      <span className={`files-icon files-icon-${file.kind}`}>
                        {file.kind === "directory" ? (
                          <Folder size={21} />
                        ) : file.kind === "symlink" ? (
                          <Link size={21} />
                        ) : (
                          <File size={21} />
                        )}
                      </span>
                      <span className="files-filename">
                        <span>{file.name}</span>
                        <small>
                          {file.kind === "file"
                            ? fileSize(file.size)
                            : file.kind === "directory"
                              ? "Folder"
                              : file.kind === "symlink"
                                ? "Symbolic link · unavailable"
                                : "Special file · unavailable"}
                          <span> · {date(file.modified)}</span>
                        </small>
                      </span>
                    </button>
                    <span className="files-size">
                      {file.kind === "file" ? fileSize(file.size) : "—"}
                    </span>
                    <time className="files-modified" dateTime={file.modified}>
                      {date(file.modified)}
                    </time>
                    <code className="files-mode" title={file.mode}>
                      {file.mode}
                    </code>
                    {file.kind === "directory" ? (
                      <button
                        onClick={() => navigate(file.path)}
                        aria-label={`Open ${file.name}`}
                      >
                        <ChevronRight size={18} />
                      </button>
                    ) : file.kind === "file" ? (
                      <div className="files-row-actions">
                        <button
                          disabled={!!downloading}
                          onClick={() => void startDownload(file)}
                          aria-label={`Save ${file.name}`}
                          title="Download"
                        >
                          {downloading === file.path ? (
                            <LoaderCircle size={18} className="files-spin" />
                          ) : (
                            <Download size={18} />
                          )}
                        </button>
                        <button
                          aria-label={`Delete ${file.name}`}
                          title={
                            file.version
                              ? "Delete file permanently"
                              : "Refresh listing or update the API to enable deletion"
                          }
                          disabled={
                            !!deleting ||
                            loading ||
                            uploading ||
                            !!error ||
                            !file.version
                          }
                          onClick={() => askDelete(file)}
                          style={{ color: T.red }}
                        >
                          {deleting === file.path ? (
                            <LoaderCircle size={18} className="files-spin" />
                          ) : (
                            <Trash2 size={18} />
                          )}
                        </button>
                      </div>
                    ) : (
                      <span />
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
        <div className="files-footer">
          <span>
            {!loading && !error && listing
              ? `${listing.total === 0 ? 0 : listing.offset + 1}–${Math.min(listing.offset + listing.entries.length, listing.total)} of ${listing.total} items`
              : "Server files"}
          </span>
          <div className="files-pagination">
            <button
              disabled={!ready || !offset}
              onClick={() => setOffset(Math.max(0, offset - 100))}
              aria-label="Previous page"
            >
              <ChevronLeft size={18} />
            </button>
            <button
              disabled={
                !ready ||
                !listing ||
                listing.offset + listing.entries.length >= listing.total
              }
              onClick={() => setOffset(offset + 100)}
              aria-label="Next page"
            >
              <ChevronRight size={18} />
            </button>
          </div>
        </div>
      </div>
      {listing && (
        <p className="files-root-note">
          Server root: <code>{listing.root}</code> · Upload limit:{" "}
          {fileSize(listing.maxUploadBytes)} per file. Existing files are
          preserved.
        </p>
      )}
      {notice && (
        <div className="files-notice" role="status">
          <span>{notice}</span>
          <button onClick={() => setNotice("")} aria-label="Dismiss message">
            <X size={17} />
          </button>
        </div>
      )}
      {!!transfers.length && (
        <section className="files-transfers" aria-label="Uploads">
          <div className="files-transfer-heading">
            <h2>{uploading ? "Uploading files" : "Upload results"}</h2>
            <button
              onClick={() =>
                uploading ? uploadController.current?.abort() : setTransfers([])
              }
            >
              {uploading ? "Cancel uploads" : "Dismiss"}
            </button>
          </div>
          <ul>
            {transfers.map((transfer) => (
              <li key={transfer.id}>
                <div className="files-transfer-label">
                  <strong>{transfer.name}</strong>
                  <span>
                    {transfer.status === "uploading"
                      ? transfer.percent === 100
                        ? "Saving…"
                        : `${transfer.percent}%`
                      : transfer.status === "done"
                        ? "Uploaded"
                        : transfer.status}
                  </span>
                </div>
                <small>To {transfer.path}</small>
                {transfer.status === "uploading" && (
                  <progress
                    value={transfer.percent}
                    max={100}
                    aria-label={`Uploading ${transfer.name}`}
                  />
                )}{" "}
                {transfer.error && (
                  <p className="files-error">{transfer.error}</p>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
      {viewing && active && (
        <FileViewer
          key={`${viewing.path}:${viewing.version}`}
          file={viewing}
          onClose={() => setViewing(null)}
          onDownload={() => void startDownload(viewing)}
          downloading={!!downloading}
        />
      )}
      {dragging && (
        <div className="files-drop-overlay">
          <Upload size={36} />
          <strong>Drop files to upload</strong>
          <span>To {path}</span>
        </div>
      )}
    </section>
  );
}
