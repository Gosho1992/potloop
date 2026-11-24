import { BrowserProvider, Contract, JsonRpcProvider } from "ethers";
import abi from "./circleAbi.json";
import factoryAbi from "./factoryAbi.json";
import { config, factories, chainParams } from "./config";

const erc20Abi = [
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
];

export const PHASES = ["Open", "Active", "Completed", "Cancelled"];
export const STATUS = { GOOD: 0, PRE: 1, POST: 2 };

export const readProvider = new JsonRpcProvider(config.rpc, config.chainId, { staticNetwork: true });

/** The RPC must really be the chain we expect: true, false (another chain), or null (unreachable). */
export async function verifyNetwork() {
  try {
    return parseInt(await readProvider.send("eth_chainId", []), 16) === config.chainId;
  } catch {
    return null;
  }
}

export function circleAt(address, runner) {
  return new Contract(address, abi, runner);
}

export function factoryAt(runner, address = config.factory) {
  return address ? new Contract(address, factoryAbi, runner) : null;
}

const originCache = new Map(); // circle address -> factory entry
/**
 * Which trusted factory created this circle, or null if none did. A failed read throws (a
 * network error must never make a genuine circle look fake).
 */
export async function factoryOf(address) {
  const key = address.toLowerCase();
  if (originCache.has(key)) return originCache.get(key);
  for (const f of factories) {
    if (await factoryAt(readProvider, f.address).isCircle(address)) {
      originCache.set(key, f);
      return f;
    }
  }
  return null;
}

/** Reads everything the screens need, straight from the contract. */
export async function loadCircle(address, account) {
  const c = circleAt(address, readProvider);
  // a circle is only "genuine" if one of PotLoop's trusted factories created it and it uses that
  // factory's token. A failed read must surface as a network error, never as "not genuine"
  // (that would wrongly tell members a real circle is a fake)
  const origin = factories.length ? await factoryOf(address) : null;
  const factory = origin ? factoryAt(readProvider, origin.address) : null;
  const isCircle = Boolean(origin);
  // never read (or show actions for) an address no trusted factory created
  if (factories.length && !isCircle) return { notGenuine: true, address };
  const factoryToken = factory ? await factory.token() : null;
  const [tokenAddr, contribution, coverageBps, roundLength, grace, joinDeadline, size, organizer, feeBps, name, finalizeAfter, fromPayout, recorded] = await Promise.all([
    c.token(), c.contribution(), c.coverageBps(), c.roundLength(), c.grace(), c.joinDeadline(), c.size(), c.organizer(),
    c.feeBps().catch(() => 0n),
    factory && isCircle ? factory.nameOf(address).catch(() => "") : "",
    c.finalizeAfter().catch(() => 0n),
    // v9.2 circles; older circles took all collateral upfront
    c.collateralFromPayout().catch(() => false),
    factory && isCircle ? factory.recorded(address).catch(() => false) : false,
  ]);
  const genuine = Boolean(factory && isCircle && factoryToken && factoryToken.toLowerCase() === tokenAddr.toLowerCase());
  const token = new Contract(tokenAddr, erc20Abi, readProvider);
  const [symbol, decimals, phase, currentRound, roundStart, allRoundsSettled, freeReserve, addresses, risk, block] =
    await Promise.all([
      token.symbol(), token.decimals(), c.phase(), c.currentRound(), c.roundStart(), c.allRoundsSettled(),
      c.freeReserve(), c.members(), c.risk(), readProvider.getBlock("latest"),
    ]);

  const n = Number(size);
  const members = await Promise.all(
    addresses.map(async (address, i) => {
      const [m, exp, required, upfront, paidThisRound, withdrawable, record, arrears, cost, quotedTerms] = await Promise.all([
        c.member(i),
        c.memberExposure(i),
        c.collateralFor(i),
        // what accept() pulls: v9.2 circles say so; older circles pull collateralFor(i)
        fromPayout ? c.upfrontCollateral(i) : c.collateralFor(i),
        currentRound > 0n ? c.contributed(currentRound, i) : false,
        c.withdrawable(address),
        factory ? factory.history(address).catch(() => null) : null,
        c.arrearsOf(i).catch(() => [0n, 0n]),
        c.catchUpCost(i).catch(() => [0n, 0n, 0n]),
        // V9 circles expose this quote directly. Older deployed circles fall back to
        // the immutable formula below, preserving read-only compatibility.
        c.seatTerms(i).catch(() => null),
      ]);
      return {
        index: i,
        slot: i + 1,
        address,
        accepted: m.accepted,
        paidOut: m.paidOut,
        status: Number(m.status),
        collateral: m.collateral,
        collateralRequired: upfront, // what accepting the seat locks now
        collateralTarget: required, // full collateral after the payout (same as upfront unless held from the pot)
        paidIn: m.paidIn,
        collateralUsed: m.collateralUsed,
        unpaidEntitlement: m.unpaidEntitlement,
        recordedLoss: m.recordedLoss,
        refundClaim: m.refundClaim,
        refundPaid: m.refundPaid,
        stillOwes: exp.stillOwes,
        secured: exp.secured,
        uncovered: exp.uncovered,
        paidThisRound,
        withdrawable,
        record: record ? toRecord(record) : null,
        missedRounds: Number(m.missedRounds ?? 0),
        arrears: arrears[0] + arrears[1],
        catchUpTotal: cost[0],
        catchUpCurrentPart: cost[1],
        catchUpLateFee: cost[2],
        catchUpArrears: cost[0] - cost[1] - cost[2],
        contractTerms: quotedTerms
          ? {
              collateral: quotedTerms.requiredCollateral,
              totalContributions: quotedTerms.totalContributions,
              expectedPayout: quotedTerms.expectedPayout,
              payoutFee: quotedTerms.payoutFee,
              remainingAfterPayout: quotedTerms.remainingAfterPayout,
              uncoveredAfterPayout: quotedTerms.uncoveredAfterPayout,
              upfront,
            }
          : null,
      };
    })
  );

  let me = null;
  if (account) {
    const idx = members.findIndex((m) => m.address.toLowerCase() === account.toLowerCase());
    const [balance, allowance, withdrawable] = await Promise.all([
      token.balanceOf(account),
      token.allowance(account, address),
      c.withdrawable(account),
    ]);
    me = { account, index: idx, member: idx >= 0 ? members[idx] : null, balance, allowance, withdrawable };
  }

  return {
    address,
    name,
    genuine,
    factory: origin?.address || null,
    testFactory: Boolean(origin && !origin.current),
    finalizeAfter: Number(finalizeAfter),
    recorded,
    feeBps: Number(feeBps),
    fromPayout,
    token: { address: tokenAddr, symbol, decimals: Number(decimals) },
    contribution,
    coverageBps: Number(coverageBps),
    roundLength: Number(roundLength),
    grace: Number(grace),
    joinDeadline: Number(joinDeadline),
    size: n,
    organizer,
    phase: PHASES[Number(phase)],
    currentRound: Number(currentRound),
    roundStart: Number(roundStart),
    deadline: Number(roundStart) + Number(roundLength),
    allRoundsSettled,
    freeReserve,
    risk: {
      stillOwed: risk.stillOwed,
      secured: risk.secured,
      freeReserve: risk.freeReserve,
      unpaidEntitlements: risk.unpaidEntitlements,
      claimShortfall: risk.claimShortfall,
      netUncovered: risk.netUncovered,
      coverageBps: Number(risk.coverageBps),
    },
    members,
    me,
    chainTime: Number(block.timestamp),
  };
}

/** The circle's own event log, newest first. Fetched in bounded block ranges and cached, so each
 *  refresh only asks for blocks it hasn't seen. */
const historyCache = new Map(); // address -> { next, events, times }
// QIE's public RPC answers eth_getLogs for at most 10,000 blocks at a time
const CHUNK = 5000;

async function limitedAll(items, limit, fn) {
  const out = [];
  for (let i = 0; i < items.length; i += limit) out.push(...(await Promise.all(items.slice(i, i + limit).map(fn))));
  return out;
}

export async function loadHistory(address) {
  const c = circleAt(address, readProvider);
  const key = address.toLowerCase();
  const origin = await factoryOf(address).catch(() => null);
  const start = origin ? origin.fromBlock : Math.min(...factories.map((f) => f.fromBlock), config.fromBlock || 0);
  const entry = historyCache.get(key) || { next: start || 0, events: [], times: new Map() };
  try {
    const latest = await readProvider.getBlockNumber();
    for (let from = entry.next; from <= latest; from += CHUNK) {
      const to = Math.min(from + CHUNK - 1, latest);
      const logs = await c.queryFilter("*", from, to);
      for (const l of logs) {
        if (!l.fragment) continue;
        entry.events.push({ name: l.fragment.name, args: l.args, tx: l.transactionHash, block: l.blockNumber, idx: l.index });
      }
      entry.next = to + 1;
    }
    const missing = [...new Set(entry.events.map((e) => e.block))].filter((b) => !entry.times.has(b));
    await limitedAll(missing, 6, async (b) => entry.times.set(b, (await readProvider.getBlock(b))?.timestamp ?? 0));
    historyCache.set(key, entry);
    return entry.events
      .map((e) => ({ ...e, time: entry.times.get(e.block) }))
      .sort((a, b) => b.block - a.block || b.idx - a.idx);
  } catch (e) {
    console.warn("history unavailable", e);
    return entry.events.length ? entry.events.map((e) => ({ ...e, time: entry.times.get(e.block) })).reverse() : null;
  }
}

// ---------------------------------------------------------------- factory

export const toRecord = (h) => ({
  completed: Number(h.completed),
  caughtUp: Number(h.caughtUp),
  leftEarly: Number(h.leftEarly),
  walkedAway: Number(h.walkedAway),
  volume: h.volume,
});

/** Invitations: Invited events naming this account (bounded, newest first). Only our factory's. */
async function loadInvites(f, account, fromBlock = config.fromBlock || 0) {
  const latest = await readProvider.getBlockNumber();
  const out = [];
  for (let to = latest; to >= fromBlock && out.length < 30; to -= CHUNK) {
    const from = Math.max(to - CHUNK + 1, fromBlock);
    const logs = await f.queryFilter(f.filters.Invited(null, account), from, to);
    for (const l of logs.reverse()) out.push(l.args.circle);
    if (from === fromBlock) break;
  }
  return [...new Set(out)].slice(0, 30);
}

/** Newest circles, the account's joined circles and its invitations, each bounded. */
export async function loadCircles(account) {
  const f = factoryAt(readProvider);
  if (!f) return null;
  // circles from every trusted factory; each remembers which one created it
  const per = await Promise.all(
    factories.map(async (entry) => {
      const fx = factoryAt(readProvider, entry.address);
      const [page, joined, invites] = await Promise.all([
        fx.circlesPage(0, 40),
        account ? fx.joinedPage(account, 0, 40) : [],
        account ? loadInvites(fx, account, entry.fromBlock).catch(() => []) : [],
      ]);
      for (const a of [...page, ...joined, ...invites]) originCache.set(a.toLowerCase(), entry);
      return { page: [...page], joined: [...joined], invites };
    })
  );
  const page = per.flatMap((x) => x.page);
  const joined = per.flatMap((x) => x.joined);
  const invites = per.flatMap((x) => x.invites);
  const tokenAddr = await f.token();
  const token = new Contract(tokenAddr, erc20Abi, readProvider);
  const [symbol, decimals] = await Promise.all([token.symbol(), token.decimals()]);
  const joinedSet = new Set(joined.map((a) => a.toLowerCase()));
  const inviteSet = new Set(invites.map((a) => a.toLowerCase()));
  const all = [...new Set([...joined, ...invites, ...page].map((a) => a.toLowerCase()))];
  const list = await limitedAll(all, 8, async (lower) => {
    const address = [...joined, ...invites, ...page].find((x) => x.toLowerCase() === lower);
    const c = circleAt(address, readProvider);
    const origin = originCache.get(lower);
    const [name, phase, size, contribution, coverageBps, currentRound, allRoundsSettled, accepted] = await Promise.all([
      factoryAt(readProvider, origin.address).nameOf(address), c.phase(), c.size(), c.contribution(), c.coverageBps(), c.currentRound(), c.allRoundsSettled(), c.acceptedCount(),
    ]);
    let slot = 0;
    let myAccepted = false;
    if (account && (joinedSet.has(lower) || inviteSet.has(lower))) {
      slot = Number(await c.slotOf(account));
      if (slot > 0) myAccepted = (await c.member(slot - 1)).accepted;
    }
    return {
      address, name, test: !origin.current, phase: PHASES[Number(phase)], size: Number(size), contribution, coverageBps: Number(coverageBps),
      currentRound: Number(currentRound), allRoundsSettled, accepted: Number(accepted), slot, myAccepted,
    };
  });
  return { token: { address: tokenAddr, symbol, decimals: Number(decimals) }, circles: list, feeBps: Number(await f.feeBps()) };
}

/** The cover levels a circle can use (SavingsCircle enforces this list). */
export const COVER_LEVELS = [10000, 5000, 4000, 3000, 2000, 0];

/**
 * The configured factory's creation rules, read from the factory itself.
 * - v9.2 factories answer rules() in one call (version 92, minimum cover, collateral modes).
 * - An older factory has no rules(): it is reported as { canCreate: false }, because its
 *   createCircle signature differs; its minimum cover is never assumed to be lower.
 * - If the factory cannot be read at all (network, RPC), this throws: the caller must show the
 *   error and keep "Create" disabled rather than guess.
 */
export async function loadFactoryRules() {
  const f = factoryAt(readProvider);
  if (!f) return { canCreate: false, reason: "No factory is configured for this build." };
  const code = await readProvider.getCode(config.factory);
  if (code === "0x") return { canCreate: false, reason: "The configured factory address has no contract on this network." };
  // the bytecode tells whether rules() exists, so a failed call is never mistaken for "older"
  const hasRules = code.includes(f.interface.getFunction("rules").selector.slice(2));
  if (!hasRules) {
    return { canCreate: false, reason: "The configured factory is an older version. Circles it created still work here, but new circles need the v9.2 factory." };
  }
  const r = await f.rules();
  return {
    canCreate: true,
    version: Number(r.version_),
    token: r.token_,
    treasury: r.treasury_,
    feeBps: Number(r.feeBps_),
    minRoundLength: Number(r.minRoundLength_),
    minGrace: Number(r.minGrace_),
    minContribution: r.minContribution_,
    minCoverageBps: Number(r.minCoverageBps_),
  };
}

/** A wallet's track record, added up over every trusted factory. */
export async function loadRecord(address) {
  if (!factories.length) return null;
  const parts = await Promise.all(factories.map((f) => factoryAt(readProvider, f.address).history(address)));
  return parts.map(toRecord).reduce((a, b) => ({
    completed: a.completed + b.completed,
    caughtUp: a.caughtUp + b.caughtUp,
    leftEarly: a.leftEarly + b.leftEarly,
    walkedAway: a.walkedAway + b.walkedAway,
    volume: a.volume + b.volume,
  }));
}

// ---------------------------------------------------------------- wallet

let discovered = [];
if (typeof window !== "undefined") {
  window.addEventListener("eip6963:announceProvider", (e) => discovered.push(e.detail));
  window.dispatchEvent(new Event("eip6963:requestProvider"));
}

function pickInjected() {
  const qie = discovered.find((d) => d.info?.rdns === "me.qiewallet");
  if (qie) return { provider: qie.provider, name: "QIE Wallet" };
  if (window.qie) return { provider: window.qie, name: "QIE Wallet" };
  if (discovered[0]) return { provider: discovered[0].provider, name: discovered[0].info?.name || "Wallet" };
  if (window.ethereum) return { provider: window.ethereum, name: "Wallet" };
  return null;
}

export async function connectWallet() {
  const found = pickInjected();
  if (!found) throw new Error("No wallet found. Install QIE Wallet from qiewallet.me, then reload this page.");
  const eip = found.provider;
  const [account] = await eip.request({ method: "eth_requestAccounts" });
  const current = parseInt(await eip.request({ method: "eth_chainId" }), 16);
  if (current !== config.chainId) {
    try {
      await eip.request({ method: "wallet_switchEthereumChain", params: [{ chainId: chainParams.chainId }] });
    } catch (err) {
      if (err?.code === 4902) {
        await eip.request({ method: "wallet_addEthereumChain", params: [chainParams] });
      } else throw err;
    }
  }
  // check again: the wallet must really be on the network the app reads from
  const after = parseInt(await eip.request({ method: "eth_chainId" }), 16);
  if (after !== config.chainId) throw new Error(`Switch your wallet to ${chainParams.chainName} (chain ${config.chainId}), then try again.`);
  return { eip, account, walletName: found.name };
}

/**
 * Quiet reconnect on page load: only if the wallet has already allowed this site and is on the
 * right network. Never opens a wallet prompt; returns null otherwise.
 */
export async function reconnectWallet() {
  const found = pickInjected();
  if (!found) return null;
  const eip = found.provider;
  const [account] = (await eip.request({ method: "eth_accounts" })) || [];
  if (!account) return null;
  const id = parseInt(await eip.request({ method: "eth_chainId" }), 16);
  if (id !== config.chainId) return null;
  return { eip, account, walletName: found.name };
}

/**
 * Signer for a write, after checking the wallet is still on the expected network.
 * Gas is estimated on the app's own QIE RPC, not the wallet's: a wallet's node can fail an
 * estimate with no reason ("missing revert data") even when the transaction is fine, and a real
 * revert then comes back with its reason, which explainError can put in words.
 */
export async function signerFrom(eip) {
  const id = parseInt(await eip.request({ method: "eth_chainId" }), 16);
  if (id !== config.chainId) throw new Error(`Your wallet is on chain ${id}. Switch it to ${chainParams.chainName} (chain ${config.chainId}) first.`);
  const wallet = new BrowserProvider(eip);
  wallet.estimateGas = async (tx) => ((await readProvider.estimateGas(tx)) * 125n) / 100n;
  return wallet.getSigner();
}

export function tokenWith(runner, address) {
  return new Contract(address, erc20Abi, runner);
}
