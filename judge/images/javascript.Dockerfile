FROM node:20-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends util-linux coreutils && rm -rf /var/lib/apt/lists/*
