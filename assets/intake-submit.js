
/*! CG Alert Intake Upgrade (1322 baseline, v2)
 *  - Keep nav & global styles untouched
 *  - Replace only middle content via progressive enhancement
 *  - English validation; success banner on submit
 *  - Robust submission with CORS fallback (no-cors text/plain)
 */
(function(){
  const CSS = `
  /* scoped UI only */
  .cg-intake-shell{max-width:920px;margin:40px auto;padding:24px;border:1px solid #e2e8f0;border-radius:16px;background:#fff;box-shadow:0 2px 10px rgba(0,0,0,.03)}
  .cg-intake-header{margin-bottom:8px}
  .cg-intake-title{font-size:28px;line-height:1.25;margin:0 0 6px 0;color:#0b1733}
  .cg-intake-sub{margin:0 0 18px 0;color:#475569}
  .cg-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}
  .cg-row{display:flex;flex-direction:column;gap:8px;margin-bottom:14px}
  .cg-row.full{grid-column:1 / -1}
  .cg-label{font-weight:600;color:#0f172a}
  .cg-help{font-size:12px;color:#64748b}
  .cg-input,.cg-textarea,.cg-select{width:100%;padding:12px 14px;border:1px solid #cbd5e1;border-radius:10px;font-size:14px;background:#fff;outline:none}
  .cg-textarea{min-height:100px;resize:vertical}
  .cg-actions{display:flex;gap:12px;align-items:center;margin-top:10px}
  .cg-btn{display:inline-flex;align-items:center;justify-content:center;padding:12px 18px;border-radius:999px;border:1px solid #0ea5e9;background:#0ea5e9;color:#fff;font-weight:600;cursor:pointer}
  .cg-btn:disabled{opacity:.6;cursor:not-allowed}
  .cg-banner{margin:0 auto 16px auto;max-width:920px;padding:10px 14px;border-radius:12px;border:1px solid transparent}
  .cg-banner.ok{background:#ecfdf5;border-color:#10b981;color:#065f46}
  .cg-banner.err{background:#fff1f2;border-color:#f43f5e;color:#881337}
  .cg-err{color:#b91c1c;font-size:12px;display:none}
  .cg-err.show{display:block}
  @media (max-width:780px){.cg-grid{grid-template-columns:1fr}}
  `;

  function injectCSS(){
    const id='cg-intake-css';
    if(document.getElementById(id)) return;
    const s=document.createElement('style'); s.id=id; s.textContent=CSS;
    document.head.appendChild(s);
  }

  function valStr(v){ return (v||'').trim(); }
  function isEmail(v){
    const s=valStr(v);
    // permissive email check; do not reject freemail
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
  }
  function parseVendors(v){
    return valStr(v).split(/[\s,;]+/).map(x=>x.trim()).filter(Boolean);
  }
  function el(tag, attrs={}, kids=[]){
    const e=document.createElement(tag);
    for(const [k,v] of Object.entries(attrs)){
      if(k==='class') e.className=v;
      else if(k==='for') e.htmlFor=v;
      else if(k.startsWith('on') && typeof v==='function') e.addEventListener(k.slice(2), v);
      else if(k==='text') e.textContent=v;
      else e.setAttribute(k,v);
    }
    kids.forEach(ch=> e.appendChild(ch));
    return e;
  }
  function fieldErr(fieldId,msg){
    const err = document.querySelector(`.cg-err[data-for="${fieldId}"]`);
    if(!err) return;
    if(msg){ err.textContent=msg; err.classList.add('show'); }
    else { err.textContent=''; err.classList.remove('show'); }
  }
  function banner(type, text){
    let b = document.getElementById('cg-intake-banner');
    if(!b){ b = el('div', {id:'cg-intake-banner', class:`cg-banner ${type}`}); document.body.prepend(b); }
    b.className = `cg-banner ${type}`;
    b.textContent = text;
    // auto hide after a while for ok
    if(type==='ok'){ setTimeout(()=>{ if(b) b.remove(); }, 5000); }
  }
  function endpointFromDOM(form){
    // priority: form.action > meta[intake-endpoint] > meta[worker-url]+/intake > /intake
    const act = valStr(form.getAttribute('action'));
    if(act) return act;
    const metaIntake = document.querySelector('meta[name="intake-endpoint"]');
    if(metaIntake && valStr(metaIntake.getAttribute('content'))) return metaIntake.getAttribute('content');
    const mw = document.querySelector('meta[name="worker-url"]');
    if(mw && valStr(mw.getAttribute('content'))) return mw.getAttribute('content').replace(/\/+$/,'') + '/intake';
    return '/intake';
  }
  function resetForm(form){
    form.reset();
    ['email','company','vendors','budget','note'].forEach(id => fieldErr(id,''));
  }
  function buildUI(existingForm){
    // wrap existing or create new
    let root = document.querySelector('.cg-intake-shell');
    if(root) return existingForm || root.querySelector('form'); // already built

    root = el('div',{class:'cg-intake-shell'});
    const header = el('div',{class:'cg-intake-header'},[
      el('h1',{class:'cg-intake-title',text:'Request Enterprise'}),
      el('p',{class:'cg-intake-sub',text:'Tell us about your vendors. We will reach out with a plan and pricing.'})
    ]);

    // Prefer to reuse existing form fields if a form already exists.
    let form = existingForm;
    if(!form){
      form = el('form', {id:'enterprise-intake-form', method:'post', novalidate:'novalidate'});
      const grid = el('div',{class:'cg-grid'});

      // Email
      grid.appendChild(el('div',{class:'cg-row'},[
        el('label',{class:'cg-label',for:'email',text:'Company email'}),
        el('input',{id:'email',name:'email',type:'email',class:'cg-input',placeholder:'name@company.com',required:'required'}),
        el('div',{class:'cg-help',text:"We don't reject free emails, but a work email helps us verify context."}),
        el('div',{class:'cg-err','data-for':'email'})
      ]));
      // Company
      grid.appendChild(el('div',{class:'cg-row'},[
        el('label',{class:'cg-label',for:'company',text:'Company name'}),
        el('input',{id:'company',name:'company',type:'text',class:'cg-input',placeholder:'Acme Inc.',required:'required'}),
        el('div',{class:'cg-err','data-for':'company'})
      ]));
      // Vendors
      grid.appendChild(el('div',{class:'cg-row full'},[
        el('label',{class:'cg-label',for:'vendors',text:'Vendors to monitor (comma separated domains)'}),
        el('textarea',{id:'vendors',name:'vendors',class:'cg-textarea',placeholder:'okta.com, slack.com, box.com, ...',required:'required'}),
        el('div',{class:'cg-help',text:'We support pricing, terms, DPA, subprocessors, security, and status pages.'}),
        el('div',{class:'cg-err','data-for':'vendors'})
      ]));
      // Budget
      grid.appendChild(el('div',{class:'cg-row'},[
        el('label',{class:'cg-label',for:'budget',text:'Budget'}),
        el('select',{id:'budget',name:'budget',class:'cg-select'},[
          el('option',{value:'',text:'Select…'}),
          el('option',{value:'<3000',text:'Under $3,000/yr'}),
          el('option',{value:'3000-10000',text:'$3k–$10k/yr'}),
          el('option',{value:'10000-25000',text:'$10k–$25k/yr'}),
          el('option',{value:'>25000',text:'Over $25,000/yr'}),
          el('option',{value:'unsure',text:"Not sure yet"}),
        ]),
        el('div',{class:'cg-err','data-for':'budget'})
      ]));
      // Notes (optional)
      grid.appendChild(el('div',{class:'cg-row full'},[
        el('label',{class:'cg-label',for:'note',text:'Notes (optional)'}),
        el('textarea',{id:'note',name:'note',class:'cg-textarea',placeholder:'Anything else that would help?' }),
        el('div',{class:'cg-err','data-for':'note'})
      ]));

      form.appendChild(grid);
      const actions = el('div',{class:'cg-actions'},[
        el('button',{type:'submit',class:'cg-btn',id:'submitBtn',text:'Submit'}),
      ]);
      form.appendChild(actions);
    }else{
      // If form exists, ensure required ids are present or map them
      // Try to assign IDs to known inputs by name
      const map = {
        email: ['email','company_email','work_email'],
        company: ['company','company_name','org','organization'],
        vendors: ['vendors','domains','vendor_domains','vendors_list'],
        budget: ['budget','plan_budget','expected_budget'],
        note: ['note','notes','message','remark']
      };
      for(const [id, candidates] of Object.entries(map)){
        let node = document.getElementById(id);
        if(!node){
          for(const name of candidates){
            node = document.querySelector(`[name="${name}"]`);
            if(node) break;
          }
          if(node) node.id = id;
        }
        // add error holders if missing
        if(node && !document.querySelector(`.cg-err[data-for="${id}"]`)){
          const holder = el('div',{class:'cg-err','data-for':id});
          node.insertAdjacentElement('afterend', holder);
        }
      }
    }

    root.appendChild(header);
    if(!form.parentElement || form.parentElement !== root){
      // insert form into root
      root.appendChild(form);
    }
    // Inject into page main content
    // Prefer a central container if present
    const preferred = document.querySelector('main') || document.querySelector('#content') || document.body;
    preferred.appendChild(root);
    return form;
  }

  async function submitJSON(endpoint, payload){
    const resp = await fetch(endpoint,{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      mode:'cors',
      body: JSON.stringify(payload),
    });
    if (resp.ok) return {ok:true};
    // accept 204 (no content)
    if (resp.status === 204) return {ok:true};
    // try to parse ok:true from body
    try {
      const data = await resp.json().catch(()=>({}));
      if (data && (data.ok === true || data.status === 'ok')) return {ok:true};
    } catch(_) {}
    return {ok:false, status: resp.status};
  }

  async function submitNoCors(endpoint, payload){
    // no-cors with text/plain to bypass CORS; opaque response -> assume delivered
    try{
      await fetch(endpoint,{
        method:'POST',
        mode:'no-cors',
        headers:{'Content-Type':'text/plain;charset=UTF-8'},
        body: JSON.stringify(payload),
      });
      return {ok:true, opaque:true};
    }catch(e){
      return {ok:false, error:String(e)};
    }
  }

  function enhance(){
    injectCSS();
    // prefer an existing form if page already shipped one
    const existing = document.querySelector('form');
    const form = buildUI(existing);

    form.addEventListener('submit', async (ev)=>{
      ev.preventDefault();
      const email = document.getElementById('email');
      const company = document.getElementById('company');
      const vendors = document.getElementById('vendors');
      const budget = document.getElementById('budget');
      const note = document.getElementById('note');

      // reset errors
      ['email','company','vendors','budget','note'].forEach(id=>fieldErr(id,''));

      let hasErr=false;
      if(!email || !isEmail(email.value)){ fieldErr('email','Please enter a valid email.'); hasErr=true; }
      if(!company || !valStr(company.value)){ fieldErr('company','Please enter your company name.'); hasErr=true; }
      const vList = vendors ? parseVendors(vendors.value) : [];
      if(!vList.length){ fieldErr('vendors','Please enter at least one domain.'); hasErr=true; }

      if(hasErr){ banner('err','Please fill in the required fields.'); return; }

      const endpoint = endpointFromDOM(form);
      const payload = {
        email: valStr(email?.value),
        company: valStr(company?.value),
        vendors: vList,
        budget: valStr(budget?.value || ''),
        note: valStr(note?.value || ''),
        meta: {
          page: location.href,
          ts: new Date().toISOString(),
          ua: navigator.userAgent
        }
      };

      const btn = document.getElementById('submitBtn');
      const prev = btn ? btn.textContent : '';
      if(btn){ btn.disabled=true; btn.textContent='Submitting…'; }
      banner('ok','Submitting…');

      let ok=false, opaque=false, errMsg='';
      try{
        const r1 = await submitJSON(endpoint, payload);
        if(r1.ok){ ok=true; }
        else {
          const r2 = await submitNoCors(endpoint, payload);
          ok = r2.ok; opaque = !!r2.opaque;
        }
      }catch(e){
        errMsg = String(e);
      }finally{
        if(btn){ btn.disabled=false; btn.textContent=prev; }
      }

      if(ok){
        resetForm(form);
        banner('ok',"Submitted successfully. We'll get back to you shortly.");
      }else{
        console.error('[intake] submit failed', errMsg);
        banner('err',"Submission failed. Please retry or email sales@cg-alert.com.");
      }
    }, {once:false});
  }

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', enhance);
  else enhance();
})();
