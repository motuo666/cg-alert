
import os, re, json, email, imaplib, datetime, hashlib
from pathlib import Path
from events_common import normalize_event, infer_category, domain_from_url

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
STATE = DATA / "ingest_state.json"
SEEDS = DATA / "seed_domains.txt"

IMAP_HOST = os.getenv("IMAP_HOST")
IMAP_PORT = int(os.getenv("IMAP_PORT","993"))
IMAP_USER = os.getenv("IMAP_USER")
IMAP_PASS = os.getenv("IMAP_PASS")
IMAP_FOLDER = os.getenv("IMAP_FOLDER","INBOX")

def load_state():
    if STATE.exists():
        try:
            return json.loads(STATE.read_text(encoding='utf-8'))
        except Exception:
            return {"seen": []}
    return {"seen": []}

def save_state(st):
    STATE.write_text(json.dumps(st, ensure_ascii=False, indent=2), encoding='utf-8')

def load_seed():
    if not SEEDS.exists():
        return set()
    return set([d.strip().lower() for d in SEEDS.read_text(encoding='utf-8').splitlines() if d.strip() and not d.strip().startswith("#")])

def urls_from_text(t):
    return re.findall(r'https?://[^\s<>\]\)"]+', t or "")

def connect():
    if not all([IMAP_HOST, IMAP_USER, IMAP_PASS]):
        print("IMAP secrets not set, skip.")
        return None
    M = imaplib.IMAP4_SSL(IMAP_HOST, IMAP_PORT)
    M.login(IMAP_USER, IMAP_PASS)
    M.select(IMAP_FOLDER)
    return M

def fetch_unseen(M):
    typ, data = M.search(None, 'UNSEEN')
    if typ != 'OK':
        return []
    return data[0].split()

def parse_msg(raw):
    msg = email.message_from_bytes(raw)
    sub = msg.get('Subject','')
    date_hdr = msg.get('Date','')
    try:
        from email.utils import parsedate_to_datetime
        dt = parsedate_to_datetime(date_hdr).astimezone(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    except Exception:
        dt = datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")
    body = ""
    if msg.is_multipart():
        for part in msg.walk():
            ctype = part.get_content_type()
            if ctype in ("text/plain","text/html"):
                try:
                    body += part.get_payload(decode=True).decode(part.get_content_charset() or "utf-8", errors="ignore") + "\n"
                except Exception:
                    pass
    else:
        try:
            body = msg.get_payload(decode=True).decode(msg.get_content_charset() or "utf-8", errors="ignore")
        except Exception:
            body = msg.get_payload()
    return sub, dt, body

def main():
    seeds = load_seed()
    st = load_state()
    seen = set(st.get("seen", []))
    out_items = []

    M = connect()
    if not M:
        print("IMAP disabled")
        return
    ids = fetch_unseen(M)
    for i in ids:
        typ, data = M.fetch(i, '(RFC822)')
        if typ != 'OK': 
            continue
        raw = data[0][1]
        sub, dt, body = parse_msg(raw)
        # urls
        cand = urls_from_text(sub+" "+body)
        cand = [u for u in cand if not u.lower().endswith((".png",".jpg",".jpeg",".gif",".svg",".pdf"))]
        cand = list(dict.fromkeys(cand))  # dedupe order
        for u in cand:
            ven = domain_from_url(u)
            if seeds and ven not in seeds: 
                continue
            key = hashlib.sha1((sub+"|"+u).encode()).hexdigest()
            if key in seen: 
                continue
            seen.add(key)
            item = normalize_event({
                "title": sub[:120] or "Vendor change",
                "url": u,
                "date": dt,
                "vendor": ven,
                "category": infer_category(sub+" "+u),
                "summary": sub[:240],
                "source": "email"
            })
            out_items.append(item)
    if out_items:
        DATA.mkdir(exist_ok=True, parents=True)
        path = DATA / "events.json"
        arr = []
        if path.exists():
            try:
                arr = json.loads(path.read_text(encoding='utf-8'))
                if isinstance(arr, dict): arr=[arr]
            except Exception:
                arr = []
        arr.extend(out_items)
        path.write_text(json.dumps(arr, ensure_ascii=False, indent=2), encoding='utf-8')
        st["seen"] = list(seen)
        save_state(st)
        print("ingested", len(out_items), "items")
    else:
        print("no new items")
    try:
        M.close(); M.logout()
    except Exception:
        pass

if __name__ == "__main__":
    main()
