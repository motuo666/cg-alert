#!/usr/bin/env node
/**
 * send_triggered.js
 *
 * Take latest evidence snapshots and email them to unsuppressed leads.
 * Safe mode:
 *  - If SMTP_* env not set, we just log and append to outreach_log.csv
 *  - Skip leads with status 'suppress'
 *  - Write sent_log.csv / outreach_log.csv for audit
 *
 * This is where the pitch is generated.
 */

const fs = require("fs");
const path = require("path");
let nodemailer;
try { nodemailer = require("nodemailer"); } catch(_){}

const {
  SMTP_HOST,
  SMTP_PORT,
  SMTP_USER,
  SMTP_PASS,
  MAIL_FROM,
  MAIL_POSTAL_ADDRESS,
  SITE_ORIGIN
} = process.env;

function readCsv(fp) {
  if (!fs.existsSync(fp)) return [];
  const txt=fs.readFileSync(fp,"utf8").trim();
  if(!txt) return [];
  const lines=txt.split(/\r?\n/).filter(Boolean);
  if(!lines.length)return[];
  const hdr=lines[0].split(",");
  return lines.slice(1).map(line=>{
    const cols=line.split(",");
    const o={};
    hdr.forEach((h,i)=>o[h]=(cols[i]||"").trim());
    return o;
  });
}
function writeCsv(fp, rows, header){
  const hdr = header || Array.from(new Set(rows.flatMap(r=>Object.keys(r))));
  const out=[hdr.join(",")];
  for(const r of rows){
    out.push(hdr.map(h=>(r[h]||"").replace(/[\r\n,]/g," ")).join(","));
  }
  fs.writeFileSync(fp,out.join("\n")+"\n","utf8");
}

function findLatestEvidence() {
  const root = path.join("public","evidence");
  const vendors = fs.existsSync(root) ? fs.readdirSync(root) : [];
  let latestCard = null;
  for (const v of vendors) {
    const vendorDir = path.join(root,v);
    if (!fs.statSync(vendorDir).isDirectory()) continue;
    const stamps = fs.readdirSync(vendorDir).filter(x=>{
      const p = path.join(vendorDir,x);
      return fs.statSync(p).isDirectory();
    }).sort().reverse();
    const latest = stamps[0];
    if (!latest) continue;
    const cardUrl = `${SITE_ORIGIN||"https://example.com"}/public/evidence/${v}/${latest}/index0.html`;
    latestCard = {vendor:v,timestamp:latest,url:cardUrl};
    break;
  }
  return latestCard;
}

async function main(){
  fs.mkdirSync("data",{recursive:true});

  // ensure log files
  const sentPath = path.join("data","sent_log.csv");
  const outPath  = path.join("data","outreach_log.csv");
  if (!fs.existsSync(sentPath)){
    fs.writeFileSync(sentPath,"timestamp,email,subject\n","utf8");
  }
  if (!fs.existsSync(outPath)){
    fs.writeFileSync(outPath,"timestamp,email,template_id\n","utf8");
  }

  const leadsPath = path.join("data","leads.csv");
  const leads = readCsv(leadsPath);

  const sentLog = readCsv(sentPath).map(r=>r.email.toLowerCase());
  const nowIso = new Date().toISOString();
  const card = findLatestEvidence();

  let transporter = null;
  let smtpReady = false;
  if (SMTP_HOST && SMTP_PORT && SMTP_USER && SMTP_PASS && nodemailer) {
    transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: Number(SMTP_PORT),
      secure: Number(SMTP_PORT) === 465,
      auth: { user: SMTP_USER, pass: SMTP_PASS }
    });
    smtpReady = true;
  } else {
    console.log("[send_triggered] SMTP not configured; will dry-run");
  }

  let subjectBase = "Your vendor quietly changed terms / pricing. You can use this.";
  if (card) {
    subjectBase = `[${card.vendor}] just changed terms / pricing. Use this in renewal.`;
  }

  for (const lead of leads) {
    const email = (lead.email||"").toLowerCase();
    if (!email) continue;
    if (lead.status === "suppress") continue;
    if (sentLog.includes(email)) continue;

    const bodyLines = [];
    if (card) {
      bodyLines.push(`We captured a timestamped change for ${card.vendor} at ${card.timestamp}.`);
      bodyLines.push(`Walk into renewal and say: "We have documented pricing / liability / subprocessor drift, justify this change."`);
      bodyLines.push(`Evidence card: ${card.url}`);
    } else {
      bodyLines.push("Vendors are drifting pricing / liability caps / DPA / sub-processors without real notice. We timestamp, hash, and hand you that leverage.");
    }
    bodyLines.push("");
    bodyLines.push("If you own renewals / compliance / procurement leverage, this cuts spend on every renewal.");
    bodyLines.push("");
    bodyLines.push("Buy Portfolio · $2,988/yr (personal access): https://example.com/buy/portfolio");
    bodyLines.push("Or request Enterprise coverage for your vendor list: https://example.com/intake");
    bodyLines.push("");
    bodyLines.push("Unsubscribe instantly via the link in any email.");
    bodyLines.push(`Postal address: ${MAIL_POSTAL_ADDRESS||"YOUR_POSTAL_ADDRESS"}`);

    const mailOptions = {
      from: MAIL_FROM || SMTP_USER || "ops@example.com",
      to: email,
      subject: subjectBase,
      text: bodyLines.join("\n")
    };

    if (smtpReady) {
      try {
        await transporter.sendMail(mailOptions);
        console.log("[send_triggered] sent to", email);
      } catch(e){
        console.log("[send_triggered] send fail", email, e.message);
      }
    } else {
      console.log("[send_triggered] dry-run email:", email);
    }

    // log
    fs.appendFileSync(sentPath, `${nowIso},${email},${subjectBase.replace(/[\r\n,]/g," ")}\n`,"utf8");
    fs.appendFileSync(outPath, `${nowIso},${email},p1\n`,"utf8");
  }

  console.log("[send_triggered] completed outreach cycle");
}

main().catch(err=>{
  console.error("[send_triggered] fatal", err);
  process.exit(0);
});
