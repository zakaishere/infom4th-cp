FROM gcc:14-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends util-linux coreutils && rm -rf /var/lib/apt/lists/*
# Brainfuck is translated to C (brainfuck/bf2c.c) and compiled with gcc.
COPY brainfuck/bf2c.c /opt/bf2c.c
RUN gcc -O2 -o /usr/local/bin/bf2c /opt/bf2c.c
