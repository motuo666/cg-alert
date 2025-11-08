// assets/app-intake.js — stable, no dependencies
(function(){
  'use strict';

  function $(sel, el){ return (el||document).querySelector(sel); }
  function val(id){ const el = document.getElementById(id); return el ? el.value.trim() : ''; }
  function vendorsToArray(s){
    return s.split(',').map(x=>x.trim().toLowerCase()).filter(Boolean).slice(0, 200);
  }
  function emailOk(s){ return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s); }

  function workerURL(){
    const meta = document.querySelector('meta[name="worker-url"]');
    let base = (meta && meta.content) ? meta.content.trim() : '';
    if (!base) return '';
    if (base.endsWith('/')) base = base.slice(0,-1);
    return base + '/lead';
  }

  async function submitLead(payload){
    const url = workerURL();
    if (!url) throw new Error('Missing worker URL');
    const res = await fetch(url, {
      method: 'POST',
      headers: {'content-type':'application/json','x-site-origin': location.origin},
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      const text = await res.text().catch(()=>'');
      throw new Error('Upstream ' + res.status + ' ' + text);
    }
    return await res.json().catch(()=>({ok:true}));
  }

  function mailtoFallback(payload){
    const to = 'sales@cg-alert.com';
    const subj = encodeURIComponent('Enterprise intake — ' + (payload.company||''));
    const body = encodeURIComponent(
      'Plan: ' + payload.plan + '\n' +
      'Company: ' + payload.company + '\n' +
      'Email: ' + payload.email + '\n' +
      'Vendors: ' + (payload.vendors||[]).join(', ') + '\n' +
      'Notes: ' + (payload.notes||'') + '\n' +
      'UA: ' + (navigator.userAgent||'') + '\n' +
      'TS: ' + new Date().toISOString()
    );
    window.location.href = 'mailto:' + to + '?subject=' + subj + '&body=' + body;
  }

  window.addEventListener('DOMContentLoaded', function(){
    const form = document.getElementById('enterprise-intake');
    const btn = document.getElementById('submit-intake');
    const ok = document.getElementById('ok');
    const err = document.getElementById('err');
    if (!form || !btn) return;

    form.addEventListener('submit', async function(e){
      e.preventDefault();
      err.style.display = 'none';
      ok.style.display = 'none';

      const company = val('company');
      const email = val('email');
      const vendors = vendorsToArray(val('vendors'));
      const notes = val('notes');

      if (!company) { err.textContent = 'Company is required'; err.style.display='block'; return; }
      if (!emailOk(email)) { err.textContent = 'Enter a valid work email'; err.style.display='block'; return; }
      if (!vendors.length) { err.textContent = 'Add at least one vendor domain'; err.style.display='block'; return; }

      const payload = {
        plan: 'enterprise',
        company, email, vendors, notes,
        source: 'web:intake',
        ts: new Date().toISOString()
      };

      btn.disabled = true;
      btn.textContent = 'Submitting…';
      try {
        await submitLead(payload);
        ok.style.display = 'block';
        form.reset();
        btn.textContent = 'Submitted';
      } catch (ex) {
        // Fallback to mailto so the click always does something user-visible
        try { mailtoFallback(payload); } catch(_) {}
        err.textContent = 'Online submit failed. We opened an email draft so you can send intake directly.';
        err.style.display = 'block';
        btn.textContent = 'Submit';
      } finally {
        btn.disabled = false;
      }
    }, false);
  }, false);
})();