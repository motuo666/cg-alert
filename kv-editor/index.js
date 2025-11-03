export default {
  async fetch(request, env, ctx) {
    const auth = request.headers.get("authorization") || "";
    if (!(await basicAuthOk(auth, env))) {
      return new Response("Unauthorized", {
        status: 401,
        headers: { "WWW-Authenticate": 'Basic realm="CG Alert KV Editor"' },
      });
    }
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/,"") || "/";
    if (path === "/") return htmlPage();
    if (path === "/api/load" && request.method === "GET") return apiLoad(env);
    if (path === "/api/save" && request.method === "POST") return apiSave(request, env);
    if (path === "/api/ping") return json({ ok: true });
    return new Response("Not found", { status: 404 });
  }
};

async function basicAuthOk(authHeader, env) {
  if (!authHeader.startsWith("Basic ")) return false;
  try {
    const dec = atob(authHeader.slice(6));
    const [u, p] = dec.split(":", 2);
    return u === (await env.ADMIN_USER) && p === (await env.ADMIN_PASS);
  } catch { return false; }
}

function json(obj, status=200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}

async function apiLoad(env) {
  const keys = ["region_filter.json", "persona_rules.json", "blacklist.txt"];
  const out = {};
  for (const k of keys) out[k] = (await env.FILTERS.get(k)) || defaultValue(k);
  return json(out);
}

function defaultValue(k) {
  if (k === "region_filter.json") {
    return JSON.stringify({
      "mode": "allow",
      "tld_allow": ["com","io","ai","app","co","dev","net","org"],
      "tld_deny": ["ru","cn","ir","pk"],
      "domain_allow_keywords": ["cloud","data","saas","dev","app","ops","security","auth","log","status","legal"],
      "domain_deny_keywords": ["blog","docs","support","help","community","statuspage.io"]
    }, null, 2);
  }
  if (k === "persona_rules.json") {
    return JSON.stringify({
      "mode": "any",
      "include_keywords": ["compliance","security","privacy","risk","vendor","subprocessor","dpa","terms","pricing","plans","sla"],
      "exclude_keywords": ["careers","jobs","press","brand","cdn","blog"]
    }, null, 2);
  }
  return "# blacklist.txt\n# One domain per line. Supports *.example.com suffix.\n";
}

async function apiSave(request, env) {
  const ctype = request.headers.get("content-type") || "";
  let payload;
  if (ctype.includes("application/json")) payload = await request.json();
  else {
    const form = await request.formData();
    payload = {
      "region_filter.json": form.get("region_filter.json"),
      "persona_rules.json": form.get("persona_rules.json"),
      "blacklist.txt": form.get("blacklist.txt")
    };
  }
  try { JSON.parse(payload["region_filter.json"]); } catch { return json({ ok:false, error:"region_filter.json 无法解析为 JSON" }, 400); }
  try { JSON.parse(payload["persona_rules.json"]); } catch { return json({ ok:false, error:"persona_rules.json 无法解析为 JSON" }, 400); }

  await env.FILTERS.put("region_filter.json", payload["region_filter.json"]);
  await env.FILTERS.put("persona_rules.json", payload["persona_rules.json"]);
  await env.FILTERS.put("blacklist.txt", payload["blacklist.txt"] || "");

  let dispatched = false;
  if ((env.ENABLE_DISPATCH || "false").toString() === "true") {
    const repo = env.GH_REPO;         // e.g. "yourname/cg-alert"
    const token = await env.GH_TOKEN; // Worker secret
    if (repo && token) {
      try {
        // 1) Kick KV Sync in repo (repository_dispatch: kv_sync_kick)
        const r1 = await fetch(`https://api.github.com/repos/${repo}/dispatches`, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${token}`,
            "Accept": "application/vnd.github+json",
            "content-type": "application/json"
          },
          body: JSON.stringify({ event_type: "kv_sync_kick" })
        });
        // 2) Let repo chain kick Autopilot after sync (kv-filters-sync.yml will do)
        dispatched = r1.ok;
      } catch (e) {}
    }
  }

  return json({ ok: true, dispatched });
}

function htmlPage() {
  const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>CG Alert — KV Filters Editor</title>
<meta name="robots" content="noindex,nofollow">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; form-action 'self'; base-uri 'none'">
<style>body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;margin:0;background:#0b1020;color:#f2f5ff}header{padding:20px 16px;background:#0f1530;display:flex;align-items:center;gap:10px;position:sticky;top:0;border-bottom:1px solid #223}.title{font-size:18px;font-weight:700}main{max-width:1100px;margin:20px auto;padding:0 16px 40px}.card{background:#121933;border:1px solid #26314a;border-radius:16px;padding:16px 16px 12px;margin-bottom:18px;box-shadow:0 2px 14px rgba(0,0,0,.25)}h2{margin:0 0 8px;font-size:16px}textarea{width:100%;height:260px;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,'Liberation Mono','Courier New',monospace;font-size:12.5px;background:#0b1125;color:#e5e9ff;border:1px solid #2c3754;border-radius:10px;padding:10px;outline:none}.row{display:grid;grid-template-columns:1fr;gap:12px}.actions{display:flex;gap:10px;margin-top:10px}button{border:1px solid #2e7de9;background:#1a47a8;color:#fff;padding:10px 14px;border-radius:12px;cursor:pointer;font-weight:600}button.secondary{border-color:#3d455c;background:#1b233a}.hint{opacity:.8;font-size:12px}.ok{color:#6ee7a8}.err{color:#fca5a5}</style>
<header><div class="title">KV Filters Editor</div><div class="hint">保存后可选触发：KV Sync → Autopilot</div></header>
<main>
  <div id="msg" class="card hint">加载中...</div>
  <form id="f" class="card">
    <h2>region_filter.json</h2>
    <div class="row"><textarea name="region_filter.json" id="region"></textarea></div>
    <div class="hint">TLD 白/黑名单 + 关键词过滤（JSON）</div>
  </form>
  <div class="card">
    <h2>persona_rules.json</h2>
    <div class="row"><textarea name="persona_rules.json" id="persona"></textarea></div>
    <div class="hint">包含/排除关键词（JSON）</div>
  </div>
  <div class="card">
    <h2>blacklist.txt</h2>
    <div class="row"><textarea name="blacklist.txt" id="blacklist"></textarea></div>
    <div class="hint">一行一个域名；支持 *.example.com</div>
    <div class="actions">
      <button type="button" id="save">保存</button>
      <button type="button" class="secondary" id="reload">重载</button>
    </div>
  </div>
</main>
<script>
  const msg = (s, ok=false)=>{ const el=document.getElementById('msg'); el.innerHTML = ok? '<span class="ok">✅ '+s+'</span>' : '<span class="err">⚠ '+s+'</span>'; };
  const load = async ()=>{
    try{
      const r = await fetch('/api/load'); const j = await r.json();
      region.value = j['region_filter.json'] || ''; persona.value = j['persona_rules.json'] || ''; blacklist.value = j['blacklist.txt'] || '';
      msg('已加载，编辑后点“保存”', true);
    }catch(e){ msg('加载失败：'+e); }
  };
  const save = async ()=>{
    try{
      const body = { 'region_filter.json': region.value, 'persona_rules.json': persona.value, 'blacklist.txt': blacklist.value };
      const r = await fetch('/api/save', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify(body)});
      const j = await r.json();
      if(j.ok){ msg('已保存到 KV；如开启自动触发，将立即发送 KV Sync 事件', true); } else { msg('保存失败：'+(j.error||'未知错误')); }
    }catch(e){ msg('保存失败：'+e); }
  };
  saveBtnInit(); function saveBtnInit(){ const s=document.getElementById('save'); s.onclick=save; document.getElementById('reload').onclick=load; }
  load();
</script>