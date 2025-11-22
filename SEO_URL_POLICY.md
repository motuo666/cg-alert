# SEO URL & Indexing Policy (cg-alert)

This file documents the intended canonical & indexing behavior so that future
pages follow a consistent pattern.

## 1. Primary entry pages (indexable, self-canonical)

- `/` – main landing page  
- `/pricing/` – pricing  
- `/reports/` – vendor change reports index  
- `/who-uses/` – social proof / use cases  
- `/about/`, `/faq/`, `/seo/`, `/rss/`, `/terms/`, `/privacy/`

**Rules**

- Each of these pages should have a `<link rel="canonical">` pointing to its own
  final URL on `https://www.cg-alert.com/…` (with trailing slash).
- `noindex` is **not** used on these pages.

## 2. Long-tail report pages

- `/reports/{vendor-slug}/…`

**Rules**

- Self-canonical to their own `/reports/{vendor-slug}/` URL.
- These pages remain indexable so that vendor-specific queries can land here.

## 3. Debug / internal pages (noindex)

- `/reports/vendor/{date}/_last_poll.html` – internal polling diagnostics
- `/vendors/` and `/vendors/{demo-slug}/…` – static demo/sample pages in this repo

**Rules**

- All of these pages include:

  ```html
  <meta name="robots" content="noindex, nofollow">
  ```

- `robots.txt` disallows crawling of `/reports/vendor/` and `/vendors/`.
- Canonical for `_last_poll.html` points to `/reports/` so any stray signals
  are consolidated on the main reports index.

## 4. Scripts & technical directories

- `/api/`, `/cf/`, `/data/`, `/deploy/`, `/scripts/`, `/artifacts/` are
  disallowed in `robots.txt` and are not meant to be exposed as crawlable
  content.

## 5. Adding new pages

When introducing new routes:

- Decide if the page is **entry**, **long-tail content**, or **internal-only**.
- Apply the same combination of:
  - Self-canonical vs canonical-to-parent
  - `index` vs `noindex`
  - `robots.txt` allow vs disallow

Keeping these rules consistent avoids thin/duplicate content issues and keeps
search signals concentrated on the pages that matter for acquisition.
