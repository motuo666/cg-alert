/**
 * scripts/send_bulk.js  —  stable v5
 * - List-Unsubscribe 头（邮件页可一键退订）
 * - 60–90s 随机节流（第三个参数传 75 即可）
 * - Slack 单条日志 & 汇总
 * - 写 data/sent_log.csv
 * - 自动跳过 unsubscribes.csv / trials.csv / bounces.csv
 * - 逗号或 Tab 都能解析（容错）
 *
 * CLI:
 *   node scripts/send_bulk.js <inputCsv> <limit> <baseDelaySec=0> [subjectTpl] [bodyTpl]
 *
 * ENV (GitHub Secrets 注入):
 *   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS,
 *   MAIL_FROM, MAIL_FROM_NAME, SLACK_WEBHOOK, CG_STAGE
 */

const fs = require("fs");
const nodemailer = require("nodemailer");
const { parse } = require("csv-parse/sync");

// -------- utils --------
const nowIso = () => new Date().toISOString();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const csvEscape = (s = "") => `"${String(s).replace(/"/g, '""')}"`;

function autoDelimiter(text) {
  const first = (text.split(/\r?\n/)[0] || "");
  return first.includes("\t") ? "\t" : ",";
}
function loadCsvRelax(path) {
  if (!fs.existsSync(path)) return [];
  const t = fs.readFileSync(path, "utf8");
  const delimiter = autoDelimiter(t);
  return parse(t, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
    delimiter,
  });
}
function ensureLog(path) {
  if (!fs.existsSync(path)) {
    fs.writeFileSync(path, "ts,email,stage,status,subject\n", "utf8");
  }
}
async function slack(text) {
  try {
    const url = process.env.SLACK_WEBHOOK;
    if (!url) return;
    await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
    });
  } catch (_) {}
}
function jitterFrom(base) {
  // 传 75 → 60–90 秒；最小 30 秒兜底
  const b = parseInt(base || "0", 10);
  if (!b) return 0;
  const j = b + Math.floor(Math.random() * 30 - 15);
  return Math.max(30, j);
}
function fmt(tpl, row) {
  const map = {
    company: row.company || "",
    domain: row.domain || "",
    v1: row.vendor1 || row.v1 || row.vendors || "",
    v2: row.vendor2 || row.v2 || "",
    v3: row.vendor3 || row.v3 || "",
  };
  return String(tpl || "").replace(/\{(company|domain|v1|v2|v3)\}/g, (_, k) => map[k] || "");
}

// -------- defaults by stage --------
function defaultSubject(stage) {
  if (stage === "2") return "Quick check before renewal — {v1}/{v2}";
  if (stage === "3") return "Last ping — vendor change alerts?";
  return "Vendor change alert — {v1}/{v2}";
}
function defaultBody(stage) {
  if (stage === "2")
    return (
      "Hi {company} team — quick check.\n" +
      "We saw public changes on {v1}/{v2}/{v3}. 7-day pilot, no login.\n" +
      "Reply “1” to start, or “9” to opt out.\n— CG Alert"
    );
  if (stage === "3")
    return (
      "Last note.\nWe alert only high-impact changes (pricing/ToS/DPA/sub-processors).\n" +
      "7-day pilot; reply “1” to start, “9” to opt out.\n— CG Alert"
    );
  return (
    "Hi {company} team,\nWe noticed public changes on {v1}/{v2}/{v3}.\n" +
    "We monitor pricing / ToS / DPA / sub-processors and alert only high-impact updates.\n" +
    "Reply “1” to start a 7-day pilot, “9” to opt out.\n— CG Alert"
  );
}

// -------- main --------
(async function main() {
  try {
    const input = process.argv[2] || "data/targets_stage1.csv";
    const limit = parseInt(process.argv[3] || "20", 10);
    const baseDelay = parseInt(process.argv[4] || "0", 10);
    const stage = String(process.env.CG_STAGE || "1");
    const subjTpl = process.argv[5] || defaultSubject(stage);
    const bodyTpl = process.argv[6] || defaultBody(stage);

    // SMTP
    const host = process.env.SMTP_HOST;
    const port = parseInt(process.env.SMTP_PORT || "465", 10);
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;
    const fromAddr = process.env.MAIL_FROM;
    const fromName = process.env.MAIL_FROM_NAME || "CG Alert";
    if (!host || !port || !user || !pass || !fromAddr) {
      console.error("Missing SMTP env (SMTP_HOST/PORT/USER/PASS, MAIL_FROM).");
      await slack("Outreach fatal → SMTP env missing");
      process.exit(1);
    }

    // 读取数据
    const rows = loadCsvRelax(input);
    if (!rows.length) {
      console.log(`No rows in ${input}`);
      await slack(`Outreach notice → ${input} empty`);
      return;
    }
    const unsub = loadCsvRelax("data/unsubscribes.csv").map((r) => (r.email || "").toLowerCase());
    const trials = loadCsvRelax("data/trials.csv").map((r) => (r.email || "").toLowerCase());
    const bounces = loadCsvRelax("data/bounces.csv").map((r) => (r.email || "").toLowerCase());
    const banned = new Set([...unsub, ...trials, ...bounces]);

    // 过滤目标
    const picked = [];
    const seen = new Set();
    for (const r of rows) {
      const email = (r.email || "").toLowerCase();
      if (!email || !email.includes("@")) continue;
      if (seen.has(email)) continue;
      seen.add(email);
      if (banned.has(email)) continue;
      picked.push(r);
      if (picked.length >= limit) break;
    }
    if (!picked.length) {
      console.log("No valid targets after filtering.");
      await slack("Outreach notice → no targets after filtering (unsub/trial/bounce)");
      return;
    }

    // transporter
    const transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465, // Zoho 465=SSL, 587=STARTTLS
      auth: { user, pass },
      pool: false,
    });

    ensureLog("data/sent_log.csv");

    await slack(`Outreach start → stage ${stage}, targets ${picked.length}, delay≈${baseDelay}s`);

    let ok = 0,
      fail = 0,
      sent = 0;
    for (const row of picked) {
      const to = (row.email || "").trim();
      const subject = fmt(subjTpl, row);
      const body = fmt(bodyTpl, row);

      try {
        await transporter.sendMail({
          from: `"${fromName}" <${fromAddr}>`,
          to,
          subject,
          text: body,
          headers: {
            "List-Unsubscribe": `<mailto:${fromAddr}?subject=9>`,
            "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
          },
        });

        fs.appendFileSync(
          "data/sent_log.csv",
          `${nowIso()},${to},${stage},OK,${csvEscape(subject)}\n`,
          "utf8"
        );
        ok++;
        sent++;
        await slack(`Outreach OK → ${to}`);
      } catch (e) {
        const code = e && (e.responseCode || e.code) ? ` ${e.responseCode || e.code}` : "";
        fs.appendFileSync(
          "data/sent_log.csv",
          `${nowIso()},${to},${stage},FAIL${code},${csvEscape(subject)}\n`,
          "utf8"
        );
        fail++;
        await slack(`Outreach FAIL${code} → ${to}`);
      }

      const wait = jitterFrom(baseDelay);
      if (wait) await sleep(wait * 1000);
    }

    await slack(`Outreach summary → stage ${stage}: sent ${sent}, OK ${ok}, FAIL ${fail}`);
    console.log(`Done. OK=${ok} FAIL=${fail}`);
  } catch (err) {
    console.error(err);
    await slack(`Outreach fatal → ${err.message || err}`);
    process.exit(1);
  }
})();
