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
//
// Los DOS caminos (mas la respuesta de la API que la propia pagina pide) pasan
// por las mismas dos reglas transversales:
//   - propiedad y precedencia: src/identidad.mjs (que SKU es de esta pagina y
//     cuanto vale lo que esta pagina dice sobre el).
//   - estado de stock: src/stock.mjs (maquina de estados unica, nunca
//     "disponible por defecto").
import { filtrarEspecificacionesUtiles } from "./titulo.mjs";
import { ESTADO, VERSION_STOCK, disponibleDe, estadoDesdeApi, estadoDesdeBloqueCompra, estadoDesdeJsonLd } from "./stock.mjs";
import { RANGO, repartirPorPropiedad } from "./identidad.mjs";

/**
 * La pagina que se pidio existe, pero Samsung entrego la ficha de OTRO producto
 * (redireccion a un hermano). No es un fallo de red ni del sitio: es un dato
 * util. run.mjs la distingue de un error para no reintentarla y, sobre todo,
 * para marcar la pagina como NO VERIFICADA -- asi los SKU que colgaban de ella
 * conservan su ultimo dato bueno en vez de acumular ausencias y terminar
 * anunciados como "desaparecidos".
 */
export class PaginaAjena extends Error {
  constructor(urlPedida, urlFinal, ajenos) {
    super(`la pagina entrego otro producto (${urlPedida} -> ${urlFinal}): ${ajenos.join(", ") || "sin SKU"}`);
    this.name = "PaginaAjena";
    this.ajena = true;
    this.urlPedida = urlPedida;
    this.urlFinal = urlFinal;
    this.ajenos = ajenos;
  }
}

function modelCodeFromOfferUrl(offerUrl) {
  if (!offerUrl) return null;
  const idx = offerUrl.indexOf("?");
  return idx === -1 ? null : offerUrl.slice(idx + 1);
}

/**
 * Variantes del JSON-LD, separadas en las que son de esta pagina y las que no.
 * @param opciones.urlPedida URL que pidio run.mjs
 * @param opciones.urlFinal  URL en la que termino el fetch (res.url sigue las
 *        redirecciones). Sin ninguna de las dos no hay evidencia de redireccion
 *        y todo se considera propio: este modulo nunca descarta por falta de
 *        datos.
 */
export function clasificarVariantesFamilia(html, { urlPedida = null, urlFinal = null } = {}) {
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
      // El JSON-LD trae la disponibilidad DECLARADA por variante. Es mas debil
      // que el bloque de compra de la ficha propia (medido en el S25 FE: la
      // pagina agrupada marcaba agotado un SKU que su ficha vendia con boton
      // "Comprar"), y por eso este camino entra con rango FAMILIA: si el mismo
      // SKU aparece por su ficha propia en la misma corrida, gana la ficha.
      const estado = estadoDesdeJsonLd(offer.availability);
      variants.push({
        modelo: modelCode,
        nombre: item.name || null,
        precio,
        moneda: offer.priceCurrency || "CLP",
        estadoStock: estado,
        disponible: disponibleDe(estado),
        versionStock: VERSION_STOCK,
        rango: RANGO.FAMILIA,
        url: offer.url,
      });
    }
  }

  // dedupe por modelo (a veces el mismo Offer aparece repetido en varios bloques)
  const porModelo = new Map();
  for (const v of variants) porModelo.set(v.modelo, v);
  const todas = [...porModelo.values()];

  const { propios } = repartirPorPropiedad(urlPedida, urlFinal, todas.map((v) => v.modelo));
  const esPropio = new Set(propios);

  // el diccionario del buy-box de la pagina familia trae a TODOS los SKU
  // hermanos, asi que cada variante toma sus propias especificaciones del HTML
  // que ya se descargo: cero requests extra.
  const conEspecificaciones = (v) => ({
    ...v,
    especificaciones: filtrarEspecificacionesUtiles(especificacionesDesdeHtml(html, v.modelo)),
  });

  return {
    propias: todas.filter((v) => esPropio.has(v.modelo)).map(conEspecificaciones),
    ajenas: todas.filter((v) => !esPropio.has(v.modelo)),
  };
}

/** Compatibilidad: solo las variantes que le pertenecen a esta pagina. */
export function extractFamilyVariants(html, opciones = {}) {
  return clasificarVariantesFamilia(html, opciones).propias;
}

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

/**
 * BLOQUE DE COMPRA: su texto y, sobre todo, sus BOTONES. Es lo unico que se
 * puede leer en la pagina para decidir el stock.
 *
 * NO se lee la pagina completa a proposito: el TV F6000, que SI tiene stock,
 * contiene "avisame" dos veces en el carrusel "¿Buscas alternativas?" y buscar
 * la palabra en todo el body lo daria por agotado (ver src/stock.mjs).
 *
 * PERO TAMPOCO ALCANZA CON "EL BLOQUE". Medido en vivo el 2026-09-11: en las
 * paginas /buy/ con plantilla "hubble" (galaxy-z-flip7/buy/ y companeras) el
 * primer [class*='buying'] del documento es la SECCION ENTERA
 * (section.hubble-product__content.pd-buying-tool, 1356 caracteres) y arrastra
 * el pie promocional, donde Samsung escribe "¡Al comprar tu Galaxy Z Flip7!" y
 * "Acumula puntos al comprar tus productos favoritos". Buscar "comprar" ahi
 * daba DISPONIBLE para un producto que la API daba agotado, y encima de forma
 * intermitente segun si el pie alcanzaba a renderizarse.
 *
 * Por eso hay dos cambios:
 *  - se prefiere el bloque ESTRECHO. Verificado en vivo sobre TV (F6000),
 *    notebook (Book4 15,6") y accesorio (soporte WMN-M13EA): en los tres el
 *    elemento es "pdd39-anchor-nav__price pd-buying-price" y su innerText es
 *    exactamente precio + CTA, nada mas. En las paginas hubble ese elemento NO
 *    existe: se cae al contenedor grande y decide src/stock.mjs, que ahi se
 *    queda en "desconocido" y deja mandar a la API por SKU.
 *  - se devuelven los BOTONES, que es lo que de verdad ve el cliente. El texto
 *    COMPLETO de un boton se compara contra un vocabulario cerrado, asi que
 *    ninguna frase de marketing puede hacerse pasar por un CTA.
 */
async function leerBloqueCompra(page) {
  const datos = await page
    .evaluate(() => {
      // del mas estrecho al mas amplio; la lista va escrita aca adentro porque
      // este cuerpo se serializa y se ejecuta en el navegador
      const selectores = [
        "[class*='pd-buying-price']", // barra de precio + CTA (pdd39-anchor-nav__price pd-buying-price)
        "[class*='buying-tool__summary']", // cost-box: "Agregar al carro" / "Dónde comprar"
        "[class*='pd-buy']",
        "[class*='buying']",
      ];
      let el = null;
      for (const s of selectores) {
        el = document.querySelector(s);
        if (el) break;
      }
      const visible = (n) => !!(n.offsetWidth || n.offsetHeight || n.getClientRects().length);
      // solo botones VISIBLES y de texto corto: un CTA real dice "Comprar" o
      // "Agregar al carro", nunca un parrafo
      const botonesDe = (raiz) =>
        [...(raiz?.querySelectorAll("a, button, input[type=submit]") ?? [])]
          .filter(visible)
          .map((n) => String(n.innerText ?? n.value ?? "").replace(/\s+/g, " ").trim())
          .filter((t) => t && t.length <= 40)
          .slice(0, 12);
      // LA BARRA DE PRECIO PEGAJOSA, segundo intento. En las paginas hubble el
      // bloque de compra no trae ningun CTA, pero la barra de abajo SI: medido el
      // 2026-09-11 en galaxy-z-flip7/buy/, su boton dice literalmente "No está a
      // la venta" (a.cta.price-bar-cart-btn.is-cta-disabled, visible) y esta
      // FUERA de [class*='buying']. Sin ella ese SKU se guardaba como "agotado"
      // por la API, que es un estado distinto del que ve el cliente.
      const barra = [...document.querySelectorAll("[class*='price-bar']")].map(botonesDe).flat();
      if (!el && barra.length === 0) return null;
      return { texto: el && typeof el.innerText === "string" ? el.innerText : null, ctas: botonesDe(el), ctasBarra: barra.slice(0, 12) };
    })
    .catch(() => null);
  return { texto: datos?.texto ?? null, ctas: datos?.ctas ?? [], ctasBarra: datos?.ctasBarra ?? [] };
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
 * EL PRECIO QUE EL CLIENTE PAGA, leido del bloque de compra (medido 2026-09-12).
 *
 * El bloque escribe siempre la misma frase: "Desde $ 48.333 en 12 cuotas sin
 * intereses* o $579.990 Precio original: $839.990 Ahorra $ 260.000". El monto
 * que va despues de " o $" es el que se cobra; el de "Desde $" es la cuota y el
 * de "Precio original" es el tachado.
 *
 * POR QUE HACE FALTA. digitalData no siempre trae ese numero. Medido sobre 37
 * productos comparables (2 por categoria notificable), en 3 tablets el precio
 * guardado era el TACHADO:
 *   SM-X400NZRDCHO -> model_price 379990 (invisible), list_price 549989
 *      (visible, pero tachado); el cliente paga 494990.
 *   SM-X520NLBECHO -> guardaba 839990; el cliente paga 579990.
 *   SM-X400NZAHCHO -> guardaba 649990; el cliente paga 479990.
 * precioVisiblePreferido hacia lo correcto segun su regla (descartar el monto
 * que no esta escrito en la pagina) pero el tachado TAMBIEN esta escrito, asi
 * que elegia el mas caro y el monitor reportaba un precio 17-31% mas alto que el
 * real. En un Cyber eso es justo la baja que no se avisa.
 *
 * Devuelve null cuando el bloque no trae la frase: ahi siguen mandando
 * digitalData y precioVisiblePreferido, sin cambio de comportamiento.
 */
/**
 * Version de la FUENTE del precio. Viaja en cada observacion y se guarda en el
 * catalogo; comparar() la usa para adoptar en silencio, UNA vez por SKU, la
 * correccion del precio tachado (ver "correccion del precio tachado" en
 * src/comparar.mjs). Misma mecanica que VERSION_STOCK.
 *   1 = digitalData (model_price / list_price), hasta 2026-09-12
 *   2 = el monto escrito en el bloque de compra cuando esta (este archivo)
 */
export const VERSION_PRECIO = 2;

export function precioDelBloqueCompra(texto) {
  const t = String(texto ?? "").replace(/\s+/g, " ");
  // " o $579.990" / " o $ 559.990". La frontera de palabra
  // evita enganchar la "o" final de otra palabra ("Ahorra $" no cae aca).
  const m = /\bo\s*\$\s?([\d.]{4,})/.exec(t);
  if (!m) return null;
  const n = Number(m[1].replace(/\./g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
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
 *
 * Devuelve { precio, estado } por codigo:
 *  - precio: SOLO de las respuestas de LISTA (las que pide una pagina con varios
 *    productos). En la respuesta de UN producto el "price" medido es el precio de
 *    lista y no el de venta (The Frame 50": API 949.990 contra 619.990 en
 *    pantalla), asi que de esas se toma el stock y jamas el precio.
 *  - estado: stock.stockLevelStatus por SKU. Es la unica fuente de stock POR SKU
 *    en las paginas que agrupan varios productos, donde el bloque de compra es
 *    un selector de grupo que no se puede atribuir a ninguno.
 */
export function productosDesdeApi(respuestas) {
  const porCodigo = new Map();
  const anotar = (codigo, datos) => {
    if (!codigo) return;
    const previo = porCodigo.get(codigo);
    if (!previo) {
      porCodigo.set(codigo, datos);
      return;
    }
    // la primera respuesta con dato valido gana (algunas llegan incompletas)
    if (!Number.isFinite(previo.precio) && Number.isFinite(datos.precio)) previo.precio = datos.precio;
    if (previo.estado === ESTADO.DESCONOCIDO && datos.estado !== ESTADO.DESCONOCIDO) previo.estado = datos.estado;
  };

  for (const cuerpo of respuestas ?? []) {
    const lista = cuerpo?.products ?? cuerpo?.productList ?? (Array.isArray(cuerpo) ? cuerpo : null);
    if (Array.isArray(lista)) {
      for (const p of lista) {
        const codigo = p?.code ?? p?.sku;
        if (!codigo) continue;
        const precio = aNumero(p?.price?.value ?? p?.priceValue ?? p?.price);
        anotar(codigo, {
          precio: Number.isFinite(precio) && precio > 0 ? precio : null,
          estado: estadoDesdeApi(p),
        });
      }
      continue;
    }
    // respuesta de UN solo producto: sirve de respaldo de stock, nunca de precio
    if (cuerpo && typeof cuerpo === "object" && (cuerpo.code || cuerpo.sku)) {
      anotar(cuerpo.code ?? cuerpo.sku, { precio: null, estado: estadoDesdeApi(cuerpo) });
    }
  }

  // Una entrada sin precio Y sin stock no aporta nada: se descarta para que la
  // forma historica "una respuesta sin precio valido no deja entrada" siga
  // valiendo (test/compuestos.test.mjs).
  for (const [codigo, datos] of porCodigo) {
    if (!Number.isFinite(datos.precio) && datos.estado === ESTADO.DESCONOCIDO) porCodigo.delete(codigo);
  }
  return porCodigo;
}

/**
 * Devuelve UN registro, o un ARRAY de registros cuando la pagina expone varios
 * productos (ver mas abajo). run.mjs normaliza ambos casos.
 * @param respuestasApi cuerpos JSON que la pagina ya le pidio a la API de
 *   Samsung, capturados por run.mjs. Sin ellos, una pagina con varios productos
 *   se trata como fallida en vez de guardar una ficha fusionada.
 * @throws {PaginaAjena} cuando la navegacion aterrizo en la ficha de otro producto.
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
  const nombres = String(digitalData.displayName ?? "").split(";").map((n) => n.trim());

  // ¿En que pagina termino de verdad la navegacion? Samsung redirige las fichas
  // que deja de vender a la de un hermano y, sin esto, el producto del hermano
  // quedaba anotado como si fuera de la URL pedida (ver src/identidad.mjs).
  const urlFinal = typeof page.url === "function" ? page.url() : null;
  const { propios, ajenos } = repartirPorPropiedad(url, urlFinal, codigos);
  if (propios.length === 0) throw new PaginaAjena(url, urlFinal, ajenos);

  const porCodigo = productosDesdeApi(respuestasApi);

  // Pagina con varios productos PROPIOS: se emite uno por SKU, con SU precio y
  // SUS especificaciones (el diccionario del buy-box tambien esta indexado por
  // SKU). Son las paginas de grupo legitimas -- Tab S9 FE, Tab A9, Book3,
  // Book3 Pro --, verificadas en vivo: no redirigen y su slug no nombra ningun
  // SKU. Su bloque de compra es un selector de grupo ("Buying Tool ... Galaxy
  // Tab S9 FE Desde $ 499.990 ...") que NO se puede atribuir a ningun SKU, asi
  // que el stock sale de la API por codigo; sin ese dato queda "desconocido",
  // que no cambia ni notifica nada.
  if (propios.length > 1) {
    const salida = [];
    for (const codigo of propios) {
      const datos = porCodigo.get(codigo);
      // sin precio propio no se inventa nada: ese SKU simplemente no se emite
      if (!datos || !Number.isFinite(datos.precio)) continue;
      const espec = await leerEspecificaciones(page, codigo).catch(() => null);
      const estado = datos.estado ?? ESTADO.DESCONOCIDO;
      salida.push({
        modelo: codigo,
        nombre: nombres[codigos.indexOf(codigo)] || nombres[0] || null,
        precio: datos.precio,
        moneda: "CLP",
        estadoStock: estado,
        disponible: disponibleDe(estado),
        versionStock: VERSION_STOCK,
        rango: RANGO.AGRUPADA,
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

  // UN solo producto propio: esta es la ficha donde el cliente compra, asi que
  // su bloque de compra ES de este SKU. Rango PROPIA (le gana a cualquier pagina
  // que solo lo agrupe) y el stock mas confiable que existe.
  //
  // La API entra SOLO cuando el bloque no dijo nada ("desconocido": ilegible,
  // sin CTA reconocible, o con senales contradictorias). Un bloque que SI
  // decidio manda, incluido el "Dónde comprar" que ahora vale "no a la venta":
  // antes ese caso caia a la API, la API respondia outOfStock y el catalogo
  // terminaba diciendo "agotado" de un producto que Samsung nunca vendio online
  // -- la decision de callarse quedaba anulada una linea despues (defecto 3).
  const propio = propios[0];
  // Orden de las fuentes, de la que mas se parece a lo que ve el cliente a la
  // que menos: bloque de compra -> barra de precio pegajosa -> API por SKU. Cada
  // una solo entra si la anterior no decidio, asi que agregar la barra no puede
  // quitarle un veredicto correcto a nadie.
  const bloque = await leerBloqueCompra(page);
  let estado = estadoDesdeBloqueCompra(bloque.texto, bloque.ctas);
  if (estado === ESTADO.DESCONOCIDO) estado = estadoDesdeBloqueCompra(null, bloque.ctasBarra);
  if (estado === ESTADO.DESCONOCIDO) estado = porCodigo.get(propio)?.estado ?? ESTADO.DESCONOCIDO;

  // El precio ya esta a salvo en este punto: si la lectura de especificaciones
  // fallara (selector que Samsung cambie, HTML raro), el .catch la deja en null y
  // la corrida sigue con el titulo que se pueda armar del slug. Nunca puede
  // costar un aviso de precio.
  const especCrudas = await leerEspecificaciones(page, propio).catch(() => null);

  // Cuando la pagina agrupaba varios codigos y solo uno es propio (el caso del
  // S25 FE 512GB, cuyo digitalData trae "SM-S936B...,SM-S931B...,SM-S731B..."),
  // el nombre de ESE SKU es el de su posicion en la lista, no el de la ficha
  // fusionada, y el precio de digitalData puede ser el de un hermano.
  //
  // PERO EL PRECIO DE LA API NO PUEDE PISAR AL QUE EL CLIENTE VE (defecto 5).
  // La regla del 2026-08-03 -- nacida del pack "Watch Ultra + Buds4 Pro", que
  // costo avisos falsos de bajadas de un precio inexistente -- dice que gana el
  // precio ESCRITO en la pagina, y precioVisiblePreferido ya lo eligio mas
  // arriba. Tomar el de la API sin mirar tiraba esa defensa justo en el caso
  // que vino a cubrir: en el S25 FE la API publica 829.990 (precio de lista)
  // mientras la ficha muestra 579.990 con boton "Comprar". Asi que la API entra
  // SOLO cuando el precio leido no aparece en ninguna parte de la pagina, que
  // es exactamente la senal de que no es de este SKU.
  const varios = codigos.length > 1;
  const precioApi = porCodigo.get(propio)?.precio;
  // El bloque de compra de ESTE SKU es la fuente mas directa que existe: es el
  // numero que el cliente lee antes de apretar el boton. Manda sobre digitalData
  // cuando esta escrito (ver precioDelBloqueCompra); si no esta, no cambia nada.
  const precioBloque = precioDelBloqueCompra(bloque.texto);
  const precioVisto = precioBloque ?? precioFinal;
  const precioElegido =
    varios && Number.isFinite(precioApi) && !montoVisible(precioVisto, bodyText) ? precioApi : precioVisto;

  const salidaPropia = {
    modelo: propio,
    nombre: (varios ? nombres[codigos.indexOf(propio)] : digitalData.displayName) || null,
    precio: precioElegido,
    moneda: "CLP",
    estadoStock: estado,
    disponible: disponibleDe(estado),
    versionStock: VERSION_STOCK,
    rango: RANGO.PROPIA,
    url,
    especificaciones: filtrarEspecificacionesUtiles(especCrudas),
    versionPrecio: VERSION_PRECIO,
  };
  // Rastro para que comparar() pueda distinguir una CORRECCION de fuente de una
  // baja de verdad: cuando el bloque manda y el numero que habria elegido la
  // regla anterior es otro, ese otro numero es el precio TACHADO. Solo se
  // escribe en ese caso (medido: ~4% de las fichas), asi que no engorda
  // data/latest.json ni el historial.
  if (Number.isFinite(precioBloque) && Number.isFinite(precioFinal) && precioBloque !== precioFinal) {
    salidaPropia.precioTachado = precioFinal;
  }
  return salidaPropia;
}
