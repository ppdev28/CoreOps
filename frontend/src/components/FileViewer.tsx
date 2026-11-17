import { useEffect, useRef, useState } from "react";
import { Copy, Download, FileText, LoaderCircle, X } from "lucide-react";
import {
  previewFile,
  fileSize,
  type FilePreview,
  type ServerFile,
} from "../lib/files";

export default function FileViewer({
  file,
  onClose,
  onDownload,
  downloading,
}: {
  file: ServerFile;
  onClose: () => void;
  onDownload: () => void;
  downloading: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [preview, setPreview] = useState<FilePreview | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [wrap, setWrap] = useState(true);
  const [imageURL, setImageURL] = useState("");
  useEffect(() => {
    const element = dialog.current;
    const opener =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    element?.showModal();
    return () => {
      element?.close();
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void previewFile(file, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setPreview(data);
      })
      .catch((e: unknown) => {
        if (!controller.signal.aborted)
          setError(
            e instanceof Error ? e.message : "Unable to preview this file.",
          );
      });
    return () => controller.abort();
  }, [file]);
  useEffect(() => {
    if (
      preview?.kind !== "image" ||
      !["image/png", "image/jpeg", "image/gif", "image/webp"].includes(
        preview.mediaType ?? "",
      )
    )
      return;
    const bytes = Uint8Array.from(atob(preview.content ?? ""), (c) =>
      c.charCodeAt(0),
    );
    const url = URL.createObjectURL(
      new Blob([bytes], { type: preview.mediaType }),
    );
    setImageURL(url);
    return () => URL.revokeObjectURL(url);
  }, [preview]);
  return (
    <dialog
      ref={dialog}
      className="files-viewer"
      aria-labelledby="file-viewer-title"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="files-viewer-panel">
        <header>
          <FileText size={20} />
          <div>
            <h2 id="file-viewer-title">{file.name}</h2>
            <p>
              {file.path} · {fileSize(preview?.size ?? file.size)} · Read only
            </p>
          </div>
          <button
            type="button"
            aria-label="Close file viewer"
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </header>
        <div className="files-viewer-tools">
          <button type="button" disabled={downloading} onClick={onDownload}>
            <Download size={16} /> Download
          </button>
          {preview?.kind === "text" && (
            <>
              <label>
                <input
                  type="checkbox"
                  checked={wrap}
                  onChange={(e) => setWrap(e.target.checked)}
                />{" "}
                Wrap lines
              </label>
              <button
                type="button"
                onClick={() => {
                  if (!navigator.clipboard) {
                    setNotice(
                      "Select the text and use your browser’s Copy command.",
                    );
                    return;
                  }
                  void navigator.clipboard
                    .writeText(preview.content ?? "")
                    .then(
                      () => setNotice("Visible text copied."),
                      () =>
                        setNotice(
                          "Select the text and use your browser’s Copy command.",
                        ),
                    );
                }}
              >
                <Copy size={16} /> Copy text
              </button>
            </>
          )}
        </div>
        {notice && (
          <p className="files-viewer-note" role="status">
            {notice}
          </p>
        )}
        {preview?.kind === "text" && preview.truncated && (
          <p className="files-viewer-note" role="status">
            Showing the first 256 KiB. Download the file to read all of it.
          </p>
        )}
        <div className="files-viewer-content">
          {error ? (
            <div className="files-state" role="alert">
              <p className="files-error">{error}</p>
            </div>
          ) : !preview ? (
            <div className="files-state" role="status">
              <LoaderCircle className="files-spin" size={28} />
              Loading preview…
            </div>
          ) : preview.kind === "text" ? (
            <pre data-wrap={wrap} tabIndex={0} aria-label="File contents">
              <code>{preview.content || ""}</code>
            </pre>
          ) : preview.kind === "image" && imageURL ? (
            <img
              src={imageURL}
              alt={file.name}
              onError={() =>
                setError(
                  "This image could not be decoded. Download it to open locally.",
                )
              }
            />
          ) : preview.kind === "unavailable" ? (
            <div className="files-state">
              <FileText size={32} />
              <h3>Preview unavailable</h3>
              <p>{preview.reason}</p>
            </div>
          ) : null}
        </div>
      </div>
    </dialog>
  );
}
