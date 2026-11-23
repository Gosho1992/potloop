#!/usr/bin/env bash
# Reproduce the v9.2.2 test evidence from a clean copy of this folder (no node_modules).
# Writes raw logs to evidence/. Each step's exit code is recorded in evidence/SUMMARY.txt;
# the script keeps going after a failure so every result is captured.
#   bash scripts/run-evidence.sh            (about 15 minutes; the demo story waits real time)
#   SKIP_DEMO=1 bash scripts/run-evidence.sh
set -u
cd "$(dirname "$0")/.."
# FORK_URL and EXHAUSTIVE must only reach their own steps: with FORK_URL set, every Hardhat command
# would run on a network copy of mainnet, and with EXHAUSTIVE set the normal suite would include the
# 45-minute exhaustive tests.
FORK="${FORK_URL:-}"; RUN_EXHAUSTIVE="${EXHAUSTIVE:-0}"
unset FORK_URL EXHAUSTIVE
mkdir -p evidence
S=evidence/SUMMARY.txt
: > "$S"
step() { # name, command...
  local name="$1"; shift
  local start=$(date -u +%s)
  echo "== $name: $*" | tee -a "$S"
  ( "$@" ) > "evidence/$name.log" 2>&1
  local code=$?
  echo "   exit $code, $(( $(date -u +%s) - start ))s" | tee -a "$S"
}

{
  echo "date (UTC): $(date -u +%FT%TZ)"
  echo "node $(node -v), npm $(npm -v), $(uname -sm)"
  echo "registry: $(npm config get registry)"
} > evidence/ENVIRONMENT.txt

# hashes of the exact source under test (everything except generated folders and these logs)
find . -type f \
  -not -path "./node_modules/*" -not -path "./app/node_modules/*" -not -path "./artifacts/*" -not -path "./cache/*" \
  -not -path "./app/dist/*" -not -path "./evidence/*" -not -name "*.zip" | LC_ALL=C sort | xargs sha256sum > evidence/SOURCE_HASHES.txt
echo "source tree sha256: $(sha256sum evidence/SOURCE_HASHES.txt | cut -d' ' -f1) ($(wc -l < evidence/SOURCE_HASHES.txt) files)" | tee -a "$S"

step 01-npm-ci npm ci --no-audit --no-fund
step 02-compile npx hardhat compile --force
step 02b-bytecode-sizes npx hardhat run scripts/bytecode-sizes.js
step 03-test-suite npx hardhat test
step 04-mutation-check node scripts/mutation-sim.mjs
step 05-payoff-matrix bash -c 'cp docs/PAYOFF_MATRIX.md /tmp/pm-before.md && node scripts/payoff-matrix.mjs && diff /tmp/pm-before.md docs/PAYOFF_MATRIX.md && echo "PAYOFF_MATRIX.md regenerated identically"'
step 05b-mode-comparison bash -c 'cp docs/MODE_COMPARISON.md /tmp/mc-before.md && node scripts/compare-modes.mjs && diff /tmp/mc-before.md docs/MODE_COMPARISON.md && echo "MODE_COMPARISON.md regenerated identically"'
step 06-app-npm-ci bash -c 'cd app && npm ci --no-audit --no-fund'
step 07-app-build bash -c 'cd app && npm run build'
step 08-slither bash -c 'command -v slither >/dev/null || { echo "slither not installed"; exit 127; }; slither . --hardhat-ignore-compile --filter-paths "node_modules|contracts/test" --exclude-informational --exclude-optimization; code=$?; echo "slither exit $code (non-zero means findings were reported; see the review in TEST_EVIDENCE)"; exit $code'

if [ "${SKIP_DEMO:-0}" != "1" ]; then
  npx hardhat node > evidence/09-hardhat-node.log 2>&1 &
  NODE_PID=$!
  sleep 8
  step 10-demo-local npx hardhat run scripts/demo-local.js --network localhost
  # the default story (20% cover, collateral from the pot, seat 1 defaults then catches up) on a
  # fresh factory with 60-second minimum rounds
  step 11-demo-story bash -c '
    rm -f demo-wallets.json
    node scripts/make-wallets.js 4 >/dev/null
    F=$(npx hardhat run scripts/evidence-factory.js --network localhost | tail -1)
    echo "factory $F"
    FACTORY=$F ROUND_SECONDS=60 GRACE_SECONDS=30 npx hardhat run scripts/demo-mainnet.js --network localhost
    code=$?; rm -f demo-wallets.json; exit $code'
  kill $NODE_PID 2>/dev/null
fi
# QIE testnet deploy script, dry run on an in-process chain that reports chain 1983
step 12-testnet-deploy-dry-run bash -c 'HARDHAT_CHAIN_ID=1983 npx hardhat run scripts/testnet-deploy.js; code=$?; rm -f testnet-deployment.json; exit $code'

# Production settings with the real QUSDC on a local copy of QIE mainnet (needs network access to a
# QIE RPC; nothing is sent to mainnet). Only when FORK_URL is set.
if [ -n "$FORK" ]; then
  step 14-fork-production-check env FORK_URL="$FORK" npx hardhat run scripts/fork-production-check.js
fi

# Exhaustive suite: 7,776 patterns x 3 cover levels x 2 collateral modes (about 45 minutes with both
# modes in parallel). Only with EXHAUSTIVE=1.
if [ "$RUN_EXHAUSTIVE" = "1" ]; then
  EXHAUSTIVE=1 EXHAUSTIVE_MODE=upfront npx hardhat test test/SavingsCircle.exhaustive.test.js > evidence/13-exhaustive-upfront.log 2>&1 &
  P1=$!
  EXHAUSTIVE=1 EXHAUSTIVE_MODE=pot npx hardhat test test/SavingsCircle.exhaustive.test.js > evidence/13-exhaustive-pot.log 2>&1 &
  P2=$!
  wait $P1; echo "== 13-exhaustive-upfront: exit $?" | tee -a "$S"
  wait $P2; echo "== 13-exhaustive-pot: exit $?" | tee -a "$S"
fi
echo "done" | tee -a "$S"
