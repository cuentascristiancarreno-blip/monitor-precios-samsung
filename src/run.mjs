import { readFile, writeFile, appendFile, mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { DELAY_MS, USER_AGENT } from "./config.mjs";
import { discoverFamilyUrls } from "./discover.mjs";
import { extractFamilyVariants, extractSingleProduct } from "./extract.mjs";
import { notifyDiscord } from "./discord.mjs";

const DATA_DIR = new URL("../data/", import.meta.url);
const LATEST_PATH = new URL("latest.json", DATA_DIR);
const HISTORY_PATH = new URL("history.jsonl", DATA_DIR);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function readJsonSafe(url, fallback) {
  try {
    return JSON.parse(await readFile(url, "utf-8"));
  } catch {
    return fallback;
  }
}

async function fetchFamilyPage(url) {
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return extractFamilyVariants(await res.text());
}

async function main() {
  await mkdir(DATA_DIR, { recursive: true });

  const seedRaw = JSON.parse(await readFile(new URL("seed.json", import.meta.url), "utf-8"));
  const seedUrls = seedRaw.map((r) => r.url);
  const familyEntries = await discoverFamilyUrls(seedUrls);
  const entries = [...seedRaw, ...familyEntries];

  console.log(`Total paginas a revisar: ${entries.length} (${seedRaw.length} del listado + ${familyEntries.length} familia auto-descubiertas)`);

  const previous = await readJsonSafe(LATEST_PATH, {});
  const current = {};
  let errores = 0;
  const timestamp = new Date().toISOString();

  const browser = await chromium.launch();
  const context = await browser.newContext({ userAgent: USER_AGENT });

  try {
    for (const entry of entries) {
      try {
        let variants;
        if (entry.url.endsWith("/buy/")) {
          variants = await fetchFamilyPage(entry.url);
        } else {
          const page = await context.newPage();
          try {
            await page.goto(entry.url, { waitUntil: "load", timeout: 30000 });
            const single = await extractSingleProduct(page, entry.url);
            variants = single ? [single] : [];
          } finally {
            await page.close();
          }
        }

        for (const v of variants) {
          if (!v.modelo) continue;
          current[v.modelo] = {
            ...v,
            categoria: entry.categoria,
            subcategoria: entry.subcategoria,
            paginaOrigen: entry.url,
            ultimaRevision: timestamp,
          };
        }

        if (variants.length === 0) {
          console.log(`SIN_PRECIO ${entry.url}`);
        }
      } catch (err) {
        errores++;
        console.error(`ERROR ${entry.url}: ${err.message}`);
      }

      await sleep(DELAY_MS);
    }
  } finally {
    await browser.close();
  }

  const changes = [];
  for (const [modelo, record] of Object.entries(current)) {
    const prev = previous[modelo];
    if (!prev) {
      changes.push({ tipo: "nuevo", modelo, nombre: record.nombre, precio: record.precio, categoria: record.categoria, url: record.url });
      continue;
    }
    if (!Number.isFinite(prev.precio)) {
      // el precio anterior quedo corrupto (dato viejo previo a este fix) --
      // se trata como si recien se conociera el precio, no como sube/baja.
      changes.push({ tipo: "nuevo", modelo, nombre: record.nombre, precio: record.precio, categoria: record.categoria, url: record.url });
    } else if (prev.precio !== record.precio) {
      changes.push({
        tipo: record.precio < prev.precio ? "baja" : "sube",
        modelo,
        nombre: record.nombre,
        precio: record.precio,
        precioAnterior: prev.precio,
        categoria: record.categoria,
        url: record.url,
      });
    }
    if (prev.disponible !== record.disponible && record.disponible !== null && prev.disponible !== null) {
      changes.push({
        tipo: "stock",
        modelo,
        nombre: record.nombre,
        disponible: record.disponible,
        disponibleAnterior: prev.disponible,
        precio: record.precio,
        categoria: record.categoria,
        url: record.url,
      });
    }
  }
  for (const [modelo, prev] of Object.entries(previous)) {
    if (!current[modelo]) {
      changes.push({ tipo: "eliminado", modelo, nombre: prev.nombre, precioAnterior: prev.precio, categoria: prev.categoria, url: prev.url });
    }
  }

  const esAccesorio = (categoria) => (categoria || "").toLowerCase().startsWith("accesorio");
  const changesParaDiscord = changes.filter((c) => !esAccesorio(c.categoria));

  await writeFile(LATEST_PATH, JSON.stringify(current, null, 1));

  const historyLines = Object.values(current)
    .map((r) => JSON.stringify({ ts: timestamp, ...r }))
    .join("\n");
  if (historyLines) await appendFile(HISTORY_PATH, historyLines + "\n");

  console.log(`Listo. ${Object.keys(current).length} productos con precio, ${changes.length} cambios, ${errores} errores.`);

  await notifyDiscord(process.env.DISCORD_WEBHOOK_URL, {
    changes: changesParaDiscord,
    errores,
    totalRevisado: entries.length,
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
