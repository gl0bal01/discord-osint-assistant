// ---------------------------------------------------------------------------
// Etherscan Tx Graph Explorer
// Static client-side app: fetches transactions from the Etherscan API (v2,
// unified multichain endpoint) and renders a directed graph of address ->
// address flows, expanded recursively up to a user-chosen depth.
// ---------------------------------------------------------------------------

const API_BASE = "https://api.etherscan.io/v2/api";

const CHAINS = [
  { id: 1, name: "Ethereum", explorer: "etherscan.io" },
  { id: 11155111, name: "Sepolia (testnet)", explorer: "sepolia.etherscan.io" },
  { id: 56, name: "BNB Chain", explorer: "bscscan.com" },
  { id: 137, name: "Polygon", explorer: "polygonscan.com" },
  { id: 42161, name: "Arbitrum One", explorer: "arbiscan.io" },
  { id: 10, name: "Optimism", explorer: "optimistic.etherscan.io" },
  { id: 8453, name: "Base", explorer: "basescan.org" },
  { id: 43114, name: "Avalanche C-Chain", explorer: "snowtrace.io" },
  { id: 250, name: "Fantom", explorer: "ftmscan.com" },
];

// Each "type" can expand to several underlying API actions.
const TX_TYPE_GROUPS = {
  normal: [{ action: "txlist", label: "Normale", color: "#4f8ef7" }],
  internal: [{ action: "txlistinternal", label: "Interne", color: "#f7a24f" }],
  token: [
    { action: "tokentx", label: "ERC20", color: "#4fd67a" },
    { action: "tokennfttx", label: "ERC721", color: "#c14fd6" },
    { action: "token1155tx", label: "ERC1155", color: "#d64f6b" },
  ],
};

// ---------------------------------------------------------------------------
// DOM refs
// ---------------------------------------------------------------------------
const el = (id) => document.getElementById(id);
const apiKeyInput = el("apiKey");
const chainSelect = el("chainSelect");
const addressInput = el("address");
const depthInput = el("depth");
const maxTxInput = el("maxTxPerAddress");
const safetyCapInput = el("safetyCap");
const rpsInput = el("rps");
const typeNormal = el("typeNormal");
const typeInternal = el("typeInternal");
const typeToken = el("typeToken");
const startBtn = el("startBtn");
const stopBtn = el("stopBtn");
const resetBtn = el("resetBtn");
const statusEl = el("status");
const detailsContent = el("detailsContent");
const logContent = el("logContent");

// ---------------------------------------------------------------------------
// Persisted settings (API key only — never sent anywhere but Etherscan)
// ---------------------------------------------------------------------------
apiKeyInput.value = localStorage.getItem("etherscanApiKey") || "";
apiKeyInput.addEventListener("change", () => {
  localStorage.setItem("etherscanApiKey", apiKeyInput.value.trim());
});

CHAINS.forEach((c) => {
  const opt = document.createElement("option");
  opt.value = c.id;
  opt.textContent = `${c.name} (chainid ${c.id})`;
  chainSelect.appendChild(opt);
});
chainSelect.value = localStorage.getItem("etherscanChainId") || "1";
chainSelect.addEventListener("change", () => {
  localStorage.setItem("etherscanChainId", chainSelect.value);
});

// ---------------------------------------------------------------------------
// Logging / status helpers
// ---------------------------------------------------------------------------
function log(msg, isErr) {
  const line = document.createElement("div");
  if (isErr) line.className = "err";
  const t = new Date().toLocaleTimeString();
  line.textContent = `[${t}] ${msg}`;
  logContent.appendChild(line);
  logContent.scrollTop = logContent.scrollHeight;
}
function setStatus(msg) {
  statusEl.textContent = msg;
}

// ---------------------------------------------------------------------------
// Rate limiter — runs queued API calls sequentially at a fixed req/s pace,
// so we stay under whatever tier the user configured.
// ---------------------------------------------------------------------------
class RateLimiter {
  constructor(rps) {
    this.setRps(rps);
    this.queue = [];
    this.running = false;
  }
  setRps(rps) {
    this.interval = 1000 / Math.max(1, rps);
  }
  run(fn) {
    return new Promise((resolve, reject) => {
      this.queue.push({ fn, resolve, reject });
      this._drain();
    });
  }
  async _drain() {
    if (this.running) return;
    this.running = true;
    while (this.queue.length) {
      const { fn, resolve, reject } = this.queue.shift();
      try {
        resolve(await fn());
      } catch (e) {
        reject(e);
      }
      await sleep(this.interval);
    }
    this.running = false;
  }
}
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

let limiter = new RateLimiter(parseInt(rpsInput.value, 10));

// ---------------------------------------------------------------------------
// Etherscan fetch with retry on rate-limit responses
// ---------------------------------------------------------------------------
async function fetchAction(address, action, chainId, offset) {
  const apiKey = apiKeyInput.value.trim();
  const params = new URLSearchParams({
    chainid: chainId,
    module: "account",
    action,
    address,
    startblock: "0",
    endblock: "99999999",
    page: "1",
    offset: String(offset),
    sort: "desc",
    apikey: apiKey,
  });
  const url = `${API_BASE}?${params.toString()}`;

  for (let attempt = 0; attempt < 4; attempt++) {
    let resp;
    try {
      resp = await fetch(url);
    } catch (e) {
      throw new Error(`Erreur réseau (${action}): ${e.message}`);
    }
    let data;
    try {
      data = await resp.json();
    } catch (e) {
      throw new Error(`Réponse invalide (${action})`);
    }
    if (data.status === "1") return data.result || [];
    const msg = (data.message || "") + " " + (data.result || "");
    if (/rate limit/i.test(msg)) {
      log(`Rate limit atteint (${action}), nouvelle tentative...`, true);
      await sleep(1200 * (attempt + 1));
      continue;
    }
    if (/no transactions found/i.test(msg)) return [];
    // Any other non-fatal "0" status (e.g. invalid key, bad module) is a real
    // problem the user needs to see, not a silent empty result.
    throw new Error(`Erreur API (${action}): ${msg.trim()}`);
  }
  throw new Error(`Échec après plusieurs tentatives (${action})`);
}

// ---------------------------------------------------------------------------
// Graph state (vis-network)
// ---------------------------------------------------------------------------
const nodesDS = new vis.DataSet([]);
const edgesDS = new vis.DataSet([]);
const nodeMeta = new Map(); // address -> { depth, isRoot }
const edgeKeys = new Set(); // dedup key: action|hash|from|to
const aliasMap = new Map(); // address -> user-defined alias

const network = new vis.Network(
  el("graph"),
  { nodes: nodesDS, edges: edgesDS },
  {
    nodes: {
      shape: "dot",
      size: 14,
      font: { color: "#e6e6e6", size: 12 },
      borderWidth: 1,
    },
    edges: {
      arrows: { to: { enabled: true, scaleFactor: 0.6 } },
      smooth: { type: "dynamic" },
      font: { size: 9, color: "#aab2c0", strokeWidth: 0 },
      color: { inherit: false },
    },
    physics: {
      stabilization: false,
      barnesHut: { gravitationalConstant: -6000, springLength: 140, springConstant: 0.02 },
    },
    interaction: { hover: true, multiselect: true },
  }
);

function depthColor(depth) {
  const hue = (200 + depth * 45) % 360;
  return `hsl(${hue}, 65%, 55%)`;
}

function addNode(address, depth, isRoot) {
  address = address.toLowerCase();
  const existing = nodeMeta.get(address);
  if (existing) {
    if (depth < existing.depth) existing.depth = depth;
    if (isRoot) existing.isRoot = true;
    return;
  }
  nodeMeta.set(address, { depth, isRoot: !!isRoot });
  const alias = aliasMap.get(address);
  nodesDS.add({
    id: address,
    label: nodeLabel(address),
    color: isRoot ? "#e63946" : depthColor(depth),
    title: alias ? `${alias} — ${address}` : address,
  });
}

// Global display setting: "short" (3 first + 3 last chars) or "full" address.
let addressFormat = localStorage.getItem("addressFormat") || "short";

function displayAddress(address) {
  return addressFormat === "full" ? address : short(address);
}

function nodeLabel(address) {
  const alias = aliasMap.get(address);
  return alias ? `${alias}\n(${displayAddress(address)})` : displayAddress(address);
}

function refreshNodeLabel(address) {
  if (!nodeMeta.has(address)) return;
  const alias = aliasMap.get(address);
  nodesDS.update({
    id: address,
    label: nodeLabel(address),
    title: alias ? `${alias} — ${address}` : address,
  });
}

function refreshAllNodeLabels() {
  nodeMeta.forEach((_, address) => refreshNodeLabel(address));
}

const addressFormatSelect = el("addressFormat");
addressFormatSelect.value = addressFormat;
addressFormatSelect.addEventListener("change", () => {
  addressFormat = addressFormatSelect.value;
  localStorage.setItem("addressFormat", addressFormat);
  refreshAllNodeLabels();
});

function promptAlias(address) {
  const current = aliasMap.get(address) || "";
  const alias = prompt(`Alias pour ${address} :`, current);
  if (alias === null) return; // cancelled
  if (alias.trim()) {
    aliasMap.set(address, alias.trim());
  } else {
    aliasMap.delete(address);
  }
  refreshNodeLabel(address);
  if (detailsContent.dataset.address === address) showNodeDetails(address);
}

function addEdge(from, to, typeInfo, tx) {
  from = from.toLowerCase();
  to = to.toLowerCase();
  const key = `${typeInfo.action}|${tx.hash}|${from}|${to}|${tx.tokenSymbol || ""}`;
  if (edgeKeys.has(key)) return;
  edgeKeys.add(key);

  const decimals = tx.tokenDecimal ? parseInt(tx.tokenDecimal, 10) : 18;
  const amount = formatUnits(tx.value || "0", decimals);
  const symbol = tx.tokenSymbol ? ` ${tx.tokenSymbol}` : " ETH";
  const label = `${trimZero(amount)}${symbol}`;

  edgesDS.add({
    id: key,
    from,
    to,
    color: { color: typeInfo.color, highlight: typeInfo.color },
    label: label.length > 18 ? "" : label,
    title: `${typeInfo.label}`,
    data: {
      type: typeInfo.label,
      hash: tx.hash,
      from,
      to,
      amount: trimZero(amount),
      symbol: tx.tokenSymbol || "ETH",
      timeStamp: tx.timeStamp,
      blockNumber: tx.blockNumber,
    },
  });
}

function formatUnits(value, decimals) {
  try {
    let v = BigInt(value);
    const neg = v < 0n;
    if (neg) v = -v;
    const base = 10n ** BigInt(decimals);
    const whole = v / base;
    const frac = v % base;
    let fracStr = frac.toString().padStart(decimals, "0").slice(0, 6);
    return (neg ? "-" : "") + whole.toString() + "." + fracStr;
  } catch (e) {
    return "0";
  }
}
function trimZero(s) {
  return s.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
}
function short(addr) {
  return addr.slice(0, 5) + "…" + addr.slice(-4);
}

function explorerFor(chainId) {
  const c = CHAINS.find((c) => String(c.id) === String(chainId));
  return c ? c.explorer : "etherscan.io";
}

// ---------------------------------------------------------------------------
// Click handlers -> details panel
// ---------------------------------------------------------------------------
function showNodeDetails(addr) {
  const chainId = chainSelect.value;
  const explorer = explorerFor(chainId);
  const meta = nodeMeta.get(addr);
  const alias = aliasMap.get(addr);
  detailsContent.dataset.address = addr;
  detailsContent.innerHTML = `
    <table>
      <tr><td class="k">Alias</td><td>${alias ? alias : "<em>aucun</em>"}</td></tr>
      <tr><td class="k">Adresse</td><td>${addr}</td></tr>
      <tr><td class="k">Profondeur</td><td>${meta ? meta.depth : "?"}</td></tr>
      <tr><td class="k">Racine</td><td>${meta && meta.isRoot ? "Oui" : "Non"}</td></tr>
      <tr><td class="k">Lien</td><td><a href="https://${explorer}/address/${addr}" target="_blank" rel="noopener">Voir sur ${explorer}</a></td></tr>
    </table>
    <button onclick="promptAlias('${addr}')" style="margin-top:8px">Renommer (alias)</button>`;
}

function showEdgeDetails(edgeId) {
  const chainId = chainSelect.value;
  const explorer = explorerFor(chainId);
  const edge = edgesDS.get(edgeId);
  if (!edge) return;
  delete detailsContent.dataset.address;
  const d = edge.data;
  const date = d.timeStamp ? new Date(parseInt(d.timeStamp, 10) * 1000).toLocaleString() : "?";
  detailsContent.innerHTML = `
    <table>
      <tr><td class="k">Type</td><td>${d.type}</td></tr>
      <tr><td class="k">De</td><td>${aliasMap.get(d.from) || d.from}</td></tr>
      <tr><td class="k">Vers</td><td>${aliasMap.get(d.to) || d.to}</td></tr>
      <tr><td class="k">Montant</td><td>${d.amount} ${d.symbol}</td></tr>
      <tr><td class="k">Bloc</td><td>${d.blockNumber}</td></tr>
      <tr><td class="k">Date</td><td>${date}</td></tr>
      <tr><td class="k">Lien</td><td><a href="https://${explorer}/tx/${d.hash}" target="_blank" rel="noopener">Voir la tx</a></td></tr>
    </table>`;
}

network.on("click", (params) => {
  if (params.nodes.length) {
    showNodeDetails(params.nodes[0]);
  } else if (params.edges.length) {
    showEdgeDetails(params.edges[0]);
  }
});

network.on("doubleClick", (params) => {
  if (params.nodes.length) {
    promptAlias(params.nodes[0]);
  }
});

// ---------------------------------------------------------------------------
// Node deletion (select + Delete key, or button)
// ---------------------------------------------------------------------------
function deleteSelectedNodes() {
  const selected = network.getSelectedNodes();
  if (!selected.length) {
    log("Sélectionnez au moins un nœud (clic, ou ctrl/shift+clic pour plusieurs) avant de supprimer.");
    return;
  }
  selected.forEach((id) => {
    network.getConnectedEdges(id).forEach((edgeId) => {
      edgesDS.remove(edgeId);
      edgeKeys.delete(edgeId);
    });
    nodesDS.remove(id);
    nodeMeta.delete(id);
    aliasMap.delete(id);
  });
  log(`${selected.length} nœud(s) supprimé(s) du graphe.`);
  detailsContent.textContent = "Cliquez sur un nœud ou une flèche du graphe.";
}

document.addEventListener("keydown", (e) => {
  if (e.key !== "Delete" && e.key !== "Backspace") return;
  const tag = document.activeElement && document.activeElement.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
  e.preventDefault();
  deleteSelectedNodes();
});

el("deleteNodesBtn").addEventListener("click", deleteSelectedNodes);

// ---------------------------------------------------------------------------
// Graph rotation
// ---------------------------------------------------------------------------
function rotateGraph(angleDeg) {
  const ids = nodesDS.getIds();
  if (!ids.length) return;
  const positions = network.getPositions(ids);
  let cx = 0,
    cy = 0;
  ids.forEach((id) => {
    cx += positions[id].x;
    cy += positions[id].y;
  });
  cx /= ids.length;
  cy /= ids.length;
  const angle = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(angle),
    sin = Math.sin(angle);
  ids.forEach((id) => {
    const p = positions[id];
    const dx = p.x - cx,
      dy = p.y - cy;
    network.moveNode(id, dx * cos - dy * sin + cx, dx * sin + dy * cos + cy);
  });
}

el("rotateLeftBtn").addEventListener("click", () => rotateGraph(-20));
el("rotateRightBtn").addEventListener("click", () => rotateGraph(20));

// ---------------------------------------------------------------------------
// Multi-selection by rectangle: hold Shift + drag over the canvas.
// ---------------------------------------------------------------------------
const graphContainer = el("graph");
let boxSelecting = false;
let boxStart = null;
let boxDiv = null;

graphContainer.addEventListener("mousedown", (e) => {
  if (!e.shiftKey) return;
  boxSelecting = true;
  boxStart = { x: e.offsetX, y: e.offsetY };
  network.setOptions({ interaction: { dragView: false } });
  boxDiv = document.createElement("div");
  boxDiv.className = "select-box";
  boxDiv.style.left = boxStart.x + "px";
  boxDiv.style.top = boxStart.y + "px";
  graphContainer.appendChild(boxDiv);
  e.preventDefault();
});

graphContainer.addEventListener("mousemove", (e) => {
  if (!boxSelecting) return;
  const x = Math.min(boxStart.x, e.offsetX);
  const y = Math.min(boxStart.y, e.offsetY);
  const w = Math.abs(e.offsetX - boxStart.x);
  const h = Math.abs(e.offsetY - boxStart.y);
  boxDiv.style.left = x + "px";
  boxDiv.style.top = y + "px";
  boxDiv.style.width = w + "px";
  boxDiv.style.height = h + "px";
});

window.addEventListener("mouseup", (e) => {
  if (!boxSelecting) return;
  boxSelecting = false;
  network.setOptions({ interaction: { dragView: true } });
  const rect = graphContainer.getBoundingClientRect();
  const endX = e.clientX - rect.left;
  const endY = e.clientY - rect.top;
  if (boxDiv) {
    boxDiv.remove();
    boxDiv = null;
  }

  const domX1 = Math.min(boxStart.x, endX),
    domX2 = Math.max(boxStart.x, endX);
  const domY1 = Math.min(boxStart.y, endY),
    domY2 = Math.max(boxStart.y, endY);
  const c1 = network.DOMtoCanvas({ x: domX1, y: domY1 });
  const c2 = network.DOMtoCanvas({ x: domX2, y: domY2 });

  const ids = nodesDS.getIds();
  const positions = network.getPositions(ids);
  const selected = ids.filter((id) => {
    const p = positions[id];
    return p.x >= c1.x && p.x <= c2.x && p.y >= c1.y && p.y <= c2.y;
  });
  network.setSelection({ nodes: selected, edges: [] });
  if (selected.length) log(`${selected.length} nœud(s) sélectionné(s) par rectangle.`);
});

// ---------------------------------------------------------------------------
// Select nodes with a high degree — usually faucets, exchanges or spam
// contracts that fan out to hundreds of addresses and clutter the graph.
// ---------------------------------------------------------------------------
el("selectHighDegreeBtn").addEventListener("click", () => {
  const threshold = Math.max(1, parseInt(el("degreeThreshold").value, 10) || 1);
  const ids = nodesDS.getIds();
  const selected = ids.filter((id) => network.getConnectedEdges(id).length >= threshold);
  network.setSelection({ nodes: selected, edges: [] });
  log(`${selected.length} nœud(s) avec degré ≥ ${threshold} sélectionné(s). Appuyez sur Suppr pour les retirer.`);
});

// ---------------------------------------------------------------------------
// Export: image (PNG), PDF, spreadsheet (CSV)
// ---------------------------------------------------------------------------
function triggerDownload(href, filename) {
  const a = document.createElement("a");
  a.href = href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

el("fitViewBtn").addEventListener("click", () => {
  network.fit({ animation: { duration: 400, easingFunction: "easeInOutQuad" } });
});

const RESOLUTION_PRESETS = {
  hd: { w: 1920, h: 1080 },
  qhd: { w: 2560, h: 1440 },
  uhd: { w: 3840, h: 2160 },
};

function computeExportSize() {
  const val = el("exportResolution").value;
  if (val === "auto") {
    const n = Math.max(1, nodesDS.length);
    const w = Math.max(2400, Math.min(10000, n * 260));
    return { w, h: Math.round(w * 0.6) };
  }
  return RESOLUTION_PRESETS[val] || RESOLUTION_PRESETS.qhd;
}

// Renders the whole graph off-screen at a chosen pixel resolution, with
// addresses/aliases shown per the current address-format setting (full or
// short), using the *current* node layout (positions, deletions, renames) —
// but independent from whatever zoom/pan the user has on the live graph.
function renderExportCanvas(callback) {
  if (!nodesDS.length) {
    log("Rien à exporter : le graphe est vide.", true);
    return;
  }
  const { w, h } = computeExportSize();
  const ids = nodesDS.getIds();
  const positions = network.getPositions(ids);

  const offscreen = document.createElement("div");
  offscreen.style.position = "fixed";
  offscreen.style.left = "-100000px";
  offscreen.style.top = "0px";
  offscreen.style.width = w + "px";
  offscreen.style.height = h + "px";
  offscreen.style.background = "#0b0d11";
  document.body.appendChild(offscreen);

  const exportNodes = new vis.DataSet(
    nodesDS.get().map((n) => {
      const p = positions[n.id] || { x: 0, y: 0 };
      return { ...n, x: p.x, y: p.y, fixed: { x: true, y: true }, label: nodeLabel(n.id) };
    })
  );
  const exportEdges = new vis.DataSet(edgesDS.get());

  const tempNet = new vis.Network(
    offscreen,
    { nodes: exportNodes, edges: exportEdges },
    {
      nodes: { shape: "dot", size: 16, font: { color: "#f1f1f1", size: 20, face: "monospace" }, borderWidth: 1 },
      edges: {
        arrows: { to: { enabled: true, scaleFactor: 0.7 } },
        smooth: { type: "dynamic" },
        font: { size: 16, color: "#d7dde6", strokeWidth: 5, strokeColor: "#0b0d11" },
        color: { inherit: false },
      },
      physics: false,
      interaction: { zoomView: false, dragView: false },
    }
  );

  tempNet.once("afterDrawing", () => {
    requestAnimationFrame(() => {
      try {
        // vis-network's canvas itself is transparent — bake an opaque
        // background in first, otherwise light label text becomes invisible
        // once flattened onto a white page (e.g. in the PDF/most viewers).
        const raw = tempNet.canvas.frame.canvas;
        const composite = document.createElement("canvas");
        composite.width = raw.width;
        composite.height = raw.height;
        const ctx = composite.getContext("2d");
        ctx.fillStyle = "#0b0d11";
        ctx.fillRect(0, 0, composite.width, composite.height);
        ctx.drawImage(raw, 0, 0);
        callback(composite, w, h);
      } finally {
        tempNet.destroy();
        offscreen.remove();
      }
    });
  });
  tempNet.fit({ animation: false });
}

el("exportPngBtn").addEventListener("click", () => {
  renderExportCanvas((canvas) => {
    triggerDownload(canvas.toDataURL("image/png"), `graph-${Date.now()}.png`);
    log(`Export image (PNG) téléchargé — ${canvas.width}×${canvas.height}px, adresses/alias complets.`);
  });
});

el("exportPdfBtn").addEventListener("click", () => {
  renderExportCanvas((canvas, w, h) => {
    const imgData = canvas.toDataURL("image/png");
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: w >= h ? "l" : "p", unit: "px", format: [w, h] });
    doc.addImage(imgData, "PNG", 0, 0, w, h);
    doc.save(`graph-${Date.now()}.pdf`);
    log(`Export PDF téléchargé — ${w}×${h}px, adresses/alias complets.`);
  });
});

function csvEscape(v) {
  v = String(v ?? "");
  if (/[",\n]/.test(v)) return '"' + v.replace(/"/g, '""') + '"';
  return v;
}

el("exportCsvBtn").addEventListener("click", () => {
  if (!nodesDS.length) return log("Rien à exporter : le graphe est vide.", true);
  const header = [
    "row_type", "address", "alias", "depth", "is_root",
    "tx_type", "from", "to", "amount", "symbol", "hash", "block", "date",
  ];
  const rows = [header];

  nodesDS.forEach((n) => {
    const meta = nodeMeta.get(n.id) || {};
    rows.push([
      "node", n.id, aliasMap.get(n.id) || "", meta.depth ?? "", meta.isRoot ? "1" : "0",
      "", "", "", "", "", "", "", "",
    ]);
  });
  edgesDS.forEach((e) => {
    const d = e.data || {};
    const date = d.timeStamp ? new Date(parseInt(d.timeStamp, 10) * 1000).toISOString() : "";
    rows.push([
      "edge", "", "", "", "",
      d.type || "", d.from || "", d.to || "", d.amount || "", d.symbol || "", d.hash || "", d.blockNumber || "", date,
    ]);
  });

  const csv = rows.map((r) => r.map(csvEscape).join(",")).join("\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  triggerDownload(url, `graph-${Date.now()}.csv`);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  log("Export tableur (CSV) téléchargé.");
});

// ---------------------------------------------------------------------------
// Scan orchestration
// ---------------------------------------------------------------------------
let stopped = false;
let scanning = false;

function selectedTypeGroups() {
  const groups = [];
  if (typeNormal.checked) groups.push(...TX_TYPE_GROUPS.normal);
  if (typeInternal.checked) groups.push(...TX_TYPE_GROUPS.internal);
  if (typeToken.checked) groups.push(...TX_TYPE_GROUPS.token);
  return groups;
}

function isValidAddress(addr) {
  return /^0x[a-fA-F0-9]{40}$/.test(addr);
}

async function startScan() {
  const apiKey = apiKeyInput.value.trim();
  const address = addressInput.value.trim();
  const chainId = chainSelect.value;
  const maxDepth = Math.max(1, parseInt(depthInput.value, 10) || 1);
  const maxTxPerAddress = Math.min(1000, Math.max(1, parseInt(maxTxInput.value, 10) || 20));
  const safetyCap = Math.max(1, parseInt(safetyCapInput.value, 10) || 300);
  const rps = Math.max(1, parseInt(rpsInput.value, 10) || 3);
  const types = selectedTypeGroups();

  if (!apiKey) {
    alert("Merci de renseigner votre clé API Etherscan.");
    return;
  }
  if (!isValidAddress(address)) {
    alert("Adresse Ethereum invalide (format attendu : 0x + 40 caractères hex).");
    return;
  }
  if (!types.length) {
    alert("Sélectionnez au moins un type de transaction.");
    return;
  }

  limiter = new RateLimiter(rps);
  stopped = false;
  scanning = true;
  startBtn.disabled = true;
  stopBtn.disabled = false;
  addressInput.disabled = true;

  const root = address.toLowerCase();
  const visited = new Set();
  const queue = [{ address: root, depth: 0 }];
  addNode(root, 0, true);

  let processed = 0;
  let apiCalls = 0;

  log(`Démarrage du scan: ${root} | profondeur=${maxDepth} | types=${types.map((t) => t.label).join(", ")}`);

  while (queue.length && !stopped) {
    const { address: cur, depth } = queue.shift();
    if (visited.has(cur)) continue;
    visited.add(cur);
    processed++;

    if (processed > safetyCap) {
      log(`Plafond de sécurité atteint (${safetyCap} adresses). Arrêt.`, true);
      break;
    }

    setStatus(
      `Analyse ${short(cur)} (niveau ${depth}/${maxDepth}) — ${visited.size} adresses traitées, ${queue.length} en file, ${apiCalls} appels API`
    );

    if (depth >= maxDepth) continue;

    for (const typeInfo of types) {
      if (stopped) break;
      let txs;
      try {
        apiCalls++;
        txs = await limiter.run(() => fetchAction(cur, typeInfo.action, chainId, maxTxPerAddress));
      } catch (e) {
        log(e.message, true);
        continue;
      }
      for (const tx of txs) {
        const from = (tx.from || "").toLowerCase();
        const to = (tx.to || tx.contractAddress || "").toLowerCase();
        if (!isValidAddress(from) || !isValidAddress(to)) continue;

        addNode(from, from === cur ? depth : depth + 1);
        addNode(to, to === cur ? depth : depth + 1);
        addEdge(from, to, typeInfo, tx);

        const other = from === cur ? to : from;
        if (!visited.has(other)) {
          queue.push({ address: other, depth: depth + 1 });
        }
      }
    }
  }

  log(`Scan terminé: ${nodeMeta.size} adresses, ${edgesDS.length} transactions affichées, ${apiCalls} appels API.`);
  setStatus(`Terminé — ${nodeMeta.size} adresses, ${edgesDS.length} liens`);
  scanning = false;
  startBtn.disabled = false;
  stopBtn.disabled = true;
  addressInput.disabled = false;
}

function stopScan() {
  stopped = true;
  log("Arrêt demandé par l'utilisateur.");
}

function resetGraph() {
  nodesDS.clear();
  edgesDS.clear();
  nodeMeta.clear();
  edgeKeys.clear();
  aliasMap.clear();
  delete detailsContent.dataset.address;
  detailsContent.textContent = "Cliquez sur un nœud ou une flèche du graphe.";
  logContent.innerHTML = "";
  setStatus("");
}

startBtn.addEventListener("click", () => {
  if (!scanning) startScan();
});
stopBtn.addEventListener("click", stopScan);
resetBtn.addEventListener("click", () => {
  if (!scanning) resetGraph();
});
