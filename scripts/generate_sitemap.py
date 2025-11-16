#!/usr/bin/env python3
# 自动生成 sitemap.xml
import os, time, xml.etree.ElementTree as ET
from urllib.parse import urljoin

BASE_URL = os.environ.get("SITE_BASE_URL", "https://example.com")
CONTENT_DIR = os.environ.get("SITE_CONTENT_DIR", "./")

def find_html_files(root):
    for dirpath, _, filenames in os.walk(root):
        for fn in filenames:
            if fn.lower().endswith((".html", ".htm")):
                yield os.path.join(dirpath, fn)

def make_sitemap(urls):
    urlset = ET.Element("urlset", xmlns="http://www.sitemaps.org/schemas/sitemap/0.9")
    for u in urls:
        url = ET.SubElement(urlset, "url")
        loc = ET.SubElement(url, "loc"); loc.text = u
        lastmod = ET.SubElement(url, "lastmod"); lastmod.text = time.strftime("%Y-%m-%d")
        changefreq = ET.SubElement(url, "changefreq"); changefreq.text = "weekly"
        priority = ET.SubElement(url, "priority"); priority.text = "0.7"
    return ET.ElementTree(urlset)

if __name__ == "__main__":
    urls = []
    for fp in find_html_files(CONTENT_DIR):
        rel = os.path.relpath(fp, CONTENT_DIR).replace(os.sep, "/")
        if rel.endswith("index.html"):
            rel = rel[:-10]  # drop index.html
        urls.append(urljoin(BASE_URL + "/", rel))
    tree = make_sitemap(urls)
    tree.write("sitemap.xml", encoding="utf-8", xml_declaration=True)
    print(f"生成 sitemap.xml, 包含 {len(urls)} 个页面。")
