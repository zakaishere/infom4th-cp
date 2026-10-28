#!/bin/sh
# Builds judge runtime images. Pass language names to build a subset, e.g.:
#   sh scripts/build-runtimes.sh cpp python go
set -eu
cd "$(dirname "$0")/.."
languages="${*:-cpp c java python pypy javascript go rust kotlin csharp ruby php}"
for language in $languages; do
  docker build -f "judge/images/$language.Dockerfile" -t "cp-judge-$language:local" judge/images
done
