function head({title, canonical, breadcrumbs=[]}) {
  const ld = {
    "@context":"https://schema.org",
    "@type":"BreadcrumbList",
    "itemListElement": breadcrumbs.map((b,i)=>({
      "@type":"ListItem","position":i+1,"name":b.name,"item":b.url
    }))
  };
  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<link rel="canonical" href="${canonical}">
<link rel="alternate" type="application/rss+xml" title="CG Alert Reports RSS" href="${ORIGIN}/reports/rss.xml">
<style>
:root { --fg:#0b0b0b; --muted:#666; --link:#0b57d0; }
body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,'Helvetica Neue',Arial,sans-serif;margin:0;color:var(--fg)}
.wrap{max-width:920px;margin:32px auto 64px;padding:0 16px}
h1{font-size:28px;margin:0 0 12px}
.muted{color:var(--muted);font-size:14px}
.crumb{font-size:14px;margin:8px 0 16px}
a{color:var(--link);text-decoration:none}a:hover{text-decoration:underline}
.nav{display:flex;gap:12px;margin:0 0 12px;font-size:14px}
.summary{display:flex;gap:16px;flex-wrap:wrap;margin:8px 0 16px}
.pill{padding:6px 10px;border-radius:999px;background:#f5f5f5;font-size:13px}
ul.list{margin:8px 0 24px 20px;line-height:1.6}
.grid{width:100%;border-collapse:collapse;margin:10px 0 24px}
.grid th,.grid td{border-bottom:1px solid #eee;padding:8px 6px;text-align:left}
.right{text-align:right}
footer{margin-top:36px;font-size:13px;color:var(--muted)}
</style>
<script type="application/ld+json">${JSON.stringify(ld)}</script>
</head><body><div class="wrap">
<div class="nav"><a href="${ORIGIN}/">Home</a> · <a href="${ORIGIN}/reports/">Reports</a></div>`;
}
