import { config } from "./config";

// A finished mainnet circle where a member missed two rounds and then caught up in full:
// the best single example of what PotLoop does. Only linked when the app reads mainnet.
const EXAMPLE_CIRCLE = "0xe7461b1505f74663707786C3fc22bCBB8aaAc804";
const QIE_WALLET_URL = "https://www.qiewallet.me";

export default function Guide() {
  const showExample = config.chainId === 1990;
  return (
    <section className="create guide">
      <h1>How to use PotLoop</h1>
      <p className="sub">A savings circle where everyone pays in each round and one member takes the whole pot, in turn. PotLoop runs it on QIE, with collateral so a member who stops paying can't leave the others short.</p>

      <div className="tour">
        <h2>Try it in two minutes, no wallet needed</h2>
        <ol>
          {showExample && (
            <li>
              <a href={`#/c/${EXAMPLE_CIRCLE}`}>Open a test circle that ran on QIE mainnet with real QUSDC</a>. Seat 1 took the pot, missed two rounds, then caught up. Open the <strong>Risk and history</strong> tab to see every step, each with its transaction.
            </li>
          )}
          <li>
            <a href="#/new">Start a circle</a> and paste any wallet addresses. Nothing is sent until you connect a wallet and confirm.
          </li>
          <li>Scroll to <strong>What if someone stops paying?</strong> Pick who stops and when: the table shows what happens to every member before anyone signs.</li>
        </ol>
      </div>

      <h2>What you need to take part</h2>
      <ul className="need">
        <li><strong>QIE Wallet.</strong> <a href={QIE_WALLET_URL} target="_blank" rel="noreferrer">Install it</a> in your browser or on your phone, then use <strong>Connect wallet</strong> at the top of this page.</li>
        <li><strong>A little QIE</strong> to pay network fees. Each action needs only a tiny amount.</li>
        <li><strong>QUSDC</strong>, the dollar token circles are paid in. <a href={config.dexUrl} target="_blank" rel="noreferrer">Swap QIE for QUSDC on QIEDEX</a>.</li>
      </ul>

      <div className="paths">
        <div>
          <h2>If you organise the circle</h2>
          <ol className="steps">
            <li><strong>Start a circle.</strong> Give it a name and add members in payout order: seat 1 gets the first pot.</li>
            <li><strong>Set the amount and how often</strong> everyone pays, for example 10 QUSDC every 30 days.</li>
            <li><strong>Cover is 100%.</strong> A member who stops paying after their turn is paid for by their own collateral, so nobody else loses. PotLoop's live factory requires it.</li>
            <li><strong>Create it and share the invite link</strong> with each member (WhatsApp is fine). The circle starts when every seat is taken.</li>
          </ol>
        </div>
        <div>
          <h2>If you're a member</h2>
          <ol className="steps">
            <li><strong>Open the invite link</strong> and connect your wallet.</li>
            <li><strong>Read your seat</strong> under <strong>Your seat</strong>: money to start, what stays locked until the end, and what isn't backed.</li>
            <li><strong>Accept your seat.</strong> This locks your collateral. You can leave and get it back until the circle starts.</li>
            <li><strong>Pay each round</strong> before the deadline. The circle page shows the date, and <strong>Add payment dates to my calendar</strong> puts every deadline in your calendar.</li>
            <li><strong>Get the pot on your turn.</strong> Part may be held back as collateral, and it comes back when the circle finishes.</li>
            <li><strong>Withdraw at the end.</strong> Anyone can press <strong>Finish the circle</strong> after the last round; then each member withdraws what they're owed.</li>
          </ol>
        </div>
      </div>

      <h2>If something goes wrong</h2>
      <ul>
        <li><strong>You're late.</strong> Pay inside the grace period and nothing happens.</li>
        <li><strong>You missed a round after your turn.</strong> Your collateral pays for you. Use <strong>Catch up</strong> on the circle page any time before it finishes to clear your record (what's missing, plus a 2% late fee that goes to the group).</li>
        <li><strong>Someone else stops paying.</strong> Their collateral pays their share. If it runs out, what you're owed is recorded and repaid first when money comes in.</li>
      </ul>

      <h2>Words you'll see</h2>
      <dl className="glossary">
        <dt>Pot</dt><dd>Everyone's payments for one round, paid to one member.</dd>
        <dt>Seat</dt><dd>Your place in the payout order. Seat 1 is paid first and still owes the most afterwards.</dd>
        <dt>Cover</dt><dd>How much of what each seat still owes after its turn is backed by collateral. The group chooses it.</dd>
        <dt>Collateral</dt><dd>Money locked for your seat. It pays your share if you stop paying, and comes back at the end.</dd>
        <dt>From the pot / up front</dt><dd>Collateral can be held back from your own pot (join with at most one share) or locked in full when you join.</dd>
        <dt>Reserve</dt><dd>Money the circle keeps from late fees and from members who left early, used to repay members who were paid short.</dd>
        <dt>Grace period</dt><dd>Extra time after each deadline before a payment counts as missed.</dd>
        <dt>Track record</dt><dd>What a wallet address did in earlier PotLoop circles. It isn't identity or a credit check.</dd>
      </dl>

      <p className="muted">Before you lock money, read <a href="#/risks">Risks and rules</a>.</p>
      <p><a className="button primary" href="#/new">Start a circle</a></p>
    </section>
  );
}
