FROM python:3.12-slim
COPY --from=ghcr.io/astral-sh/uv:0.12.18 /uv /usr/local/bin/uv

WORKDIR /app
COPY pyproject.toml uv.lock .python-version ./
RUN uv sync --locked --no-dev
COPY app ./app
COPY entrypoint.sh /app/entrypoint.sh

# Run as a user with no login and no shell, not as root. The packages stay root-owned and read-only to it.
RUN useradd --system --no-create-home --shell /usr/sbin/nologin al
USER al

# The virtualenv's own uvicorn, so starting the API doesn't run uv (which wants a cache directory it can write).
ENV PATH="/app/.venv/bin:$PATH" \
    PYTHONUNBUFFERED=1

EXPOSE 5002

# The same path the load balancer checks. No curl in the slim image, so Python makes the request.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:5002/core/health', timeout=3)"]

# Writes FIREBASE_SERVICE_ACCOUNT_JSON to a file when it is set, then runs the command below.
ENTRYPOINT ["sh", "/app/entrypoint.sh"]
# --no-access-log: app/request_log.py prints one line per request with its request id, so uvicorn's own line would only repeat it.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "5002", "--no-access-log"]
