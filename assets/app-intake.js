/* Intake form JS: no mailto fallback, strict fetch only */
(() => {
  // Block any mailto anchors just in case
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[href^="mailto:"]');
    if (a) {
      e.preventDefault();
      e.stopPropagation();
      alert('Email compose is disabled on this page.');
    }
  }, { capture: true });

  const form = document.querySelector('form#intake');
  if (!form) return;

  /** Endpoint preferences */
  const WORKER_URL = (window.WORKER_URL || form.dataset.worker || '').trim();
  const INTAKE_FORM_URL = (window.INTAKE_FORM_URL || form.dataset.form || '').trim();

  function toast(msg, ok = true) {
    const el = document.querySelector('#notice') || document.createElement('div');
    el.id = 'notice';
    el.setAttribute('role', 'status');
    el.style.marginTop = '12px';
    el.style.padding = '10px 12px';
    el.style.borderRadius = '8px';
    el.style.fontSize = '14px';
    el.style.border = ok ? '1px solid #16a34a' : '1px solid #dc2626';
    el.style.background = ok ? '#ecfdf5' : '#fef2f2';
    el.style.color = ok ? '#065f46' : '#991b1b';
    el.textContent = msg;
    form.appendChild(el);
  }

  async function postJSON(url, body) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res;
  }

  async function postForm(url, data) {
    const res = await fetch(url, { method: 'POST', mode: 'no-cors', body: data });
    return res;
  }

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const btn = form.querySelector('button[type="submit"]');
    btn && (btn.disabled = true);

    const fd = new FormData(form);
    const payload = Object.fromEntries(fd.entries());

    try {
      if (WORKER_URL) {
        await postJSON(WORKER_URL.replace(/\/+$/,''), payload);
      } else if (INTAKE_FORM_URL) {
        await postForm(INTAKE_FORM_URL, fd);
      } else {
        throw new Error('No endpoint configured');
      }
      toast('Submitted. We will reach out by email shortly.', true);
      form.reset();
    } catch (e) {
      console.error(e);
      toast('Submit failed. Please try again later.', false);
    } finally {
      btn && (btn.disabled = false);
    }
  });
})();
