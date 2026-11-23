# How PotLoop compares with existing savings-circle products

Every savings circle has the same weak point: the member paid early holds money the later members haven't received yet. Existing products deal with it in one of five ways. Descriptions below are from each product's own public pages, in our words, and may be out of date.

| Approach | Who | How missed payments are handled | Trade-off |
| --- | --- | --- | --- |
| Company guarantees the payout | Money Fellows (Egypt) | Credit checks and a signed contract; the company covers a missed share so the recipient is paid in full; early seats need a better credit standing | Works only with a company that underwrites and funds the guarantee |
| Identity and legal enforcement | Hakbah (Saudi Arabia), Mission Asset Fund (US) | National ID or bank link, promissory notes or loan documents, collections, credit reporting | Needs local legal systems and identity |
| No guarantee, clear disclosure | Bloom Money (UK) | States openly that it does not cover shortfalls and that members can lose money; chases missed payments with reminders and invoices | Honest, but the recipient carries the risk |
| Lock the whole cycle up front | Starosca, Sanca (on-chain), ROSCASH (prefunding) | Each member deposits all future contributions at the start | No default risk, but everyone locks the full amount |
| Penalty and insurance pools | SaveCircle, ROSCASH (described), Ajo Money (penalties, reliability scores) | Small share of each payment into a pool; quitters lose part of their deposit | Pool can run dry; usually run by the platform |

## What almost everyone does (and PotLoop now does too)

| Common practice | PotLoop |
| --- | --- |
| Early payout seats cost more (fees, credit level, or collateral) | Collateral priced by seat: what you still owe after your turn × chosen cover |
| Grace period, then a consequence | Required grace period; then penalty (before your turn) or collateral use (after) |
| A way to recover after a miss | `catchUp()` restores good standing |
| Payment history or trust score | Track record across circles: finished, finished after catching up, walked away |
| Reminders | Calendar file with each round's estimated due date |
| Statements | CSV statement of every event, with transaction links |
| Invitations the member must accept | Seat is only taken when the member locks collateral and accepts |

## Where PotLoop is different

1. **Collateral matched to what's actually at risk.** The only member who can cause a loss is one who has taken the pot and still owes rounds. PotLoop asks for collateral in proportion to exactly that, instead of the full cycle (prefunding) or nothing (most apps).
2. **Nobody holds the money.** No company account, no withdrawal approval: the contract has no admin, and money only leaves to the member it's owed to.
3. **The default rules are code anyone can read and test.** The order is fixed: collateral, then reserve, oldest debt first, defaulters' refunds last. It is tested against every "who stops paying when" pattern for 5 members.
4. **Risk is shown before you join.** How much of the money still owed is secured, and the most the group could lose if a given member stops now.

## Where others are ahead

- Identity checks and legal enforcement (Hakbah, Money Fellows). PotLoop uses wallet history only, and one person can have many wallets.
- A company-funded guarantee (Money Fellows). PotLoop guarantees nothing beyond collateral and reserve.
- Local payment rails and phone reminders. PotLoop needs QUSDC and a wallet.
- Track records, scale and regulation.

## Intellectual property

- The savings-circle mechanism is centuries old and widely described in academic work. Collateral, penalties, grace periods, insurance pools and reputation scores are used by many products, so they are shared practice, not one company's design.
- Copyright protects code, text and visual design, not mechanisms. PotLoop's code, wording and visual design are our own; nothing was copied from these products.
- Patents can cover methods. We have not done a patent search (freedom-to-operate). We found a US patent application (published 2011) on financing asset purchases through rotating credit associations; its status is unknown to us and it is not about on-chain collateral. Before commercial launch, get a patent search done by a professional.
- Names: we found no savings or fintech product called PotLoop in a quick search. A trademark search is still needed before launch.

This section is not legal advice.
