FROM golang:1.22-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends util-linux coreutils && rm -rf /var/lib/apt/lists/*
# Warm the standard-library build cache so contestant compiles stay fast.
RUN mkdir -p /opt/gocache && printf "package main\nfunc main(){}\n" > /tmp/w.go && GOCACHE=/opt/gocache go build -o /tmp/w /tmp/w.go && GOCACHE=/opt/gocache go build -o /tmp/w2 std 2>/dev/null; chmod -R a+rX /opt/gocache && rm -f /tmp/w /tmp/w.go
