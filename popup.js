const API = "http://localhost:3000"; // use your HTTPS backend URL in production (+ host_permissions)
const $ = (s) => document.querySelector(s);
const h = (t, p = {}, ...c) => { const e = document.createElement(t); Object.assign(e, p); e.append(...c); return e; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const msg = (t) => ($("#msg").textContent = t || "");

let token, cfg, profile = {}, products = [], sel = null, picked = [];

async function getToken() {
  const { token: t } = await chrome.storage.local.get("token");
  if (t) return t;
  const n = crypto.randomUUID() + crypto.randomUUID();
  await chrome.storage.local.set({ token: n });
  return n;
}

async function api(path, { method = "GET", json, body, blob } = {}) {
  token ||= await getToken();
  const r = await fetch(API + path, {
    method, body: json ? JSON.stringify(json) : body,
    headers: { Authorization: "Bearer " + token, ...(json ? { "Content-Type": "application/json" } : {}) },
  });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.statusText);
  return blob ? r.blob() : r.json();
}

// ---------- tabs ----------
document.querySelectorAll("nav button").forEach((b) => (b.onclick = () => {
  document.querySelectorAll("nav button").forEach((x) => x.classList.toggle("on", x === b));
  ["tryon", "profile", "results"].forEach((id) => ($("#" + id).hidden = id !== b.dataset.tab));
  if (b.dataset.tab === "results") loadResults();
}));

// ---------- profile ----------
async function shrink(file, max = 1024) {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = h("canvas", { width: Math.round(bmp.width * k), height: Math.round(bmp.height * k) });
  c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
  return new Promise((r) => c.toBlob(r, "image/jpeg", 0.85));
}

function renderProfile() {
  const box = $("#slots"); box.innerHTML = "";
  for (const [id, s] of Object.entries(cfg.slots)) {
    const img = h("img", { className: "thumb", alt: "" });
    if (profile[id]) api(`/api/profile/${id}/image`, { blob: true }).then((b) => (img.src = URL.createObjectURL(b)));
    const input = h("input", { type: "file", accept: "image/*" });
    input.onchange = async () => {
      try {
        msg("Uploading...");
        const fd = new FormData(); fd.append("photo", await shrink(input.files[0]), "p.jpg");
        await api("/api/profile/" + id, { method: "PUT", body: fd });
        profile = await api("/api/profile"); msg(""); renderProfile();
      } catch (e) { msg("Warning: " + e.message); }
    };
    box.append(h("div", { className: "slot" }, img,
      h("div", {}, h("b", {}, s.label + (profile[id] ? " (uploaded)" : "")), h("p", { className: "tip" }, s.tip), input)));
  }
}

$("#wipe").onclick = async () => {
  if (!confirm("Delete all profile photos from the server?")) return;
  await api("/api/profile", { method: "DELETE" }); profile = {}; renderProfile();
};

// ---------- product detection ----------
function guessCategory(text) {
  return (cfg.categories.find((c) => c.keywords.some((k) => text.includes(k))) || cfg.categories[0]).id;
}

async function scan() {
  $("#products").innerHTML = ""; $("#panel").hidden = true;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const [res] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["detect.js"] });
    products = res.result.products;
    products.forEach((p) => (p.category = guessCategory(p.text)));
  } catch { products = []; msg("Can't read this page (open a normal shopping page, not a chrome:// page)."); }
  if (!products.length) return $("#products").append(h("p", { className: "tip" }, "No products detected on this page."));
  products.forEach((p, i) => $("#products").append(
    h("div", { className: "card", onclick: () => select(i) }, h("img", { src: p.images[0], alt: "" }),
      h("div", {}, h("b", {}, p.title), h("small", {}, [p.price, p.source].filter(Boolean).join(" | "))))));
  if (products.length === 1) select(0);
}

function select(i) {
  sel = products[i]; picked = [sel.images[0]];
  document.querySelectorAll(".card").forEach((c, j) => c.classList.toggle("on", j === i));
  $("#panel").hidden = false; $("#result").hidden = true; $("#status").textContent = "";
  $("#ptitle").textContent = sel.title;
  const cat = $("#cat"); cat.innerHTML = "";
  cfg.categories.forEach((c) => cat.append(h("option", { value: c.id, textContent: c.label })));
  cat.value = sel.category;
  const v = $("#variants"); v.innerHTML = "";
  sel.images.forEach((src) => {
    const im = h("img", { src, alt: "", className: picked.includes(src) ? "on" : "" });
    im.onclick = () => {
      if (picked.includes(src)) { if (picked.length > 1) picked = picked.filter((x) => x !== src); }
      else picked = [...picked.slice(-1), src].slice(-2);
      [...v.children].forEach((c) => c.classList.toggle("on", picked.includes(c.src)));
    };
    v.append(im);
  });
}

// ---------- try on ----------
$("#go").onclick = async () => {
  const btn = $("#go"), st = $("#status"), bar = $("#bar");
  btn.disabled = true; bar.hidden = false; $("#result").hidden = true; st.textContent = "Starting...";
  try {
    const { id } = await api("/api/tryon", { method: "POST", json: {
      category: $("#cat").value, title: sel.title, url: sel.url, imageUrls: picked,
      scene: $("#scene").checked ? "auto" : "plain" } });
    for (;;) {
      await sleep(1500);
      const s = await api("/api/tryon/" + id);
      if (s.status === "error") throw new Error(s.error || "Failed");
      if (s.status === "done") break;
      st.textContent = s.stage + "...";
    }
    const b = await api(`/api/tryon/${id}/image`, { blob: true });
    $("#result").src = URL.createObjectURL(b); $("#result").hidden = false; st.textContent = "Done!";
  } catch (e) { st.textContent = "Warning: " + e.message; }
  finally { btn.disabled = false; bar.hidden = true; }
};

// ---------- saved results ----------
async function loadResults() {
  const list = $("#rlist"); list.innerHTML = "";
  const rows = await api("/api/results");
  if (!rows.length) list.append(h("p", { className: "tip" }, "No saved results yet."));
  for (const r of rows) {
    const img = h("img", { alt: "" });
    api(`/api/tryon/${r.id}/image`, { blob: true }).then((b) => (img.src = URL.createObjectURL(b)));
    const del = h("button", { className: "link", textContent: "Delete" });
    del.onclick = async () => { await api("/api/results/" + r.id, { method: "DELETE" }); loadResults(); };
    list.append(h("div", { className: "rcard" }, img, h("div", {}, h("b", {}, r.title), h("small", {}, r.category), h("br"), del)));
  }
}
$("#wipeRes").onclick = async () => { if (confirm("Delete all results?")) { await api("/api/results", { method: "DELETE" }); loadResults(); } };
$("#rescan").onclick = scan;

// ---------- init ----------
(async () => {
  try {
    cfg = await api("/api/config"); profile = await api("/api/profile");
    renderProfile(); scan();
  } catch (e) { msg("Backend unreachable: " + e.message + ". Is it running on " + API + "?"); }
})();
