FROM python:3.12-slim
COPY --from=ghcr.io/astral-sh/uv:0.12.18 /uv /usr/local/bin/uv

WORKDIR /app
COPY pyproject.toml uv.lock .python-version ./
RUN uv sync --locked --no-dev
COPY app ./app
# The saved valuation model, and the ml package its classes come from (the model file is a pickle).
COPY models ./models
COPY ml/*.py ml/*.json ./ml/

EXPOSE 5001
CMD ["uv", "run", "--no-sync", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "5001"]
