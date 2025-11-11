import re, json, csv, datetime, hashlib
from urllib.parse import urlparse

CATEGORIES = {"pricing","terms","dpa","subprocessors","security","status","privacy","sla","other"}

def parse_iso(s):
    s = s.strip()
    if s.endswith("Z"):
        s = s[:-1]+"+00:00"
    return datetime.datetime.fromisoformat(s)

def to_iso_utc(dt):
    if dt.tzinfo is None:
        return dt.replace(tzinfo=datetime.timezone.utc).isoformat().replace("+00:00","Z")
    return dt.astimezone(datetime.timezone.utc).isoformat().replace("+00:00","Z")

def norm_vendor(v, url):
    v = (v or "").strip().lower()
    if not v and url:
        try:
            host = urlparse(url).netloc.lower().split(":")[0]
            if host.startswith("www."):
                host = host[4:]
            v = host
        except Exception:
            pass
    return v

def norm_category(c, url=""):
    c = (c or "").strip().lower()
    if c in CATEGORIES:
        return c
    text = (url or "") + " " + c
    if re.search(r'pricing|plans|price', text, re.I): return "pricing"
    if re.search(r'dpa|data processing', text, re.I): return "dpa"
    if re.search(r'sub-?processors?', text, re.I): return "subprocessors"
    if re.search(r'security|trust|vuln', text, re.I): return "security"
    if re.search(r'status|uptime|incident', text, re.I): return "status"
    if re.search(r'terms|tos|eula', text, re.I): return "terms"
    if re.search(r'privacy|gdpr|ccpa', text, re.I): return "privacy"
    if re.search(r'sla', text, re.I): return "sla"
    return "other"

def fingerprint(item):
    key = (item.get("vendor","") + "|" + item.get("url","") + "|" + (item.get("date","")[:10]))
    return hashlib.sha1(key.encode("utf-8")).hexdigest()

def clamp(s, n):
    s = (s or "").strip()
    return s if len(s)<=n else s[:n-1]+"…"
