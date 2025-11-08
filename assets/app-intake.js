// Minimal, robust Enterprise intake handler (no placeholders, no external deps)
(() => {
  const form = document.querySelector('form[data-worker][data-form]') || document.querySelector('form');
  if (!form) return;

  const submitBtn = form.querySelector('button[type="submit"], input[type="submit"]');
  const WORKER = (window.WORKER_URL || '').replace(/\/+$/,''); // e.g. https://lead-gateway.example.workers.dev
  const FORM = window.INTAKE_FORM_URL || '';                   // e.g. Google Form (prefill optional)

  function getFormJSON(f) {
    const entries = Array.from(new FormData(f).entries());
    const obj = {};
    for (const [k, v] of entries) obj[k] = String(v).trim();
    return obj;
  }

  async function tryWorkerPost(json) {
    if (!WORKER) return false;
    const url = `${WORKER}/lead`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(json),
    });
    return res.ok;
  }

  function openFormPage(json) {
    if (!FORM) return false;
    const u = new URL(FORM);
    // Best-effort pass-through; if your Form has entry IDs, map here.
    for (const [k, v] of Object.entries(json)) u.searchParams.set(k, v);
    window.open(u.toString(), '_blank', 'noopener');
    return true;
  }

  function mailtoFallback(json) {
    const body = encodeURIComponent(JSON.stringify(json, null, 2));
    const u = `mailto:sales@cg-alert.com?subject=Enterprise%20intake&body=${body}`;
    window.location.href = u;
    return true;
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Submitting…'; }

    const data = getFormJSON(form);
    // Force Enterprise defaults
    data.plan = 'enterprise';
    data.cadence = data.cadence || 'weekly';

    try {
      const ok = await tryWorkerPost(data);
      if (ok) {
        window.location.assign('/intake/thanks/');
        return;
      }
    } catch (_) {
      // swallow and fall through to FORM / mailto
    }

    if (openFormPage(data)) {
      window.location.assign('/intake/thanks/');
      return;
    }
    mailtoFallback(data);
  });
})();