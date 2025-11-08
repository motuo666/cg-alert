(function(){
  'use strict';
  function $(sel, el){ return (el||document).querySelector(sel); }
  function $all(sel, el){ return Array.from((el||document).querySelectorAll(sel)); }

  function serialize(form){
    const data = new FormData(form);
    const obj = {};
    data.forEach((v,k)=>{ obj[k]=typeof v==='string'?v.trim():v; });
    return obj;
  }

  function disable(btn, on){
    if(!btn) return;
    btn.disabled = !!on;
    btn.setAttribute('aria-busy', on ? 'true':'false');
  }

  async function postJSON(url, payload){
    const res = await fetch(url, {
      method: 'POST',
      headers: {'content-type':'application/json'},
      body: JSON.stringify(payload),
      credentials: 'omit',
      mode: 'cors',
    });
    if(!res.ok) throw new Error('HTTP '+res.status);
    return await res.json().catch(()=>({ok:true}));
  }

  function getWorkerURL(){
    const m = document.querySelector('meta[name="worker-url"]');
    return m && m.content && m.content.startsWith('http') ? m.content : '';
  }

  function validate(form){
    let ok = true;
    $all('input[required],select[required],textarea[required]', form).forEach(el=>{
      el.classList.remove('cg-invalid');
      if(!el.value || (el.type==='email' && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(el.value))){
        el.classList.add('cg-invalid');
        ok = false;
      }
    });
    return ok;
  }

  function hook(){
    const form = $('#intake-form');
    if(!form) return;
    const btn = $('#intake-submit');
    const status = $('#intake-status');
    form.addEventListener('submit', async (ev)=>{
      ev.preventDefault();
      status.textContent = '';
      if(!validate(form)){
        status.textContent = 'Please fill the required fields.';
        return;
      }
      disable(btn, true);
      const payload = serialize(form);
      const worker = getWorkerURL();
      try{
        if(worker){
          await postJSON(worker + '/intake', {type:'enterprise', payload});
          status.textContent = 'Received. We will confirm within 1 business day.';
        }else{
          // Fallback: mailto
          const body = encodeURIComponent(JSON.stringify(payload,null,2));
          window.location.href = 'mailto:hello@cg-alert.com?subject=Enterprise%20Intake&body=' + body;
          status.textContent = 'Opened email client as fallback.';
        }
        form.reset();
      }catch(e){
        console.error(e);
        status.textContent = 'Submit failed. Try again or email hello@cg-alert.com';
      }finally{
        disable(btn, false);
      }
    }, {passive:false});
  }

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', hook);
  }else{
    hook();
  }
})();