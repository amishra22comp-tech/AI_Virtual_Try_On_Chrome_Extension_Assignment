require("dotenv").config();
const express = require("express"), cors = require("cors"), multer = require("multer"), sharp = require("sharp");
const Database = require("better-sqlite3");
const crypto = require("crypto"), fs = require("fs"), path = require("path"), dns = require("dns").promises, net = require("net");
const { slots, categories } = require("./categories");

const PORT = process.env.PORT || 3000;
const KEY = process.env.GEMINI_API_KEY;              // lives ONLY on the server
const MODEL = process.env.TRYON_MODEL || "gemini-2.5-flash-image";
const DATA = path.join(__dirname, "data");           // private: never served statically
["profiles", "results", "cache"].forEach((d) => fs.mkdirSync(path.join(DATA, d), { recursive: true }));
if (!KEY) console.warn("WARNING: GEMINI_API_KEY is not set");

// ---------- DB ----------
const db = new Database(path.join(DATA, "app.db"));
db.exec(`
CREATE TABLE IF NOT EXISTS photos (
  user_id TEXT, slot TEXT, file TEXT, hash TEXT, updated INTEGER,
  PRIMARY KEY (user_id, slot));
CREATE TABLE IF NOT EXISTS results (
  id TEXT PRIMARY KEY, user_id TEXT, category TEXT, title TEXT, url TEXT,
  status TEXT, stage TEXT, error TEXT, file TEXT, created INTEGER);
CREATE INDEX IF NOT EXISTS idx_results_user ON results(user_id, created);`);

const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");
const rmFile = (f) => { try { f && fs.unlinkSync(f); } catch {} };

// ---------- App ----------
const app = express();
app.use(cors({ origin: (o, cb) => cb(null, !o || o.startsWith("chrome-extension://")) }));
app.use(express.json({ limit: "100kb" }));
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

app.get("/api/config", (_q, res) =>
  res.json({ slots, categories: categories.map(({ instruction, ...c }) => c) }));

// Anonymous per-install bearer token; only its hash is used as the user id.
app.use("/api", (req, res, next) => {
  const t = (req.headers.authorization || "").replace("Bearer ", "");
  if (t.length < 32) return res.status(401).json({ error: "Unauthorized" });
  req.uid = sha(t);
  next();
});

// ---------- Profile ----------
app.get("/api/profile", (req, res) => {
  const rows = db.prepare("SELECT slot, hash, updated FROM photos WHERE user_id=?").all(req.uid);
  res.json(Object.fromEntries(rows.map((r) => [r.slot, r])));
});

app.put("/api/profile/:slot", upload.single("photo"), async (req, res) => {
  const slot = req.params.slot;
  if (!slots[slot] || !req.file) return res.status(400).json({ error: "Bad request" });
  try {
    const buf = await sharp(req.file.buffer).rotate()
      .resize(1024, 1024, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
    const hash = sha(buf);
    const old = db.prepare("SELECT hash FROM photos WHERE user_id=? AND slot=?").get(req.uid, slot);
    if (old?.hash === hash) return res.json({ hash, unchanged: true }); // dedupe identical uploads
    const file = path.join(DATA, "profiles", `${req.uid}_${slot}.jpg`);
    fs.writeFileSync(file, buf);
    db.prepare("INSERT OR REPLACE INTO photos VALUES (?,?,?,?,?)").run(req.uid, slot, file, hash, Date.now());
    res.json({ hash });
  } catch { res.status(400).json({ error: "Invalid image" }); }
});

app.get("/api/profile/:slot/image", (req, res) => {
  const r = db.prepare("SELECT file FROM photos WHERE user_id=? AND slot=?").get(req.uid, req.params.slot);
  if (!r) return res.sendStatus(404);
  res.set("Cache-Control", "private, max-age=3600").sendFile(r.file);
});

app.delete("/api/profile", (req, res) => {
  db.prepare("SELECT file FROM photos WHERE user_id=?").all(req.uid).forEach((r) => rmFile(r.file));
  db.prepare("DELETE FROM photos WHERE user_id=?").run(req.uid);
  res.json({ ok: true });
});

// ---------- Try-on ----------
app.post("/api/tryon", (req, res) => {
  const { category, title = "", url = "", imageUrls = [], scene = "auto" } = req.body || {};
  const cat = categories.find((c) => c.id === category);
  if (!cat || !Array.isArray(imageUrls) || imageUrls.length < 1 || imageUrls.length > 2)
    return res.status(400).json({ error: "Invalid request" });

  const have = new Set(db.prepare("SELECT slot FROM photos WHERE user_id=?").all(req.uid).map((r) => r.slot));
  const missing = cat.slots.filter((s) => !have.has(s));
  if (missing.length)
    return res.status(400).json({ error: `Add these profile photos first: ${missing.map((s) => slots[s].label).join(", ")}` });

  const pending = db.prepare("SELECT COUNT(*) n FROM results WHERE user_id=? AND status='pending'").get(req.uid).n;
  if (pending >= 2) return res.status(429).json({ error: "Please wait for your current try-ons to finish" });

  const id = crypto.randomUUID();
  db.prepare("INSERT INTO results (id,user_id,category,title,url,status,stage,created) VALUES (?,?,?,?,?,?,?,?)")
    .run(id, req.uid, category, String(title).slice(0, 200), String(url).slice(0, 500), "pending", "Queued", Date.now());
  setImmediate(() => runJob(id, req.uid, cat, String(title), imageUrls.map(String), scene));
  res.json({ id });
});

app.get("/api/tryon/:id", (req, res) => {
  const r = db.prepare("SELECT status, stage, error FROM results WHERE id=? AND user_id=?").get(req.params.id, req.uid);
  r ? res.json(r) : res.sendStatus(404);
});

app.get("/api/tryon/:id/image", (req, res) => {
  const r = db.prepare("SELECT file FROM results WHERE id=? AND user_id=? AND status='done'").get(req.params.id, req.uid);
  if (!r) return res.sendStatus(404);
  res.set("Cache-Control", "private, max-age=3600").sendFile(r.file);
});

app.get("/api/results", (req, res) =>
  res.json(db.prepare("SELECT id, category, title, url, created FROM results WHERE user_id=? AND status='done' ORDER BY created DESC LIMIT 100").all(req.uid)));

app.delete("/api/results/:id", (req, res) => {
  const r = db.prepare("SELECT file FROM results WHERE id=? AND user_id=?").get(req.params.id, req.uid);
  if (r) { rmFile(r.file); db.prepare("DELETE FROM results WHERE id=?").run(req.params.id); }
  res.json({ ok: true });
});

app.delete("/api/results", (req, res) => {
  db.prepare("SELECT file FROM results WHERE user_id=?").all(req.uid).forEach((r) => rmFile(r.file));
  db.prepare("DELETE FROM results WHERE user_id=?").run(req.uid);
  res.json({ ok: true });
});

// ---------- Job pipeline ----------
async function runJob(id, uid, cat, title, urls, scene) {
  const stage = (s) => db.prepare("UPDATE results SET stage=? WHERE id=?").run(s, id);
  try {
    stage("Fetching product images");
    const product = await Promise.all(urls.map(safeFetchImage));
    const people = cat.slots.map((s) =>
      fs.readFileSync(db.prepare("SELECT file FROM photos WHERE user_id=? AND slot=?").get(uid, s).file));

    stage("Generating your try-on");
    const parts = [{ text: buildPrompt(cat, people.length, product.length, scene, title) },
      ...[...people, ...product].map((b) => ({ inlineData: { mimeType: "image/jpeg", data: b.toString("base64") } }))];
    const img = await generate(parts);

    const file = path.join(DATA, "results", id + ".jpg");
    fs.writeFileSync(file, await sharp(img).jpeg({ quality: 90 }).toBuffer());
    db.prepare("UPDATE results SET status='done', stage='Done', file=? WHERE id=?").run(file, id);
  } catch (e) {
    console.error("job failed", id, e.message);
    db.prepare("UPDATE results SET status='error', error=? WHERE id=?").run(friendly(e.message), id);
  }
}

const friendly = (m) => /blocked host|bad url/.test(m) ? "That product image can't be used."
  : /timeout|fetch failed/i.test(m) ? "Network problem, please try again."
  : /no image/i.test(m) ? "The AI could not produce an image for this product. Try another product image."
  : "Generation failed. Please try again.";

function buildPrompt(cat, nPerson, nProd, scene, title) {
  return `You are a virtual try-on system. The first ${nPerson} image(s) are reference photos of the SAME real person. The last ${nProd} image(s) show the product "${title}".
TASK: ${cat.instruction}
RULES:
- Preserve the person's face, identity, skin tone, hair and body shape exactly.
- Reproduce the product faithfully: exact colors, patterns, prints, logos, proportions. Do not substitute a generic item.
- Natural fit, lighting, shadows, fabric drape and perspective. Do not just paste the product image.
- ${scene === "auto"
    ? "Place the person in a realistic environment and pose that suits the product (e.g. beach for beachwear, city street for jackets)."
    : "Use a clean neutral studio background."}
Output a single photorealistic image.`;
}

async function generate(parts) {
  let last;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": KEY },
        body: JSON.stringify({ contents: [{ parts }], generationConfig: { responseModalities: ["TEXT", "IMAGE"] } }),
        signal: AbortSignal.timeout(120000),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error?.message || "AI error " + r.status);
      const p = j.candidates?.[0]?.content?.parts?.find((x) => x.inlineData || x.inline_data);
      const d = p?.inlineData?.data || p?.inline_data?.data;
      if (!d) throw new Error("no image returned");
      return Buffer.from(d, "base64");
    } catch (e) { last = e; }
  }
  throw last;
}

// ---------- Safe product image fetch (SSRF guard + cache) ----------
function isPrivate(ip) {
  if (net.isIPv6(ip)) return ip === "::1" || /^(fc|fd|fe80)/i.test(ip) || /^::ffff:(127|10|192\.168|169\.254)/i.test(ip);
  const [a, b] = ip.split(".").map(Number);
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

async function safeFetchImage(u) {
  const cacheFile = path.join(DATA, "cache", sha(u) + ".jpg");
  if (fs.existsSync(cacheFile)) return fs.readFileSync(cacheFile);
  let url = new URL(u), res;
  for (let hop = 0; hop < 4; hop++) {
    if (!/^https?:$/.test(url.protocol)) throw new Error("bad url");
    const addrs = await dns.lookup(url.hostname, { all: true });
    if (addrs.some((a) => isPrivate(a.address))) throw new Error("blocked host");
    res = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(15000),
      headers: { "User-Agent": "Mozilla/5.0 TryOnBot", Accept: "image/*" } });
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) { url = new URL(res.headers.get("location"), url); continue; }
    break;
  }
  if (!res.ok) throw new Error("product image fetch failed");
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > 8 * 1024 * 1024) throw new Error("image too large");
  const out = await sharp(buf).flatten({ background: "#ffffff" })
    .resize(1024, 1024, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 88 }).toBuffer();
  fs.writeFileSync(cacheFile, out);
  return out;
}

app.listen(PORT, () => console.log(`Try-on backend on http://localhost:${PORT}`));
