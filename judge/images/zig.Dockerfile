FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends util-linux coreutils curl ca-certificates xz-utils && rm -rf /var/lib/apt/lists/*
RUN curl -fsSL "https://ziglang.org/download/0.13.0/zig-linux-$(uname -m)-0.13.0.tar.xz" | tar -xJ -C /opt \
    && ln -s "/opt/zig-linux-$(uname -m)-0.13.0/zig" /usr/local/bin/zig
# Warm the global cache (compiler_rt) with the judge's exact flags; each compile copies it
# into the job folder, like the Go image does.
RUN mkdir /tmp/warm && printf 'const std = @import("std");\npub fn main() !void {\n    try std.io.getStdOut().writer().print("{d}\\n", .{1});\n}\n' > /tmp/warm/main.zig \
    && zig build-exe -OReleaseSafe -fsingle-threaded --cache-dir /tmp/warm/cache --global-cache-dir /opt/zigcache \
       -femit-bin=/tmp/warm/program /tmp/warm/main.zig \
    && rm -rf /tmp/warm && chmod -R a+rX /opt/zigcache
