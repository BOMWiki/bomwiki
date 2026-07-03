#!/bin/bash
# Nightly rebuild of the FFS graph sidecar from Postgres. A full rebuild
# (not an upsert) so BOM lines deleted on the wiki disappear from the
# graph too. The wiki degrades gracefully during the seconds the daemon
# is down. Run as root from cron; the exporter runs as the bomwiki user
# with the engine's environment.
set -euo pipefail

systemctl stop bomwiki-ffs
rm -f /opt/bomwiki/data/ffs/catalog.ffs*
systemctl start bomwiki-ffs
sleep 2
# engine.env is root-only; the exporter needs just the database URL and
# the sidecar address, so pass those through explicitly.
set -a; source /etc/bomwiki/engine.env; set +a
cd /opt/bomwiki/engine
sudo -u bomwiki DATABASE_URL="$DATABASE_URL" FFS_HOST="${FFS_HOST:-127.0.0.1}" FFS_PORT="${FFS_PORT:-8464}" \
  node scripts/export-ffs.ts /opt/bomwiki/data/ffs/export
