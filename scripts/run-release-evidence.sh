#!/usr/bin/env bash
# v9.3 release evidence. Raw logs and exit codes go to evidence/v93-release/.
# Runs only local tests: no mainnet, no keys.
#   bash scripts/run-release-evidence.sh          (exhaustive suite included: about 3.5 hours on 2 cores)
#   SKIP_EXHAUSTIVE=1 bash scripts/run-release-evidence.sh
set -u
cd "$(dirname "$0")/.."
unset FORK_URL EXHAUSTIVE DEPLOYER_PRIVATE_KEY
E=evidence/v93-release
mkdir -p "$E"
S=$E/SUMMARY.txt
: > "$S"
step() {
  local name="$1"; shift
  local start=$(date -u +%s)
  echo "== $name: $*" | tee -a "$S"
  ( "$@" ) > "$E/$name.log" 2>&1
  local code=$?
  echo "   exit $code, $(( $(date -u +%s) - start ))s" | tee -a "$S"
}
{
  echo "date (UTC): $(date -u +%FT%TZ)"
  echo "node $(node -v), npm $(npm -v), $(uname -sm), $(nproc) cores"
  echo "git revision: $(git rev-parse HEAD 2>/dev/null || echo 'not a git checkout')"
  echo "solidity: $(node -e 'console.log(require("./hardhat.config.js").solidity.version)') (optimizer: $(node -e 'console.log(JSON.stringify(require("./hardhat.config.js").solidity.settings.optimizer))'))"
  echo "hardhat: $(npx hardhat --version)"
  echo "slither: $(slither --version 2>/dev/null || echo 'not installed')"
} > "$E/ENVIRONMENT.txt"
find . -type f -not -path "./node_modules/*" -not -path "./app/node_modules/*" -not -path "./artifacts/*" -not -path "./cache/*" -not -path "./app/dist/*" -not -path "./evidence/*" -not -path "./.git/*" -not -path "./release/*" -not -name "*.zip" | LC_ALL=C sort | xargs sha256sum > "$E/SOURCE_HASHES.txt"
echo "source tree sha256: $(sha256sum $E/SOURCE_HASHES.txt | cut -d' ' -f1) ($(wc -l < $E/SOURCE_HASHES.txt) files)" | tee -a "$S"

step 01-compile npx hardhat compile --force
step 02-bytecode-sizes npx hardhat run scripts/bytecode-sizes.js
step 03-test-suite npx hardhat test
step 04-release-acceptance npx hardhat test test/ReleaseAcceptance.test.js
step 05-reentrancy-malicious-tokens npx hardhat test test/SavingsCircle.attacks.test.js test/SavingsCircle.v6.test.js
step 06-invariants-1500 env INVARIANT_RUNS=1500 npx hardhat test test/SavingsCircle.invariants.test.js
step 07-mutation-check node scripts/mutation-sim.mjs
step 08-slither bash -c 'slither . --hardhat-ignore-compile --filter-paths "node_modules|contracts/test" --exclude-informational --exclude-optimization; code=$?; echo "slither exit $code (non-zero means findings were reported)"; exit $code'
step 09-app-build bash -c 'cd app && npm run build'
step 10-release-scan node scripts/release-scan.js
if [ "${SKIP_EXHAUSTIVE:-0}" != "1" ]; then
  # one combination per process, one after another: a single process running all six grows past
  # 5 GB, and two in parallel were killed by the memory limit on an 8 GB machine
  for mode in pot upfront; do for k in 0 5000 10000; do
    step "11-exhaustive-$mode-k$k" env EXHAUSTIVE=1 EXHAUSTIVE_MODE=$mode EXHAUSTIVE_K=$k npx hardhat test --no-compile test/SavingsCircle.exhaustive.test.js
  done; done
fi
echo "done $(date -u +%FT%TZ)" | tee -a "$S"
