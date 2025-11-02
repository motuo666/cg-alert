<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:cg="https://www.cg-alert.com/ns">
  <xsl:output method="html" encoding="UTF-8" indent="yes"/>
  <xsl:template match="/">
    <html lang="en"><head>
      <meta charset="utf-8"/>
      <meta name="viewport" content="width=device-width, initial-scale=1"/>
      <title><xsl:value-of select="rss/channel/title"/> — RSS</title>
      <style>
        :root { --brand: #0b1533; --accent: #3b5bdb; }
        body{font:16px/1.65 -apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:var(--brand);background:#fff;margin:0}
        header{position:sticky;top:0;background:var(--brand);color:#fff;padding:12px 16px;font-weight:600}
        header a{color:#fff;text-decoration:none;margin-right:16px}
        .wrap{max-width:1100px;margin:24px auto;padding:0 16px;}
        h1{margin:0 0 6px 0}.meta{color:#5b6a8a;margin:0 0 16px 0}
        table{width:100%;border-collapse:collapse;margin:12px 0;box-shadow:0 1px 3px rgba(0,0,0,.06);}
        th,td{text-align:left;padding:12px 10px;border-bottom:1px solid #e8edf7;vertical-align:top;font-size:15px}
        th{background:#f6f9ff;color:#243a6b;font-size:13px;text-transform:uppercase;letter-spacing:.02em}
        tr:hover td{background:#fafcff}
        a.item{color:var(--brand);text-decoration:none;font-weight:600}
        .desc{color:#2d3b59}.small{font-size:12px;color:#5b6a8a}.nowrap{white-space:nowrap;}
        .url a{color:#3b5bdb}
      </style>
    </head><body>
      <header>
        <a href="/">CG&nbsp;Alert</a>
        <a href="/#pricing">Pricing</a>
        <a href="/reports/">Reports</a>
        <a href="/reports/rss/">RSS</a>
      </header>
      <div class="wrap">
        <h1><xsl:value-of select="rss/channel/title"/></h1>
        <p class="meta">
          <b><xsl:value-of select="count(rss/channel/item)"/></b> items ·
          Updated <xsl:value-of select="rss/channel/lastBuildDate"/>
        </p>
        <table><thead><tr>
          <th>Title</th><th>Summary</th><th class="nowrap">When</th><th>Source URL</th><th>SHA256</th>
        </tr></thead><tbody>
          <xsl:for-each select="rss/channel/item">
            <tr>
              <td><a class="item"><xsl:attribute name="href"><xsl:value-of select="link"/></xsl:attribute><xsl:value-of select="title"/></a></td>
              <td class="desc"><xsl:value-of select="description" disable-output-escaping="yes"/></td>
              <td class="small nowrap"><xsl:value-of select="pubDate"/></td>
              <td class="url small"><a target="_blank" rel="noopener"><xsl:attribute name="href"><xsl:value-of select="cg:source | cg:sourceUrl | source | link"/></xsl:attribute><xsl:value-of select="cg:source | cg:sourceUrl | source | link"/></a></td>
              <td class="small"><xsl:value-of select="cg:sha256 | sha256"/></td>
            </tr>
          </xsl:for-each>
        </tbody></table>
        <p class="small">Raw feed URL: <code>/reports/rss.xml</code></p>
      </div>
    </body></html>
  </xsl:template>
</xsl:stylesheet>
