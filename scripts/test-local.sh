#!/usr/bin/env bash
# Runs the integration suite against a fresh surfpool fork of devnet.
# Usage: bash scripts/test-local.sh [--skip-build]
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.local/share/solana/install/active_release/bin:$HOME/.avm/bin:$PATH"
RPC=${RPC:-http://127.0.0.1:8899}
WALLET=${ANCHOR_WALLET:-$HOME/.config/solana/id.json}
PROGRAM_ID=$(solana-keygen pubkey target/deploy/mostro-keypair.json)
LOGDIR=${SURFPOOL_LOGS:-/tmp/mostro-surfpool-logs}

if [[ "${1:-}" != "--skip-build" ]]; then
   anchor build --no-idl
fi

# surfpool ignores SIGTERM in headless mode; make sure the port is really free before starting a new fork.
pkill -9 -x surfpool 2>/dev/null || true
for i in $(seq 1 20); do
   if ! (exec 3<>/dev/tcp/127.0.0.1/8899) 2>/dev/null; then break; fi
   sleep 1
done
# 1 s slots: the default 400 ms rotates blockhashes too fast for a ~700-chunk program deploy.
surfpool start -n devnet --no-tui --no-deploy --no-studio -y -t 1000 --log-path "$LOGDIR" >/dev/null 2>&1 &
SURF_PID=$!
trap 'kill $SURF_PID 2>/dev/null || true' EXIT

for i in $(seq 1 60); do
   if solana cluster-version -u "$RPC" >/dev/null 2>&1; then break; fi
   sleep 1
done
solana airdrop 100 -k "$WALLET" -u "$RPC" >/dev/null
sleep 8
# The fork clones the devnet program; wipe it so the deploy below is a fresh deploy, not an upgrade.
PROGRAM_DATA=$(node -e 'const {PublicKey}=require("@solana/web3.js");console.log(PublicKey.findProgramAddressSync([new PublicKey(process.argv[1]).toBuffer()],new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111"))[0].toBase58())' "$PROGRAM_ID")
for acc in "$PROGRAM_ID" "$PROGRAM_DATA"; do
   curl -s "$RPC" -X POST -H 'content-type: application/json' \
      -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"surfnet_setAccount\",\"params\":[\"$acc\",{\"lamports\":0,\"data\":\"\",\"owner\":\"11111111111111111111111111111111\",\"executable\":false,\"rentEpoch\":0}]}" >/dev/null
done
deployed=0
for attempt in 1 2 3; do
   if timeout 480 solana program deploy target/deploy/mostro.so --program-id target/deploy/mostro-keypair.json -k "$WALLET" -u "$RPC" --use-rpc >/dev/null 2>&1; then deployed=1; break; fi
   echo "deploy attempt $attempt failed, retrying"; sleep 5
done
if [[ $deployed -ne 1 ]]; then echo "could not deploy to surfpool"; exit 1; fi
echo "deployed $PROGRAM_ID to $RPC"

export NODE_OPTIONS=--no-experimental-strip-types
ANCHOR_PROVIDER_URL="$RPC" ANCHOR_WALLET="$WALLET" npx ts-mocha -p ./tsconfig.json -t 1000000 "tests/**/*.ts"
