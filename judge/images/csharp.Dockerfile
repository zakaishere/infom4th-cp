# Debian 12 ships Mono 6.8 (mcs compiler + runtime); the official mono image is on end-of-life Debian 10.
FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends mono-mcs mono-runtime libmono-system-core4.0-cil util-linux coreutils && rm -rf /var/lib/apt/lists/*
