(async () => {
  const list = document.getElementById('reports-list');
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
  async function tryCSV(){
    const res = await fetch('/reports/index.csv', {credentials:'same-origin'});
    if(!res.ok) throw new Error('csv missing');
    const txt = await res.text();
    const lines = txt.split(/\r?\n/).filter(Boolean);
    if(lines.length === 0) throw new Error('csv empty');
    const [head, ...rows] = lines;
    const cols = head.split(',').map(s=>s.trim());
    const table = el('table', {class:'cg-table w-full'});
    const thead = el('thead');
    thead.append(el('tr',{}, ...cols.map(c=>el('th',{}, c))));
    table.append(thead);
    const tbody = el('tbody');
    for (const line of rows){
      const parts = line.split(','); // simple CSV (no quote-escaping assumed)
      const tds = parts.map(v=>el('td',{}, v.trim()));
      tbody.append(el('tr',{}, ...tds));
    }
    table.append(tbody);
    list.replaceChildren(table);
    return true;
  }
  async function tryRSS(){
    const res = await fetch('/rss/index.xml', {credentials:'same-origin'});
    if(!res.ok) throw new Error('rss missing');
    const xml = new DOMParser().parseFromString(await res.text(), 'application/xml');
    const items = Array.from(xml.querySelectorAll('item')).slice(0, 200);
    const ul = el('ul', {class:'cg-list'});
    for (const it of items){
      const title = it.querySelector('title')?.textContent || '(no title)';
      const link  = it.querySelector('link')?.textContent || '#';
      const date  = it.querySelector('pubDate')?.textContent || '';
      ul.append(el('li',{}, el('a',{href:link, rel:'noopener noreferrer'}, title), date ? ' · '+date : ''));
    }
    list.replaceChildren(ul);
    return true;
  }
  try {
    await tryCSV();
  } catch(e){
    try { await tryRSS(); }
    catch(e2){
      list.textContent = 'No data available.';
    }
  }
})();