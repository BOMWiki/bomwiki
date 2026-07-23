#!/bin/sh
# Deterministic state-machine test for bomwiki-monitor.sh.
set -eu

HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
MONITOR=$HERE/bomwiki-monitor.sh
TEST_ROOT=$(mktemp -d "${TMPDIR:-/tmp}/bomwiki-monitor-test.XXXXXX")
trap 'rm -rf "$TEST_ROOT"' EXIT HUP INT TERM

STATE_DIR=$TEST_ROOT/state
LOG_FILE=$TEST_ROOT/monitor.log
MAIL_CAPTURE=$TEST_ROOT/mail.capture
CURL_STUB=$TEST_ROOT/curl-stub

mkdir -p "$STATE_DIR"

cat > "$CURL_STUB" <<'STUB'
#!/bin/sh
if [ "${TEST_MAIL_MODE:-0}" = "1" ]; then
  case " $* " in
    *test-resend-secret*)
      printf '%s\n' "secret appeared in curl arguments" >&2
      exit 97
      ;;
  esac
  headers=$(cat)
  case "$headers" in
    *"Authorization: Bearer test-resend-secret"*) ;;
    *)
      printf '%s\n' "authorization header was not provided on stdin" >&2
      exit 96
      ;;
  esac
  printf '%s' 202
  exit 0
fi
printf '%s' "${TEST_HTTP_CODE:-200}"
if [ -n "${TEST_CURL_ERROR:-}" ]; then
  printf '%s\n' "$TEST_CURL_ERROR" >&2
fi
exit "${TEST_CURL_EXIT:-0}"
STUB
chmod 0755 "$CURL_STUB"

fail() {
  printf 'not ok - %s\n' "$*" >&2
  exit 1
}

assert_file_value() {
  file=$1
  expected=$2
  actual=$(cat "$file" 2>/dev/null || true)
  [ "$actual" = "$expected" ] ||
    fail "$file: expected '$expected', got '$actual'"
}

assert_mail_count() {
  expected=$1
  if [ -f "$MAIL_CAPTURE" ]; then
    actual=$(grep -c '^subject=' "$MAIL_CAPTURE" 2>/dev/null || true)
  else
    actual=0
  fi
  [ "$actual" = "$expected" ] ||
    fail "expected $expected mail attempts, got $actual"
}

assert_queue_count() {
  expected=$1
  actual=0
  for notification_dir in "$STATE_DIR"/notifications/notification-*; do
    [ -d "$notification_dir" ] || continue
    actual=$((actual + 1))
  done
  [ "$actual" = "$expected" ] ||
    fail "expected $expected queued notifications, got $actual"
}

assert_contains() {
  file=$1
  expected=$2
  grep -F "$expected" "$file" >/dev/null 2>&1 ||
    fail "$file does not contain '$expected'"
}

assert_not_contains() {
  file=$1
  unexpected=$2
  if grep -F "$unexpected" "$file" >/dev/null 2>&1; then
    fail "$file unexpectedly contains '$unexpected'"
  fi
}

file_mode() {
  stat -f '%Lp' "$1" 2>/dev/null || stat -c '%a' "$1"
}

run_probe() {
  timestamp=$1
  http_code=$2
  curl_exit=$3
  curl_error=$4
  mail_fail=${5:-0}

  BOMWIKI_MONITOR_STATE_DIR=$STATE_DIR \
  BOMWIKI_MONITOR_LOG_FILE=$LOG_FILE \
  BOMWIKI_MONITOR_CURL_BIN=$CURL_STUB \
  BOMWIKI_MONITOR_NOW=$timestamp \
  BOMWIKI_MONITOR_DRY_RUN_MAIL=1 \
  BOMWIKI_MONITOR_DRY_RUN_MAIL_FAIL=$mail_fail \
  BOMWIKI_MONITOR_MAIL_CAPTURE=$MAIL_CAPTURE \
  TEST_HTTP_CODE=$http_code \
  TEST_CURL_EXIT=$curl_exit \
  TEST_CURL_ERROR=$curl_error \
    sh "$MONITOR"
}

# The real mail path passes the Resend key through stdin, not process
# arguments. The stub consumes that header without making a network request.
TEST_KEY_FILE=$TEST_ROOT/resend.key
printf '%s\n' test-resend-secret > "$TEST_KEY_FILE"
chmod 0600 "$TEST_KEY_FILE"
BOMWIKI_MONITOR_STATE_DIR=$STATE_DIR \
BOMWIKI_MONITOR_LOG_FILE=$LOG_FILE \
BOMWIKI_MONITOR_CURL_BIN=$CURL_STUB \
BOMWIKI_MONITOR_KEY_FILE=$TEST_KEY_FILE \
BOMWIKI_MONITOR_NOW=2026-07-23T01:18:00Z \
TEST_MAIL_MODE=1 \
  sh "$MONITOR" --test-mail
assert_contains "$LOG_FILE" "mail sent http=202 subject=bomwiki.com monitor test"

# Three consecutive curl failures are required before DOWN.
run_probe 2026-07-23T01:20:00Z 000 28 "Operation timed out"
assert_file_value "$STATE_DIR/state" up
assert_file_value "$STATE_DIR/consecutive-failures" 1
assert_mail_count 0

run_probe 2026-07-23T01:22:00Z 000 28 "Operation timed out"
assert_file_value "$STATE_DIR/state" up
assert_file_value "$STATE_DIR/consecutive-failures" 2
assert_mail_count 0

run_probe 2026-07-23T01:24:00Z 000 28 "Operation timed out"
assert_file_value "$STATE_DIR/state" down
assert_file_value "$STATE_DIR/consecutive-failures" 3
assert_file_value "$STATE_DIR/first-failure-at" 2026-07-23T01:20:00Z
assert_file_value "$STATE_DIR/down-at" 2026-07-23T01:24:00Z
assert_mail_count 1
assert_contains "$MAIL_CAPTURE" "subject=🔴 bomwiki.com DOWN - origin HTTP 000"
assert_contains "$MAIL_CAPTURE" "Last probe curl exit: 28"
assert_contains "$MAIL_CAPTURE" "Last probe curl error: Operation timed out"
assert_not_contains "$MAIL_CAPTURE" "000000"

# One success is insufficient, and a later failure resets recovery progress.
run_probe 2026-07-23T01:26:00Z 200 0 ""
assert_file_value "$STATE_DIR/state" down
assert_file_value "$STATE_DIR/consecutive-successes" 1
assert_file_value "$STATE_DIR/first-recovery-success-at" 2026-07-23T01:26:00Z
assert_mail_count 1

run_probe 2026-07-23T01:28:00Z 503 0 ""
assert_file_value "$STATE_DIR/state" down
assert_file_value "$STATE_DIR/consecutive-successes" 0
assert_file_value "$STATE_DIR/first-recovery-success-at" ""
assert_mail_count 1

# Two consecutive successes recover exactly once.
run_probe 2026-07-23T01:30:00Z 200 0 ""
assert_file_value "$STATE_DIR/state" down
assert_file_value "$STATE_DIR/consecutive-successes" 1
assert_mail_count 1

run_probe 2026-07-23T01:32:00Z 200 0 ""
assert_file_value "$STATE_DIR/state" up
assert_file_value "$STATE_DIR/consecutive-successes" 0
assert_mail_count 2
assert_contains "$MAIL_CAPTURE" "subject=🟢 bomwiki.com RECOVERED"
assert_contains "$MAIL_CAPTURE" "First failure (UTC): 2026-07-23T01:20:00Z"
assert_contains "$MAIL_CAPTURE" "Declared down (UTC): 2026-07-23T01:24:00Z"
assert_contains "$MAIL_CAPTURE" "First successful confirmation (UTC): 2026-07-23T01:30:00Z"
assert_contains "$MAIL_CAPTURE" "Recovered (UTC): 2026-07-23T01:32:00Z"

run_probe 2026-07-23T01:34:00Z 200 0 ""
assert_file_value "$STATE_DIR/state" up
assert_mail_count 2

# HTTP failures with a successful curl process use the actual HTTP status.
run_probe 2026-07-23T01:36:00Z 502 0 ""
run_probe 2026-07-23T01:38:00Z 502 0 ""
assert_file_value "$STATE_DIR/state" up
assert_mail_count 2

run_probe 2026-07-23T01:40:00Z 502 0 ""
assert_file_value "$STATE_DIR/state" down
assert_file_value "$STATE_DIR/first-failure-at" 2026-07-23T01:36:00Z
assert_file_value "$STATE_DIR/down-at" 2026-07-23T01:40:00Z
assert_mail_count 3
assert_contains "$MAIL_CAPTURE" "subject=🔴 bomwiki.com DOWN - origin HTTP 502"
assert_contains "$MAIL_CAPTURE" "Last probe curl exit: 0"

# Failed mail remains queued while probes continue and detect another full
# state transition.
run_probe 2026-07-23T01:42:00Z 200 0 ""
assert_file_value "$STATE_DIR/consecutive-successes" 1

run_probe 2026-07-23T01:44:00Z 200 0 "" 1
assert_file_value "$STATE_DIR/state" up
assert_queue_count 1
assert_contains "$STATE_DIR/notifications/notification-00000000000000000004/subject" "bomwiki.com RECOVERED"
assert_mail_count 4

run_probe 2026-07-23T01:46:00Z 502 0 "" 1
assert_file_value "$STATE_DIR/consecutive-failures" 1
run_probe 2026-07-23T01:48:00Z 502 0 "" 1
assert_file_value "$STATE_DIR/consecutive-failures" 2
run_probe 2026-07-23T01:50:00Z 502 0 "" 1
assert_file_value "$STATE_DIR/state" down
assert_file_value "$STATE_DIR/first-failure-at" 2026-07-23T01:46:00Z
assert_file_value "$STATE_DIR/down-at" 2026-07-23T01:50:00Z
assert_queue_count 2
assert_contains "$STATE_DIR/notifications/notification-00000000000000000005/subject" "bomwiki.com DOWN - origin HTTP 502"
assert_mail_count 7

# When mail delivery recovers, queued transitions are delivered FIFO before
# the probe. Health confirmation then proceeds normally.
run_probe 2026-07-23T01:52:00Z 200 0 ""
assert_queue_count 0
assert_file_value "$STATE_DIR/state" down
assert_file_value "$STATE_DIR/consecutive-successes" 1
assert_mail_count 9

run_probe 2026-07-23T01:54:00Z 200 0 ""
assert_queue_count 0
assert_file_value "$STATE_DIR/state" up
assert_mail_count 10

# Atomic replacements leave only complete state values and private files.
[ "$(file_mode "$STATE_DIR")" = "700" ] ||
  fail "state directory is not mode 700"
[ "$(file_mode "$STATE_DIR/notifications")" = "700" ] ||
  fail "notification queue is not mode 700"
for file in "$STATE_DIR"/*; do
  [ -f "$file" ] || continue
  [ "$(file_mode "$file")" = "600" ] ||
    fail "$file is not mode 600"
  value=$(cat "$file")
  case "$(basename "$file")" in
    state)
      case "$value" in up|down) ;; *) fail "unexpected state in $file" ;; esac
      ;;
    consecutive-failures|consecutive-successes|notification-sequence)
      case "$value" in ''|*[!0-9]*) fail "unexpected counter in $file" ;; esac
      ;;
    first-failure-at|down-at|first-recovery-success-at)
      case "$value" in ''|????-??-??T??:??:??Z) ;; *) fail "unexpected UTC timestamp in $file" ;; esac
      ;;
    *)
      fail "unexpected state file $file"
      ;;
  esac
done
if find "$STATE_DIR" -name '.state.*' -print | grep . >/dev/null 2>&1; then
  fail "temporary state files were left behind"
fi
if find "$STATE_DIR" -name '.notification.*' -print | grep . >/dev/null 2>&1; then
  fail "temporary notification directories were left behind"
fi

printf '%s\n' "ok - failure and recovery hysteresis"
printf '%s\n' "ok - curl status, exit, and stderr remain separate"
printf '%s\n' "ok - transition-only mail and UTC incident timestamps"
printf '%s\n' "ok - failed transition mail queues while probes continue"
printf '%s\n' "ok - mail secret stays out of curl arguments"
