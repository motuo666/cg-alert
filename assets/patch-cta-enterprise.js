// Patch homepage enterprise CTA without touching markup
(function () {
  try {
    if (location.pathname !== "/") return;
    // Find pricing section
    const sec = document.querySelector('#pricing') || document.querySelector('[data-section="pricing"]') || document.body;
    // Heuristic: find a card whose heading text includes 'Enterprise'
    const cards = sec.querySelectorAll('section,div,li,.cg-card,.tier,.plan');
    let btn = null;
    for (const el of cards) {
      const h = el.querySelector('h3,h2,.title,.plan-title');
      if (h && /enterprise/i.test(h.textContent || "")) {
        btn = el.querySelector('a,button');
        if (btn) break;
      }
    }
    if (!btn) {
      // fallback: find link pointing to intake and make sure label is correct
      const candidate = sec.querySelector('a[href*="/intake"]');
      if (candidate) btn = candidate;
    }
    if (btn) {
      btn.textContent = "Request Enterprise →";
      if (btn.tagName.toLowerCase() === "a") {
        btn.setAttribute("href", "/intake/");
      } else {
        // turn to link behavior
        btn.addEventListener("click", () => { location.href = "/intake/"; });
      }
      btn.setAttribute("rel","nofollow");
    }
  } catch (e) { /* no-op */ }
})();