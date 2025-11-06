(async()=>{
  try{
    const r = await fetch('/pricing/config.json',{cache:'no-store'});
    if(!r.ok) return;
    const c = await r.json();
    const get = (id)=> (c.plans||[]).find(p=>p.id===id);
    const p = get('portfolio'), b = get('business');
    if (p?.checkout_redirect) document.getElementById('btn-portfolio')?.setAttribute('href', p.checkout_redirect);
    if (b?.checkout_redirect) document.getElementById('btn-business')?.setAttribute('href',  b.checkout_redirect);
  }catch(_){}
})();