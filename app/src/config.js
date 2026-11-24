// Settings come from the URL first (handy for demos), then from build-time env (.env file).
// URL example: ?factory=0x...&rpc=https://rpc1mainnet.qie.digital&chain=1990&from=123456#/c/0xCircle
const env = import.meta.env;
// Production builds ignore URL settings: an invite link can only choose which circle to open,
// never which network, RPC, factory or explorer the app trusts. Local demos may opt in.
export const urlConfigAllowed = env.DEV || env.VITE_ALLOW_URL_CONFIG === "1";
const q = new URLSearchParams(urlConfigAllowed ? window.location.search : "");

const pick = (key, envKey, fallback) => q.get(key) || env[envKey] || fallback;

export const QUSDC_MAINNET = "0x3F43DA82eC9A4f5285F10FaF1F26EcA7319E5DA5";

export const config = {
  appName: pick("name", "VITE_APP_NAME", "PotLoop"),
  factory: pick("factory", "VITE_FACTORY_ADDRESS", ""),
  circle: pick("circle", "VITE_CIRCLE_ADDRESS", ""), // legacy: a single circle without the factory
  rpc: pick("rpc", "VITE_RPC_URL", "https://rpc1mainnet.qie.digital"),
  chainId: Number(pick("chain", "VITE_CHAIN_ID", "1990")),
  explorer: pick("explorer", "VITE_EXPLORER", "https://mainnet.qie.digital"),
  fromBlock: Number(pick("from", "VITE_FROM_BLOCK", "0")),
  // earlier factories whose circles still open here, marked as test circles: "0xAddr@block,..."
  earlierFactories: (env.VITE_EARLIER_FACTORIES || "")
    .split(",")
    .map((s) => s.trim().split("@"))
    .filter(([a]) => /^0x[0-9a-fA-F]{40}$/.test(a || ""))
    .map(([address, block]) => ({ address, fromBlock: Number(block || 0) })),
  dexUrl: pick("dex", "VITE_DEX_URL", "https://www.dex.qie.digital/#/swap"),
  // optional display names for addresses without a .qie name, e.g. labels=0xabc:Thandi,0xdef:Sipho
  labels: Object.fromEntries(
    (pick("labels", "VITE_LABELS", "") || "")
      .split(",")
      .map((s) => s.split(":").map((x) => x.trim()))
      .filter((p) => p.length === 2 && p[0] && p[1])
      .map(([a, n]) => [a.toLowerCase(), n])
  ),
};

export const isMainnet = config.chainId === 1990;

/** Every factory the app trusts: the current one first (new circles), then earlier ones. */
export const factories = [
  ...(config.factory ? [{ address: config.factory, fromBlock: config.fromBlock || 0, current: true }] : []),
  ...config.earlierFactories
    .filter((f) => f.address.toLowerCase() !== (config.factory || "").toLowerCase())
    .map((f) => ({ ...f, current: false })),
];

export const chainParams = {
  chainId: "0x" + config.chainId.toString(16),
  chainName: config.chainId === 1990 ? "QIE Blockchain Mainnet" : config.chainId === 1983 ? "QIE Testnet" : "Local test chain",
  nativeCurrency: { name: "QIE", symbol: "QIE", decimals: 18 },
  rpcUrls: [config.rpc],
  blockExplorerUrls: config.explorer ? [config.explorer] : [],
};

/** Shareable link to a circle (keeps demo settings in the query string). */
export function circleLink(address) {
  const { origin, pathname, search } = window.location;
  return `${origin}${pathname}${urlConfigAllowed ? search : ""}#/c/${address}`;
}
