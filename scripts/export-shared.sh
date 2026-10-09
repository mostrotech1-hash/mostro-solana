#!/usr/bin/env bash
# Copies the generated IDL and TypeScript types from target/ into shared/ so the frontends can
# import them through the @mostro/shared workspace. With --seed it also runs the devnet seed,
# which (re)writes shared/addresses/<cluster>.json.
#
#   bash scripts/export-shared.sh          # copy IDL + types
#   bash scripts/export-shared.sh --seed   # copy, then seed and write the address map
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

IDL_SRC="target/idl/mostro.json"
TYPES_SRC="target/types/mostro.ts"
IDL_DST="shared/idl/mostro.json"
TYPES_DST="shared/types/mostro.ts"

if [[ ! -f "$IDL_SRC" || ! -f "$TYPES_SRC" ]]; then
  echo "error: $IDL_SRC or $TYPES_SRC missing. Run 'anchor build' first." >&2
  exit 1
fi

mkdir -p "$(dirname "$IDL_DST")" "$(dirname "$TYPES_DST")" shared/addresses
cp "$IDL_SRC" "$IDL_DST"
cp "$TYPES_SRC" "$TYPES_DST"
# target/ is prettier-ignored but shared/ is not: format the copies so `yarn format:check` stays green.
npx prettier --log-level warn --write "$IDL_DST" "$TYPES_DST"

PROGRAM_ID="$(node -e 'process.stdout.write(require(process.argv[1]).address)' "$ROOT/$IDL_SRC")"
VERSION="$(node -e 'process.stdout.write(require(process.argv[1]).metadata.version)' "$ROOT/$IDL_SRC")"
echo "exported IDL     -> $IDL_DST (program $PROGRAM_ID, v$VERSION)"
echo "exported types   -> $TYPES_DST"

SEED=0
for arg in "$@"; do
  case "$arg" in
    --seed) SEED=1 ;;
    *) echo "unknown argument: $arg" >&2; exit 2 ;;
  esac
done

if [[ "$SEED" == "1" ]]; then
  echo "running seed..."
  npx ts-node scripts/seed-devnet.ts
fi
