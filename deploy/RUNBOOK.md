# Hosting the engine on bomwiki.com

The engine replaces the static build as bomwiki.com's origin. Everything
below is operator work on the Hetzner box; none of it runs from CI yet.
Nothing here touches the live static site until the final Caddy step, and
that step is a one-line revert if anything looks wrong.

## 0. Prerequisites on the box

- Node 22+ (`node --experimental-strip-types` must work)
- Postgres 15+ with a `bomwiki` database and user
- The bomwiki-intelligence binary (optional): build once with
  `cargo build --release`, run under its own unit on 127.0.0.1:8799

## 1. Files

```
/opt/bomwiki/engine     <- this directory (rsync or git checkout of engine/)
/opt/bomwiki/public     <- the old site's public/ tree (img/, og/, favicons)
/opt/bomwiki/data       <- images.json, galleries.json (from src/data/)
/etc/bomwiki/engine.env <- from deploy/engine.env.example, secrets filled
```

`npm ci --omit=dev` inside /opt/bomwiki/engine (three runtime deps).

## 2. Database

```bash
sudo -u bomwiki node --experimental-strip-types scripts/migrate.ts
# One-time: import the graph. Run the exporter on a machine with the old
# site checked out, copy the JSON, then:
sudo -u bomwiki node --experimental-strip-types scripts/import.ts /path/to/graph-export.json
# Triage the imported catalog:
sudo -u bomwiki node --experimental-strip-types scripts/suspicion-score.ts reports/cleanup-worklist.md --mark-clean
```

## 3. Service

```bash
cp deploy/bomwiki-engine.service /etc/systemd/system/
systemctl daemon-reload && systemctl enable --now bomwiki-engine
curl -s localhost:4400/healthz   # {"ok":true,"nodes":192471}
```

## 4. Caddy

Stage first on a preview hostname, then flip the main site:

```
# preview (safe, do this first)
preview.bomwiki.com {
  reverse_proxy 127.0.0.1:4400
}

# the flip: replace bomwiki.com's static file_server/root block with
bomwiki.com, www.bomwiki.com {
  reverse_proxy 127.0.0.1:4400
}
```

Rollback = restore the previous Caddy block and reload. The static release
directories stay on disk untouched.

## 5. Post-flip checklist

- `/healthz` through the domain
- sign in with ADMIN_TOKEN, make an edit, watch it publish in ~10ms
- magic-link signup with MAIL_API_KEY set (or confirm sign-in is inert
  without it); DEV_SHOW_MAGIC_LINK must be 0
- Cloudflare: purge everything once; item/home pages then cache at the edge
  (cache-control is set by the engine)
- backups: pg_dump on a timer — the database is now the site
```
pg_dump bomwiki | gzip > /var/backups/bomwiki-$(date +%F).sql.gz
```

## 6. 3D model layer (CAD files)

Contributed model files live outside the deployed tree, in
`/var/lib/bomwiki-models` (created by the unit's `StateDirectory` — after
updating the unit run `systemctl daemon-reload && systemctl restart
bomwiki-engine`). `MODELS_DIR` in engine.env must point there; without it the
engine falls back to `engine/var/models`, which is read-only under
`/opt/bomwiki` and uploads will 500.

Deploy steps when first shipping this feature:

```
npm run migrate                      # applies schema/0013_models.sql
cp deploy/bomwiki-engine.service /etc/systemd/system/bomwiki-engine.service
systemctl daemon-reload && systemctl restart bomwiki-engine
ls -ld /var/lib/bomwiki-models       # owned by bomwiki, writable
```

Maintenance: `node --experimental-strip-types scripts/models-gc.ts` sweeps
uploads that never became submissions (7-day grace), stray files, and dead
tmp streams — sensible as a weekly cron. Model files are NOT in the pg_dump;
include `/var/lib/bomwiki-models` in file backups.

Smoke: `scripts/models-smoke.ts` (needs ENGINE_URL, ADMIN_TOKEN,
DATABASE_URL, and DEV_SHOW_MAGIC_LINK=1, so dev/staging only).

## What CI does NOT yet do

Deploys of engine code are manual (rsync + systemctl restart). Wiring the
existing deploy workflow to do this is a follow-up; the repo rule stands —
live changes go through PRs to main once that wiring exists.
