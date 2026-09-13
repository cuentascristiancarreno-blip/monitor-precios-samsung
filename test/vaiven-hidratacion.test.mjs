// CUARTA VUELTA DEL VAIVEN (2026-09-13, tarde-noche): lo que quedaba vivo despues
// del arreglo de la tarde, encontrado por tres verificaciones independientes.
//
// EL HALLAZGO, MEDIDO EN VIVO HOY. Se cargo galaxy-a36/buy/ entrando igual que
// produccion (waitUntil "domcontentloaded", UA CazadorBot) y se muestreo
// digitalData Y el bloque de compra juntos cada 250 ms:
//
//     935 ms   model_price "539990"   list_price ""
//              bloque: "...Galaxy A36 Desde $ 44.999 al mes o $ 539.990..."
//              body:   solo $44.999 y $539.990
//   1.310 ms   model_price "369990"   list_price "539990"
//              bloque: "...Desde $ 30.832 al mes o $ 369.990 ... 128GB｜6GB
//                       $ 35.832 al mes o $ 429.990 ..."
//
// O sea que durante ~375 ms la pagina publica el precio TACHADO en el campo del
// precio de venta, no publica ningun list_price, y el Buying Tool ya esta pintado
// mostrando ese mismo numero. La espera que habia (model_price > 0) se cumple ahi,
// asi que la lectura entraba en ese estado y guardaba 539.990: ES el mecanismo del
// vaiven del A36, el SKU de 3 de los 5 avisos falsos del encargo. Ninguna regla
// que mire el bloque lo puede detectar, porque el bloque dice lo mismo.
//
// Y de paso desmiente la fixture con la que se habia medido el arreglo de la
// tarde: ahi el estado malo se modelaba como el tool CORTADO, sin ningun monto.
// La pagina real, en ese instante, SI publica un monto; el equivocado.
//
// LOS TRES DEFECTOS QUE CIERRA ESTE ARCHIVO
//  1. la carrera de hidratacion de digitalData (arriba);
//  2. la REGRESION que introdujo el arreglo de la tarde: con digitalData rancio y
//     el bloque ya publicando el precio bueno, el filtro por candidatos no
//     encontraba coincidencia, devolvia null y el precio caia al model_price
//     rancio. HEAD guardaba 369.990 y el arreglo guardaba 539.990;
//  3. la otra regresion, en el camino de la API: "no hay precio" no es "el precio
//     leido no es de este SKU", y confundirlos mandaba el precio de LISTA de la
//     API al catalogo de cualquier ficha fusionada.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  VERSION_PRECIO,
  extractSingleProduct,
  montosDelBloqueCompra,
  precioAdoptable,
  precioDelBloqueCompra,
} from "../src/extract.mjs";
import { integrarVariantes } from "../src/catalogo.mjs";
import { HORAS_MAX_MIGRACION_PRECIO, comparar } from "../src/comparar.mjs";
import { RANGO } from "../src/identidad.mjs";

const A36_BUY = "https://www.samsung.com/cl/smartphones/galaxy-a36/buy/";
const BUYING_TOOL = "[class*='pd-buy']";
const BARRA_DE_PRECIO = "[class*='pd-buying-price']";

// --- los DOS estados de la pagina, con los textos LITERALES medidos hoy -------

// a los 935 ms: digitalData a medio hidratar y el tool publicando UN monto, el
// tachado. Es el estado que hay que no leer.
const DD_RANCIO = { model_price: "539990", list_price: "" };
const TOOL_TEMPRANO =
  "Buying Tool Dispositivo Dispositivo Justo el que necesitas Galaxy A36 Desde $ 44.999 al mes o $ 539.990 " +
  "¿Necesitas ayuda para elegir? Almacenamiento Selecciona tu almacenamiento 128GB｜6GB 256GB｜8GB $ 44.999 al mes o $ 539.990";
const BODY_TEMPRANO = "Galaxy A36 5G\n" + TOOL_TEMPRANO + "\nGalaxy A36 SM-A366ELVGLTL 256GB｜8GB $539.990";

// a los 1.310 ms: asentado
const DD_ASENTADO = { model_price: "369990", list_price: "539990" };
const TOOL_TARDIO =
  "Buying Tool Dispositivo Dispositivo Justo el que necesitas Galaxy A36 Desde $ 30.832 al mes o $ 369.990 " +
  "Almacenamiento Selecciona tu almacenamiento 128GB｜6GB $ 35.832 al mes o $ 429.990 256GB｜8GB $ 30.832 al mes o $ 369.990 " +
  "Accesorios Desde $ 4.165 al mes o $ 49.990";
const BODY_TARDIO =
  "Galaxy A36 5G\n" + TOOL_TARDIO + "\nGalaxy A36 SM-A366ELVGLTL 256GB｜8GB Violeta increíble $369.990 $539.990";

/**
 * Doble de pagina que modela la HIDRATACION, que es lo que ninguno de los dobles
 * anteriores podia expresar: hasta ahora digitalData era un objeto fijo, asi que
 * el estado "digitalData todavia trae el tachado" era inexpresable y por eso 482
 * pruebas verdes y 24 mutantes no decian nada sobre el.
 *
 * `asienta: false` congela la pagina a medio hidratar para siempre: la segunda
 * espera (la de list_price) se agota, igual que en produccion.
 */
function paginaQueHidrataTarde({ asienta = true, bloque = TOOL_TARDIO, selector = BUYING_TOOL, ctas = ["Dispositivo"] } = {}) {
  let esperas = 0;
  let asentado = false;
  let evaluaciones = 0;
  return {
    get esperas() {
      return esperas;
    },
    url: () => A36_BUY,
    async waitForFunction(_fn, _arg, _opciones) {
      esperas += 1;
      // 1a espera: digitalData.model_price > 0, que YA se cumple en el estado
      // rancio (ese es el defecto). 2a espera: la hidratacion.
      if (esperas === 2) {
        if (!asienta) throw new Error("timeout");
        asentado = true;
      }
    },
    async evaluate() {
      evaluaciones += 1;
      if (evaluaciones === 1) {
        const dd = asentado ? DD_ASENTADO : DD_RANCIO;
        return { ...dd, model_code: "SM-A366ELVGLTL", displayName: "Galaxy A36" };
      }
      if (evaluaciones === 2) return asentado ? BODY_TARDIO : BODY_TEMPRANO;
      if (evaluaciones === 3) return { texto: bloque, ctas, ctasBarra: [], selector };
      return {};
    },
  };
}

const entrada = (url) => ({ url, categoria: "Smartphones", subcategoria: null, variante: null });

const registro = (extra) => ({
  nombre: "Galaxy A36",
  moneda: "CLP",
  categoria: "Smartphones",
  presencia: "activo",
  ausencias: 0,
  notificadoDesaparecido: false,
  estadoStock: "disponible",
  disponible: true,
  versionStock: 2,
  ...extra,
});

const corrida = (previo, observado, timestamp = "T") =>
  comparar({ previo, observado, paginasFallidas: new Set(), corridaConfiable: true, timestamp });

// === 1. LA CARRERA DE HIDRATACION ===========================================

test("se espera a que digitalData traiga sus DOS campos antes de leer nada", async () => {
  const page = paginaQueHidrataTarde();
  const r = await extractSingleProduct(page, A36_BUY);
  assert.equal(r.precio, 369990, "el precio que el cliente paga, no el tachado del estado temprano");
  assert.ok(page.esperas >= 3, "hay una espera de hidratacion ADEMAS de la de digitalData y la del pintado");
  assert.equal("digitalDataSinAsentar" in r, false);
});

test("EL DEFECTO: sin esperar la hidratacion, el precio guardado es el TACHADO", async () => {
  // el mismo material, con la pagina congelada a medio hidratar. Antes de este
  // arreglo la lectura entraba aca y guardaba 539.990.
  const page = paginaQueHidrataTarde({ asienta: false, bloque: TOOL_TEMPRANO });
  const r = await extractSingleProduct(page, A36_BUY);
  assert.notEqual(r.precio, 539990, "539.990 es el precio TACHADO del A36");
  assert.equal("precio" in r, false, "digitalData no esta asentado: no hay ningun numero confiable");
  assert.equal(r.digitalDataSinAsentar, true, "y queda contado en el resumen de la corrida");
});

test("con digitalData rancio y el tool SIN pintar tampoco se adopta nada", async () => {
  // el estado anterior al de los 935 ms: el Buying Tool todavia no escribio
  // ningun monto. Aca no hay "cuarto estado" que proteja (el bloque no publica
  // nada) ni dos candidatos (list_price esta vacio), asi que sin la guarda de
  // hidratacion el precio caeria en la primera linea de precioVisiblePreferido,
  // o sea en el model_price rancio: el TACHADO.
  const TOOL_SIN_PINTAR = "Buying Tool Dispositivo Dispositivo Justo el que necesitas Galaxy A36 Desde";
  const page = paginaQueHidrataTarde({ asienta: false, bloque: TOOL_SIN_PINTAR, ctas: [] });
  const r = await extractSingleProduct(page, A36_BUY);
  assert.notEqual(r.precio, 539990, "539.990 es el tachado que digitalData trae mientras se hidrata");
  assert.equal("precio" in r, false);
  assert.equal(r.digitalDataSinAsentar, true);
});

test("si la ESPERA DE digitalData se agota, la lectura tampoco se da por asentada", async () => {
  // La espera de hidratacion solo se paga cuando la primera espera se cumplio:
  // hay ~150 paginas que legitimamente nunca publican precio y cobrarles el
  // presupuesto serian ~7 min por revision completa. Pero eso no puede
  // convertirse en "si no espere, doy por bueno lo que haya": una pagina cuyo
  // digitalData llega justo despues del tope esta, por definicion, sin asentar.
  let ev = 0;
  const page = {
    url: () => A36_BUY,
    async waitForFunction(fn) {
      // la PRIMERA espera (model_price > 0) se agota
      if (String(fn).includes("model_price")) throw new Error("timeout");
    },
    async evaluate() {
      ev += 1;
      // ...y digitalData aparece un instante despues, todavia a medio hidratar
      if (ev === 1) return { ...DD_RANCIO, model_code: "SM-A366ELVGLTL", displayName: "Galaxy A36" };
      if (ev === 2) return BODY_TEMPRANO;
      if (ev === 3) return { texto: TOOL_TEMPRANO, ctas: [], ctasBarra: [], selector: BUYING_TOOL };
      return {};
    },
  };
  const r = await extractSingleProduct(page, A36_BUY);
  assert.notEqual(r.precio, 539990, "539.990 es el tachado que trae digitalData a medio hidratar");
  assert.equal("precio" in r, false);
  assert.equal(r.digitalDataSinAsentar, true);
});

test("el A36: 6 corridas alternando si la pagina alcanza a hidratarse -> CERO avisos", async () => {
  // Es el vaiven real del encargo, con su mecanismo verdadero:
  //   09-12 16:16 sube 369.990 -> 539.990 · 21:06 baja · 23:39 sube
  let catalogo = {
    "SM-A366ELVGLTL": registro({
      modelo: "SM-A366ELVGLTL",
      precio: 369990,
      url: A36_BUY,
      paginaOrigen: A36_BUY,
      rango: RANGO.PROPIA,
      versionPrecio: VERSION_PRECIO,
    }),
  };
  const avisos = [];
  for (const asienta of [true, false, true, false, false, true]) {
    const r = await extractSingleProduct(
      paginaQueHidrataTarde({ asienta, bloque: asienta ? TOOL_TARDIO : TOOL_TEMPRANO }),
      A36_BUY,
    );
    const observado = {};
    integrarVariantes(observado, entrada(A36_BUY), [r], { via: "individual", timestamp: "T" });
    const paso = corrida(catalogo, observado);
    catalogo = paso.catalogo;
    avisos.push(...paso.cambios.filter((c) => c.tipo === "sube" || c.tipo === "baja"));
  }
  assert.deepEqual(avisos, [], "ni un aviso: la hidratacion no puede mover el precio guardado");
  assert.equal(catalogo["SM-A366ELVGLTL"].precio, 369990);
});

test("una baja de VERDAD se sigue avisando en la primera corrida que hidrate", async () => {
  let catalogo = {
    "SM-A366ELVGLTL": registro({
      modelo: "SM-A366ELVGLTL",
      precio: 369990,
      url: A36_BUY,
      paginaOrigen: A36_BUY,
      rango: RANGO.PROPIA,
      versionPrecio: VERSION_PRECIO,
    }),
  };
  const page = paginaQueHidrataTarde();
  // la misma pagina, con Samsung bajando de verdad a 329.990
  page.evaluate = (() => {
    let n = 0;
    return async () => {
      n += 1;
      if (n === 1) return { model_price: "329990", list_price: "539990", model_code: "SM-A366ELVGLTL", displayName: "Galaxy A36" };
      if (n === 2) return "Galaxy A36 5G Desde $ 27.499 al mes o $ 329.990 $539.990";
      if (n === 3)
        return {
          texto: "Buying Tool Galaxy A36 Desde $ 27.499 al mes o $ 329.990 128GB｜6GB $ 35.832 al mes o $ 429.990",
          ctas: ["Dispositivo"],
          ctasBarra: [],
          selector: BUYING_TOOL,
        };
      return {};
    };
  })();
  const r = await extractSingleProduct(page, A36_BUY);
  const observado = {};
  integrarVariantes(observado, entrada(A36_BUY), [r], { via: "individual", timestamp: "T" });
  const paso = corrida(catalogo, observado);
  const bajas = paso.cambios.filter((c) => c.tipo === "baja");
  assert.equal(bajas.length, 1, "la baja real sale en la PRIMERA corrida, sin atraso");
  assert.equal(bajas[0].precio, 329990);
});

// === 2. LA REGRESION DEL FILTRO POR CANDIDATOS ==============================

test("REGRESION: con digitalData rancio, el bloque bueno no puede caer en el rancio", async () => {
  // el estado intermedio: el tool YA publica los cinco montos buenos y
  // digitalData todavia trae el tachado. El filtro por candidatos no encuentra
  // coincidencia (ninguno de los montos es 539.990) y devolvia null; de ahi el
  // precio caia a `precioFinal`, o sea al model_price rancio. HEAD guardaba
  // 369.990 y la version de la tarde guardaba 539.990: estrictamente peor.
  const page = paginaQueHidrataTarde({ asienta: false, bloque: TOOL_TARDIO });
  const r = await extractSingleProduct(page, A36_BUY);
  assert.notEqual(r.precio, 539990, "jamas el tachado rancio");
  assert.equal("precio" in r, false);
});

test("un bloque que publica montos y no señala a este SKU no deja adoptar nada", () => {
  // el cuarto estado, que antes se confundia con "el bloque no publica monto"
  assert.equal(
    precioAdoptable({
      precioBloque: null,
      precioFinal: 539990,
      modelPrice: 539990,
      listPrice: NaN,
      bloqueLegible: true,
      paginaNoLoVendeOnline: false,
      montosEnBloque: 5,
      bodyText: BODY_TARDIO,
    }),
    null,
    "el bloque hablo y no hablo de este SKU: no se sabe",
  );
  // y su contraparte: sin montos en el bloque, el camino de siempre sigue vivo
  assert.equal(
    precioAdoptable({
      precioBloque: null,
      precioFinal: 47020,
      modelPrice: 47020,
      listPrice: 47020,
      bloqueLegible: true,
      paginaNoLoVendeOnline: false,
      montosEnBloque: 0,
      bodyText: "AR-KH00E $ 47.020",
    }),
    47020,
  );
});

// === 3. QUE BLOQUE SE LEYO, NO CUANTOS MONTOS TIENE =========================

test("un monto solitario en un SELECTOR tiene que señalar a un candidato", () => {
  // el render parcial que deja escrita solo la fila de accesorios: adoptar
  // $49.990 para un celular de $369.990 es una "baja" del 86%
  const soloAccesorios = "Buying Tool Dispositivo Galaxy A36 Accesorios Desde $ 4.165 al mes o $ 49.990";
  assert.equal(montosDelBloqueCompra(soloAccesorios).length, 1);
  assert.equal(
    precioDelBloqueCompra(soloAccesorios, [369990, 539990], { barraDePrecio: false }),
    null,
    "49.990 no es ninguno de los numeros que digitalData publica para este SKU",
  );
  // y el estado temprano medido hoy: un monto solitario que SI es candidato pero
  // es el tachado. Lo detiene la espera de hidratacion, no esta regla.
  assert.equal(precioDelBloqueCompra(TOOL_TEMPRANO, [539990], { barraDePrecio: false }), 539990);
});

test("en la BARRA de precio de la ficha, un monto solitario manda sin comprobar nada", () => {
  // SM-X400NZRDCHO: el bloque cobra $494.990 y digitalData publica 379.990 y
  // 549.989. Es el caso que le dio origen a la regla del 2026-09-12.
  const barra = "Desde $ 41.249 en 12 cuotas sin intereses* o $494.990 *Aplican condiciones Comprar";
  assert.equal(precioDelBloqueCompra(barra, [379990, 549989], { barraDePrecio: true }), 494990);
  assert.equal(precioDelBloqueCompra(barra, [379990, 549989], { barraDePrecio: false }), null);
});

test("el resumen del Buying Tool NO cuenta como la barra de precio de este SKU", async () => {
  // `buying-tool__summary` lleva "buying-tool" en el nombre: es el resumen del
  // MISMO selector de grupo, asi que refleja la opcion elegida y no
  // necesariamente este SKU. Solo `pd-buying-price` esta verificado en vivo como
  // la barra de un unico producto.
  const resumen = "Desde $ 44.999 al mes o $ 449.990 Agregar al carro";
  const page = paginaQueHidrataTarde({ bloque: resumen, ctas: ["Agregar al carro"], selector: "[class*='buying-tool__summary']" });
  const r = await extractSingleProduct(page, A36_BUY);
  assert.equal("precio" in r, false, "449.990 no es ninguno de los numeros que digitalData publica para este SKU");
  // el control: el MISMO monto solitario, leido de la barra de precio de verdad,
  // si manda aunque no coincida con digitalData (caso SM-X400NZRDCHO)
  const barra = paginaQueHidrataTarde({ bloque: resumen, ctas: ["Agregar al carro"], selector: BARRA_DE_PRECIO });
  assert.equal((await extractSingleProduct(barra, A36_BUY)).precio, 449990);
});

test("el Buying Tool pintado sigue eligiendo el monto de ESTE SKU", async () => {
  const r = await extractSingleProduct(paginaQueHidrataTarde(), A36_BUY);
  assert.equal(r.precio, 369990, "de los cinco montos del selector, el que digitalData publica");
});

// === 4. LA LLAVE "NO LO VENDO ONLINE" SOLO VALE DESDE LA BARRA ==============

test("un SELECTOR diciendo 'No está a la venta' NO destraba el precio", async () => {
  // medido: el Buying Tool de una /buy/ hubble escribe el veredicto de CADA
  // variante ("Gris increíble Agotado Grafito increíble Agotado"), asi que su
  // "no está a la venta" puede ser de otra. Dejarlo decidir el precio es darle la
  // llave al mismo texto ajeno que este arreglo acaba de sacar del medio.
  const tool = "Buying Tool Dispositivo Galaxy A36 512GB No está a la venta 256GB｜8GB";
  const page = paginaQueHidrataTarde({ bloque: tool, ctas: [], selector: BUYING_TOOL });
  const r = await extractSingleProduct(page, A36_BUY);
  assert.equal("precio" in r, false, "el veredicto de otra variante no es la llave de este precio");
});

test("la BARRA de precio diciendo 'Dónde comprar' si destraba, y se deja contado", async () => {
  const page = paginaQueHidrataTarde({ bloque: "Dónde comprar", ctas: ["Dónde comprar"], selector: BARRA_DE_PRECIO });
  const r = await extractSingleProduct(page, A36_BUY);
  assert.equal(r.precio, 369990, "el model_price, que es el unico numero deterministico que queda");
  assert.equal(r.precioDeclarado, true, "la adopcion a ciegas queda contada: no hay monto contra el cual contrastarla");
});

test("un monto marcado 'Precio original' no se adopta ni con la pagina declarando", () => {
  // la guarda del final del bloque de dos candidatos, que ninguna prueba cubria:
  // el mutante que la borraba dejaba la suite entera en verde
  assert.equal(
    precioAdoptable({
      precioBloque: null,
      precioFinal: NaN,
      modelPrice: 539990,
      listPrice: 369990,
      bloqueLegible: true,
      paginaNoLoVendeOnline: true,
      montosEnBloque: 0,
      bodyText: "Galaxy A36 Precio original: $539.990 Dónde comprar",
    }),
    null,
    "la propia pagina lo marca como el precio de antes",
  );
  // el control: el mismo caso sin la etiqueta si adopta
  assert.equal(
    precioAdoptable({
      precioBloque: null,
      precioFinal: NaN,
      modelPrice: 539990,
      listPrice: 369990,
      bloqueLegible: true,
      paginaNoLoVendeOnline: true,
      montosEnBloque: 0,
      bodyText: "Galaxy A36 Dónde comprar",
    }),
    539990,
  );
});

// === 5. LA AMNISTIA DE LA MIGRACION SE CIERRA POR RELOJ =====================

const ahora = (horas) => new Date(Date.UTC(2026, 8, 13, 0, 0, 0) + horas * 3600 * 1000).toISOString();

function ofertaQueEstrena({ migracionPrecioDesde, timestamp }) {
  // la forma EXACTA de una oferta que estrena: el precio de ayer pasa a ser el
  // "Precio original" de hoy, que es tambien la forma de "el guardado era el
  // tachado". Medido en el historial real: EF-ES942COEGWW 49.990 -> 34.993 con
  // list_price 49.990 hoy.
  const previo = {
    "EF-ES942COEGWW": registro({
      modelo: "EF-ES942COEGWW",
      nombre: "Clear Case S26",
      categoria: "Accesorios",
      precio: 49990,
      url: "https://x/case",
      paginaOrigen: "https://x/case",
      rango: RANGO.PROPIA,
      versionPrecio: 3,
      ...(migracionPrecioDesde ? { migracionPrecioDesde } : {}),
    }),
  };
  const observado = {};
  integrarVariantes(
    observado,
    { url: "https://x/case", categoria: "Accesorios", subcategoria: null, variante: null },
    [
      {
        modelo: "EF-ES942COEGWW",
        moneda: "CLP",
        precio: 34993,
        precioTachado: 49990,
        rango: RANGO.PROPIA,
        url: "https://x/case",
        estadoStock: "disponible",
        disponible: true,
        versionStock: 2,
        versionPrecio: VERSION_PRECIO,
      },
    ],
    { via: "individual", timestamp },
  );
  return comparar({ previo, observado, paginasFallidas: new Set(), corridaConfiable: true, timestamp });
}

test("la corrida de migracion SI se lleva la baja al canal tecnico (es el precio acordado)", () => {
  const paso = ofertaQueEstrena({ migracionPrecioDesde: null, timestamp: ahora(0) });
  assert.equal(paso.cambios.filter((c) => c.tipo === "baja").length, 0);
  assert.equal(paso.correccionesDePrecio.length, 1, "sale por el canal tecnico, con los dos numeros");
  // esta lectura SI trajo precio, asi que la version se sella y la ventana se
  // cierra por las buenas: no hace falta ancla y el registro no se lleva el campo
  assert.equal(paso.catalogo["EF-ES942COEGWW"].versionPrecio, VERSION_PRECIO);
  assert.equal("migracionPrecioDesde" in paso.catalogo["EF-ES942COEGWW"], false);
});

test("pasadas las horas de la ventana, la MISMA baja vuelve a ser una baja", () => {
  const paso = ofertaQueEstrena({
    migracionPrecioDesde: ahora(0),
    timestamp: ahora(HORAS_MAX_MIGRACION_PRECIO + 1),
  });
  const bajas = paso.cambios.filter((c) => c.tipo === "baja");
  assert.equal(bajas.length, 1, "una baja del 30% a dias del Cyber no puede seguir yendose por el canal tecnico");
  assert.equal(bajas[0].precio, 34993);
  assert.equal(paso.correccionesDePrecio.length, 0);
});

test("dentro de la ventana la amnistia sigue valiendo", () => {
  const paso = ofertaQueEstrena({
    migracionPrecioDesde: ahora(0),
    timestamp: ahora(HORAS_MAX_MIGRACION_PRECIO - 1),
  });
  assert.equal(paso.cambios.filter((c) => c.tipo === "baja").length, 0);
  assert.equal(paso.correccionesDePrecio.length, 1);
});

test("el ancla se escribe aunque la lectura no traiga precio, que es el caso peligroso", () => {
  // un SKU que solo vive en una /buy/: su tool no se pinta en cerca de la mitad
  // de las lecturas, asi que versionPrecio no se sella y la ventana no se cierra
  // sola. Sin ancla de reloj podia llegar al Cyber con la amnistia puesta.
  const previo = {
    "SM-A366ELVGLTL": registro({
      modelo: "SM-A366ELVGLTL",
      precio: 539990,
      url: A36_BUY,
      paginaOrigen: A36_BUY,
      rango: RANGO.PROPIA,
      versionPrecio: 3,
    }),
  };
  const observado = {};
  integrarVariantes(
    observado,
    entrada(A36_BUY),
    [
      {
        modelo: "SM-A366ELVGLTL",
        moneda: "CLP",
        rango: RANGO.PROPIA,
        url: A36_BUY,
        estadoStock: "disponible",
        disponible: true,
        versionStock: 2,
        versionPrecio: VERSION_PRECIO,
        precioIlegible: true,
      },
    ],
    { via: "individual", timestamp: ahora(0) },
  );
  const paso = comparar({ previo, observado, paginasFallidas: new Set(), corridaConfiable: true, timestamp: ahora(0) });
  const rec = paso.catalogo["SM-A366ELVGLTL"];
  assert.equal(rec.migracionPrecioDesde, ahora(0), "el reloj arranca con la primera lectura, tenga precio o no");
  assert.equal(rec.versionPrecio, 3, "y la version NO se sella sin lectura util (regla del 2026-09-12)");
});

test("el ancla NO se reinicia en cada corrida: si no, la ventana nunca se cierra", () => {
  // es el punto entero del arreglo. Un SKU que se lee muchas veces sin precio
  // pasaria por aca en cada corrida; si el reloj se reiniciara, la amnistia
  // quedaria armada para siempre -- que es justo lo que hay que evitar a dias
  // del Cyber.
  const sinPrecio = {
    modelo: "SM-A366ELVGLTL",
    moneda: "CLP",
    rango: RANGO.PROPIA,
    url: A36_BUY,
    estadoStock: "disponible",
    disponible: true,
    versionStock: 2,
    versionPrecio: VERSION_PRECIO,
    precioIlegible: true,
  };
  let catalogo = {
    "SM-A366ELVGLTL": registro({
      modelo: "SM-A366ELVGLTL",
      precio: 539990,
      url: A36_BUY,
      paginaOrigen: A36_BUY,
      rango: RANGO.PROPIA,
      versionPrecio: 3,
    }),
  };
  for (const h of [0, 5, 11]) {
    const observado = {};
    integrarVariantes(observado, entrada(A36_BUY), [sinPrecio], { via: "individual", timestamp: ahora(h) });
    catalogo = comparar({
      previo: catalogo,
      observado,
      paginasFallidas: new Set(),
      corridaConfiable: true,
      timestamp: ahora(h),
    }).catalogo;
  }
  assert.equal(
    catalogo["SM-A366ELVGLTL"].migracionPrecioDesde,
    ahora(0),
    "el reloj arranca UNA vez, en la primera lectura con version nueva",
  );
});

test("cuando ya no hay migracion pendiente, el ancla se borra del registro", () => {
  const previo = {
    "SM-A366ELVGLTL": registro({
      modelo: "SM-A366ELVGLTL",
      precio: 369990,
      url: A36_BUY,
      paginaOrigen: A36_BUY,
      rango: RANGO.PROPIA,
      versionPrecio: VERSION_PRECIO,
      migracionPrecioDesde: ahora(0),
    }),
  };
  const observado = {};
  integrarVariantes(
    observado,
    entrada(A36_BUY),
    [
      {
        modelo: "SM-A366ELVGLTL",
        moneda: "CLP",
        precio: 369990,
        rango: RANGO.PROPIA,
        url: A36_BUY,
        estadoStock: "disponible",
        disponible: true,
        versionStock: 2,
        versionPrecio: VERSION_PRECIO,
      },
    ],
    { via: "individual", timestamp: ahora(1) },
  );
  const paso = comparar({ previo, observado, paginasFallidas: new Set(), corridaConfiable: true, timestamp: ahora(1) });
  assert.equal("migracionPrecioDesde" in paso.catalogo["SM-A366ELVGLTL"], false, "no engorda los ~930 registros sanos");
});

// === 6. LOS DIAGNOSTICOS NO SOBREVIVEN AL CATALOGO ==========================

test("precioDeclarado y digitalDataSinAsentar no se guardan en el catalogo", async () => {
  const sinAsentar = await extractSingleProduct(
    paginaQueHidrataTarde({ asienta: false, bloque: TOOL_TEMPRANO }),
    A36_BUY,
  );
  const declarado = await extractSingleProduct(
    paginaQueHidrataTarde({ bloque: "Dónde comprar", ctas: ["Dónde comprar"], selector: BARRA_DE_PRECIO }),
    A36_BUY,
  );
  assert.equal(sinAsentar.digitalDataSinAsentar, true);
  assert.equal(declarado.precioDeclarado, true);
  for (const salida of [sinAsentar, declarado]) {
    const observado = {};
    integrarVariantes(observado, entrada(A36_BUY), [salida], { via: "individual", timestamp: "T" });
    const rec = corrida({}, observado).catalogo["SM-A366ELVGLTL"];
    assert.equal("digitalDataSinAsentar" in rec, false, "describe la lectura, no el producto");
    assert.equal("precioDeclarado" in rec, false);
  }
});
