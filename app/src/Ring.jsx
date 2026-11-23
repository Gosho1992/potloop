import { STATUS } from "./chain";

// The circle itself: seats around the pot, and an outer ring showing how much of the
// money still owed (by members who already took the pot) is secured by their collateral.
export default function Ring({ circle, names, displayName, fmt }) {
  const size = 500;
  const cx = size / 2;
  const cy = size / 2;
  const seatR = 146;
  const arcR = 228;
  const n = circle.members.length;
  const { stillOwed, secured } = circle.risk;
  const owed = Number(stillOwed);
  const frac = owed === 0 ? 0 : Number(secured) / owed;
  const circ = 2 * Math.PI * arcR;
  const recipientIdx = circle.phase === "Active" && !circle.allRoundsSettled ? circle.currentRound - 1 : -1;

  const seatState = (m) => {
    if (m.status === STATUS.PRE) return "missed";
    if (m.status === STATUS.POST) return m.paidThisRound ? "late" : "ran";
    if (circle.phase === "Open") return m.accepted ? "ready" : "empty";
    if (m.paidThisRound) return "paid";
    if (circle.phase === "Active" && !circle.allRoundsSettled) return "due";
    return "done";
  };

  const pos = (i, r) => {
    const a = (i / n) * 2 * Math.PI - Math.PI / 2;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  };
  const potAmount = circle.contribution * BigInt(n);
  const potLabel =
    circle.phase === "Active" && !circle.allRoundsSettled
      ? `Round ${circle.currentRound} of ${n}`
      : circle.phase === "Open"
        ? "Not started"
        : "Finished";

  return (
    <svg className="ring" viewBox={`0 0 ${size} ${size}`} role="img"
      aria-label={owed === 0 ? "No money is owed to the group yet" : `${Math.round(frac * 100)}% of what is still owed is secured`}>
      <defs>
        <pattern id="hatch" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="7" height="7" fill="var(--risk-soft)" />
          <line x1="0" y1="0" x2="0" y2="7" stroke="var(--risk)" strokeWidth="3" />
        </pattern>
      </defs>

      {/* outer ring: secured (solid) vs uncovered (hatched) */}
      <circle cx={cx} cy={cy} r={arcR} fill="none" stroke="var(--line)" strokeWidth="18" />
      {owed > 0 && (
        <>
          <circle cx={cx} cy={cy} r={arcR} fill="none" stroke="url(#hatch)" strokeWidth="18"
            strokeDasharray={`${circ * (1 - frac)} ${circ}`} strokeDashoffset={-circ * frac}
            transform={`rotate(-90 ${cx} ${cy})`} />
          <circle cx={cx} cy={cy} r={arcR} fill="none" stroke="var(--secure)" strokeWidth="18"
            strokeDasharray={`${circ * frac} ${circ}`} transform={`rotate(-90 ${cx} ${cy})`} />
        </>
      )}

      {/* who receives this round: drawn under the pot so it never crosses the text */}
      {recipientIdx >= 0 && (() => {
        const [x, y] = pos(recipientIdx, seatR);
        return <line x1={cx} y1={cy} x2={x} y2={y} className="pot-line" />;
      })()}

      {/* the pot */}
      <circle cx={cx} cy={cy} r="84" fill="var(--pot)" />
      <text x={cx} y={cy - 30} textAnchor="middle" className="pot-small">{potLabel}</text>
      <text x={cx} y={cy + 16} textAnchor="middle" className="pot-big">{fmt(potAmount)}</text>
      <text x={cx} y={cy + 44} textAnchor="middle" className="pot-small">{circle.token.symbol} pot</text>

      {/* seats with their members' names */}
      {circle.members.map((m, i) => {
        const [x, y] = pos(i, seatR);
        const isRec = i === recipientIdx;
        // name above the top seat, below every other seat: clear of the seat rings and the outer arc
        const lx = x;
        const ly = y < cy - seatR * 0.9 ? y - 46 : y + (isRec ? 58 : 54);
        const st = seatState(m);
        const name = displayName(names, m.address);
        return (
          <g key={m.address} className={`seat seat-${st}`}>
            <circle cx={x} cy={y} r={isRec ? 34 : 29} className="seat-disc" />
            {m.paidOut && <circle cx={x} cy={y} r={isRec ? 41 : 36} className="seat-took" />}
            <text x={x} y={y + 7} textAnchor="middle" className="seat-num">{m.slot}</text>
            <text x={lx} y={ly + 5} textAnchor="middle" className="seat-name">
              {name.length > 14 ? name.slice(0, 13) + "…" : name}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
