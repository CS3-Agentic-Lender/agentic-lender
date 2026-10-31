#!/usr/bin/env bash
# Runs the end-to-end UI tests (AgenticLenderUITests) on an iPhone Simulator against the local stack.
#
#   ./al-mobile/run-ui-tests.sh                 # any available iPhone Simulator
#   SIMULATOR_ID=<udid> ./al-mobile/run-ui-tests.sh
#
# Start the stack first (docs/infrastructure.md, "UI tests"): the Firebase emulators with the seed
# data, then docker compose for the gateway. CI doesn't run these tests because it has no emulators.
set -euo pipefail

cd "$(dirname "$0")"

# Firestore and Auth emulators, then the gateway.
for port in 8080 9099 8000; do
  if ! nc -z localhost "$port" 2>/dev/null; then
    echo "Nothing is listening on localhost:$port. Start the emulators and docker compose first (docs/infrastructure.md, \"UI tests\")." >&2
    exit 1
  fi
done

simulator="${SIMULATOR_ID:-$(xcrun simctl list devices available --json | python3 -c '
import json, sys
devices = json.load(sys.stdin)["devices"]
print(next(d["udid"] for runtime, list_ in devices.items() if "iOS" in runtime for d in list_ if d["name"].startswith("iPhone")))
')}"

# One simulator, one test at a time: the tests share the app's keychain login.
xcodebuild test \
  -project AgenticLender.xcodeproj \
  -scheme AgenticLenderUITests \
  -destination "id=$simulator" \
  -parallel-testing-enabled NO \
  -maximum-parallel-testing-workers 1
