// COMO SE RESUELVE UNA PAGINA. Se saco de run.mjs (que arranca main() al
// importarse) para poder probarlo: la decision de cuando se abre el navegador y
// cuando basta el HTML plano es justo donde vivia el defecto del stock declarado.
import { USER_AGENT } from "./config.mjs";
import { clasificarVariantesFamilia, extractSingleProduct, PaginaAjena, RE_API_PRODUCTOS } from "./extract.mjs";
import { ESTADO } from "./stock.mjs";

// Una pagina puede resolverse por dos caminos:
//  1) paginas de GRUPO (/buy/ que publican VARIAS variantes: Tab S9 FE, Book3,
//     Z Flip7): el precio de cada variante viene en el JSON-LD del HTML plano
//     -- barato, sin navegador, y es la unica fuente por variante.
//  2) el resto, INCLUIDAS las /buy/ que publican UNA sola variante: el precio y
//     sobre todo el BOTON de compra solo existen tras render real -> Playwright.
// Devuelve tambien POR CUAL camino se resolvio: los nombres del JSON-LD de la
// pagina familia traen capacidad/RAM/color y sirven para el titulo, los de
// digitalData no (ver src/titulo.mjs).
export async function procesarEntrada(entry, context, timeoutMs) {
  let variants = [];
  let porJsonLd = [];
  if (entry.url.endsWith("/buy/")) {
    try {
      const res = await fetch(entry.url, { headers: { "User-Agent": USER_AGENT } });
      if (res.ok) {
        // res.url es la URL FINAL: fetch sigue las redirecciones. Samsung manda
        // las fichas que deja de vender a la de un hermano, y sin ese dato los
        // productos del hermano quedaban anotados como si fueran de esta entrada
        // (ver src/identidad.mjs).
        const { propias, ajenas } = clasificarVariantesFamilia(await res.text(), {
          urlPedida: entry.url,
          urlFinal: res.url,
        });
        porJsonLd = propias;
        // El JSON-LD se leyo bien y NADA de lo que publica es de esta entrada:
        // no vale la pena gastar una carga de navegador para confirmarlo.
        if (propias.length === 0 && ajenas.length > 0) {
          throw new PaginaAjena(entry.url, res.url, ajenas.map((v) => v.modelo));
        }
      }
    } catch (err) {
      if (err?.ajena) throw err;
      // cualquier otro problema (red, HTML raro): cae al camino del navegador
    }
  }
  // VARIAS variantes: es una pagina de GRUPO de verdad (Tab S9 FE, Book3, Z
  // Flip7...). Su bloque de compra es un selector que no se puede atribuir a
  // ningun SKU, asi que abrir el navegador no aportaria un stock mejor, y el
  // JSON-LD es la unica fuente con precio POR VARIANTE. Se resuelve barata.
  if (porJsonLd.length > 1) return { variants: porJsonLd, via: "familia" };

  // UNA sola variante: esa pagina /buy/ es, en la practica, la FICHA PROPIA de
  // ese SKU, y cortar aca era el defecto 2 de la revision. El `availability` del
  // JSON-LD es un dato DECLARADO y miente: medido el 2026-09-11 en
  // galaxy-book4-15-6-inch-13th-core-5-16gb-1tb-np750xgj-ks4cl/buy/, el JSON-LD
  // dice "inStock" mientras el bloque de compra de esa misma pagina dice
  // "Avísame" (y la API, outOfStock). Como esa pagina es la UNICA fuente de ese
  // SKU, el rango FAMILIA no salvaba nada: no hay ninguna observacion PROPIA con
  // que arbitrar y el catalogo guardaba "disponible" de un producto agotado.
  // Son 71 paginas de las ~1170 (medido sobre data/latest.json), asi que el
  // costo es del orden de 7 min de corrida.
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
    // "domcontentloaded" en vez de "load": no hace falta esperar a que terminen
    // de bajar imagenes y scripts de terceros, porque el precio NO viene en la
    // carga inicial igual -- lo pide la pagina despues, y extractSingleProduct
    // lo espera explicitamente. Medido el 2026-08-02 sobre 10 paginas reales de
    // tipos distintos (accesorio sin precio, smartphone, tablet, multi-producto,
    // TV, linea blanca, monitor, reloj): resultado IDENTICO en precio, stock y
    // especificaciones en las 10, con 3,12 s de ahorro promedio por pagina
    // = ~61 min menos por corrida sobre 1168 paginas.
    await page.goto(entry.url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
    const salida = await extractSingleProduct(page, entry.url, respuestasApi);
    variants = Array.isArray(salida) ? salida : salida ? [salida] : [];
  } catch (err) {
    // una redireccion es informacion, no un fallo: sigue subiendo. Y si no habia
    // JSON-LD de respaldo, tampoco hay nada que rescatar.
    if (err?.ajena || porJsonLd.length === 0) throw err;
    console.error(`WARNING ${entry.url}: el navegador fallo (${err.message}); se conserva el precio del JSON-LD y el stock queda desconocido`);
  } finally {
    await page.close();
  }

  if (variants.length === 0 && porJsonLd.length > 0) {
    // RED DE SEGURIDAD de la decision de arriba: si el navegador no pudo con esta
    // pagina, el SKU NO se pierde (perderlo lo declararia desaparecido en 2
    // corridas). Se conserva el precio del JSON-LD y se renuncia al stock: la
    // disponibilidad declarada es justo el dato que se demostro falso, y
    // "desconocido" no cambia el estado ni notifica nada.
    return {
      variants: porJsonLd.map((v) => ({ ...v, estadoStock: ESTADO.DESCONOCIDO, disponible: null })),
      via: "familia",
    };
  }

  // El nombre del JSON-LD trae capacidad/RAM/color y el de digitalData no
  // ("Galaxy Z Fold7 256 GB｜12 GB Azul Intenso" contra "Galaxy Z Fold7"): al
  // pasar estas paginas por el navegador habria que perderlo, asi que se
  // reinyecta por SKU y se declara via "familia" para que catalogo.mjs lo guarde
  // como nombreFamilia. El rango sigue siendo el que trae cada variante (PROPIA).
  if (porJsonLd.length > 0) {
    const nombres = new Map(porJsonLd.filter((v) => v.nombre).map((v) => [v.modelo, v.nombre]));
    return {
      variants: variants.map((v) => ({ ...v, nombre: nombres.get(v.modelo) ?? v.nombre })),
      via: "familia",
    };
  }
  return { variants, via: "individual" };
}
