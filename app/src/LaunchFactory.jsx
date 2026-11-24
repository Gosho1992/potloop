import { useState } from "react";
import { ContractFactory, Interface } from "ethers";
import { config, QUSDC_MAINNET } from "./config";
import { readProvider, signerFrom } from "./chain";
import { explainError } from "./ui";
import artifact from "./factoryArtifact.json";
import factoryAbi from "./factoryAbi.json";

// One-off page for the owner to deploy the production factory from their own QIE Wallet.
// The bytecode is the build whose creation code matched the demo factory's deployment
// byte for byte (the source verified on the explorer); only the constructor settings differ.
// Not linked from anywhere; removed once the factory is deployed.
const SETTINGS = [
  ["Token", "QUSDC", QUSDC_MAINNET],
  ["Fee receiver", "none: no fee, so no key can ever collect from this factory", "0x0000000000000000000000000000000000000000"],
  ["Fee", "0%", 0],
  ["Shortest round", "1 day", 86400],
  ["Shortest grace period", "6 hours", 21600],
  ["Smallest payment per round", "1 QUSDC", 1_000_000],
  ["Lowest cover", "100%", 10000],
];

export default function LaunchFactory({ wallet, onConnect }) {
  const [state, setState] = useState({});
  const deploy = async () => {
    setState({ busy: "Confirm the deployment in QIE Wallet…" });
    try {
      const signer = await signerFrom(wallet.eip);
      const f = new ContractFactory(artifact.abi, artifact.bytecode, signer);
      const c = await f.deploy(...SETTINGS.map((s) => s[2]));
      const tx = c.deploymentTransaction();
      setState({ busy: "Deploying on QIE mainnet…", tx: tx.hash });
      const rc = await tx.wait();
      const address = await c.getAddress();
      const rules = await new (await import("ethers")).Contract(address, factoryAbi, readProvider).rules();
      setState({ done: true, tx: tx.hash, address, block: rc.blockNumber, rules: rules.map(String).join(", ") });
    } catch (e) {
      console.error(e);
      setState({ error: explainError(e) });
    }
  };
  if (config.chainId !== 1990) return <section className="create"><h1>Mainnet only</h1></section>;
  return (
    <section className="create">
      <h1>Deploy the production factory</h1>
      <p className="sub">Owner only. One transaction from your QIE Wallet, about 0.008 QIE in fees. The settings below are fixed forever once deployed.</p>
      <table className="cover-compare">
        <tbody>
          {SETTINGS.map(([k, v, raw]) => (
            <tr key={k}><th>{k}</th><td>{v}</td><td className="muted"><code>{String(raw)}</code></td></tr>
          ))}
        </tbody>
      </table>
      <p className="muted">Code: CircleFactory, the same build as the verified factory {config.factory}. Creation code {artifact.bytecode.length / 2 - 1} bytes; constructor checked against the ABI {new Interface(artifact.abi).deploy.format("full")}.</p>
      {!wallet && <button className="primary" onClick={onConnect}>Connect QIE Wallet</button>}
      {wallet && !state.done && (
        <button className="primary" disabled={!!state.busy} onClick={deploy}>Deploy production factory from {wallet.account.slice(0, 6)}…{wallet.account.slice(-4)}</button>
      )}
      {state.busy && <p className="status">{state.busy} {state.tx && <a href={`${config.explorer}/tx/${state.tx}`} target="_blank" rel="noreferrer">View transaction</a>}</p>}
      {state.error && <p className="status error">{state.error}</p>}
      {state.done && (
        <div className="notice">
          <p><strong>Deployed.</strong> Factory <code id="new-factory">{state.address}</code> at block <code id="new-block">{state.block}</code>.</p>
          <p className="muted">Rules read back from the chain: {state.rules}</p>
          <p><a href={`${config.explorer}/tx/${state.tx}`} target="_blank" rel="noreferrer">View the deployment transaction</a></p>
        </div>
      )}
    </section>
  );
}
