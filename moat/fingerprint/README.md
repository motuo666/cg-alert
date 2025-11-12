# Fingerprint Strategy

- Compose stable keys from: normalized URL, canonical vendor slug, detected artifact type, and normalized text hash.
- Normalize before hashing: lowercase, collapse whitespace, strip tracking params, remove volatile timestamps.
- Collisions: prefer newest `captured_at`, keep all raw artifacts but suppress duplicate notifications.
- Storage: persist fingerprint and its first-seen timestamp; use it to dedupe polls and outreach.
