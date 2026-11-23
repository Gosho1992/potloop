# V9.2 changelog

> **Historical document.** Written for an earlier version, before the QIE mainnet deployment of 23 Nov 2026. Statements about what has or has not been deployed, which wallets to create and test counts describe that time. Current state: [`FINAL_RELEASE_READINESS.md`](FINAL_RELEASE_READINESS.md).

**Contracts (new factory deployment required)**
- `SavingsCircle`: optional **collateral from the pot** (`collateralFromPayout`). Members lock a one-share bond to join. At each payout the contract holds back enough of the recipient's pot to bring their collateral to ceil((N − r) × c × cover), and returns it at the end. New view `upfrontCollateral(slot)` and new event `CollateralHeldFromPot`. With the option off, behaviour is unchanged.
- `CircleFactory`: `createCircle(..., bool collateralFromPayout)`, a `rules()` view returning every creation rule in one read, and `FACTORY_VERSION = 92`. The minimum cover is enforced in both modes. No admin powers; everything is immutable.

**App**
- Reads the factory's real rules. Cover levels below the minimum are disabled with the reason. If the rules can't be read, or the factory is an older version, Create stays off with a clear message; a lower minimum is never assumed.
- Collateral choice on the create screen ("mostly from the pot", the default, or "all up front").
- Cover comparison for seat 1: money to start, locked until the end, in hand at its turn, not backed, and walk-away gain, for every allowed cover level.
- Below 100% cover, the creator must tick a box stating seat 1's exact walk-away gain and what the others would lose.
- Seat cards open with three answers: money to start, locked until the end, and the most you could lose if you keep paying.
- Accepting a seat approves exactly `upfrontCollateral(slot)` from the circle. Circle history explains the held-from-pot event.

**Simulator and tests**
- `sim.js` mirrors the new mode and records the full state after every step.
- The parity test compares full state at every step: 14 named scenarios × 2 modes, 12 precision cases, 160 random scenarios, and every quoted catch-up cost.
- `scripts/mutation-sim.mjs`: 11 deliberate simulator errors, all caught.
- `SavingsCircle.v92.test.js`: from-pot mode, short payouts, 100% walk-away neutrality, bond refunds and cancellation, a catch-up with too little approved, factory `rules()`, the minimum cover in both modes, and directly deployed circles not trusted.
- The invariant test alternates collateral modes.
- `scripts/run-evidence.sh` reproduces all evidence from a clean copy. `docs/PAYOFF_MATRIX.md` now has both modes and checks that walk-away and catch-up results match between them.
