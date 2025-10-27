export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Simple health check
    if (request.method === "GET" && url.pathname === "/healthz") {
      return new Response("ok", { status: 200 });
    }

    // Intake form submissions: /intake (POST)
    if (url.pathname === "/intake" && request.method === "POST") {
      const formData = await request.formData();
      const email = (formData.get("email") || "").toLowerCase();
      const company = formData.get("company") || "";
      const message = formData.get("message") || "";
      const ts = new Date().toISOString();

      const payload = JSON.stringify({
        email,
        company,
        message,
        timestamp: ts
      });

      try {
        await env.CGALERT_KV.put(`intake:${ts}:${email}`, payload);
      } catch (e) {
        // swallow to avoid throwing
      }

      return new Response("received", { status: 200 });
    }

    // Unsubscribe handler: /unsubscribe (POST)
    if (url.pathname === "/unsubscribe" && request.method === "POST") {
      const formData = await request.formData();
      const email = (formData.get("email") || "").toLowerCase();
      const ts = new Date().toISOString();
      const payload = JSON.stringify({
        email,
        timestamp: ts,
        source: "worker"
      });

      try {
        await env.CGALERT_KV.put(`unsub:${ts}:${email}`, payload);
      } catch (e) {
        // swallow
      }

      return new Response("unsubscribed", { status: 200 });
    }

    // fallback
    return new Response("CG Alert lead-gateway online", { status: 200 });
  }
};
