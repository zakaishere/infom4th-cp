FROM gcc:14-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends util-linux coreutils && rm -rf /var/lib/apt/lists/*
