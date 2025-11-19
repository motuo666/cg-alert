export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const { pathname } = url;

    // Simple health check
    if (pathname === "/" || pathname === "/health") {
      return new Response("ok", { status: 200 });
    }

    // Expect paths like /evidence/{vendor}/{key}/{timestamp}.html
    if (!pathname.startsWith("/evidence/")) {
      return new Response("not found", { status: 404 });
    }

    const key = pathname.replace(/^\/evidence\//, "");

    if (request.method === "PUT" || request.method === "POST") {
      // Optional API key guard
      const expected = (env.R2_API_KEY || "").trim();
      if (expected) {
        const given = (request.headers.get("x-api-key") || "").trim();
        if (!given || given !== expected) {
          return new Response("forbidden", { status: 403 });
        }
      }

      const body = await request.arrayBuffer();
      await env.EVIDENCE_BUCKET.put(key, body, {
        httpMetadata: {
          contentType: "text/html; charset=utf-8",
        },
      });

      const base = (env.PUBLIC_BASE_URL || "").trim();
      const urlBase = base || "";
      const publicUrl = urlBase
        ? urlBase.replace(/\/$/, "") + "/evidence/" + key
        : "";

      return new Response(
        JSON.stringify({ ok: true, key, url: publicUrl }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }

    if (request.method === "GET") {
      const obj = await env.EVIDENCE_BUCKET.get(key);
      if (!obj) {
        return new Response("not found", { status: 404 });
      }
      const headers = new Headers();
      headers.set(
        "content-type",
        (obj.httpMetadata && obj.httpMetadata.contentType) ||
          "text/html; charset=utf-8",
      );
      return new Response(obj.body, { status: 200, headers });
    }

    return new Response("method not allowed", { status: 405 });
  },
};
