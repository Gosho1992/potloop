import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatUnits } from "ethers";
import { config, isMainnet, circleLink } from "./config";
import { STATUS, circleAt, loadCircle, loadHistory, signerFrom, tokenWith, readProvider } from "./chain";
import { displayName, resolveNames, shortAddr } from "./names";
import { explainError, plural, clock, every, amount, TxLink, FundsNote, Record, calendarFile, download } from "./ui";
import { factoryAt } from "./chain";
import { coverageLabel } from "./economics";
import { SeatRisk } from "./SeatRisk";
import { WhatIf } from "./WhatIf";
import Ring from "./Ring";

export default function CirclePage({ address, wallet, onConnect, names, setNames }) {
  const [circle, setCircle] = useState(null);
  const [history, setHistory] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [tab, setTab] = useState("circle");
  const [busy, setBusy] = useState(null); // { label, tx? }
  const [notice, setNotice] = useState(null); // { kind, text, tx? }
  const [skew, setSkew] = useState(0); // chain time minus local time
  const [now, setNow] = useState(Math.floor(Date.now() / 1000));
  const [copied, setCopied] = useState(false);

  const loading = useRef(false);
  const again = useRef(false);
  const refresh = useCallback(async () => {
    // never run two refreshes at once, but never drop one either: a refresh asked for while one is
    // running (for example right after a transaction) runs as soon as the current one ends
    if (loading.current) {
      again.current = true;
      return;
    }
    loading.current = true;
    again.current = false;
    try {
      const c = await loadCircle(address, wallet?.account);
      setCircle(c);
      if (c.notGenuine) return;
      setSkew(c.chainTime - Math.floor(Date.now() / 1000));
      setLoadError("");
      const extra = wallet?.account ? [wallet.account] : [];
      const resolved = await resolveNames([...c.members.map((m) => m.address), ...extra]);
      setNames((old) => ({ ...old, ...resolved }));
      setHistory(await loadHistory(address));
    } catch (e) {
      console.error(e);
      setLoadError("Can't read the circle right now. Check the network connection, then reload.");
    } finally {
      loading.current = false;
      if (again.current) setTimeout(() => refreshRef.current?.(), 0);
    }
  }, [wallet, address, setNames]);
  const refreshRef = useRef(null);
  refreshRef.current = refresh;

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 15000);
    return () => clearInterval(t);
  }, [refresh]);

  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(t);
  }, []);

  const chainNow = now + skew;
  const fmt = useCallback((v) => (circle ? amount(v, circle.token.decimals) : ""), [circle]);
  const money = (v) => `${fmt(v)} ${circle?.token.symbol ?? ""}`;
  const who = (a) => displayName(names, a);

  async function run(label, doneText, fn) {
    setNotice(null);
    setBusy({ label: `${label}: confirm in your wallet` });
    try {
      const signer = await signerFrom(wallet.eip);
      const tx = await fn(signer, (t) => setBusy({ label: `${label}: confirming on QIE`, tx: t.hash }));
      setNotice({ kind: "ok", text: doneText, tx: tx?.hash });
    } catch (e) {
      console.error(e);
      setNotice({ kind: "error", text: explainError(e) });
    } finally {
      setBusy(null);
      refresh();
    }
  }

  // ------------------------------------------------------------- actions
  const approveIfNeeded = async (signer, amount, onTx) => {
    const t = tokenWith(signer, circle.token.address);
    const allowance = await tokenWith(readProvider, circle.token.address).allowance(await signer.getAddress(), address);
    if (allowance < amount) {
      const tx = await t.approve(address, amount);
      onTx(tx);
      await tx.wait();
    }
  };

  const acceptSeat = () => {
    const amount = circle.me.member.collateralRequired;
    return run("Accept seat", `You accepted seat ${circle.me.member.slot}.`, async (signer, onTx) => {
      if (amount > 0n) await approveIfNeeded(signer, amount, onTx);
      const tx = await circleAt(address, signer).accept();
      onTx(tx);
      await tx.wait();
      return tx;
    });
  };

  const pay = () =>
    run("Pay", `You paid ${money(circle.contribution)} for round ${circle.currentRound}.`, async (signer, onTx) => {
      await approveIfNeeded(signer, circle.contribution, onTx);
      const tx = await circleAt(address, signer).contribute();
      onTx(tx);
      await tx.wait();
      return tx;
    });

  const catchUp = () => {
    const total = circle.me.member.catchUpTotal;
    return run("Catch up", "You're caught up and back in good standing.", async (signer, onTx) => {
      await approveIfNeeded(signer, total, onTx);
      const tx = await circleAt(address, signer).catchUp();
      onTx(tx);
      await tx.wait();
      return tx;
    });
  };

  const simple = (label, doneText, method) =>
    run(label, doneText, async (signer, onTx) => {
      const tx = await circleAt(address, signer)[method]();
      onTx(tx);
      await tx.wait();
      return tx;
    });

  // ------------------------------------------------------------- derived
  const view = useMemo(() => {
    if (!circle || circle.notGenuine) return null;
    const n = circle.size;
    const active = circle.phase === "Active" && !circle.allRoundsSettled;
    const closeAt = circle.deadline + circle.grace;
    // everyone still allowed to pay (members behind included) must pay before an early settle
    const goodUnpaid = circle.members.filter((m) => m.status !== STATUS.PRE && !m.paidThisRound);
    const canSettle = active && (chainNow > closeAt || goodUnpaid.length === 0);
    const recipient = active ? circle.members[circle.currentRound - 1] : null;
    const me = circle.me;
    const myMember = me?.member;
    // a member who stopped after taking the pot may resume paying
    const canPay =
      active && myMember && myMember.status !== STATUS.PRE && !myMember.paidThisRound && chainNow <= closeAt;
    const canAccept = circle.phase === "Open" && myMember && !myMember.accepted && chainNow <= circle.joinDeadline;
    const canCancel = circle.phase === "Open" && chainNow > circle.joinDeadline;
    const anyBehind = circle.members.some((m) => m.status === STATUS.POST);
    const canFinalize = circle.phase === "Active" && circle.allRoundsSettled && (!anyBehind || chainNow >= circle.finalizeAfter);
    const cureLeft = circle.allRoundsSettled && anyBehind ? Math.max(0, circle.finalizeAfter - chainNow) : 0;
    const canLeave = circle.phase === "Open" && myMember && myMember.accepted;
    const canRecord = circle.phase === "Completed" && circle.genuine && !circle.recorded;
    const canWithdraw = me && me.withdrawable > 0n;
    const canCatchUp = circle.phase === "Active" && myMember && myMember.status === STATUS.POST && myMember.catchUpTotal > 0n;
    const accepted = circle.members.filter((m) => m.accepted).length;
    const paidOutMembers = circle.members.filter((m) => m.paidOut && m.stillOwes > 0n);
    const stopped = paidOutMembers.filter((m) => m.status === STATUS.POST);
    const worst = paidOutMembers
      .filter((m) => m.status === STATUS.GOOD && m.uncovered > 0n)
      .sort((a, b) => (b.uncovered > a.uncovered ? 1 : -1))[0];
    return { n, active, closeAt, goodUnpaid, canSettle, recipient, canPay, canAccept, canCancel, canFinalize, canWithdraw, canCatchUp, canLeave, canRecord, cureLeft, accepted, paidOutMembers, stopped, worst };
  }, [circle, chainNow]);

  // ------------------------------------------------------------- render
  if (!circle) {
    return (
      <section className="empty">
        <p>{loadError || "Reading the circle from QIE…"}</p>
      </section>
    );
  }
  if (circle.notGenuine) {
    return (
      <section className="empty">
        <p className="danger" role="alert">
          {address} is not a circle created by PotLoop's official factory. Don't approve or send anything to it. If someone sent you this link, ask them for a
          link from this site's own circle list.
        </p>
        <a className="button" href="#/">See real PotLoop circles</a>
      </section>
    );
  }

  const v = view;

  const headline = (() => {
    if (circle.phase === "Open") return `${v.accepted} of ${v.n} members have accepted their seats.`;
    if (circle.phase === "Cancelled") return "This circle was cancelled before it started.";
    if (circle.phase === "Completed") return "This circle is finished.";
    if (circle.allRoundsSettled) return `All ${v.n} rounds are done.`;
    if (v.recipient.status === STATUS.PRE)
      return `Round ${circle.currentRound}: ${who(v.recipient.address)} missed a payment and lost this turn.`;
    return `Round ${circle.currentRound}: ${who(v.recipient.address)} gets the ${money(circle.contribution * BigInt(v.n))} pot.`;
  })();

  const subline = (() => {
    if (circle.phase === "Open")
      return chainNow <= circle.joinDeadline
        ? `Joining closes in ${clock(circle.joinDeadline - chainNow)}. The circle starts as soon as every seat is accepted.`
        : "Joining has closed without every seat filled. Anyone can cancel it so deposits come back.";
    if (circle.phase === "Cancelled") return "Everyone can withdraw the collateral they locked.";
    if (circle.phase === "Completed") return "Collateral and refunds are released. Anyone owed money can withdraw it.";
    if (circle.allRoundsSettled)
      return v.cureLeft > 0
        ? `Someone is behind: they have ${clock(v.cureLeft)} to catch up before the circle can be finished.`
        : "Finish the circle to release collateral and refunds.";
    if (chainNow <= circle.deadline)
      return `${plural(v.goodUnpaid.length, "member")} still to pay. Payments close in ${clock(circle.deadline - chainNow)}, plus ${clock(circle.grace)} grace.`;
    if (chainNow <= v.closeAt) return `Grace period: ${clock(v.closeAt - chainNow)} left to pay.`;
    return "Time is up. Anyone can settle this round now.";
  })();

  const r = circle.risk;
  const coveragePct = Math.round(r.coverageBps / 100);

  const copyInvite = async () => {
    try {
      await navigator.clipboard.writeText(circleLink(circle.address));
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      window.prompt("Copy this invite link", circleLink(circle.address));
    }
  };
  const me = circle.me;
  const myNeed = v.canAccept ? circle.me.member.collateralRequired : v.canCatchUp ? circle.me.member.catchUpTotal : v.canPay ? circle.contribution : 0n;
  const recordResults = () =>
    run("Record results", "Everyone's track record is updated.", async (signer, onTx) => {
      const tx = await factoryAt(signer, circle.factory).recordCircle(circle.address);
      onTx(tx);
      await tx.wait();
      return tx;
    });
  const withdrawElsewhere = () => {
    const to = window.prompt("Withdraw to which address? Use this only if your own address can't receive the token. Paste a 0x address you control.");
    if (!to) return;
    return run("Withdraw", `You withdrew ${money(circle.me.withdrawable)}.`, async (signer, onTx) => {
      const tx = await circleAt(address, signer).withdrawTo(to.trim());
      onTx(tx);
      await tx.wait();
      return tx;
    });
  };

  return (
    <>
      {!circle.genuine && (
        <p className="danger" role="alert">
          This address is not a circle created by PotLoop's official factory, or it uses a different token. Don't approve or send anything to it.
          Actions are turned off.
        </p>
      )}
      {circle.genuine && circle.testFactory && (
        <p className="notice test-note">
          <strong>Test circle.</strong> Created on PotLoop's testing factory, which allows rounds as short as one minute, so whole circles could be run on QIE mainnet in minutes. New circles use the production factory (rounds of at least one day, 100% cover).
        </p>
      )}
      <section className="hero">
        <Ring circle={circle} names={names} displayName={displayName} fmt={fmt} />
        <div className="hero-copy">
          {circle.name && <p className="circle-name">{circle.name}</p>}
          <p className="terms">
            {v.n} members pay {money(circle.contribution)} {every(circle.roundLength)}. Collateral cover {circle.coverageBps / 100}%.
          </p>
          <h1>{headline}</h1>
          <p className="sub">{subline}</p>

          <div className="risk-line">
            {r.stillOwed === 0n ? (
              <p>
                <strong>Nobody owes the group future payments yet.</strong> Risk starts once someone has taken the pot and still has rounds left to pay.
              </p>
            ) : (
              <>
                <p className="risk-big">
                  <span className="secure-num">{money(r.secured)}</span> of the {money(r.stillOwed)} still owed is secured by collateral.
                </p>
                {v.stopped.map((m) => (
                  <p key={m.address}>
                    <strong className="warn">
                      {who(m.address)} {m.paidThisRound ? "missed a payment after taking the pot and is paying again." : "is behind on payments after taking the pot."}
                    </strong>{" "}
                    Their collateral still covers {money(m.secured)} of the {money(m.stillOwes)} they owe. To be back in good standing they must pay {money(m.catchUpTotal)}.
                  </p>
                ))}
                {v.worst && (
                  <p>
                    If {who(v.worst.address)} stops paying now, the group could lose up to <strong>{money(v.worst.uncovered)}</strong>.
                  </p>
                )}
                {r.netUncovered > 0n ? (
                  <p className="muted">
                    Not covered by collateral or spare reserve: {money(r.netUncovered)} ({Number((r.netUncovered * 1000n) / r.stillOwed) / 10}% of what's still owed).
                  </p>
                ) : (
                  <p className="muted">Everything still owed is covered by collateral and the spare reserve.</p>
                )}
              </>
            )}
            {r.unpaidEntitlements > 0n && (
              <p className={r.claimShortfall > 0n ? "warn" : "muted"}>
                Already owed to members who were paid short: {money(r.unpaidEntitlements)}.
                {r.claimShortfall > 0n ? ` The reserve can't cover ${money(r.claimShortfall)} of it yet.` : " The reserve covers it."}
              </p>
            )}
          </div>

          <div className="actions" style={circle.genuine ? undefined : { display: "none" }}>
            {!wallet && <button className="primary" onClick={onConnect}>Connect QIE Wallet</button>}
            {wallet && v.canAccept && (
              <button className="primary" disabled={!!busy} onClick={acceptSeat}>
                {circle.me.member.collateralRequired > 0n
                  ? `Lock ${money(circle.me.member.collateralRequired)} and accept seat ${circle.me.member.slot}`
                  : `Accept seat ${circle.me.member.slot}`}
              </button>
            )}
            {wallet && v.canPay && (
              <button className="primary" disabled={!!busy} onClick={pay}>
                {me.member.status === STATUS.POST ? "Resume paying: " : "Pay "}
                {money(circle.contribution)} for round {circle.currentRound}
              </button>
            )}
            {wallet && v.canSettle && (
              <button disabled={!!busy} onClick={() => simple("Settle", `Round ${circle.currentRound} is settled.`, "settle")}>
                Settle round {circle.currentRound}
              </button>
            )}
            {wallet && v.canFinalize && (
              <button disabled={!!busy} onClick={() => simple("Finish", "The circle is finished. Collateral and refunds are released.", "finalize")}>
                Finish the circle
              </button>
            )}
            {wallet && v.canCancel && (
              <button disabled={!!busy} onClick={() => simple("Cancel", "The circle is cancelled. Deposits can be withdrawn.", "cancel")}>
                Cancel and return deposits
              </button>
            )}
            {wallet && v.canCatchUp && (
              <div className="catchup-action">
                <button className="primary" disabled={!!busy} onClick={catchUp}>
                  Catch up: pay {money(circle.me.member.catchUpTotal)}
                </button>
                <span className="small">Includes {money(circle.me.member.catchUpArrears)} arrears{circle.me.member.catchUpCurrentPart > 0n ? `, ${money(circle.me.member.catchUpCurrentPart)} for this unsettled round` : ""}, and {money(circle.me.member.catchUpLateFee)} late fee.</span>
              </div>
            )}
            {wallet && v.canLeave && (
              <button disabled={!!busy} onClick={() => simple("Leave", "You left before the start. Your collateral can be withdrawn.", "leave")}>
                Leave before it starts
              </button>
            )}
            {wallet && v.canRecord && (
              <button disabled={!!busy} onClick={recordResults}>Record results to track records</button>
            )}
            {wallet && v.canWithdraw && (
              <>
                <button className="primary" disabled={!!busy} onClick={() => simple("Withdraw", `You withdrew ${money(circle.me.withdrawable)}.`, "withdraw")}>
                  Withdraw {money(circle.me.withdrawable)}
                </button>
                <button className="ghost" disabled={!!busy} onClick={withdrawElsewhere}>Withdraw to another address</button>
              </>
            )}
            {circle.phase === "Open" && (
              <button className="ghost" onClick={copyInvite}>{copied ? "Invite link copied" : "Copy invite link"}</button>
            )}
          </div>
          {wallet && v.canAccept && (
            <p className="muted join-note">
              Before you join: seat {me.member.slot}, you lock {money(me.member.collateralRequired)} now
              {me.member.collateralTarget > me.member.collateralRequired ? ` and ${money(me.member.collateralTarget - me.member.collateralRequired)} is held back from your pot` : ""}. Open <strong>Your seat</strong> to see what you commit to and what happens if anyone stops
              paying. Contract {shortAddr(circle.address)}, token {shortAddr(circle.token.address)}. <a href="#/risks">Risks</a>
            </p>
          )}
          {wallet && me && myNeed > 0n && (
            <FundsNote need={myNeed} have={me.balance} symbol={circle.token.symbol} decimals={circle.token.decimals} />
          )}
          {busy && (
            <p className="status" role="status">
              {busy.label}… {busy.tx && <TxLink hash={busy.tx} />}
            </p>
          )}
          {notice && (
            <p className={`status ${notice.kind}`} role="status">
              {notice.text} {notice.tx && <TxLink hash={notice.tx} />}
            </p>
          )}
        </div>
      </section>

      <nav className="tabs" role="tablist">
        {[
          ["circle", "Members"],
          ["seat", "Your seat"],
          ["risk", "Risk and history"],
        ].map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? "on" : ""} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </nav>

      {tab === "circle" && <Members circle={circle} who={who} names={names} money={money} />}
      {tab === "seat" && <Seat circle={circle} wallet={wallet} who={who} money={money} onConnect={onConnect} v={v} acceptSeat={acceptSeat} busy={busy} />}
      {tab === "risk" && <RiskAndHistory circle={circle} history={history} who={who} money={money} v={v} />}

      <footer>
        <p>
          Circle contract <a href={`${config.explorer}/address/${circle.address}`} target="_blank" rel="noreferrer">{shortAddr(circle.address)}</a> on{" "}
          {isMainnet ? "QIE mainnet" : `chain ${config.chainId}`}. Rules are fixed in the contract: nobody, including the organizer, can change them or move the money.
          {circle.feeBps > 0 && ` PotLoop keeps ${circle.feeBps / 100}% of each pot paid out.`} Nobody guarantees payouts beyond the
          collateral and reserve shown here, and collateral does not protect against a problem with the token or the contract. Unaudited; use small amounts.
        </p>
      </footer>
    </>
  );
}

function memberState(circle, m) {
  if (m.status === STATUS.PRE) return ["missed", "Left before their turn"];
  if (m.status === STATUS.POST)
    return m.paidThisRound ? ["late", `Paying again, ${plural(m.missedRounds, "missed round")} to catch up`] : ["ran", "Behind: collateral is paying"];
  if (circle.phase === "Open") return m.accepted ? ["ready", "Accepted"] : ["empty", "Not accepted yet"];
  const caughtUp = m.missedRounds > 0 ? ` (caught up after ${plural(m.missedRounds, "missed round")})` : "";
  if (circle.phase !== "Active" || circle.allRoundsSettled) return ["done", `Paid every round${caughtUp}`];
  if (m.paidThisRound) return ["paid", `Paid round ${circle.currentRound}${caughtUp}`];
  return ["due", `Not paid yet${caughtUp}`];
}

function Members({ circle, who, money }) {
  return (
    <section className="panel">
      <table className="members">
        <thead>
          <tr>
            <th scope="col">Seat</th>
            <th scope="col">Member</th>
            <th scope="col">Gets the pot</th>
            <th scope="col">Collateral</th>
            <th scope="col">This round</th>
            <th scope="col">Track record</th>
          </tr>
        </thead>
        <tbody>
          {circle.members.map((m) => {
            const [cls, text] = memberState(circle, m);
            return (
              <tr key={m.address}>
                <td className="seatcell">{m.slot}</td>
                <td>
                  <a href={`${config.explorer}/address/${m.address}`} target="_blank" rel="noreferrer">{who(m.address)}</a>
                </td>
                <td>
                  {m.paidOut ? "Received" : m.status === STATUS.PRE ? "Lost their turn" : `Round ${m.slot}`}
                  {m.unpaidEntitlement > 0n && <span className="small warn"> {money(m.unpaidEntitlement)} still owed to them</span>}
                  {m.recordedLoss > 0n && <span className="small warn"> lost {money(m.recordedLoss)}</span>}
                </td>
                <td>
                  {m.accepted ? money(m.collateral) : money(m.collateralRequired)}
                  {m.accepted && m.collateral < m.collateralTarget && m.collateralUsed === 0n && (
                    <span className="small"> of {money(m.collateralTarget)}{m.paidOut ? "" : ", the rest held from their pot"}</span>
                  )}
                  {m.collateralUsed > 0n && <span className="small"> {money(m.collateralUsed)} used</span>}
                </td>
                <td><span className={`chip chip-${cls}`}>{text}</span></td>
                <td><Record record={m.record} decimals={circle.token.decimals} symbol={circle.token.symbol} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

function Seat({ circle, wallet, who, money, onConnect, v, acceptSeat, busy }) {
  if (!wallet) {
    return (
      <section className="panel narrow">
        <p>Connect QIE Wallet to see your seat, what you will pay, and when you receive the pot.</p>
        <button className="primary" onClick={onConnect}>Connect QIE Wallet</button>
      </section>
    );
  }
  const m = circle.me?.member;
  if (!m) {
    return (
      <section className="panel narrow">
        <p>{who(wallet.account)} isn't one of this circle's {circle.size} members. You can still follow every payment here.</p>
      </section>
    );
  }
  return (
    <section className="panel narrow seat-panel">
      <h2>Seat {m.slot}: you receive the pot in round {m.slot}</h2>
      <SeatRisk
        size={circle.size}
        contribution={circle.contribution}
        coverageBps={circle.coverageBps}
        feeBps={circle.feeBps}
        seatIndex={m.index}
        contractTerms={m.contractTerms}
        fromPayout={circle.fromPayout}
        decimals={circle.token.decimals}
        symbol={circle.token.symbol}
      />
      <p className="muted">{coverageLabel(circle.coverageBps)}. Collateral: {circle.fromPayout ? "up to one share to join, the rest held back from each member's own pot" : "all locked when joining"}.</p>
      <h3>If you miss a payment</h3>
      <ul>
        <li>Inside the grace period: nothing happens, you are just late.</li>
        <li>Before your turn: you leave the circle and lose your turn. Up to one round's payment ({money(circle.contribution)}), taken from what you paid in and your collateral, goes to the members who stayed. The rest comes back at the end, after honest members are paid.</li>
        <li>After your turn: your collateral pays your share for each round you miss. You can pay again at any time, and you can catch up in full (refill your collateral and pay anything it could not cover) to be back in good standing.</li>
        <li>Every missed round stays in your PotLoop track record, even after you catch up.</li>
      </ul>
      {circle.phase === "Active" && !circle.allRoundsSettled && (
        <button onClick={() => downloadCalendar(circle, m)}>Add payment dates to my calendar</button>
      )}
      <p className="muted">
        If you leave before your turn and other members also stop paying, your refund comes last and can be less than what you paid in. <a href="#/risks">All risks</a>
      </p>
      {v.canAccept && (
        <p className="notice">
          <strong>Before you lock money:</strong> the contracts are tested but not yet independently audited, and QUSDC's administrator can burn tokens from any address, a circle's included. Cover protects you from members who stop paying, not from that. Lock only what you can afford to have tied up. <a href="#/risks">Risks and rules</a>
        </p>
      )}
      {v.canAccept && (
        <button className="primary" disabled={!!busy} onClick={acceptSeat}>
          {m.collateralRequired > 0n ? `Lock ${money(m.collateralRequired)} and accept seat ${m.slot}` : `Accept seat ${m.slot}`}
        </button>
      )}
      {m.accepted && <p className="muted">You accepted this seat.</p>}
    </section>
  );
}

function downloadCalendar(circle, m) {
  const rounds = [];
  for (let r = circle.currentRound; r <= circle.size; r++) rounds.push({ round: r, due: circle.deadline + (r - circle.currentRound) * circle.roundLength });
  const contribution = Number(formatUnits(circle.contribution, circle.token.decimals));
  const blob = calendarFile({ name: circle.name || "PotLoop circle", rounds, contribution, symbol: circle.token.symbol, link: circleLink(circle.address) });
  download(blob, `potloop-seat-${m.slot}.ics`);
}

function downloadStatement(circle, history, who, money) {
  const esc = (x) => `"${String(x).replace(/"/g, '""')}"`;
  const rows = [["time", "event", "details", "transaction"]];
  for (const e of [...history].reverse()) {
    rows.push([e.time ? new Date(e.time * 1000).toISOString() : "", e.name, eventText(e, who, money, circle), e.tx]);
  }
  download(new Blob([rows.map((r) => r.map(esc).join(",")).join("\n")], { type: "text/csv" }), `potloop-${circle.address.slice(0, 8)}-statement.csv`);
}

function eventText(e, who, money, circle) {
  const a = e.args;
  switch (e.name) {
    case "Accepted": return `${who(a.member)} accepted seat ${a.slot} and locked ${money(a.collateral)}.`;
    case "Activated": return "Every seat was accepted. Round 1 started.";
    case "Contributed": {
      const ps = (e.payers || [a.member]).slice().reverse().map(who);
      return `${joinNames(ps)} paid ${money(a.amount)}${ps.length > 1 ? " each" : ""} for round ${a.round}.`;
    }
    case "Defaulted": return a.afterPayout
      ? `${who(a.member)} missed round ${a.round} after taking the pot.`
      : `${who(a.member)} missed round ${a.round} before their turn and lost it.`;
    case "CollateralToReserve": return `${who(a.member)}'s collateral (${money(a.amount)}) moved to the group reserve.`;
    case "CollateralHeldFromPot": return `${money(a.amount)} of ${who(a.member)}'s pot was held back as their collateral; it comes back when the circle finishes.`;
    case "CollateralCovered": return `${who(a.member)}'s collateral paid ${money(a.amount)} of their round ${a.round} share.`;
    case "PotCredited": {
      let t = `${who(a.recipient)} was paid the round ${a.round} pot: ${money(a.fromFund + a.fromReserve)} before the fee${circle.fromPayout ? " and any collateral held back" : ""}`;
      if (a.fromReserve > 0n) t += `, ${money(a.fromReserve)} of it from the reserve`;
      t += ".";
      if (a.unpaid > 0n) t += ` ${money(a.unpaid)} is still owed to them.`;
      return t;
    }
    case "PayoutCancelled": return `Round ${a.round} had no eligible recipient. ${money(a.toReserve)} went to the reserve.`;
    case "EntitlementRepaid": return `The reserve paid ${who(a.recipient)} ${money(a.amount)} they were still owed (before the fee${circle.fromPayout ? " and any collateral held back" : ""}).`;
    case "RoundSettled": return `Round ${a.round} settled. Reserve now ${money(a.freeReserveAfter)}.`;
    case "LossRecorded": return `${money(a.amount)} could not be recovered for ${who(a.recipient)}.`;
    case "RefundCredited": return `${who(a.defaulter)} gets back ${money(a.amount)} of their ${money(a.claim)}.`;
    case "CollateralReturned": return `${who(a.member)} got back ${money(a.amount)} of collateral.`;
    case "Finalized": return "The circle finished. Collateral and refunds were released.";
    case "Cancelled": return "The circle was cancelled. Deposits were released.";
    case "Withdrawn": return `${who(a.account)} withdrew ${money(a.amount)}.`;
    case "FeeCharged": return `PotLoop fee for round ${a.round}: ${money(a.amount)}.`;
    case "PenaltyApplied": return `${who(a.member)} left before their turn and gave up ${money(a.amount)} to the members who stayed.`;
    case "EntitlementNetted": return `${money(a.netted)} still owed to ${who(a.member)} was set against what they owe the group.`;
    case "SurplusSwept": return `${money(a.amount)} sent straight to the contract was added to the group's money.`;
    case "CaughtUp": return `${who(a.member)} caught up in full: refilled ${money(a.restoredCollateral)} of collateral${a.arrearsPaid > 0n ? ` and paid ${money(a.arrearsPaid)} the group was missing` : ""}.`;
    default: return e.name;
  }
}

// one line per round for payments instead of one per member
function groupPayments(history) {
  const out = [];
  for (const e of history) {
    const last = out[out.length - 1];
    if (e.name === "Contributed" && last?.name === "Contributed" && last.args.round === e.args.round) {
      last.payers.push(e.args.member);
      continue;
    }
    out.push(e.name === "Contributed" ? { ...e, payers: [e.args.member] } : e);
  }
  return out;
}

const joinNames = (list) =>
  list.length <= 1 ? list.join("") : `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`;

function RiskAndHistory({ circle, history, who, money, v }) {
  const r = circle.risk;
  const losses = circle.members.reduce((s, m) => s + m.recordedLoss, 0n);
  return (
    <section className="panel two">
      <div>
        <h2>Who could cost the group money</h2>
        {v.paidOutMembers.length === 0 ? (
          <p className="muted">Nobody yet. Only a member who has taken the pot and still owes rounds can cause a loss.</p>
        ) : (
          <ul className="exposure">
            {v.paidOutMembers.map((m) => (
              <li key={m.address}>
                <span>{who(m.address)}{m.status === STATUS.POST && <span className="warn"> has stopped paying</span>}</span>
                <span>
                  owes {money(m.stillOwes)}, collateral covers {money(m.secured)}
                  {m.uncovered === 0n ? (
                    <strong className="ok">, fully covered</strong>
                  ) : m.status === STATUS.POST ? (
                    <strong className="warn">, {money(m.uncovered)} will be lost unless the reserve covers it</strong>
                  ) : (
                    <strong className="warn">, could cost {money(m.uncovered)}</strong>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
        <h2>Group money</h2>
        <dl className="ledger">
          <div><dt>Still owed by members who took the pot</dt><dd>{money(r.stillOwed)}</dd></div>
          <div><dt>Secured by their collateral</dt><dd>{money(r.secured)}</dd></div>
          <div><dt>Group reserve</dt><dd>{money(r.freeReserve)}</dd></div>
          <div><dt>Already owed to members who were paid short</dt><dd>{money(r.unpaidEntitlements)}</dd></div>
          <div><dt>Recorded losses</dt><dd>{money(losses)}</dd></div>
        </dl>
        <WhatIf
          size={circle.size}
          contribution={circle.contribution}
          coverageBps={circle.coverageBps}
          feeBps={circle.feeBps}
          fromPayout={circle.fromPayout}
          decimals={circle.token.decimals}
          symbol={circle.token.symbol}
          names={circle.members.map((m) => who(m.address))}
        />
      </div>
      <div>
        <h2>What happened</h2>
        {history?.length > 0 && (
          <p><button className="ghost" onClick={() => downloadStatement(circle, history, who, money)}>Download statement (CSV)</button></p>
        )}
        {history === null ? (
          <p className="muted">History is unavailable from this network right now. Every payment is still on the explorer.</p>
        ) : history.length === 0 ? (
          <p className="muted">Nothing yet.</p>
        ) : (
          <ol className="history">
            {groupPayments(history).map((e) => (
              <li key={`${e.tx}-${e.idx}`} className={`ev ev-${e.name}`}>
                <span>{eventText(e, who, money, circle)}</span>
                <a href={`${config.explorer}/tx/${e.tx}`} target="_blank" rel="noreferrer">
                  {e.time ? new Date(e.time * 1000).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "transaction"}
                </a>
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}
