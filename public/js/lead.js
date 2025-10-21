// Attach UTM + cg_lead_id and POST to /lead endpoint
(function(){
  function get(name) {
    const m = document.cookie.match(new RegExp('(^| )'+name+'=([^;]+)')); 
    return m ? decodeURIComponent(m[2]) : null;
  }
  function set(name, value, days) {
    const d = new Date();
    d.setTime(d.getTime() + (days*24*60*60*1000));
    document.cookie = name + "=" + encodeURIComponent(value) + ";path=/;samesite=lax;expires=" + d.toUTCString();
  }
  function qs(key) {
    const u = new URL(location.href);
    return u.searchParams.get(key) || "";
  }
  let lid = get("cg_lead_id");
  if (!lid) { lid = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now())); set("cg_lead_id", lid, 365); }

  const form = document.querySelector('form[data-lead-post="1"]');
  if (!form) return;

  form.addEventListener("submit", async (e) => {
    try {
      const email = (form.querySelector('input[name="email"]') || {}).value || "";
      const payload = {
        email,
        cg_lead_id: lid,
        utm_source: qs("utm_source"),
        utm_medium: qs("utm_medium"),
        utm_campaign: qs("utm_campaign"),
        utm_content: qs("utm_content"),
        utm_term: qs("utm_term"),
        referrer: document.referrer || "",
        landing_url: location.href,
      };
      const res = await fetch("/lead", { method:"POST", headers:{"content-type":"application/json"}, body: JSON.stringify(payload) });
      // ignore response; continue normal submit if needed
    } catch (err) {
      console.error("lead post failed", err);
    }
  }, { capture: true });
})();
