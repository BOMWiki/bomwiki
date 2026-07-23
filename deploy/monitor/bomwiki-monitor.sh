#!/bin/sh
# External BOMwiki origin monitor.
#
# The production cron runs this script from the old ERPai host so the probe
# reaches the new origin from an independent network. The request bypasses
# Cloudflare deliberately and still uses bomwiki.com's TLS name.
set -u

ORIGIN_IP=${BOMWIKI_MONITOR_ORIGIN_IP:-178.156.185.138}
HEALTH_URL=${BOMWIKI_MONITOR_HEALTH_URL:-https://bomwiki.com/healthz}
RESOLVE_HOST=${BOMWIKI_MONITOR_RESOLVE_HOST:-bomwiki.com}
RESOLVE_PORT=${BOMWIKI_MONITOR_RESOLVE_PORT:-443}
MAIL_FROM=${BOMWIKI_MONITOR_MAIL_FROM:-BOMwiki Monitor <signin@bomwiki.com>}
MAIL_TO=${BOMWIKI_MONITOR_MAIL_TO:-sd@erp.ai}
RESEND_URL=${BOMWIKI_MONITOR_RESEND_URL:-https://api.resend.com/emails}
KEY_FILE=${BOMWIKI_MONITOR_KEY_FILE:-/etc/bomwiki-monitor/resend.key}
STATE_DIR=${BOMWIKI_MONITOR_STATE_DIR:-/var/lib/bomwiki-monitor}
LOG_FILE=${BOMWIKI_MONITOR_LOG_FILE:-/var/log/bomwiki-monitor.log}
CURL_BIN=${BOMWIKI_MONITOR_CURL_BIN:-curl}
PYTHON_BIN=${BOMWIKI_MONITOR_PYTHON_BIN:-python3}
CURL_MAX_TIME=${BOMWIKI_MONITOR_CURL_MAX_TIME:-15}
MAIL_MAX_TIME=${BOMWIKI_MONITOR_MAIL_MAX_TIME:-15}
FAILURE_THRESHOLD=${BOMWIKI_MONITOR_FAILURE_THRESHOLD:-3}
RECOVERY_THRESHOLD=${BOMWIKI_MONITOR_RECOVERY_THRESHOLD:-2}
DRY_RUN_MAIL=${BOMWIKI_MONITOR_DRY_RUN_MAIL:-0}
DRY_RUN_MAIL_FAIL=${BOMWIKI_MONITOR_DRY_RUN_MAIL_FAIL:-0}
MAIL_CAPTURE=${BOMWIKI_MONITOR_MAIL_CAPTURE:-}

STATE_FILE=$STATE_DIR/state
FAILURES_FILE=$STATE_DIR/consecutive-failures
SUCCESSES_FILE=$STATE_DIR/consecutive-successes
FIRST_FAILURE_FILE=$STATE_DIR/first-failure-at
DOWN_AT_FILE=$STATE_DIR/down-at
FIRST_RECOVERY_FILE=$STATE_DIR/first-recovery-success-at
NOTIFICATION_SEQUENCE_FILE=$STATE_DIR/notification-sequence
NOTIFICATION_QUEUE_DIR=$STATE_DIR/notifications

umask 077

utc_now() {
  if [ -n "${BOMWIKI_MONITOR_NOW:-}" ]; then
    printf '%s\n' "$BOMWIKI_MONITOR_NOW"
  else
    date -u +%Y-%m-%dT%H:%M:%SZ
  fi
}

log_line() {
  printf '%s %s\n' "$(utc_now)" "$*" >> "$LOG_FILE" 2>/dev/null || true
}

die() {
  log_line "fatal: $*"
  printf 'bomwiki-monitor: %s\n' "$*" >&2
  exit 1
}

is_positive_integer() {
  case "$1" in
    ''|*[!0-9]*|0) return 1 ;;
    *) return 0 ;;
  esac
}

read_counter() {
  value=$(cat "$1" 2>/dev/null || printf '0')
  case "$value" in
    ''|*[!0-9]*) printf '0\n' ;;
    *) printf '%s\n' "$value" ;;
  esac
}

read_text() {
  cat "$1" 2>/dev/null || true
}

atomic_write() {
  target=$1
  value=$2
  temporary=$(mktemp "$STATE_DIR/.state.XXXXXX") ||
    die "cannot create a temporary state file"
  if ! printf '%s\n' "$value" > "$temporary"; then
    rm -f "$temporary"
    die "cannot write temporary state for $target"
  fi
  chmod 600 "$temporary" 2>/dev/null || true
  if ! mv -f "$temporary" "$target"; then
    rm -f "$temporary"
    die "cannot replace state file $target"
  fi
}

single_line_file() {
  tr '\r\n' '  ' < "$1" |
    sed 's/[[:space:]][[:space:]]*/ /g; s/^ //; s/ $//' |
    cut -c 1-500
}

send_mail() {
  subject=$1
  body=$2

  if [ "$DRY_RUN_MAIL" = "1" ]; then
    if [ -n "$MAIL_CAPTURE" ]; then
      {
        printf '%s\n' '---MAIL---'
        printf 'subject=%s\n' "$subject"
        printf '%s\n' 'body<<EOF'
        printf '%s\n' "$body"
        printf '%s\n' 'EOF'
      } >> "$MAIL_CAPTURE"
    fi
    log_line "mail dry-run subject=$subject"
    if [ "$DRY_RUN_MAIL_FAIL" = "1" ]; then
      log_line "mail dry-run forced failure subject=$subject"
      return 1
    fi
    return 0
  fi

  [ -r "$KEY_FILE" ] || {
    log_line "mail failed: unreadable key file $KEY_FILE subject=$subject"
    return 1
  }
  command -v "$PYTHON_BIN" >/dev/null 2>&1 || {
    log_line "mail failed: $PYTHON_BIN is unavailable subject=$subject"
    return 1
  }

  key=$(cat "$KEY_FILE") || {
    log_line "mail failed: could not read key file $KEY_FILE subject=$subject"
    return 1
  }
  payload=$(
    "$PYTHON_BIN" -c \
      'import json,sys; print(json.dumps({"from":sys.argv[1],"to":[sys.argv[2]],"subject":sys.argv[3],"text":sys.argv[4]}))' \
      "$MAIL_FROM" "$MAIL_TO" "$subject" "$body"
  ) || {
    log_line "mail failed: could not encode JSON subject=$subject"
    return 1
  }

  response_file=$(mktemp "$STATE_DIR/.mail-response.XXXXXX") ||
    return 1
  error_file=$(mktemp "$STATE_DIR/.mail-error.XXXXXX") || {
    rm -f "$response_file"
    return 1
  }
  mail_http=$(
    {
      printf 'Authorization: Bearer %s\n' "$key"
      printf '%s\n' 'content-type: application/json'
    } |
      "$CURL_BIN" -sS -o "$response_file" -w '%{http_code}' \
        --max-time "$MAIL_MAX_TIME" \
        -X POST "$RESEND_URL" \
        -H @- \
        -d "$payload" 2> "$error_file"
  )
  mail_exit=$?
  [ -n "$mail_http" ] || mail_http=000
  mail_error=$(single_line_file "$error_file")

  rm -f "$response_file" "$error_file"
  key=
  payload=

  case "$mail_http" in
    2??)
      if [ "$mail_exit" -eq 0 ]; then
        log_line "mail sent http=$mail_http subject=$subject"
        return 0
      fi
      ;;
  esac

  [ -n "$mail_error" ] || mail_error=none
  log_line "mail failed http=$mail_http curl_exit=$mail_exit error=$mail_error subject=$subject"
  return 1
}

remove_notification() {
  notification_dir=$1
  rm -f \
    "$notification_dir/kind" \
    "$notification_dir/subject" \
    "$notification_dir/body" \
    "$notification_dir/committed"
  rmdir "$notification_dir" 2>/dev/null || true
}

queue_notification() {
  target_state=$1
  subject=$2
  body=$3

  notification_sequence=$(read_counter "$NOTIFICATION_SEQUENCE_FILE")
  notification_sequence=$((notification_sequence + 1))
  atomic_write "$NOTIFICATION_SEQUENCE_FILE" "$notification_sequence"
  notification_name=$(printf 'notification-%020d' "$notification_sequence")
  notification_temporary=$(mktemp -d "$STATE_DIR/.notification.XXXXXX") ||
    die "cannot create a temporary notification directory"
  chmod 700 "$notification_temporary" 2>/dev/null || true

  atomic_write "$notification_temporary/body" "$body"
  atomic_write "$notification_temporary/subject" "$subject"
  atomic_write "$notification_temporary/kind" "$target_state"

  QUEUED_NOTIFICATION_DIR=$NOTIFICATION_QUEUE_DIR/$notification_name
  if ! mv "$notification_temporary" "$QUEUED_NOTIFICATION_DIR"; then
    remove_notification "$notification_temporary"
    die "cannot queue notification $notification_name"
  fi
}

commit_notification() {
  atomic_write "$1/committed" yes
}

flush_notification_queue() {
  current_state=$1
  for notification_dir in "$NOTIFICATION_QUEUE_DIR"/notification-*; do
    [ -d "$notification_dir" ] || continue
    notification_kind=$(read_text "$notification_dir/kind")

    if [ ! -f "$notification_dir/committed" ]; then
      if [ "$notification_kind" != "$current_state" ]; then
        log_line "discarding uncommitted notification target=$notification_kind state=$current_state"
        remove_notification "$notification_dir"
        continue
      fi
      commit_notification "$notification_dir"
    fi

    notification_subject=$(read_text "$notification_dir/subject")
    notification_body=$(read_text "$notification_dir/body")
    if [ -z "$notification_kind" ] ||
      [ -z "$notification_subject" ] ||
      [ -z "$notification_body" ]; then
      log_line "discarding incomplete notification directory=$notification_dir"
      remove_notification "$notification_dir"
      continue
    fi

    if send_mail "$notification_subject" "$notification_body"; then
      remove_notification "$notification_dir"
      continue
    fi

    log_line "notification remains queued target=$notification_kind subject=$notification_subject"
    return 1
  done
  return 0
}

probe_origin() {
  PROBE_STARTED_AT=$(utc_now)
  probe_error_file=$(mktemp "$STATE_DIR/.probe-error.XXXXXX") ||
    die "cannot create probe error file"

  PROBE_HTTP_CODE=$(
    "$CURL_BIN" -sS -o /dev/null -w '%{http_code}' \
      --max-time "$CURL_MAX_TIME" \
      --resolve "$RESOLVE_HOST:$RESOLVE_PORT:$ORIGIN_IP" \
      "$HEALTH_URL" 2> "$probe_error_file"
  )
  PROBE_CURL_EXIT=$?
  PROBE_FINISHED_AT=$(utc_now)
  [ -n "$PROBE_HTTP_CODE" ] || PROBE_HTTP_CODE=000
  PROBE_CURL_ERROR=$(single_line_file "$probe_error_file")
  [ -n "$PROBE_CURL_ERROR" ] || PROBE_CURL_ERROR=none
  rm -f "$probe_error_file"

  [ "$PROBE_CURL_EXIT" -eq 0 ] && [ "$PROBE_HTTP_CODE" = "200" ]
}

is_positive_integer "$FAILURE_THRESHOLD" ||
  die "BOMWIKI_MONITOR_FAILURE_THRESHOLD must be a positive integer"
is_positive_integer "$RECOVERY_THRESHOLD" ||
  die "BOMWIKI_MONITOR_RECOVERY_THRESHOLD must be a positive integer"
is_positive_integer "$CURL_MAX_TIME" ||
  die "BOMWIKI_MONITOR_CURL_MAX_TIME must be a positive integer"
is_positive_integer "$MAIL_MAX_TIME" ||
  die "BOMWIKI_MONITOR_MAIL_MAX_TIME must be a positive integer"
is_positive_integer "$RESOLVE_PORT" ||
  die "BOMWIKI_MONITOR_RESOLVE_PORT must be a positive integer"

mkdir -p "$STATE_DIR" || die "cannot create state directory $STATE_DIR"
chmod 700 "$STATE_DIR" 2>/dev/null || true
mkdir -p "$NOTIFICATION_QUEUE_DIR" ||
  die "cannot create notification queue $NOTIFICATION_QUEUE_DIR"
chmod 700 "$NOTIFICATION_QUEUE_DIR" 2>/dev/null || true

case "${1:-}" in
  '')
    ;;
  --test-mail)
    now=$(utc_now)
    send_mail \
      "bomwiki.com monitor test" \
      "Test alert from the BOMwiki origin monitor at $now." ||
      exit 1
    exit 0
    ;;
  *)
    printf 'usage: %s [--test-mail]\n' "$0" >&2
    exit 2
    ;;
esac

state=$(read_text "$STATE_FILE")
case "$state" in
  up|down) ;;
  '') state=up ;;
  *)
    log_line "invalid state '$state'; resetting to up"
    state=up
    ;;
esac

failures=$(read_counter "$FAILURES_FILE")
successes=$(read_counter "$SUCCESSES_FILE")
first_failure_at=$(read_text "$FIRST_FAILURE_FILE")
down_at=$(read_text "$DOWN_AT_FILE")
first_recovery_at=$(read_text "$FIRST_RECOVERY_FILE")
atomic_write "$STATE_FILE" "$state"
NOTIFICATION_FLUSH_FAILED=0
flush_notification_queue "$state" || NOTIFICATION_FLUSH_FAILED=1

if probe_origin; then
  if [ "$state" = "up" ]; then
    if [ "$failures" -gt 0 ]; then
      log_line "probe recovered before DOWN threshold http=$PROBE_HTTP_CODE curl_exit=$PROBE_CURL_EXIT started=$PROBE_STARTED_AT finished=$PROBE_FINISHED_AT"
    fi
    atomic_write "$FAILURES_FILE" 0
    atomic_write "$SUCCESSES_FILE" 0
    atomic_write "$FIRST_FAILURE_FILE" ""
    atomic_write "$DOWN_AT_FILE" ""
    atomic_write "$FIRST_RECOVERY_FILE" ""
    atomic_write "$STATE_FILE" up
    exit 0
  fi

  failures=0
  successes=$((successes + 1))
  if [ "$successes" -eq 1 ] || [ -z "$first_recovery_at" ]; then
    first_recovery_at=$PROBE_FINISHED_AT
    atomic_write "$FIRST_RECOVERY_FILE" "$first_recovery_at"
  fi
  atomic_write "$FAILURES_FILE" "$failures"
  atomic_write "$SUCCESSES_FILE" "$successes"
  log_line "recovery confirmation=$successes/$RECOVERY_THRESHOLD http=$PROBE_HTTP_CODE started=$PROBE_STARTED_AT finished=$PROBE_FINISHED_AT"

  if [ "$successes" -ge "$RECOVERY_THRESHOLD" ]; then
    recovered_at=$PROBE_FINISHED_AT
    [ -n "$first_failure_at" ] || first_failure_at=unknown
    [ -n "$down_at" ] || down_at=unknown
    recovery_subject="🟢 bomwiki.com RECOVERED"
    recovery_body="BOMwiki origin health changed from DOWN to UP.

Origin: $ORIGIN_IP
Health URL: $HEALTH_URL
First failure (UTC): $first_failure_at
Declared down (UTC): $down_at
First successful confirmation (UTC): $first_recovery_at
Recovered (UTC): $recovered_at
Consecutive successful probes: $RECOVERY_THRESHOLD
Last probe HTTP status: $PROBE_HTTP_CODE
Last probe curl exit: $PROBE_CURL_EXIT
Last probe started (UTC): $PROBE_STARTED_AT
Last probe finished (UTC): $PROBE_FINISHED_AT"
    queue_notification up "$recovery_subject" "$recovery_body"
    atomic_write "$STATE_FILE" up
    commit_notification "$QUEUED_NOTIFICATION_DIR"
    atomic_write "$FAILURES_FILE" 0
    atomic_write "$SUCCESSES_FILE" 0
    atomic_write "$FIRST_FAILURE_FILE" ""
    atomic_write "$DOWN_AT_FILE" ""
    atomic_write "$FIRST_RECOVERY_FILE" ""
    log_line "transition DOWN->UP first_failure=$first_failure_at down_at=$down_at first_recovery=$first_recovery_at recovered_at=$recovered_at"
    if [ "$NOTIFICATION_FLUSH_FAILED" -eq 0 ]; then
      flush_notification_queue up || true
    fi
  fi
  exit 0
fi

successes=0
failures=$((failures + 1))
if [ "$state" = "up" ] && { [ "$failures" -eq 1 ] || [ -z "$first_failure_at" ]; }; then
  first_failure_at=$PROBE_STARTED_AT
  atomic_write "$FIRST_FAILURE_FILE" "$first_failure_at"
fi
atomic_write "$FAILURES_FILE" "$failures"
atomic_write "$SUCCESSES_FILE" "$successes"
atomic_write "$FIRST_RECOVERY_FILE" ""
log_line "failure=$failures/$FAILURE_THRESHOLD state=$state http=$PROBE_HTTP_CODE curl_exit=$PROBE_CURL_EXIT error=$PROBE_CURL_ERROR started=$PROBE_STARTED_AT finished=$PROBE_FINISHED_AT"

if [ "$state" = "up" ] && [ "$failures" -ge "$FAILURE_THRESHOLD" ]; then
  down_at=$PROBE_FINISHED_AT
  atomic_write "$DOWN_AT_FILE" "$down_at"
  down_subject="🔴 bomwiki.com DOWN - origin HTTP $PROBE_HTTP_CODE"
  down_body="BOMwiki origin health changed from UP to DOWN.

Origin: $ORIGIN_IP
Health URL: $HEALTH_URL
First failure (UTC): $first_failure_at
Declared down (UTC): $down_at
Consecutive failed probes: $failures
Last probe HTTP status: $PROBE_HTTP_CODE
Last probe curl exit: $PROBE_CURL_EXIT
Last probe curl error: $PROBE_CURL_ERROR
Last probe started (UTC): $PROBE_STARTED_AT
Last probe finished (UTC): $PROBE_FINISHED_AT"
  queue_notification down "$down_subject" "$down_body"
  atomic_write "$STATE_FILE" down
  commit_notification "$QUEUED_NOTIFICATION_DIR"
  log_line "transition UP->DOWN first_failure=$first_failure_at down_at=$down_at http=$PROBE_HTTP_CODE curl_exit=$PROBE_CURL_EXIT error=$PROBE_CURL_ERROR"
  if [ "$NOTIFICATION_FLUSH_FAILED" -eq 0 ]; then
    flush_notification_queue down || true
  fi
fi

exit 0
