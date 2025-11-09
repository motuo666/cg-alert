(() => {
  function $(sel, ctx){ return (ctx||document).querySelector(sel); }
  function $all(sel, ctx){ return Array.from((ctx||document).querySelectorAll(sel)); }

  const form = document.querySelector('form');
  if(!form) return;

  // Build endpoint: prefer action="", else meta[name=worker-url]+"/intake", else "/api/intake"
  function resolveEndpoint() {
    const attr = (form.getAttribute('action') || '').trim();
    if (attr) return attr;
    const meta = document.querySelector('meta[name="worker-url"]');
    if (meta && meta.content) {
      try {
        const base = meta.content.replace(/\/+$/,'');
        return base + '/intake';
      } catch(e) {}
    }
    return '/api/intake';
  }

  // Find inputs robustly
  function pickEmail(){
    // first type=email
    let el = $('input[type="email"]', form);
    if (el) return el;
    // name contains email
    el = $all('input', form).find(i => /email/i.test(i.name||''));
    if (el) return el;
    return null;
  }
  function pickByNames(candidates){
    const els = $all('input,textarea,select', form);
    for (const name of candidates){
      const found = els.find(e => (e.name||'').toLowerCase() === name);
      if(found) return found;
    }
    // fallback: data-name attr
    for (const name of candidates){
      const found = els.find(e => (e.getAttribute('data-name')||'').toLowerCase() === name);
      if(found) return found;
    }
    return null;
  }

  const emailEl   = pickEmail();
  const companyEl = pickByNames(['company','company_name','org','organization','companyname']);
  const vendorsEl = pickByNames(['vendors','vendor_domains','domains','targets']);
  const budgetEl  = pickByNames(['budget','plan','tier']);
  const noteEl    = pickByNames(['note','notes','remark','remarks','comment','comments']);

  // Minimal helpers
  function makeBanner(type, text){
    // type: 'ok' | 'err'
    const div = document.createElement('div');
    div.setAttribute('role', 'alert');
    div.style.padding = '10px 12px';
    div.style.borderRadius = '8px';
    div.style.margin = '12px 0';
    div.style.fontSize = '14px';
    div.style.lineHeight = '1.4';
    if (type === 'ok'){
      div.style.background = '#ecfdf5';
      div.style.color = '#065f46';
      div.style.border = '1px solid #a7f3d0';
    } else {
      div.style.background = '#fef2f2';
      div.style.color = '#991b1b';
      div.style.border = '1px solid #fecaca';
    }
    div.textContent = text;
    return div;
  }

  function inlineError(el, msg){
    if(!el) return;
    removeInlineError(el);
    el.setAttribute('aria-invalid','true');
    const small = document.createElement('div');
    small.className = 'field-error';
    small.style.fontSize = '12px';
    small.style.color = '#b91c1c';
    small.style.marginTop = '6px';
    small.textContent = msg;
    el.insertAdjacentElement ? el.insertAdjacentElement('afterend', small) : el.parentNode.insertBefore(small, el.nextSibling);
  }
  function removeInlineError(el){
    if(!el) return;
    el.removeAttribute('aria-invalid');
    const next = el.nextElementSibling;
    if(next && next.classList && next.classList.contains('field-error')) next.remove();
  }
  function clearErrors(){
    $all('.field-error', form).forEach(n => n.remove());
  }

  function isEmpty(el){
    if(!el) return true;
    const v = (el.value || '').trim();
    return v.length === 0;
  }

  function validate(){
    clearErrors();
    let ok = true;

    if(emailEl){
      const v = (emailEl.value || '').trim();
      const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
      if(!v){
        inlineError(emailEl, '请填写公司邮箱');
        ok=false;
      } else if(!emailOk){
        inlineError(emailEl, '邮箱格式不正确');
        ok=false;
      }
    } else {
      // No email field present: fail
      ok=false;
      form.prepend(makeBanner('err', '缺少邮箱字段，请联系管理员修复。'));
    }

    if(companyEl && isEmpty(companyEl)){
      inlineError(companyEl, '请填写公司名');
      ok=false;
    }
    if(vendorsEl && isEmpty(vendorsEl)){
      inlineError(vendorsEl, '请填写需监控的厂商域名（逗号分隔）');
      ok=false;
    }

    if(!companyEl || !vendorsEl){
      // If either is missing, warn but still allow submit with existing fields
      // However, the user wants simple "请填写" prompts. We enforce presence if the element exists.
    }

    if(!ok){
      const firstErr = form.querySelector('[aria-invalid="true"]');
      if(firstErr && typeof firstErr.focus === 'function'){
        try { firstErr.focus(); } catch(e){}
      }
    }
    return ok;
  }

  let bannerEl = null;

  form.addEventListener('submit', async (ev) => {
    try{
      ev.preventDefault();

      if (bannerEl) { bannerEl.remove(); bannerEl=null; }

      if(!validate()){
        bannerEl = makeBanner('err', '请先补全必填字段');
        form.prepend(bannerEl);
        return;
      }

      const endpoint = resolveEndpoint();

      // Build payload
      const payload = {
        email: emailEl ? (emailEl.value || '').trim() : '',
        company: companyEl ? (companyEl.value || '').trim() : '',
        vendors: vendorsEl ? (vendorsEl.value || '').trim() : '',
        budget: budgetEl ? (budgetEl.value || '').trim() : '',
        note: noteEl ? (noteEl.value || '').trim() : '',
        meta: {
          page: location.href,
          ts: new Date().toISOString(),
          ua: navigator.userAgent
        }
      };

      // Submit as JSON; if the form has method="post" with enctype default, backend should accept JSON
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        credentials: 'omit',
        cache: 'no-store',
        redirect: 'follow',
      });

      if (!res.ok){
        let msg = '提交失败，请稍后重试';
        try {
          const t = await res.text();
          if (t && t.length < 300) msg += `（${t}）`;
        } catch(e){}
        bannerEl = makeBanner('err', msg);
        form.prepend(bannerEl);
        return;
      }

      bannerEl = makeBanner('ok', '提交成功，我们会尽快给您回复。');
      form.prepend(bannerEl);
      form.reset();
    }catch(err){
      console.error('[intake-submit]', err);
      if (bannerEl) { bannerEl.remove(); bannerEl=null; }
      bannerEl = makeBanner('err', '网络异常，请稍后重试');
      form.prepend(bannerEl);
    }
  }, { passive: false });

})();
