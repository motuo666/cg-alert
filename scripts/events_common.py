
import re, html, hashlib, datetime, json, urllib.parse

CATEGORIES = {"pricing","terms","dpa","subprocessors","security","status","privacy","sla","other"}

def utc_iso(dt):
    if isinstance(dt, str):
        # Try parse a few common patterns
        s = dt.strip()
        try:
            # If already endswith Z
            if s.endswith('Z'):
                datetime.datetime.strptime(s, "%Y-%m-%dT%H:%M:%SZ")
                return s
        except Exception:
            pass
        # Try flex parse
        try:
            from datetime import timezone
            d = datetime.datetime.fromisoformat(s.replace('Z','+00:00'))
            return d.astimezone(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        except Exception:
            pass
    # Fallback now
    return datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")

def domain_from_url(u):
    try:
        netloc = urllib.parse.urlparse(u).netloc.lower()
        # strip port
        if ':' in netloc: netloc = netloc.split(':',1)[0]
        # take registered-like part (rough heuristic)
        parts = netloc.split('.')
        if len(parts) >= 2:
            return ".".join(parts[-2:])
        return netloc
    except Exception:
        return ""

def slugify(s, maxlen=80):
    s = s.lower()
    s = re.sub(r'[^a-z0-9]+','-', s).strip('-')
    return s[:maxlen] or "item"

def infer_category(text_or_url):
    t = (text_or_url or "").lower()
    if any(k in t for k in ["price","pricing","plan","billing"]): return "pricing"
    if "subprocessor" in t or "sub-process" in t: return "subprocessors"
    if "dpa" in t or "data processing" in t: return "dpa"
    if "term" in t or "/terms" in t: return "terms"
    if "privacy" in t: return "privacy"
    if "security" in t: return "security"
    if "/status" in t: return "status"
    if "sla" in t: return "sla"
    return "other"

def event_fingerprint(e):
    # Prefer url
    u = (e.get("url") or "").strip().lower()
    if u: return "u:" + hashlib.sha1(u.encode()).hexdigest()
    # Then id
    i = (e.get("id") or "").strip().lower()
    if i: return "i:" + hashlib.sha1(i.encode()).hexdigest()
    # Then title+date
    td = ((e.get("title") or "") + "|" + (e.get("date") or "")).lower()
    return "t:" + hashlib.sha1(td.encode()).hexdigest()

def normalize_event(e):
    e = dict(e)
    e["title"] = (e.get("title") or "").strip()[:120] or "Untitled"
    e["url"] = (e.get("url") or "").strip()
    e["date"] = utc_iso(e.get("date") or "")
    if not e.get("vendor"):
        e["vendor"] = domain_from_url(e.get("url",""))
    e["vendor"] = (e.get("vendor") or "").lower()
    cat = (e.get("category") or "").lower().strip()
    if cat not in CATEGORIES:
        cat = infer_category(e.get("url","") + " " + e.get("title",""))
    if cat not in CATEGORIES: cat = "other"
    e["category"] = cat
    s = (e.get("summary") or "").strip()
    if len(s) > 240: s = s[:237] + "..."
    e["summary"] = s or e["title"]
    if not e.get("id"):
        e["id"] = f"{slugify(e['vendor'])}-{e['date'][:10]}-{slugify(e['category'])}-{slugify(e['title'])[:16]}"
    if e.get("tags"):
        e["tags"] = ",".join([t.strip() for t in str(e["tags"]).split(",") if t.strip()])
    return e
