
(async function(){
  const feedEl = document.getElementById('feed');
  try{
    const res = await fetch('/rss/index.xml', {cache:'no-store'});
    if(!res.ok) throw new Error('RSS not found');
    const txt = await res.text();
    const xml = new window.DOMParser().parseFromString(txt, 'text/xml');
    const items = [...xml.querySelectorAll('item')].slice(0, 24);
    if(items.length===0){ feedEl.innerHTML = '<div class="cg-card">No items yet.</div>'; return; }
    const frag = document.createDocumentFragment();
    items.forEach(it=>{
      const title = it.querySelector('title')?.textContent || 'Evidence';
      const link = it.querySelector('link')?.textContent || '#';
      const date = it.querySelector('pubDate')?.textContent || '';
      const desc = it.querySelector('description')?.textContent || '';
      const card = document.createElement('a');
      card.href = link; card.className='cg-card hover'; card.style='text-decoration:none; color:inherit';
      card.innerHTML = `<h3 style="margin:0 0 6px">${title}</h3>
                        <div class="cg-caption">${date}</div>
                        <p style="margin:8px 0 0">${desc}</p>`;
      frag.appendChild(card);
    });
    feedEl.appendChild(frag);
  }catch(e){
    console.warn(e);
    feedEl.innerHTML = '<div class="cg-card">RSS unavailable.</div>';
  }
})();
