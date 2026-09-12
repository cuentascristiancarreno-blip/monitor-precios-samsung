// SEGUNDA VUELTA DEL ARREGLO DEL VAIVEN (2026-09-12, tarde).
//
// La primera vuelta puso la regla "no inventar un precio" en
// precioVisiblePreferido, que lee document.body.innerText. Tres verificadores
// independientes midieron que el vaiven seguia vivo: el numero que de verdad
// gana sale de una SEGUNDA lectura, la del bloque de compra, que es otro
// page.evaluate, posterior, por selector y envuelto en `.catch(() => null)`. La
// linea `precioBloque ?? precioFinal` hacia que el fallo de esa lectura cayera
// directo al TACHADO -- el numero exacto al que saltaba el vaiven historico --
// sin marca, sin rastro y sin que la instrumentacion lo viera.
//
// Este archivo fija las conductas de la segunda vuelta. Cada prueba muere si se
// deshace su pieza (comprobado con mutantes, ver BITACORA.md):
//   1. el bloque de compra distingue "no pude leer" de "lei y no hay monto"
//   2. un monto marcado "Precio original" no se adopta nunca
//   3. versionPrecio solo se compromete con lectura util
//   4. conservaPrecio exige el MISMO rango (no disfraza el precio de la familia)
//   5. la fuente DEL PRECIO se guarda aparte del origen del registro
//   6. un rango menor no pisa el precio, pero tiene tope de corridas
//   7. la corroboracion exige la misma pagina que propuso el valor
//   8. la correccion de la migracion sale por el canal tecnico, no en silencio
//   9. un producto nuevo a la venta sin precio se anuncia igual
//  10. la espera del render tiene presupuesto propio y el timeout va en OPCIONES
import { test } from "node:test";
import assert from "node:assert/strict";
import { extractSingleProduct, esPrecioOriginalEscrito, precioAdoptable, VERSION_PRECIO } from "../src/extract.mjs";
import { integrarVariantes } from "../src/catalogo.mjs";
import { comparar, marcarSinPrecioProlongado, UMBRAL_PRECIO_OTRA_FUENTE, UMBRAL_SIN_VERIFICAR } from "../src/comparar.mjs";
import { RANGO } from "../src/identidad.mjs";
import { DELAY_MS } from "../src/config.mjs";
import { mensajeCorreccionesDePrecio, notifyDiscord } from "../src/discord.mjs";

process.env.DISCORD_PAUSA_MS = "0";

// --- la ficha medida en vivo, con sus textos literales -----------------------

const TAB = {
  sku: "SM-X520NLBACHO",
  url: "https://www.samsung.com/cl/tablets/galaxy-tab-s/galaxy-tab-s10-fe-blue-128gb-sm-x520nlbacho/",
  familia: "https://www.samsung.com/cl/tablets/galaxy-tab-s10-fe/buy/",
  modelPrice: "479990",
  listPrice: "729990",
  bloque: "Desde $ 54.749 en 12 cuotas sin intereses* o $656.990 Precio original: $729.990 Ahorra $ 73.000 *Aplican condiciones Comprar",
  body: "Galaxy Tab S10 FE\nDesde $ 54.749 en 12 cuotas sin intereses* o $656.990\nPrecio original: $729.990\nAhorra $ 73.000\nComprar",
  cobra: 656990,
  tachado: 729990,
  interno: 479990,
};

// La MISMA forma, pero SIN la etiqueta "Precio original" escrita en la pagina.
// Es la ficha del Tab S10+ (SM-X620NZAACHO, medida: model 689.990 invisible ·
// list 899.990 visible · el cliente paga 809.990). Importa que exista como caso
// aparte: si todas las pruebas usaran una pagina que SI escribe "Precio
// original", la etiqueta taparia el agujero de verdad -- que el bloque de compra
// ilegible no puede hacer caer el precio al tachado -- y ese agujero quedaria
// sin una sola prueba que lo fije (comprobado: dos mutantes sobrevivian).
const SIN_ETIQUETA = {
  sku: "SM-X620NZAACHO",
  url: "https://www.samsung.com/cl/tablets/galaxy-tab-s/galaxy-tab-s10-plus-gray-256gb-sm-x620nzaacho/",
  modelPrice: "689990",
  listPrice: "899990",
  bloque: "Desde $ 67.499 en 12 cuotas sin intereses* o $809.990 Comprar",
  body: "Galaxy Tab S10+\n$899.990\nDesde $ 67.499 en 12 cuotas sin intereses* o $809.990\nComprar",
  cobra: 809990,
  tachado: 899990,
};

/**
 * Doble de pagina con las DOS lecturas del DOM separadas. `bloque` puede ser:
 *   "auto"     acompana al body
 *   "ilegible" el evaluate revienta (es lo que atrapa el `.catch(() => null)`)
 *   "vacio"    el elemento existe pero todavia no tiene texto
 *   <string>   un texto propio
 * `llamadas` deja ver con que argumentos se llamo a waitForFunction.
 */
function pagina(ficha, { bloque = "auto", bodyPintado = true } = {}) {
  let evaluaciones = 0;
  const llamadas = [];
  const bloqueLeido = () => {
    if (bloque === "ilegible") throw new Error("evaluate fallido");
    if (bloque === "vacio") return { texto: "", ctas: [], ctasBarra: [] };
    if (bloque === "auto") return { texto: ficha.bloque, ctas: ["Comprar"], ctasBarra: [] };
    return { texto: bloque, ctas: ["Comprar"], ctasBarra: [] };
  };
  return {
    llamadas,
    async waitForFunction(fn, arg, opciones) {
      llamadas.push({ arg, opciones });
    },
    async evaluate() {
      evaluaciones += 1;
      if (evaluaciones === 1) {
        return { model_price: ficha.modelPrice, list_price: ficha.listPrice, model_code: ficha.sku, displayName: "Producto" };
      }
      if (evaluaciones === 2) return bodyPintado ? ficha.body : "";
      if (evaluaciones === 3) return bloqueLeido();
      return {};
    },
  };
}

const registro = (extra) => ({
  nombre: "Producto",
  moneda: "CLP",
  categoria: "Tablets",
  presencia: "activo",
  ausencias: 0,
  notificadoDesaparecido: false,
  estadoStock: "disponible",
  disponible: true,
  versionStock: 2,
  ...extra,
});

const entrada = (url) => ({ url, categoria: "Tablets", subcategoria: null, variante: null });

function observar(salida, url = TAB.url, via = "individual", categoria = "Tablets") {
  const observado = {};
  integrarVariantes(observado, { ...entrada(url), categoria }, [salida], { via, timestamp: "T" });
  return observado;
}

const corrida = (previo, observado, timestamp = "T") =>
  comparar({ previo, observado, paginasFallidas: new Set(), corridaConfiable: true, timestamp });

const desdeFicha = (precio, extra = {}) => ({
  modelo: TAB.sku,
  precio,
  moneda: "CLP",
  rango: RANGO.PROPIA,
  estadoStock: "disponible",
  disponible: true,
  url: TAB.url,
  versionPrecio: VERSION_PRECIO,
  ...extra,
});

const desdeFamilia = (precio) => ({
  modelo: TAB.sku,
  nombre: "Galaxy Tab S10 FE 128 GB",
  precio,
  moneda: "CLP",
  rango: RANGO.FAMILIA,
  estadoStock: "disponible",
  disponible: true,
  url: TAB.familia,
});

const guardado = (precio, extra = {}) =>
  registro({ modelo: TAB.sku, precio, url: TAB.url, paginaOrigen: TAB.url, rango: RANGO.PROPIA, versionPrecio: VERSION_PRECIO, ...extra });

// === 1. el bloque de compra: "no pude leer" no es "lei y no hay monto" =======

test("bloque ILEGIBLE con el tachado escrito en la pagina: NO se adopta el tachado", async () => {
  // EL DEFECTO MEDIDO. El body esta pintado y completo (o sea, la espera del
  // render se cumplio); lo unico que falla es la segunda lectura, la del bloque
  // de compra. Antes `precioBloque ?? precioFinal` devolvia 729.990 -- el
  // tachado, el numero exacto al que saltaba el vaiven -- y encima sin marcar la
  // lectura como fallida, asi que ni corridasSinPrecio ni sinPrecioVisible lo veian.
  const r = await extractSingleProduct(pagina(TAB, { bloque: "ilegible" }), TAB.url);
  assert.equal("precio" in r, false, "sin poder leer el bloque no se sabe cuanto se cobra");
  assert.equal(r.precioIlegible, true, "y la lectura queda marcada: la contracara tiene que ser visible");
  assert.equal(r.precioTachado, TAB.tachado, "el tachado queda como RASTRO, para que la migracion pueda taparlo");
});

test("un bloque que todavia no tiene texto cuenta como ilegible, no como 'sin precio'", async () => {
  const r = await extractSingleProduct(pagina(TAB, { bloque: "vacio" }), TAB.url);
  assert.equal("precio" in r, false, "un bloque vacio es un bloque a medio pintar");
  assert.equal(r.precioIlegible, true);
});

test("la barra pegajosa sin la frase de cuotas tampoco hace adoptar el tachado", async () => {
  // medido en produccion: el PRIMER selector de la lista es
  // [class*='pd-buying-price'], que el propio codigo describe como "barra de
  // precio + CTA". Si lo que entrega es "$729.990 Comprar", precioDelBloqueCompra
  // no encuentra la frase " o $" y devuelve null.
  const r = await extractSingleProduct(pagina(TAB, { bloque: "$729.990 Comprar" }), TAB.url);
  assert.notEqual(r.precio, TAB.tachado, "el tachado no puede colarse por la puerta de atras");
});

test("el vaiven completo: 5 corridas alternando la legibilidad del bloque, CERO avisos", async () => {
  // Reproduccion literal del experimento del verificador (EXP-9): misma URL,
  // mismo rango, body identico y pintado en las 5 corridas, versionPrecio ya
  // sellado. Lo unico que alterna es si el bloque de compra se deja leer.
  // Antes: c1 656.990 · c2 SUBE · c3 BAJA · c4 SUBE · c5 BAJA (4 avisos falsos).
  let catalogo = { [TAB.sku]: guardado(TAB.cobra) };
  const avisos = [];
  for (const bloque of ["auto", "ilegible", "auto", "ilegible", "auto"]) {
    const obs = await extractSingleProduct(pagina(TAB, { bloque }), TAB.url);
    const paso = corrida(catalogo, observar(obs));
    catalogo = paso.catalogo;
    avisos.push(...paso.cambios);
  }
  assert.deepEqual(avisos, [], "el vaiven no puede producir un solo aviso");
  assert.equal(catalogo[TAB.sku].precio, TAB.cobra, "y el precio bueno queda intacto");
});

test("un bloque LEGIBLE sin monto si deja adoptar lo escrito: no se congela nada", async () => {
  // el otro lado de la moneda. El monitor LS32DG300ELXZS y el control remoto
  // AR-KH00E no se venden online y su bloque dice "Dónde comprar": eso es una
  // propiedad ESTABLE de la pagina, no una carrera. Ahi el numero escrito vale.
  const MONITOR = {
    sku: "LS32DG300ELXZS",
    modelPrice: "199990",
    listPrice: "279990",
    bloque: "Dónde comprar",
    body: "Odyssey G3 32''\n$279.990\nDónde comprar",
  };
  const r = await extractSingleProduct(pagina(MONITOR, {}), "https://x/monitor");
  assert.equal(r.precio, 279990, "lo unico escrito en la pagina es el precio de la pagina");
});

test("con UN solo candidato el bloque ilegible no bloquea la lectura", async () => {
  // sin dos numeros distintos no hay carrera posible: la pagina devuelve siempre
  // lo mismo. Exigir el bloque ahi congelaria fichas que hoy no producen ni un
  // aviso falso.
  const UNICO = { sku: "AR-KH00E", modelPrice: "47020", listPrice: "47020", bloque: "", body: "Control remoto\n$47.020" };
  const r = await extractSingleProduct(pagina(UNICO, { bloque: "ilegible" }), "https://x/control");
  assert.equal(r.precio, 47020);
});

test("sin etiqueta 'Precio original', el bloque ilegible TAMPOCO adopta el tachado", async () => {
  // LA PRUEBA QUE DE VERDAD FIJA LA PIEZA. Aca la pagina no escribe ninguna
  // etiqueta: lo unico que impide adoptar los $899.990 es que el bloque de
  // compra no se dejo leer y que digitalData publica DOS candidatos distintos.
  const legible = await extractSingleProduct(pagina(SIN_ETIQUETA, {}), SIN_ETIQUETA.url);
  assert.equal(legible.precio, SIN_ETIQUETA.cobra, "con el bloque legible manda el monto del bloque");

  const ilegible = await extractSingleProduct(pagina(SIN_ETIQUETA, { bloque: "ilegible" }), SIN_ETIQUETA.url);
  assert.equal("precio" in ilegible, false, "sin bloque legible no se sabe: el tachado NO es el precio");
});

test("y el vaiven de esa ficha tampoco produce avisos en 5 corridas", async () => {
  const sku = SIN_ETIQUETA.sku;
  let catalogo = {
    [sku]: registro({ modelo: sku, precio: SIN_ETIQUETA.cobra, url: SIN_ETIQUETA.url, paginaOrigen: SIN_ETIQUETA.url, rango: RANGO.PROPIA, versionPrecio: VERSION_PRECIO }),
  };
  const avisos = [];
  for (const bloque of ["auto", "ilegible", "auto", "ilegible", "auto"]) {
    const obs = await extractSingleProduct(pagina(SIN_ETIQUETA, { bloque }), SIN_ETIQUETA.url);
    const observado = {};
    integrarVariantes(observado, entrada(SIN_ETIQUETA.url), [obs], { via: "individual", timestamp: "T" });
    const paso = comparar({ previo: catalogo, observado, paginasFallidas: new Set(), corridaConfiable: true, timestamp: "T" });
    catalogo = paso.catalogo;
    avisos.push(...paso.cambios);
  }
  assert.deepEqual(avisos, [], "ni un aviso: es el vaiven historico de este SKU");
  assert.equal(catalogo[sku].precio, SIN_ETIQUETA.cobra);
});

// === 2. el monto que la propia pagina marca como TACHADO =====================

test("esPrecioOriginalEscrito reconoce la etiqueta que Samsung escribe", () => {
  assert.equal(esPrecioOriginalEscrito(TAB.tachado, TAB.body), true);
  assert.equal(esPrecioOriginalEscrito(TAB.cobra, TAB.body), false, "el precio cobrado no esta tachado");
  assert.equal(esPrecioOriginalEscrito(279990, "Odyssey G3\n$279.990\nDónde comprar"), false, "sin etiqueta no hay tachado");
});

test("un monto marcado 'Precio original' no se adopta ni con el bloque legible", () => {
  // el bloque se leyo y no publica monto, pero lo unico escrito en la pagina es
  // el precio de ANTES: adoptarlo seria avisar una suba que no existe.
  const elegido = precioAdoptable({
    precioBloque: null,
    precioFinal: TAB.tachado,
    modelPrice: TAB.interno,
    listPrice: TAB.tachado,
    bloqueLegible: true,
    bodyText: TAB.body,
  });
  assert.equal(elegido, null);
});

// === 3. versionPrecio solo se compromete con lectura util =====================

test("una corrida sin precio NO gasta la ventana de migracion del SKU", () => {
  // 50 SKU tienen HOY guardado uno de los dos numeros del baile. Bastaba con que
  // su ficha no alcanzara a pintar UNA vez para que versionPrecio quedara sellado
  // en 3 sin haber aprendido nada, y la primera lectura buena saliera como
  // "subio +37%" -- el aviso falso que la migracion existe para evitar.
  const previo = { [TAB.sku]: guardado(TAB.interno, { versionPrecio: 2 }) };

  const sinLectura = corrida(previo, observar(desdeFicha(undefined, { precioIlegible: true })), "T1");
  assert.deepEqual(sinLectura.cambios, []);
  assert.equal(sinLectura.catalogo[TAB.sku].versionPrecio, 2, "no hubo lectura util: la version NO se compromete");
  assert.equal(sinLectura.catalogo[TAB.sku].precio, TAB.interno);

  const buena = corrida(sinLectura.catalogo, observar(desdeFicha(TAB.cobra, { precioInterno: TAB.interno, precioTachado: TAB.tachado })), "T2");
  assert.deepEqual(buena.cambios, [], "la correccion se adopta sin aviso de precio");
  assert.equal(buena.catalogo[TAB.sku].precio, TAB.cobra);
  assert.equal(buena.catalogo[TAB.sku].versionPrecio, VERSION_PRECIO, "recien ahora se sella");
});

// === 4. conservaPrecio exige el MISMO rango ==================================

test("el precio de LISTA de la familia no se disfraza de ficha propia", () => {
  // Con el reintento del final de run.mjs, la pagina familia se integra ANTES
  // que la ficha propia lenta. Sin la comprobacion de rango, el 729.990 del
  // JSON-LD se copiaba al registro y quedaba firmado `rango: 3, paginaOrigen:
  // <ficha propia>`: con ese disfraz la guardia de comparar() lo veia como
  // "misma fuente" y avisaba AL TIRO.
  const observado = {};
  integrarVariantes(observado, { ...entrada(TAB.familia), categoria: "Familia (auto-descubierta)" }, [desdeFamilia(TAB.tachado)], { via: "familia", timestamp: "T" });
  integrarVariantes(observado, entrada(TAB.url), [desdeFicha(undefined, { precioIlegible: true })], { via: "individual", timestamp: "T" });

  assert.equal(Number.isFinite(observado[TAB.sku].precio), false, "una pagina de menos rango no le presta su precio a la ficha propia");

  const paso = corrida({ [TAB.sku]: guardado(TAB.cobra) }, observado);
  assert.deepEqual(paso.cambios, [], "y por lo tanto no sale ningun aviso");
  assert.equal(paso.catalogo[TAB.sku].precio, TAB.cobra);
});

test("el resultado no depende del ORDEN en que llegan las paginas", () => {
  const fichaPrimero = {};
  integrarVariantes(fichaPrimero, entrada(TAB.url), [desdeFicha(undefined, { precioIlegible: true })], { via: "individual", timestamp: "T" });
  integrarVariantes(fichaPrimero, { ...entrada(TAB.familia), categoria: "Familia (auto-descubierta)" }, [desdeFamilia(TAB.tachado)], { via: "familia", timestamp: "T" });

  const familiaPrimero = {};
  integrarVariantes(familiaPrimero, { ...entrada(TAB.familia), categoria: "Familia (auto-descubierta)" }, [desdeFamilia(TAB.tachado)], { via: "familia", timestamp: "T" });
  integrarVariantes(familiaPrimero, entrada(TAB.url), [desdeFicha(undefined, { precioIlegible: true })], { via: "individual", timestamp: "T" });

  assert.equal(fichaPrimero[TAB.sku].precio, familiaPrimero[TAB.sku].precio, "mismo insumo, mismo resultado");
  assert.equal(fichaPrimero[TAB.sku].rango, familiaPrimero[TAB.sku].rango);
});

test("dos paginas del MISMO rango si se prestan el precio (para eso existe la regla)", () => {
  // 135 SKU se scrapean dos veces por corrida y las dos paginas valen PROPIA:
  // que una no logre leer el precio no puede borrar el que la otra si leyo.
  const observado = {};
  integrarVariantes(observado, entrada(TAB.url), [desdeFicha(TAB.cobra)], { via: "individual", timestamp: "T" });
  integrarVariantes(observado, entrada(`${TAB.url}buy/`), [{ ...desdeFicha(undefined, { precioIlegible: true }), url: `${TAB.url}buy/` }], { via: "individual", timestamp: "T" });
  assert.equal(observado[TAB.sku].precio, TAB.cobra);
});

// === 5. la fuente DEL PRECIO viaja aparte del origen del registro =============

test("el registro recuerda de que pagina salio el precio que conserva", () => {
  const previo = { [TAB.sku]: guardado(TAB.cobra) };
  const soloFamilia = observar(desdeFamilia(TAB.tachado), TAB.familia, "familia", "Familia (auto-descubierta)");
  const paso = corrida(previo, soloFamilia, "T1");

  assert.deepEqual(paso.cambios, []);
  const rec = paso.catalogo[TAB.sku];
  assert.equal(rec.precio, TAB.cobra, "el precio conservado es el de la ficha propia");
  assert.equal(rec.rango, RANGO.FAMILIA, "pero el registro lo escribio hoy la familia");
  assert.deepEqual(rec.fuentePrecio, { rango: RANGO.PROPIA, pagina: TAB.url }, "y por eso la fuente del PRECIO se anota aparte");
});

test("una lectura que CONFIRMA el precio se lo apropia, y el campo desaparece", () => {
  // 97 registros reales de data/latest.json no tienen `rango` (los escribio una
  // version anterior). Sin esta regla, la primera corrida les agregaba
  // `fuentePrecio` a todos aunque nadie hubiera cambiado de precio: un campo
  // nuevo en cada registro de un archivo que vive en un repo publico.
  const sinRango = registro({ modelo: TAB.sku, precio: TAB.cobra, url: TAB.url, paginaOrigen: TAB.url, versionPrecio: VERSION_PRECIO });
  delete sinRango.rango;
  const paso = corrida({ [TAB.sku]: sinRango }, observar(desdeFicha(TAB.cobra)));
  assert.deepEqual(paso.cambios, []);
  assert.equal(paso.catalogo[TAB.sku].fuentePrecio, undefined, "confirmar el precio es ser duenno de el");
});

test("...pero una pagina de MENOS rango no se apropia del precio por repetirlo", () => {
  const previo = { [TAB.sku]: guardado(TAB.cobra) };
  const paso = corrida(previo, observar(desdeFamilia(TAB.cobra), TAB.familia, "familia", "Familia (auto-descubierta)"));
  assert.deepEqual(paso.cambios, []);
  assert.deepEqual(paso.catalogo[TAB.sku].fuentePrecio, { rango: RANGO.PROPIA, pagina: TAB.url }, "la ficha propia sigue siendo la duenna");
});

test("alternancia estricta de fuente: la baja real se avisa en la primera corrida", () => {
  // Medido por el verificador: con el origen deducido del registro, una ficha
  // propia que cae una corrida si y otra no dejaba el precio CONGELADO en 21
  // corridas (3 dias) mientras Samsung bajaba de verdad, porque el pendiente se
  // pisaba cada vez y nunca se corroboraba.
  const previo = { [TAB.sku]: guardado(TAB.cobra) };
  const c1 = corrida(previo, observar(desdeFamilia(TAB.tachado), TAB.familia, "familia", "Familia (auto-descubierta)"), "T1");
  assert.deepEqual(c1.cambios, []);

  const c2 = corrida(c1.catalogo, observar(desdeFicha(599990)), "T2");
  assert.equal(c2.cambios.length, 1, "la ficha propia es la MISMA que escribio el precio guardado: se avisa al tiro");
  assert.equal(c2.cambios[0].tipo, "baja");
  assert.equal(c2.cambios[0].precioAnterior, TAB.cobra);
  assert.equal(c2.catalogo[TAB.sku].precio, 599990);
  assert.equal(c2.catalogo[TAB.sku].fuentePrecio, undefined, "y el campo desaparece cuando ya no hace falta");
});

// === 6 y 7. rango menor con tope, y corroboracion por la MISMA pagina =========

test("dos paginas distintas que publican el mismo numero no se corroboran entre si", () => {
  // la regla anterior confirmaba cualquier valor repetido dos corridas, mirara
  // quien lo repitiera.
  const previo = { [TAB.sku]: guardado(TAB.cobra) };
  const gemelaA = `${TAB.url}buy/`;
  const gemelaB = `${TAB.url}comprar/`;

  const t1 = corrida(previo, observar({ ...desdeFicha(TAB.tachado), url: gemelaA }, gemelaA), "T1");
  assert.deepEqual(t1.cambios, []);
  assert.equal(t1.catalogo[TAB.sku].precioPendiente, TAB.tachado);

  const t2 = corrida(t1.catalogo, observar({ ...desdeFicha(TAB.tachado), url: gemelaB }, gemelaB), "T2");
  assert.deepEqual(t2.cambios, [], "otra pagina repitiendo el mismo numero no lo confirma");
  assert.equal(t2.catalogo[TAB.sku].precio, TAB.cobra);
});

test("la MISMA pagina que lo propuso si lo corrobora", () => {
  const previo = { [TAB.sku]: guardado(TAB.cobra) };
  const gemela = `${TAB.url}buy/`;
  const obs = () => observar({ ...desdeFicha(699990), url: gemela }, gemela);

  const t1 = corrida(previo, obs(), "T1");
  assert.deepEqual(t1.cambios, []);
  const t2 = corrida(t1.catalogo, obs(), "T2");
  assert.equal(t2.cambios.length, 1, "mismo rango, misma pagina, dos corridas: es el precio nuevo");
  assert.equal(t2.catalogo[TAB.sku].precio, 699990);
});

// === 8. la correccion de la migracion sale por el canal tecnico ===============

test("la correccion de fuente no es un aviso de precio, pero tampoco es silencio", () => {
  const previo = { [TAB.sku]: guardado(TAB.tachado, { versionPrecio: 2 }) };
  const paso = corrida(previo, observar(desdeFicha(TAB.cobra, { precioTachado: TAB.tachado, precioInterno: TAB.interno })));

  assert.deepEqual(paso.cambios, [], "no puede salir como 'bajo 10%': el producto no bajo, se leia mal");
  assert.equal(paso.correccionesDePrecio.length, 1, "pero queda constancia por el canal tecnico");
  assert.deepEqual(
    { modelo: paso.correccionesDePrecio[0].modelo, de: paso.correccionesDePrecio[0].precioAnterior, a: paso.correccionesDePrecio[0].precio },
    { modelo: TAB.sku, de: TAB.tachado, a: TAB.cobra },
  );
  assert.equal(paso.catalogo[TAB.sku].precio, TAB.cobra);
});

test("una oferta que estrena el dia de la migracion NO se pierde del todo", () => {
  // El caso que el verificador midio y que la adopcion silenciosa se tragaba
  // entero: ayer el producto valia $729.990 DE VERDAD (sin oferta), hoy estrena
  // descuento y la pagina tacha ese mismo numero como "Precio original". Desde
  // UNA lectura las dos historias son identicas, asi que el monitor no puede
  // decidir: lo que no puede es callarse y quedarse sin segunda oportunidad
  // (versionPrecio queda sellado y el cambio ya esta adoptado).
  const previo = { [TAB.sku]: guardado(TAB.tachado, { versionPrecio: 2 }) };
  const paso = corrida(previo, observar(desdeFicha(599990, { precioTachado: TAB.tachado })));
  assert.deepEqual(paso.cambios, []);
  assert.equal(paso.correccionesDePrecio.length, 1, "una baja real del 18% tiene que quedar a la vista en alguna parte");
  assert.equal(paso.correccionesDePrecio[0].precio, 599990);
});

test("la ventana se cierra: a la corrida siguiente el mismo SKU ya avisa normal", () => {
  const previo = { [TAB.sku]: guardado(TAB.tachado, { versionPrecio: 2 }) };
  const t1 = corrida(previo, observar(desdeFicha(TAB.cobra, { precioTachado: TAB.tachado })), "T1");
  const t2 = corrida(t1.catalogo, observar(desdeFicha(599990, { precioTachado: TAB.tachado })), "T2");
  assert.equal(t2.cambios.length, 1, "la adopcion silenciosa vale UNA vez por SKU");
  assert.equal(t2.cambios[0].tipo, "baja");
  assert.deepEqual(t2.correccionesDePrecio, []);
});

test("el aviso tecnico de correcciones dice los dos numeros y pone las bajas primero", () => {
  const texto = mensajeCorreccionesDePrecio([
    { modelo: "SUBE-1", precioAnterior: 479990, precio: 656990 },
    { modelo: "BAJA-1", precioAnterior: 729990, precio: 599990 },
  ]);
  assert.match(texto, /precios corregidos de origen/);
  assert.match(texto, /No bajaron ni subieron/);
  assert.ok(texto.indexOf("BAJA-1") < texto.indexOf("SUBE-1"), "las bajas primero: son las que el operador querria mirar");
  assert.match(texto, /BAJA-1: \$729\.990 → \$599\.990/);
  assert.equal(mensajeCorreccionesDePrecio([]), null, "sin correcciones no se manda nada");
});

test("el aviso tecnico corta la lista larga y dice cuantos quedaron fuera", () => {
  const muchos = Array.from({ length: 420 }, (_, i) => ({ modelo: `SKU-${i}`, precioAnterior: 100000, precio: 90000 }));
  const texto = mensajeCorreccionesDePrecio(muchos);
  assert.match(texto, /420 producto\(s\)/);
  assert.match(texto, /…y 405 más\./);
  assert.ok(texto.length < 1900, "tiene que caber en un mensaje de Discord sin que notifyTecnico lo corte");
});

// === 9. un producto nuevo a la venta sin precio ===============================

test("un producto NUEVO a la venta sin precio publicado se anuncia igual", () => {
  const paso = corrida({}, observar(desdeFicha(undefined, { precioIlegible: true })));
  assert.equal(paso.cambios.length, 1, "un lanzamiento no puede quedar invisible por tiempo indefinido");
  assert.equal(paso.cambios[0].tipo, "nuevo");
  assert.equal(paso.cambios[0].precio, null, "y se dice la verdad: no hay precio que mostrar");
  assert.equal(paso.catalogo[TAB.sku].corridasSinPrecio, 1, "ademas entra a la cuenta del aviso tecnico desde la corrida 1");
});

test("cuando la pagina por fin publica el precio, el aviso no repite 'primera vez visto'", async () => {
  const t1 = corrida({}, observar(desdeFicha(undefined, { precioIlegible: true })), "T1");
  const t2 = corrida(t1.catalogo, observar(desdeFicha(TAB.cobra)), "T2");
  assert.equal(t2.cambios.length, 1);
  assert.equal(t2.cambios[0].yaAnunciadoSinPrecio, true);

  const enviados = [];
  globalThis.fetch = async (_url, opts) => {
    enviados.push(JSON.parse(opts.body).content);
    return { ok: true };
  };
  await notifyDiscord("https://fake.webhook", { totalRevisado: 1, errores: 0, changes: t2.cambios });
  assert.match(enviados.join("\n"), /Ya publicaron su precio/);
});

test("un producto nuevo que Samsung NO vende no se anuncia, pero si se cuenta", () => {
  const paso = corrida({}, observar({ ...desdeFicha(undefined, { precioIlegible: true }), estadoStock: "no-a-la-venta", disponible: false }));
  assert.deepEqual(paso.cambios, [], "426 de los ~1000 activos no estan a la venta: anunciarlos seria ruido");
  assert.equal(paso.catalogo[TAB.sku].corridasSinPrecio, 1);
});

test("un producto sin precio desde siempre llega al aviso tecnico", () => {
  // antes corridasSinPrecio solo subia si YA habia un precio guardado, asi que
  // marcarSinPrecioProlongado no lo alcanzaba nunca.
  let catalogo = {};
  for (let i = 0; i < UMBRAL_SIN_VERIFICAR; i++) {
    catalogo = corrida(catalogo, observar(desdeFicha(undefined, { precioIlegible: true })), `T${i}`).catalogo;
  }
  assert.equal(catalogo[TAB.sku].corridasSinPrecio, UMBRAL_SIN_VERIFICAR);
  const avisos = marcarSinPrecioProlongado(catalogo);
  assert.equal(avisos.length, 1);
  assert.equal(avisos[0].modelo, TAB.sku);
});

test("un AGOTADO con el precio congelado tambien entra al aviso tecnico", () => {
  // un producto agotado es un producto que Samsung VENDE, solo que sin unidades:
  // su precio viejo presentado como vigente enganna igual. Los "no a la venta" y
  // los "desconocido" siguen fuera a proposito.
  const base = (estado) => ({ [`${TAB.sku}-${estado}`]: guardado(TAB.cobra, { modelo: `${TAB.sku}-${estado}`, estadoStock: estado, corridasSinPrecio: UMBRAL_SIN_VERIFICAR }) });
  assert.equal(marcarSinPrecioProlongado(base("agotado")).length, 1);
  assert.equal(marcarSinPrecioProlongado(base("no-a-la-venta")).length, 0);
  assert.equal(marcarSinPrecioProlongado(base("desconocido")).length, 0);
});

// === 10. un precio sin comprobar viaja marcado ===============================

test("el aviso de stock declara cuando su precio hace rato que no se comprueba", async () => {
  const previo = {
    [TAB.sku]: guardado(TAB.cobra, { estadoStock: "agotado", disponible: false, stockPendiente: "disponible", corridasSinPrecio: 4 }),
  };
  const paso = corrida(previo, observar(desdeFicha(undefined, { precioIlegible: true })));
  const stock = paso.cambios.find((c) => c.tipo === "stock");
  assert.ok(stock, "el stock confirmado si cambia");
  assert.equal(stock.corridasSinPrecio, 5);

  const enviados = [];
  globalThis.fetch = async (_url, opts) => {
    enviados.push(JSON.parse(opts.body).content);
    return { ok: true };
  };
  await notifyDiscord("https://fake.webhook", { totalRevisado: 1, errores: 0, changes: [stock] });
  assert.match(enviados.join("\n"), /no lo publica hace 5 revisiones/);
});

// === 11. la espera del render y la politica de scraping ======================

test("el timeout va en la posicion de OPCIONES de waitForFunction, no en la de arg", async () => {
  // medido contra el Chromium real: con el objeto en la posicion de `arg` la
  // espera corria 30.017 ms en vez de los 500 pedidos. Una espera sin tope es
  // una espera que no existe.
  const page = pagina(TAB, {});
  await extractSingleProduct(page, TAB.url);
  const [digital, render] = page.llamadas;
  assert.equal(digital.arg, undefined, "la espera de digitalData no puede pasar sus opciones como argumento");
  assert.ok(digital.opciones?.timeout > 0, "y su timeout tiene que llegar como opcion");
  assert.ok(render.opciones?.timeout > 0, "la espera del render tiene presupuesto PROPIO, no las sobras");
});

test("la pausa entre requests cumple la politica de scraping del proyecto", () => {
  assert.ok(DELAY_MS >= 2500, "la politica pide >= 2,5 s entre requests al mismo host");
});
