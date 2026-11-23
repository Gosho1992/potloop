# PotLoop economic model (source-derived; not independently audited)

## Verified simulator

`app/src/sim.js` mirrors `settle()`, `catchUp()` and `finalize()` exactly, in integer base units. `test/Sim.parity.test.js` runs named and random scenarios (2–12 members, every cover level, both collateral modes, fees, defaults before and after payout, catch-ups during rounds, after an expired deadline and in the cure window, amounts from 1 base unit to the maximum) through both the real contract and the simulator. It requires identical state after every step: each member's status, collateral, payments, entitlements, losses, refunds, penalties and balances, plus the round fund, reserve and every quoted catch-up cost. `scripts/mutation-sim.mjs` shows the test catches deliberate accounting errors (11 of 11). The simulator does not model cancellation, `leave()`, stray-token sweeps or withdrawals; contract tests cover those. Every figure in the app's "What if" sections and in `docs/PAYOFF_MATRIX.md` comes from this simulator.

## V9 member quote

V9 circles expose `seatTerms(slotIndex)` on-chain. It returns required collateral, all scheduled contributions, expected payout after the fixed fee, fee amount, scheduled payments remaining after payout and the portion of those scheduled payments not backed by that seat's collateral. The application displays this quote when available; its formula fallback is only for prior circle deployments that lack this view function.

## Collateral modes (v9.2, rule corrected in v9.2.1)

A circle chooses at creation where collateral comes from:

- **Upfront:** accepting seat i locks `collateral(i)` (formula below).
- **From the pot:** accepting seat i locks `min(collateral(i), c)`: at most one contribution. Whenever pot money is credited to a member (its own payout or a later repayment of a short payout) while it still owes a scheduled payment, the contract first raises its collateral toward `collateral(i)`, from the amount after fee, and pays out the rest. The target is always the seat's own collateral, never something based on the round the money arrives in, so collateral never exceeds it. "Still owes a payment": some round is unsettled and the member has not already paid the last round. Held collateral is returned at finalize, like upfront collateral.

**v9.2.1 correction.** v9.2 set the target from the round the money arrived in: `ceil((N − r) × c × cover)`. That equals `collateral(i)` at the member's own payout, but is lower for a repayment in a later round. If a payout was so short that the hold itself was cut short (for example three of five members leaving in round 1, at 100% cover with a 1% fee), the later repayment did not restore the collateral to the seat's amount. A catch-up at the start of a round also targeted one round too few. Final results were never affected in the scenarios searched (842,970 small-circle cases), but collateral could sit below the seat's amount for the rest of the circle, which matters if that member later stopped paying.

**Rules checked on the contract after every transaction** (`test/circleRunner.js`, in every parity, regression and lifecycle test), independently of the simulator:
- R1: a member's collateral never exceeds `collateral(i)`.
- R2: a member in good standing holds exactly `min(collateral(i), locked to join + pot money credited after fee while still owing a payment)`.
- R3: every pot credit splits exactly into collateral held + fee + withdrawable; each repayment lowers the entitlement by exactly its amount; in a catch-up the reserve changes by exactly (uncovered + late fee − repayments).

`scripts/mutation-sim.mjs` puts the old v9.2 rule into both the contract and the simulator: parity cannot see a shared mistake, but R2 fails.

**How the modes compare** ([`docs/MODE_COMPARISON.md`](docs/MODE_COMPARISON.md), exhaustive for 3–5 members, 1,011,564 scenarios): every member's final result is identical in both modes except in one combination, where a member stops before its own payout **and** another stops after its payout and never catches up. An early leaver's refund is paid last, after members who are owed. In upfront mode an early seat's leftover collateral is large and helps repay them; in from-pot mode it locked at most one share. In that combination, a member who kept paying was at most 1 contribution worse off at 50% cover (0.6 at 40%, 0.2 at 30%), and never worse off at 100% or at 0–20%. Leaving in round 1 costs the same in both modes, because the join amount is a full share (capped at the seat's collateral).

Money to start a seat = upfront collateral + the round 1 payment. In hand at a member's turn = pot − fee − amount held. At 100% cover the first seat of 12 has about 1.94c in hand, because full cover means early seats get little credit.

## Contribution and payout

For `N` members and contribution `c`, each round targets a gross pot `N × c`. Seat `s` (1-based) is the recipient in round `s`. The configured service fee is at most 1% of pot money actually credited, with the factory's treasury fixed at factory deployment.

## Collateral formula

For zero-based slot `i`, the code computes:

`collateral(i) = ceil(max(N − 1 − i, 1) × c × coverageBps / 10,000)`.

At seat 1, the multiplier is `N−1`; at seat N, it is 1. The last-seat floor means positive cover locks collateral even though no scheduled contributions remain after that seat's payout. The formula approximates a chosen fraction of the post-payout contributions still exposed, rounded up in token base units.

Examples below use a 1-token contribution and show collateral per seat in order, with exact integer token amounts. At 0% all values are zero; at 20%, 30%, 40%, 50%, 100%, multiply the listed multiplier by that fraction and round up to the smallest token unit. For human-readable whole-token examples, values are exact where divisible:

| Members | 20% coverage | 30% coverage | 40% coverage | 50% coverage | 100% coverage |
| --- | --- | --- | --- | --- | --- |
| 2 | 0.2, 0.2 | 0.3, 0.3 | 0.4, 0.4 | 0.5, 0.5 | 1, 1 |
| 3 | 0.4, 0.2, 0.2 | 0.6, 0.3, 0.3 | 0.8, 0.4, 0.4 | 1, 0.5, 0.5 | 2, 1, 1 |
| 6 | 1, 0.8, 0.6, 0.4, 0.2, 0.2 | 1.5, 1.2, 0.9, 0.6, 0.3, 0.3 | 2, 1.6, 1.2, 0.8, 0.4, 0.4 | 2.5, 2, 1.5, 1, 0.5, 0.5 | 5, 4, 3, 2, 1, 1 |
| 12 | 2.2, 2, 1.8, 1.6, 1.4, 1.2, 1, 0.8, 0.6, 0.4, 0.2, 0.2 | 3.3, 3, 2.7, 2.4, 2.1, 1.8, 1.5, 1.2, 0.9, 0.6, 0.3, 0.3 | 4.4, 4, 3.6, 3.2, 2.8, 2.4, 2, 1.6, 1.2, 0.8, 0.4, 0.4 | 5.5, 5, 4.5, 4, 3.5, 3, 2.5, 2, 1.5, 1, 0.5, 0.5 | 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 1 |

For a smallest-unit contribution, ceiling matters: for example, at 20% the last seat locks at least one base unit. The UI and contract should use integer token units and actual token decimals.

## Default and recovery rules

- Before receiving a payout, a member who misses a settled round becomes `PrePayoutDefault`, loses that turn, and their remaining collateral joins the reserve. A penalty of up to one contribution is deducted from their recorded paid-in plus collateral claim. Any refund claim is paid last under the contract's final allocation rules.
- After receiving a payout, a member who misses a settled round becomes `PostPayoutDefault`. At settlement, up to one contribution of their remaining collateral covers that round's pot. Any remaining uncovered shortfall can leave a recipient's payout unpaid.
- Catch-up restores the collateral previously consumed, pays arrears collateral could not cover, pays the current round if not yet recorded (including an expired but unsettled round), and adds 2% of arrears to group reserve. It is atomic; exact transfer failure reverts state changes.
- Reserve repays eligible older unpaid entitlements before subsequent payouts. At finalization, defaulting members' unpaid entitlements are netted against obligations; unrecovered amounts are recorded as losses. Excess reserve is distributed by the contract's rules.

## Economic risk, not a guarantee

Coverage is a collateral amount, not insurance. In a simplified single-default case, a member who has already received a pot may leave remaining contribution exposure beyond collateral, particularly at coverage below 100%; reserve and collateral from other defaults can be insufficient. In simultaneous defaults, aggregate secured value and reserve can be smaller than aggregate obligations. Full collateral coverage should be read against the contract's specific exposure definition and timing, not as a guarantee against token failure, contract defects, or correlated defaults.

## Incentives: when is walking away profitable? (v9.1)

`docs/PAYOFF_MATRIX.md` (generated by `node scripts/payoff-matrix.mjs`) gives, for 2, 3, 6 and 12 members, every cover level and every seat: the honest net result, the gain from taking the pot and then never paying again, what the other members lose, the cost of catching up instead, and the result of leaving before your turn.

What it shows, with contribution `c`, cover `k` and seat `s` (1-based):

- Walking away after your payout gains about `(N − 1 − s) × c × (1 − k)`, the part of your remaining payments that collateral doesn't back. Other members lose that amount plus fees.
- **At 100% cover the gain is 0 and no member loses**, for one defaulter and for the coordinated case where the first half of the seats all walk away.
- Below 100% cover walking away is profitable for early seats (for example 12 members at 0% cover: seat 1 gains 11 contributions). No penalty that only uses money already in the contract can remove this without asking for more collateral. PotLoop therefore does not claim default is discouraged below 100% cover; it shows the exact figure on every seat card instead.
- A factory can enforce a minimum cover (`minCoverageBps`, v9.1). The production deployment script defaults it to 100%.
- Leaving before your turn always costs a positive cover member something, because every seat (including the last) locks at least one share × cover as a joining bond.

Not covered by any cover level: token failure or freezes by the issuer, contract defects, and anything outside the circle's own balance.

## Catch-up fee example

If arrears comprise 100 tokens of collateral refill and 50 tokens of uncovered obligation, the fee is `floor(150 × 200 / 10,000) = 3` tokens. The member also pays any current-round contribution separately. The fee does not compound. The current-round payment is not included in the fee base.
