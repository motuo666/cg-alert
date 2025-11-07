(function(){
  const root = document.getElementById('rss-list');
  function itemHTML(item){
    const dateStr = item.date ? new Date(item.date).toISOString().slice(0,10) : "";
    return `<a class="cg-card hover" href="${item.link}"><h3>${item.title}</h3><p>${item.description||""}</p><small>${dateStr}</small></a>`;
  }
  fetch('/rss/index.xml')
    .then(r => r.text())
    .then(txt => {
      const doc = new window.DOMParser().parseFromString(txt, "application/xml");
      const items = Array.from(doc.querySelectorAll('item')).map(it => ({
        title: it.querySelector('title')?.textContent || "Change",
        link: it.querySelector('link')?.textContent || "#",
        date: it.querySelector('pubDate')?.textContent || "",
        description: it.querySelector('description')?.textContent || ""
      }));
      root.innerHTML = items.map(itemHTML).join("");
    })
    .catch(() => { root.innerHTML = '<div class="cg-card">No RSS yet.</div>'; });
})();