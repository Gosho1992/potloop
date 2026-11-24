# Demo video: narration script

The narration of the PotLoop demo video (about 3 min 40 s with a 13-second silent clip of the real QIE Wallet creating a circle on mainnet, after block 8). Every claim is checked against the repo in the table at the end.

Read at a calm pace, about 140 words a minute. Each block is one scene of the video; the time is where that scene starts. Pause for one breath between blocks. If a block takes you longer than its slot, that's fine: send me the recording and I will fit the video to your voice.

Recording tips: use a quiet room and your phone's voice recorder held about 20 cm from your mouth. Record it in one take, or one take per block. Say "Q-I-E" as letters and "QUSDC" as "Q-U-S-D-C".

---

**1. Hook — 0:00** *(screen: What-if table at 20% cover, four members in red)*

Six people save together. Ten QUSDC each, every month. Seat one takes the sixty-QUSDC pot in month one, and then stops paying. With twenty percent collateral, seat one walks away forty up, and four members lose almost ten each.

**2. Same circle, full cover — 0:17** *(screen: the same table at 100% cover, all zeros)*

Same circle at full cover: seat one's own collateral pays every round it still owes. It gains nothing, and nobody loses.

**3. Title — 0:26** *(screen: PotLoop title card)*

This is PotLoop: savings circles where you see your risk before you join.

**4. The problem — 0:31** *(screen: PotLoop home page on QIE mainnet)*

Committees, stokvels and tandas run on trust. But the person paid first still owes the most after their turn, and most groups ask everyone for the same deposit, or none. PotLoop prices each seat's collateral from the payments that seat still owes, and the contract on QIE enforces it.

**5. Create a circle — 0:48** *(screen: members in payout order)*

An organiser lists the members in payout order, then sets the amount and how often everyone pays.

**6. Cover and collateral — 0:55** *(screen: cover levels and collateral source)*

The group picks a cover level. One hundred percent is the default. Collateral can come mostly from the pot, so nobody needs a big deposit to join.

**7. The difference — 1:05** *(screen: seat 1 table, then the up-front version)*

Seat one starts with twenty QUSDC: one share to join and its first payment. The rest of its collateral is held back from its own pot and returned at the end. Locked up front, the same protection would need sixty to start.

**8. Every seat, before signing — 1:19** *(screen: seat cards)*

Every member sees their seat before they sign: money to start, what stays locked, and what's not backed. These numbers come from a simulator that we test against the contract after every step.

**9. It happened on mainnet — 1:32** *(screen: real circle S4 on QIE mainnet)*

This really happened on QIE mainnet. Five members, twenty percent cover. Seat one took the pot, then missed rounds two and three.

**10. Default — 1:41** *(screen: history: missed round, collateral paid)*

Its collateral paid what it could. The next two members were paid short, and the contract recorded what they were still owed.

**11. Catch-up — 1:51** *(screen: history: caught up, reserve repays)*

In round four, seat one caught up in full. The reserve then repaid the oldest debt first. Every member was made whole, and the circle ended holding zero.

**12. Verified on QIE — 2:03** *(screen: QIE explorer, factory source verified)*

The circle factory's source code is verified on QIE's explorer.

**13. Evidence — 2:08** *(screen: evidence card)*

Seven circles and five hundred and eleven mainnet transactions; five hundred and ten succeeded. The one that failed was a payment that arrived after a sixty-second deadline, and the contract refused it, as it should. Locally, all forty-six thousand six hundred and fifty-six exhaustive patterns pass, every planted bug was caught, and twenty-three browser tests pass.

**14. Where we are — 2:31** *(screen: status card)*

PotLoop is live on QIE mainnet with real QUSDC. We reviewed the contracts for security ourselves and tested every path you just saw, but no independent firm has audited them yet. Next: that audit, a production factory, and pilot groups using QIE Wallet.

**15. Close — 2:48** *(screen: end card)*

PotLoop. Your circle. Your turn. Your money. Built on QIE.

---

## Every claim, checked against the evidence

| Said in the video | Source |
| --- | --- |
| Six members, 10 QUSDC monthly, 20% cover: seat 1 gains +40, seats 3–6 lose 9.95 each; at 100% all zero | The app's What-if panel on the create screen (filmed) |
| From the pot: seat 1 needs 20 QUSDC to start, 50 locked; up front: 60 to start | The app's "How much money does seat 1 need?" table, both modes (filmed) |
| S4: 5 members, 20% cover; seat 1 missed rounds 2 and 3; collateral paid 0.016; seats 2 and 3 paid short (0.004, 0.02); catch-up in round 4; reserve repaid the older debt first; circle ends at 0 | Circle 0xe7461b15…c804 history on mainnet; `MAINNET_CIRCLES.csv` |
| Factory source verified | QIE explorer, `contracts/CircleFactory.sol`, verified 23 Nov 2026 |
| 7 circles, 511 transactions, 510 succeeded, 1 reverted (late payment, 60 s deadline) | `MAINNET_FINANCIAL_RECONCILIATION.md`, `MAINNET_TEST_RESULTS.md` |
| 46,656/46,656 exhaustive patterns; 15/15 mutations ("every planted bug"); 26/26 browser tests | `LOCAL_FORK_EDGE_CASE_REPORT.md`, `UI_E2E_REPORT.md` |
| Live on mainnet with real QUSDC; own security review (`SECURITY_REVIEW.md`), no independent audit yet | `SECURITY_REVIEW.md`, `FINAL_RELEASE_READINESS.md` |
