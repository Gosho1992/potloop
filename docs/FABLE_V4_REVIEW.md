# Fable 5.2 review of PotLoop v4 (Nov 20, 2026, about $1.10)

> **Historical document.** Written for an earlier version, before the QIE mainnet deployment of 23 Nov 2026. Statements about what has or has not been deployed, which wallets to create and test counts describe that time. Current state: [`FINAL_RELEASE_READINESS.md`](FINAL_RELEASE_READINESS.md).

Overall: **5.7 / 10** now; about **6.8–7** after the fixes below plus a live mainnet deployment with real circles.

| Criterion | Score | Reason (short) |
| --- | --- | --- |
| Innovation (30) | 6 | Crowded category; seat-priced collateral, catch-up and the waterfall are real but incremental |
| Technical (25) | 6.5 | Testing far above hackathon norm; invariants miss parameter abuse and cross-liability |
| UX (15) | 6.5 | Risk meter, .ics, CSV, invites good; no push reminders, no worst-case-loss disclosure |
| QIE integration (15) | 4 | Not deployed yet in a mainnet-only event; about 7 once live |
| Business (15) | 4.5 | No users, no niche, no distribution |

Versus industry: leads on transparency, non-custody, enforceable collateral and tested solvency; trails Money Fellows, Hakbah and MAF on identity, guarantees, collections and credit reporting; trails full-prefunding designs on safety unless cover is 100%.

## Security findings and our check

| ID | Sev. | Finding | Our check | Fix |
| --- | --- | --- | --- | --- |
| H1 | High | Tiny round/grace (e.g. 1 second): seat 1 accepts last, pays, settles 2 seconds later; everyone else is marked as leaving and their collateral funds seat 1's pot | Real | Minimum and maximum round, grace and join lengths; first round starts with time to pay |
| H2 | High | Huge roundLength overflows `deadline()` or locks the circle for decades | Real | Upper bounds |
| M1 | Med | A member behind after their turn whose misses were all covered still has their leftover collateral used for other people's debts | Real | Return leftover collateral directly to them |
| M2 | Med | finalize can run the moment the last round settles, so nobody can catch up on the last round | Real | finalize only after one grace period, unless nobody is behind |
| M3 | Med | Caller can starve gas so a registry write silently fails inside try/catch and erase a default from the record | Real | Remove try/catch (registry is our own factory) |
| M4 | Med | Track record farmed with tiny circles between own wallets | Real | Minimum contribution; record volume, show volume |
| M5 | Med | Anyone can add any address to unlimited circles (spam, phishing names) | Real | List a member only after they accept; invitations from events |
| M6 | Med | Fake contract in an invite link gets the user's approval | Real (frontend) | Check `factory.isCircle` before the join screen |
| L1 | Low | catchUp after the window closes still re-defaults at next settle | Real | catchUp also pays the current round when unpaid |
| L2 | Low | Early settle ignores members behind, so it can draw their collateral while they could still pay | Real | Early settle waits for them too |
| L3 | Low | Entitlements repaid later carry no fee | Real | Charge fee there too, or document |
| L4 | Low | Round start drifts with settle time, so calendar dates drift | Real | Fixed schedule: next start = max(previous deadline, now) |
| L5 | Low | No way to leave while joining is open | Real | `leave()` before the circle starts |
| L6 | Low | Blacklisted address can't withdraw | Real | `withdrawTo(address)` |
| L7 | Low | `circlesPage` overflow on a huge limit | Real | Safer bound |

Clean: reentrancy, ledger vs balance accounting, rounding beyond dust, loop gas (N ≤ 12), fee-on-transfer, sweep donation attacks, reputation poisoning of non-members.

## Mechanism loopholes

- Below 100% cover, walking away after your turn is profitable. Fix: default to 100% in the UI, label lower cover "friends only — you can lose X", show the worst-case loss per seat before joining.
- One person holding several early seats (sybil). Fix: warn about early seats with no history; gate on recorded volume.
- A member who leaves before their turn can lose more than one contribution if others also default (refunds are paid last). Fix: show the worst case before joining.
- Late seats carry the most risk for no reward. Fix: weight penalty and surplus shares toward later seats.
- Catching up is an interest-free loan. Fix: small late fee into the reserve.
- "Defaulted" mixes "left before turn" and "took the pot and ran". Fix: four outcomes.

## Gaps vs industry (cheapest fixes)

- No guarantee or collections: copy Bloom's explicit disclosure; a worst-case screen before signing.
- Reminders: a keeper/reminder bot that also calls settle and finalize.
- Identity: require `.qie` names for early seats in the UI; show history with volume.
- Insurance pool: skip and say so, or route part of the fee to the circle's reserve.
- One-page terms and risk statement; publish the invariant report.

## Fable's top 5 actions

1. Fix H1, H2, M1–M4; add tests; rerun the exhaustive suite.
2. Deploy to mainnet, verify, run 3+ real circles with real people; put transaction links in the README.
3. Harden the join screen: isCircle check, exact approvals, worst-case loss per seat, 100% cover default, zero-history warning.
4. Ship the keeper and reminder bot.
5. Tell a company story: one named community, pilot numbers, fee maths, a 3-minute mainnet video including the default path.
