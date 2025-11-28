(async function(){
  const list = document.getElementById('rss-list');
  const empty = document.getElementById('rss-empty');
  function render(items){
    if(!items || !items.length){ empty.style.display='block'; return; }
    list.innerHTML = '';
    for(const it of items){
      const url = it.url || it.link || '#';
      const div = document.createElement('div');
      div.className = 'rss-card';
      const date = it.date || it.pubDate || it.published || '';
      const vendor = it.vendor || it.title || 'Update';
      const excerpt = it.summary || it.description || '';
      div.innerHTML = `<div class="rss-meta">${(date||'').toString()}</div>
        <h3><a href="${url}">${vendor}</a></h3>
        <p>${excerpt}</p>`;
      list.appendChild(div);
    }
  }
  try {
    const res = await fetch('/reports/feed.json', {cache:'no-store'});
    if (res.ok) {
      const data = await res.json();
      return render(data.items || data || []);
    }
    throw new Error('feed.json not found');
  } catch(e) {
    try {
      const x = await fetch('/rss/index.xml', {cache:'no-store'});
      if (!x.ok) throw new Error('rss xml not found');
      const txt = await x.text();
      const dom = new DOMParser().parseFromString(txt, 'application/xml');
      const items = Array.from(dom.querySelectorAll('item')).map(n => ({
        title: (n.querySelector('title')||{}).textContent || '',
        link: (n.querySelector('link')||{}).textContent || '#',
        date: (n.querySelector('pubDate')||{}).textContent || '',
        description: (n.querySelector('description')||{}).textContent || ''
      }));
      render(items);
    } catch(e2){
      empty.style.display='block';
    }
  }
})();
