// Simple Cloudflare KV REST helper (Node 20+)
const API = (accountId, namespaceId, token) => {
  const base = `https://api.cloudflare.com/client/v4/accounts/${accountId}/storage/kv/namespaces/${namespaceId}`;
  const headers = { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" };

  return {
    async list(prefix = "lead:", limit = 1000, cursor = undefined) {
      const qs = new URLSearchParams({ prefix, limit: String(limit) });
      if (cursor) qs.set("cursor", cursor);
      const res = await fetch(`${base}/keys?${qs.toString()}`, { headers });
      const j = await res.json();
      if (!j.success) throw new Error("KV list failed: " + JSON.stringify(j.errors || j));
      return j.result;
    },
    async get(key) {
      const res = await fetch(`${base}/values/${encodeURIComponent(key)}`, { headers: { "Authorization": `Bearer ${token}` } });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`KV get ${key} failed: ${res.status}`);
      return await res.text();
    },
    async put(key, value) {
      const res = await fetch(`${base}/values/${encodeURIComponent(key)}`, {
        method: "PUT",
        headers: { "Authorization": `Bearer ${token}`, "Content-Type": "text/plain" },
        body: typeof value === "string" ? value : JSON.stringify(value),
      });
      if (!res.ok) throw new Error(`KV put ${key} failed: ${res.status}`);
      return true;
    },
  };
};

export default API;
