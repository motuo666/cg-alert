(async () => {
  const list = document.getElementById('rss-list');
  function el(tag, props={}, ...kids){
    const n = document.createElement(tag);
    for (const [k,v] of Object.entries(props)) {
      if (k === 'class') n.className = v;
      else if (k in n) n[k] = v;
      else n.setAttribute(k,v);
    }
    for (const k of kids) n.append(k);
    return n;
  }
  try {
    const res = await fetch('/rss/index.xml', {credentials:'same-origin'});
    if (!res.ok) throw new Error('rss missing');
    const xml = new DOMParser().parseFromString(await res.text(), 'application/xml');
    const items = Array.from(xml.querySelectorAll('item')).slice(0, 200);
    const ul = el('ul', {class:'cg-list'});
    for (const it of items){
      const title = it.querySelector('title')?.textContent || '(no title)';
      const link  = it.querySelector('link')?.textContent || '#';
      const date  = it.querySelector('pubDate')?.textContent || '';
      const li = el('li',{},
        el('a',{href:link, rel:'noopener noreferrer'}, title),
        date ? document.createTextNode(' · '+date) : ''
      );
      ul.append(li);
    }
    list.replaceChildren(ul);
  } catch(e){
    list.textContent = 'No RSS items available.';
  }
})();