(function(){
  const form = document.getElementById('intake');
  const status = document.getElementById('intake_status');
  if(!form) return;
  const meta = document.querySelector('meta[name="worker-url"]');
  const workerURL = (meta && meta.content || "").replace(/\/$/,"");
  form.addEventListener('submit', async (e)=>{
    e.preventDefault();
    status.textContent = 'Sending...';
    const data = Object.fromEntries(new FormData(form).entries());
    data._ts = new Date().toISOString();
    if(workerURL){
      try{
        const res = await fetch(workerURL + '/intake', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify(data) });
        if(!res.ok) throw new Error('Worker responded ' + res.status);
        status.textContent = 'Received. Check your email shortly.';
        form.reset(); return;
      }catch(err){
        console.warn(err);
        status.textContent = 'Worker failed. Falling back to email…';
      }
    }
    const mailto = `mailto:ops@cg-alert.com?subject=CG%20Alert%20Intake&body=${encodeURIComponent(JSON.stringify(data,null,2))}`;
    window.location.href = mailto;
    status.textContent = 'Opened your email client.';
  });
})();