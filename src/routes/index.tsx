import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { Moon, Sun, Clipboard, Loader2, Download, X, RefreshCw, Check } from "lucide-react";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import { extractVideoId } from "@/lib/youtube";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "ClipGrab — Minimal YouTube Downloader" },
      {
        name: "description",
        content:
          "Paste a YouTube link and download it in up to 4K or audio-only. Fast, minimal, no ads.",
      },
      { property: "og:title", content: "ClipGrab — Minimal YouTube Downloader" },
      {
        property: "og:description",
        content: "Paste a link, pick a quality, download. Nothing else.",
      },
    ],
  }),
  component: Index,
});

// ---------- types ----------
type Format = { quality: string; hasAudio: boolean; sizeEstimate: number | null };
type VideoInfo = {
  id: string;
  title: string;
  channel: string;
  duration: number | null;
  thumbnail: string;
  formats: Format[];
};
type QueueStatus = "queued" | "downloading" | "done" | "error";
type QueueItem = {
  id: string;
  url: string;
  title: string;
  thumbnail: string;
  quality: string;
  status: QueueStatus;
  progress: number;
  error?: string;
};

// ---------- theme ----------
function useTheme() {
  const [theme, setTheme] = useState<"light" | "dark">("light");
  useEffect(() => {
    const saved = localStorage.getItem("clipgrab-theme") as "light" | "dark" | null;
    const prefers = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const initial = saved ?? (prefers ? "dark" : "light");
    setTheme(initial);
    document.documentElement.classList.toggle("dark", initial === "dark");
  }, []);
  const toggle = () => {
    setTheme((prev) => {
      const next = prev === "dark" ? "light" : "dark";
      document.documentElement.classList.toggle("dark", next === "dark");
      localStorage.setItem("clipgrab-theme", next);
      return next;
    });
  };
  return { theme, toggle };
}

// ---------- error mapping ----------
const ERROR_MESSAGES: Record<string, string> = {
  invalid_youtube_url: "That doesn't look like a YouTube link.",
  invalid_input: "Invalid input.",
  private_video: "This video is private.",
  age_restricted: "This video is age-restricted.",
  video_unavailable: "This video is unavailable or has been removed.",
  sign_in_required: "YouTube blocked the extractor host.",
  extractor_ip_blocked: "YouTube blocked the extractor host. Try another host or proxy.",
  rate_limited: "Too many requests — slow down for a minute.",
  extraction_failed: "Couldn't extract this video.",
  network_error: "Network error — is the extractor reachable?",
  extractor_not_configured: "Extractor service isn't configured.",
  internal_error: "Something went wrong.",
};

const humanize = (key: string) => ERROR_MESSAGES[key] ?? key.replace(/_/g, " ");
const formatDuration = (s: number) => {
  if (!s) return "";
  const m = Math.floor(s / 60);
  const sec = String(Math.floor(s % 60)).padStart(2, "0");
  return `${m}:${sec}`;
};
const formatSize = (b: number | null) => {
  if (!b) return "";
  const mb = b / (1024 * 1024);
  return mb > 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb.toFixed(0)} MB`;
};

// ---------- queue reducer ----------
type QueueAction =
  | { type: "add"; item: QueueItem }
  | { type: "update"; id: string; patch: Partial<QueueItem> }
  | { type: "remove"; id: string };

function queueReducer(state: QueueItem[], action: QueueAction): QueueItem[] {
  switch (action.type) {
    case "add":
      return [...state, action.item];
    case "update":
      return state.map((it) => (it.id === action.id ? { ...it, ...action.patch } : it));
    case "remove":
      return state.filter((it) => it.id !== action.id);
  }
}

// ---------- main ----------
function Index() {
  const { theme, toggle } = useTheme();
  const [url, setUrl] = useState("");
  const [info, setInfo] = useState<VideoInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedQuality, setSelectedQuality] = useState<string | null>(null);
  const [clipboardHint, setClipboardHint] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [queue, dispatch] = useReducer(queueReducer, []);
  const abortRef = useRef<AbortController | null>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  }, []);

  // Auto-fetch on valid URL (debounced)
  useEffect(() => {
    const id = extractVideoId(url);
    if (!id) {
      setInfo(null);
      setError(null);
      return;
    }
    setError(null);
    setLoading(true);
    abortRef.current?.abort();
    const ctl = new AbortController();
    abortRef.current = ctl;
    const timer = setTimeout(async () => {
      try {
        const res = await fetch("/api/info", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ url }),
          signal: ctl.signal,
        });
        const data = await res.json();
        if (!res.ok) {
          setInfo(null);
          setError(humanize(data.error ?? "extraction_failed"));
        } else {
          setInfo(data as VideoInfo);
          const last = localStorage.getItem("clipgrab-quality");
          const available = (data as VideoInfo).formats.map((f) => f.quality);
          setSelectedQuality(
            last && available.includes(last) ? last : available[0] ?? null,
          );
        }
      } catch (e) {
        if ((e as Error).name !== "AbortError") setError(humanize("network_error"));
      } finally {
        setLoading(false);
      }
    }, 400);
    return () => {
      clearTimeout(timer);
      ctl.abort();
    };
  }, [url]);

  // Clipboard detection on mount
  useEffect(() => {
    (async () => {
      try {
        if (!navigator.clipboard?.readText) return;
        const text = await navigator.clipboard.readText();
        if (extractVideoId(text) && text !== url) setClipboardHint(text);
      } catch {
        /* clipboard blocked, ignore */
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const addToQueue = useCallback(() => {
    if (!info || !selectedQuality) return;
    const dupe = queue.find(
      (q) => q.url === url && q.quality === selectedQuality && q.status !== "error",
    );
    if (dupe) {
      showToast("Already in queue");
      return;
    }
    localStorage.setItem("clipgrab-quality", selectedQuality);
    const item: QueueItem = {
      id: `${info.id}-${selectedQuality}-${Date.now()}`,
      url,
      title: info.title,
      thumbnail: info.thumbnail,
      quality: selectedQuality,
      status: "queued",
      progress: 0,
    };
    dispatch({ type: "add", item });
  }, [info, selectedQuality, url, queue, showToast]);

  // Queue processor: one at a time
  const processingRef = useRef(false);
  useEffect(() => {
    if (processingRef.current) return;
    const next = queue.find((q) => q.status === "queued");
    if (!next) return;
    processingRef.current = true;

    (async () => {
      dispatch({ type: "update", id: next.id, patch: { status: "downloading", progress: 5 } });
      try {
        const res = await fetch("/api/download", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ url: next.url, quality: next.quality }),
        });
        if (!res.ok || !res.body) {
          const data = await res.json().catch(() => ({ error: "extraction_failed" }));
          dispatch({
            type: "update",
            id: next.id,
            patch: { status: "error", error: humanize(data.error ?? "extraction_failed") },
          });
          return;
        }

        const totalStr = res.headers.get("content-length");
        const total = totalStr ? Number(totalStr) : 0;
        const reader = res.body.getReader();
        const chunks: Uint8Array[] = [];
        let received = 0;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) {
            chunks.push(value);
            received += value.length;
            const pct = total ? Math.min(99, Math.round((received / total) * 100)) : 50;
            dispatch({ type: "update", id: next.id, patch: { progress: pct } });
          }
        }
        const blob = new Blob(chunks as BlobPart[], {
          type: res.headers.get("content-type") ?? "application/octet-stream",
        });
        const cd = res.headers.get("content-disposition") ?? "";
        const m = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/.exec(cd);
        const filename =
          (m && decodeURIComponent(m[1])) ??
          `${next.title.replace(/[^\w\-. ]+/g, "_").slice(0, 80)}.${
            next.quality === "audio" ? "m4a" : "mp4"
          }`;
        const objUrl = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = objUrl;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(objUrl), 1000);
        dispatch({ type: "update", id: next.id, patch: { status: "done", progress: 100 } });
      } catch {
        dispatch({
          type: "update",
          id: next.id,
          patch: { status: "error", error: humanize("network_error") },
        });
      } finally {
        processingRef.current = false;
      }
    })();
  }, [queue]);

  const isValid = useMemo(() => Boolean(extractVideoId(url)), [url]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <header className="mx-auto flex max-w-3xl items-center justify-between px-5 py-6">
        <div className="flex items-center gap-2">
          <div className="h-2.5 w-2.5 rounded-sm bg-primary" />
          <span className="text-sm font-semibold tracking-tight">ClipGrab</span>
        </div>
        <button
          type="button"
          onClick={toggle}
          aria-label="Toggle theme"
          className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
        >
          {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </button>
      </header>

      {/* Main */}
      <main className="mx-auto max-w-2xl px-5 pb-24 pt-8 sm:pt-16">
        <div className="text-center">
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            Download any YouTube video
          </h1>
          <p className="mt-3 text-sm text-muted-foreground">
            Paste a link. Pick a quality. Done.
          </p>
        </div>

        {/* Input */}
        <div className="mt-10">
          <div className="relative">
            <input
              type="url"
              inputMode="url"
              placeholder="https://youtube.com/watch?v=…"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              className="w-full rounded-xl border border-border bg-card px-5 py-4 pr-12 text-base outline-none transition-all placeholder:text-muted-foreground focus:border-primary focus:ring-4 focus:ring-primary/10"
              autoComplete="off"
              spellCheck={false}
            />
            {url && (
              <button
                type="button"
                onClick={() => setUrl("")}
                aria-label="Clear"
                className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          {/* Clipboard chip */}
          {clipboardHint && !url && (
            <button
              type="button"
              onClick={() => {
                setUrl(clipboardHint);
                setClipboardHint(null);
              }}
              className="mt-3 inline-flex items-center gap-2 rounded-full border border-border bg-secondary/60 px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            >
              <Clipboard className="h-3.5 w-3.5" />
              Paste detected link
            </button>
          )}

          {/* Hint / state */}
          <div className="mt-3 min-h-[1.25rem] text-center text-xs">
            {loading && (
              <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Fetching video…
              </span>
            )}
            {error && !loading && <span className="text-destructive">{error}</span>}
            {!loading && !error && url && !isValid && (
              <span className="text-muted-foreground">
                Only youtube.com, youtu.be, and Shorts links are supported.
              </span>
            )}
          </div>
        </div>

        {/* Preview card */}
        {info && (
          <div
            key={info.id}
            className="mt-6 overflow-hidden rounded-xl border border-border bg-card animate-in fade-in slide-in-from-bottom-2 duration-300"
          >
            <div className="flex flex-col sm:flex-row">
              <div className="relative aspect-video w-full flex-shrink-0 overflow-hidden bg-muted sm:w-52">
                {info.thumbnail && (
                  <img
                    src={info.thumbnail}
                    alt=""
                    className="h-full w-full object-cover"
                    loading="lazy"
                  />
                )}
                {info.duration ? (
                  <span className="absolute bottom-2 right-2 rounded bg-black/75 px-1.5 py-0.5 text-[10px] font-medium text-white">
                    {formatDuration(info.duration)}
                  </span>
                ) : null}
              </div>
              <div className="flex flex-1 flex-col gap-3 p-5">
                <div>
                  <h2 className="line-clamp-2 text-sm font-semibold leading-snug">
                    {info.title}
                  </h2>
                  <p className="mt-1 text-xs text-muted-foreground">{info.channel}</p>
                </div>

                <div className="flex flex-wrap gap-1.5">
                  {info.formats.map((f) => {
                    const isSelected = selectedQuality === f.quality;
                    return (
                      <button
                        key={f.quality}
                        type="button"
                        onClick={() => setSelectedQuality(f.quality)}
                        className={`rounded-md border px-2.5 py-1 text-xs font-medium transition-all ${
                          isSelected
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-border bg-background text-foreground hover:border-primary/40"
                        }`}
                      >
                        {f.quality === "audio" ? "Audio" : f.quality}
                        {f.sizeEstimate ? (
                          <span
                            className={`ml-1.5 text-[10px] ${
                              isSelected ? "text-primary-foreground/70" : "text-muted-foreground"
                            }`}
                          >
                            {formatSize(f.sizeEstimate)}
                          </span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>

                <button
                  type="button"
                  onClick={addToQueue}
                  disabled={!selectedQuality}
                  className="inline-flex items-center justify-center gap-2 rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-all hover:bg-primary/90 disabled:opacity-50"
                >
                  <Download className="h-4 w-4" />
                  Download
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Queue */}
        {queue.length > 0 && (
          <div className="mt-10 space-y-2">
            <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Downloads
            </h3>
            {queue.map((item) => (
              <QueueRow
                key={item.id}
                item={item}
                onRemove={() => dispatch({ type: "remove", id: item.id })}
                onRetry={() =>
                  dispatch({
                    type: "update",
                    id: item.id,
                    patch: { status: "queued", progress: 0, error: undefined },
                  })
                }
              />
            ))}
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="mx-auto max-w-2xl px-5 pb-10">
        <p className="text-center text-xs text-muted-foreground">
          For personal use only. Respect content owners' rights and YouTube's Terms of Service.
        </p>
      </footer>

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 rounded-md border border-border bg-card px-4 py-2 text-sm shadow-lg animate-in fade-in slide-in-from-bottom-2">
          {toast}
        </div>
      )}
    </div>
  );
}

function QueueRow({
  item,
  onRemove,
  onRetry,
}: {
  item: QueueItem;
  onRemove: () => void;
  onRetry: () => void;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-card p-3">
      <div className="h-12 w-20 flex-shrink-0 overflow-hidden rounded bg-muted">
        {item.thumbnail && (
          <img src={item.thumbnail} alt="" className="h-full w-full object-cover" loading="lazy" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{item.title}</p>
        <div className="mt-1 flex items-center gap-2">
          <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            {item.quality}
          </span>
          {item.status === "downloading" && (
            <div className="h-1 flex-1 overflow-hidden rounded-full bg-secondary">
              <div
                className="h-full bg-primary transition-all duration-200"
                style={{ width: `${item.progress}%` }}
              />
            </div>
          )}
          {item.status === "queued" && (
            <span className="text-xs text-muted-foreground">Queued</span>
          )}
          {item.status === "done" && (
            <span className="inline-flex items-center gap-1 text-xs text-primary">
              <Check className="h-3 w-3" /> Downloaded
            </span>
          )}
          {item.status === "error" && (
            <span className="truncate text-xs text-destructive">{item.error}</span>
          )}
        </div>
      </div>
      <div className="flex items-center gap-1">
        {item.status === "error" && (
          <button
            type="button"
            onClick={onRetry}
            aria-label="Retry"
            className="rounded-md p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        )}
        <button
          type="button"
          onClick={onRemove}
          aria-label="Remove"
          className="rounded-md p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
