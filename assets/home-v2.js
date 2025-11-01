// Smooth scroll + scrollspy + copy escalation
document.querySelectorAll('a[href^="#"]').forEach(a=>a.addEventListener('click',e=>{
  const id=a.getAttribute('href').slice(1); const el=document.getElementById(id);
  if(!el) return; e.preventDefault(); el.scrollIntoView({behavior:'smooth'});
}));
const nav=document.getElementById('topnav'); const links=[...nav.querySelectorAll('a')].filter(a=>a.getAttribute('href').startsWith('#'));
const sections=['hero','trust','features','how','evidence','compare','pricing','faq'];
function spy(){ const y=window.scrollY+120; let active=null;
  sections.forEach(id=>{ const el=document.getElementById(id); if(!el) return; const top=el.offsetTop; if(y>=top) active=id; });
  links.forEach(a=>{a.classList.toggle('active', a.getAttribute('href')==='#'+active);});
}
spy(); window.addEventListener('scroll',spy);
const copy=document.getElementById('copy'); const copied=document.getElementById('copied');
if(copy){ copy.addEventListener('click',async()=>{ try{ await navigator.clipboard.writeText('Per our records, your pricing/terms changed on 2025‑10‑24. Please extend legacy pricing or credits.'); copied.textContent='Copied.';}catch(e){copied.textContent='Copy failed.';} });}
if(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches){
  document.querySelectorAll('.hover').forEach(el=>el.style.transition='none');
}
