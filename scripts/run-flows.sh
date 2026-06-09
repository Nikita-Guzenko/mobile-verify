#!/usr/bin/env bash
# Usage: run-flows.sh <app-dir> <out-dir> [udid]
# Boots a sim, ensures the app is installed (expo run:ios if needed), runs all
# .maestro/*.yaml flows, leaves JUnit + screenshots in <out-dir>.
set -uo pipefail
APP_DIR="$1"; OUT="$2"; UDID="${3:-}"
mkdir -p "$OUT"

# 1. pick + boot a simulator (first available booted, else boot an iPhone)
if [ -z "$UDID" ]; then
  UDID=$(xcrun simctl list devices booted | grep -oE '[0-9A-F-]{36}' | head -1)
fi
if [ -z "$UDID" ]; then
  UDID=$(xcrun simctl list devices available | grep -m1 -oE 'iPhone [0-9].*\(([0-9A-F-]{36})\)' | grep -oE '[0-9A-F-]{36}' | head -1)
  xcrun simctl boot "$UDID" 2>/dev/null
fi
open -a Simulator 2>/dev/null
echo "sim: $UDID"

# 2. ensure app built+installed (idempotent: expo run:ios installs to booted sim)
( cd "$APP_DIR" && npm run ios -- --device "$UDID" >"$OUT/build.log" 2>&1 ) \
  || { echo "BUILD/BOOT FAILED — see $OUT/build.log"; exit 2; }   # fail loud, distinct exit

# 3. run flows -> JUnit + screenshots into OUT
maestro --udid "$UDID" test --format junit --output "$OUT/junit.xml" \
  --test-output-dir "$OUT" "$APP_DIR"/.maestro/*.yaml
echo "maestro exit: $?"
