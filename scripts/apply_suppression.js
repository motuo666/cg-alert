// scripts/apply_suppression.js
// 作用：把退信 + 退订的邮箱统一打标成 suppress 写回 data/leads.csv
// 依赖：纯 Node 内置模块，无第三方依赖

const fs = require("fs");
const path = require("path");

// ---------- small CSV utils (robust with quotes) ----------

function parseCSV(text) {
  // returns array of objects [{header1:val, header2:val, ...}, ...]
  const rows = [];
  let row = [];
  let col = "";
  let inQuotes = false;

  const pushRow = () => {
    // skip completely empty trailing lines
    if (row.length === 1 && row[0].trim() === "") return;
    if (row.length === 0) return;
    rows.push(row);
    row = [];
  };

  for (let i = 0; i < text.length; i++) {
    const c = text[i];

    if (c === '"') {
      // handle escaped double quote ""
      if (inQuotes && text[i + 1] === '"') {
        col += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (c === "," && !inQuotes) {
      row.push(col);
      col = "";
    } else if ((c === "\n" || c === "\r") && !inQuotes) {
      row.push(col);
      col = "";
      // handle CRLF
      if (c === "\r" && text[i + 1] === "\n") {
        i++;
      }
      pushRow();
    } else {
      col += c;
    }
  }

  // flush last cell / row
  if (col !== "" || row.length > 0) {
    row.push(col);
    pushRow();
  }

  if (rows.length === 0) return [];

  const headers = rows[0].map((h) => h.trim());
  const out = [];

  for (let r = 1; r < rows.length; r++) {
    const arr = rows[r];
    if (!arr || arr.every((x) => (x || "").trim() === "")) continue;
    const obj = {};
    headers.forEach((h, idx) => {
      obj[h] = (arr[idx] || "").trim();
    });
    out.push(obj);
  }

  return { headers, rows: out };
}

function toCSV(rows, headers) {
  function esc(val) {
    const s = val == null ? "" : String(val);
    if (
      s.includes('"') ||
      s.includes(",") ||
      s.includes("\n") ||
      s.includes("\r")
    ) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  }

  const lines = [];
  lines.push(headers.join(","));
  for (const row of rows) {
    lines.push(headers.map((h) => esc(row[h] ?? "")).join(","));
  }
  return lines.join("\n");
}

// ---------- helper: load CSV safely (optional file) ----------

function loadCsvIfExists(filePath) {
  if (!fs.existsSync(filePath)) return { headers: [], rows: [] };
  const raw = fs.readFileSync(filePath, "utf8");
  if (!raw.trim()) return { headers: [], rows: [] };
  return parseCSV(raw);
}

// ---------- main ----------

const dataDir = path.join(__dirname, "..", "data");

const leadsPath = path.join(dataDir, "leads.csv");
const bouncesPath = path.join(dataDir, "bounces.csv");
const unsubPath = path.join(dataDir, "unsubscribes.csv");

// 1. 读 leads.csv
if (!fs.existsSync(leadsPath)) {
  console.error("FATAL: data/leads.csv 不存在，无法抑制。");
  process.exit(1);
}
const { headers: leadHeadersRaw, rows: leadRowsRaw } = parseCSV(
  fs.readFileSync(leadsPath, "utf8")
);
if (!leadRowsRaw.length) {
  console.warn("WARNING: leads.csv 是空的。");
}

// 2. 读 bounces.csv / unsubscribes.csv
const { rows: bounceRows } = loadCsvIfExists(bouncesPath);
const { rows: unsubRows } = loadCsvIfExists(unsubPath);

// 3. 组装需要封禁的邮箱列表（全部小写）
const blocked = new Set();

for (const r of bounceRows) {
  const e = (r.email || "").toLowerCase();
  if (e && e !== "unknown") {
    blocked.add(e);
  }
}
for (const r of unsubRows) {
  const e = (r.email || "").toLowerCase();
  if (e && e !== "unknown") {
    blocked.add(e);
  }
}

// 4. 确保 leads 里有 status 列
const leadHeaders = [...leadHeadersRaw];
if (!leadHeaders.includes("status")) {
  leadHeaders.push("status");
}

// 5. 更新 leads 行，命中就标记成 suppress
const updatedLeadRows = leadRowsRaw.map((row) => {
  const emailLower = (row.email || "").toLowerCase();
  if (blocked.has(emailLower)) {
    row.status = "suppress";
  } else {
    // 不要乱动已有状态。只有在没有status字段时才保持为空。
    if (!("status" in row)) {
      row.status = row.status || "";
    }
  }
  return row;
});

// 6. 写回 leads.csv（覆盖原文件）
const newLeadsCsv = toCSV(updatedLeadRows, leadHeaders);
fs.writeFileSync(leadsPath, newLeadsCsv, "utf8");

console.log(
  `OK: 已把 ${blocked.size} 个坏邮箱/退订邮箱标记为 suppress 并写回 data/leads.csv`
);
