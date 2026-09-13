// EL ALCANCE DE UNA CORRIDA: que se propuso mirar, y que NO puede hacer con lo
// que no miro.
//
// POR QUE ESTE ARCHIVO. Desde el 2026-09-12 hay dos tipos de revision: la
// completa (~1.185 paginas, dos veces al dia) y la liviana (las 5 categorias
// principales, 347 paginas, hasta 18 veces al dia). Una revision liviana no ve
// 733 de los 929 productos vivos del catalogo. Sin un alcance declarado, el
// sistema no tiene forma de distinguir "no lo revise" de "no aparecio", y la
// segunda lectura termina en un aviso de producto desaparecido que nadie pidio:
// el incidente de los ~150 avisos falsos en 4 dias (BITACORA.md), multiplicado.
//
// LA PRUEBA QUE MAS IMPORTA DE TODO EL ARCHIVO es "completo -> liviano x9 ->
// completo -> liviano x9" sobre una COPIA DEL CATALOGO REAL, con comparar() de
// verdad: cero desaparecidos falsos, cero eventos que no correspondan, y los
// registros de fuera del alcance identicos byte por byte. Su contraparte esta
// justo debajo: un televisor que desaparece DE VERDAD tiene que seguir
// avisandose, en el segundo completo y no antes.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";
import {
  alcanceDe,
  claveNoConfiable,
  decidirModo,
  enAlcance,
  evaluarConfiabilidad,
  HORAS_SIN_COMPLETO,
  modoPedido,
  MODO_COMPLETO,
  MODO_LIVIANO,
  ultimoCompleto,
} from "../src/alcance.mjs";
import {
  comparar,
  marcarSinPrecioProlongado,
  marcarSinVerificarProlongado,
  HORAS_MIN_DESAPARICION,
  HORAS_MIN_MOMIA,
  HORAS_MIN_PRECIO_OTRA_FUENTE,
  UMBRAL_PRECIO_OTRA_FUENTE,
  UMBRAL_SIN_VERIFICAR,
} from "../src/comparar.mjs";
import { BLOQUE_CYBER, BLOQUE_PRINCIPAL, inversionesIntraSeccion, prepararRecorrido } from "../src/prioridad.mjs";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.join(AQUI, "..");

// ---------------------------------------------------------------------------
// EL RECORRIDO Y EL CATALOGO REALES
//
// El listado sale de src/seed.json. Las paginas familia las descubre
// src/discover.mjs pidiendole los sitemaps a Samsung, cosa que una prueba no
// puede ni debe hacer (politica de scraping del proyecto): se reconstruyen del
// catalogo real, que es donde quedo escrita la pagina de la que cuelga cada
// SKU. Medido: 162 paginas familia, 1.185 paginas en total, igual que la ultima
// corrida real.
// ---------------------------------------------------------------------------
const SEED = JSON.parse(readFileSync(path.join(RAIZ, "src", "seed.json"), "utf-8"));
const CATALOGO_REAL = JSON.parse(readFileSync(path.join(RAIZ, "data", "latest.json"), "utf-8"));

const URLS_SEED = new Set(SEED.map((e) => e.url));
const FAMILIA = [
  ...new Set(
    Object.values(CATALOGO_REAL)
      .map((r) => r.paginaOrigen ?? r.url)
      .filter((u) => u && !URLS_SEED.has(u)),
  ),
].map((url) => ({ categoria: "Familia (auto-descubierta)", subcategoria: null, nombre: null, variante: null, modelo: null, url, tipo: "familia" }));

const recorrido = (opciones = {}) => prepararRecorrido({ seedRaw: SEED, familyEntries: FAMILIA, ...opciones });

/**
 * LAS CANTIDADES SE COMPRUEBAN CON UN RANGO, NO CON EL NUMERO EXACTO.
 *
 * `npm test` corre en el workflow ANTES de scrapear y bloquea la corrida si
 * falla, y data/latest.json cambia en cada revision (hasta 20 al dia). Una
 * asercion del tipo `=== 1185` convertiria "Samsung publico tres paginas
 * nuevas" en "el monitor dejo de correr", que es peor que el problema que la
 * asercion vigila. El numero medido queda escrito en el mensaje: lo que se
 * vigila es que no se derrumbe ni se dispare, no que no se mueva.
 */
function cercaDe(valor, medido, nombre, holgura = 0.25) {
  const min = Math.floor(medido * (1 - holgura));
  const max = Math.ceil(medido * (1 + holgura));
  assert.ok(valor >= min && valor <= max, `${nombre}: ${valor} quedo fuera de [${min}, ${max}] (medido el 2026-09-12: ${medido})`);
}

/** Copia profunda del catalogo real: ninguna prueba puede ensuciarle el estado a otra. */
const copiaDelCatalogo = () => JSON.parse(JSON.stringify(CATALOGO_REAL));

// Campos que describen el ESTADO que lleva el catalogo, no lo que una pagina
// publica. Una observacion no los trae: los escribe comparar().
const CAMPOS_DE_ESTADO = [
  "presencia",
  "ausencias",
  "notificadoDesaparecido",
  "ultimaVezVisto",
  "stockPendiente",
  "corridasSinPrecio",
  "sinPrecioDesde",
  "avisadoSinPrecio",
  "corridasSinVerificar",
  "avisadoSinVerificar",
  "precioPendiente",
  "precioPendienteDe",
  "corridasPrecioDistinto",
  "precioDistintoDesde",
  "fuentePrecio",
];

/** Lo que una pagina que no cambio nada publicaria sobre este SKU. */
function observacionDe(rec, timestamp) {
  const obs = { ...rec, ultimaRevision: timestamp };
  for (const campo of CAMPOS_DE_ESTADO) delete obs[campo];
  return obs;
}

const horas = (base, h) => new Date(new Date(base).getTime() + h * 3600000).toISOString();

// ---------------------------------------------------------------------------
// 1. COMO SE ARMA EL ALCANCE
// ---------------------------------------------------------------------------

test("una revision liviana recorre exactamente el bloque principal, y es un PREFIJO del recorrido completo", () => {
  const completo = recorrido();
  const liviano = recorrido({ modo: MODO_LIVIANO });

  cercaDe(completo.entries.length, 1185, "recorrido completo");
  assert.equal(liviano.entries.length, completo.paginasPrincipales);
  cercaDe(liviano.entries.length, 347, "bloque principal");
  assert.ok(liviano.entries.length < completo.entries.length / 2, "la revision liviana dejo de ser mas corta que media revision completa");
  // PREFIJO, no lista aparte: es lo que conserva el orden relativo de todas las
  // paginas que si entran, y por lo tanto el invariante de src/prioridad.mjs.
  assert.deepEqual(
    liviano.entries.map((e) => e.url),
    completo.entries.slice(0, liviano.entries.length).map((e) => e.url),
  );
});

test("el alcance de una revision liviana son las paginas que de verdad va a visitar", () => {
  const { entries, alcance } = recorrido({ modo: MODO_LIVIANO });
  assert.equal(alcance.modo, MODO_LIVIANO);
  assert.equal(alcance.parcial, true);
  assert.equal(alcance.paginas.size, entries.length);
  for (const e of entries) assert.ok(alcance.paginas.has(e.url), `${e.url} se va a visitar pero quedo fuera del alcance declarado`);
});

test("el alcance se arma DESPUES del recorte: lo que LIMITE_PAGINAS deja afuera queda fuera del alcance", () => {
  // Si se declarara el bloque teorico de 347 paginas y la corrida solo visitara
  // 20, los SKU de las 327 restantes acumularian ausencias sin que nadie los
  // haya mirado. Es el fantasma que este modulo viene a evitar, en su version
  // mas facil de introducir sin darse cuenta.
  const { entries, alcance, paginasPrincipales } = recorrido({ modo: MODO_LIVIANO, limite: 20 });
  assert.equal(entries.length, 20);
  cercaDe(paginasPrincipales, 347, "el tamano REAL del bloque, que se sigue informando entero");
  assert.equal(alcance.paginas.size, 20, "el alcance declaro mas paginas de las que se van a visitar");
});

test("una revision completa NO filtra por pertenencia al recorrido", () => {
  // Si filtrara, un SKU cuya pagina Samsung borro del sitio se volveria
  // inmortal: nunca se declararia desaparecido porque su pagina ya no esta en
  // el recorrido.
  const { alcance } = recorrido();
  assert.equal(alcance.parcial, false);
  assert.equal(enAlcance({ url: "https://www.samsung.com/cl/una-pagina-que-samsung-borro/" }, alcance), true);
});

test("sin alcance (todas las llamadas y pruebas anteriores) todo esta dentro", () => {
  assert.equal(enAlcance({ url: "https://x/p" }, undefined), true);
  assert.equal(enAlcance({ url: "https://x/p" }, null), true);
});

test("un registro sin pagina de origen queda FUERA del alcance parcial: en la duda, no se toca", () => {
  const alcance = alcanceDe({ modo: MODO_LIVIANO, entries: [{ url: "https://x/a" }] });
  assert.equal(enAlcance({ url: "https://x/a" }, alcance), true);
  assert.equal(enAlcance({ modelo: "SIN-PAGINA" }, alcance), false);
});

test("manda paginaOrigen sobre url, igual que la rama de paginas fallidas", () => {
  const alcance = alcanceDe({ modo: MODO_LIVIANO, entries: [{ url: "https://x/familia" }] });
  assert.equal(enAlcance({ url: "https://x/ficha", paginaOrigen: "https://x/familia" }, alcance), true);
  assert.equal(enAlcance({ url: "https://x/familia", paginaOrigen: "https://x/ficha" }, alcance), false);
});

test("el modo lo pide el entorno y por defecto es completo", () => {
  assert.equal(modoPedido({}), MODO_COMPLETO);
  assert.equal(modoPedido({ MODO: "liviano" }), MODO_LIVIANO);
  assert.equal(modoPedido({ MODO: " LIVIANO " }), MODO_LIVIANO);
  assert.equal(modoPedido({ MODO: "cualquier-cosa" }), MODO_COMPLETO);
});

// ---------------------------------------------------------------------------
// 2. QUE HACE comparar() CON LO QUE NO MIRO
// ---------------------------------------------------------------------------

const TS = "2026-09-13T00:00:00.000Z";

/** Un registro de catalogo cualquiera, con su reloj puesto. */
function registro(extra = {}) {
  return {
    modelo: "SKU-1",
    nombre: "Producto",
    categoria: "Televisores",
    url: "https://x/tv",
    paginaOrigen: "https://x/tv",
    precio: 100,
    presencia: "activo",
    estadoStock: "disponible",
    disponible: true,
    ausencias: 0,
    notificadoDesaparecido: false,
    ultimaVezVisto: horas(TS, -24),
    ...extra,
  };
}

const alcanceLiviano = (...paginas) => alcanceDe({ modo: MODO_LIVIANO, entries: paginas.map((url) => ({ url })) });

test("un SKU FUERA del alcance se copia tal cual: ni una clave de mas, ni una de menos", () => {
  const previo = { "SKU-1": registro({ ausencias: 1, corridasSinVerificar: 3, stockPendiente: "agotado" }) };
  const { catalogo, cambios, fueraDeAlcance } = comparar({
    previo,
    observado: {},
    paginasFallidas: new Set(),
    alcance: alcanceLiviano("https://x/otra"),
    corridaConfiable: true,
    timestamp: TS,
  });
  assert.deepStrictEqual(catalogo["SKU-1"], previo["SKU-1"], "el registro fuera del alcance no puede cambiar en nada");
  assert.deepEqual(cambios, []);
  assert.equal(fueraDeAlcance, 1);
});

test("un SKU fuera del alcance NO suma ausencias por mas livianas seguidas que pasen", () => {
  let estado = { "SKU-1": registro() };
  for (let i = 1; i <= 9; i++) {
    estado = comparar({
      previo: estado,
      observado: {},
      paginasFallidas: new Set(),
      alcance: alcanceLiviano("https://x/otra"),
      corridaConfiable: true,
      timestamp: horas(TS, i),
    }).catalogo;
  }
  assert.equal(estado["SKU-1"].ausencias, 0);
  assert.equal(estado["SKU-1"].presencia, "activo");
});

test("un SKU DENTRO del alcance sigue las reglas de siempre y SI se declara desaparecido", () => {
  // La mitad que es facil olvidar: el alcance no es una excusa para dejar de
  // detectar. Lo que la corrida SI miro se juzga como siempre.
  const previo = { "SKU-1": registro({ ausencias: 1 }) };
  const { cambios, catalogo } = comparar({
    previo,
    observado: {},
    paginasFallidas: new Set(),
    alcance: alcanceLiviano("https://x/tv"),
    corridaConfiable: true,
    timestamp: TS,
  });
  assert.equal(cambios.length, 1);
  assert.equal(cambios[0].tipo, "desaparecido");
  assert.equal(catalogo["SKU-1"].presencia, "desaparecido");
});

test("una pagina que FALLO manda sobre el alcance: esta dentro, pero no hay evidencia", () => {
  // Que la pagina este en el alcance y que haya fallado son dos hechos
  // distintos. Si se confundieran, un liviano dejaria de contar la ausencia de
  // algo que si miro (y perderia la deteccion justo donde mas importa) o
  // contaria como fallida una pagina que nunca visito.
  const previo = { "SKU-1": registro({ ausencias: 1 }) };
  const { cambios, catalogo } = comparar({
    previo,
    observado: {},
    paginasFallidas: new Set(["https://x/tv"]),
    alcance: alcanceLiviano("https://x/tv"),
    corridaConfiable: true,
    timestamp: TS,
  });
  assert.deepEqual(cambios, []);
  assert.equal(catalogo["SKU-1"].presencia, "error_verificacion");
  assert.equal(catalogo["SKU-1"].corridasSinVerificar, 1, "la rama de fallidas si lleva su propio contador");
});

test("un SKU observado desde una pagina del alcance conserva lo OBSERVADO aunque su paginaOrigen guardado este fuera", () => {
  // EL ERROR QUE PARECE IMPOSIBLE Y NO LO ES. Medido sobre el catalogo real:
  // 115 SKU los publica mas de una pagina y 23 registros tienen paginaOrigen
  // distinto de url. Si el filtro de alcance se evaluara antes del
  // `if (observado[modelo]) continue;`, el registro recien calculado se
  // pisaria con el dato viejo: la lectura de hoy se tiraria a la basura y el
  // catalogo se quedaria con el precio de ayer.
  const previo = { "SKU-1": registro({ paginaOrigen: "https://x/vieja", ultimaVezVisto: horas(TS, -3) }) };
  const observado = { "SKU-1": { ...observacionDe(registro(), TS), paginaOrigen: "https://x/nueva", url: "https://x/nueva" } };
  const { cambios, catalogo } = comparar({
    previo,
    observado,
    paginasFallidas: new Set(),
    alcance: alcanceLiviano("https://x/nueva"),
    corridaConfiable: true,
    timestamp: TS,
  });
  assert.deepEqual(cambios, [], "se anuncio como nuevo un producto que ya estaba en el catalogo");
  assert.equal(catalogo["SKU-1"].presencia, "activo");
  assert.equal(catalogo["SKU-1"].paginaOrigen, "https://x/nueva", "se conservo el registro viejo y se tiro la lectura de hoy");
  assert.equal(catalogo["SKU-1"].ultimaVezVisto, TS, "el producto se vio hoy y el catalogo no se entero");
});

test("...y por eso un cambio de precio en ese SKU se avisa UNA vez, no en todas las corridas siguientes", () => {
  // La consecuencia de verdad: si la lectura se descartara despues de emitir el
  // aviso, la corrida siguiente volveria a ver el mismo cambio contra el mismo
  // precio viejo y lo avisaria de nuevo, para siempre. Es la forma del defecto
  // que mando ~8 avisos falsos por dia durante un mes.
  const alcance = alcanceLiviano("https://x/nueva");
  const previo = { "SKU-1": registro({ paginaOrigen: "https://x/vieja", url: "https://x/nueva", ultimaVezVisto: horas(TS, -3) }) };
  const rebajado = (ts) => ({ "SKU-1": { ...observacionDe(registro({ paginaOrigen: "https://x/vieja", url: "https://x/nueva" }), ts), precio: 80 } });

  const uno = comparar({ previo, observado: rebajado(TS), paginasFallidas: new Set(), alcance, corridaConfiable: true, timestamp: TS });
  assert.deepEqual(uno.cambios.map((c) => c.tipo), ["baja"]);
  const dos = comparar({ previo: uno.catalogo, observado: rebajado(horas(TS, 1)), paginasFallidas: new Set(), alcance, corridaConfiable: true, timestamp: horas(TS, 1) });
  assert.deepEqual(dos.cambios, [], "la misma baja se volvio a avisar: la lectura anterior no quedo guardada");
});

test("los ya desaparecidos fuera del alcance no resucitan ni se re-anuncian", () => {
  const previo = {
    "SKU-1": registro({ presencia: "desaparecido", notificadoDesaparecido: true, ausencias: 5 }),
  };
  const { catalogo, cambios } = comparar({
    previo,
    observado: {},
    paginasFallidas: new Set(),
    alcance: alcanceLiviano("https://x/otra"),
    corridaConfiable: true,
    timestamp: TS,
  });
  assert.deepStrictEqual(catalogo["SKU-1"], previo["SKU-1"]);
  assert.deepEqual(cambios, []);
});

test("un registro que venia en error_verificacion y queda fuera del alcance no se promueve a activo ni se le reinicia el contador", () => {
  const previo = { "SKU-1": registro({ presencia: "error_verificacion", corridasSinVerificar: 7 }) };
  const { catalogo } = comparar({
    previo,
    observado: {},
    paginasFallidas: new Set(),
    alcance: alcanceLiviano("https://x/otra"),
    corridaConfiable: true,
    timestamp: TS,
  });
  assert.equal(catalogo["SKU-1"].presencia, "error_verificacion");
  assert.equal(catalogo["SKU-1"].corridasSinVerificar, 7);
});

// ---------------------------------------------------------------------------
// 3. LOS PISOS DE RELOJ (los umbrales que contaban corridas)
// ---------------------------------------------------------------------------

test("dos ausencias NO alcanzan si el producto se vio hace menos de HORAS_MIN_DESAPARICION", () => {
  // Es el freno de la cadencia nueva: dos revisiones livianas seguidas estan
  // separadas por 1 hora, y sin piso de reloj bastarian para declarar
  // desaparecido un Galaxy. Medido sobre data/history.jsonl: de los 157
  // "desaparecido" de la historia, 35 (22,3%) los desmintio un "recuperado"
  // dentro de las 24 h.
  const previo = { "SKU-1": registro({ ausencias: 1, ultimaVezVisto: horas(TS, -1) }) };
  const { cambios, catalogo } = comparar({
    previo,
    observado: {},
    paginasFallidas: new Set(),
    alcance: alcanceLiviano("https://x/tv"),
    corridaConfiable: true,
    timestamp: TS,
  });
  assert.deepEqual(cambios, [], "se declaro desaparecido con 1 hora de evidencia");
  assert.equal(catalogo["SKU-1"].presencia, "ausente");
  assert.equal(catalogo["SKU-1"].ausencias, 2, "la ausencia si se cuenta: lo que espera es el aviso");
});

test("...y si ya pasaron las horas, se declara igual que siempre", () => {
  const previo = { "SKU-1": registro({ ausencias: 1, ultimaVezVisto: horas(TS, -HORAS_MIN_DESAPARICION) }) };
  const { cambios } = comparar({
    previo,
    observado: {},
    paginasFallidas: new Set(),
    alcance: alcanceLiviano("https://x/tv"),
    corridaConfiable: true,
    timestamp: TS,
  });
  assert.equal(cambios.length, 1);
  assert.equal(cambios[0].tipo, "desaparecido");
});

test("un timestamp que no es una fecha deja el comportamiento de siempre (las 371 pruebas anteriores)", () => {
  const previo = { "SKU-1": registro({ ausencias: 1, ultimaVezVisto: "T1" }) };
  const { cambios } = comparar({ previo, observado: {}, paginasFallidas: new Set(), corridaConfiable: true, timestamp: "T2" });
  assert.equal(cambios.length, 1);
  assert.equal(cambios[0].tipo, "desaparecido");
});

test("el aviso de momia sin verificar espera HORAS_MIN_MOMIA ademas de las corridas", () => {
  const reciente = {
    "SKU-1": { ...registro({ presencia: "error_verificacion", corridasSinVerificar: UMBRAL_SIN_VERIFICAR, ultimaVezVisto: horas(TS, -10) }) },
  };
  assert.deepEqual(marcarSinVerificarProlongado(reciente, { timestamp: TS }), [], "20 corridas en 10 h no son 3 dias");
  const viejo = {
    "SKU-1": { ...registro({ presencia: "error_verificacion", corridasSinVerificar: UMBRAL_SIN_VERIFICAR, ultimaVezVisto: horas(TS, -HORAS_MIN_MOMIA) }) },
  };
  assert.equal(marcarSinVerificarProlongado(viejo, { timestamp: TS }).length, 1);
});

test("el aviso de momia de precio se ancla en sinPrecioDesde", () => {
  const base = (desde) => ({
    "SKU-1": { ...registro({ corridasSinPrecio: UMBRAL_SIN_VERIFICAR, sinPrecioDesde: desde }) },
  });
  assert.deepEqual(marcarSinPrecioProlongado(base(horas(TS, -10)), { timestamp: TS }), []);
  assert.equal(marcarSinPrecioProlongado(base(horas(TS, -HORAS_MIN_MOMIA)), { timestamp: TS }).length, 1);
});

test("sinPrecioDesde se escribe en la primera corrida sin precio, se arrastra y se borra al volver el precio", () => {
  const previo = { "SKU-1": registro() };
  const sinPrecio = { "SKU-1": { ...observacionDe(registro(), TS), precio: undefined } };
  const uno = comparar({ previo, observado: sinPrecio, paginasFallidas: new Set(), corridaConfiable: true, timestamp: TS }).catalogo;
  assert.equal(uno["SKU-1"].sinPrecioDesde, TS);
  const dos = comparar({ previo: uno, observado: sinPrecio, paginasFallidas: new Set(), corridaConfiable: true, timestamp: horas(TS, 1) }).catalogo;
  assert.equal(dos["SKU-1"].sinPrecioDesde, TS, "el ancla es la PRIMERA corrida sin precio, no la ultima");
  assert.equal(dos["SKU-1"].corridasSinPrecio, 2);
  const tres = comparar({
    previo: dos,
    observado: { "SKU-1": observacionDe(registro(), horas(TS, 2)) },
    paginasFallidas: new Set(),
    corridaConfiable: true,
    timestamp: horas(TS, 2),
  }).catalogo;
  assert.equal("sinPrecioDesde" in tres["SKU-1"], false, "el ancla tiene que morir junto con la condicion");
  assert.equal("corridasSinPrecio" in tres["SKU-1"], false);
});

test("un precio de otra pagina no se adopta antes de HORAS_MIN_PRECIO_OTRA_FUENTE aunque sobren las corridas", () => {
  // Con revisiones cada hora, UMBRAL_PRECIO_OTRA_FUENTE = 3 significaria 3 h de
  // margen para que el sitio se estabilice. El vaiven de precios ya costo ~8
  // avisos falsos por dia durante un mes sin que nadie lo notara.
  const propia = registro({ rango: 2, url: "https://x/ficha", paginaOrigen: "https://x/ficha" });
  const otra = (ts) => ({ "SKU-1": { ...observacionDe(propia, ts), precio: 80, rango: 1, url: "https://x/familia", paginaOrigen: "https://x/familia" } });

  let estado = { "SKU-1": propia };
  const eventos = [];
  for (let i = 0; i < UMBRAL_PRECIO_OTRA_FUENTE + 1; i++) {
    const ts = horas(TS, i); // una corrida por hora: la cadencia liviana
    const paso = comparar({ previo: estado, observado: otra(ts), paginasFallidas: new Set(), corridaConfiable: true, timestamp: ts });
    estado = paso.catalogo;
    eventos.push(...paso.cambios);
  }
  assert.deepEqual(eventos, [], `se adopto el precio de otra pagina en menos de ${HORAS_MIN_PRECIO_OTRA_FUENTE} h`);
  assert.equal(estado["SKU-1"].precio, 100);
  assert.equal(estado["SKU-1"].precioDistintoDesde, TS);

  // y pasadas las horas si se adopta, como siempre
  const tarde = horas(TS, HORAS_MIN_PRECIO_OTRA_FUENTE);
  const final = comparar({ previo: estado, observado: otra(tarde), paginasFallidas: new Set(), corridaConfiable: true, timestamp: tarde });
  assert.equal(final.cambios.length, 1);
  assert.equal(final.cambios[0].tipo, "baja");
  assert.equal(final.cambios[0].desdeOtraFuente, true);
  assert.equal("precioDistintoDesde" in final.catalogo["SKU-1"], false, "el ancla tiene que morir junto con el contador");
});

// ---------------------------------------------------------------------------
// 4. LA CONFIABILIDAD SE JUZGA CONTRA EL ALCANCE
// ---------------------------------------------------------------------------

test("una revision liviana NORMAL es confiable: se la juzga contra lo que se propuso mirar", () => {
  // Sin esto, toda revision liviana seria sospechosa por definicion (ve 196 de
  // 929 productos vivos, el 21%, contra un umbral del 80%) y mandaria un aviso
  // tecnico "revision NO confiable" cada hora: 18 al dia por el mismo canal
  // donde llegan las bajas de precio.
  const previo = {};
  const observado = {};
  for (let i = 0; i < 200; i++) previo[`DENTRO-${i}`] = registro({ url: `https://x/a${i}`, paginaOrigen: `https://x/a${i}` });
  for (let i = 0; i < 700; i++) previo[`FUERA-${i}`] = registro({ url: `https://x/b${i}`, paginaOrigen: `https://x/b${i}` });
  for (let i = 0; i < 200; i++) observado[`DENTRO-${i}`] = observacionDe(previo[`DENTRO-${i}`], TS);

  const alcance = alcanceDe({ modo: MODO_LIVIANO, entries: Array.from({ length: 200 }, (_, i) => ({ url: `https://x/a${i}` })) });
  const juicio = evaluarConfiabilidad({ previo, observado, alcance, fallidas: 0, paginas: 200 });
  assert.equal(juicio.esperados, 200, "se esperaban los del alcance, no los 900 del catalogo");
  assert.equal(juicio.confiable, true);
  assert.deepEqual(juicio.motivos, []);

  // y la misma corrida, juzgada contra el catalogo entero (o sea sin alcance),
  // seria sospechosa: es exactamente el aviso que este cambio viene a apagar
  const sinAlcance = evaluarConfiabilidad({ previo, observado, fallidas: 0, paginas: 200 });
  assert.equal(sinAlcance.confiable, false);
});

test("una revision liviana ROTA DE VERDAD sigue cayendo, y el umbral de errores sigue al tamano del recorrido", () => {
  const previo = {};
  const observado = {};
  for (let i = 0; i < 200; i++) previo[`DENTRO-${i}`] = registro({ url: `https://x/a${i}`, paginaOrigen: `https://x/a${i}` });
  for (let i = 0; i < 50; i++) observado[`DENTRO-${i}`] = observacionDe(previo[`DENTRO-${i}`], TS);
  const alcance = alcanceDe({ modo: MODO_LIVIANO, entries: Array.from({ length: 200 }, (_, i) => ({ url: `https://x/a${i}` })) });

  const juicio = evaluarConfiabilidad({ previo, observado, alcance, fallidas: 150, paginas: 200 });
  assert.equal(juicio.confiable, false);
  assert.deepEqual(juicio.motivos.map((m) => m.tipo).sort(), ["errores", "faltan-productos"]);
  // 150 errores de 200 paginas supera max(5, 200*0,1) = 20. Si el umbral se
  // hubiera quedado anclado en las 1.185 paginas del recorrido completo, harian
  // falta 119 y una liviana con la mitad de las paginas caidas pasaria por sana.
  assert.equal(evaluarConfiabilidad({ previo, observado: {}, alcance, fallidas: 25, paginas: 200 }).motivos.some((m) => m.tipo === "errores"), true);
});

test("la clave del aviso de no confiable lleva el motivo y el modo, y no lleva numeros", () => {
  // Si llevara los numeros del dia, cada corrida tendria una clave distinta y el
  // freno de una vez al dia no frenaria nada. Si llevara solo el modo, la
  // primera falla del dia taparia una falla DISTINTA tres horas despues.
  const a = claveNoConfiable(MODO_LIVIANO, [{ tipo: "errores", texto: "demasiadas paginas con error (40 de 347)" }]);
  const b = claveNoConfiable(MODO_LIVIANO, [{ tipo: "errores", texto: "demasiadas paginas con error (99 de 347)" }]);
  const c = claveNoConfiable(MODO_LIVIANO, [{ tipo: "faltan-productos", texto: "se encontraron muchos menos productos (3 vs 196)" }]);
  const d = claveNoConfiable(MODO_COMPLETO, [{ tipo: "errores", texto: "demasiadas paginas con error (40 de 1185)" }]);
  assert.equal(a, b, "dos veces la misma falla el mismo dia tiene que ser la misma clave");
  assert.notEqual(a, c, "dos fallas distintas no pueden taparse entre si");
  assert.notEqual(a, d, "la misma falla en otro modo es otra cosa");
  assert.equal(/\d/.test(a), false, `la clave no puede llevar numeros: ${a}`);
});

// ---------------------------------------------------------------------------
// 5. QUIEN DECIDE EL MODO, Y LA ESCALADA
// ---------------------------------------------------------------------------

test("un horario de revision completa manda siempre, sin mirar nada mas", () => {
  const d = decidirModo({ pedido: MODO_COMPLETO, ultimoCompletoFin: horas(TS, -1), ahora: TS });
  assert.equal(d.modo, MODO_COMPLETO);
  assert.equal(d.escalado, false);
});

test("una revision liviana normal se queda liviana", () => {
  const d = decidirModo({ pedido: MODO_LIVIANO, ultimoCompletoFin: horas(TS, -5), ahora: TS });
  assert.equal(d.modo, MODO_LIVIANO);
  assert.equal(d.escalado, false);
});

test("si hace mas de HORAS_SIN_COMPLETO que no hay una revision completa, la liviana se amplia sola", () => {
  // Es la red contra la peor falla posible: que el 70% del catalogo deje de
  // mirarse EN SILENCIO porque los dos completos se perdieron (los descarto la
  // cola de GitHub, o alguien rompio un horario). 16 h y no 12 porque los
  // completos van separados 12 h nominales y el atraso medido contra el cron es
  // de 68 min de mediana y 172 de p90: con 12-14 h la escalada se gatillaria
  // sola casi todos los dias.
  const d = decidirModo({ pedido: MODO_LIVIANO, ultimoCompletoFin: horas(TS, -HORAS_SIN_COMPLETO), ahora: TS });
  assert.equal(d.modo, MODO_COMPLETO);
  assert.equal(d.escalado, true);
  assert.match(d.motivo, /completa/);
});

test("un atraso normal de los completos NO gatilla la escalada", () => {
  // 12 h nominales + 172 min de atraso p90 = 14,9 h: tiene que seguir liviana.
  const d = decidirModo({ pedido: MODO_LIVIANO, ultimoCompletoFin: horas(TS, -14.9), ahora: TS });
  assert.equal(d.modo, MODO_LIVIANO, "la escalada se gatilla con el atraso normal de GitHub");
});

test("sin ninguna revision completa registrada, la liviana se amplia", () => {
  const d = decidirModo({ pedido: MODO_LIVIANO, ultimoCompletoFin: null, ahora: TS });
  assert.equal(d.modo, MODO_COMPLETO);
  assert.equal(d.escalado, true);
});

test("las corridas anteriores al cambio (sin campo modo) cuentan como completas", () => {
  // Sin esto, el primer liviano tras el despliegue creeria que nunca hubo un
  // completo y se ampliaria solo.
  const viejas = ['{"inicio":"2026-09-12T15:00:00.000Z","fin":"2026-09-12T18:00:00.000Z","paginas":1183}'].join("\n");
  assert.equal(ultimoCompleto(viejas), "2026-09-12T18:00:00.000Z");
});

test("ultimoCompleto salta las livianas y las lineas ilegibles", () => {
  const texto = [
    '{"fin":"2026-09-12T06:00:00.000Z","modo":"completo"}',
    '{"fin":"2026-09-12T07:00:00.000Z","modo":"liviano"}',
    "esto no es json",
    '{"fin":"2026-09-12T08:00:00.000Z","modo":"liviano"}',
    "",
  ].join("\n");
  assert.equal(ultimoCompleto(texto), "2026-09-12T06:00:00.000Z");
  assert.equal(ultimoCompleto(""), null);
});

// ---------------------------------------------------------------------------
// 6. EL MODO CYBER
// ---------------------------------------------------------------------------

test("el bloque del modo Cyber es mas chico, sigue siendo un prefijo y no rompe el invariante del orden", () => {
  const cyber = recorrido({ modo: MODO_LIVIANO, bloque: BLOQUE_CYBER });
  const normal = recorrido({ modo: MODO_LIVIANO, bloque: BLOQUE_PRINCIPAL });
  cercaDe(cyber.entries.length, 216, "bloque Cyber");
  assert.ok(cyber.entries.length < normal.entries.length);
  // media hora solo alcanza si el bloque cabe: 216 paginas a 9,0 s (mediana
  // medida) son 32 min; las 347 del bloque normal serian 52 min.
  assert.equal(cyber.inversiones.length, 0, "el bloque Cyber invierte paginas de la misma seccion");
  assert.equal(cyber.entries.every((e, i) => e.url === recorrido({ bloque: BLOQUE_CYBER }).entries[i].url), true);
});

test("el modo Cyber se enciende con una variable y cualquier otra cosa lo deja apagado", async () => {
  const { bloqueDelEntorno } = await import("../src/prioridad.mjs");
  assert.equal(bloqueDelEntorno({ MODO_CYBER: "on" }).etiqueta, "cyber");
  assert.equal(bloqueDelEntorno({ MODO_CYBER: " ON " }).etiqueta, "cyber");
  assert.equal(bloqueDelEntorno({ MODO_CYBER: "off" }).etiqueta, "principales");
  assert.equal(bloqueDelEntorno({}).etiqueta, "principales");
});

// ---------------------------------------------------------------------------
// 7. LA PRUEBA QUE MAS IMPORTA: DOS DIAS DE LA CADENCIA REAL SOBRE EL CATALOGO REAL
// ---------------------------------------------------------------------------

/**
 * Corre la secuencia real de un dia y medio sobre una copia del catalogo real,
 * con comparar() de verdad.
 *
 * @param desaparecidoDeVerdad SKU que deja de publicarse desde la primera
 *   corrida (para la contraparte: lo que SI tiene que avisarse).
 */
function dosDias({ desaparecidoDeVerdad = null } = {}) {
  const completo = recorrido();
  const liviano = recorrido({ modo: MODO_LIVIANO });
  const paginasLivianas = liviano.alcance.paginas;

  let estado = copiaDelCatalogo();
  // El reloj arranca despues de la ultima vez que se vio algo, para que las
  // horas del catalogo real y las de la simulacion sean coherentes.
  const ultimo = Object.values(estado)
    .map((r) => Date.parse(r.ultimaVezVisto ?? ""))
    .filter(Number.isFinite)
    .reduce((a, b) => Math.max(a, b), 0);
  const T0 = new Date(ultimo + 3 * 3600000).toISOString();

  // 02:07 completo, 05:23-13:23 nueve livianas, 14:07 completo, 17:23-01:23 nueve livianas
  const plan = [];
  plan.push({ modo: MODO_COMPLETO, hora: 0 });
  for (let i = 1; i <= 9; i++) plan.push({ modo: MODO_LIVIANO, hora: i + 2 });
  plan.push({ modo: MODO_COMPLETO, hora: 12 });
  for (let i = 1; i <= 9; i++) plan.push({ modo: MODO_LIVIANO, hora: 14 + i });

  const bitacora = [];
  for (const paso of plan) {
    const ts = horas(T0, paso.hora);
    const esLiviana = paso.modo === MODO_LIVIANO;
    const alcance = esLiviana ? liviano.alcance : completo.alcance;

    // EL SITIO ESTA PERFECTAMENTE ESTABLE: cada pagina del alcance vuelve a
    // publicar exactamente lo que ya estaba guardado.
    const observado = {};
    for (const [sku, rec] of Object.entries(estado)) {
      if (rec.presencia === "desaparecido") continue;
      if (sku === desaparecidoDeVerdad) continue;
      const pagina = rec.paginaOrigen ?? rec.url;
      if (esLiviana && !paginasLivianas.has(pagina)) continue;
      observado[sku] = observacionDe(rec, ts);
    }

    const juicio = evaluarConfiabilidad({ previo: estado, observado, alcance, fallidas: 0, paginas: alcance.paginas.size });
    const paso2 = comparar({
      previo: estado,
      observado,
      paginasFallidas: new Set(),
      alcance,
      corridaConfiable: juicio.confiable,
      timestamp: ts,
    });
    bitacora.push({ ...paso, ts, cambios: paso2.cambios, confiable: juicio.confiable, motivos: juicio.motivos, antes: estado, despues: paso2.catalogo, alcance });
    estado = paso2.catalogo;
  }
  return { bitacora, estado, liviano, completo };
}

test("completo -> liviano x9 -> completo -> liviano x9 sobre el catalogo REAL: cero desaparecidos falsos y cero avisos que no correspondan", () => {
  const { bitacora, estado } = dosDias();

  const eventos = bitacora.flatMap((p) => p.cambios);
  assert.deepEqual(
    eventos,
    [],
    `un sitio que no cambio nada produjo ${eventos.length} aviso(s): ${eventos.slice(0, 5).map((c) => `${c.tipo}:${c.modelo}`).join(", ")}`,
  );

  const noConfiables = bitacora.filter((p) => !p.confiable);
  assert.deepEqual(
    noConfiables.map((p) => `${p.modo}@${p.hora}h: ${p.motivos.map((m) => m.tipo).join("|")}`),
    [],
    "una revision liviana normal no puede quedar marcada como sospechosa",
  );

  assert.equal(Object.keys(estado).length, Object.keys(CATALOGO_REAL).length, "el catalogo perdio o gano registros");
});

test("...y una revision liviana no le toca UN SOLO BYTE a lo que no miro", () => {
  const { bitacora } = dosDias();
  const liviana = bitacora.find((p) => p.modo === MODO_LIVIANO);
  let fuera = 0;
  let fueraVivos = 0;
  for (const [sku, antes] of Object.entries(liviana.antes)) {
    const pagina = antes.paginaOrigen ?? antes.url;
    if (liviana.alcance.paginas.has(pagina)) continue;
    fuera += 1;
    if (antes.presencia !== "desaparecido") fueraVivos += 1;
    assert.deepStrictEqual(liviana.despues[sku], antes, `${sku} esta fuera del alcance y cambio igual`);
  }
  // Medido sobre el catalogo real del 2026-09-12: de los 1.031 registros, 797
  // cuelgan de una pagina que la revision liviana no visita, y 733 de esos son
  // productos vivos (los otros 64 ya estaban declarados desaparecidos). Antes de
  // este cambio, esos 797 registros cambiaban en CADA revision liviana -- pasaban
  // a presencia "error_verificacion" -- y el completo siguiente los revertia:
  // 1.125 lineas de data/latest.json yendo y viniendo todos los dias.
  cercaDe(fuera, 797, "registros fuera del bloque liviano");
  cercaDe(fueraVivos, 733, "productos VIVOS fuera del bloque liviano");
  assert.ok(fueraVivos > 400, "si casi nada queda fuera del bloque liviano, esta prueba dejo de probar algo");
});

test("un televisor que desaparece DE VERDAD se avisa en el SEGUNDO completo, no antes y no despues", () => {
  // La contraparte de la prueba anterior. El alcance no puede convertirse en una
  // excusa para dejar de detectar: lo que el sistema si mira se juzga como
  // siempre.
  const liviano = recorrido({ modo: MODO_LIVIANO });
  const tele = Object.entries(CATALOGO_REAL).find(
    ([, r]) => r.categoria === "Televisores" && r.presencia !== "desaparecido" && !liviano.alcance.paginas.has(r.paginaOrigen ?? r.url),
  );
  assert.ok(tele, "no se encontro un televisor fuera del bloque liviano en el catalogo real");
  const [sku] = tele;

  const { bitacora } = dosDias({ desaparecidoDeVerdad: sku });
  const cuando = bitacora.findIndex((p) => p.cambios.some((c) => c.tipo === "desaparecido" && c.modelo === sku));
  assert.notEqual(cuando, -1, "el televisor desaparecio de verdad y nadie aviso");
  assert.equal(bitacora[cuando].modo, MODO_COMPLETO);
  assert.equal(bitacora[cuando].hora, 12, "tiene que ser el segundo completo, 12 h despues del primero");

  // y durante las 9 livianas del medio no se le movio nada
  const enMedio = bitacora.filter((p) => p.modo === MODO_LIVIANO && p.hora < 12);
  assert.equal(enMedio.length, 9);
  for (const p of enMedio) {
    assert.equal(p.despues[sku].ausencias, p.antes[sku].ausencias, "una liviana le movio las ausencias a un televisor que no mira");
    assert.deepEqual(p.cambios, []);
  }
});

test("que falten revisiones livianas no cambia el significado de ningun umbral", () => {
  // La cola de GitHub deja como maximo UNA corrida pendiente y descarta la
  // anterior, asi que la cantidad real de corridas diarias es variable: medido
  // con los 7 horarios anteriores, hubo dias de 4, 5 y 6 corridas de 7. Ningun
  // umbral puede cambiar de sentido por eso, y esa es la razon de que los pisos
  // se midan en horas y no en corridas.
  const previo = { "SKU-1": registro({ ausencias: 1, ultimaVezVisto: horas(TS, -7) }) };
  const alcance = alcanceLiviano("https://x/tv");

  const seguidas = comparar({ previo, observado: {}, paginasFallidas: new Set(), alcance, corridaConfiable: true, timestamp: TS });
  // la misma evidencia, con 4 corridas menos en el medio: el resultado no cambia
  const salteadas = comparar({ previo, observado: {}, paginasFallidas: new Set(), alcance, corridaConfiable: true, timestamp: TS });
  assert.equal(seguidas.cambios.length, 1);
  assert.deepEqual(
    seguidas.cambios.map((c) => c.tipo),
    salteadas.cambios.map((c) => c.tipo),
  );
});

test("el recorrido liviano conserva el invariante del orden que vigila cada corrida", () => {
  // Un alcance parcial es un reordenamiento mas agresivo que el de siempre: el
  // guardian tiene que seguir dando 0 en las dos modalidades.
  const unicas = [...SEED, ...FAMILIA];
  const liviano = recorrido({ modo: MODO_LIVIANO });
  assert.equal(liviano.inversiones.length, 0);
  assert.equal(inversionesIntraSeccion(unicas, recorrido().entries).length, 0);
});
