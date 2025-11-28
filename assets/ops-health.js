(async function(){
  const stampEl = document.getElementById('stamp');
  const kpiPanel = document.getElementById('kpi');
  const kpiTable = document.getElementById('kpiTable');
  const tb = kpiTable.querySelector('tbody');
  const alertList = document.getElementById('alertList');
  const alertsDiv = document.getElementById('alerts');

  function pill(text, ok){
    stampEl.textContent = text;
    stampEl.className = 'pill ' + (ok ? 'ok' : 'bad');
  }

  async function loadJSON(url){
    try{
      const r = await fetch(url, {cache:'no-store'});
      if(!r.ok) throw new Error('HTTP '+r.status);
      return await r.json();
    }catch(e){
      return null;
    }
  }

  const kpi = await loadJSON('/ops/kpi/latest.json');
  if (kpi){
    kpiPanel.textContent = '';
    kpiTable.hidden = false;
    const rows = Object.entries({
      'Sent (7d)': kpi.sent7,
      'Unsub % (7d)': kpi.unsub7_pct + '%',
      'Bounce % (7d)': kpi.bounce7_pct + '%',
      'Complaint % (7d)': kpi.complaint7_pct + '%',
      'Generated at': kpi.generated_at
    });
    rows.forEach(([k,v])=>{
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${k}</td><td>${String(v)}</td>`;
      tb.appendChild(tr);
    });
    pill(kpi.ok ? 'OK' : 'ATTN', kpi.ok);
  }else{
    kpiPanel.textContent = 'No KPI snapshot (ops/kpi/latest.json)';
    pill('No KPI', false);
  }

  // Alerts list (load all json files under ops/alerts if directory listing available; fallback tries latest.json)
  const guess = await loadJSON('/ops/alerts/latest.json');
  if (guess){
    alertsDiv.textContent = '';
    (Array.isArray(guess)?guess:[guess]).forEach(a=>{
      const li = document.createElement('li');
      li.textContent = `[${a.level||'info'}] ${a.message||a.reason||'alert'} (${a.generated_at||''})`;
      alertList.appendChild(li);
    });
  }
})();
