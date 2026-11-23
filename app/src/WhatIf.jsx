import { useMemo, useState } from "react";
import { simulate } from "./sim.js";
import { amount } from "./ui";

/**
 * "What if" panel: pick who stops paying, when, and whether they catch up later; see what every
 * member would end up with. Runs the contract-verified simulator from the circle's settings
 * (from round 1), so it is a simulation, not the circle's live balances.
 */
export function WhatIf({ size, contribution, coverageBps, feeBps, fromPayout = false, decimals, symbol, names = [] }) {
  const money = (v) => amount(v, decimals, symbol);
  const signed = (v) => (v > 0n ? `+${money(v)}` : v < 0n ? `−${money(-v)}` : money(0n));
  const [rows, setRows] = useState([{ seat: 1, stop: 2, catchUp: 0 }]);
  const label = (i) => names[i] || `Seat ${i + 1}`;

  const result = useMemo(() => {
    const stopAt = Array(size).fill(0);
    const catchUpAt = Array(size).fill(0);
    for (const r of rows) {
      stopAt[r.seat - 1] = r.stop;
      catchUpAt[r.seat - 1] = r.catchUp > r.stop ? r.catchUp : 0;
    }
    const base = { n: size, c: contribution, k: coverageBps, feeBps, fromPayout };
    return { run: simulate({ ...base, stopAt, catchUpAt }), honest: simulate(base) };
  }, [rows, size, contribution, coverageBps, feeBps, fromPayout]);

  const set = (i, patch) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const rounds = Array.from({ length: size }, (_, i) => i + 1);

  return (
    <section className="whatif" aria-label="What if someone stops paying">
      <h3>What if someone stops paying?</h3>
      <p className="muted">
        A simulation from round 1 with this circle's settings, using the same rules as the contract (checked against it in our tests). It doesn't use the live balances.
      </p>
      {rows.map((r, i) => (
        <div className="whatif-row" key={i}>
          <label>
            Member{" "}
            <select value={r.seat} onChange={(e) => set(i, { seat: Number(e.target.value) })}>
              {rounds.map((s) => <option key={s} value={s}>{label(s - 1)}</option>)}
            </select>
          </label>
          <label>
            stops paying from round{" "}
            <select value={r.stop} onChange={(e) => set(i, { stop: Number(e.target.value) })}>
              {rounds.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <label>
            catches up{" "}
            <select value={r.catchUp} onChange={(e) => set(i, { catchUp: Number(e.target.value) })}>
              <option value={0}>never</option>
              {rounds.filter((s) => s > r.stop).map((s) => <option key={s} value={s}>in round {s}</option>)}
              <option value={size + 1}>after the last round</option>
            </select>
          </label>
          {rows.length > 1 && <button className="icon" aria-label="Remove" onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}>×</button>}
        </div>
      ))}
      {rows.length < size && (
        <button className="ghost" onClick={() => setRows((rs) => [...rs, { seat: Math.min(size, rs.length + 1), stop: 2, catchUp: 0 }])}>Add another member who stops</button>
      )}
      <table className="members whatif-table">
        <thead>
          <tr>
            <th scope="col">Member</th>
            <th scope="col">Pot at their turn</th>
            <th scope="col">Never repaid</th>
            <th scope="col">Collateral used</th>
            <th scope="col">Better or worse off than if everyone paid</th>
          </tr>
        </thead>
        <tbody>
          {result.run.members.map((m, i) => {
            const diff = m.net - result.honest.members[i].net;
            const status = m.outcome === "left" ? " (left before their turn)" : m.outcome === "walked" ? " (stopped after their turn)" : m.outcome === "caughtUp" ? " (caught up)" : "";
            return (
              <tr key={i}>
                <td>{label(i)}<span className="muted">{status}</span></td>
                <td>{m.potAtTurn > 0n ? money(m.potAtTurn) : "none"}</td>
                <td className={m.finalLoss > 0n ? "warn" : ""}>{money(m.finalLoss)}</td>
                <td>{money(m.collateralUsed)}</td>
                <td className={diff < 0n ? "warn" : ""}>{signed(diff)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="muted small">Every token is accounted for: what members get back plus the fee equals what they put in{result.run.conserved ? "" : " (check failed)"}.</p>
    </section>
  );
}
