FROM python:3.12-slim-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends docker.io ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /judge
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY runner.py worker.py diagnose.py ./
# Runtime Dockerfiles: the worker builds any missing language image on first start.
COPY images ./images
COPY tests ./tests
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
CMD ["python", "worker.py"]
