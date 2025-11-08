// /assets/patch-cta-enterprise.js
(() => {
  try {
    const cards = document.querySelectorAll('#pricing .pcard');
    const ent = Array.from(cards).find(c =>
      /enterprise/i.test(c.querySelector('h3')?.textContent || '')
    );
    if (ent && !ent.querySelector('.cta-enterprise')) {
      const a = document.createElement('a');
      a.className = 'cg-btn align cta-enterprise';
      a.href = '/intake/';
      a.textContent = 'Request Enterprise →';
      ent.appendChild(a);
    }
  } catch (e) { /* no-op */ }
})();