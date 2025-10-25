// 假设你在 renderPack(vendor, CUR, rows, lastChange, ldJson) 里拼页面
// 替换 const html = `...` 整块为下面这个

const HEADER_BLOCK = `
<header class="app-header">
  <div class="nav container">
    <a class="logo" href="/"><img src="/icon.svg" alt="CG Alert">CG Alert</a>
    <a href="/reports/">Reports</a>
    <a href="/who-uses/">Who Uses</a>
    <a href="/rss.xml" rel="nofollow">RSS</a>
  </div>
</header>
`.trim();

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(vendor)} — Change Pack (${CUR})</title>
<meta name="description" content="Verifiable public changes for ${escapeHtml(vendor)} in ${CUR}">
<link rel="canonical" href="/reports/${CUR}/${escapeHtml(vendor)}/">

<!-- 结构化数据，保持你原来的 ldJson -->
<script type="application/ld+json">${ldJson}</script>

<!-- 全站样式 -->
<link rel="stylesheet" href="/styles.css">
<link rel="stylesheet" href="/assets/cg-theme.css">

<!-- 强制浅色+白底；统一布局；表格排版 -->
<style>
  body {
    background: #fff !important;
    color: #000 !important;
    margin: 0;
    line-height: 1.55;
    font-family: system-ui, Segoe UI, Arial, sans-serif;
  }
  main.page {
    max-width: 1200px;
    margin: 0 auto;
    padding: 24px;
  }
  .cta{
    display:flex;
    gap:8px;
    flex-wrap:wrap;
    margin:8px 0 16px;
    font-size:0.9rem;
    color:#444;
  }
  .pill{
    background:#eef;
    padding:4px 8px;
    border-radius:8px;
  }
  h1{
    font-size:1.25rem;
    font-weight:600;
    margin:16px 0 8px;
  }
  h2{
    font-size:1rem;
    font-weight:600;
    margin:24px 0 8px;
  }
  table{
    border-collapse:collapse;
    width:100%;
    font-size:.9rem;
  }
  th,td{
    border-bottom:1px solid #ddd;
    padding:8px 6px;
    text-align:left;
    vertical-align:top;
  }
  code{
    background:#f5f5f5;
    border-radius:4px;
    padding:2px 4px;
    font-size:.8rem;
  }
  a { color:#000; text-decoration:underline; }
</style>

<meta name="color-scheme" content="light">
<meta name="theme-color" content="#0b0">
</head>
<body>
${HEADER_BLOCK}
<main class="page container">

  <h1>${escapeHtml(vendor)} — Change Pack (${CUR})</h1>

  <div class="cta">
    <span class="pill">Last change: ${escapeHtml(lastChange)}</span>
    <a class="pill" href="/rss.xml" rel="nofollow">Follow RSS</a>
  </div>

  <h2>Changes</h2>
  <table>
    <thead>
      <tr>
        <th>Date (UTC)</th>
        <th>Type</th>
        <th>Hash</th>
        <th>Evidence</th>
        <th>Notes</th>
      </tr>
    </thead>
    <tbody>
      ${rows.map(r => {
        // !!! 关键：证据链接必须是绝对路径，不要 ./evidence 或 ../evidence
        const evidenceHref = "/evidence/" + encodeURIComponent(vendor) + "/" + r.file;
        return `
          <tr>
            <td>${escapeHtml(r.when)}</td>
            <td>${escapeHtml(r.kind)}</td>
            <td><code>#${escapeHtml(r.hash || "")}</code></td>
            <td><a href="${evidenceHref}" rel="nofollow">evidence</a></td>
            <td>${escapeHtml(r.note || "")}</td>
          </tr>
        `;
      }).join('')}
    </tbody>
  </table>

</main>
</body>
</html>`;
