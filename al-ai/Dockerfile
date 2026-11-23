# Pinned by digest so a rebuild gets the same bases; the tag is kept for reading. Refresh both digests on purpose.
FROM python:3.12-slim@sha256:5e2bdb1b0d542d5039cffb8181c65930093949194a65c365dfb1b0fe13a4fa5b
COPY --from=ghcr.io/astral-sh/uv:0.12.18@sha256:3adc3706091ce7c2fe595e669628caedd6d951551b92b258b7e7dbe06d9440bc /uv /usr/local/bin/uv

WORKDIR /app
COPY pyproject.toml uv.lock .python-version ./
RUN uv sync --locked --no-dev
COPY app ./app
# The saved valuation model, and the ml package its classes come from (the model file is a pickle).
COPY models ./models
COPY ml/*.py ml/*.json ./ml/
COPY entrypoint.sh /app/entrypoint.sh

# Run as a user with no login and no shell, not as root. The code, packages and model stay root-owned and read-only to it.
RUN useradd --system --no-create-home --shell /usr/sbin/nologin al
USER al
# The one writable place when the root filesystem is read-only (deploy/app/ecs.tf mounts a scratch volume here). Declaring it
# makes ECS copy the image's /tmp, world-writable with the sticky bit, rather than a root-owned 0755 folder al can't write to.
VOLUME ["/tmp"]

# The virtualenv's own uvicorn, so starting the API doesn't run uv (which wants a cache directory it can write).
# The root filesystem is read-only on ECS and the user has no home, so matplotlib (pulled in by the model's ml package) caches in /tmp.
ENV PATH="/app/.venv/bin:$PATH" \
    PYTHONUNBUFFERED=1 \
    MPLCONFIGDIR=/tmp/matplotlib

EXPOSE 5001
# Writes FIREBASE_SERVICE_ACCOUNT_JSON to a file when it is set, then runs the command below.
ENTRYPOINT ["sh", "/app/entrypoint.sh"]
# --no-access-log: app/errors.py logs one line per request with its request id, so uvicorn's own line would only repeat it.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "5001", "--no-access-log"]
