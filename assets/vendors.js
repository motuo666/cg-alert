(async function(){
  const $ = (s)=>document.querySelector(s);
  const list = $('#list'), q = $('#q');
  let raw = [];
  try { raw = await (await fetch('/api/vendors.json',{cache:'no-store'})).json(); } catch(_) { raw = []; }

  const norm = (arr)=> (Array.isArray(arr)?arr:[]).map(v=>{
    const slugFromUrl = ((v.url||'').split('/').filter(Boolean).pop()||'').toLowerCase();
    const slug = (v.slug || v.vendor || slugFromUrl || '').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'');
    const name = v.name || v.vendor || slug || 'unknown';
    return { name, slug, url: v.url || `/vendors/${slug}/`, count: v.count||0 };
  }).filter(v=> v.slug && !v.slug.startsWith('_'));

  let data = norm(raw);

  function render(){
    const kw = (q.value||'').toLowerCase();
    const items = data.filter(v => !kw || v.name.toLowerCase().includes(kw));
    list.innerHTML = items.map(v => `
      <a class="cg-card hover card" href="${v.url}" data-slug="${v.slug}" style="text-decoration:none">
        <div class="cg-muted" style="font-size:12px">${v.count} recent</div>
        <div class="cg-strong" style="font-size:18px">${v.name}</div>
      </a>`).join('') || '<div class="cg-note">No vendors yet.</div>';
  }

  q.addEventListener('input', render);
  render();

  list.addEventListener('click', async (e)=>{
    const a = e.target.closest('a.card'); if(!a) return;
    e.preventDefault();
    try { const r = await fetch(a.href, {method:'HEAD'}); location.href = r.ok ? a.href : (a.href + 'feed.xml'); }
    catch { location.href = a.href + 'feed.xml'; }
  });
})();