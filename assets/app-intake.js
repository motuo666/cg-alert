'use strict';
(function () {
  function $(sel, root) { return (root || document).querySelector(sel); }
  function getWorkerURL() {
    const m = $('meta[name="worker-url"]');
    if (m && m.content) return m.content.trim().replace(/\/+$/, '');
    if (window.WORKER_URL) return String(window.WORKER_URL).trim().replace(/\/+$/, '');
    return '';
  }
  function ensureStatusEl(form) {
    let el = document.getElementById('intake-status');
    if (!el) {
      el = document.createElement('div');
      el.id = 'intake-status';
      el.setAttribute('role', 'status');
      el.style.marginTop = '12px';
      el.style.fontSize = '14px';
      el.style.opacity = '0.95';
      form.appendChild(el);
    }
    return el;
  }
  function notify(form, text, ok) {
    const el = ensureStatusEl(form);
    el.textContent = text;
    el.style.color = ok ? '#0a7' : '#b00';
  }

  document.addEventListener('DOMContentLoaded', function () {
    const form = $('form#intake');
    if (!form) return;

    const btn = form.querySelector('button[type="submit"], input[type="submit"]');
    const origBtnText = btn ? (btn.textContent || btn.value) : '';

    form.addEventListener('submit', async function (ev) {
      ev.preventDefault();

      const fd = new FormData(form);
      const email = String(fd.get('email') || '').trim();
      const company = String(fd.get('company') || '').trim();
      const vendorsRaw = String(fd.get('vendors') || '').trim();
      const cadence = String(fd.get('cadence') || 'weekly').trim();
      const vendors = vendorsRaw ? vendorsRaw.split(',').map(s => s.trim()).filter(Boolean) : [];

      // Basic validation
      const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
      if (!emailOk) {
        notify(form, '请输入有效邮箱（Please enter a valid email）', false);
        return;
      }
      if (btn) { btn.disabled = true; if (btn.textContent !== undefined) btn.textContent = 'Submitting'; else btn.value = 'Submitting'; }

      const payload = { plan: 'enterprise', email, company, vendors, cadence, ts: new Date().toISOString() };
      const worker = getWorkerURL();
      const endpoint = worker ? (worker + '/intake') : '/api/intake';

      let ok = false, resText = '';
      try {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
          mode: 'cors',
          credentials: 'omit',
        });
        ok = res.ok;
        resText = await res.text();
      } catch (err) {
        ok = false;
        resText = String(err && err.message || err || '');
      }

      if (ok) {
        notify(form, '提交成功，已收到你的需求，我们会尽快联系你（Submitted ✓）', true);
        if (btn) { if (btn.textContent !== undefined) btn.textContent = 'Submitted ✓'; else btn.value = 'Submitted ✓'; }
        try { form.reset(); } catch (_) {}
        try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch (_) {}
        setTimeout(function () {
          if (btn) { btn.disabled = false; if (btn.textContent !== undefined) btn.textContent = origBtnText; else btn.value = origBtnText; }
        }, 4000);
      } else {
        notify(form, '提交失败，请稍后重试或邮件至 hello@cg-alert.com' + (resText ? (' (' + resText + ')') : ''), false);
        if (btn) { btn.disabled = false; if (btn.textContent !== undefined) btn.textContent = origBtnText; else btn.value = origBtnText; }
      }
    }, { passive: false });
  });
})();