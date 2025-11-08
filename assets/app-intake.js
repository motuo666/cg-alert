
(function(){
  'use strict';
  function $(sel){ return document.querySelector(sel); }
  function getWorkerURL(){
    const meta = document.querySelector('meta[name="worker-url"]');
    const v = meta && meta.getAttribute('content') || '';
    return (v || '').replace(/\/+$/,''); // trim trailing slash
  }
  function isEmail(s){ return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s); }
  function parseDomains(s){
    return (s||'').split(',').map(x=>x.trim().toLowerCase()).filter(Boolean);
  }
  function disableBtn(btn, on){
    if(!btn) return;
    btn.disabled = !!on;
    btn.style.opacity = on ? '0.6' : '1';
    btn.style.cursor = on ? 'not-allowed' : 'pointer';
    btn.textContent = on ? 'Submitting' : 'Submit';
  }
  function show(el, ok){
    if(!el) return;
    el.style.display = ok ? 'inline' : 'none';
  }
  window.addEventListener('DOMContentLoaded', function(){
    const form = $('#intakeForm');
    const btn = $('#submitBtn');
    const ok = $('#msg');
    const err = $('#errmsg');
    if(!form){ return; }
    form.addEventListener('submit', async function(e){
      e.preventDefault();
      show(ok,false); show(err,false);
      const fd = new FormData(form);
      const company = String(fd.get('company')||'').trim();
      const email = String(fd.get('email')||'').trim();
      const vendors = parseDomains(String(fd.get('vendors')||''));
      const notes = String(fd.get('notes')||'').trim();
      const plan = String(fd.get('plan')||'enterprise');

      if(!company){ show(err,true); err.textContent='Company is required.'; return; }
      if(!isEmail(email)){ show(err,true); err.textContent='Valid work email required.'; return; }
      if(!vendors.length){ show(err,true); err.textContent='Provide at least one vendor domain.'; return; }

      disableBtn(btn,true);
      const payload = { company, email, vendors, notes, plan };
      const worker = getWorkerURL();
      let okSent = false, errorMsg = '';

      if(worker){
        try{
          const resp = await fetch(worker + '/lead', {
            method: 'POST',
            headers: { 'content-type':'application/json' },
            body: JSON.stringify(payload),
            mode: 'cors',
            redirect: 'follow',
            credentials: 'omit'
          });
          if(resp.ok){
            okSent = true;
          }else{
            errorMsg = 'Gateway responded ' + resp.status;
          }
        }catch(ex){
          errorMsg = ex && ex.message || 'Network error';
        }
      } else {
        errorMsg = 'No worker endpoint configured';
      }

      if(okSent){
        show(ok,true);
        form.reset();
        btn.textContent = 'Submitted';
      } else {
        // fallback: open mailto
        const subject = encodeURIComponent('[CG Alert] Enterprise intake');
        const body = encodeURIComponent(
          `Company: ${company}\nEmail: ${email}\nVendors: ${vendors.join(', ')}\nNotes: ${notes}\nPlan: ${plan}`
        );
        window.location.href = `mailto:sales@cg-alert.com?subject=${subject}&body=${body}`;
        show(err,true); err.textContent = 'We could not reach the gateway, opened your email client as fallback.';
        disableBtn(btn,false);
      }
    });
  });
})();
