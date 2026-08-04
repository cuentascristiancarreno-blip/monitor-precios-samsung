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

// Samsung NO trae el precio en el HTML: la pagina se lo pide a
// api.shop.samsung.com y hasta que responde, digitalData.model_price vale el
// relleno "0,0" (un cero por cada producto que la pagina agrupa). Medido: el
// evento "load" ocurre a los 739 ms y el precio llega a los 827 ms -- 88 ms
// tarde. Leer sin esperar hacia que el producto se diera por inexistente, y a
// las 2 corridas se anunciaba "desaparecido" (el ciclo del Book3: 48 avisos
// falsos). El numero tambien puede venir con coma decimal.
// 3 s es 34 veces la carrera medida (88 ms) y mantiene la corrida bajo el limite
// de 4 h del job. Con 8 s la corrida se pasaba de las 4 h y GitHub la mataba
// SIN dejar datos ni avisos: hay ~150 paginas que legitimamente no publican
// precio (accesorios, kits) y cada una pagaba la espera completa DOS veces, por
// la espera mas el reintento. Incidente del 2026-08-02, ver BITACORA.md.
const PRECIO_TIMEOUT_MS = 3000;

function aNumero(valor) {
  return Number(String(valor ?? "").replace(",", "."));
}

// ¿Esta este monto escrito en la pagina, con el formato chileno ($ 974.980)?
function montoVisible(monto, texto) {
  if (!Number.isFinite(monto) || monto <= 0 || !texto) return false;
  const formateado = new Intl.NumberFormat("es-CL").format(Math.round(monto));
  return texto.replace(/\s/g, "").includes(formateado);
}

/**
 * Elige el precio que el cliente realmente ve. Ver el comentario largo en
 * extractSingleProduct: hay productos donde model_price es un numero interno que
 * no aparece en la ficha y el precio de venta esta en list_price.
 */
export function precioVisiblePreferido(modelPrice, listPrice, texto) {
  if (!Number.isFinite(listPrice) || listPrice <= 0) return modelPrice;
  if (montoVisible(modelPrice, texto)) return modelPrice;
  if (montoVisible(listPrice, texto)) return listPrice;
  return modelPrice;
}

// Hay paginas que exponen VARIOS productos a la vez. En esas,
// digitalData.product.model_code viene con los codigos pegados
// ("NP750QFG-KB2CL,NP750XFG-KB4CL") y displayName con los nombres separados por
// ";". Guardar eso como un solo producto significa vigilar 2 a 4 equipos con un
// unico precio: medido, 4 fichas asi escondian 10 productos reales, y la pagina
// del Book3 360 publica 4 precios distintos ($1.399.990, $849.990, $749.990 y
// $1.299.991) de los que el monitor guardaba uno.
export const RE_API_PRODUCTOS = /tokocommercewebservices.*\/products/i;

/**
 * Indexa por SKU las respuestas que la PROPIA pagina le pide a la API de
 * Samsung. No se hace ningun request extra: run.mjs solo escucha lo que el
 * navegador ya recibe, asi que no cambia la carga sobre el sitio.
 */
export function productosDesdeApi(respuestas) {
  const porCodigo = new Map();
  for (const cuerpo of respuestas ?? []) {
    const lista = cuerpo?.products ?? cuerpo?.productList ?? (Array.isArray(cuerpo) ? cuerpo : null);
    if (!Array.isArray(lista)) continue;
    for (const p of lista) {
      const codigo = p?.code ?? p?.sku;
      if (!codigo) continue;
      const precio = aNumero(p?.price?.value ?? p?.priceValue ?? p?.price);
      if (!Number.isFinite(precio) || precio <= 0) continue;
      // la primera respuesta con precio valido gana (algunas llegan sin precio)
      if (!porCodigo.has(codigo)) porCodigo.set(codigo, { precio });
    }
  }
  return porCodigo;
}

/**
 * Devuelve UN registro, o un ARRAY de registros cuando la pagina expone varios
 * productos (ver mas abajo). run.mjs normaliza ambos casos.
 * @param respuestasApi cuerpos JSON que la pagina ya le pidio a la API de
 *   Samsung, capturados por run.mjs. Sin ellos, una pagina con varios productos
 *   se trata como fallida en vez de guardar una ficha fusionada.
 */
export async function extractSingleProduct(page, url, respuestasApi = []) {
  try {
    await page.waitForFunction(
      () => {
        const p = window.digitalData?.product?.model_price;
        const n = Number(String(p ?? "").replace(",", "."));
        return Number.isFinite(n) && n > 0;
      },
      { timeout: PRECIO_TIMEOUT_MS },
    );
  } catch {
    // se agoto la espera: puede ser un producto realmente dado de baja (los
    // monitores descontinuados dejan model_price en "" para siempre) o una
    // pagina lenta. Quien decide es el bloque de abajo, con el dato en mano.
  }

  const digitalData = await page.evaluate(() => {
    try {
      return window.digitalData?.product ?? null;
    } catch {
      return null;
    }
  });

  const precio = digitalData ? aNumero(digitalData.model_price) : NaN;
  if (!digitalData || !Number.isFinite(precio) || precio <= 0) {
    // Solo se protege (lanzando, para que la pagina cuente como fallida) cuando
    // el precio TODAVIA parece estar cargando. La marca medida en vivo es un
    // relleno con coma -- "0,0" es lo que publica una pagina multi-producto
    // mientras espera a api.shop.samsung.com, y es justo el caso del Book3.
    // Las paginas que simplemente NO tienen precio traen un valor permanente
    // ("NaN" en el filtro de purificador, "0" en el kit receptor) y devuelven
    // null como siempre: sin lanzar y sin reintento, que era lo que hacia que
    // la corrida se pasara de las 4 h.
    const pareceCargando = /,/.test(String(digitalData?.model_price ?? ""));
    if (digitalData?.model_code && pareceCargando) {
      throw new Error(`precio no disponible tras ${PRECIO_TIMEOUT_MS} ms (model_code=${digitalData.model_code})`);
    }
    // sin producto identificable: pagina de categoria, redireccion de baja, o el
    // "NaN" que el propio Samsung publica en algunos combos.
    return null;
  }

  const bodyText = await page.evaluate(() => document.body.innerText).catch(() => "");
  const disponible = !STOCK_NEGATIVO.test(bodyText);

  // El precio que se vigila tiene que ser el que el cliente VE. Medido el
  // 2026-08-03 en el pack "Watch Ultra (2025) Blue + Galaxy Buds4 Pro"
  // (F-SMR640SML70): digitalData publicaba model_price=555980, un numero que NO
  // aparece en ninguna parte de la pagina, mientras el cliente veia $974.980
  // (= list_price). El monitor avisaba bajadas de un precio inexistente.
  // Regla: si el model_price no esta escrito en la pagina pero el list_price si,
  // gana el list_price. Verificado sobre 8 paginas (4 packs y 4 productos
  // normales): solo ese pack cae en la excepcion; en los otros 7 el model_price
  // es el visible y no se toca nada. Si NINGUNO de los dos esta visible (pagina
  // a medio renderizar) no se cambia nada, para no inventar un precio.
  const precioFinal = precioVisiblePreferido(precio, aNumero(digitalData.list_price), bodyText);

  const modelo = digitalData.model_code || null;
  const codigos = String(modelo ?? "")
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);

  // pagina con varios productos: se emite uno por SKU, con SU precio y SUS
  // especificaciones (el diccionario del buy-box tambien esta indexado por SKU)
  if (codigos.length > 1) {
    const porCodigo = productosDesdeApi(respuestasApi);
    const nombres = String(digitalData.displayName ?? "").split(";").map((n) => n.trim());
    const salida = [];
    for (const [i, codigo] of codigos.entries()) {
      const datos = porCodigo.get(codigo);
      // sin precio propio no se inventa nada: ese SKU simplemente no se emite
      if (!datos) continue;
      const espec = await leerEspecificaciones(page, codigo).catch(() => null);
      salida.push({
        modelo: codigo,
        nombre: nombres[i] || nombres[0] || null,
        precio: datos.precio,
        moneda: "CLP",
        disponible,
        url,
        especificaciones: filtrarEspecificacionesUtiles(espec),
      });
    }
    if (salida.length > 0) return salida;
    // no se pudo separar (la API no respondio): se trata como pagina fallida
    // para que los productos conserven su ultimo dato bueno, en vez de guardar
    // otra vez una ficha fusionada con un precio que no se sabe de cual es.
    throw new Error(`pagina con varios productos sin datos por SKU (model_code=${modelo})`);
  }

  // El precio ya esta a salvo en este punto: si la lectura de especificaciones
  // fallara (selector que Samsung cambie, HTML raro), el .catch la deja en null y
  // la corrida sigue con el titulo que se pueda armar del slug. Nunca puede
  // costar un aviso de precio.
  const especCrudas = await leerEspecificaciones(page, modelo).catch(() => null);

  return {
    modelo,
    nombre: digitalData.displayName || null,
    precio: precioFinal,
    moneda: "CLP",
    disponible,
    url,
    especificaciones: filtrarEspecificacionesUtiles(especCrudas),
  };
}
