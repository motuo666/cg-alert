#!/usr/bin/env python3
import re, os, sys, pathlib

ROOT = pathlib.Path(".")
WF_DIR = ROOT / ".github" / "workflows"

ENV_BLOCK = """env:
  SITE_ORIGIN: ${{ vars.SITE_ORIGIN }}
  WORKER_URL:  ${{ vars.WORKER_URL }}
  UNSUB_ORIGIN: ${{ vars.UNSUB_ORIGIN }}
  INTAKE_FORM_URL: ${{ vars.INTAKE_FORM_URL }}

  MAIL_FROM: ${{ vars.MAIL_FROM }}
  REPLY_TO:  ${{ vars.REPLY_TO }}
  SENDER_NAME: ${{ vars.SENDER_NAME }}
  MAIL_POSTAL_ADDRESS: ${{ vars.MAIL_POSTAL_ADDRESS }}
  MAIL_RETURN_PATH: ${{ vars.MAIL_RETURN_PATH }}
  BCC_TO: ${{ secrets.BCC_TO }}

  SLACK_WEBHOOK_URL: ${{ secrets.SLACK_WEBHOOK_URL || vars.SLACK_WEBHOOK_URL }}

  SMTP_HOST: ${{ secrets.SMTP_HOST }}
  SMTP_PORT: ${{ secrets.SMTP_PORT }}
  SMTP_USER: ${{ secrets.SMTP_USER }}
  SMTP_PASS: ${{ secrets.SMTP_PASS }}
  IMAP_HOST: ${{ secrets.IMAP_HOST }}
  IMAP_PORT: ${{ secrets.IMAP_PORT }}
  IMAP_USER: ${{ secrets.IMAP_USER }}
  IMAP_PASS: ${{ secrets.IMAP_PASS }}

  CF_ACCOUNT_ID: ${{ vars.CF_ACCOUNT_ID }}
  CF_API_TOKEN:  ${{ secrets.CF_API_TOKEN }}
  KV_NAMESPACE_ID: ${{ vars.KV_NAMESPACE_ID || secrets.KV_NAMESPACE_ID }}
  KV_LEADS_ID:    ${{ vars.KV_LEADS_ID || secrets.KV_LEADS_ID }}

  STRIPE_LINK_PORTFOLIO: ${{ vars.STRIPE_LINK_PORTFOLIO || secrets.STRIPE_LINK_PORTFOLIO }}
  STRIPE_LINK_BUSINESS:  ${{ vars.STRIPE_LINK_BUSINESS  || secrets.STRIPE_LINK_BUSINESS  }}
  STRIPE_WEBHOOK_SECRET: ${{ secrets.STRIPE_WEBHOOK_SECRET }}

  INDEXNOW_KEY: ${{ secrets.INDEXNOW_KEY }}
  OBS_KEY: ${{ secrets.OBS_KEY }}
  ENRICH_API_TOKEN: ${{ secrets.ENRICH_API_TOKEN }}

  TARGET_DISCOVERY_API_URL:   ${{ vars.TARGET_DISCOVERY_API_URL }}
  TARGET_DISCOVERY_API_TOKEN: ${{ secrets.TARGET_DISCOVERY_API_TOKEN }}

  MIN_HASH_RATIO: ${{ vars.MIN_HASH_RATIO }}
  MIN_SENT7_FOR_DLVR: ${{ vars.MIN_SENT7_FOR_DLVR }}
  P95_TTD_MAX_HOURS: ${{ vars.P95_TTD_MAX_HOURS }}
  TARGET_EVID_TODAY: ${{ vars.TARGET_EVID_TODAY }}
  TARGET_SENT: ${{ vars.TARGET_SENT }}
  TTD_LOOKBACK_HOURS: ${{ vars.TTD_LOOKBACK_HOURS }}
  UNSUB_7D_MAX: ${{ vars.UNSUB_7D_MAX }}
  COMPLAINT_7D_MAX: ${{ vars.COMPLAINT_7D_MAX }}
  BOUNCE_7D_MAX: ${{ vars.BOUNCE_7D_MAX }}
  REQUIRE_CHANGED_VENDORS: ${{ vars.REQUIRE_CHANGED_VENDORS }}
"""

def read_text(p):
    with open(p, 'r', encoding='utf-8', errors='ignore') as f:
        return f.read().replace('\r\n','\n')

def write_text(p, s):
    p.parent.mkdir(parents=True, exist_ok=True)
    with open(p, 'w', encoding='utf-8') as f:
        f.write(s)

def strip_bom(s: str) -> str:
    if s.startswith('\ufeff'):  # BOM
        return s.lstrip('\ufeff')
    return s

def remove_disable_gates(s: str) -> str:
    # remove any "if: ${{ false }}" at any indent
    return re.sub(r'^[ \t]*if:\s*\$\{\{\s*false\s*\}\}[^\n]*\n?', '', s, flags=re.M)

def drop_top_env(s: str) -> str:
    # Remove a top-level 'env:' mapping (env:\n  ...)\n until the next top-level key or EOF
    lines = s.split('\n')
    out = []
    i = 0
    while i < len(lines):
        if re.match(r'^env:\s*$', lines[i]):  # top-level
            i += 1
            # consume until next top-level key (non-indented or document boundary)
            while i < len(lines):
                l = lines[i]
                if re.match(r'^[A-Za-z_][\w-]*:\s*$', l) or re.match(r'^(on|jobs|permissions|defaults|concurrency|name):\s*', l):
                    break
                i += 1
            # skip contiguous blank lines after removal
            while i < len(lines) and lines[i].strip() == '':
                i += 1
            continue
        out.append(lines[i])
        i += 1
    return '\n'.join(out).strip('\n') + '\n'

def insert_top_env_safe(s: str) -> str:
    # Insert ENV_BLOCK after optional '---' or initial comments, and before 'on:' to avoid nesting
    lines = s.split('\n')
    insert_at = 0
    # skip YAML doc start and comments/blank
    while insert_at < len(lines) and (lines[insert_at].strip().startswith('#') or lines[insert_at].strip()=='' or lines[insert_at].strip()=='---'):
        insert_at += 1
    # If first non-comment is 'name: ...', keep name above env
    if insert_at < len(lines) and re.match(r'^name:\s*', lines[insert_at]):
        insert_at += 1
        # skip any following comment/blank
        while insert_at < len(lines) and (lines[insert_at].strip()=='' or lines[insert_at].strip().startswith('#')):
            insert_at += 1
    new = []
    new.extend(lines[:insert_at])
    # ensure blank line before env if needed
    if new and new[-1].strip() != '':
        new.append('')
    new.extend(ENV_BLOCK.strip('\n').split('\n'))
    new.append('')
    new.extend(lines[insert_at:])
    return '\n'.join(new).strip('\n') + '\n'

def repair_file(p: pathlib.Path):
    s = read_text(p)
    s = strip_bom(s)
    s = remove_disable_gates(s)
    s = drop_top_env(s)
    s = insert_top_env_safe(s)
    write_text(p, s)

def main():
    if not WF_DIR.exists():
        print("No .github/workflows, nothing to do")
        return
    for f in WF_DIR.iterdir():
        if not f.is_file(): continue
        if f.suffix.lower() not in ('.yml', '.yaml'): continue
        if f.name in ('repair-workflows.yml', 'patch-env-fallback.yml'):
            # don't touch ourselves or previous patcher if present
            continue
        try:
            repair_file(f)
            print("repaired:", f.name)
        except Exception as e:
            print("ERROR:", f.name, e, file=sys.stderr)

if __name__ == '__main__':
    main()
