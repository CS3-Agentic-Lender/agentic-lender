"""Manual check of the gateway limits against a running stack (`docker compose up -d --build`).

    python3 gateway/check_limits.py api       # 150 of 200 GETs pass, then about 1 refill per 2 s
    python3 gateway/check_limits.py signup    # 10 of 30 POSTs pass

Run `docker compose restart gateway` before each run so the counters start empty.
"""

import sys
import time
import urllib.error
import urllib.request

BASE = "http://localhost:8000"


def status(path, method="GET"):
    data = b"{}" if method == "POST" else None
    try:
        return urllib.request.urlopen(urllib.request.Request(BASE + path, method=method, data=data)).status
    except urllib.error.HTTPError as e:
        return e.code


def passed(path, n, method="GET"):
    return sum(status(path, method) != 429 for _ in range(n))


if sys.argv[1:] == ["api"]:
    assert (n := passed("/ai/health", 200)) == 150, f"burst: {n} passed, expected 150"
    time.sleep(10)
    assert 4 <= (n := passed("/ai/health", 10)) <= 6, f"after 10 s: {n} passed, expected about 5"
elif sys.argv[1:] == ["signup"]:
    assert (n := passed("/core/me", 30, "POST")) == 10, f"burst: {n} passed, expected 10"
else:
    sys.exit(__doc__)
print("ok")
