#!/usr/bin/env bash
# Runs the integration suite against a fresh surfpool fork of devnet.
# Usage: bash scripts/test-local.sh [--skip-build]
#
# The program is injected into the fork with `scripts/surfpool-load-program.js` (writes the loader
# accounts directly through `surfnet_setAccount`) instead of a chunked `solana program deploy`,
# which takes minutes on a fork and hangs on blockhash churn once the binary is near 900 KB.
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.local/share/solana/install/active_release/bin:$HOME/.avm/bin:$PATH"
RPC=${RPC:-http://127.0.0.1:8899}
WALLET=${ANCHOR_WALLET:-$HOME/.config/solana/id.json}
PROGRAM_ID=$(solana-keygen pubkey target/deploy/mostro-keypair.json)
LOGDIR=${SURFPOOL_LOGS:-/tmp/mostro-surfpool-logs}

if [[ "${1:-}" != "--skip-build" ]]; then
   anchor build
fi

# surfpool ignores SIGTERM in headless mode; make sure the port is really free before starting a new fork.
pkill -9 -x surfpool 2>/dev/null || true
for i in $(seq 1 20); do
   if ! (exec 3<>/dev/tcp/127.0.0.1/8899) 2>/dev/null; then break; fi
   sleep 1
done
# 1 s slots keep blockhashes valid long enough for the multi-instruction transactions in the suite.
surfpool start -n devnet --no-tui --no-deploy --no-studio -y -t 1000 --log-path "$LOGDIR" >/dev/null 2>&1 &
SURF_PID=$!
trap 'kill -9 $SURF_PID 2>/dev/null || true' EXIT

for i in $(seq 1 60); do
   if solana cluster-version -u "$RPC" >/dev/null 2>&1; then break; fi
   sleep 1
done
solana airdrop 100 -k "$WALLET" -u "$RPC" >/dev/null
sleep 8
# The fork clones the devnet program lazily; overwrite it with the local build (fresh program, upgrade authority = the test wallet).
node scripts/surfpool-load-program.js target/deploy/mostro.so target/deploy/mostro-keypair.json "$WALLET" "$RPC"

export NODE_OPTIONS=--no-experimental-strip-types
ANCHOR_PROVIDER_URL="$RPC" ANCHOR_WALLET="$WALLET" npx ts-mocha -p ./tsconfig.json -t 1000000 "tests/**/*.ts"
