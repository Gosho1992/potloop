import { config, QUSDC_MAINNET } from "./config";

export default function Risks() {
  return (
    <section className="create risks">
      <h1>Risks and rules, in plain words</h1>
      <p className="sub">Read this before you lock money in a circle.</p>
      <h2>Nobody holds your money, and nobody guarantees it</h2>
      <p>
        Each circle is a contract on QIE with no owner and no admin. Nobody, including PotLoop, can change its rules, pause it, or move the money.
        That also means nobody can fix a mistake or top up a shortfall. PotLoop does not guarantee payouts beyond the collateral and the group reserve shown on each circle.
      </p>
      <h2>What can go wrong</h2>
      <ul>
        <li><strong>A member stops paying after taking the pot.</strong> Their collateral pays their share until it runs out. Below 100% cover, the members paid later can lose money. Each seat's worst case is shown before you join.</li>
        <li><strong>A member leaves before their turn.</strong> They lose their turn and up to one round's payment. If others also stop paying, a leaver's refund comes last and can be less than what they paid in.</li>
        <li><strong>The token.</strong> Circles use QUSDC ({QUSDC_MAINNET}), a bridged USDC on QIE, not issued by Circle. If the token's issuer freezes, pauses or blocks it, the circle can't override that. You can withdraw to another address if yours is blocked.</li>
        <li><strong>Bugs.</strong> The contracts are tested heavily but not audited by a security firm. Use small amounts.</li>
        <li><strong>Track records.</strong> The history shown next to a member is for that address only. One person can have many addresses. It is not identity verification or a credit check.</li>
        <li><strong>Missing a payment by accident.</strong> Pay inside the grace period and nothing happens. After it, see the rules below.</li>
      </ul>
      <h2>The rules</h2>
      <ul>
        <li>Seats and payout order are fixed when the circle is created. You join by locking your seat's collateral. You can leave and get it back until the circle starts.</li>
        <li>Collateral per seat = what that seat still owes after its turn × the cover the group chose (at least one round's share for the last seat).</li>
        <li>Behind after your turn: your collateral pays for you. You can catch up at any time before the circle finishes (refill collateral + pay what's missing + a 2% late fee to the group).</li>
        <li>After the last round there is a cure window before anyone can finish the circle, so members behind can still catch up.</li>
        <li>Money owed to members paid short is repaid oldest first. Refunds to members who left come last.</li>
        <li>PotLoop keeps a small fee from pot money paid out (shown on each circle, at most 1%).</li>
        <li>Only open circles from links that show this site's address. The app checks every circle against PotLoop's official factory and refuses anything else.</li>
      </ul>
      <p className="muted">Network: QIE chain {config.chainId}. Factory: {config.factory || "not set"}.</p>
      <p><a className="button" href="#/">Back</a></p>
    </section>
  );
}
