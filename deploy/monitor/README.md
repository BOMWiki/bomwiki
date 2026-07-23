# BOMwiki origin monitor

This directory is the source of truth for the external origin monitor. It
runs on the old ERPai host and probes the new BOMwiki origin directly, while
retaining `bomwiki.com` as the TLS server name. Cloudflare is intentionally
bypassed, so a failure describes origin health rather than edge health.

The monitor is deliberately stateful:

- three consecutive failed probes change `UP` to `DOWN`;
- two consecutive successful probes change `DOWN` to `UP`;
- email is sent only for those two state transitions;
- failed transition email is queued for retry while health probes continue;
- curl's HTTP status, process exit code, and stderr are captured separately;
- the first failure, declared-down time, first recovery confirmation, and
  recovered time are recorded in UTC;
- every state-file replacement is atomic.

## Tracked files and live destinations

| Tracked file | Install on the old ERPai host |
| --- | --- |
| `bomwiki-monitor.sh` | `/usr/local/bin/bomwiki-monitor.sh` |
| `bomwiki-monitor.cron` | `/etc/cron.d/bomwiki-monitor` |

The runtime state remains outside the repository:

- `/etc/bomwiki-monitor/resend.key`: Resend API key, root-readable only;
- `/var/lib/bomwiki-monitor/`: state counters, incident timestamps, and the
  private transition-email queue;
- `/var/log/bomwiki-monitor.log`: probe, transition, and mail results.

This repository does not install these files automatically. After the change
has passed review and merged, an operator can install the reviewed copies:

```bash
install -d -m 0700 /etc/bomwiki-monitor /var/lib/bomwiki-monitor
install -m 0755 engine/deploy/monitor/bomwiki-monitor.sh \
  /usr/local/bin/bomwiki-monitor.sh
install -m 0644 engine/deploy/monitor/bomwiki-monitor.cron \
  /etc/cron.d/bomwiki-monitor
```

Do not replace `/etc/bomwiki-monitor/resend.key`. Its expected permissions are
`0600`, owned by root. The new script preserves the old lowercase `state`
value. It ignores the legacy `fails` file and starts its new failure and
success counters at zero.

Before considering the installation complete:

```bash
sh -n /usr/local/bin/bomwiki-monitor.sh
/usr/local/bin/bomwiki-monitor.sh --test-mail
test "$(stat -c %a /etc/cron.d/bomwiki-monitor)" = 644
systemctl is-active cron
curl --resolve bomwiki.com:443:178.156.185.138 \
  https://bomwiki.com/healthz
```

The cron entry uses `flock` to prevent overlapping probes. A normal probe
produces no stdout; details go to the monitor log.

## Configuration and testing overrides

Production uses the defaults in the script. Every operational value can be
overridden in the environment for a manual probe or an isolated test:

- `BOMWIKI_MONITOR_ORIGIN_IP`
- `BOMWIKI_MONITOR_HEALTH_URL`
- `BOMWIKI_MONITOR_RESOLVE_HOST`
- `BOMWIKI_MONITOR_RESOLVE_PORT`
- `BOMWIKI_MONITOR_MAIL_FROM`
- `BOMWIKI_MONITOR_MAIL_TO`
- `BOMWIKI_MONITOR_RESEND_URL`
- `BOMWIKI_MONITOR_KEY_FILE`
- `BOMWIKI_MONITOR_STATE_DIR`
- `BOMWIKI_MONITOR_LOG_FILE`
- `BOMWIKI_MONITOR_CURL_BIN`
- `BOMWIKI_MONITOR_PYTHON_BIN`
- `BOMWIKI_MONITOR_CURL_MAX_TIME`
- `BOMWIKI_MONITOR_MAIL_MAX_TIME`
- `BOMWIKI_MONITOR_FAILURE_THRESHOLD`
- `BOMWIKI_MONITOR_RECOVERY_THRESHOLD`
- `BOMWIKI_MONITOR_NOW`
- `BOMWIKI_MONITOR_DRY_RUN_MAIL`
- `BOMWIKI_MONITOR_DRY_RUN_MAIL_FAIL`
- `BOMWIKI_MONITOR_MAIL_CAPTURE`

`BOMWIKI_MONITOR_NOW`, dry-run mail, and mail capture exist for deterministic
testing. They should not be set by production cron.

Run the state-machine test from the repository root:

```bash
sh engine/deploy/monitor/test-bomwiki-monitor.sh
```
