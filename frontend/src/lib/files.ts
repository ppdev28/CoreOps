import { Capacitor, registerPlugin } from "@capacitor/core";
import { getAuthToken, setSession } from "./auth";
import { getApiBase } from "./api";

export interface ServerFile {
  name: string;
  path: string;
  kind: "directory" | "file" | "symlink" | "special";
  size: number;
  modified: string;
  mode: string;
  version?: string;
}
export interface FileListing {
  path: string;
  root: string;
  entries: ServerFile[];
  total: number;
  offset: number;
  limit: number;
  maxUploadBytes: number;
}
export interface FileQuery {
  path: string;
  q: string;
  hidden: boolean;
  sort: string;
  order: string;
  offset: number;
}
const NativeFiles = registerPlugin<{
  saveDownload(options: { url: string; name: string }): Promise<void>;
}>("CoreOpsFiles");

function authHeaders(): HeadersInit {
  const token = getAuthToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}
async function jsonRequest<T>(path: string, init: RequestInit): Promise<T> {
  const response = await fetch(`${getApiBase()}${path}`, {
    ...init,
    headers: { ...authHeaders(), ...init.headers },
  });
  if (response.status === 401) setSession(null);
  const body = await response.json().catch(() => null);
  if (!response.ok)
    throw new Error(body?.error || `Request failed (${response.status})`);
  if (!body) throw new Error("Invalid response from the CoreOps API");
  return body as T;
}
export function listFiles(
  query: FileQuery,
  signal: AbortSignal,
): Promise<FileListing> {
  const params = new URLSearchParams({
    ...query,
    hidden: String(query.hidden),
    offset: String(query.offset),
    limit: "100",
  });
  return jsonRequest(`/files?${params}`, { signal });
}

// Send the File itself, not a base64 string or a buffered multipart body. XHR
// supplies upload progress on mobile browsers as well as desktop browsers.
export function uploadFile(
  file: File,
  path: string,
  signal: AbortSignal,
  onProgress: (percent: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const abort = () => xhr.abort();
    const cleanup = () => signal.removeEventListener("abort", abort);
    xhr.open(
      "POST",
      `${getApiBase()}/files/upload?${new URLSearchParams({ path, name: file.name })}`,
    );
    const token = getAuthToken();
    if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.setRequestHeader("Content-Type", "application/octet-stream");
    // The server controls the transfer deadline, including configured overrides.
    xhr.timeout = 0;
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable)
        onProgress(Math.round((event.loaded / event.total) * 100));
    };
    xhr.onload = () => {
      cleanup();
      if (xhr.status === 401) setSession(null);
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
        return;
      }
      let message = `Upload failed (${xhr.status})`;
      try {
        message = JSON.parse(xhr.responseText).error || message;
      } catch {
        /* Proxy may return HTML. */
      }
      reject(new Error(message));
    };
    xhr.onerror = () => {
      cleanup();
      reject(
        new Error(
          "Connection lost. Check the destination before retrying the upload.",
        ),
      );
    };
    xhr.ontimeout = () => {
      cleanup();
      reject(
        new Error("Upload timed out. Check the destination before retrying."),
      );
    };
    xhr.onabort = () => {
      cleanup();
      reject(new DOMException("Upload cancelled", "AbortError"));
    };
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) {
      cleanup();
      reject(new DOMException("Upload cancelled", "AbortError"));
      return;
    }
    xhr.send(file);
  });
}
export async function downloadFile(file: ServerFile): Promise<void> {
  const { ticket } = await jsonRequest<{ ticket: string }>(
    "/files/download-ticket",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: file.path }),
    },
  );
  const url = new URL(
    `${getApiBase()}/files/download?${new URLSearchParams({ ticket })}`,
    window.location.href,
  ).href;
  if (Capacitor.getPlatform() === "android") {
    await NativeFiles.saveDownload({ url, name: file.name });
    return;
  }
  const link = document.createElement("a");
  link.href = url;
  link.download = file.name;
  link.referrerPolicy = "no-referrer";
  document.body.appendChild(link);
  link.click();
  link.remove();
}
export function fileSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const unit = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), 4);
  return `${(bytes / 1024 ** unit).toLocaleString(undefined, { maximumFractionDigits: 1 })} ${["B", "KiB", "MiB", "GiB", "TiB"][unit]}`;
}

export async function deleteFile(file: ServerFile): Promise<void> {
  const result = await jsonRequest<{ ok: boolean; path: string }>("/files", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: file.path, version: file.version }),
  });
  if (result.ok !== true || result.path !== file.path)
    throw new Error(
      "Invalid deletion result. Refresh the folder to check its actual state.",
    );
}
