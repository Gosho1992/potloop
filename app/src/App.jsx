import { useCallback, useEffect, useState } from "react";
import { config } from "./config";
import { connectWallet, reconnectWallet, verifyNetwork } from "./chain";
import { resolveNames } from "./names";
import { explainError, Shell } from "./ui";
import { lazy, Suspense } from "react";
import Home from "./Home";

// pages other than the home page load when first opened
const CirclePage = lazy(() => import("./CirclePage"));
const Create = lazy(() => import("./Create"));
const Risks = lazy(() => import("./Risks"));
const Guide = lazy(() => import("./Guide"));
const LaunchFactory = lazy(() => import("./LaunchFactory"));

function parseRoute() {
  const h = window.location.hash.replace(/^#/, "");
  const m = h.match(/^\/c\/(0x[0-9a-fA-F]{40})/);
  if (m) return { page: "circle", address: m[1] };
  if (h.startsWith("/new")) return { page: "new" };
  if (h.startsWith("/risks")) return { page: "risks" };
  if (h.startsWith("/guide")) return { page: "guide" };
  if (h.startsWith("/launch-factory")) return { page: "launch" };
  if (config.circle && !config.factory) return { page: "circle", address: config.circle };
  return { page: "home" };
}

export default function App() {
  const [route, setRoute] = useState(parseRoute);
  const [wallet, setWallet] = useState(null);
  const [names, setNames] = useState({});
  const [error, setError] = useState("");
  const [netOk, setNetOk] = useState(true);

  useEffect(() => {
    verifyNetwork().then(setNetOk);
  }, []);

  useEffect(() => {
    const on = () => {
      setRoute(parseRoute());
      window.scrollTo(0, 0);
    };
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);

  useEffect(() => {
    if (wallet?.account) resolveNames([wallet.account]).then((n) => setNames((o) => ({ ...o, ...n })));
  }, [wallet]);

  const attach = useCallback((w) => {
    setWallet(w);
    w.eip.on?.("accountsChanged", (accs) => setWallet(accs?.[0] ? { ...w, account: accs[0] } : null));
    // if the wallet changes network, forget the connection: every write re-checks the chain anyway
    w.eip.on?.("chainChanged", (id) => {
      if (parseInt(id, 16) !== config.chainId) {
        setWallet(null);
        setError(`Your wallet switched to another network. Switch back to QIE (chain ${config.chainId}) and connect again.`);
      }
    });
  }, []);

  // a wallet that already allowed this site reconnects on reload, without a prompt
  useEffect(() => {
    const t = setTimeout(() => {
      reconnectWallet()
        .then((w) => {
          if (w) attach(w);
        })
        .catch(() => {});
    }, 300);
    return () => clearTimeout(t);
  }, [attach]);

  const onConnect = useCallback(async () => {
    setError("");
    try {
      attach(await connectWallet());
    } catch (e) {
      setError(explainError(e));
    }
  }, [attach]);

  const props = { wallet, onConnect, names, setNames };
  return (
    <Shell wallet={wallet} names={names} onConnect={onConnect}>
      {netOk === null && (
        <p className="danger" role="alert">
          Can't reach the QIE network right now. What you see may be out of date: don't sign anything until the page loads normally. Check your connection and reload.
        </p>
      )}
      {netOk === false && (
        <p className="danger" role="alert">
          The network this page reads from is not QIE chain {config.chainId}. Don't sign anything until this is fixed.
        </p>
      )}
      {error && <p className="status error" role="status">{error}</p>}
      <Suspense fallback={<p className="muted">Loading…</p>}>
      {route.page === "circle" && <CirclePage key={route.address} address={route.address} {...props} />}
      {route.page === "new" && <Create {...props} />}
      {route.page === "home" && <Home {...props} />}
      {route.page === "risks" && <Risks />}
      {route.page === "guide" && <Guide />}
      {route.page === "launch" && <LaunchFactory {...props} />}
      </Suspense>
    </Shell>
  );
}
