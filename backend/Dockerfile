# syntax=docker/dockerfile:1
FROM python:3.12-slim

COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv
COPY --from=docker:27-cli /usr/local/bin/docker /usr/local/bin/docker

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

COPY pyproject.toml uv.lock .
RUN uv sync --frozen --no-install-project --no-dev

COPY . .

RUN useradd -m -u 1000 appuser && \
    groupadd -f -g 984 docker && usermod -aG docker appuser

USER appuser
EXPOSE 8000

CMD [".venv/bin/ddtrace-run", ".venv/bin/uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
