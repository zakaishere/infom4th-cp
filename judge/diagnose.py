"""Runs the startup self-test for each judge language and prints what happened.

Usage on the judge host:
  docker compose --profile judge run --rm --no-deps --entrypoint python judge-official diagnose.py [LANG ...]
"""
import os
import sys
import time
from runner import DockerRunner, IMAGE_NAMES, LANGUAGES

def main():
    runner = DockerRunner("/judge/work", os.environ["JUDGE_HOST_WORK_ROOT"], {},
                          int(os.getenv("JUDGE_MAX_MEMORY_MB", "1024")))
    wanted = sys.argv[1:] or os.getenv("JUDGE_LANGUAGES", ",".join(LANGUAGES)).split(",")
    failed = 0
    for language in wanted:
        image = os.getenv("JUDGE_IMAGE_" + language, "cp-judge-" + IMAGE_NAMES.get(language, language.lower()) + ":local")
        started = time.monotonic()
        try:
            runner.verify_runtime(language, image)
            print(f"OK    {language:<11} {time.monotonic() - started:5.1f}s  {image}", flush=True)
        except Exception as error:  # report every language, not just the first failure
            failed += 1
            print(f"FAIL  {language:<11} {time.monotonic() - started:5.1f}s  {image}: {error}", flush=True)
            detail = getattr(runner, "last_result", None)
            if detail:
                print("      " + str(detail)[:1500], flush=True)
    sys.exit(1 if failed else 0)

if __name__ == "__main__":
    main()
