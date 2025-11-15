(function () {
  function ready(fn) {
    if (document.readyState !== 'loading') return fn();
    document.addEventListener('DOMContentLoaded', fn, { once: true });
  }
  ready(function () {
    try {
      const pricing = document.querySelector('#pricing, .cg-pricing');
      if (!pricing) return;
      const cards = pricing.querySelectorAll('.cg-card, .pcard');
      let enterpriseCard = null;
      for (const c of cards) {
        const h3 = c.querySelector('h3');
        if (h3 && /enterprise/i.test(h3.textContent || '')) { enterpriseCard = c; break; }
      }
      if (!enterpriseCard) return;
      const hasBtn = enterpriseCard.querySelector('a.cg-btn');
      if (hasBtn) return;
      const btn = document.createElement('a');
      btn.className = 'cg-btn align';
      btn.href = '/intake/';
      btn.textContent = 'Request Enterprise →';
      btn.setAttribute('aria-label', 'Request Enterprise');
      const ul = enterpriseCard.querySelector('ul');
      if (ul && ul.parentElement === enterpriseCard) {
        enterpriseCard.appendChild(btn);
      } else {
        enterpriseCard.appendChild(btn);
      }
    } catch (e) {
      console && console.warn && console.warn('[cta-enterprise] failed:', e);
    }
  });
})();