import { seatRisk } from "./economics";
import { amount } from "./ui";

/**
 * One seat's commitment, exposure and default scenarios. Used on the create screen, the join
 * screen, the seat tab and the risk tab, so every screen shows the same numbers.
 * Commitment and exposure come from the contract when available; scenarios come from the
 * contract-verified simulator and say what they assume.
 */
export function SeatRisk({ size, contribution, coverageBps, feeBps, seatIndex, contractTerms, fromPayout = false, decimals, symbol, compact = false }) {
  const money = (v) => amount(v, decimals, symbol);
  const r = seatRisk({ size, contribution, coverageBps, feeBps, seatIndex, contractTerms, fromPayout });
  const t = r.terms;
  const seat = seatIndex + 1;
  const isLast = seatIndex === size - 1;

  return (
    <div className={compact ? "seat-risk compact" : "seat-risk"}>
      {!compact && (
        <div className="capital">
          <div><span>Money to start</span><strong>{money(t.startCapital)}</strong><small>{money(t.upfront)} to join + your round 1 payment</small></div>
          <div><span>Locked until the circle ends</span><strong>{money(t.collateral)}</strong><small>{t.heldFromPot > 0n ? `${money(t.upfront)} now, ${money(t.heldFromPot)} held from your pot` : "from when you join"}; comes back at the end</small></div>
          <div><span>Most you could lose if you keep paying</span><strong className={r.worstHonestLoss > 0n ? "warn" : ""}>{money(r.worstHonestLoss)}</strong><small>in the scenarios below; more failures at once can cost more</small></div>
        </div>
      )}
      <h4>{compact ? `Seat ${seat}` : "Your commitment"}</h4>
      <dl>
        <div><dt>Pays each round</dt><dd>{money(contribution)}</dd></div>
        <div><dt>Pays in total</dt><dd>{money(t.totalContributions)}</dd></div>
        <div><dt>Locks to join</dt><dd>{money(t.upfront)}</dd></div>
        <div><dt>Pot in round {seat}</dt><dd>{money(t.pot)}</dd></div>
        {t.payoutFee > 0n && <div><dt>Service fee</dt><dd>−{money(t.payoutFee)}</dd></div>}
        {t.heldFromPot > 0n && <div><dt>Held back as collateral</dt><dd>−{money(t.heldFromPot)}</dd></div>}
        <div><dt>{compact ? "Can withdraw" : "You can withdraw"} in round {seat}</dt><dd><strong>{money(t.inHandAtTurn)}</strong></dd></div>
        <div><dt>Collateral returned at the end</dt><dd>{money(t.collateral)}, minus any used for {compact ? "its" : "your"} own missed payments</dd></div>
      </dl>

      <h4>{compact ? "Exposure" : "Your exposure after you receive the pot"}</h4>
      <dl>
        <div><dt>Still to pay after the pot</dt><dd>{money(t.remainingAfterPayout)}</dd></div>
        <div><dt>Backed by collateral</dt><dd>{money(t.collateralBacked)}</dd></div>
        <div><dt>Not backed</dt><dd className={t.uncoveredAfterPayout > 0n ? "warn" : ""}>{money(t.uncoveredAfterPayout)}</dd></div>
      </dl>
      {!compact && (
        <p className="muted small">
          {r.source === "contract"
            ? "Commitment and exposure are read from the circle contract. The lines below are simulations."
            : "Calculated from the circle's settings with the contract's own formula (no on-chain quote for this seat yet). The lines below are simulations."}
        </p>
      )}

      <h4>{compact ? "What if" : "What if someone stops paying"}</h4>
      <ul className="scenarios">
        {isLast ? (
          <li>
            {compact ? "This seat" : "You"} receive{compact ? "s" : ""} the last pot, so nothing is owed after it: the collateral is a joining bond.
          </li>
        ) : (
          <li className={r.youWalk.gain > 0n ? "warn" : ""}>
            <strong>If {compact ? "this seat" : "you"} take{compact ? "s" : ""} the pot and stop{compact ? "s" : ""} paying:</strong>{" "}
            {r.youWalk.gain > 0n
              ? `${compact ? "it" : "you"} would be ${money(r.youWalk.gain)} better off than paying, and the members paid later lose ${money(r.youWalk.othersLose)}.`
              : `the collateral pays every round still owed: ${compact ? "it gains" : "you gain"} nothing and nobody else loses.`}
          </li>
        )}
        {r.youLeave && (
          <li>
            <strong>If {compact ? "this seat" : "you"} stop{compact ? "s" : ""} before {compact ? "its" : "your"} turn:</strong> {compact ? "it loses" : "you lose"} {money(r.youLeave.penalty)}{" "}
            to the members who stay; the rest comes back at the end (last, after everyone owed is paid).
          </li>
        )}
        {r.onePrevWalks && (
          <li className={r.onePrevWalks.finalLoss > 0n ? "warn" : ""}>
            <strong>If seat {seat - 1} takes its pot and stops paying:</strong>{" "}
            {r.onePrevWalks.atTurn === 0n
              ? `${compact ? "this seat" : "you"} still receive${compact ? "s" : ""} the full pot (seat ${seat - 1}'s collateral covers it).`
              : `${compact ? "this seat" : "you"} receive${compact ? "s" : ""} ${money(r.onePrevWalks.atTurn)} less at ${compact ? "its" : "your"} turn${
                  r.onePrevWalks.finalLoss > 0n ? `, and ${money(r.onePrevWalks.finalLoss)} of it is never repaid.` : ", repaid before the circle ends."
                }`}
          </li>
        )}
        {r.allPrevWalk && (
          <li className={r.allPrevWalk.finalLoss > 0n ? "warn" : ""}>
            <strong>If seats 1–{seat - 1} all take their pots and stop paying:</strong>{" "}
            {r.allPrevWalk.finalLoss === 0n && r.allPrevWalk.atTurn === 0n
              ? `${compact ? "this seat" : "you"} still receive${compact ? "s" : ""} the full pot.`
              : `${compact ? "this seat" : "you"} receive${compact ? "s" : ""} ${money(r.allPrevWalk.atTurn)} less at ${compact ? "its" : "your"} turn; ${
                  r.allPrevWalk.finalLoss > 0n ? `${money(r.allPrevWalk.finalLoss)} is never repaid.` : "it is repaid before the end."
                }`}
          </li>
        )}
        {r.earlyLeaver && r.earlyLeaver.atTurn > 0n && (
          <li>
            <strong>If seat {r.earlyLeaver.seat} leaves in round 1 without paying:</strong> {compact ? "this seat" : "you"} receive{compact ? "s" : ""}{" "}
            {money(r.earlyLeaver.atTurn)} less at {compact ? "its" : "your"} turn, repaid {r.earlyLeaver.finalLoss > 0n ? "only in part" : "in full"} before the end
            {r.earlyLeaver.netChange > 0n ? `, plus a share of the leaver's penalty` : ""}.
          </li>
        )}
      </ul>
      {!compact && (
        <p className="muted small">
          Each line assumes only the members named stop paying, and that the token and contract work as tested. Several failures at once can cost more. Nobody, including PotLoop, guarantees payouts
          beyond the collateral and reserve.
        </p>
      )}
    </div>
  );
}
