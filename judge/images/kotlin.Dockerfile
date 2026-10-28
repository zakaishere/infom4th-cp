FROM eclipse-temurin:17-jdk-jammy
RUN apt-get update && apt-get install -y --no-install-recommends util-linux coreutils curl unzip && rm -rf /var/lib/apt/lists/*
RUN curl -fsSL -o /tmp/k.zip https://github.com/JetBrains/kotlin/releases/download/v1.9.24/kotlin-compiler-1.9.24.zip && unzip -q /tmp/k.zip -d /opt && rm /tmp/k.zip
ENV PATH=/opt/kotlinc/bin:$PATH
