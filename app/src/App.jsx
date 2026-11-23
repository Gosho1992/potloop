import { useCallback, useEffect, useState } from "react";
import { config } from "./config";
import { connectWallet, verifyNetwork } from "./chain";
import { resolveNames } from "./names";
import { explainError, Shell } from "./ui";
import CirclePage from "./CirclePage";
import Create from "./Create";
import Home from "./Home";
import Risks from "./Risks";

function parseRoute() {
  const h = window.location.hash.replace(/^#/, "");
  const m = h.match(/^\/c\/(0x[0-9a-fA-F]{40})/);
  if (m) return { page: "circle", address: m[1] };
  if (h.startsWith("/new")) return { page: "new" };
  if (h.startsWith("/risks")) return { page: "risks" };
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

  const onConnect = useCallback(async () => {
    setError("");
    try {
      const w = await connectWallet();
      setWallet(w);
      w.eip.on?.("accountsChanged", (accs) => setWallet(accs?.[0] ? { ...w, account: accs[0] } : null));
      // if the wallet changes network, forget the connection: every write re-checks the chain anyway
      w.eip.on?.("chainChanged", (id) => {
        if (parseInt(id, 16) !== config.chainId) {
          setWallet(null);
          setError(`Your wallet switched to another network. Switch back to QIE (chain ${config.chainId}) and connect again.`);
        }
      });
    } catch (e) {
      setError(explainError(e));
    }
  }, []);

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
      {route.page === "circle" && <CirclePage key={route.address} address={route.address} {...props} />}
      {route.page === "new" && <Create {...props} />}
      {route.page === "home" && <Home {...props} />}
      {route.page === "risks" && <Risks />}
    </Shell>
  );
}
