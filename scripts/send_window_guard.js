// Guard: allow send only when local weekday/hour within configured window.
// Env: SEND_TZ, SEND_DAYS (Mon,Tue,Wed,Thu,Fri), SEND_START_HOUR (9), SEND_END_HOUR (20)
// Output: 'ok=true|false'
const tz = process.env.SEND_TZ || 'UTC';
const days = (process.env.SEND_DAYS || 'Mon,Tue,Wed,Thu,Fri').split(',').map(s=>s.trim().slice(0,3).toLowerCase());
const sh = parseInt(process.env.SEND_START_HOUR || '9', 10);
const eh = parseInt(process.env.SEND_END_HOUR || '20', 10);

function nowParts(){
  const fmt = new Intl.DateTimeFormat('en-US',{ timeZone: tz, weekday:'short', hour:'2-digit', hour12:false });
  const parts = Object.fromEntries(fmt.formatToParts(new Date()).map(p=>[p.type,p.value]));
  return { wd: (parts.weekday||'').slice(0,3).toLowerCase(), hour: parseInt(parts.hour||'0',10) };
}
const { wd, hour } = nowParts();
const ok = days.includes(wd) && hour >= sh && hour < eh;
process.stdout.write(`ok=${ok}\n`);
