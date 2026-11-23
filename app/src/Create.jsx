import { useEffect, useMemo, useRef, useState } from "react";
import { isAddress, getAddress, parseUnits } from "ethers";
import { config } from "./config";
import { COVER_LEVELS, factoryAt, loadCircles, loadFactoryRules, loadRecord, signerFrom } from "./chain";
import { resolveQieName, resolveNames, displayName, shortAddr } from "./names";
import { amount, explainError, TxLink, Record } from "./ui";
import { capitalComparison, collateralForSeat, coverageLabel, seatRisk, upfrontForSeat } from "./economics";
import { SeatRisk } from "./SeatRisk";
import { WhatIf } from "./WhatIf";

const SCHEDULES = [
  { id: "demo", label: "Every 3 minutes", hint: "demo speed: pay within 4 minutes", round: 180, grace: 60, join: 15 * 60 },
  { id: "daily", label: "Every day", hint: "6 hours grace", round: 86400, grace: 6 * 3600, join: 2 * 86400 },
  { id: "weekly", label: "Every week", hint: "1 day grace", round: 7 * 86400, grace: 86400, join: 3 * 86400 },
  { id: "monthly", label: "Every 30 days", hint: "3 days grace", round: 30 * 86400, grace: 3 * 86400, join: 7 * 86400 },
];
const COVERS = [
  { bps: 10000, text: "Full cover (recommended): if a member stops paying after their turn, their collateral pays every round they still owe." },
  { bps: 5000, text: "Friends only. Early seats lock half of what they still owe; the members paid last can lose money if someone walks away." },
  { bps: 4000, text: "Friends only. The members paid last can lose money if someone walks away." },
  { bps: 3000, text: "Friends only. The members paid last can lose money if someone walks away." },
  { bps: 2000, text: "Friends only. Little protection: the members paid last can lose most of what an early seat still owes." },
  { bps: 0, text: "No collateral at all. Only for people who fully trust each other." },
];

const joinList = (l) => (l.length <= 1 ? l.join("") : `${l.slice(0, -1).join(", ")} and ${l[l.length - 1]}`);
let nextId = 1;
const newRow = (input = "") => ({ id: nextId++, input });

export default function Create({ wallet, onConnect, names, setNames }) {
  const [name, setName] = useState("");
  const [rows, setRows] = useState(() => [newRow(), newRow(), newRow()]);
  const [contrib, setContrib] = useState("1");
  const [schedule, setSchedule] = useState("weekly");
  const [cover, setCover] = useState(10000);
  const [token, setToken] = useState({ symbol: "QUSDC", decimals: 6 });
  const [rules, setRules] = useState(null);
  const [rulesError, setRulesError] = useState("");
  const [fromPayout, setFromPayout] = useState(true);
  const [riskAccepted, setRiskAccepted] = useState(false);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState("");
  const [records, setRecords] = useState({});
  const [reviewing, setReviewing] = useState(false);
  const rowsRef = useRef(rows);
  rowsRef.current = rows;

  useEffect(() => {
    loadCircles().then((d) => d && setToken(d.token)).catch(() => {});
    // the factory's real rules decide what can be created; if they can't be read, creating stays off
    loadFactoryRules()
      .then(setRules)
      .catch((e) => setRulesError(`Couldn't read the PotLoop factory's rules from QIE (${e?.shortMessage || e?.message || "network error"}). Creating is turned off until they load; reload to try again.`));
  }, []);

  useEffect(() => {
    if (wallet && rows.every((r) => !r.input)) {
      setRows((rs) => [{ ...rs[0], input: wallet.account, address: getAddress(wallet.account) }, ...rs.slice(1)]);
      loadRecord(wallet.account).then((rec) => rec && setRecords((o) => ({ ...o, [wallet.account.toLowerCase()]: rec }))).catch(() => {});
    }
  }, [wallet]); // eslint-disable-line react-hooks/exhaustive-deps

  const minCover = rules?.canCreate ? rules.minCoverageBps : null; // null = not known yet
  const coverAllowed = (bps) => minCover === null || bps >= minCover;
  useEffect(() => {
    if (minCover !== null && cover < minCover) setCover(COVER_LEVELS.filter((b) => b >= minCover).pop() ?? 10000);
  }, [minCover]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => setRiskAccepted(false), [cover]);

  const allowed = SCHEDULES.filter((s) => !rules?.canCreate || (s.round >= rules.minRoundLength && s.grace >= rules.minGrace));
  useEffect(() => {
    if (rules && !allowed.find((s) => s.id === schedule) && allowed[0]) setSchedule(allowed[0].id);
  }, [rules]); // eslint-disable-line react-hooks/exhaustive-deps

  // edits are applied by row id, never by position, so a slow name lookup can't overwrite a moved or edited row
  const patchRow = (id, patch) => setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  async function resolveRow(id) {
    const row = rowsRef.current.find((r) => r.id === id);
    if (!row) return;
    const input = row.input.trim();
    if (!input) return patchRow(id, { address: undefined, error: undefined, qie: undefined });
    const stillSame = () => rowsRef.current.find((r) => r.id === id)?.input.trim() === input;
    if (isAddress(input)) {
      const address = getAddress(input);
      patchRow(id, { address, error: undefined, qie: undefined });
      resolveNames([address]).then((n) => setNames((old) => ({ ...old, ...n })));
      loadRecord(address).then((rec) => rec && setRecords((o) => ({ ...o, [address.toLowerCase()]: rec }))).catch(() => {});
      return;
    }
    patchRow(id, { address: undefined, error: undefined, checking: true });
    const r = await resolveQieName(input);
    if (!stillSame()) return; // the row changed while we were looking it up
    if (!r) return patchRow(id, { checking: false, error: "No QIE ID with that name. Paste the 0x address instead." });
    const address = getAddress(r.address);
    patchRow(id, { address, qie: r.name, checking: false });
    loadRecord(address).then((rec) => rec && setRecords((o) => ({ ...o, [address.toLowerCase()]: rec }))).catch(() => {});
  }

  const move = (i, d) =>
    setRows((rs) => {
      const j = i + d;
      if (j < 0 || j >= rs.length) return rs;
      const out = rs.slice();
      [out[i], out[j]] = [out[j], out[i]];
      return out;
    });

  const sched = SCHEDULES.find((s) => s.id === schedule) || allowed[0] || SCHEDULES[0];
  const filled = rows.filter((r) => r.address);
  const seatOf = (row) => filled.indexOf(row); // seat numbers follow the order the contract will use
  const n = filled.length;
  let c = 0n;
  try {
    c = parseUnits(contrib || "0", token.decimals);
  } catch {}
  const money = (v) => amount(v, token.decimals, token.symbol);
  const colFor = (i) => collateralForSeat(n, c, cover, i);
  const joinFor = (i) => upfrontForSeat(n, c, cover, i, fromPayout);
  const dupes = new Set(filled.map((r) => r.address.toLowerCase())).size !== n;

  const problem = useMemo(() => {
    if (rulesError) return rulesError;
    if (!rules) return "Reading the factory's rules from QIE…";
    if (!rules.canCreate) return rules.reason;
    if (!name.trim()) return "Give the circle a name members will recognise.";
    if (/[\u0000-\u001f\u007f]/.test(name)) return "The name can't contain line breaks or control characters.";
    if (n < 2) return "Add at least 2 members.";
    if (n > 12) return "A circle can have at most 12 members.";
    if (dupes) return "Each member can only have one seat.";
    if (rows.some((r) => r.input.trim() && !r.address)) return "One of the members isn't a valid address or QIE ID yet.";
    if (c <= 0n) return "Set how much each member pays per round.";
    if (c < rules.minContribution) return `The minimum per round is ${money(rules.minContribution)}.`;
    if (cover < rules.minCoverageBps) return `This factory only creates circles with at least ${rules.minCoverageBps / 100}% cover.`;
    if (cover < 10000 && !riskAccepted) return "Below 100% cover, tick the box under the cover choice to confirm the group accepts the risk shown.";
    return "";
  }, [name, n, dupes, rows, c, rules, rulesError, cover, riskAccepted]); // eslint-disable-line react-hooks/exhaustive-deps

  async function create() {
    setError("");
    setBusy({ label: "Create circle: confirm in your wallet" });
    try {
      const signer = await signerFrom(wallet.eip);
      const f = factoryAt(signer);
      const tx = await f.createCircle(name.trim(), filled.map((r) => r.address), c, cover, sched.round, sched.grace, sched.join, fromPayout);
      setBusy({ label: "Create circle: confirming on QIE", tx: tx.hash });
      const rc = await tx.wait();
      const ev = rc.logs.map((l) => { try { return f.interface.parseLog(l); } catch { return null; } }).find((e) => e?.name === "CircleCreated");
      window.location.hash = `#/c/${ev.args.circle}`;
    } catch (e) {
      console.error(e);
      setError(explainError(e));
    } finally {
      setBusy(null);
      setReviewing(false);
    }
  }

  const feeBps = rules?.feeBps || 0;
  // seat 1's own walk-away: what it would gain and what the members paid after it would lose
  const firstWalk = n >= 2 && c > 0n ? seatRisk({ size: n, contribution: c, coverageBps: cover, feeBps, seatIndex: 0, fromPayout }).youWalk : null;
  const offered = COVER_LEVELS.filter(coverAllowed);
  const compare = n >= 2 && c > 0n ? capitalComparison({ size: n, contribution: c, feeBps, seatIndex: 0, fromPayout, covers: offered }) : [];
  const earlyRisk = filled
    .slice(0, Math.max(1, Math.floor(n / 2)))
    .map((r, i) => ({ seat: i + 1, rec: records[r.address.toLowerCase()] }))
    .filter((x) => x.rec && (x.rec.walkedAway > 0 || x.rec.leftEarly > 0 || x.rec.completed + x.rec.caughtUp === 0))
    .map((x) => ({ seat: x.seat, why: x.rec.walkedAway > 0 ? "has walked away before" : x.rec.leftEarly > 0 ? "has left a circle early" : "no PotLoop history" }));
  const label = (r) => (r.qie ? `${r.qie} (${shortAddr(r.address)})` : displayName(names, r.address) !== shortAddr(r.address) ? `${displayName(names, r.address)} (${shortAddr(r.address)})` : r.address);

  return (
    <section className="create">
      <h1>Start a circle</h1>
      <p className="sub">Members pay the same amount every round. Each round one member, in the order below, receives the whole pot.</p>

      <label className="field">
        <span>Circle name</span>
        <input value={name} maxLength={64} placeholder="Office committee" onChange={(e) => setName(e.target.value)} />
      </label>

      <fieldset className="field">
        <legend>Members, in payout order</legend>
        <p className="muted">Seat 1 gets the first pot. Paste a wallet address or a QIE ID like <code>thandi.qie</code>. Empty rows are skipped.</p>
        <ol className="member-rows">
          {rows.map((r, i) => {
            const seat = r.address ? seatOf(r) : -1;
            return (
              <li key={r.id}>
                <span className="seatcell">{seat >= 0 ? seat + 1 : "–"}</span>
                <div className="member-input">
                  <input
                    value={r.input}
                    placeholder="0x… or name.qie"
                    aria-label={`Member row ${i + 1}`}
                    onChange={(e) => patchRow(r.id, { input: e.target.value, address: undefined, error: undefined, qie: undefined })}
                    onBlur={() => resolveRow(r.id)}
                  />
                  {r.checking && <span className="small">Looking up…</span>}
                  {r.error && <span className="small warn">{r.error}</span>}
                  {r.address && r.qie && <span className="small ok">{r.qie} is {r.address}</span>}
                  {r.address && <Record record={records[r.address.toLowerCase()]} decimals={token.decimals} symbol={token.symbol} />}
                </div>
                <span className="seat-col">{seat >= 0 && c > 0n ? `${money(joinFor(seat))} to join` : ""}</span>
                <span className="row-tools">
                  <button type="button" className="icon" aria-label="Move up" onClick={() => move(i, -1)} disabled={i === 0}>↑</button>
                  <button type="button" className="icon" aria-label="Move down" onClick={() => move(i, 1)} disabled={i === rows.length - 1}>↓</button>
                  <button type="button" className="icon" aria-label="Remove" onClick={() => setRows((rs) => rs.filter((x) => x.id !== r.id))} disabled={rows.length <= 2}>×</button>
                </span>
              </li>
            );
          })}
        </ol>
        {rows.length < 12 && (
          <button type="button" className="ghost" onClick={() => setRows((rs) => [...rs, newRow()])}>Add a member</button>
        )}
      </fieldset>

      <div className="field-row">
        <label className="field">
          <span>Each member pays per round ({token.symbol})</span>
          <input inputMode="decimal" value={contrib} onChange={(e) => setContrib(e.target.value.replace(/[^0-9.]/g, ""))} />
          {rules?.canCreate && <span className="small">Minimum {money(rules.minContribution)}</span>}
        </label>
        <fieldset className="field">
          <legend>How often</legend>
          <div className="choices">
            {allowed.map((s) => (
              <button type="button" key={s.id} className={sched.id === s.id ? "choice on" : "choice"} aria-pressed={sched.id === s.id} onClick={() => setSchedule(s.id)}>
                {s.label}<span className="small">{s.hint}</span>
              </button>
            ))}
          </div>
        </fieldset>
      </div>

      <fieldset className="field">
        <legend>Collateral cover, chosen by the group</legend>
        <div className="choices">
          {COVERS.map((o) => (
            <button
              type="button"
              key={o.bps}
              className={cover === o.bps ? "choice on" : "choice"}
              aria-pressed={cover === o.bps}
              disabled={!coverAllowed(o.bps)}
              title={coverAllowed(o.bps) ? undefined : `This factory requires at least ${minCover / 100}% cover`}
              onClick={() => setCover(o.bps)}
            >
              {o.bps / 100}%{o.bps < 10000 && <span className="small">{coverAllowed(o.bps) ? "friends only" : "not allowed here"}</span>}
            </button>
          ))}
        </div>
        {minCover !== null && minCover > 0 && (
          <p className="muted">The PotLoop factory on this network only creates circles with at least {minCover / 100}% cover, so lower levels are switched off. The contract refuses them too.</p>
        )}
        <p className={cover < 10000 ? "warn" : "muted"}>{COVERS.find((o) => o.bps === cover).text}</p>
        {cover < 10000 && firstWalk && (
          <label className="check">
            <input type="checkbox" checked={riskAccepted} onChange={(e) => setRiskAccepted(e.target.checked)} />
            <span>
              The group understands that at {cover / 100}% cover, seat 1 could take the pot, stop paying and end up {money(firstWalk.gain)} better off, and the members paid after it would lose{" "}
              {money(firstWalk.othersLose)}.
            </span>
          </label>
        )}
      </fieldset>

      <fieldset className="field">
        <legend>Where the collateral comes from</legend>
        <div className="choices">
          <button type="button" className={fromPayout ? "choice on" : "choice"} aria-pressed={fromPayout} onClick={() => setFromPayout(true)}>
            Mostly from the pot<span className="small">recommended: at most one share to join</span>
          </button>
          <button type="button" className={!fromPayout ? "choice on" : "choice"} aria-pressed={!fromPayout} onClick={() => setFromPayout(false)}>
            All up front<span className="small">each seat locks its full collateral to join</span>
          </button>
        </div>
        <p className="muted">
          {fromPayout
            ? "Each member locks up to one share to join (less if its seat needs less collateral). When a member receives the pot, the rest of its collateral is held back from it and returned when the circle finishes. Once a member has been paid in full, its collateral is the same as up front. One difference: a member who leaves before its turn has less collateral locked, so there is less to help repay others if someone else also stops paying."
            : "Each seat locks all of its collateral when it joins. Early seats need much more money to start."}
        </p>
      </fieldset>

      {compare.length > 0 && (
        <section aria-label="Compare cover levels">
          <h2>How much money does seat 1 need?</h2>
          <p className="muted">Seat 1 is paid first, so it owes the most afterwards. Figures for each cover level this factory allows, with the collateral choice above. Walk-away gain is simulated with the contract's rules, assuming everyone else pays.</p>
          <table className="cover-compare">
            <thead>
              <tr><th>Cover</th><th>Money to start</th><th>Locked until the end</th><th>In hand at its turn</th><th>Not backed after its turn</th><th>Gain if it walks away</th></tr>
            </thead>
            <tbody>
              {compare.map((x) => (
                <tr key={x.coverageBps} className={x.coverageBps === cover ? "on" : ""}>
                  <td>{x.coverageBps / 100}%</td>
                  <td>{money(x.startCapital)}</td>
                  <td>{money(x.lockedAtMost)}</td>
                  <td>{money(x.inHandAtTurn)}</td>
                  <td className={x.uncovered > 0n ? "warn" : ""}>{money(x.uncovered)}</td>
                  <td className={x.walkGain > 0n ? "warn" : ""}>{money(x.walkGain)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted">The trade-off is real: the more of seat 1's remaining payments are backed, the less of the pot it can spend at its turn. Only 100% cover leaves nothing to gain by walking away.</p>
        </section>
      )}

      {n >= 2 && c > 0n && (
        <div className="summary">
          <p>
            Pot each round: <strong>{money(c * BigInt(n))}</strong>. Every member pays {money(c * BigInt(n))} in total over {n} rounds.
          </p>
          {firstWalk && (
            <p>
              {firstWalk.othersLose > 0n ? (
                <>
                  If seat 1 takes the pot and stops paying, the members paid after it lose <strong className="warn">{money(firstWalk.othersLose)}</strong>, and seat 1 ends up{" "}
                  {money(firstWalk.gain)} better off than if it had paid. Below 100% cover the circle partly runs on trust.
                </>
              ) : (
                <>
                  At {cover / 100}% cover, a member who takes the pot and stops paying is paid for by their own collateral: they gain nothing and nobody else loses. This assumes the token and
                  contract work as tested.
                </>
              )}
            </p>
          )}
          <p className="muted">
            PotLoop keeps {rules ? `${rules.feeBps / 100}%` : "a small fee"} of pot money paid out. Collateral comes back when the circle finishes, minus anything used to cover a member's own missed payments.
          </p>
          {earlyRisk.length > 0 && (
            <p className="funds">
              {joinList(earlyRisk.map((x) => `seat ${x.seat} (${x.why})`))}: consider giving the first seats to members with a PotLoop history, or keep 100% cover.
            </p>
          )}
        </div>
      )}

      {n >= 2 && c > 0n && (
        <section className="terms-table" aria-label="Member commitment breakdown">
          <h2>What each seat commits to</h2>
          <p className="muted">Exact amounts in {token.symbol} base units, using the contract's formula. The "what if" lines come from a simulator that follows the contract's rules exactly; each line assumes only the members named stop paying.</p>
          <div className="term-grid">
            {filled.map((row, i) => (
              <article key={row.id} className="term-card">
                <SeatRisk size={n} contribution={c} coverageBps={cover} feeBps={feeBps} seatIndex={i} fromPayout={fromPayout} decimals={token.decimals} symbol={token.symbol} compact />
              </article>
            ))}
          </div>
          <p className="muted">{coverageLabel(cover)}. Collateral covers missed scheduled payments under the contract rules; it does not cover token failure, contract defects, or several members failing at once beyond their collateral.</p>
          <WhatIf
            size={n}
            contribution={c}
            coverageBps={cover}
            feeBps={feeBps}
            fromPayout={fromPayout}
            decimals={token.decimals}
            symbol={token.symbol}
            names={filled.map((r) => (r.qie ? r.qie : `Seat ${filled.indexOf(r) + 1}`))}
          />
        </section>
      )}

      {reviewing && !problem && (
        <div className="review" role="region" aria-label="Review before creating">
          <h2>Check before you sign</h2>
          <p><strong>{name.trim()}</strong>: {money(c)} {sched.label.toLowerCase()}, {cover / 100}% cover, collateral {fromPayout ? "mostly held from the pot" : "all up front"}.</p>
          <ol>
            {filled.map((r, i) => (
              <li key={r.id}>
                Seat {i + 1}: {label(r)}, gets the pot in round {i + 1}, locks {money(joinFor(i))} to join
                {colFor(i) > joinFor(i) ? ` and ${money(colFor(i) - joinFor(i))} from its pot` : ""}
              </li>
            ))}
          </ol>
          {rules?.canCreate && (
            <p className="muted">
              Factory rules (read from the contract, fixed forever): fee {rules.feeBps / 100}% of pot money paid out, minimum cover {rules.minCoverageBps / 100}%, minimum {money(rules.minContribution)} per round,
              rounds at least {Math.round(rules.minRoundLength / 60)} minutes.
            </p>
          )}
          <p className="muted">This order can't be changed after the circle is created.</p>
          <div className="actions">
            <button className="primary" disabled={!!busy || !!problem || !config.factory} onClick={create}>Confirm and create</button>
            <button onClick={() => setReviewing(false)}>Edit</button>
          </div>
        </div>
      )}

      {!reviewing && (
        <div className="actions">
          {!wallet ? (
            <button className="primary" onClick={onConnect}>Connect QIE Wallet to create</button>
          ) : (
            <button className="primary" disabled={!!problem || !!busy || !config.factory} onClick={() => setReviewing(true)}>Review circle</button>
          )}
          <a className="button" href="#/">Back</a>
        </div>
      )}
      {problem && <p className="muted">{problem}</p>}
      {busy && <p className="status" role="status">{busy.label}… {busy.tx && <TxLink hash={busy.tx} />}</p>}
      {error && <p className="status error" role="status">{error}</p>}
      <p className="muted small-note">After you create it, share the invite link. Each member opens it, sees their seat and worst case, locks their collateral and accepts. The circle starts when every seat is accepted. <a href="#/risks">Risks and rules</a></p>
    </section>
  );
}
