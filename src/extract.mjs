// Dos formas de extraer precio, segun el tipo de pagina de samsung.com/cl:
//
// 1) Paginas "familia" (.../buy/, ej. galaxy-s25/buy/): agrupan varias
//    variantes (color x capacidad) bajo una sola URL. El precio de CADA
//    variante viene servido en el HTML plano dentro de bloques JSON-LD
//    (schema.org/Product + Offer) -- no hace falta navegador.
//
// 2) Paginas de producto individual (el resto del listado): el precio NO
//    esta en el HTML servido por el servidor; se arma en el navegador via
//    JavaScript y queda expuesto en window.digitalData.product (el mismo
//    objeto que usa Samsung para su propio analytics). Confirmado con
//    reconocimiento manual 2026-07-19: ni curl ni fetch() directo lo traen,
//    solo una navegacion real de pagina -- por eso este camino requiere
//    Playwright, igual que ya usamos en El Cazador para bci/bancoripley/claro.
import { filtrarEspecificacionesUtiles } from "./titulo.mjs";

function modelCodeFromOfferUrl(offerUrl) {
  if (!offerUrl) return null;
  const idx = offerUrl.indexOf("?");
  return idx === -1 ? null : offerUrl.slice(idx + 1);
}

export function extractFamilyVariants(html) {
  const blocks = [...html.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)];
  const variants = [];

  for (const block of blocks) {
    let data;
    try {
      data = JSON.parse(block[1]);
    } catch {
      continue;
    }
    const topLevel = Array.isArray(data) ? data : [data];
    // el precio vive en items "Product" sueltos (offers directo), o anidado
    // dentro de un "ProductGroup" -> hasVariant[] (una entrada por color/capacidad)
    const items = topLevel.flatMap((item) =>
      item["@type"] === "ProductGroup" && Array.isArray(item.hasVariant)
        ? item.hasVariant
        : [item],
    );
    for (const item of items) {
      if (item["@type"] !== "Product" || !item.offers) continue;
      const offer = item.offers;
      const modelCode = modelCodeFromOfferUrl(offer.url) || item.sku;
      const precio = Number(offer.price);
      if (!modelCode || !offer.price || !Number.isFinite(precio) || precio <= 0) continue;
      variants.push({
        modelo: modelCode,
        nombre: item.name || null,
        precio,
        moneda: offer.priceCurrency || "CLP",
        disponible: offer.availability
          ? offer.availability.includes("InStock")
          : null,
        url: offer.url,
      });
    }
  }

  // dedupe por modelo (a veces el mismo Offer aparece repetido en varios bloques)
  const porModelo = new Map();
  for (const v of variants) porModelo.set(v.modelo, v);
  // el diccionario del buy-box de la pagina familia trae a TODOS los SKU
  // hermanos, asi que cada variante toma sus propias especificaciones del HTML
  // que ya se descargo: cero requests extra.
  return [...porModelo.values()].map((v) => ({
    ...v,
    especificaciones: filtrarEspecificacionesUtiles(especificacionesDesdeHtml(html, v.modelo)),
  }));
}

const STOCK_NEGATIVO = /agotado|no disponible|fuera de stock|sin stock/i;

// Especificaciones POR SKU. Samsung las publica en dos lugares del HTML ya
// servido, ambos indexados por el codigo de modelo real, asi que no hay
// ambiguedad de variante (verificado en vivo 2026-07-29 sobre paginas de
// smartphone, tablet, reloj, notebook, TV, monitor, refrigerador y secadora):
//  1. el input oculto #BV-buyingOptionData: un diccionario SKU -> {Color,
//     Almacenamiento, RAM, ...}. Trae ademas los SKU hermanos de la familia.
//  2. el acordeon .pdd32-product-spec: unica fuente de la RAM de celulares y
//     tablets ("Memoria_(GB)": "12").
// Costo medido: 1 a 34 ms por pagina y CERO requests extra (el HTML ya esta
// cargado para leer el precio). No se usa page.content() a proposito: medido
// 290 ms por pagina, 12 veces mas caro.
function leerDiccionarioPorSku(dicc, sku) {
  if (!dicc || typeof dicc !== "object" || !sku) return {};
  const entrada = Object.prototype.hasOwnProperty.call(dicc, sku) ? dicc[sku] : null;
  if (!entrada || typeof entrada !== "object") return {};
  return entrada;
}

async function leerEspecificaciones(page, sku) {
  return page.evaluate((skuBuscado) => {
    const salida = {};
    const limpiar = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
    try {
      const input = document.getElementById("BV-buyingOptionData");
      if (input?.value) {
        const dicc = JSON.parse(input.value);
        const entrada = skuBuscado && Object.prototype.hasOwnProperty.call(dicc ?? {}, skuBuscado) ? dicc[skuBuscado] : null;
        if (entrada && typeof entrada === "object") {
          for (const [k, v] of Object.entries(entrada)) {
            const campo = limpiar(k);
            const valor = limpiar(v);
            if (campo && valor) salida[campo] = valor;
          }
        }
      }
    } catch {
      // sin buy-box legible: se sigue con el acordeon
    }
    try {
      const cont = document.querySelector(".pdd32-product-spec");
      for (const item of cont?.querySelectorAll(".pdd32-product-spec__content-item") ?? []) {
        const campo = limpiar(item.querySelector(".pdd32-product-spec__content-item-title")?.textContent);
        const valor = limpiar(item.querySelector(".pdd32-product-spec__content-item-desc")?.textContent);
        if (campo && valor && !Object.prototype.hasOwnProperty.call(salida, campo)) salida[campo] = valor;
      }
    } catch {
      // sin acordeon: se devuelve lo que haya
    }
    return salida;
  }, sku);
}

// En las paginas familia no hay navegador (se resuelven con fetch plano), pero el
// mismo diccionario viene en el HTML: se lee del atributo value, que llega
// escapado como &#34; / &quot;.
export function especificacionesDesdeHtml(html, sku) {
  const m = /id="BV-buyingOptionData"[^>]*\svalue="([^"]*)"/i.exec(html || "");
  if (!m) return {};
  const crudo = m[1]
    .replace(/&(?:#34|quot);/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
  try {
    return leerDiccionarioPorSku(JSON.parse(crudo), sku);
  } catch {
    return {};
  }
}

export async function extractSingleProduct(page, url) {
  const digitalData = await page.evaluate(() => {
    try {
      return window.digitalData?.product ?? null;
    } catch {
      return null;
    }
  });

  const precio = digitalData ? Number(digitalData.model_price) : NaN;
  if (!digitalData || !Number.isFinite(precio) || precio <= 0) {
    // pagina sin precio (categoria/descontinuada), o el propio Samsung trae
    // "NaN" como model_price (visto en productos "combo"/bundle) -- en
    // ambos casos se trata como "sin precio", nunca se guarda un numero invalido.
    return null;
  }

  const bodyText = await page.evaluate(() => document.body.innerText).catch(() => "");
  const disponible = !STOCK_NEGATIVO.test(bodyText);

  const modelo = digitalData.model_code || null;
  // El precio ya esta a salvo en este punto: si la lectura de especificaciones
  // fallara (selector que Samsung cambie, HTML raro), el .catch la deja en null y
  // la corrida sigue con el titulo que se pueda armar del slug. Nunca puede
  // costar un aviso de precio.
  const especCrudas = await leerEspecificaciones(page, modelo).catch(() => null);

  return {
    modelo,
    nombre: digitalData.displayName || null,
    precio,
    moneda: "CLP",
    disponible,
    url,
    especificaciones: filtrarEspecificacionesUtiles(especCrudas),
  };
}
