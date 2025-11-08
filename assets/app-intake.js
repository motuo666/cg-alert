
// --- Global guard: never open mailto: from intake page ---
document.addEventListener('click', (ev) => {
  const a = ev.target && ev.target.closest ? ev.target.closest('a[href^="mailto:"]') : null;
  if (a) { ev.preventDefault(); return false; }
}, { capture: true });
\n(function(){
  const form   = document.getElementById('intake');
  const status = document.getElementById('intake_status');
  if(!form) return;

  // Worker URL: prefer <meta name="worker-url">, fallback to window.WORKER_URL
  const meta = document.querySelector('meta[name="worker-url"]');
  const workerURL = ((meta && meta.content) || (typeof window!=='undefined' && window.WORKER_URL) || "").replace(/\/$/, "");

  // Force English validation messages (lightweight)
  const requiredInputs = form.querySelectorAll('[required]');
  requiredInputs.forEach(function(el){
    el.addEventListener('invalid', function(){
      if(el.type === 'email'){
        el.setCustomValidity('Please enter a valid work email.');
      }else{
        el.setCustomValidity('Please fill out this field.');
      }
    });
    el.addEventListener('input', function(){
      el.setCustomValidity('');
    });
  });

  form.addEventListener('submit', async function(e){
    e.preventDefault();

    // Client-side validity gate (no mailto fallback)
    if(!form.checkValidity()){
      form.reportValidity();
      if(status) status.textContent = 'Please fill required fields.';
      return;
    }

    var data = Object.fromEntries(new FormData(form).entries());
    data._ts = new Date().toISOString();

    if(!workerURL){
      console.warn('Missing workerURL; not submitting.');
      if(status) status.textContent = 'Unable to submit right now. Please try again later.';
      return;
    }

    try{
      var res = await fetch(workerURL + '/intake_lead', {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify(data)
      });
      if(!res.ok){
        throw new Error('Worker responded ' + res.status);
      }
      if(status) status.textContent = 'Received. We\'ll email you shortly.';
      form.reset();
    }catch(err){
      console.warn('[intake] submit failed:', err);
      if(status) status.textContent = 'Unable to submit right now. Please try again later.';
    }
  });
})();
