// Descubre paginas "familia" (ej. /smartphones/galaxy-s25/buy/) que no vienen
// en el listado seed.json porque una sola URL agrupa varias variantes
// (color/capacidad) y por eso nadie las linkea individualmente.
import { SITEMAPS, USER_AGENT } from "./config.mjs";

async function fetchText(url) {
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) return null;
  return res.text();
}

function extractLocs(xml) {
  const matches = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)];
  return matches.map((m) => m[1]);
}

export async function discoverFamilyUrls(seedUrls) {
  const seedSet = new Set(seedUrls);
  const found = new Set();

  for (const sitemapUrl of SITEMAPS) {
    const xml = await fetchText(sitemapUrl);
    if (!xml) continue;
    for (const loc of extractLocs(xml)) {
      if (!loc.endsWith("/buy/")) continue;
      if (seedSet.has(loc)) continue;
      found.add(loc);
    }
  }

  return [...found].map((url) => ({
    categoria: "Familia (auto-descubierta)",
    subcategoria: null,
    nombre: null,
    variante: null,
    modelo: null,
    url,
    tipo: "familia",
  }));
}
