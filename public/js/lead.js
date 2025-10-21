// public/js/lead.js (overlay 2025-10-21)
// Purpose: ensure every email CTA posts UTM + cg_lead_id to /lead, without breaking original submit.
// - Auto-binds to any <form> that has an <input type="email"> (no attribute required)
// - Still honors data-lead-post="1" if present (for explicit forms)
// - Sets/reads cookie cg_lead_id
// - Gracefully no-ops on errors
(function(){
  function getCookie(name) {
    const m = document.cookie.match(new RegExp('(^| )'+name+'=([^;]+)'));
    return m ? decodeURIComponent(m[2]) : null;
  }
  function setCookie(name, value, days) {
    const d = new Date(); d.setTime(d.getTime() + (days*24*60*60*1000));
    document.cookie = name + "=" + encodeURIComponent(value) + ";path=/;samesite=lax;expires=" + d.toUTCString();
  }
  function qs(key) {
    try { return new URL(location.href).searchParams.get(key) || ""; } catch(e){ return ""; }
  }
  function uuid() {
    try { return crypto.randomUUID(); } catch(e) { return String(Date.now()) + Math.random().toString(16).slice(2); }
  }

  var lid = getCookie("cg_lead_id");
  if (!lid) { lid = uuid(); setCookie("cg_lead_id", lid, 365); }

  function attach(form) {
    if (form.__leadAttached) return;
    form.__leadAttached = true;

    form.addEventListener("submit", function(e){
      try {
        var emailEl = form.querySelector('input[type="email"], input[name="email"], input[name="Email"], input[name="e"]');
        var email = emailEl ? (emailEl.value || "").trim() : "";
        if (!email) return; // nothing to do

        var payload = {
          email: email,
          cg_lead_id: lid,
          utm_source: qs("utm_source"),
          utm_medium: qs("utm_medium"),
          utm_campaign: qs("utm_campaign"),
          utm_content: qs("utm_content"),
          utm_term: qs("utm_term"),
          referrer: document.referrer || "",
          landing_url: location.href
        };
        fetch("/lead", {
          method: "POST",
          headers: {"content-type":"application/json"},
          body: JSON.stringify(payload)
        }).catch(function(err){ /* swallow */ });
      } catch(err) { /* swallow */ }
    }, { capture: true });
  }

  function init(){
    var forms = Array.from(document.querySelectorAll('form'));
    forms.forEach(function(f){
      var hasEmail = !!f.querySelector('input[type="email"], input[name="email"], input[name="Email"], input[name="e"]');
      var explicit = f.hasAttribute("data-lead-post");
      if (hasEmail || explicit) attach(f);
    });
  }

  if (document.readyState === "complete" || document.readyState === "interactive") {
    init();
  } else {
    document.addEventListener("DOMContentLoaded", init);
  }

  // Export minimal helpers for case pages to read lid
  window.__cgLead = {
    getLid: function(){ return lid; }
  };
})();
