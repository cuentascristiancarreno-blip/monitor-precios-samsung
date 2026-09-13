// EL STOCK DE LAS PAGINAS DE CONFIGURADOR (/buy/ cuyo slug no nombra al SKU).
//
// Cierra el pendiente nº 6 del 2026-09-13 ("el bloque de compra de una /buy/
// hubble contamina el STOCK").
//
// TODO EL MATERIAL DE ESTE ARCHIVO ES TEXTO MEDIDO EN VIVO el 2026-09-13,
// entrando igual que produccion (waitUntil "domcontentloaded", UA CazadorBot) y
// muestreando el bloque de compra, la barra de precio pegajosa y digitalData
// cada 250 ms. No hay ni un estado inferido: es la regla que el proyecto se
// impuso el 2026-09-13 despues de "reparar" dos fixtures con un argumento en vez
// de con una medicion.
//
// LO QUE SE MIDIO, Y QUE PRUEBA CADA COSA
//
//  galaxy-a36/buy/ -- SKU propio SM-A366ELVGLTL (Violeta increíble, 256GB)
//    · el Buying Tool escribe los colores con su stock: "…Verde lima increíble
//      Violeta increíble Gris increíble Agotado Grafito increíble Agotado".
//      El "Agotado" es de OTROS COLORES. El SKU que se esta guardando es el
//      Violeta y NO esta marcado.
//    · la API que la propia pagina pide responde por los 8 codigos:
//      SM-A366ELVGLTL inStock, los otros 7 outOfStock.
//    · 19 de 20 muestras dan "agotado" leyendo ese bloque; la de los 1.191 ms,
//      antes de que se pintara la grilla de colores, da "desconocido" y cae a la
//      API, que dice DISPONIBLE. Esa moneda al aire es el vaiven que reporto el
//      operador (history.jsonl: disponible>agotado>disponible>agotado).
//
//  galaxy-z-flip7-fe/buy/ -- SKU propio SM-F761BZKJCHO
//    · el bloque nunca decide (sus botones son "Ver más", "Conoce más").
//    · la barra pegajosa dice "No está a la venta" desde los 1.480 ms, y antes
//      sus botones son solo el nombre del producto.
//    · la API dice outOfStock para los 4 codigos.
//    · 19 de 20 muestras dan "no-a-la-venta" y 1 da "agotado" (por la API). Ese
//      es el otro vaiven del reporte: no-a-la-venta <-> agotado.
//    · digitalData se asienta a los 948 ms, o sea que la lectura de produccion
//      cae JUSTO en el borde en que la barra se esta pintando.
import { test } from "node:test";
import assert from "node:assert/strict";
import { extractSingleProduct } from "../src/extract.mjs";
import { ESTADO } from "../src/stock.mjs";
import { comparar } from "../src/comparar.mjs";

const TS = "2026-09-13T18:00:00.000Z";

const U_A36 = "https://www.samsung.com/cl/smartphones/galaxy-a36/buy/";
const U_FLIP7FE = "https://www.samsung.com/cl/smartphones/galaxy-z-flip7-fe/buy/";
// ficha PLANA de control: su slug SI nombra al SKU
const U_A37 = "https://www.samsung.com/cl/smartphones/galaxy-a/galaxy-a37-5g-awesome-white-256gb-sm-a376bzwkltl/";

// texto literal del Buying Tool del A36 a los 3.896 ms (recortado en el tramo
// que importa: la grilla de colores con el stock de cada uno)
const TOOL_A36_PINTADO =
  "Buying Tool Dispositivo Dispositivo Justo el que necesitas Galaxy A36 Desde $ 30.832 al mes o $ 369.990 " +
  "Almacenamiento Almacenamiento Selecciona tu almacenamiento 128GB｜6GB $ 35.832 al mes o $ 429.990 " +
  "256GB｜8GB $ 30.832 al mes o $ 369.990 Color Color Por favor selecciona el color Verde lima increíble " +
  "Violeta increíble Gris increíble Agotado Grafito increíble Agotado Entregas: en 1-3 días laborables";
// el mismo tool a los 3.641 ms: la grilla de colores todavia no se pinto
const TOOL_A36_A_MEDIO_PINTAR =
  "Buying Tool Dispositivo Dispositivo Justo el que necesitas Galaxy A36 Desde $ 30.832 al mes o $ 369.990 " +
  "Almacenamiento Almacenamiento Selecciona tu almacenamiento 128GB｜6GB 256GB｜8GB $ 30.832 al mes o $ 369.990";
const CTAS_A36 = ["Dispositivo", "Almacenamiento", "Color", "Más información", "Simula tu compra en cuotas"];
const BARRA_A36 = ["Galaxy A36", "*", "Continuar", "Galaxy A36", "*", "Continuar"];

const TOOL_FLIP7FE =
  "Buying Tool Ver más Llévalo en tu bolsillo Cámara gran angular de 50 MP Galaxy AI Dispositivo " +
  "Selecciona tu dispositivo Galaxy Z Flip7 FE Desde $ 41.666 al mes o $ 999.990 Almacenamiento " +
  "128 GB | 8 GB $ 41.666 al mes o $ 999.990 256 GB | 8 GB $ 45.832 al mes o $ 1.099.990";
const CTAS_FLIP7FE = ["Ver más", "Más información", "Conoce más"];
const BARRA_FLIP7FE_PINTADA = ["Galaxy Z Flip7 FE", "No está a la venta", "Galaxy Z Flip7 FE", "No está a la venta"];
const BARRA_FLIP7FE_SIN_PINTAR = ["Galaxy Z Flip7 FE", "Galaxy Z Flip7 FE", "Galaxy Z Flip7 FE"];

// respuestas REALES de api.shop.samsung.com, tal como las pide la propia pagina
const API_A36 = {
  products: [
    { code: "SM-A366ELGBLTL", price: { value: 429990 }, stock: { stockLevelStatus: "outOfStock" } },
    { code: "SM-A366ELGGLTL", price: { value: 479990 }, stock: { stockLevelStatus: "outOfStock" } },
    { code: "SM-A366ELVBLTL", price: { value: 429990 }, stock: { stockLevelStatus: "outOfStock" } },
    { code: "SM-A366ELVGLTL", price: { value: 539990 }, stock: { stockLevelStatus: "inStock" } },
    { code: "SM-A366EZKGLTL", price: { value: 479990 }, stock: { stockLevelStatus: "outOfStock" } },
  ],
};
const API_FLIP7FE = {
  products: [
    { code: "SM-F761BZKJCHO", price: { value: 999990 }, stock: { stockLevelStatus: "outOfStock" } },
    { code: "SM-F761BZWJCHO", price: { value: 999990 }, stock: { stockLevelStatus: "outOfStock" } },
  ],
};

/**
 * Doble de pagina. `selector` es el dato que este archivo viene a ejercitar: en
 * una /buy/ hubble el ganador medido es `[class*='pd-buy']` (el Buying Tool
 * entero) y en una ficha plana es `[class*='pd-buying-price']` (la barra de
 * precio de ese unico producto).
 */
function paginaFalsa({ dd, bloque, ctas = [], ctasBarra = [], body = "", urlFinal, selector, legible = true }) {
  return {
    url: () => urlFinal,
    async waitForFunction() {},
    async evaluate(fn) {
      const fuente = String(fn);
      if (fuente.includes("digitalData")) return dd;
      if (fuente.includes("body.innerText")) return body;
      if (fuente.includes("buying")) return legible ? { texto: bloque, ctas, ctasBarra, selector } : null;
      return {};
    },
  };
}

const paginaA36 = ({ tool = TOOL_A36_PINTADO, barra = BARRA_A36 } = {}) =>
  paginaFalsa({
    dd: { model_code: "SM-A366ELVGLTL", displayName: "Galaxy A36", model_price: "369990", list_price: "539990" },
    bloque: tool,
    ctas: CTAS_A36,
    ctasBarra: barra,
    body: `${tool} Desde $ 30.832 al mes o $ 369.990`,
    urlFinal: U_A36,
    selector: "[class*='pd-buy']",
  });

const paginaFlip7fe = ({ barra = BARRA_FLIP7FE_PINTADA } = {}) =>
  paginaFalsa({
    dd: { model_code: "SM-F761BZKJCHO", displayName: "Galaxy Z Flip7 FE", model_price: "999990", list_price: "999990" },
    bloque: TOOL_FLIP7FE,
    ctas: CTAS_FLIP7FE,
    ctasBarra: barra,
    body: `${TOOL_FLIP7FE} $ 999.990`,
    urlFinal: U_FLIP7FE,
    selector: "[class*='pd-buy']",
  });

// ---------------------------------------------------------------------------
// 1. el defecto medido: el bloque de un configurador habla de otras variantes
// ---------------------------------------------------------------------------

test("A36: el 'Agotado' del selector es de OTROS COLORES y ya no decide el stock", async () => {
  const [r] = [await extractSingleProduct(paginaA36(), U_A36, [API_A36])].flat();
  // la API responde inStock para SM-A366ELVGLTL (Violeta), que es justo el color
  // que la grilla NO marca como agotado
  assert.equal(r.modelo, "SM-A366ELVGLTL");
  assert.equal(r.estadoStock, ESTADO.DISPONIBLE);
  assert.equal(r.disponible, true);
});

test("A36: el veredicto NO cambia segun cuanto alcanzo a pintarse el selector", async () => {
  // ES LA PRUEBA CENTRAL DEL ARREGLO. Las dos lecturas son la misma pagina en
  // dos instantes reales (3.641 ms y 3.896 ms). Antes daban "disponible" y
  // "agotado": el vaiven del encargo.
  const pintado = await extractSingleProduct(paginaA36(), U_A36, [API_A36]);
  const aMedias = await extractSingleProduct(paginaA36({ tool: TOOL_A36_A_MEDIO_PINTAR }), U_A36, [API_A36]);
  assert.equal(pintado.estadoStock, aMedias.estadoStock);
  assert.equal(pintado.estadoStock, ESTADO.DISPONIBLE);
});

test("Z Flip7 FE: el veredicto NO cambia segun si la barra pegajosa alcanzo a pintarse", async () => {
  // el otro vaiven del encargo: no-a-la-venta (barra pintada) <-> agotado (API).
  // Las dos lecturas son los instantes reales de 948 ms y 1.480 ms.
  const conBarra = await extractSingleProduct(paginaFlip7fe(), U_FLIP7FE, [API_FLIP7FE]);
  const sinBarra = await extractSingleProduct(
    paginaFlip7fe({ barra: BARRA_FLIP7FE_SIN_PINTAR }),
    U_FLIP7FE,
    [API_FLIP7FE],
  );
  assert.equal(conBarra.estadoStock, sinBarra.estadoStock);
  // en un configurador manda la API por codigo, que es la unica fuente POR SKU
  assert.equal(conBarra.estadoStock, ESTADO.AGOTADO);
});

test("los tres SKU del encargo dejan de producir eventos de stock al leerse dos veces", async () => {
  // La secuencia real de history.jsonl era: disponible>agotado>disponible>agotado
  // (A36) y no-a-la-venta>agotado>no-a-la-venta>agotado (Z Flip7 FE), o sea un
  // aviso por lectura. Con el arreglo, leer la MISMA pagina en sus dos estados
  // de render da el mismo estado, asi que no hay nada que confirmar ni avisar.
  const lecturas = [];
  for (const p of [paginaA36(), paginaA36({ tool: TOOL_A36_A_MEDIO_PINTAR })]) {
    lecturas.push(await extractSingleProduct(p, U_A36, [API_A36]));
  }
  assert.equal(new Set(lecturas.map((l) => l.estadoStock)).size, 1);
});

// ---------------------------------------------------------------------------
// 2. lo que NO se toca
// ---------------------------------------------------------------------------

test("una ficha PLANA sigue decidiendo su stock con su propio bloque de compra", async () => {
  // control indispensable: el arreglo solo puede alcanzar a las paginas cuyo
  // slug NO nombra al SKU. Si alcanzara a las fichas planas, ~900 productos
  // pasarian a depender de la API y el proyecto ya midio que la API contesta
  // otra cosa (el S25 FE: API 829.990 y agotado, la ficha 579.990 y "Comprar").
  const page = paginaFalsa({
    dd: { model_code: "SM-A376BZWKLTL", displayName: "Galaxy A37", model_price: "399990", list_price: "449990" },
    bloque: "Desde $ 33.333 en 12 cuotas sin intereses* o $ 399.990 *Aplican condiciones Agregar al carro",
    ctas: ["Agregar al carro"],
    body: "Desde $ 33.333 en 12 cuotas sin intereses* o $ 399.990 Agregar al carro",
    urlFinal: U_A37,
    selector: "[class*='pd-buying-price']",
  });
  const api = { products: [{ code: "SM-A376BZWKLTL", price: { value: 449990 }, stock: { stockLevelStatus: "outOfStock" } }] };
  const r = await extractSingleProduct(page, U_A37, [api]);
  // la ficha dice "Agregar al carro" y la API dice outOfStock: manda la ficha
  assert.equal(r.estadoStock, ESTADO.DISPONIBLE);
});

test("una /buy/ cuyo slug SI nombra al SKU no es un configurador", async () => {
  const url = "https://www.samsung.com/cl/smartphones/galaxy-a/galaxy-a37-5g-awesome-white-256gb-sm-a376bzwkltl/buy/";
  const page = paginaFalsa({
    dd: { model_code: "SM-A376BZWKLTL", displayName: "Galaxy A37", model_price: "399990", list_price: "449990" },
    bloque: "Desde $ 33.333 en 12 cuotas* o $ 399.990 *Aplican condiciones Avísame",
    ctas: ["Avísame"],
    body: "Desde $ 33.333 en 12 cuotas* o $ 399.990 Avísame",
    urlFinal: url,
    selector: "[class*='pd-buy']",
  });
  const api = { products: [{ code: "SM-A376BZWKLTL", price: { value: 449990 }, stock: { stockLevelStatus: "inStock" } }] };
  const r = await extractSingleProduct(page, url, [api]);
  // su bloque es de ESTE producto aunque el selector ganador sea pd-buy
  assert.equal(r.estadoStock, ESTADO.AGOTADO);
});

test("el arreglo no le toca el PRECIO a un configurador", async () => {
  // el precio de esta pagina ya lo resolvio el arreglo del 2026-09-13 (el filtro
  // por candidatos de digitalData): tiene que seguir dando 369.990, no el
  // tachado de 539.990 ni el de la API, que es el de lista.
  const r = await extractSingleProduct(paginaA36(), U_A36, [API_A36]);
  assert.equal(r.precio, 369990);
});

// ---------------------------------------------------------------------------
// 3. nadie se queda sin fuente, y si pasara se ve
// ---------------------------------------------------------------------------

test("sin respuesta de la API el estado queda 'desconocido': no se inventa ninguno", async () => {
  const r = await extractSingleProduct(paginaA36(), U_A36, []);
  assert.equal(r.estadoStock, ESTADO.DESCONOCIDO);
  assert.equal(r.disponible, null);
  assert.equal(r.stockSinFuente, true);
});

test("un 'desconocido' de un configurador NO pisa el estado guardado ni avisa", async () => {
  const obs = await extractSingleProduct(paginaA36(), U_A36, []);
  const previo = {
    "SM-A366ELVGLTL": { estadoStock: ESTADO.DISPONIBLE, disponible: true, versionStock: 2, precio: 369990, url: U_A36, paginaOrigen: U_A36, categoria: "Smartphones", ultimaVezVisto: "2026-09-13T12:00:00.000Z" },
  };
  const { catalogo, cambios } = comparar({
    previo,
    observado: { "SM-A366ELVGLTL": obs },
    paginasFallidas: new Set(),
    corridaConfiable: true,
    timestamp: TS,
  });
  assert.equal(catalogo["SM-A366ELVGLTL"].estadoStock, ESTADO.DISPONIBLE);
  assert.deepEqual(cambios.filter((c) => c.tipo === "stock"), []);
});

test("el diagnostico de la lectura se cuenta pero NO se guarda en el catalogo", async () => {
  const obs = await extractSingleProduct(paginaA36(), U_A36, [API_A36]);
  assert.equal(obs.stockDeSelector, true, "run.mjs lo cuenta en el resumen de la corrida");
  assert.equal(obs.stockSinFuente, undefined, "la API respondio: no quedo sin fuente");
  const { catalogo } = comparar({
    previo: {},
    observado: { "SM-A366ELVGLTL": obs },
    paginasFallidas: new Set(),
    corridaConfiable: true,
    timestamp: TS,
  });
  assert.equal("stockDeSelector" in catalogo["SM-A366ELVGLTL"], false);
  assert.equal("stockSinFuente" in catalogo["SM-A366ELVGLTL"], false);
});

test("una pagina de grupo con VARIOS propios sigue saliendo por la API, como siempre", async () => {
  // no es una regresion posible, pero es la regla de la que este arreglo es la
  // continuacion: si alguien la borrara, 14 SKU vivos quedarian sin stock
  const url = "https://www.samsung.com/cl/tablets/galaxy-tab-s9-fe/buy/";
  const page = paginaFalsa({
    dd: { model_code: "SM-X510NLGACHO,SM-X516BZAACHO", displayName: "Tab S9 FE;Tab S9 FE 5G", model_price: "499990", list_price: "599990" },
    bloque: "Buying Tool Galaxy Tab S9 FE Desde $ 499.990 Agotado",
    ctas: [],
    body: "Buying Tool Galaxy Tab S9 FE Desde $ 499.990",
    urlFinal: url,
    selector: "[class*='pd-buy']",
  });
  const api = {
    products: [
      { code: "SM-X510NLGACHO", price: { value: 499990 }, stock: { stockLevelStatus: "inStock" } },
      { code: "SM-X516BZAACHO", price: { value: 619990 }, stock: { stockLevelStatus: "outOfStock" } },
    ],
  };
  const salida = await extractSingleProduct(page, url, [api]);
  assert.equal(salida.length, 2);
  assert.equal(salida[0].estadoStock, ESTADO.DISPONIBLE);
  assert.equal(salida[1].estadoStock, ESTADO.AGOTADO);
});
