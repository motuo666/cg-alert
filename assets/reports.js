(function(){
  const cards = document.getElementById('cards');
  const empty = document.getElementById('empty');
  const q = document.getElementById('q');
  let data = [];
  function cardHTML(item){
    const date = new Date(item.timestamp || item.date || Date.now());
    const dateStr = date.toISOString().slice(0,10);
    const href = item.local_path || item.link || item.url;
    const title = (item.vendor || item.name || "Vendor") + " — " + (item.page || item.section || "Change");
    const snippet = item.snippet || item.summary || "";
    return `<a class="cg-card hover" href="${href}"><h3>${title}</h3><p>${snippet}</p><small>${dateStr}</small></a>`;
  }
  function render(list){
    cards.innerHTML = list.map(cardHTML).join("");
    empty.style.display = list.length ? "none":"block";
  }
  function filter(){
    const term = (q.value||"").toLowerCase().trim();
    if (!term) return render(data);
    render(data.filter(x => (x.vendor||"").toLowerCase().includes(term) ||
                            (x.page||"").toLowerCase().includes(term) ||
                            (x.snippet||"").toLowerCase().includes(term)));
  }
  q && q.addEventListener('input', filter);

  async function ensureLocalOrFallback(item){
    if (item.local_path) {
      try{
        const r = await fetch(item.local_path, {method:"HEAD"});
        if (!r.ok) throw new Error("404");
      }catch(e){
        // fallback to canonical/source url
        if (item.url) item.local_path = item.url;
        else if (item.link) item.local_path = item.link;
        else delete item.local_path;
      }
    }
    return item;
  }

  // Prefer JSON feed produced by workflow; fallback to RSS
  fetch('/reports/feed.json')
    .then(r => r.ok ? r.json() : Promise.reject())
    .then(async (json) => {
      const items = (json.items || json || []).map(it => ({
        vendor: it.vendor || it.name || "",
        page: it.page || it.section || "Change",
        url: it.url || it.link || "",
        local_path: it.local_path || it.url || it.link || "",
        timestamp: it.timestamp || it.date || it.capturedAt || "",
        snippet: it.snippet || it.summary || ""
      }));
      // de-duplicate and hide obvious samples / internal markers
      data = items.filter(x =>
        !/^_/.test((x.vendor || "")) &&
        !/sample/i.test(x.vendor || x.title || "")
      );
      // ensure links exist or fallback
      data = await Promise.all(data.map(ensureLocalOrFallback));
      render(data);
    })
    .catch(() =>
      fetch('/rss/index.xml')
        .then(r => r.text())
        .then(txt => {
          const doc = new window.DOMParser().parseFromString(txt, "application/xml");
          const items = Array.from(doc.querySelectorAll('item'));
          data = items.map(it => ({
            vendor: (it.querySelector('title')?.textContent || "").split(' — ')[0],
            page: (it.querySelector('title')?.textContent || "").split(' — ').slice(1).join(' — '),
            snippet: it.querySelector('description')?.textContent || "",
            url: it.querySelector('link')?.textContent || "",
            timestamp: it.querySelector('pubDate')?.textContent || ""
          }));
          render(data);
        })
    );
})();
