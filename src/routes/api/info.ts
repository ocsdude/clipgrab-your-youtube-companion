import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { canonicalYouTubeUrl } from "@/lib/youtube";

const Body = z.object({ url: z.string().min(5).max(500) });
const FALLBACK_FORMATS = [
  { quality: "720p", hasAudio: true, sizeEstimate: null },
  { quality: "audio", hasAudio: true, sizeEstimate: null },
];

// Best-effort in-memory per-IP rate limit. Workers are stateless across
// isolates so this only catches bursts within a single instance.
const HITS = new Map<string, number[]>();
const WINDOW_MS = 60_000;
const MAX = 10;

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const arr = (HITS.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  if (arr.length >= MAX) {
    HITS.set(ip, arr);
    return true;
  }
  arr.push(now);
  HITS.set(ip, arr);
  return false;
}

async function fallbackInfo(url: string) {
  const id = new URL(url).searchParams.get("v") ?? "video";
  try {
    const res = await fetch(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`,
      { headers: { accept: "application/json" } },
    );
    if (res.ok) {
      const data = (await res.json()) as {
        title?: string;
        author_name?: string;
        thumbnail_url?: string;
      };
      return Response.json({
        id,
        title: data.title ?? "YouTube video",
        channel: data.author_name ?? "YouTube",
        duration: null,
        thumbnail: data.thumbnail_url ?? `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
        formats: FALLBACK_FORMATS,
        limited: true,
      });
    }
  } catch {}

  return Response.json({
    id,
    title: "YouTube video",
    channel: "YouTube",
    duration: null,
    thumbnail: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
    formats: FALLBACK_FORMATS,
    limited: true,
  });
}

export const Route = createFileRoute("/api/info")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const ip =
          request.headers.get("cf-connecting-ip") ??
          request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
          "unknown";
        if (rateLimited(ip)) {
          return Response.json({ error: "rate_limited" }, { status: 429 });
        }

        let parsed;
        try {
          parsed = Body.parse(await request.json());
        } catch {
          return Response.json({ error: "invalid_input" }, { status: 400 });
        }

        const url = canonicalYouTubeUrl(parsed.url);
        if (!url) return Response.json({ error: "invalid_youtube_url" }, { status: 400 });

        const base = process.env.EXTRACTOR_URL;
        const token = process.env.EXTRACTOR_TOKEN;
        if (!base || !token) {
          return Response.json({ error: "extractor_not_configured" }, { status: 500 });
        }

        try {
          const res = await fetch(`${base.replace(/\/$/, "")}/info`, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ url }),
          });
          const text = await res.text();
          if (!res.ok) {
            let key = "extraction_failed";
            try {
              key = (JSON.parse(text) as { detail?: string }).detail ?? key;
            } catch {}
            if (key === "sign_in_required") return fallbackInfo(url);
            return Response.json({ error: key }, { status: res.status });
          }
          return new Response(text, {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        } catch {
          return Response.json({ error: "network_error" }, { status: 502 });
        }
      },
    },
  },
});
