// scripts/discovery/backoff_utils.js
exports.sleep = ms => new Promise(res=>setTimeout(res, ms));
exports.backoff = async function(fn, {tries=4, baseMs=400}={}){
  let lastErr; for(let i=0;i<tries;i++){ try{ return await fn(); }catch(e){ lastErr=e; await exports.sleep(baseMs * Math.pow(2,i)); } }
  throw lastErr || new Error('backoff failed');
};
