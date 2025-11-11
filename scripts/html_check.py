import os, re, json
from bs4 import BeautifulSoup

BASE = "."
reports_dir = "reports/qa"
os.makedirs(reports_dir, exist_ok=True)

def read(p):
    with open(p,"rb") as f:
        return f.read().decode("utf-8", errors="replace")

files=[]
for root,_,fs in os.walk(BASE):
    for fn in fs:
        ext = os.path.splitext(fn)[1].lower()
        if ext in (".html",".htm"):
            files.append(os.path.join(root,fn))

all_rel = set([os.path.relpath(p, BASE) for p in files])

def norm(href):
    return href.split("#",1)[0].split("?",1)[0].strip()

rows=[]
for p in files:
    rel = os.path.relpath(p, BASE)
    soup = BeautifulSoup(read(p), "html.parser")
    empty=miss=broken=0; miss_alt=0
    title_ok = bool(soup.title and soup.title.text.strip())
    h1_ok = bool(soup.find("h1"))
    desc_ok = bool((soup.find("meta",attrs={"name":"description"}) and soup.find("meta",attrs={"name":"description"}).get("content")) or                    (soup.find("meta",attrs={"property":"og:description"}) and soup.find("meta",attrs={"property":"og:description"}).get("content")))
    for a in soup.find_all("a"):
        href = (a.get("href") or "").strip()
        if href in ("","#","javascript:void(0)","javascript:;"): empty+=1; continue
        if href.startswith(("http://","https://","mailto:","tel:")): continue
        base = norm(href)
        if not base: continue
        target = os.path.normpath(os.path.join(os.path.dirname(rel), base))
        if not os.path.exists(target): miss+=1
    for img in soup.find_all("img"):
        if not (img.get("alt") and img.get("alt").strip()): miss_alt += 1
        src = (img.get("src") or "").strip()
        if not src or src.startswith(("http://","https://","data:")): continue
        base = norm(src); 
        if not base: continue
        target = os.path.normpath(os.path.join(os.path.dirname(rel), base))
        if not os.path.exists(target): broken+=1
    rows.append({"file": rel, "title_ok":title_ok, "h1_ok":h1_ok, "desc_ok":desc_ok,
                 "empty_links":empty, "missing_rel":miss, "broken_imgs":broken, "missing_alt":miss_alt})

with open(os.path.join(reports_dir,"html_check.json"),"w",encoding="utf-8") as f:
    json.dump(rows, f, ensure_ascii=False, indent=2)

bad = [r for r in rows if (not (r["title_ok"] and r["h1_ok"] and r["desc_ok"])) or r["empty_links"] or r["missing_rel"] or r["broken_imgs"]]
exit(0 if len(bad)==0 else 1)
