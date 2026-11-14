#!/bin/sh
# Builds the warmup-week problem banks into draft/warmup/banks (draft/ is ignored by git).
#   sh scripts/warmup-banks.sh
# Sources, all published by their contests with test data and jury solutions under CC BY-SA:
#   - Freshmen Programming Contest (FPC) 2022-2025, TU Delft   https://chipcie.wisv.ch/archive/
#   - BAPC 2024 Preliminaries                                    https://2024.bapc.eu
# plus the original problems of examples/generate-warmup.mjs.
# Difficulty: the Open Kattis level of each problem, or for FPC 2022 (not on Kattis) the share of
# teams that solved it in the contest. Hard problems go to a separate, optional bonus bank.
set -eu
cd "$(dirname "$0")/.."
work=draft; out=draft/warmup/banks
mkdir -p "$work/archives" "$work/extracted" "$out"

# Downloads resume until complete: these servers drop long connections.
fetch() {
  url="$1"; file="$2"
  size=$(curl -sIL --max-time 60 "$url" | grep -i '^content-length' | tail -1 | tr -d '\r' | awk '{print $2}')
  for attempt in $(seq 1 200); do
    have=$(stat -c %s "$file" 2>/dev/null || echo 0)
    if [ -n "$size" ] && [ "$have" -ge "$size" ]; then return 0; fi
    curl -sL -C - --max-time 900 -o "$file" "$url" || true
    sleep 2
  done
  echo "Could not download $url" >&2; return 1
}
unpack() {   # unpack <archive> <folder>: the contest zip holds one zip per problem
  rm -rf "$2"; mkdir -p "$2/pkg"
  unzip -q -o "$1" -d "$2"
  for z in "$2"/*.zip; do
    name=$(basename "$z" .zip)
    [ "$name" = samples ] && continue
    mkdir -p "$2/pkg/$name" && unzip -q -o "$z" -d "$2/pkg/$name"
  done
}

for y in 2022 2023 2024 2025; do
  [ -d "$work/extracted/fpc$y/pkg" ] && continue
  fetch "https://chipcie.wisv.ch/archive/$y/fpc/solutions.zip" "$work/archives/fpc$y.zip"
  unpack "$work/archives/fpc$y.zip" "$work/extracted/fpc$y"
done
if [ ! -d "$work/extracted/bapc2024-prelims/pkg" ]; then
  fetch "https://github.com/Fully-Connected-Graph/BAPC-2024/raw/refs/heads/main/public/prelims/prelims.zip?download=" "$work/archives/bapc2024-prelims.zip"
  unpack "$work/archives/bapc2024-prelims.zip" "$work/extracted/bapc2024-prelims"
fi

convert() {  # convert <folder> <source> <bank name> <problem=LEVEL,...>
  only=$(echo "$4" | tr ',' '\n' | cut -d= -f1 | paste -sd, -)
  node scripts/import-kattis-packages.mjs "$1" --source "$2" --prefix "$(echo "$3" | cut -d- -f1)" --only "$only" --difficulty "$4" --out "$out/$3.json"
}
FPC="Freshmen Programming Contest (FPC)"
# Warmup set: easy and medium problems.
convert "$work/extracted/fpc2022/pkg" "$FPC 2022, TU Delft" fpc22-warmup "cakepromise=EASY,glassreflection=EASY,dalenchip=MEDIUM"
convert "$work/extracted/fpc2023/pkg" "$FPC 2023, TU Delft" fpc23-warmup "huntingthemavericks=MEDIUM,industryimprovements=MEDIUM"
convert "$work/extracted/fpc2024/pkg" "$FPC 2024, TU Delft" fpc24-warmup "draggedoutduel=EASY,curiousjury=MEDIUM,europeanelection=MEDIUM,intelligenceepxloration=MEDIUM,jailbreak=MEDIUM"
convert "$work/extracted/fpc2025/pkg" "$FPC 2025, TU Delft" fpc25-warmup "jumbledkeys=EASY,arrayannihilation=MEDIUM,gamblersdilemma=MEDIUM,hopelesslyhungover=MEDIUM"
convert "$work/extracted/bapc2024-prelims/pkg" "BAPC 2024 Preliminaries" bapc24p-warmup "humanpyramid=EASY,awkwardauction=MEDIUM,expectederror=MEDIUM"
# Bonus set: hard problems for the strongest students (optional).
convert "$work/extracted/fpc2022/pkg" "$FPC 2022, TU Delft" fpc22-bonus "eurovision=HARD,highwaysofthefuture=HARD,inspiringprofessors=HARD"
convert "$work/extracted/fpc2023/pkg" "$FPC 2023, TU Delft" fpc23-bonus "felinefriendship=HARD"
convert "$work/extracted/fpc2024/pkg" "$FPC 2024, TU Delft" fpc24-bonus "annoyingalliterations=HARD"
convert "$work/extracted/fpc2025/pkg" "$FPC 2025, TU Delft" fpc25-bonus "characterithmetic=HARD,interestingmountains=HARD"
convert "$work/extracted/bapc2024-prelims/pkg" "BAPC 2024 Preliminaries" bapc24p-bonus "chaoticcables=HARD"

# Original problems.
node examples/generate-warmup.mjs
# Split over several files so each stays under the importer's 64 MiB limit.
node --input-type=module -e "
import { buildProblemBank, writeProblemBank } from './scripts/package-problem-bank.mjs';
const bank = buildProblemBank('examples/warmup'), groups = [[]];
let size = 0;
for (const p of bank.problems) {
  const bytes = Buffer.byteLength(JSON.stringify(p));
  if (groups.at(-1).length && size + bytes > 55 * 1048576) { groups.push([]); size = 0; }
  groups.at(-1).push(p); size += bytes;
}
groups.forEach((problems, i) => {
  const file = '$out/originals-warmup-' + (i + 1) + '.json';
  const s = writeProblemBank({ ...bank, problems }, file);
  console.log('Bank: ' + file + ' (' + problems.length + ' problems, ' + (s.compressedBytes / 1048576).toFixed(1) + ' MiB compressed)');
});"
ls -la "$out"
