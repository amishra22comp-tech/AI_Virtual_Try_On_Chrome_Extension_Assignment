// Injected on demand into the active tab (activeTab + scripting; no broad host access).
// Generic detection: JSON-LD -> OpenGraph -> image/card heuristics. Not tied to any one site.
(() => {
  const abs = (u) => { try { const a = new URL(u, location.href).href; return /^https?:/.test(a) ? a : null; } catch { return null; } };
  const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
  const crumbs = clean(document.querySelector('[class*="breadcrumb" i], nav[aria-label*="breadcrumb" i]')?.textContent);
  const out = [], seen = new Set();

  const add = (p) => {
    p.images = [...new Set((p.images || []).map(abs).filter(Boolean))];
    if (!p.images.length || seen.has(p.images[0])) return;
    seen.add(p.images[0]);
    p.title = clean(p.title).slice(0, 140) || clean(document.title);
    p.text = `${p.title} ${p.text || ""} ${crumbs} ${location.pathname}`.toLowerCase();
    p.url = abs(p.url) || location.href;
    out.push(p);
  };

  const bestSrc = (img) => {
    const ss = img.srcset || img.dataset.srcset;
    if (ss) {
      const c = ss.split(",").map((s) => s.trim().split(/\s+/)).sort((a, b) => parseFloat(b[1] || 0) - parseFloat(a[1] || 0));
      if (c[0]?.[0]) return c[0][0];
    }
    return img.currentSrc || img.src || img.dataset.src || img.dataset.lazySrc;
  };

  const bigImages = (min) => [...document.images].map((img) => ({ img, r: img.getBoundingClientRect(), src: bestSrc(img) }))
    .filter((x) => x.src && !x.src.startsWith("data:") && x.r.width >= min && x.r.height >= min &&
      !/logo|sprite|icon|banner|avatar|placeholder|payment/i.test(x.src + (x.img.alt || "")));

  // 1) Structured data (schema.org Product)
  const walk = (n) => {
    if (!n || typeof n !== "object") return;
    if (Array.isArray(n)) return n.forEach(walk);
    const t = [].concat(n["@type"] || []);
    if (t.includes("Product") || t.includes("ProductGroup")) {
      const imgs = [].concat(n.image || []).map((i) => (typeof i === "string" ? i : i?.url || i?.contentUrl));
      const o = [].concat(n.offers || [])[0] || {};
      const price = o.price || o.lowPrice;
      add({ title: n.name, images: imgs, price: price ? `${o.priceCurrency || ""} ${price}`.trim() : "",
        text: `${n.category || ""} ${n.description || ""}`, url: n.url, source: "json-ld" });
    }
    Object.values(n).forEach((v) => typeof v === "object" && walk(v));
  };
  document.querySelectorAll('script[type="application/ld+json"]').forEach((s) => { try { walk(JSON.parse(s.textContent)); } catch {} });

  // 2) OpenGraph product page
  const meta = (p) => document.querySelector(`meta[property="${p}"], meta[name="${p}"]`)?.content;
  if (!out.length && /product/i.test(meta("og:type") || "") && meta("og:image")) {
    const amt = meta("product:price:amount");
    add({ title: meta("og:title"), images: [meta("og:image")], text: meta("og:description") || "",
      price: amt ? `${meta("product:price:currency") || ""} ${amt}`.trim() : "", source: "opengraph" });
  }

  // 3) Heuristic: product cards on listing pages
  if (!out.length) {
    bigImages(120).forEach(({ img, src }) => {
      const card = img.closest('li, article, [class*="product" i], [class*="card" i], [class*="item" i]') || img.parentElement;
      const a = img.closest("a") || card?.querySelector("a[href]");
      const title = clean(img.alt || card?.querySelector('h1,h2,h3,h4,[class*="title" i],[class*="name" i]')?.textContent);
      const price = (clean(card?.textContent).match(/(?:₹|Rs\.?|\$|€|£)\s?[\d,]+(?:\.\d+)?/) || [""])[0];
      add({ title, images: [src], price, text: a?.href || "", url: a?.href, source: "heuristic" });
    });
  }

  // Single product page: add gallery images so the user can pick the best variant/angle
  if (out.length === 1) {
    const extra = bigImages(300).sort((a, b) => b.r.width * b.r.height - a.r.width * a.r.height).map((x) => x.src);
    out[0].images = [...new Set([...out[0].images, ...extra.map(abs).filter(Boolean)])].slice(0, 8);
  }

  return { page: { title: document.title, url: location.href }, products: out.slice(0, 30) };
})();
