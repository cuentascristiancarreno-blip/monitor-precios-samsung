import { readFile, writeFile, appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { DELAY_MS, USER_AGENT } from "./config.mjs";
import { discoverFamilyUrls } from "./discover.mjs";
import { extractFamilyVariants, extractSingleProduct, RE_API_PRODUCTOS } from "./extract.mjs";
import { comparar } from "./comparar.mjs";
import { integrarVariantes, esAccesorio } from "./catalogo.mjs";
import { estaSilenciado, resumirSilenciados } from "./silenciados.mjs";
import { notifyDiscord, notifyTecnico } from "./discord.mjs";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
// CARPETA_DATOS permite correr pruebas completas sin tocar los datos reales
const DATA_DIR = process.env.CARPETA_DATOS || path.join(AQUI, "..", "data");
const LATEST_PATH = path.join(DATA_DIR, "latest.json");
const HISTORY_PATH = path.join(DATA_DIR, "history.jsonl");
const EJECUCIONES_PATH = path.join(DATA_DIR, "ejecuciones.jsonl");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function readJsonSafe(p, fallback) {
  try {
    return JSON.parse(await readFile(p, "utf-8"));
  } catch {
    return fallback;
  }
}

// Una pagina puede resolverse por dos caminos:
//  1) paginas familia (/buy/ de celulares): variantes con precio en el JSON-LD
//     del HTML plano -- barato, sin navegador.
//  2) el resto (y las /buy/ que no traen ese JSON-LD, ej. Galaxy Book): el
//     precio solo existe tras render real -> Playwright + digitalData.
// Devuelve tambien POR CUAL camino se resolvio: los nombres del JSON-LD de la
// pagina familia traen capacidad/RAM/color y sirven para el titulo, los de
// digitalData no (ver src/titulo.mjs).
async function procesarEntrada(entry, context, timeoutMs) {
  let variants = [];
  if (entry.url.endsWith("/buy/")) {
    try {
      const res = await fetch(entry.url, { headers: { "User-Agent": USER_AGENT } });
      if (res.ok) variants = extractFamilyVariants(await res.text());
    } catch {
      // cae al camino del navegador
    }
  }
  if (variants.length > 0) return { variants, via: "familia" };

  const page = await context.newPage();
  // Se escucha (sin pedir nada) la respuesta que la propia pagina le hace a la
  // API de Samsung: es la unica fuente con el precio de CADA producto cuando una
  // pagina expone varios. Cero requests extra.
  const respuestasApi = [];
  page.on("response", (res) => {
    if (!RE_API_PRODUCTOS.test(res.url())) return;
    res
      .json()
      .then((cuerpo) => respuestasApi.push(cuerpo))
      .catch(() => {});
  });
  try {
    await page.goto(entry.url, { waitUntil: "load", timeout: timeoutMs });
    const salida = await extractSingleProduct(page, entry.url, respuestasApi);
    variants = Array.isArray(salida) ? salida : salida ? [salida] : [];
  } finally {
    await page.close();
  }
  return { variants, via: "individual" };
}

async function main() {
  const inicio = new Date();
  const timestamp = inicio.toISOString();
  await mkdir(DATA_DIR, { recursive: true });

  const seedRaw = JSON.parse(await readFile(path.join(AQUI, "seed.json"), "utf-8"));
  let familyEntries = [];
  if (!process.env.SIN_DESCUBRIMIENTO) {
    try {
      familyEntries = await discoverFamilyUrls(seedRaw.map((r) => r.url));
    } catch (err) {
      console.error(`WARNING descubrimiento de paginas familia fallo: ${err.message}`);
    }
  }

  let entries = [...seedRaw, ...familyEntries];
  const urlsVistas = new Set();
  entries = entries.filter((e) => e.url && !urlsVistas.has(e.url) && urlsVistas.add(e.url));
  const limite = Number(process.env.LIMITE_PAGINAS);
  if (Number.isFinite(limite) && limite > 0) entries = entries.slice(0, limite);

  console.log(`INFO paginas=${entries.length} (listado=${seedRaw.length}, familia=${familyEntries.length})`);

  const previo = await readJsonSafe(LATEST_PATH, {});
  const observado = {};
  let fallidas = [];

  const integrar = (entry, variants, via) =>
    integrarVariantes(observado, entry, variants, { via, timestamp });

  const browser = await chromium.launch();
  const context = await browser.newContext({ userAgent: USER_AGENT });
  try {
    for (const entry of entries) {
      try {
        const { variants, via } = await procesarEntrada(entry, context, 30000);
        integrar(entry, variants, via);
        if (variants.length === 0) console.log(`INFO sin_precio ${entry.url}`);
      } catch (err) {
        console.error(`ERROR intento=1 ${entry.url}: ${err.message}`);
        fallidas.push(entry);
      }
      await sleep(DELAY_MS);
    }

    // reintento unico con mas timeout: recupera la mayoria de los 10-30
    // timeouts esporadicos por corrida que antes se daban por perdidos
    const fallidasFinal = [];
    for (const entry of fallidas) {
      try {
        const { variants, via } = await procesarEntrada(entry, context, 45000);
        integrar(entry, variants, via);
        console.log(`INFO reintento_ok ${entry.url}`);
      } catch (err) {
        console.error(`ERROR intento=2 ${entry.url}: ${err.message}`);
        fallidasFinal.push(entry);
      }
      await sleep(DELAY_MS);
    }
    fallidas = fallidasFinal;
  } finally {
    await browser.close();
  }

  // una corrida sospechosa NO puede declarar productos desaparecidos ni
  // gatillar avisos masivos: conserva el ultimo estado confiable
  const encontrados = Object.keys(observado).length;
  const prevRelevantes = Object.values(previo).filter((r) => r.presencia !== "desaparecido").length;
  const motivos = [];
  if (fallidas.length > Math.max(5, entries.length * 0.1)) {
    motivos.push(`demasiadas paginas con error (${fallidas.length} de ${entries.length})`);
  }
  if (prevRelevantes > 0 && encontrados < prevRelevantes * 0.8) {
    motivos.push(`se encontraron muchos menos productos que la vez anterior (${encontrados} vs ${prevRelevantes})`);
  }
  if (encontrados === 0) motivos.push("no se encontro ningun producto");
  const corridaConfiable = motivos.length === 0;

  const { catalogo, cambios } = comparar({
    previo,
    observado,
    paginasFallidas: new Set(fallidas.map((f) => f.url)),
    corridaConfiable,
    timestamp,
  });

  await writeFile(LATEST_PATH, JSON.stringify(catalogo, null, 1));

  // history.jsonl registra EVENTOS de cambio (lineas con campo "tipo").
  // El snapshot completo de cada corrida ya queda en el historial git de
  // latest.json -- duplicarlo aqui hacia crecer el repo ~2.5MB/dia.
  if (cambios.length > 0) {
    await appendFile(HISTORY_PATH, cambios.map((c) => JSON.stringify({ ts: timestamp, ...c })).join("\n") + "\n");
  }

  const fin = new Date();
  const porTipo = (t) => cambios.filter((c) => c.tipo === t).length;
  const resumen = {
    inicio: timestamp,
    fin: fin.toISOString(),
    duracionMin: Math.round((fin - inicio) / 60000),
    paginas: entries.length,
    errores: fallidas.length,
    urlsConError: fallidas.slice(0, 20).map((f) => f.url),
    productosEncontrados: encontrados,
    nuevos: porTipo("nuevo"),
    bajas: porTipo("baja"),
    subes: porTipo("sube"),
    cambiosStock: porTipo("stock"),
    desaparecidos: porTipo("desaparecido"),
    recuperados: porTipo("recuperado"),
    confiable: corridaConfiable,
    motivos,
  };
  await appendFile(EJECUCIONES_PATH, JSON.stringify(resumen) + "\n");
  console.log(`INFO resumen ${JSON.stringify(resumen)}`);

  // El filtro de notificacion va DESPUES de escribir catalogo e historial: los
  // productos filtrados siguen vigilados y con su historial de precios completo,
  // solo se omite el mensaje de Discord (ver silenciados.mjs).
  const silenciados = resumirSilenciados(cambios);
  for (const [regla, n] of silenciados) console.log(`INFO silenciados regla=${regla} avisos=${n}`);
  const cambiosParaDiscord = cambios.filter((c) => !esAccesorio(c.categoria) && !estaSilenciado(c));

  const webhook = process.env.DISCORD_WEBHOOK_URL;
  if (!corridaConfiable) {
    await notifyTecnico(
      webhook,
      `⚠️ **Monitor Samsung — revisión marcada como NO confiable**\n${motivos.join("; ")}.\nNo se marcaron productos como desaparecidos y se conservó el último estado confiable. Revisar los logs de la corrida en GitHub Actions.`,
    );
  }
  await notifyDiscord(webhook, {
    changes: cambiosParaDiscord,
    errores: fallidas.length,
    totalRevisado: entries.length,
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
