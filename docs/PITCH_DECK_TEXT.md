# Pitch deck: text and speaker notes

The 12 slides of the PotLoop presentation, as text, so the claims can be checked against the repo.

## Slide 1 (cover)
QIE Mainnet Hackathon 3.0 · DeFi & Financial Infrastructure
PotLoop
Savings circles where every member sees their risk before they join.
Zain Zia · Live on QIE mainnet · potloop.vercel.app
Speaker notes: Hi, I’m Zain. PotLoop brings committees, stokvels and tandas onto QIE mainnet, and it does one thing no other savings-circle app does: it shows every member, before they lock any money, exactly what their seat risks.

## Slide 2 (problem)
The problem
The person paid first still owes the most
Seat 1
5 left
Seat 2
4 left
Seat 3
3 left
Seat 4
2 left
Seat 5
1 left
Seat 6
0 left
In a six-person circle, seat 1 takes the pot in month 1 and still owes five payments.
Most groups ask everyone for the same deposit, or none. Nobody sees which seat could cost them money until someone stops paying.
Speaker notes: Payments each seat still owes after receiving the pot. Seat one has the most to walk away from. A flat deposit treats every seat the same, so the risk is invisible until a default happens.

## Slide 3 (moment)
The moment it goes wrong
Seat 1 takes the pot, then stops paying
20% coverSeat 1 +40. Four members −9.95 each.
100% coverSeat 1 gains nothing. Nobody loses.
Speaker notes: This is the app’s What-if panel, using the contract’s own rules: six members, 10 QUSDC a month. At 20% cover, walking away after the pot earns seat one 40 QUSDC and four members lose almost 10 each. At full cover, seat one’s own collateral pays every round it still owes.

## Slide 4 (product)
What PotLoop does
Each seat’s collateral matches what that seat still owes
Price the promise
Earlier seats lock more collateral, because they owe more after their payout. Every member sees the exact amount before joining.
Settle in public
A missed payment follows a fixed order: the round’s payments, the member’s collateral, the group reserve, then a recorded debt.
Recover without favours
A member who falls behind can catch up in full. Money owed is repaid oldest first.
Non-custodial: every circle is its own contract on QIE with no owner or admin. Paid in QUSDC.
Speaker notes: Three ideas. Collateral is priced per seat. Defaults follow a public waterfall written in the contract. And recovery is rule-based: catch-up restores standing only when the full amount arrives, and debts are repaid oldest first.

## Slide 5 (innovation)
What’s new
Full protection without a big deposit
Collateral mostly from the pot
20
QUSDC for seat 1 to start: one share to join plus its first payment. The rest is held back from its own pot and returned at the end.
All collateral up front
60
QUSDC to start for the same 100% protection.
Six members, 10 QUSDC a month, 100% cover. Figures from the app’s seat calculator, which follows the contract’s formula.
Speaker notes: This is the core innovation. A full-cover circle normally needs seat one to lock everything it will owe on day one. PotLoop holds the collateral back from the pot that seat receives, so joining costs at most one share, with exactly the same protection. Both modes were run side by side on mainnet in test S3 and gave identical results.

## Slide 6 (beforesign)
Before anyone signs
The trade-off, in numbers
For every cover level the group may pick: money to start, what stays locked, what is not backed, and what seat 1 could gain by walking away.
Every seat also gets a card and a What-if panel. A simulator checked against the contract after every step produces the numbers.
Speaker notes: The organiser sees this on the create screen. Below 100% cover the app shows the exact walk-away gain and the group has to tick a box accepting it. Members see their own seat’s worst case on the invite page before they lock collateral.

## Slide 7 (mainnet)
Real circle on QIE mainnet
A default and a full recovery
Five members, 20% cover, 0.02 QUSDC a round.
Seat 1 takes the pot, then misses rounds 2 and 3.
Its collateral pays what it can; seats 2 and 3 are paid short and the contract records what they’re owed.
Round 4: seat 1 catches up in full; the reserve repays the oldest debt first.
Everyone is made whole. The circle ends holding 0.
Speaker notes: Test S4, circle 0xe746…c804. Every line on the right is read from the contract’s events on mainnet, and each links to its transaction on the explorer. This is the scenario other savings apps handle by hand or through a moderator.

## Slide 8 (qie)
Built on QIE
Six parts of QIE in one product
QIE mainnet
CircleFactory, CircleDeployer and one SavingsCircle contract per group.
QUSDC
Every payment, payout and collateral amount.
QIE Wallet
Found and connected through the standard wallet discovery (EIP-6963).
QIE ID names
Add members as name.qie, resolved through QIE’s public Wallet service.
QIEDEX
Members short of QUSDC get a link to swap for it.
QIE explorer
Factory source verified; every history line links to its transaction.
Speaker notes: The judging brief rewards using several QIE components. PotLoop uses six: mainnet contracts, QUSDC, QIE Wallet, QIE ID names, a QIEDEX link for getting QUSDC, and the explorer for verification and transaction links.

## Slide 9 (evidence)
Evidence
Tested with real money, then tested exhaustively
7
circles on mainnet with real QUSDC, all finished
511
mainnet transactions: 510 succeeded, 1 late payment refused by the contract
Verified
production and testing factories’ source on the QIE explorer
46,656
of 46,656 exhaustive payment patterns pass
15 / 15
planted bugs caught; 1,500 random runs
23 / 23
browser tests on the production app
Speaker notes: The one reverted transaction was a payment that arrived 34 seconds after a 60-second demo deadline; the contract refused it, as it should. Every mainnet run was reconciled from receipts and token transfer logs: each member ended with exactly the simulator’s predicted balance. Locally there are also 142 passing contract tests and 34 history checks on a copy of mainnet. All of it is in the public repo.

## Slide 10 (business)
Business
Who uses it, and how it earns
First users
Organisers of small committees that already trust each other: 3–6 members, 100% cover, short circles.
Revenue
A fee on each pot paid out, never on collateral, capped at 1% by the contract. The pilot factory charges 0%; a fee comes with a later factory, once QIE has a multisig for it.
Growth
Each circle has an invite link. When a circle finishes, each member’s result can be recorded on chain, so a good payer brings that record to the next group.
No customers yet. The 90 days after judging: pilot circles, recurring users and pot volume on QIE.
Speaker notes: The fee is set when a factory is deployed and can never change. The production factory deployed on 24 November charges nothing, so no key can collect from it; the testing factory charged 0.5%. Track records are per wallet address; they are a history signal, not identity or credit checks, and the app says so.

## Slide 11 (status)
Where we are
Live on QIE mainnet, with a verified production factory.
Today
Production factory live and source-verified: daily rounds, 100% cover required, no fee.
7 test circles ran with real QUSDC; a person used the real QIE Wallet on mainnet.
Security-reviewed and tested by us; not yet audited by an independent firm.
Cover protects against members who stop paying, not against the token’s issuer.
Next
Independent security audit.
Pilot circles with real savings groups.
A fee only once QIE has a multisig for it.
QIE Wallet mobile testing.
Speaker notes: The production factory was deployed from my own QIE Wallet on 24 November: rounds of at least a day, a six-hour grace period, at least 1 QUSDC, 100% cover, and no fee, so no key can ever collect from it. The testing factory with one-minute rounds ran the seven test circles; the app still opens them, labelled as test circles. What we don’t claim is a third-party audit; that comes next.

## Slide 12 (close)
PotLoop
Your circle. Your turn. Your money.
Try it
potloop.vercel.app
Code
github.com/Gosho1992/potloop
Production factory on QIE mainnet
0xE1ea943b865F47e984156526add5E07B03893834
Speaker notes: Thank you. Open the live app, look at any of the seven mainnet circles, or start one in the create screen and play with the What-if panel. Questions welcome.
