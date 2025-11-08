(function () {
  'use strict';
  document.addEventListener('DOMContentLoaded', function () {
    var form = document.querySelector('#intake-form');
    if (!form) return;

    // Ensure submit button is a true submit and clickable
    var submitBtn = form.querySelector('button[type="submit"], input[type="submit"], #submit');
    if (submitBtn) {
      if (!submitBtn.getAttribute('type')) submitBtn.setAttribute('type', 'submit');
      submitBtn.removeAttribute('disabled');
      submitBtn.style.pointerEvents = 'auto';
    }

    // Hidden defaults (force enterprise weekly)
    var planEl = form.querySelector('input[name="plan"]');
    if (!planEl) {
      planEl = document.createElement('input');
      planEl.type = 'hidden';
      planEl.name = 'plan';
      form.appendChild(planEl);
    }
    planEl.value = 'enterprise';

    var cadenceEl = form.querySelector('input[name="cadence"]');
    if (!cadenceEl) {
      cadenceEl = document.createElement('input');
      cadenceEl.type = 'hidden';
      cadenceEl.name = 'cadence';
      form.appendChild(cadenceEl);
    }
    cadenceEl.value = 'weekly';

    function lock(on) {
      if (submitBtn) {
        submitBtn.disabled = !!on;
        submitBtn.setAttribute('aria-busy', String(!!on));
      }
    }

    function toast(msg) {
      var box = document.getElementById('intake-error');
      if (!box) {
        box = document.createElement('div');
        box.id = 'intake-error';
        box.style.background = '#fee2e2';
        box.style.border = '1px solid #fecaca';
        box.style.color = '#991b1b';
        box.style.padding = '10px 12px';
        box.style.borderRadius = '10px';
        box.style.margin = '0 0 12px 0';
        form.prepend(box);
      }
      box.textContent = msg;
    }

    function validEmail(v) {
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v || '');
    }

    function getMeta(name) {
      var el = document.querySelector('meta[name="' + name + '"]');
      return el && el.content ? el.content : '';
    }

    function thanks() {
      window.location.href = '/intake/thanks/';
    }

    form.addEventListener('submit', async function (e) {
      e.preventDefault();

      // Basic validations
      var email = (form.querySelector('input[name="email"]') || {}).value || '';
      var company = (form.querySelector('input[name="company"]') || {}).value || '';
      var vendors = (form.querySelector('input[name="vendors"]') || {}).value || '';

      if (!validEmail(email)) {
        toast('请输入有效邮箱');
        return;
      }
      if (!company.trim()) {
        toast('请输入公司名称');
        return;
      }

      lock(true);
      try {
        // Build payload
        var fd = new FormData(form);
        fd.set('plan', 'enterprise');
        fd.set('cadence', 'weekly');
        var payload = {};
        fd.forEach(function (v, k) { payload[k] = v; });
        payload.source = 'intake';

        // Worker URL from meta or global
        var worker = getMeta('worker-url') || (window.WORKER_URL || '');
        var ok = false;

        if (worker) {
          try {
            var r = await fetch(worker.replace(/\/+$/,'') + '/lead', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(payload),
              credentials: 'omit',
              mode: 'cors',
            });
            if (r && r.ok) {
              ok = true;
            }
          } catch (err) {
            console.warn('worker submit failed', err);
          }
        }

        if (ok) {
          thanks();
          return;
        }

        // Fallback: Google Form
        var gf = (window.INTAKE_FORM_URL || getMeta('google-form-url') || '').trim();
        if (gf) {
          var qs = new URLSearchParams({
            email: email,
            company: company,
            vendors: vendors,
            plan: 'enterprise',
            cadence: 'weekly'
          }).toString();
          window.location.href = gf + (gf.includes('?') ? '&' : '?') + qs;
          return;
        }

        // Final fallback: mailto
        var body = encodeURIComponent(
          'Email: ' + email + '\n' +
          'Company: ' + company + '\n' +
          'Vendors: ' + vendors + '\n' +
          'Plan: enterprise\n' +
          'Cadence: weekly\n'
        );
        window.location.href = 'mailto:sales@cg-alert.com?subject=Enterprise Intake&body=' + body;
      } finally {
        lock(false);
      }
    }, { passive: false });
  });
})();