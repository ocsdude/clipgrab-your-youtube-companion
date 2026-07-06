import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { canonicalYouTubeUrl } from "@/lib/youtube";

const Body = z.object({
  url: z.string().min(5).max(500),
  quality: z.enum(["2160p", "1440p", "1080p", "720p", "audio"]),
});

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

export const Route = createFileRoute("/api/download")({
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

        let upstream: Response;
        try {
          upstream = await fetch(`${base.replace(/\/$/, "")}/download`, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ url, quality: parsed.quality }),
          });
        } catch {
          return Response.json({ error: "network_error" }, { status: 502 });
        }

        if (!upstream.ok) {
          const text = await upstream.text();
          let key = "extraction_failed";
          try {
            key = (JSON.parse(text) as { detail?: string }).detail ?? key;
          } catch {}
          if (key === "sign_in_required") key = "extractor_ip_blocked";
          return Response.json({ error: key }, { status: upstream.status });
        }

        const headers = new Headers();
        const ct = upstream.headers.get("content-type");
        const cd = upstream.headers.get("content-disposition");
        const cl = upstream.headers.get("content-length");
        if (ct) headers.set("content-type", ct);
        if (cd) headers.set("content-disposition", cd);
        if (cl) headers.set("content-length", cl);
        headers.set("cache-control", "no-store");

        return new Response(upstream.body, { status: 200, headers });
      },
    },
  },
});
