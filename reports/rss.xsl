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
        body{font:16px/1.65 -apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Inter,Helvetica,Arial,sans-serif;color:var(--brand);background:#fff;margin:0}
        header{position:sticky;top:0;background:var(--brand);color:#fff;padding:12px 16px;font-weight:600}
        header a{color:#fff;text-decoration:none}
        main{max-width:960px;margin:24px auto;padding:0 16px}
        .item{display:block;border:1px solid #e6ebf5;border-radius:12px;padding:16px;margin:12px 0;text-decoration:none;color:inherit}
        .item:hover{box-shadow:0 4px 18px rgba(11,21,51,.08)}
        .meta{font-size:12px;color:#667}
        .pill{display:inline-block;background:#eef2ff;color:var(--brand);padding:2px 8px;border-radius:999px;font-size:12px;margin-left:8px}
      </style>
    </head><body>
      <header><a href="/">CG Alert — Reports</a></header>
      <main>
        <xsl:for-each select="rss/channel/item">
          <a class="item">
            <xsl:attribute name="href"><xsl:value-of select="link"/></xsl:attribute>
            <h3 style="margin:0 0 6px"><xsl:value-of select="title"/></h3>
            <div class="meta">
              <xsl:value-of select="pubDate"/>
              <xsl:if test="cg:sourceUrl"><span class="pill">Source</span></xsl:if>
              <xsl:if test="cg:sha256"><span class="pill">SHA</span></xsl:if>
            </div>
            <div><xsl:value-of select="description" disable-output-escaping="yes"/></div>
          </a>
        </xsl:for-each>
      </main>
    </body></html>
  </xsl:template>
</xsl:stylesheet>
