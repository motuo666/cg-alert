(() => {
  async function inject(id, url){
    try {
      const el = document.getElementById(id);
      if(!el) return;
      const res = await fetch(url, {credentials:'same-origin'});
      if(!res.ok) return;
      el.innerHTML = await res.text();
      // Normalize header nav: "#xxx" -> "/#xxx" so it works in subpaths
      if(id==='site-header'){
        for (const a of el.querySelectorAll('a[href^="#"]')){
          const h = a.getAttribute('href');
          if (h && h.startsWith('#')) a.setAttribute('href', '/'+h);
        }
      }
    } catch(e){ /* noop */ }
  }
  addEventListener('DOMContentLoaded', () => {
    inject('site-header', '/includes/header.html');
    inject('site-footer', '/includes/footer.html');
  });
})();