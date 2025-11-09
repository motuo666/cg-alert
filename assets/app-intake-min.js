(function(){
  const $ = s => document.querySelector(s);
  const form = $('#intake-form');
  const ok = $('#flash-ok');
  const err = $('#flash-err');
  const btn = $('#btn-submit');
  const progress = $('#progress');

  function showError(name, msg){
    const el = document.querySelector(`.err[data-for="${name}"]`);
    if(el){ el.textContent = msg || el.textContent; el.style.display='block'; }
  }
  function hideErrors(){
    document.querySelectorAll('.err').forEach(e=>e.style.display='none');
    err.style.display='none'; err.textContent='';
    ok.style.display='none';
  }
  function required(v){ return v!=null && String(v).trim().length>0; }

  function resolveEndpoint(){
    if(form.getAttribute('action')) return form.getAttribute('action');
    const meta = document.querySelector('meta[name="worker-url"]');
    if(meta && meta.content) return meta.content.replace(/\/+$/,'') + '/intake';
    return null;
  }

  form.addEventListener('submit', async (e)=>{
    e.preventDefault();
    hideErrors();

    const data = {
      email: form.email.value.trim(),
      company: form.company.value.trim(),
      vendors: form.vendors.value.trim(),
      budget: form.budget.value,
      notes: form.notes.value.trim()
    };

    let okAll = true;
    if(!required(data.email)){ showError('email','请填写公司邮箱'); okAll=false; }
    if(!required(data.company)){ showError('company','请填写公司名称'); okAll=false; }
    if(!required(data.vendors)){ showError('vendors','请填写监控厂商域名列表'); okAll=false; }
    if(!required(data.budget)){ showError('budget','请选择预算'); okAll=false; }
    if(!okAll) return;

    const endpoint = resolveEndpoint();
    btn.disabled = true; progress.style.display='inline';

    try{
      if(!endpoint){
        throw new Error('未配置提交端点（worker-url 或 form action）。');
      }
      const payload = {
        type: 'enterprise-intake',
        ts: new Date().toISOString(),
        ...data,
        vendors_list: data.vendors.split(/[\n,]+/).map(s=>s.trim()).filter(Boolean)
      };
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {'content-type':'application/json'},
        body: JSON.stringify(payload),
      });
      if(!res.ok){
        const t = await res.text().catch(()=>'');
        throw new Error(`提交失败：${res.status} ${t.slice(0,200)}`);
      }
      form.reset();
      ok.style.display = 'block';
      ok.scrollIntoView({behavior:'smooth', block:'center'});
    }catch(ex){
      err.textContent = ex.message || '提交失败，请稍后再试';
      err.style.display = 'block';
      err.scrollIntoView({behavior:'smooth', block:'center'});
    }finally{
      btn.disabled = false; progress.style.display='none';
    }
  });
})();