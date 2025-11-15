// assets/rss-reader.js
// Robust RSS loader with deterministic order and graceful degradation
(async function(){
  const mount = document.getElementById('rss-mount') || document.body;
  function toISO(s){ const d=new Date(s); return isNaN(d.getTime())?null:d.toISOString(); }
  try{
    const r = await fetch('/rss.xml',{cache:'no-store'});
    if(!r.ok){ if(mount) mount.textContent='Failed to load RSS'; return; }
    const xml = new DOMParser().parseFromString(await r.text(), 'application/xml');
    const items = Array.from(xml.querySelectorAll('item')).map(x=>({
      title: (x.querySelector('title')||{}).textContent || '(no title)',
      link: (x.querySelector('link')||{}).textContent || '',
      date: (x.querySelector('pubDate')||{}).textContent || '',
      desc: (x.querySelector('description')||{}).textContent || ''
    }));
    items.sort((a,b)=> (toISO(b.date)||'').localeCompare(toISO(a.date)||''));
    const show = items.slice(0, 50);
    if (mount){
      mount.innerHTML = show.map(it => (
        `<div class="item">
           <div><a href="${it.link}" rel="noopener">${it.title}</a></div>
           <div class="meta">${(it.date||'').replace(' +0000',' UTC')}</div>
           <div>${it.desc}</div>
         </div>`
      )).join('');
    }
  }catch(e){
    if (mount) mount.textContent='RSS parse error';
  }
})();
