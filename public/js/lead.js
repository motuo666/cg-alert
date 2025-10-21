/* CG Alert lead.js (覆盖版 2025-10-21)
 * 功能：
 * - 捕获所有 <form data-lead-post> 的提交，携带 UTM/首次触点/cg_lead_id 并 POST 给 Worker
 * - 支持多表单、跨域 Worker（data-lead-url 或 window.LEAD_GATEWAY），失败降级 sendBeacon
 * - 不阻塞原表单提交流程；自动把关键字段注入为隐藏输入（保底进表单目标）
 */
(function () {
  // ---------- 小工具 ----------
  const ONE_YEAR = 365 * 24 * 60 * 60 * 1000;

  function getCookie(name) {
    const m = document.cookie.match(new RegExp("(^| )" + name + "=([^;]+)"));
    return m ? decodeURIComponent(m[2]) : null;
  }
  function setCookie(name, value, days) {
    const d = new Date();
    d.setTime(d.getTime() + (days * 24 * 60 * 60 * 1000));
    const secure = location.protocol === "https:" ? ";secure" : "";
    document.cookie = name + "=" + encodeURIComponent(value) + ";path=/;samesite=lax" + secure + ";expires=" + d.toUTCString();
  }
  function qsAll() {
    const u = new URL(location.href);
    const p = u.searchParams;
    const o = {};
    p.forEach((v, k) => o[k] = v);
    return o;
  }
  function pick(obj, keys) {
    const out = {};
    keys.forEach(k => { if (obj[k] != null) out[k] = obj[k]; });
    return out;
  }
  function nowISO() { return new Date().toISOString(); }

  function normalizeEndpoint(raw) {
    if (!raw) return "/lead";
    try {
      const u = new URL(raw, location.origin);
      // 兼容传入基域或完整路径
      if (!u.pathname || u.pathname === "/") u.pathname = "/lead";
      if (!u.pathname.endsWith("/lead")) {
        // 若传的是其他路径（比如 /api），追加 /lead
        u.pathname = (u.pathname.replace(/\/+$/,"")) + "/lead";
      }
      return u.toString();
    } catch {
      // 相对路径
      return raw.endsWith("/lead") ? raw : (raw.replace(/\/+$/,"") + "/lead");
    }
  }

  // ---------- cg_lead_id & 触点 ----------
  let lid = getCookie("cg_lead_id");
  if (!lid) {
    lid = (crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now());
    setCookie("cg_lead_id", lid, 365);
  }

  // 首次触点持久化到 localStorage（first_*），供多页回流
  try {
    const ls = window.localStorage;
    if (!ls.getItem("cg_first_ts")) {
      ls.setItem("cg_first_ts", nowISO());
      ls.setItem("cg_first_referrer", document.referrer || "");
      ls.setItem("cg_first_landing", location.href);
      const all = qsAll();
      ["utm_source","utm_medium","utm_campaign","utm_content","utm_term","gclid","fbclid","msclkid","li_fat_id"].forEach(k=>{
        if (all[k]) ls.setItem("cg_first_"+k, all[k]);
      });
    }
  } catch (_) {}

  // ---------- 选择 Worker 终点 ----------
  const scriptEl = document.currentScript;
  const rawEndpoint = (scriptEl && scriptEl.dataset && scriptEl.dataset.leadUrl)
    || (window.LEAD_GATEWAY)
    || "/lead";
  const ENDPOINT = normalizeEndpoint(rawEndpoint);

  // ---------- 邮箱字段探测 ----------
  function findEmailInput(form) {
    // 优先 type=email，其次 name 包含 email（不区分大小写）
    let el = form.querySelector('input[type="email"]');
    if (el) return el;
    el = form.querySelector('input[name="email" i], input[name="Email"], input[name*="mail" i]');
    return el || null;
  }

  // ---------- 注入隐藏字段（保底入表单） ----------
  function ensureHidden(form, name, value) {
    if (!value) return;
    let el = form.querySelector('input[type="hidden"][name="'+name+'"]');
    if (!el) {
      el = document.createElement("input");
      el.type = "hidden"; el.name = name;
      form.appendChild(el);
    }
    el.value = value;
  }

  // ---------- 监听所有 data-lead-post 表单 ----------
  const forms = Array.from(document.querySelectorAll('form[data-lead-post]'));
  if (!forms.length) return;

  forms.forEach((form) => {
    let posted = false;

    form.addEventListener("submit", (e) => {
      // 不阻塞原提交；仅做并行上报
      if (posted) return;
      posted = true;
      try {
        const emailEl = findEmailInput(form);
        const email = (emailEl && (emailEl.value || "").trim()) || "";

        // 采集 UTM（last touch）
        const all = qsAll();
        const utm = pick(all, ["utm_source","utm_medium","utm_campaign","utm_content","utm_term","gclid","fbclid","msclkid","li_fat_id"]);

        // 组装 payload
        const payload = {
          email,
          cg_lead_id: lid,
          ...utm,
          referrer: document.referrer || "",
          landing_url: location.href,
          ts: nowISO()
        };

        // 保底把关键字段塞进表单（即使 Worker 挂了也能随表单流走）
        ensureHidden(form, "cg_lead_id", lid);
        Object.entries(utm).forEach(([k,v]) => ensureHidden(form, k, v));
        ensureHidden(form, "referrer", document.referrer || "");
        ensureHidden(form, "landing_url", location.href);

        // 并行上报，不 await
        postLead(ENDPOINT, payload).catch(() => {});
        // 触发一个自定义事件，方便你后续埋点/AB
        document.dispatchEvent(new CustomEvent("cg:lead:posted", { detail: { email, lid, endpoint: ENDPOINT }}));
      } catch (err) {
        console && console.warn && console.warn("[lead.js] submit hook error", err);
      }
    }, { capture: true });
  });

  // ---------- 上报（带超时与降级） ----------
  function postLead(url, json) {
    // 1) fetch 带 1500ms 超时
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 1500);
    return fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(json),
      mode: "cors",
      keepalive: true,
      signal: ac.signal
    }).then(r => { clearTimeout(t); return r; })
    .catch(err => {
      clearTimeout(t);
      // 2) 降级 sendBeacon（部分浏览器仅支持 text/plain）
      try {
        const blob = new Blob([JSON.stringify(json)], { type: "text/plain" });
        if (navigator.sendBeacon) navigator.sendBeacon(url, blob);
      } catch (_) {}
      throw err;
    });
  }
})();
