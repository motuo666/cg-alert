// Enforce correct Stripe and Enterprise links on Pricing CTAs
(function(){
  try {
    var link2988 = "https://buy.stripe.com/cNi6oJ6JwcYUe2K72ics801";
    var link6000 = "https://buy.stripe.com/3cI28t6Jw4soaQy0DUcs800";
    var enterprise = "/intake/";
    function setHref(el, url){ if(el){ el.setAttribute('href', url); el.onclick=null; } }
    // by data-plan
    setHref(document.querySelector('[data-plan="basic"], a#buy-2988'), link2988);
    setHref(document.querySelector('[data-plan="pro"], a#buy-6000'), link6000);
    setHref(document.querySelector('[data-plan="enterprise"], a#buy-18000, a#request-enterprise'), enterprise);
    // buttons with matching text (fallback)
    Array.from(document.querySelectorAll('a,button')).forEach(function(a){
      var t=(a.textContent||"").toLowerCase();
      if(t.includes("2988")) setHref(a, link2988);
      if(t.includes("6000")) setHref(a, link6000);
      if(t.includes("enterprise")) setHref(a, enterprise);
    });
  } catch(e){ /* no-op */ }
})();
