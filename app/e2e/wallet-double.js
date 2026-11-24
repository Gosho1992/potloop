// A scripted EIP-1193 wallet for the UI acceptance suite. Injected into the page before the app
// loads. It announces itself through EIP-6963 as QIE Wallet (rdns me.qiewallet), exactly the
// discovery path the app uses for the real QIE Wallet, and forwards signing to the local Hardhat
// node's unlocked test accounts. It is NOT QIE Wallet: the real extension is covered by the manual
// checklist in POTLOOP_UAT_PLAN.md.
//
// The test controls it through window.__wallet:
//   account, chainId (hex), connected
//   rejectConnect / rejectNextTx (count) / refuseSwitch   simulate the user pressing "Reject"
//   sent[]                                                 every transaction request the app made
//   emit(event, value)                                     accountsChanged / chainChanged / disconnect
// eslint-disable-next-line no-unused-vars
function installWalletDouble(cfg) {
  const listeners = {};
  const rejection = (message) => Object.assign(new Error(message), { code: 4001 });
  const w = (window.__wallet = {
    account: cfg.account,
    chainId: cfg.chainId,
    localChainId: cfg.chainId,
    connected: !!cfg.connected, // true: the site was already allowed earlier (eth_accounts answers)
    rejectConnect: false,
    rejectNextTx: 0,
    refuseSwitch: false,
    sent: [],
    requests: [],
    emit(ev, value) { (listeners[ev] || []).forEach((fn) => fn(value)); },
  });
  async function rpc(method, params) {
    const res = await fetch(cfg.rpc, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params: params || [] }) });
    const j = await res.json();
    if (j.error) throw Object.assign(new Error(j.error.message), { code: j.error.code, data: j.error.data });
    return j.result;
  }
  const provider = {
    isQIEWallet: true,
    async request({ method, params }) {
      w.requests.push(method);
      switch (method) {
        case "eth_requestAccounts":
          if (w.rejectConnect) throw rejection("User rejected the request.");
          w.connected = true;
          return [w.account];
        case "eth_accounts":
          return w.connected ? [w.account] : [];
        case "eth_chainId":
          return w.chainId;
        case "net_version":
          return String(parseInt(w.chainId, 16));
        case "wallet_switchEthereumChain":
          if (w.refuseSwitch) throw rejection("User rejected the network switch.");
          if (params[0].chainId.toLowerCase() !== w.localChainId.toLowerCase()) throw Object.assign(new Error("Unrecognized chain"), { code: 4902 });
          w.chainId = params[0].chainId;
          setTimeout(() => w.emit("chainChanged", w.chainId), 0);
          return null;
        case "wallet_addEthereumChain":
          w.chainId = params[0].chainId;
          return null;
        case "eth_sendTransaction": {
          if (w.chainId.toLowerCase() !== w.localChainId.toLowerCase()) throw new Error("wallet is on another network");
          if (w.rejectNextTx > 0) { w.rejectNextTx--; throw rejection("User rejected the transaction."); }
          const tx = { ...params[0], from: w.account };
          w.sent.push(tx);
          return rpc("eth_sendTransaction", [tx]);
        }
        default:
          return rpc(method, params);
      }
    },
    on(ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); },
    removeListener(ev, fn) { listeners[ev] = (listeners[ev] || []).filter((x) => x !== fn); },
  };
  const announce = () => window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: Object.freeze({ info: { uuid: "e2e-wallet", name: "QIE Wallet (test double)", icon: "data:,", rdns: "me.qiewallet" }, provider }) }));
  window.addEventListener("eip6963:requestProvider", announce);
  announce();
}
