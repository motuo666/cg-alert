// Minimal, robust intake form handling
(function () {
  function $(sel) { return document.querySelector(sel); }
  function notify(msg, ok) {
    var c = document.getElementById('msg');
    if (!c) {
      c = document.createElement('div');
      c.id = 'msg';
      c.style.marginTop = '12px';
      c.style.fontSize = '14px';
      document.body.appendChild(c);
    }
    c.textContent = msg;
    c.style.color = ok ? '#0f766e' : '#b91c1c';
  }

  function emailOK(e) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e || '');
  }

  function getMeta(name) {
    var m = document.querySelector('meta[name="'+name+'"]');
    return m ? m.content : '';
  }

  function pickWorker() {
    var form = document.querySelector('form');
    var fromData = form ? (form.getAttribute('data-worker') || '') : '';
    return window.WORKER_URL || getMeta('worker-url') || fromData || '';
  }

  function pickFallback() {
    var form = document.querySelector('form');
    var fromData = form ? (form.getAttribute('data-form') || '') : '';
    return window.INTAKE_FORM_URL || getMeta('intake-form') || fromData || '';
  }

  function onReady(fn){
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn);
    } else { fn(); }
  }

  onReady(function() {
    var form = document.querySelector('form');
    if (!form) return;

    var btn = document.getElementById('submitBtn') || form.querySelector('button[type=submit],input[type=submit]');
    var email = form.querySelector('input[name=email],input[type=email]');
    var vendors = form.querySelector('input[name=vendors],textarea[name=vendors]');
    var company = form.querySelector('input[name=company]');
    var plan = form.querySelector('select[name=plan],input[name=plan]');

    form.addEventListener('submit', async function (e) {
      // choose target
      var worker = pickWorker();
      var fallback = pickFallback();

      // If no endpoints, do nothing special and let browser submit (if action provided)
      if (!worker && !fallback && !form.getAttribute('action')) {
        notify('Submission endpoint missing. Please try again later.', false);
        e.preventDefault();
        return;
      }

      // If worker exists, we intercept
      if (worker) e.preventDefault();

      // basic validation
      var emailVal = email ? (email.value||'').trim() : '';
      if (!emailOK(emailVal)) {
        notify('请输入有效邮箱 / Please enter a valid email.', false);
        return;
      }

      // disable button
      if (btn) {
        if ('textContent' in btn) btn.textContent = 'Submitting…';
        if ('value' in btn) btn.value = 'Submitting…';
        btn.disabled = true;
      }

      try {
        var payload = {
          email: emailVal,
          vendors: vendors ? vendors.value : '',
          company: company ? company.value : '',
          plan: plan ? (plan.value||'enterprise') : 'enterprise',
          ts: new Date().toISOString(),
          source: 'intake'
        };

        if (worker) {
          var url = worker.replace(/\/+$/,'') + '/intake';
          var res = await fetch(url, {
            method: 'POST',
            headers: {'content-type':'application/json'},
            body: JSON.stringify(payload),
            mode: 'cors'
          });
          if (!res.ok) throw new Error('HTTP ' + res.status);
          var data = await res.json().catch(function(){ return {}; });
          notify('已收到，我们会尽快联系你。Thanks—request received.', true);
          form.reset();
        } else {
          // fall back to external form endpoint by creating hidden inputs and submitting
          form.setAttribute('action', fallback);
          form.submit();
          return;
        }

      } catch (err) {
        console.error(err);
        notify('提交失败，请重试 / Failed to submit. Please try again.', false);
      } finally {
        if (btn) {
          btn.disabled = false;
          if ('textContent' in btn) btn.textContent = 'Submit';
          if ('value' in btn) btn.value = 'Submit';
        }
      }
    }, false);
  });
})();
