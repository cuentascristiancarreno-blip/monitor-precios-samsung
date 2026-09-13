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
      let usado = null;
      for (const s of selectores) {
        el = document.querySelector(s);
        if (el) {
          usado = s;
          break;
        }
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
      if (!el && barra.length === 0) return { texto: null, ctas: [], ctasBarra: [], selector: null };
      return {
        texto: el && typeof el.innerText === "string" ? el.innerText : null,
        ctas: botonesDe(el),
        ctasBarra: barra.slice(0, 12),
        selector: usado,
      };
    })
    .catch(() => null);
  return {
    texto: datos?.texto ?? null,
    ctas: datos?.ctas ?? [],
    ctasBarra: datos?.ctasBarra ?? [],
    selector: datos?.selector ?? null,
    // ¿EL BLOQUE QUE SE LEYO ES LA BARRA DE PRECIO DE ESTE SKU, O EL SELECTOR DE
    // UN GRUPO? (2026-09-13, defecto medido por dos verificadores.)
    //
    // Los dos primeros selectores de la lista de arriba son la barra de precio
    // de ESTA ficha: verificado en vivo sobre TV, notebook y accesorio, su
    // innerText es exactamente precio + CTA. Todo lo que caiga mas abajo en la
    // lista es, en las paginas /buy/ con plantilla hubble, el Buying Tool: un
    // SELECTOR DE GRUPO que habla de TODAS las variantes a la vez.
    //
    // Medido hoy en vivo en galaxy-a36/buy/ (el selector que gano fue
    // [class*='pd-buy']): el Buying Tool publica el monto de cada opcion
    // ("...128GB｜6GB $ 35.832 al mes o $ 429.990 256GB｜8GB ... o $ 369.990...")
    // y tambien el veredicto de stock de cada color ("Gris increíble Agotado").
    // Ninguna de las dos cosas es de este SKU. En la ficha del monitor
    // LS32DG300ELXZS, en cambio, el ganador es [class*='pd-buying-price'] y su
    // innerText entero es "Dónde comprar": ahi si habla este producto.
    //
    // Quien lee este campo:
    //  - precioDelBloqueCompra, para saber si un monto solitario puede mandar
    //    sin comprobar nada (barra) o tiene que senalar a un candidato de
    //    digitalData (selector);
    //  - la llave de la concesion "la pagina declara que no lo vende online",
    //    que solo vale desde la barra (ver extractSingleProduct).
    //
    // SOLO EL PRIMER SELECTOR CUENTA COMO BARRA, y es a proposito. El segundo de
    // la lista, `buying-tool__summary`, lleva "buying-tool" en el nombre: es el
    // resumen del MISMO Buying Tool de las paginas hubble, o sea que refleja la
    // opcion que el selector tenga elegida, no necesariamente este SKU. Solo
    // `pd-buying-price` esta verificado en vivo como la barra de precio de un
    // unico producto (TV F6000, Book4 15,6", soporte WMN-M13EA y el monitor
    // LS32DG300ELXZS: su innerText es exactamente precio + CTA). Ante la duda,
    // el lado seguro es exigir que el monto señale a un candidato.
    barraDePrecio: datos?.selector === "[class*='pd-buying-price']",
    // "NO PUDE LEER" NO ES LO MISMO QUE "LEI Y NO DICE PRECIO" (2026-09-12,
    // defecto medido por los tres verificadores). Este evaluate va envuelto en
    // `.catch(() => null)` y hasta hoy los dos casos salian identicos: `texto:
    // null`. Un piso mas abajo eso hacia que el precio cayera al TACHADO -- el
    // numero exacto al que saltaba el vaiven -- sin ninguna marca de que la
    // lectura habia fallado. Un bloque con texto VACIO tambien cuenta como
    // ilegible: es la firma de un bloque que todavia no se pinto.
    legible: typeof datos?.texto === "string" && datos.texto.trim().length > 0,
  };
}

// Samsung NO trae el precio en el HTML: la pagina se lo pide a
// api.shop.samsung.com y hasta que responde, digitalData.model_price vale el
// relleno "0,0" (un cero por cada producto que la pagina agrupa). Medido: el
// evento "load" ocurre a los 739 ms y el precio llega a los 827 ms -- 88 ms
// tarde. Leer sin esperar hacia que el producto se diera por inexistente, y a
// las 2 corridas se anunciaba "desaparecido" (el ciclo del Book3: 48 avisos
// falsos). El numero tambien puede venir con coma decimal.
//
// ESTE TOPE NUNCA SE APLICO, medido hoy (2026-09-12). La llamada de mas abajo
// estaba escrita `page.waitForFunction(fn, { timeout: PRECIO_TIMEOUT_MS })` y la
// firma de Playwright es `waitForFunction(pageFunction, arg, options)`: ese
// objeto entraba como ARG y la espera corria con el default de Playwright.
// Medido sin red (una pagina escrita con setContent, ver BITACORA.md):
//   waitForFunction(fn, { timeout: 500 })            -> 30.017 ms
//   waitForFunction(fn, undefined, { timeout: 500 }) ->    518 ms
// O sea que las ~150 paginas que legitimamente no publican precio pagaban 30 s
// cada una, no 3. Con la firma corregida el tope por fin existe, asi que se
// vuelve a un presupuesto holgado: 8 s es ~4,7 veces la peor espera medida de
// digitalData (1.718 ms) y sigue siendo 22 s MENOS por pagina que hoy. Estimado
// sobre las ~150 paginas sin precio: ~55 min menos por corrida (hoy 169-210 min,
// tope del job 330).
//
// Y el incidente del 2026-08-02 no fue por este numero (8000 tampoco se
// aplicaba nunca): lo arreglo el `throw` selectivo de mas abajo, que dejo de
// mandar esas paginas al reintento. Ver BITACORA.md.
const PRECIO_TIMEOUT_MS = 8000;

/**
 * PRESUPUESTO PROPIO DE LA ESPERA DE PINTADO (2026-09-12, defecto medido).
 *
 * Antes esta espera recibia "las sobras": `PRECIO_TIMEOUT_MS - (Date.now() -
 * t0)`. Como el tope de la espera de digitalData no se aplicaba (ver arriba),
 * en una pagina lenta t0 podia llevar 30 s consumidos y la resta quedaba
 * NEGATIVA: la defensa central del arreglo del vaiven se auto-descartaba justo
 * en las paginas para las que se escribio. Ahora tiene su propio presupuesto,
 * chico y fijo, que no depende de lo que haya tardado nadie antes.
 *
 * 1,5 s cubre con holgura el render medido (7 ms cuando la pagina ya pinto) y
 * acota el peor caso: una ficha que nunca escribe un monto paga 1,5 s. Cota
 * alta si las ~400 paginas que no publican precio visible se comportaran asi:
 * ~10 min por corrida, contra los ~55 min que libera el arreglo del tope de
 * arriba.
 */
const RENDER_TIMEOUT_MS = 1500;

/**
 * PRESUPUESTO DE LA ESPERA DE HIDRATACION DE digitalData (2026-09-13 tarde).
 *
 * La espera vieja solo exigia `model_price > 0`, y eso se cumple ANTES de que la
 * pagina termine de hidratarse. Muestreado en vivo cada 250 ms sobre
 * galaxy-a36/buy/, entrando igual que produccion:
 *     935 ms   model_price "539990"   list_price ""       <- el precio TACHADO
 *   1.310 ms   model_price "369990"   list_price "539990" <- asentado
 * La ventana mala duro 375 ms y la lectura de produccion cae dentro de ella cada
 * vez que el primer pintado del Buying Tool gana la carrera. Es el mecanismo del
 * vaiven del A36 (3 de los 5 avisos falsos del encargo).
 *
 * 3 s es ~8 veces esa ventana medida. No se usa PRECIO_TIMEOUT_MS (8 s) porque
 * esta espera la paga TODA pagina que no publique list_price, y el incidente del
 * 2026-08-02 enseño que una espera nueva hay que medirla contra el PEOR caso del
 * catalogo, no contra el caso que se esta arreglando. Cuando la pagina ya esta
 * asentada -- el caso normal -- cuesta cero: waitForFunction vuelve de inmediato
 * si la condicion ya se cumple.
 *
 * Si se agota, la lectura queda marcada `digitalDataSinAsentar` y no adopta
 * ningun numero de digitalData (ver precioAdoptable). El contador sale en el
 * resumen de la corrida para poder medir en produccion cuantas paginas caen ahi:
 * en las 6 fichas cargadas en vivo (A36 /buy/, monitor, S25 FE /buy/, y las tres
 * de la entrada anterior) TODAS publican los dos campos una vez asentadas.
 */
const HIDRATACION_TIMEOUT_MS = 3000;

function aNumero(valor) {
  return Number(String(valor ?? "").replace(",", "."));
}

// Formato chileno del monto, tal como lo escribe la pagina ("974.980").
function montoFormateado(monto) {
  if (!Number.isFinite(monto) || monto <= 0) return null;
  return new Intl.NumberFormat("es-CL").format(Math.round(monto));
}

// ¿Esta este monto escrito en la pagina, con el formato chileno ($ 974.980)?
function montoVisible(monto, texto) {
  const formateado = montoFormateado(monto);
  if (!formateado || !texto) return false;
  return texto.replace(/\s/g, "").includes(formateado);
}

/**
 * ESPERA A QUE EL PRECIO SE PINTE, no a que exista la variable (2026-09-12).
 *
 * LA CARRERA MEDIDA. El waitForFunction de mas abajo espera a que la VARIABLE
 * window.digitalData.product.model_price sea > 0, y digitalData se llena apenas
 * responde api.shop.samsung.com (medido: 1.718 ms); el bloque de compra se
 * re-renderiza DESPUES. Entremedio, document.body.innerText todavia no tiene
 * ningun monto escrito, y quien lee ese texto es precioVisiblePreferido para
 * decidir cual de los dos numeros de digitalData es el de verdad. O sea: la
 * MISMA pagina devolvia dos precios estables segun quien ganara la carrera, y
 * cada cambio de ganador mandaba un "subio" o un "bajo" que no correspondia a
 * ningun cambio en Samsung.
 *
 * Medido sobre data/history.jsonl (30 dias): 68 SKU con el precio volviendo
 * exactamente a un valor ya visto, 361 avisos de precio de esos SKU sobre 784
 * totales (46%). El peor, el monitor LS32DG300ELXZS, con 56 avisos rebotando
 * entre $199.990 (model_price, que NO esta escrito en su ficha) y $279.990
 * (list_price, que si lo esta).
 *
 * La espera es por los MONTOS de digitalData, no por un selector: es exactamente
 * el criterio que usara montoVisible dos lineas despues, asi que cuando esta
 * espera se cumple la decision ya no depende del instante en que se lea.
 *
 * PRESUPUESTO: el suyo, RENDER_TIMEOUT_MS, no las sobras de la espera anterior
 * (ver la nota de esa constante: con las sobras la espera se auto-descartaba en
 * las paginas lentas, que son justo las que corren la carrera).
 */
/**
 * ESPERA A QUE digitalData TERMINE DE HIDRATARSE (2026-09-13 tarde).
 *
 * La senal es `list_price`: mientras la respuesta de api.shop.samsung.com no
 * llega, la pagina publica `list_price: ""` y deja el precio de LISTA metido en
 * `model_price` (medido en vivo, ver HIDRATACION_TIMEOUT_MS). Los dos campos se
 * llenan juntos, con la misma respuesta, asi que esperar al segundo garantiza
 * que el primero ya no es el provisorio.
 *
 * No lanza ni decide nada: devuelve si lo logro. Quien decide es
 * extractSingleProduct, que con `false` marca la lectura y no adopta numeros de
 * digitalData.
 */
async function esperarDigitalDataAsentado(page, presupuestoMs = HIDRATACION_TIMEOUT_MS) {
  if (typeof page.waitForFunction !== "function") return true;
  try {
    await page.waitForFunction(
      () => {
        const p = window.digitalData?.product;
        if (!p) return false;
        const n = Number(String(p.list_price ?? "").replace(",", "."));
        return Number.isFinite(n) && n > 0;
      },
      undefined,
      { timeout: presupuestoMs },
    );
    return true;
  } catch {
    return false;
  }
}

async function esperarMontoPintado(page, montos, presupuestoMs = RENDER_TIMEOUT_MS) {
  const buscados = montos.map(montoFormateado).filter(Boolean);
  if (buscados.length === 0 || !(presupuestoMs > 0)) return;
  if (typeof page.waitForFunction !== "function") return;
  await page
    .waitForFunction(
      (lista) => {
        const t = (document.body?.innerText ?? "").replace(/\s/g, "");
        return lista.some((m) => t.includes(m));
      },
      buscados,
      { timeout: presupuestoMs },
    )
    .catch(() => {
      // no se pinto ningun monto dentro del presupuesto: no se espera mas y la
      // pagina se lee igual. El que decide es precioVisiblePreferido, que sin
      // monto escrito devuelve null (no hay precio) en vez de inventar uno.
    });
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
 * correccion de la fuente del precio (ver "correccion de la fuente del precio"
 * en src/comparar.mjs). Misma mecanica que VERSION_STOCK.
 *   1 = digitalData (model_price / list_price), hasta 2026-09-12
 *   2 = el monto escrito en el bloque de compra cuando esta (este archivo)
 *   3 = ademas, ningun precio que no este ESCRITO en la pagina (2026-09-12
 *       tarde): se espera a que el monto se pinte y, si no se pinta, no hay
 *       precio. Ver precioVisiblePreferido y esperarMontoPintado.
 *   4 = el precio sale del BLOQUE DE COMPRA o de nada (2026-09-13): el texto de
 *       la pagina entera deja de arbitrar entre model_price y list_price, y un
 *       bloque que es un SELECTOR de grupo solo vale si senala a un unico
 *       candidato. Ver precioAdoptable y la funcion de aca abajo.
 */
export const VERSION_PRECIO = 4;

/**
 * EL MONTO QUE PUBLICA EL BLOQUE DE COMPRA.
 *
 * UN BLOQUE PUEDE PUBLICAR VARIOS MONTOS, Y EL PRIMERO NO ES NECESARIAMENTE EL
 * DE ESTE SKU (2026-09-13, medido en vivo). La barra de precio de una ficha
 * normal (`pd-buying-price`) escribe UNO solo:
 *   "Desde $ 30.833 en 12 cuotas sin intereses* o $369.990 Precio original:
 *    $539.990 Ahorra $ 170.000 *Aplican condiciones Comprar"
 * Pero el "Buying Tool" de las paginas /buy/ con plantilla hubble es un SELECTOR
 * DE GRUPO y escribe el de cada opcion que ofrece. Texto literal de
 * galaxy-a36/buy/ medido hoy, con los montos que deja en el bloque:
 *   "... Galaxy A36 Desde $ 30.832 al mes o $ 369.990 ... Selecciona tu
 *    almacenamiento 128GB|6GB ... o $ 429.990 256GB|8GB ... o $ 369.990 ..."
 *   -> ["369.990", "429.990", "369.990", "7.915", "94.991", "49.990", ...]
 * Tomar el primero es tomar el de la variante que el selector trae elegida por
 * omision, no el de este SKU: el dia que Samsung cambie esa opcion por omision,
 * el precio guardado cambia solo. Es el MISMO defecto que el carrusel "¿Buscas
 * alternativas?" le hacia al stock (ver leerBloqueCompra): leer un numero de un
 * texto que no es la barra de precio de este producto.
 *
 * LA REGLA NO LA DECIDE LA CANTIDAD DE MONTOS SINO QUE BLOQUE SE LEYO
 * (corregido 2026-09-13 tarde, defecto medido por dos verificadores). La primera
 * version de esta funcion decia "UN monto manda, VARIOS son un selector", y esa
 * cuenta se rompe justo cuando importa: un Buying Tool a MEDIO PINTAR publica UN
 * SOLO monto, y no es el de este SKU.
 *   - Medido en vivo hoy en galaxy-a36/buy/, a los 935 ms de domcontentloaded:
 *     el tool ya esta pintado y publica un unico "Desde $ 44.999 al mes o
 *     $ 539.990" -- el precio TACHADO. A los 1.310 ms se re-pinta con los cinco
 *     montos reales y el primero pasa a ser $ 369.990.
 *   - Y el otro lado de la misma moneda: un render parcial que deje escrita solo
 *     la fila de accesorios ("...Accesorios Desde $ 4.165 al mes o $ 49.990")
 *     hacia adoptar $49.990 para un celular de $369.990: una "baja" del 86% a
 *     dias del Cyber.
 *
 * Por eso la regla mira el ORIGEN del texto (bloque.barraDePrecio, ver
 * leerBloqueCompra):
 *  - LA BARRA DE PRECIO de esta ficha (pd-buying-price / buying-tool__summary):
 *    un monto solitario manda, como desde el 2026-09-12, y vale AUNQUE no
 *    coincida con ningun campo de digitalData -- que es justo el caso que ese
 *    arreglo vino a cubrir (SM-X400NZRDCHO: el bloque cobra $494.990 y
 *    digitalData publica 379.990 y 549.989). Ese elemento habla de un solo
 *    producto: el de la ficha.
 *  - EL SELECTOR DE GRUPO (Buying Tool de una /buy/ hubble): sus montos son de
 *    todas las variantes y de los accesorios, asi que solo decide si
 *    EXACTAMENTE UNO de ellos es uno de los numeros que digitalData publica para
 *    ESTE SKU -- tenga uno o tenga ocho. Si son dos, o ninguno, el bloque no
 *    señalo a este producto y no decide nadie.
 *    Medido: galaxy-a36/buy/ pintado -> {369.990, 429.990, 49.990...} contra
 *    {369.990, 539.990} = 1 coincidencia -> 369.990 (el correcto);
 *    galaxy-z-flip7/buy/ -> {1.169.990, 1.299.990} contra {1.169.990, 1.269.989}
 *    = 1 -> 1.169.990 (lo mismo que hoy); galaxy-a56/buy/ -> {529.990, 569.990}
 *    contra {529.990} = 1 -> 529.990 (lo mismo que hoy).
 *
 * @param candidatos los montos que digitalData publica para ESTE SKU
 *   ([model_price, list_price]). Sin ellos un bloque de selector no puede
 *   decidir, que es el lado seguro.
 * @param opciones.barraDePrecio si el texto salio de la barra de precio de esta
 *   ficha. Por omision `true`, que es la forma en que se comporto esta funcion
 *   desde que existe; el call site real pasa lo que leyo leerBloqueCompra.
 */
export function montosDelBloqueCompra(texto) {
  const t = String(texto ?? "").replace(/\s+/g, " ");
  // " o $579.990" / " o $ 559.990". La frontera de palabra
  // evita enganchar la "o" final de otra palabra ("Ahorra $" no cae aca).
  const montos = [];
  for (const m of t.matchAll(/\bo\s*\$\s?([\d.]{4,})/g)) {
    const n = Number(m[1].replace(/\./g, ""));
    if (Number.isFinite(n) && n > 0 && !montos.includes(n)) montos.push(n);
  }
  return montos;
}

export function precioDelBloqueCompra(texto, candidatos = [], { barraDePrecio = true } = {}) {
  const montos = montosDelBloqueCompra(texto);
  if (montos.length === 0) return null;
  if (barraDePrecio && montos.length === 1) return montos[0];
  const senalados = montos.filter((n) => (candidatos ?? []).some((c) => Number.isFinite(c) && c === n));
  return senalados.length === 1 ? senalados[0] : null;
}

/**
 * Elige el precio que el cliente realmente ve. Ver el comentario largo en
 * extractSingleProduct: hay productos donde model_price es un numero interno que
 * no aparece en la ficha y el precio de venta esta en list_price.
 *
 * SI NINGUNO DE LOS DOS ESTA ESCRITO, NO HAY PRECIO (2026-09-12). Antes se
 * devolvia model_price, o sea: "no pude verificar nada, invento con el numero
 * interno". Ese era el lado "bajo" de la moneda al aire. Medido en las 5 fichas
 * que mas avisos falsos generaron, model_price NO aparece en ninguna parte de la
 * pagina:
 *   SM-X520NLBACHO model_price 479.990 · list_price 729.990 · el cliente paga 656.990
 *   SM-X520NLBECHO            539.990              839.990                    579.990
 *   SM-X620NZAACHO            689.990              899.990                    809.990
 *   SM-X930NZAHCHO          1.599.990            1.999.990                  1.799.990
 *   LS32DG300ELXZS            199.990              279.990   (su bloque dice "Donde comprar")
 * Los montos "bajos" de esas fichas son exactamente esos model_price invisibles,
 * y los "altos" los list_price: el baile no era Samsung cambiando de precio, era
 * esta funcion cambiando de respuesta. Devolver null es la regla de oro del
 * proyecto aplicada al precio -- mas vale callarse --, y quien la recibe
 * (extractSingleProduct) omite el campo para que comparar() conserve el ultimo
 * precio bueno sin avisar nada.
 *
 * LA PRIMERA LINEA SE QUEDA COMO ESTABA, A PROPOSITO. Sin list_price valido no
 * hay segundo candidato, asi que no hay carrera posible: la funcion devuelve
 * siempre lo mismo para la misma pagina. Medido: LS32DG300ELXZS estuvo clavado
 * en un precio ~75 corridas (2026-07-20 a 2026-08-08) y empezo a bailar el dia
 * que su ficha estreno precio tachado. Exigir visibilidad tambien ahi congelaria
 * fichas que hoy no producen ni un aviso falso.
 *
 * Y EL CASO "LOS DOS MONTOS IGUALES" NO SE RESUELVE ACA (2026-09-13, defecto
 * medido). La primera version del arreglo de los precios congelados agregaba una
 * segunda linea -- `if (modelPrice === listPrice) return modelPrice;` -- con el
 * argumento de que, con un solo candidato en digitalData, no hay carrera posible.
 * El argumento es correcto sobre digitalData y FALSO sobre la pagina: hay un
 * TERCER numero, el del bloque de compra (ver precioDelBloqueCompra), y es el que
 * manda cuando se deja leer. Con model_price === list_price === el TACHADO y el
 * bloque a medio pintar, esa linea devolvia el tachado y el vaiven volvia con su
 * forma de siempre -- medido, 4 avisos falsos en 5 corridas ("sube 599.990 ->
 * 839.990", "baja 839.990 -> 599.990", ...) y 5 en el orden inverso.
 *
 * Esta funcion NO sabe si el bloque se dejo leer, asi que aca, con los dos
 * numeros sin aparecer en ninguna parte del texto, la respuesta honesta sigue
 * siendo `null`. La concesion vive en precioAdoptable, que si conoce el estado
 * del bloque.
 */
export function precioVisiblePreferido(modelPrice, listPrice, texto) {
  if (!Number.isFinite(listPrice) || listPrice <= 0) return modelPrice;
  if (montoVisible(modelPrice, texto)) return modelPrice;
  if (montoVisible(listPrice, texto)) return listPrice;
  return null;
}

/**
 * ¿LA PROPIA PAGINA MARCA ESTE MONTO COMO EL PRECIO TACHADO? (2026-09-12)
 *
 * Samsung lo escribe con todas sus letras. La ficha del Galaxy Tab S10 FE
 * 128GB azul, literal y medida el 2026-09-12:
 *   "Desde $ 54.749 en 12 cuotas sin intereses* o $656.990 /
 *    Precio original: $729.990 / Ahorra $ 73.000"
 * El 729.990 esta ESCRITO en la pagina -- asi que montoVisible dice que si --
 * pero no es lo que paga el cliente: es el precio de antes. Cada vez que el
 * monitor lo adoptaba mandaba un "subio" que no correspondia a ningun cambio.
 *
 * Se compara contra el texto sin espacios, igual que montoVisible, porque
 * Samsung mete saltos de linea entre la etiqueta y el numero.
 */
export function esPrecioOriginalEscrito(monto, texto) {
  const formateado = montoFormateado(monto);
  if (!formateado || !texto) return false;
  const t = String(texto).replace(/\s/g, "");
  for (const m of t.matchAll(/preciooriginal:?\$?([\d.]{4,})/gi)) {
    if (m[1].replace(/\.$/, "") === formateado) return true;
  }
  return false;
}

/**
 * EL PRECIO QUE SE ADOPTA, Y CUANDO NO SE ADOPTA NINGUNO (2026-09-12).
 *
 * Esta funcion existe porque el arreglo anterior dejo la regla a medias: aplico
 * "no inventar un precio" a `precioVisiblePreferido` (que lee el texto de la
 * pagina) pero el numero que realmente ganaba salia una linea mas abajo, de
 * `precioBloque ?? precioFinal`. Cuando la lectura del bloque de compra fallaba
 * -- va envuelta en `.catch(() => null)` -- ese `??` caia directo al TACHADO,
 * que es el numero exacto al que saltaba el vaiven historico de SM-X520NLBACHO
 * ($656.990 <-> $729.990). Reproducido extremo a extremo por los verificadores:
 * un aviso falso por corrida, con el body IDENTICO y ya pintado en todas.
 *
 * Los TRES estados que antes se confundian en un solo `null`:
 *  (a) el bloque de compra NO se pudo leer (evaluate fallido, o bloque todavia
 *      sin texto): no se sabe cuanto cobra la pagina -> no hay precio, y
 *      comparar() conserva el ultimo bueno sin avisar nada.
 *  (b) el bloque SI se leyo y no publica monto (medido en AR-KH00E y en el
 *      monitor LS32DG300ELXZS: dicen "Dónde comprar" / "no está a la venta"):
 *      ahi el numero escrito en la pagina es el unico que hay, y vale.
 *  (c) el bloque publica el monto: ese manda, siempre.
 *
 * Con una excepcion que cruza los tres: un monto que la pagina marca como
 * "Precio original" NUNCA se adopta (ver esPrecioOriginalEscrito).
 *
 * Y DOS CONCESIONES MEDIDAS, para no congelar fichas que hoy no producen ni un
 * aviso falso. Las dos valen solo cuando digitalData publica UN SOLO numero:
 *
 *  1. LIST_PRICE INVALIDO. precioVisiblePreferido ya eligio el model_price en su
 *     primera linea, asi que el bloque ilegible no lo bloquea. Es el
 *     comportamiento de siempre y se deja como esta a proposito (ver esa
 *     funcion). Tiene un agujero conocido, anterior a todo esto y medido en
 *     simulacion: si list_price aparece y desaparece entre lecturas, el vaiven
 *     entra por ahi (2 avisos falsos por ciclo, identicos antes y despues del
 *     2026-09-13). Cerrarlo exige medir en vivo cuantas fichas reales se leen sin
 *     bloque legible; ver la entrada del 2026-09-13 en BITACORA.md.
 *
 *  2. MODEL_PRICE === LIST_PRICE Y LA PAGINA DICIENDO QUE NO LO VENDE ONLINE
 *     (2026-09-13). Los 94 SKU que el arreglo del vaiven dejo sin precio son, los
 *     94 sin excepcion, "no-a-la-venta": su bloque dice "Dónde comprar" o "No
 *     está a la venta" y por eso no publica ningun monto. Ahi el numero de
 *     digitalData es el unico que existe y no hay tercer candidato con el cual
 *     bailar -- la pagina no va a pintar un precio de venta que no tiene. Tres de
 *     esas fichas, cargadas en vivo el 2026-09-13, publican model_price ===
 *     list_price === el precio ya guardado (NX52A5411CS/ZS 479.990,
 *     NP750XGJ-KS3CL 899.990, QN43LS03BAGXZS 839.990). La cuarta es el pack
 *     F-UN85MHWB450, que publica 1.099.990 contra 1.659.980 (= 1.099.990 +
 *     559.990, la suma de las partes): dos candidatos, carrera posible, sigue
 *     congelado.
 *
 * NO ALCANZA CON "EL BLOQUE SE DEJO LEER", y esta medido. Un bloque que ya tiene
 * texto pero todavia no escribio su monto ("Comprar" a secas, "Cargando...") es
 * indistinguible de uno que no lo va a escribir nunca: gatear la concesion 2 solo
 * en `bloqueLegible` devolvia 4 y 3 avisos falsos en esos dos escenarios. El
 * estado "no-a-la-venta" sale de un vocabulario cerrado (estadoDesdeBloqueCompra
 * en src/stock.mjs) y es la pagina diciendo que no hay precio de venta que leer.
 *
 * LA PREMISA QUE NO SE USA: "no-a-la-venta" NO implica "sin descuento". Medido
 * sobre data/latest.json, 16 de los 94 congelados tienen guardado un precio con
 * forma de descuento aplicado, y uno (GP-FPS938OBJTW) recibio un -30% real el
 * 2026-09-09 leido de su propia pagina. Por eso la concesion 2 no extrapola de
 * las 4 fichas cargadas a las 94: exige los dos montos iguales EN LA LECTURA, y
 * cualquier ficha con descuento (model_price != list_price) cae sola del lado
 * seguro.
 */
export function precioAdoptable({
  precioBloque,
  precioFinal,
  modelPrice,
  listPrice,
  bloqueLegible,
  paginaNoLoVendeOnline,
  montosEnBloque = 0,
  digitalDataAsentado = true,
  bodyText,
}) {
  if (Number.isFinite(precioBloque) && precioBloque > 0) return precioBloque;

  // (d) EL BLOQUE PUBLICO MONTOS, PERO NINGUNO ES DE ESTE SKU (2026-09-13 tarde).
  //
  // Es un cuarto estado, y hasta hoy se confundia con (b) "el bloque no publica
  // monto". No son lo mismo: un bloque que escribe precios y no señala a este
  // producto es un SELECTOR hablando de sus otras variantes, o un render a
  // medias. Caer ahi en `precioFinal` -- o sea en el texto de toda la pagina --
  // es volver a abrir la puerta que este arreglo cerro, y esta MEDIDO que lo
  // hacia: con digitalData todavia sin asentar en la /buy/ del A36, el filtro
  // por candidatos devolvia null y el precio caia al model_price rancio
  // (539.990, el TACHADO) mientras el bloque ya estaba mostrando el correcto
  // (369.990). HEAD guardaba el bueno y esta version guardaba el malo: una
  // regresion, no un residuo.
  //
  // Cuando el bloque habla y no habla de este SKU, la respuesta honesta es que
  // no se sabe. El campo se omite y comparar() conserva el ultimo precio bueno.
  if (montosEnBloque > 0) return null;

  // DIGITALDATA A MEDIO HIDRATAR: NINGUNO DE SUS DOS NUMEROS ES CONFIABLE.
  //
  // Medido en vivo el 2026-09-13 sobre galaxy-a36/buy/, entrando igual que
  // produccion (waitUntil "domcontentloaded") y muestreando cada 250 ms:
  //     935 ms   model_price "539990"   list_price ""        <- el TACHADO en el
  //                                                             campo del precio
  //                                                             de venta
  //   1.310 ms   model_price "369990"   list_price "539990"  <- asentado
  // O sea que durante ~375 ms la pagina publica el precio de lista en el campo
  // del precio de venta y no publica ningun list_price. La espera que habia
  // (model_price > 0) se cumple en ese estado, asi que la lectura entraba ahi y
  // guardaba 539.990: ES el mecanismo del vaiven del A36, el SKU de 3 de los 5
  // avisos falsos del encargo. Ninguna regla de mas abajo puede detectarlo,
  // porque el bloque de compra dice lo mismo que digitalData.
  //
  // Ahora extractSingleProduct espera a que digitalData traiga los DOS campos
  // (ver esperarDigitalDataAsentado) y, si no lo logra dentro de su presupuesto,
  // esta lectura no adopta ningun numero de digitalData. Es la regla de oro del
  // proyecto: un numero que sabemos que puede ser el tachado no se guarda.
  // Lo que SI sigue mandando es la barra de precio de la ficha cuando publica su
  // monto, porque ese camino nunca dependio de digitalData (se resuelve en la
  // primera linea de esta funcion).
  if (!digitalDataAsentado) return null;

  const dosCandidatos =
    Number.isFinite(modelPrice) && Number.isFinite(listPrice) && listPrice > 0 && modelPrice !== listPrice;
  if (!bloqueLegible && dosCandidatos) return null;

  // EL BLOQUE NO ENTREGO NINGUN MONTO Y DIGITALDATA PUBLICA DOS NUMEROS
  // DISTINTOS: LA DECISION NO CAE EN EL TEXTO DE TODA LA PAGINA (2026-09-13).
  //
  // Es el ultimo tramo del vaiven, y es el MISMO defecto que el proyecto ya
  // habia cerrado para el STOCK. Hasta hoy este caso caia en `precioFinal`, o
  // sea en precioVisiblePreferido, que elige entre model_price y list_price
  // segun cual este escrito en `document.body.innerText` -- el texto de la
  // PAGINA ENTERA. Y la pagina entera esta llena de montos que no son de este
  // SKU. Las dos fichas que seguian bailando despues del arreglo del 2026-09-12
  // (las unicas dos, medido sobre los 22 snapshots de data/latest.json), con su
  // evidencia cargada en vivo el 2026-09-13:
  //
  //  - LS32DG300ELXZS: su bloque es la barra de precio de verdad
  //    (`pd-buying-price`) y dice solo "Dónde comprar". Su model_price (199.990)
  //    NO esta escrito en ninguna parte del body; su list_price (279.990) SI.
  //
  //    QUE ES CADA UNO DE ESOS DOS NUMEROS, medido en la respuesta que la PROPIA
  //    pagina le pide a api.shop.samsung.com (capturada del trafico, cero
  //    requests extra, 2026-09-13):
  //        price          = {formattedValue "$279.990", priceType "BUY"}
  //        promotionPrice = {formattedValue "$199.990"}
  //    O sea `model_price` es el precio CON la promocion aplicada y `list_price`
  //    es el de lista. Se repite identico en el A36 (price $539.990 BUY /
  //    promotionPrice $369.990). Con el bloque mudo, el unico deterministico es
  //    el primero: el de lista es, por definicion, el que el cliente NO paga.
  //
  //    (Una version anterior de este comentario decia que el 279.990 "es el
  //    precio de OTRO PRODUCTO", el Odyssey G4 del carrusel de alternativas.
  //    Es FALSO y lo desmiente la API de arriba: el numero aparece al lado del
  //    G4 en el body, pero es tambien el precio de lista de ESTE monitor. La
  //    conducta elegida no cambia; la razon si, y dejar escrita una causa falsa
  //    es caro: el que lea "el body esta contaminado por el carrusel" va a
  //    construir un filtro de carrusel que no arregla nada.)
  //  - SM-A366ELVGLTL: su /buy/ de plantilla hubble publica en el bloque el monto
  //    de cada variante, y ademas su digitalData tarda ~1,3 s en asentarse. Los
  //    DOS candidatos aparecen en el body (369.990 en el propio tool y 539.990 en
  //    la ficha de resumen, sin la etiqueta "Precio original" que lo delataria),
  //    asi que ganaba el que alcanzara a pintarse. Ver esperarDigitalDataAsentado
  //    para el mecanismo completo, medido en vivo el 2026-09-13.
  //
  // Los dos estados de la pagina tienen que dar el MISMO precio, y para eso hay
  // que dejar de mirar el body. Quedan dos salidas, y ninguna es el list_price:
  //
  //  (b) LA PAGINA DECLARA QUE NO LO VENDE ONLINE. El bloque dijo, en el mismo
  //      lugar donde escribiria el precio, que no hay precio de venta que leer
  //      ("Dónde comprar" / "No está a la venta", vocabulario cerrado de
  //      src/stock.mjs). Eso es una propiedad ESTABLE de la ficha, no una
  //      carrera: no va a pintar un monto mas tarde. El unico numero
  //      deterministico que queda es el model_price -- el campo con el que
  //      Samsung nombra el precio de venta --, y el list_price es por definicion
  //      el de lista (en el body del Z Flip7 aparece literal como "ListPrice").
  //      Es la concesion 2 de mas abajo, que hasta hoy se rendia cuando habia
  //      dos candidatos y por eso dejaba al monitor eligiendo por sorteo.
  //  (c) CUALQUIER OTRO CASO: no hay precio. Un bloque legible sin monto que NO
  //      declara nada es el Buying Tool a medio pintar, y esta medido (E9, E9b,
  //      E9c del 2026-09-12) que es indistinguible de uno que no va a escribir
  //      nunca: adoptar ahi devolvia 3 a 5 avisos falsos. El campo se omite,
  //      comparar() conserva el ultimo precio bueno y `precioIlegible` lo deja
  //      contado en `sinPrecioVisible` / `precioCongelado`, asi que el silencio
  //      es visible y no eterno.
  //
  // Lo que se pierde a proposito: la segunda linea de precioVisiblePreferido
  // (adoptar el list_price porque el model_price no esta escrito) deja de
  // alimentar una adopcion. Nacio por el pack F-SMR640SML70 (2026-08-03), cuya
  // ficha SI escribe el monto en el bloque, asi que ese caso hoy lo resuelve
  // precioDelBloqueCompra una linea mas arriba.
  if (dosCandidatos) {
    if (paginaNoLoVendeOnline && Number.isFinite(modelPrice) && modelPrice > 0) {
      if (esPrecioOriginalEscrito(modelPrice, bodyText)) return null;
      return modelPrice;
    }
    return null;
  }

  // concesion 2: un solo candidato Y la pagina declarando que no lo vende online
  if (
    !Number.isFinite(precioFinal) &&
    paginaNoLoVendeOnline &&
    Number.isFinite(modelPrice) &&
    modelPrice > 0
  ) {
    if (esPrecioOriginalEscrito(modelPrice, bodyText)) return null;
    return modelPrice;
  }
  if (esPrecioOriginalEscrito(precioFinal, bodyText)) return null;
  return precioFinal;
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
  let digitalDataListo = true;
  try {
    await page.waitForFunction(
      () => {
        const p = window.digitalData?.product?.model_price;
        const n = Number(String(p ?? "").replace(",", "."));
        return Number.isFinite(n) && n > 0;
      },
      // el 3er argumento son las OPCIONES. Hasta hoy este objeto iba en el 2o,
      // que es `arg`, y por eso el tope no se aplicaba nunca (medido: 30 s en
      // vez de los 3 s que decia la constante). Ver la nota de PRECIO_TIMEOUT_MS.
      undefined,
      { timeout: PRECIO_TIMEOUT_MS },
    );
  } catch {
    // se agoto la espera: puede ser un producto realmente dado de baja (los
    // monitores descontinuados dejan model_price en "" para siempre) o una
    // pagina lenta. Quien decide es el bloque de abajo, con el dato en mano.
    digitalDataListo = false;
  }

  // Y ADEMAS SE ESPERA A QUE digitalData TERMINE DE HIDRATARSE. La espera de
  // arriba solo exige model_price > 0, y eso se cumple mientras la pagina
  // todavia tiene el precio TACHADO en ese campo y el list_price vacio (medido
  // en vivo: ventana de 375 ms en galaxy-a36/buy/). Leer ahi era el ultimo
  // mecanismo vivo del vaiven. Ver esperarDigitalDataAsentado.
  //
  // SOLO SI LA ESPERA DE ARRIBA SE CUMPLIO, y eso no es un detalle: hay ~150
  // paginas del catalogo que legitimamente NUNCA publican precio (filtros, kits,
  // accesorios) y ahi la primera espera se agota entera. Cobrarles ademas el
  // presupuesto de hidratacion serian ~7 min por revision completa sobre paginas
  // que no tienen nada que hidratar. Es la leccion del incidente del 2026-08-02:
  // una espera nueva se mide contra el PEOR caso del catalogo, no contra el caso
  // que se esta arreglando. Si la primera espera se agoto, digitalData no esta
  // asentado por definicion y el valor `false` lo dice.
  const digitalDataAsentado = digitalDataListo ? await esperarDigitalDataAsentado(page) : false;

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

  // Antes de leer el texto de la pagina se espera a que el precio este PINTADO.
  // Sin esto la lectura corria una carrera contra el render y la misma pagina
  // devolvia dos precios distintos segun quien ganara (ver esperarMontoPintado).
  const precioLista = aNumero(digitalData.list_price);
  await esperarMontoPintado(page, [precio, precioLista]);

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
  // que no alcanzo a pintar el precio) NO HAY PRECIO: null, y mas abajo el campo
  // se omite. Inventarlo con el model_price invisible era el lado "bajo" del
  // vaiven (ver precioVisiblePreferido).
  const precioFinal = precioVisiblePreferido(precio, precioLista, bodyText);

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
  const estadoBloque = estadoDesdeBloqueCompra(bloque.texto, bloque.ctas);
  let estado = estadoBloque;
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
  //
  // Se le pasan los dos montos de digitalData porque el bloque de una pagina
  // /buy/ hubble es un SELECTOR y publica el de cada variante que ofrece: sin
  // saber cuales son los de ESTE SKU, "el primero que aparezca" es el de la
  // opcion que el selector trae elegida por omision (ver precioDelBloqueCompra).
  //
  // Y se le dice DE DONDE salio ese texto: la barra de precio de esta ficha
  // habla de un solo producto (un monto solitario manda), el Buying Tool de una
  // /buy/ habla de todas las variantes (todo monto, sea uno o sean ocho, tiene
  // que señalar a un candidato de digitalData). Medido en vivo: el tool del A36
  // a los 935 ms publica UN monto y es el tachado.
  //
  // Y CON digitalData SIN ASENTAR NO HAY CANDIDATOS QUE PASARLE. Desambiguar un
  // selector contra numeros rancios es peor que no desambiguarlo: medido en vivo,
  // a los 935 ms el Buying Tool del A36 publica un unico monto -- el TACHADO -- y
  // ese monto SI coincide con el model_price provisorio, asi que el filtro por
  // candidatos lo bendecia. Sin candidatos, el selector no decide y el precio no
  // se adopta. La barra de precio de la ficha no se ve afectada: su monto manda
  // igual, porque ese camino nunca dependio de digitalData.
  const montosEnBloque = montosDelBloqueCompra(bloque.texto);
  const precioBloque = precioDelBloqueCompra(bloque.texto, digitalDataAsentado ? [precio, precioLista] : [], {
    barraDePrecio: bloque.barraDePrecio,
  });
  // NO es `precioBloque ?? precioFinal`: ese `??` era la puerta por la que el
  // vaiven seguia entrando (ver precioAdoptable, que distingue "no pude leer el
  // bloque" de "lo lei y no publica monto").
  const precioVisto = precioAdoptable({
    precioBloque,
    precioFinal,
    modelPrice: precio,
    listPrice: precioLista,
    bloqueLegible: bloque.legible,
    // EL BLOQUE DE COMPRA DICIENDO QUE NO HAY PRECIO DE VENTA QUE LEER. Es la
    // llave de la concesion 2 de precioAdoptable y sale del vocabulario cerrado
    // de estadoDesdeBloqueCompra ("Dónde comprar" / "No está a la venta"),
    // aplicado al bloque de compra y a NADA MAS -- el mismo lugar donde la
    // pagina escribiria el precio si lo tuviera:
    //  - ni la barra pegajosa, aunque sirva para el stock: no es donde va el
    //    precio y no se midio nunca si puede decir "No está a la venta"
    //    mientras el bloque se termina de pintar;
    //  - ni la API por SKU, que describe el stock de una bodega y no lo que la
    //    ficha publica.
    // Las dos son informacion de mas, y para ESTA decision "de mas" es "todavia
    // no se": se prefiere seguir congelado a adoptar un numero que nadie vio.
    //
    // Y SOLO DESDE LA BARRA DE PRECIO DE ESTA FICHA (2026-09-13 tarde, defecto
    // medido). estadoDesdeBloqueCompra corre sobre el bloque ENTERO, y en una
    // /buy/ hubble ese bloque es el selector de grupo: su veredicto describe a
    // TODAS las variantes. Medido hoy en galaxy-a36/buy/, el selector escribe
    // "Gris increíble Agotado Grafito increíble Agotado" de otros colores, y le
    // alcanza con que la frase "no está a la venta" aparezca en cualquier parte
    // para disparar. Dejar que ese veredicto decida el PRECIO era darle la llave
    // a un texto que este mismo arreglo acaba de declarar ajeno al SKU.
    paginaNoLoVendeOnline: bloque.barraDePrecio && estadoBloque === ESTADO.NO_A_LA_VENTA,
    montosEnBloque: montosEnBloque.length,
    digitalDataAsentado,
    bodyText,
  });
  // LA API SOLO ENTRA CUANDO HAY UN PRECIO LEIDO AL QUE DESPLAZAR (2026-09-13
  // tarde, regresion medida). `montoVisible(null, bodyText)` es false, asi que
  // "no hay precio" -- la decision deliberada de callarse que toma
  // precioAdoptable -- caia directo en `precioApi`, y el precio de la API es el
  // de LISTA: medido hoy en las respuestas que la propia pagina pide, el A36
  // publica price $539.990 (priceType BUY) contra promotionPrice $369.990, y el
  // monitor LS32DG300ELXZS price $279.990 contra promotionPrice $199.990. O sea
  // que el silencio se convertia en el TACHADO, que es lo peor de los dos
  // mundos. Reproducido sobre una ficha fusionada real (el S25 FE, cuyo
  // model_code trae tres codigos): 4 avisos falsos en 5 corridas contra 0 de
  // HEAD. La regla original de esta linea -- "el precio leido no es de este SKU"
  // -- necesita que haya un precio leido; "no hubo precio que leer" es otra cosa.
  const precioElegido =
    varios && Number.isFinite(precioApi) && Number.isFinite(precioVisto) && !montoVisible(precioVisto, bodyText)
      ? precioApi
      : precioVisto;

  const salidaPropia = {
    modelo: propio,
    moneda: "CLP",
    nombre: (varios ? nombres[codigos.indexOf(propio)] : digitalData.displayName) || null,
    estadoStock: estado,
    disponible: disponibleDe(estado),
    versionStock: VERSION_STOCK,
    rango: RANGO.PROPIA,
    url,
    especificaciones: filtrarEspecificacionesUtiles(especCrudas),
    versionPrecio: VERSION_PRECIO,
  };

  // EL CAMPO SE OMITE, NO SE PONE EN null (medido). Un `precio: null` PISA el
  // precio guardado (`{...ant, ...obs}` en comparar.mjs) y lo deja en null sin
  // emitir nada; la corrida siguiente lee "antes no habia precio" y anuncia
  // "nuevo". Con el campo AUSENTE, el precio bueno se conserva y nadie se entera
  // de nada, que es justo lo que tiene que pasar cuando la pagina no se dejo
  // leer. Mismo criterio que ESTADO.DESCONOCIDO para el stock: "no lo se" no es
  // un valor, es la ausencia de uno.
  if (Number.isFinite(precioElegido) && precioElegido > 0) {
    salidaPropia.precio = precioElegido;
    // ESTE PRECIO SE ADOPTO A CIEGAS, Y SE DEJA DICHO (2026-09-13 tarde).
    // Cuando la pagina declara que no la vende online no hay NINGUN monto
    // dibujado contra el cual contrastar el numero: se adopta el model_price
    // porque es el unico deterministico que queda, no porque se haya visto. Si
    // alguna vez ese campo trae un numero raro, nada lo delataria. El contador
    // sale en el resumen de la corrida al lado de precioCongelado para que la
    // poblacion sea visible desde el primer dia.
    if (!Number.isFinite(precioBloque) && bloque.barraDePrecio && estadoBloque === ESTADO.NO_A_LA_VENTA) {
      salidaPropia.precioDeclarado = true;
    }
  } else {
    // diagnostico de ESTA lectura (no del producto): run.mjs lo cuenta en el
    // resumen y comparar.mjs lo borra antes de guardar el registro
    salidaPropia.precioIlegible = true;
  }
  // Diagnostico de la hidratacion, tambien de ESTA lectura. Se escribe aunque el
  // precio se haya podido leer de la barra, porque lo que mide es cuantas
  // paginas no alcanzan a asentar digitalData dentro del presupuesto: es el
  // numero con el que se decide, con datos de produccion y no de escritorio, si
  // HIDRATACION_TIMEOUT_MS quedo corto.
  if (!digitalDataAsentado) salidaPropia.digitalDataSinAsentar = true;

  // Rastro para que comparar() pueda distinguir una CORRECCION de fuente de una
  // baja de verdad: los dos numeros que la pagina publica y que este arreglo YA
  // NO elige. Solo se escriben cuando difieren del elegido (medido: ~4% de las
  // fichas para el tachado), asi que no engordan data/latest.json ni el
  // historial, y comparar() los borra del registro.
  //  - precioTachado: el "Precio original" (list_price visible).
  //  - precioInterno: el model_price, que en las fichas con descuento es un
  //    numero que NO aparece en la pagina (medido: 479.990 en SM-X520NLBACHO,
  //    199.990 en LS32DG300ELXZS). Sin este rastro, la primera corrida con el
  //    arreglo avisaria como "subio" cada SKU que hoy tiene guardado ese numero.
  //
  // EL TACHADO SE ANOTA SIEMPRE QUE EXISTA Y NO SEA EL ADOPTADO, no solo cuando
  // el bloque de compra se dejo leer (2026-09-12, defecto medido). La guarda
  // anterior exigia `Number.isFinite(precioBloque)`, asi que justo en el caso
  // que produce el aviso falso -- bloque ilegible -- el rastro NO se escribia y
  // la amnistia de la migracion no podia taparlo.
  if (Number.isFinite(precioLista) && precioLista > 0 && precioLista !== salidaPropia.precio) {
    salidaPropia.precioTachado = precioLista;
  }
  if (Number.isFinite(precio) && precio !== salidaPropia.precio) {
    salidaPropia.precioInterno = precio;
  }
  return salidaPropia;
}
