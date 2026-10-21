# Development image for the SeaShield backend. See "Docker (development)" in backend/README.md.
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

COPY requirements.txt .
RUN pip install -r requirements.txt

# Non-root user; /data holds the SQLite database (mounted as a volume by compose.yaml).
RUN useradd --create-home --uid 1000 seashield \
    && mkdir /data \
    && chown seashield:seashield /app /data

COPY --chown=seashield:seashield . .
USER seashield

EXPOSE 8000

# Same sequence as the host workflow: apply migrations, then start Uvicorn.
# 0.0.0.0 is required inside the container; compose.yaml publishes it on 127.0.0.1 only.
CMD ["sh", "-c", "python -m alembic upgrade head && exec python -m uvicorn app.main:app --host 0.0.0.0 --port 8000"]
