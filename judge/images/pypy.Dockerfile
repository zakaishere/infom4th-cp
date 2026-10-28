FROM pypy:3.10-slim-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends util-linux coreutils && rm -rf /var/lib/apt/lists/*
