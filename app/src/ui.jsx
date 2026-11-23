import { Interface, formatUnits } from "ethers";
import abi from "./circleAbi.json";
import factoryAbi from "./factoryAbi.json";
import { config, isMainnet } from "./config";
import { displayName } from "./names";

const ifaces = [new Interface(abi), new Interface(factoryAbi)];

const ERROR_TEXT = {
  NotMember: "This wallet is not a member of this circle.",
  WrongPhase: "That isn't possible at this stage of the circle.",
  AlreadyAccepted: "You already accepted your seat.",
  JoinWindowOpen: "Joining is still open, so the circle can't be cancelled yet.",
  JoinWindowClosed: "Joining has closed.",
  NotAllAccepted: "Not every member has accepted yet.",
  AlreadyContributed: "You already paid for this round.",
  MemberDefaulted: "This seat left the circle before its turn, so it can't pay any more.",
  ContributionWindowClosed: "Payments for this round have closed.",
  TooEarlyToSettle: "This round can be settled once everyone has paid or the time is up.",
  RoundsNotDone: "Not every round is settled yet.",
  NothingToWithdraw: "There is nothing for this wallet to withdraw.",
  TransferAmountMismatch: "The token transfer arrived short, so it was refused.",
  BadConfig: "Check the circle details: 2 to 12 different members, a name without line breaks, an amount at or above the minimum, an allowed schedule.",
  CureWindowOpen: "Someone is behind and still has time to catch up. The circle can be finished once that time is over.",
  NotBehind: "You're not behind, so there is nothing to catch up.",
  NotAccepted: "You haven't accepted this seat.",
  BadRecipient: "That address can't receive the withdrawal.",
  NotFinished: "The circle isn't finished yet.",
  AlreadyRecorded: "These results are already in everyone's track record.",
  NotACircle: "That isn't a PotLoop circle.",
};

export function explainError(e) {
  if (e?.code === "ACTION_REJECTED" || e?.code === 4001) return "You cancelled it in your wallet.";
  const data = e?.data || e?.info?.error?.data || e?.error?.data;
  for (const iface of ifaces) {
    try {
      const parsed = data && iface.parseError(data);
      if (parsed && ERROR_TEXT[parsed.name]) return ERROR_TEXT[parsed.name];
    } catch {}
  }
  const name = Object.keys(ERROR_TEXT).find((k) => String(e?.message || "").includes(k));
  if (name) return ERROR_TEXT[name];
  if (String(e?.message || "").includes("insufficient")) return "Not enough balance in this wallet (QUSDC, or QIE for gas).";
  return e?.shortMessage || e?.message || "Something went wrong.";
}

export const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;

export function clock(sec) {
  if (sec <= 0) return "0:00";
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (d > 0) return `${plural(d, "day")}${h ? ` ${plural(h, "hour")}` : ""}`;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function every(sec) {
  if (sec % 86400 === 0) return sec === 86400 ? "every day" : sec === 604800 ? "every week" : `every ${sec / 86400} days`;
  if (sec % 3600 === 0) return `every ${plural(sec / 3600, "hour")}`;
  if (sec % 60 === 0) return `every ${plural(sec / 60, "minute")}`;
  return `every ${sec} seconds`;
}

/** Exact token amount as a string (no floating point), thousands separated, trailing zeros trimmed. */
export function amount(v, decimals, symbol) {
  let [whole, frac = ""] = formatUnits(v ?? 0n, decimals).split(".");
  frac = frac.replace(/0+$/, "");
  whole = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${whole}${frac ? `.${frac}` : ""}${symbol ? ` ${symbol}` : ""}`;
}

export function Shell({ wallet, names, onConnect, children }) {
  return (
    <div className="page">
      <header className="top">
        <a className="brand" href="#/">{config.appName}</a>
        <span className="tagline">Your circle. Your turn. Your money.</span>
        <span className="net">{isMainnet ? "QIE mainnet" : `Chain ${config.chainId}`}</span>
        {wallet ? (
          <span className="who">{displayName(names, wallet.account)}</span>
        ) : (
          <button className="ghost" onClick={onConnect}>Connect wallet</button>
        )}
      </header>
      <main>{children}</main>
    </div>
  );
}

export function TxLink({ hash }) {
  return (
    <a href={`${config.explorer}/tx/${hash}`} target="_blank" rel="noreferrer">
      View transaction
    </a>
  );
}

/** Small "you need QUSDC" note with a QIEDEX link, shown when a wallet can't cover an action. */
export function FundsNote({ need, have, symbol, decimals }) {
  if (have >= need) return null;
  return (
    <p className="funds">
      You have {amount(have, decimals, symbol)} and need {amount(need, decimals, symbol)}.{" "}
      <a href={config.dexUrl} target="_blank" rel="noreferrer">Swap QIE for {symbol} on QIEDEX</a>, then come back. Keep a little QIE for fees.
    </p>
  );
}

export function Record({ record, decimals = 6, symbol = "" }) {
  if (!record) return null;
  const { completed, caughtUp = 0, leftEarly = 0, walkedAway = 0, volume = 0n } = record;
  const title = "On-chain history of this address on PotLoop. Not identity verification or a credit check: one person can have many addresses.";
  if (completed + caughtUp + leftEarly + walkedAway === 0) return <span className="record new" title={title}>No PotLoop history</span>;
  const parts = [`${plural(completed + caughtUp, "circle")} finished`];
  if (volume > 0n) parts[0] += ` (${amount(volume, decimals, symbol)} in pots)`;
  if (caughtUp) parts.push(`${caughtUp} after catching up`);
  if (leftEarly) parts.push(`left ${plural(leftEarly, "circle")} early`);
  if (walkedAway) parts.push(`walked away ${walkedAway === 1 ? "once" : `${walkedAway} times`} after taking the pot`);
  const cls = walkedAway ? "bad" : leftEarly || caughtUp ? "mid" : "good";
  return <span className={`record ${cls}`} title={title}>{parts.join(", ")}</span>;
}

/** Calendar file with an estimated due date for each remaining round. */
/** RFC 5545 text: escape backslash, semicolon, comma; strip control characters and newlines. */
function icsText(v) {
  return String(v)
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,");
}

/** Fold lines longer than 75 octets (RFC 5545 3.1). */
function icsFold(line) {
  const out = [];
  let rest = line;
  while (new TextEncoder().encode(rest).length > 75) {
    let cut = 74;
    while (new TextEncoder().encode(rest.slice(0, cut)).length > 74) cut--;
    out.push(rest.slice(0, cut));
    rest = " " + rest.slice(cut);
  }
  out.push(rest);
  return out.join("\r\n");
}

export function calendarFile({ name, rounds, contribution, symbol, link }) {
  const stamp = (t) => new Date(t * 1000).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//PotLoop//EN"];
  for (const r of rounds) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:potloop-${r.round}-${r.due}@potloop`,
      `DTSTAMP:${stamp(Math.floor(Date.now() / 1000))}`,
      `DTSTART:${stamp(r.due - 3600)}`,
      `DTEND:${stamp(r.due)}`,
      `SUMMARY:${icsText(`${name}: pay ${contribution} ${symbol} for round ${r.round}`)}`,
      `DESCRIPTION:${icsText(`Pay before this time (grace period after it). Pay here: ${link}`)}`,
      "BEGIN:VALARM", "TRIGGER:-PT12H", "ACTION:DISPLAY", "DESCRIPTION:PotLoop payment due", "END:VALARM",
      "END:VEVENT"
    );
  }
  lines.push("END:VCALENDAR");
  return new Blob([lines.map(icsFold).join("\r\n")], { type: "text/calendar" });
}

export function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
