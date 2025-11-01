
(function(){
  document.querySelectorAll('[data-copy]').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      const ta = document.querySelector(btn.getAttribute('data-copy'));
      if(!ta) return;
      try{ await navigator.clipboard.writeText(ta.value); btn.textContent='Copied'; setTimeout(()=>btn.textContent='Copy',1200);}catch(e){ btn.textContent='Copy failed';}
    });
  });
})();
