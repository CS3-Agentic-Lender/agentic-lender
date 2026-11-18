#!/bin/sh
# ECS hands a secret to a container as an environment variable, but Google's libraries want GOOGLE_APPLICATION_CREDENTIALS to be
# the path of a file. If FIREBASE_SERVICE_ACCOUNT_JSON is set, write it to a file and point the variable at it. If it is not set
# (the emulator, docker compose, local runs), change nothing. The value is never printed.
set -eu

if [ -n "${FIREBASE_SERVICE_ACCOUNT_JSON:-}" ]; then
    key_file=/tmp/firebase-sa.json
    umask 077
    printf '%s' "$FIREBASE_SERVICE_ACCOUNT_JSON" > "$key_file"
    # Python reads the file itself and its errors are hidden, so nothing from the value can reach the logs.
    if ! python -c 'import json, sys; json.load(open(sys.argv[1]))' "$key_file" 2>/dev/null; then
        rm -f "$key_file"
        echo "FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON; not starting." >&2
        exit 1
    fi
    export GOOGLE_APPLICATION_CREDENTIALS="$key_file"
    # The app does not need the raw value once the file exists.
    unset FIREBASE_SERVICE_ACCOUNT_JSON
fi

exec "$@"
