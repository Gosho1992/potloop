#!/bin/bash
# usage: step.sh <scenario>   runs one ~120 s slice of the resumable runner
cd "$(dirname "$0")"
export DEPLOYER_PRIVATE_KEY=$(node -e 'console.log(require("./funder-wallet.json").privateKey)')
export FACTORY=0xD099c7361157Ec20a9Ac145aF4B66Af553AeDae4
declare -A CODES=([1]=S1-d9a14bd2 [2]=S2-4ff83b17 [3]=S3-012fcb51 [4]=S4-3740e9a4 [5]=S5-578b1d76 [6]=S6-5b66b7df [7]=S7-813b37b2)
export SCENARIO=$1 APPROVE=${CODES[$1]} STEP_SECONDS=${STEP_SECONDS:-130}
npx hardhat run scripts/mainnet-step-runner.js --network qieMainnet 2>&1 | tee -a step-S$1.log | grep -v "^$"
