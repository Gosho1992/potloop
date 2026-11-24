import { useEffect, useState } from "react";
import { config } from "./config";
import { loadCircles } from "./chain";
import { amount, every } from "./ui";

function status(c) {
  if (c.phase === "Open") return `${c.accepted} of ${c.size} seats taken`;
  if (c.phase === "Cancelled") return "Cancelled";
  if (c.phase === "Completed") return "Finished";
  if (c.allRoundsSettled) return "All rounds done";
  return `Round ${c.currentRound} of ${c.size}`;
}

export default function Home({ wallet, onConnect }) {
  const [data, setData] = useState(undefined);

  useEffect(() => {
    let live = true;
    const load = () =>
      loadCircles(wallet?.account)
        .then((d) => live && setData(d))
        .catch((e) => {
          console.error(e);
          live && setData(null);
        });
    load();
    const t = setInterval(load, 20000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [wallet]);

  if (!config.factory) {
    return (
      <section className="empty">
        <h1>No circles to show</h1>
        <p>This page needs the PotLoop factory address: set <code>VITE_FACTORY_ADDRESS</code>, or open a circle's invite link.</p>
      </section>
    );
  }

  const tok = data?.token;
  const money = (v) => (tok ? amount(v, tok.decimals, tok.symbol) : "");
  const invites = data?.circles.filter((c) => c.slot > 0 && c.phase === "Open" && !c.myAccepted) || [];
  const mine = data?.circles.filter((c) => c.slot > 0 && !(c.phase === "Open" && !c.myAccepted)) || [];
  const others = data?.circles.filter((c) => c.slot === 0) || [];

  return (
    <>
      <section className="intro">
        <h1>Save together. Get the pot on your turn. If someone stops paying, their collateral pays for them.</h1>
        <p className="sub">
          A non-custodial committee, stokvel or tanda on QIE. PotLoop prices each seat's collateral from the payments left after that seat receives the pot, then shows the remaining risk before anybody locks funds.
        </p>
        <div className="actions">
          <a className="button primary" href="#/new">Start a circle</a>
          <a className="button" href="#/guide">New here? See how it works</a>
          {!wallet && <button onClick={onConnect}>Connect QIE Wallet to see your circles</button>}
        </div>
      </section>

      <section className="product-thesis" aria-label="How PotLoop works">
        <article>
          <span>1</span>
          <h2>Price the promise</h2>
          <p>Earlier seats have more payments left after their payout, so they lock more collateral. Every member sees the exact commitment before joining.</p>
        </article>
        <article>
          <span>2</span>
          <h2>Settle in public</h2>
          <p>When a payment is missed, the contract follows a visible waterfall: contribution fund, the member's collateral, reserve, then tracked unpaid entitlement.</p>
        </article>
        <article>
          <span>3</span>
          <h2>Recover without favours</h2>
          <p>A member behind after payout can repay the exact arrears, current round and disclosed fee. The contract restores their status only after the full payment arrives.</p>
        </article>
      </section>

      <section className="pilot-note">
        <div>
          <p className="eyebrow">Designed for a first pilot</p>
          <h2>Small, known groups that want rules everyone can inspect.</h2>
        </div>
        <p>Start with 3–6 members, 100% cover, short commitments and test funds. PotLoop provides a wallet-level history signal, not identity verification or credit underwriting.</p>
      </section>

      {data === undefined && <p className="muted">Reading circles from QIE…</p>}
      {data === null && <p className="status error">Can't read circles right now. Check the connection, then reload.</p>}

      {wallet && data && invites.length > 0 && (
        <section className="panel">
          <h2>Invitations</h2>
          <p className="muted">Someone added you to these circles. Nothing happens unless you open one and accept your seat.</p>
          <ul className="cards">{invites.map((c) => <Card key={c.address} c={c} money={money} />)}</ul>
        </section>
      )}

      {wallet && data && (
        <section className="panel">
          <h2>Your circles</h2>
          {mine.length === 0 ? (
            <p className="muted">You're not in a circle yet. Start one, or ask an organizer for an invite link.</p>
          ) : (
            <ul className="cards">{mine.map((c) => <Card key={c.address} c={c} money={money} />)}</ul>
          )}
        </section>
      )}

      {data && (
        <section className="panel">
          <h2>All circles on PotLoop</h2>
          {others.length === 0 && mine.length === 0 ? (
            <p className="muted">No circles yet. Be the first.</p>
          ) : (
            <ul className="cards">{(wallet ? others : data.circles).map((c) => <Card key={c.address} c={c} money={money} />)}</ul>
          )}
          {data.circles.length >= 40 && (
            <p className="muted">Showing the newest 40 circles.</p>
          )}
        </section>
      )}
    </>
  );
}

function Card({ c, money }) {
  return (
    <li>
      <a className="card" href={`#/c/${c.address}`}>
        <span className="card-name">{c.name || "Unnamed circle"}</span>
        {c.test && <span className="card-test">Test circle</span>}
        <span>{c.size} members, {money(c.contribution)} per round, {c.coverageBps / 100}% cover</span>
        <span className={`card-status ${c.phase === "Open" ? "open" : ""}`}>
          {status(c)}
          {c.slot > 0 && `, your seat ${c.slot}`}
        </span>
      </a>
    </li>
  );
}
