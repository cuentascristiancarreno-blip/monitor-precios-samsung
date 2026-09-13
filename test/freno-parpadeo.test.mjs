// EL FRENO ANTI-PARPADEO (src/estabilidad.mjs), probado contra SECUENCIAS REALES.
//
// Pedido del operador (2026-09-13): "Ultimamente me han llegado varias
// notificaciones constantes. Por ejemplo, el Galaxy A36 256GB: dices que estaba
// antes a 539.990 y ahora 369.990. Despues vuelve a 539.990, y despues baja a
// 369.990. (...) si ya me notificaste este cambio una vez, no es necesario
// volver a notificarlo las veces siguientes; o si efectivamente Samsung esta
// cambiando el precio, ya, esta bien que me notifiques."
//
// LA REGLA QUE ESTAS PRUEBAS DEFIENDEN, en una frase: un rebote NO se calla, se
// DEGRADA. Deja de tener su propia alerta y pasa a UNA linea compacta de la
// seccion "Siguen rebotando" del mismo resumen de la misma corrida. Por eso casi
// todas las pruebas de abajo vienen en par: una exige que el ruido baje y la otra
// exige que NO se pierda ni un dato -- porque la version anterior de este modulo
// si callaba, y medido sobre los 30 dias reales se tragaba 61 bajas de precio de
// verdad, 49 de ellas del 20% o mas.
//
// DE DONDE SALE EL MATERIAL
//  - Los tres SKU del encargo: de los 21 commits de data/latest.json entre el
//    2026-09-11T19:35Z y el 2026-09-13T14:46Z, con las marcas de tiempo UTC
//    REALES de `git log --format=%cI` (tres de esos commits estan fechados en
//    -03:00 y una version anterior de esta prueba los trataba como si fueran Z).
//    La serie de PRECIO es el dato guardado tal cual; la de STOCK es una
//    RECONSTRUCCION de lo observado, deducida de `estadoStock` + `stockPendiente`
//    (un cambio de stock necesita 2 corridas para confirmarse, asi que lo
//    observado va una corrida por delante de lo guardado).
//  - El monitor LS32DG300ELXZS: sus 58 cambios de precio reales de 30 dias,
//    copiados de data/history.jsonl.
//  - La ola de tablets del 2026-09-12T05:19: sus 13 bajas reales, de history.jsonl.
import { test } from "node:test";
import assert from "node:assert/strict";
import { comparar, rebotesDe, resumenDeRebotes } from "../src/comparar.mjs";
import { crearDespachadorVivo, esNotificable, esParaVivo, repartirCierre } from "../src/despachador-vivo.mjs";
import { evaluarEstabilidad, VALORES_RECORDADOS, VENTANA_REBOTE_HORAS, esRebote } from "../src/estabilidad.mjs";
import { mensajeRebotando, notifyDiscord, notifyTecnico } from "../src/discord.mjs";
import { ESTADO } from "../src/stock.mjs";

const U_A36 = "https://www.samsung.com/cl/smartphones/galaxy-a36/buy/";
const U_FLIP7FE = "https://www.samsung.com/cl/smartphones/galaxy-z-flip7-fe/buy/";
const U_FLIP6 = "https://www.samsung.com/cl/smartphones/galaxy-z-flip6/buy/";

// Las 21 corridas reales, en su orden y su hora UTC de verdad (git log %cI).
// Las tres que vienen con -03:00 en el repo son las de 03:38:29Z, 03:39:09Z y
// 12:44:39Z; ponerlas como si fueran Z ademas invertia dos veces el orden.
const CORRIDAS = [
  "2026-09-11T19:35:50Z", "2026-09-11T22:41:09Z", "2026-09-12T01:47:51Z", "2026-09-12T03:38:29Z",
  "2026-09-12T03:39:09Z", "2026-09-12T08:21:15Z", "2026-09-12T11:22:10Z", "2026-09-12T12:44:39Z",
  "2026-09-12T16:15:46Z", "2026-09-12T18:30:53Z", "2026-09-12T20:45:21Z", "2026-09-12T23:24:30Z",
  "2026-09-13T01:52:03Z", "2026-09-13T05:43:49Z", "2026-09-13T07:04:18Z", "2026-09-13T08:12:45Z",
  "2026-09-13T09:03:47Z", "2026-09-13T10:12:51Z", "2026-09-13T12:12:25Z", "2026-09-13T14:06:06Z",
  "2026-09-13T14:46:36Z",
].map((t) => new Date(t).toISOString());

const D = ESTADO.DISPONIBLE;
const A = ESTADO.AGOTADO;
const N = ESTADO.NO_A_LA_VENTA;

// Lo observado en cada una de las 21 corridas. Las tres corridas que cambian de
// lugar al corregir la hora traen el MISMO valor observado que sus vecinas, asi
// que reordenarlas no mueve ni una celda de estas series (verificado).
const OBSERVADO_REAL = {
  "SM-A366ELVGLTL": {
    nombre: "Galaxy A36",
    url: U_A36,
    stock: [D, D, D, D, D, D, A, A, A, D, D, A, D, A, A, A, A, A, A, A, D],
    precio: [369990, 369990, 369990, 369990, 369990, 539990, 369990, 369990, 369990, 539990, 539990, 369990, 539990, 369990, 369990, 369990, 369990, 369990, 369990, 369990, 539990],
  },
  "SM-F761BZKJCHO": {
    nombre: "Galaxy Z Flip7 FE",
    url: U_FLIP7FE,
    stock: [D, D, D, D, D, N, A, A, A, N, N, N, A, A, A, A, N, N, A, N, N],
    precio: new Array(21).fill(999990),
  },
  "SM-F741BAKKCHO": {
    nombre: "Galaxy Z Flip6",
    url: U_FLIP6,
    stock: [D, D, D, D, D, A, A, A, A, A, A, N, A, A, A, A, N, A, A, N, N],
    precio: new Array(21).fill(1369990),
  },
};

// EL REPLAY ARRANCA EN EL SNAPSHOT DEL 2026-09-12T08:21Z (indice 5), QUE ES
// DONDE EMPIEZA EL RUIDO QUE REPORTO EL OPERADOR. Entre el 11-09 y esa corrida
// los tres SKU pasaron de "disponible" a su estado real SIN emitir ningun
// evento, porque ese salto lo hizo la adopcion silenciosa de la migracion del
// detector de stock. data/history.jsonl lo confirma: el primer evento de stock
// del Z Flip7 FE es no-a-la-venta>agotado, no disponible>agotado.
const INICIO = 5;

function registroInicial(sku) {
  const d = OBSERVADO_REAL[sku];
  return {
    modelo: sku,
    nombre: d.nombre,
    precio: d.precio[INICIO],
    moneda: "CLP",
    estadoStock: d.stock[INICIO],
    disponible: d.stock[INICIO] === D,
    versionStock: 2,
    versionPrecio: 4,
    rango: 3,
    url: d.url,
    paginaOrigen: d.url,
    categoria: "Smartphones",
    presencia: "activo",
    ausencias: 0,
    notificadoDesaparecido: false,
    ultimaVezVisto: CORRIDAS[INICIO],
  };
}

/** Replay de las 21 corridas con comparar() real. */
function replay({ desde = INICIO + 1 } = {}) {
  let previo = Object.fromEntries(Object.keys(OBSERVADO_REAL).map((s) => [s, registroInicial(s)]));
  const detectados = [];
  const aDiscord = [];
  const nuevosRebotando = [];
  for (let i = desde; i < CORRIDAS.length; i++) {
    const observado = {};
    for (const [sku, d] of Object.entries(OBSERVADO_REAL)) {
      observado[sku] = {
        modelo: sku,
        nombre: d.nombre,
        precio: d.precio[i],
        moneda: "CLP",
        estadoStock: d.stock[i],
        disponible: d.stock[i] === D,
        versionStock: 2,
        versionPrecio: 4,
        rango: 3,
        url: d.url,
        paginaOrigen: d.url,
        categoria: "Smartphones",
      };
    }
    const r = comparar({ previo, observado, paginasFallidas: new Set(), corridaConfiable: true, timestamp: CORRIDAS[i] });
    detectados.push(...r.cambios);
    aDiscord.push(...r.cambios.filter(esNotificable));
    nuevosRebotando.push(...r.nuevosRebotando);
    previo = r.catalogo;
  }
  return { detectados, aDiscord, nuevosRebotando, catalogo: previo };
}

const cuenta = (lista, sku, tipos) => lista.filter((c) => c.modelo === sku && tipos.includes(c.tipo)).length;
const fuertes = (lista, sku, tipos) => lista.filter((c) => c.modelo === sku && tipos.includes(c.tipo) && !esRebote(c)).length;

// ---------------------------------------------------------------------------
// LA PRUEBA QUE MAS IMPORTA
// ---------------------------------------------------------------------------

test("la secuencia REAL de los tres SKU: a lo mas UNA alerta fuerte por producto y por magnitud", () => {
  const { detectados, aDiscord } = replay();

  // 1. sin el freno, esto es lo que el operador recibio: la seguidilla
  assert.ok(cuenta(detectados, "SM-A366ELVGLTL", ["baja", "sube"]) >= 5, "el vaiven de precio del A36 existe en la secuencia real");
  assert.ok(cuenta(detectados, "SM-A366ELVGLTL", ["stock"]) >= 2, "el vaiven de stock del A36 existe en la secuencia real");
  assert.ok(cuenta(detectados, "SM-F761BZKJCHO", ["stock"]) >= 3, "el vaiven de stock del Z Flip7 FE existe en la secuencia real");

  // 2. con el freno, el operador recibe a lo mas UNA alerta fuerte de cada cosa
  assert.equal(fuertes(aDiscord, "SM-A366ELVGLTL", ["baja", "sube"]), 1, "A36 precio");
  assert.equal(fuertes(aDiscord, "SM-A366ELVGLTL", ["stock"]), 1, "A36 stock");
  assert.equal(fuertes(aDiscord, "SM-F761BZKJCHO", ["stock"]), 1, "Z Flip7 FE stock");

  // 3. el Z Flip6 cambio UNA sola vez de verdad: se avisa igual
  assert.equal(fuertes(aDiscord, "SM-F741BAKKCHO", ["stock"]), 1, "Z Flip6 stock");
});

test("y NI UNO de esos cambios se pierde: todos llegan a Discord, los repetidos compactos", () => {
  const { detectados, aDiscord } = replay();
  // la diferencia entre "detectado" y "entregado" tiene que ser CERO
  assert.equal(aDiscord.length, detectados.length, "ningun cambio se calla");
  const rebotes = detectados.filter(esRebote);
  assert.ok(rebotes.length > 0, "hubo rebotes en la secuencia real");
  // y cada rebote entregado trae lo que el operador necesita para decidir
  for (const c of rebotes) {
    assert.equal(esNotificable(c), true);
    assert.ok(Array.isArray(c.valoresRebote) && c.valoresRebote.length >= 2, "dice entre que valores rebota");
    assert.ok(c.vecesRebotado >= 1, "dice cuantas veces va");
  }
});

// ---------------------------------------------------------------------------
// EL PARPADEO LENTO: el caso que la version anterior no veia
// ---------------------------------------------------------------------------

// Los 58 cambios de precio REALES del monitor Odyssey G3 en 30 dias, copiados de
// data/history.jsonl. Siempre entre $279.990 y $199.990, con separaciones de 2,5
// a 50 h: la version anterior del freno (ventana de 24 h) le dejaba pasar 22
// alertas, una cada ~34 h, "bajo/subio/bajo/subio".
const MONITOR = [
  ["2026-08-14T14:09:44.965Z", 279990, 199990], ["2026-08-14T16:56:25.500Z", 199990, 279990],
  ["2026-08-14T22:32:14.119Z", 279990, 199990], ["2026-08-15T13:22:54.939Z", 199990, 279990],
  ["2026-08-15T16:27:21.485Z", 279990, 199990], ["2026-08-15T19:24:16.458Z", 199990, 279990],
  ["2026-08-15T22:14:58.676Z", 279990, 199990], ["2026-08-16T02:18:59.868Z", 199990, 279990],
  ["2026-08-17T19:25:00.421Z", 279990, 199990], ["2026-08-18T03:52:56.097Z", 199990, 279990],
  ["2026-08-20T02:14:10.648Z", 279990, 199990], ["2026-08-20T05:21:44.947Z", 199990, 279990],
  ["2026-08-21T08:28:58.766Z", 279990, 199990], ["2026-08-21T13:37:53.887Z", 199990, 279990],
  ["2026-08-24T13:42:30.289Z", 279990, 199990], ["2026-08-24T16:53:19.562Z", 199990, 279990],
  ["2026-08-25T09:03:17.972Z", 279990, 199990], ["2026-08-25T13:41:18.849Z", 199990, 279990],
  ["2026-08-25T16:41:31.381Z", 279990, 199990], ["2026-08-25T19:48:29.894Z", 199990, 279990],
  ["2026-08-25T22:56:54.319Z", 279990, 199990], ["2026-08-26T02:22:31.310Z", 199990, 279990],
  ["2026-08-26T13:45:44.652Z", 279990, 199990], ["2026-08-26T16:58:36.658Z", 199990, 279990],
  ["2026-08-28T12:26:16.391Z", 279990, 199990], ["2026-08-28T15:51:40.754Z", 199990, 279990],
  ["2026-08-29T01:50:50.119Z", 279990, 199990], ["2026-08-29T04:52:03.633Z", 199990, 279990],
  ["2026-08-30T17:05:13.038Z", 279990, 199990], ["2026-08-30T19:59:41.082Z", 199990, 279990],
  ["2026-08-31T22:21:06.406Z", 279990, 199990], ["2026-09-01T01:16:42.412Z", 199990, 279990],
  ["2026-09-01T09:11:55.066Z", 279990, 199990], ["2026-09-01T12:25:34.175Z", 199990, 279990],
  ["2026-09-03T12:34:38.422Z", 279990, 199990], ["2026-09-03T16:46:02.661Z", 199990, 279990],
  ["2026-09-03T22:53:05.466Z", 279990, 199990], ["2026-09-04T07:40:17.903Z", 199990, 279990],
  ["2026-09-04T17:03:37.583Z", 279990, 199990], ["2026-09-04T19:59:59.723Z", 199990, 279990],
  ["2026-09-05T08:16:09.034Z", 279990, 199990], ["2026-09-05T11:11:17.754Z", 199990, 279990],
  ["2026-09-05T15:42:40.153Z", 279990, 199990], ["2026-09-05T18:37:12.234Z", 199990, 279990],
  ["2026-09-05T21:30:07.732Z", 279990, 199990], ["2026-09-06T05:24:53.713Z", 199990, 279990],
  ["2026-09-06T11:34:02.200Z", 279990, 199990], ["2026-09-06T19:00:29.421Z", 199990, 279990],
  ["2026-09-08T12:09:29.583Z", 279990, 199990], ["2026-09-08T19:46:14.397Z", 199990, 279990],
  ["2026-09-08T22:48:18.430Z", 279990, 199990], ["2026-09-09T08:33:39.082Z", 199990, 279990],
  ["2026-09-10T16:45:58.690Z", 279990, 199990], ["2026-09-10T19:50:29.074Z", 199990, 279990],
  ["2026-09-11T16:49:42.072Z", 279990, 199990], ["2026-09-11T19:36:33.658Z", 199990, 279990],
  ["2026-09-12T21:06:23.732Z", 279990, 199990], ["2026-09-12T23:39:28.442Z", 199990, 279990],
];

const MON = "LS32DG300ELXZS";
const baseMonitor = (extra = {}) => ({
  modelo: MON,
  nombre: "Monitor Odyssey G3 32\"",
  moneda: "CLP",
  estadoStock: D,
  disponible: true,
  versionStock: 2,
  versionPrecio: 4,
  rango: 3,
  url: "https://www.samsung.com/cl/monitors/gaming/odyssey-g3-32-inch-ls32dg300elxzs/",
  paginaOrigen: "https://www.samsung.com/cl/monitors/gaming/odyssey-g3-32-inch-ls32dg300elxzs/",
  categoria: "Monitores",
  ...extra,
});

function replayMonitor() {
  let previo = {
    [MON]: baseMonitor({ precio: MONITOR[0][1], presencia: "activo", ausencias: 0, notificadoDesaparecido: false, ultimaVezVisto: MONITOR[0][0] }),
  };
  const todos = [];
  for (const [ts, , nuevo] of MONITOR) {
    const r = comparar({
      previo,
      observado: { [MON]: baseMonitor({ precio: nuevo }) },
      paginasFallidas: new Set(),
      corridaConfiable: true,
      timestamp: ts,
    });
    todos.push(...r.cambios);
    previo = r.catalogo;
  }
  return { todos, catalogo: previo };
}

test("el parpadeo LENTO del monitor real: 58 cambios en 30 dias, a lo mas 3 alertas fuertes", () => {
  const { todos } = replayMonitor();
  assert.equal(todos.length, MONITOR.length, "los 58 cambios se detectan igual");
  const alertas = todos.filter((c) => !esRebote(c));
  // Con la ventana de 24 h de la version anterior salian 22 (medido con su
  // propio codigo). Con 72 h son 2: uno por cada valor del vaiven.
  assert.ok(alertas.length <= 3, `alertas fuertes = ${alertas.length}, tendrian que ser 3 o menos`);
  assert.ok(alertas.length >= 1, "la primera vez SI es novedad y tiene que salir");
});

test("...y las 56 restantes igual le llegan, con el precio de HOY en cada una", () => {
  const { todos } = replayMonitor();
  const entregados = todos.filter(esNotificable);
  assert.equal(entregados.length, MONITOR.length, "no se calla ni uno");
  const bajasCalladas = todos.filter((c) => esRebote(c) && c.tipo === "baja");
  assert.ok(bajasCalladas.length > 10, "hay muchas bajas repetidas en la secuencia real");
  // cada una de esas bajas sigue trayendo el precio bajo: el operador puede ir a comprar
  for (const c of bajasCalladas) assert.equal(c.precio, 199990);
});

// ---------------------------------------------------------------------------
// LAS DOS FORMAS QUE LA VERSION ANTERIOR CALLABA PARA SIEMPRE
// ---------------------------------------------------------------------------

const SKU = "SM-TEST";
const base = (extra = {}) => ({
  modelo: SKU,
  nombre: "Galaxy de prueba",
  moneda: "CLP",
  versionStock: 2,
  versionPrecio: 4,
  rango: 3,
  url: "https://www.samsung.com/cl/smartphones/galaxy-x/galaxy-x-sm-test/",
  paginaOrigen: "https://www.samsung.com/cl/smartphones/galaxy-x/galaxy-x-sm-test/",
  categoria: "Smartphones",
  ...extra,
});

function corrida(previo, obs, timestamp) {
  return comparar({
    previo,
    observado: { [SKU]: base(obs) },
    paginasFallidas: new Set(),
    corridaConfiable: true,
    timestamp,
  });
}

const arranque = (extra) => ({ [SKU]: base({ presencia: "activo", ausencias: 0, notificadoDesaparecido: false, ultimaVezVisto: "2026-11-01T00:00:00.000Z", ...extra }) });

test("una promo diaria REAL de 7 dias: el operador se entera las 7 veces", () => {
  // -30% de 09:00 a 21:00, todos los dias, durante una semana. Es la forma exacta
  // de una promo de verdad, y con la version anterior del freno el operador
  // recibia UN aviso en los 7 dias y despues silencio (simulado con su codigo).
  let previo = arranque({ precio: 999990, estadoStock: D, disponible: true });
  const entregados = [];
  for (let dia = 1; dia <= 7; dia++) {
    const d = String(dia + 1).padStart(2, "0");
    for (const [hora, precio] of [["09", 699990], ["21", 999990]]) {
      const ts = `2026-11-${d}T${hora}:00:00.000Z`;
      const r = corrida(previo, { precio, estadoStock: D, disponible: true }, ts);
      entregados.push(...r.cambios.filter(esNotificable));
      previo = r.catalogo;
    }
  }
  const bajas = entregados.filter((c) => c.tipo === "baja");
  assert.equal(bajas.length, 7, "las 7 bajas reales le llegan");
  for (const b of bajas) assert.equal(b.precio, 699990);
  // y solo la PRIMERA es alerta fuerte: las otras 6 van compactas
  assert.equal(bajas.filter((c) => !esRebote(c)).length, 1);
});

test("una reposicion diaria REAL de 7 dias: el operador se entera las 7 veces", () => {
  let previo = arranque({ precio: 999990, estadoStock: A, disponible: false });
  const entregados = [];
  for (let dia = 1; dia <= 7; dia++) {
    const d = String(dia + 1).padStart(2, "0");
    for (const [hora, estado] of [["10", D], ["20", A]]) {
      // el stock necesita 2 observaciones para confirmarse
      for (const min of ["00", "30"]) {
        const ts = `2026-11-${d}T${hora}:${min}:00.000Z`;
        const r = corrida(previo, { precio: 999990, estadoStock: estado, disponible: estado === D }, ts);
        entregados.push(...r.cambios.filter(esNotificable));
        previo = r.catalogo;
      }
    }
  }
  const vuelve = entregados.filter((c) => c.tipo === "stock" && c.estado === D);
  assert.equal(vuelve.length, 7, "las 7 reposiciones reales le llegan");
  assert.equal(vuelve.filter((c) => !esRebote(c)).length, 1, "solo la primera es alerta fuerte");
});

test("bajo un ciclo recurrente el freno NO se convierte en silencio: nada queda sin entregar", () => {
  let previo = arranque({ precio: 999990, estadoStock: D, disponible: true });
  let detectados = 0;
  let entregados = 0;
  for (let dia = 1; dia <= 7; dia++) {
    const d = String(dia + 1).padStart(2, "0");
    for (const [hora, precio] of [["09", 699990], ["21", 999990]]) {
      const r = corrida(previo, { precio, estadoStock: D, disponible: true }, `2026-11-${d}T${hora}:00:00.000Z`);
      detectados += r.cambios.length;
      entregados += r.cambios.filter(esNotificable).length;
      previo = r.catalogo;
    }
  }
  assert.equal(entregados, detectados);
  assert.ok(detectados >= 14);
  // y el ultimo estado que el operador escucho es el de verdad
  assert.equal(previo[SKU].precio, 999990);
});

// ---------------------------------------------------------------------------
// LA OLA CON FORMA DE CYBER
// ---------------------------------------------------------------------------

// Las 13 bajas REALES de la ola de tablets del 2026-09-12T05:19 (history.jsonl).
const OLA = [
  ["SM-X520NLBACHO", 729990, 479990], ["SM-X520NLBECHO", 579990, 539990],
  ["SM-X520NZAACHO", 729990, 479990], ["SM-X520NZAECHO", 839990, 539990],
  ["SM-X620NZAACHO", 899990, 689990], ["SM-X620NZAECHO", 999990, 739990],
  ["SM-X400NZRDCHO", 549989, 494990], ["SM-X400NZADCHO", 549989, 494990],
  ["SM-X400NZAHCHO", 649990, 479990], ["SM-X400NZSDCHO", 549989, 494990],
  ["SM-X730NZADCHO", 1169990, 1149990], ["SM-X930NZADCHO", 1899990, 1699990],
  ["SM-X930NZAHCHO", 1999990, 1599990],
];

// La verificacion independiente midio que la version ANTERIOR del freno callaba
// 10 de estas 13 (77%), y esa es la forma exacta de una ola de Cyber. Con esta
// version ninguna se calla: las que van a un precio nuevo salen fuertes, y si
// alguna repitiera un precio que el operador escucho hace menos de 72 h saldria
// igual, compacta y con el precio de hoy (lo exige la segunda prueba).
test("la ola REAL de 13 bajas de tablets: las 13 llegan, y las 13 son alerta fuerte", () => {
  const tablet = (sku, precio, extra = {}) => ({
    modelo: sku,
    nombre: "Galaxy Tab",
    precio,
    moneda: "CLP",
    estadoStock: D,
    disponible: true,
    versionStock: 2,
    versionPrecio: 4,
    rango: 3,
    url: `https://www.samsung.com/cl/tablets/galaxy-tab/${sku.toLowerCase()}/`,
    paginaOrigen: `https://www.samsung.com/cl/tablets/galaxy-tab/${sku.toLowerCase()}/`,
    categoria: "Tablets",
    ...extra,
  });
  const previo = Object.fromEntries(
    OLA.map(([sku, antes]) => [sku, tablet(sku, antes, { presencia: "activo", ausencias: 0, notificadoDesaparecido: false, ultimaVezVisto: "2026-09-12T04:00:00.000Z" })]),
  );
  const observado = Object.fromEntries(OLA.map(([sku, , ahora]) => [sku, tablet(sku, ahora)]));
  const r = comparar({ previo, observado, paginasFallidas: new Set(), corridaConfiable: true, timestamp: "2026-09-12T05:19:12.935Z" });
  const bajas = r.cambios.filter((c) => c.tipo === "baja");
  assert.equal(bajas.length, 13);
  assert.equal(bajas.filter(esNotificable).length, 13, "las 13 llegan");
  // un precio que el producto NO tenia hace poco es NOVEDAD, siempre
  assert.equal(bajas.filter((c) => !esRebote(c)).length, 13, "ninguna se degrada");
});

test("...y si una de la ola repite un precio de hace horas, igual llega con el precio de hoy", () => {
  const sku = "SM-X400NZAHCHO";
  const ficha = (precio, extra = {}) => ({
    modelo: sku,
    nombre: "Galaxy Tab S9 FE",
    precio,
    moneda: "CLP",
    estadoStock: D,
    disponible: true,
    versionStock: 2,
    versionPrecio: 4,
    rango: 3,
    url: "https://www.samsung.com/cl/tablets/galaxy-tab/x400/",
    paginaOrigen: "https://www.samsung.com/cl/tablets/galaxy-tab/x400/",
    categoria: "Tablets",
    ...extra,
  });
  const paso = (previo, precio, ts) =>
    comparar({ previo, observado: { [sku]: ficha(precio) }, paginasFallidas: new Set(), corridaConfiable: true, timestamp: ts });

  let previo = { [sku]: ficha(649990, { presencia: "activo", ausencias: 0, notificadoDesaparecido: false, ultimaVezVisto: "2026-09-11T00:00:00.000Z" }) };
  // ya habia bajado a 479.990 y vuelto: el operador conoce los dos numeros
  previo = paso(previo, 479990, "2026-09-11T06:00:00.000Z").catalogo;
  previo = paso(previo, 649990, "2026-09-11T18:00:00.000Z").catalogo;
  const r = paso(previo, 479990, "2026-09-12T05:19:12.935Z");
  assert.equal(r.cambios.length, 1);
  assert.equal(esRebote(r.cambios[0]), true, "es un precio que ya escucho hace menos de 72 h");
  assert.equal(esNotificable(r.cambios[0]), true, "pero le llega igual: la version anterior lo callaba");
  assert.equal(r.cambios[0].precio, 479990, "con el precio de hoy, que es lo unico accionable");
});

// ---------------------------------------------------------------------------
// LA MEMORIA: cuantos valores y cuanta ventana
// ---------------------------------------------------------------------------

test("un ciclo de SEIS valores se reconoce como rebote en la segunda vuelta", () => {
  // Con 2 valores recordados (lo que tenia la version anterior) un ciclo de 3 o
  // mas es ESTRUCTURALMENTE invisible: el valor al que se vuelve se abandono
  // varios pasos atras y ya no esta en memoria.
  const valores = [100000, 200000, 300000, 400000, 500000, 600000];
  let previo = arranque({ precio: valores[0], estadoStock: D, disponible: true });
  const vueltas = [];
  for (let paso = 1; paso <= valores.length * 2; paso++) {
    const precio = valores[paso % valores.length];
    const ts = new Date(Date.parse("2026-11-01T00:00:00.000Z") + paso * 3 * 3600000).toISOString();
    const r = corrida(previo, { precio, estadoStock: D, disponible: true }, ts);
    vueltas.push(...r.cambios);
    previo = r.catalogo;
  }
  assert.equal(VALORES_RECORDADOS, 6);
  const segundaVuelta = vueltas.slice(valores.length);
  assert.ok(segundaVuelta.length >= 5);
  for (const c of segundaVuelta) assert.equal(esRebote(c), true, `${c.precio} ya se habia avisado`);
});

test("un ciclo de TRES valores tambien, que es lo que 2 valores recordados no veia", () => {
  const valores = [100000, 200000, 300000];
  let previo = arranque({ precio: valores[0], estadoStock: D, disponible: true });
  const vueltas = [];
  for (let paso = 1; paso <= 6; paso++) {
    const ts = new Date(Date.parse("2026-11-01T00:00:00.000Z") + paso * 3 * 3600000).toISOString();
    const r = corrida(previo, { precio: valores[paso % 3], estadoStock: D, disponible: true }, ts);
    vueltas.push(...r.cambios);
    previo = r.catalogo;
  }
  // pasos 4, 5 y 6 vuelven a valores ya conocidos
  assert.deepEqual(vueltas.slice(3).map(esRebote), [true, true, true]);
});

test("un rebote MAS LENTO que la ventana ya no es un rebote: vuelve a ser novedad", () => {
  let previo = arranque({ precio: 999990, estadoStock: D, disponible: true });
  let r = corrida(previo, { precio: 699990, estadoStock: D, disponible: true }, "2026-11-01T00:00:00.000Z");
  previo = r.catalogo;
  // muy pasada la ventana: la memoria ya se poda sola
  const tarde = new Date(Date.parse("2026-11-01T00:00:00.000Z") + (VENTANA_REBOTE_HORAS + 2) * 3600000).toISOString();
  r = corrida(previo, { precio: 999990, estadoStock: D, disponible: true }, tarde);
  assert.equal(r.cambios.length, 1);
  assert.equal(esRebote(r.cambios[0]), false, "pasada la ventana vuelve a ser noticia");
});

test("la memoria del freno se borra sola y no engorda el catalogo de los productos sanos", () => {
  const { catalogo } = replay();
  assert.equal("rebotePrecio" in catalogo["SM-F741BAKKCHO"], false, "el Z Flip6 nunca cambio de precio: no hay nada que recordar");

  const masTarde = new Date(Date.parse(CORRIDAS[CORRIDAS.length - 1]) + (VENTANA_REBOTE_HORAS + 1) * 3600000).toISOString();
  const r = comparar({
    previo: catalogo,
    observado: {
      "SM-F741BAKKCHO": {
        modelo: "SM-F741BAKKCHO",
        nombre: "Galaxy Z Flip6",
        precio: 1369990,
        moneda: "CLP",
        estadoStock: N,
        disponible: false,
        versionStock: 2,
        versionPrecio: 4,
        rango: 3,
        url: U_FLIP6,
        paginaOrigen: U_FLIP6,
        categoria: "Smartphones",
      },
    },
    paginasFallidas: new Set(),
    corridaConfiable: true,
    timestamp: masTarde,
  });
  assert.equal("reboteStock" in r.catalogo["SM-F741BAKKCHO"], false);
});

test("un registro viejo sin fechas medibles no queda rebotando para siempre", () => {
  const previo = arranque({
    precio: 999990,
    estadoStock: D,
    disponible: true,
    rebotePrecio: { v: [699990, 999990], hasta: "no es una fecha", n: 5, ultimo: "tampoco", desde: "tampoco" },
  });
  const r = corrida(previo, { precio: 699990, estadoStock: D, disponible: true }, "2026-11-01T00:00:00.000Z");
  assert.equal(esRebote(r.cambios[0]), false, "memoria ilegible = memoria olvidada");
  assert.equal(rebotesDe(r.catalogo, "2026-11-01T00:00:00.000Z").length, 0);
});

// ---------------------------------------------------------------------------
// LO QUE EL FRENO NO PUEDE TOCAR
// ---------------------------------------------------------------------------

test("un valor NUEVO es alerta fuerte aunque el producto venga rebotando", () => {
  let previo = arranque({ precio: 999990, estadoStock: D, disponible: true });
  let r = corrida(previo, { precio: 699990, estadoStock: D, disponible: true }, "2026-11-01T00:00:00.000Z");
  previo = r.catalogo;
  r = corrida(previo, { precio: 999990, estadoStock: D, disponible: true }, "2026-11-01T06:00:00.000Z");
  assert.equal(esRebote(r.cambios[0]), true, "el ida y vuelta si es un rebote");
  previo = r.catalogo;
  // baja de Cyber: un numero que nunca tuvo
  r = corrida(previo, { precio: 499990, estadoStock: D, disponible: true }, "2026-11-01T12:00:00.000Z");
  assert.equal(r.cambios.length, 1);
  assert.equal(r.cambios[0].tipo, "baja");
  assert.equal(esRebote(r.cambios[0]), false, "una baja a un precio nuevo sale como alerta fuerte");
});

test("el freno solo mira precio y stock: no toca 'nuevo', 'recuperado' ni 'desaparecido'", () => {
  const r = comparar({
    previo: {},
    observado: { [SKU]: base({ precio: 999990, estadoStock: D, disponible: true }) },
    paginasFallidas: new Set(),
    corridaConfiable: true,
    timestamp: "2026-11-01T00:00:00.000Z",
  });
  assert.equal(r.cambios[0].tipo, "nuevo");
  assert.equal(esRebote(r.cambios[0]), false);
  assert.equal("rebotePrecio" in r.catalogo[SKU], false, "un producto nuevo no estrena memoria de rebotes");
});

test("el freno no se traga un 'recuperado' aunque su precio sea uno recordado", () => {
  let previo = arranque({ precio: 999990, estadoStock: D, disponible: true });
  let r = corrida(previo, { precio: 699990, estadoStock: D, disponible: true }, "2026-11-01T00:00:00.000Z");
  previo = r.catalogo;
  // desaparece y vuelve al precio de antes
  previo[SKU] = { ...previo[SKU], presencia: "desaparecido", notificadoDesaparecido: true, ausencias: 3 };
  r = corrida(previo, { precio: 999990, estadoStock: D, disponible: true }, "2026-11-01T06:00:00.000Z");
  const recuperado = r.cambios.find((c) => c.tipo === "recuperado");
  assert.ok(recuperado, "el 'volvio al sitio' tiene que salir");
  assert.equal(esRebote(recuperado), false);
});

test("el stock 'desconocido' no entra a la memoria del freno", () => {
  let previo = arranque({ precio: 999990, estadoStock: D, disponible: true });
  for (const ts of ["2026-11-01T00:00:00.000Z", "2026-11-01T02:00:00.000Z"]) {
    const r = corrida(previo, { precio: 999990, estadoStock: ESTADO.DESCONOCIDO, disponible: null }, ts);
    previo = r.catalogo;
  }
  assert.equal("reboteStock" in previo[SKU], false, "una lectura ilegible no es un valor");
});

test("el freno conserva el ORDEN de los avisos aunque degrade uno del medio", () => {
  let previo = arranque({ precio: 999990, estadoStock: D, disponible: true });
  let r = corrida(previo, { precio: 699990, estadoStock: D, disponible: true }, "2026-11-01T00:00:00.000Z");
  previo = r.catalogo;
  previo[SKU] = { ...previo[SKU], presencia: "desaparecido", notificadoDesaparecido: true, ausencias: 3 };
  r = corrida(previo, { precio: 999990, estadoStock: A, disponible: false }, "2026-11-01T06:00:00.000Z");
  const tipos = r.cambios.map((c) => c.tipo);
  assert.deepEqual(tipos, [...tipos].sort((a, b) => (a === "recuperado" ? -1 : b === "recuperado" ? 1 : 0)), "recuperado sigue yendo primero");
});

// ---------------------------------------------------------------------------
// EL CAMINO POR EL QUE SALEN LOS AVISOS
// ---------------------------------------------------------------------------

test("el cierre SI manda los rebotes (repartirCierre, el camino real de produccion)", () => {
  const rebote = { tipo: "baja", modelo: SKU, categoria: "Smartphones", precio: 699990, precioAnterior: 999990, rebote: true, valoresRebote: [699990, 999990], vecesRebotado: 2 };
  const normal = { tipo: "baja", modelo: "SM-OTRO", categoria: "Smartphones", precio: 100, precioAnterior: 200 };
  const accesorio = { tipo: "baja", modelo: "SM-ACC", categoria: "Accesorios móviles", precio: 1, precioAnterior: 2 };
  const { paraDiscord } = repartirCierre([rebote, normal, accesorio], null);
  assert.deepEqual(paraDiscord.map((c) => c.modelo), [SKU, "SM-OTRO"], "el rebote pasa, el accesorio no");
});

test("...pero el camino EN VIVO no: un rebote espera al resumen y sale compacto", async () => {
  let previo = arranque({ precio: 999990, estadoStock: D, disponible: true });
  let r = corrida(previo, { precio: 699990, estadoStock: D, disponible: true }, "2026-11-01T00:00:00.000Z");
  previo = r.catalogo;
  r = corrida(previo, { precio: 999990, estadoStock: D, disponible: true }, "2026-11-01T06:00:00.000Z");
  assert.equal(esRebote(r.cambios[0]), true);
  assert.equal(esParaVivo(r.cambios[0]), false, "en vivo no");
  assert.equal(esNotificable(r.cambios[0]), true, "al cierre si");

  // y el despachador real tampoco lo encola: es el camino de produccion
  const despachador = crearDespachadorVivo({
    webhook: "https://discord.test/webhook",
    previo,
    timestamp: "2026-11-01T06:00:00.000Z",
    totalPaginas: 1,
    rutaNotificados: null,
  });
  const encolados = despachador.evaluar({ [SKU]: base({ precio: 999990, estadoStock: D, disponible: true }) }, [SKU], { pagina: 1 });
  assert.equal(encolados, 0, "un rebote no se encola en vivo");
});

// ---------------------------------------------------------------------------
// EL RASTRO: resumen y canal tecnico
// ---------------------------------------------------------------------------

test("el resumen de la corrida trae los tres numeros del freno, y no clavados en cero", () => {
  const { detectados, catalogo, nuevosRebotando } = replay();
  const ultimo = CORRIDAS[CORRIDAS.length - 1];
  const r = resumenDeRebotes({ cambios: detectados, catalogo, nuevosRebotando, timestamp: ultimo });
  assert.ok(r.avisosDegradados > 0, "hubo avisos degradados en la secuencia real");
  assert.equal(r.avisosDegradados, detectados.filter(esRebote).length);
  assert.ok(r.productosRebotando > 0);
  assert.equal(r.productosRebotando, rebotesDe(catalogo, ultimo).length);
  assert.ok(r.productosNuevosRebotando > 0);
});

test("un SKU fuera del alcance no figura rebotando para siempre", () => {
  const { catalogo } = replay();
  const ultimo = CORRIDAS[CORRIDAS.length - 1];
  assert.ok(rebotesDe(catalogo, ultimo).length > 0);
  const semanaDespues = new Date(Date.parse(ultimo) + 8 * 24 * 3600000).toISOString();
  assert.equal(rebotesDe(catalogo, semanaDespues).length, 0, "el reloj tambien se aplica al leer el catalogo");
});

test("el aviso tecnico dice que NO se pierde nada, y no promete salir una sola vez", () => {
  const { catalogo } = replay();
  const lista = rebotesDe(catalogo, CORRIDAS[CORRIDAS.length - 1]);
  const texto = mensajeRebotando(lista);
  assert.match(texto, /rebotando/i);
  assert.match(texto, /SM-A366ELVGLTL/);
  assert.match(texto, /No dejo de avisarte nada/);
  assert.match(texto, /NUEVO/);
  assert.match(texto, new RegExp(String(VENTANA_REBOTE_HORAS)));
  assert.doesNotMatch(texto, /una sola vez por producto/i, "eso era falso: el episodio cierra y vuelve a abrir");
});

test("si Discord rechaza el aviso tecnico, notifyTecnico lo dice para que se reintente", async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => ({ ok: false, status: 404, text: async () => "Unknown Webhook" });
    const r = await notifyTecnico("https://discord.test/webhook", "hola");
    assert.equal(r.entregado, false, "sin esto, la huella se escribia igual y el aviso se perdia para siempre");
  } finally {
    globalThis.fetch = original;
  }
  const sinWebhook = await notifyTecnico("", "hola");
  assert.equal(sinWebhook.entregado, true, "sin webhook no hay nada que reintentar");
});

test("un producto que YA venia rebotando no vuelve a generar el aviso tecnico", () => {
  let previo = arranque({ precio: 999990, estadoStock: D, disponible: true });
  const nuevos = [];
  // ida, vuelta, ida, vuelta: solo la PRIMERA vuelta es el comienzo del episodio
  for (const [ts, precio] of [
    ["2026-11-01T00:00:00.000Z", 699990],
    ["2026-11-01T06:00:00.000Z", 999990],
    ["2026-11-01T12:00:00.000Z", 699990],
    ["2026-11-01T18:00:00.000Z", 999990],
  ]) {
    const r = corrida(previo, { precio, estadoStock: D, disponible: true }, ts);
    nuevos.push(r.nuevosRebotando.length);
    previo = r.catalogo;
  }
  assert.deepEqual(nuevos, [0, 1, 0, 0], "el aviso tecnico sale una vez por episodio, no en cada corrida");
});

test("pasada la ventana el episodio se cierra, y uno nuevo vuelve a avisarse", () => {
  let previo = arranque({ precio: 999990, estadoStock: D, disponible: true });
  let r = corrida(previo, { precio: 699990, estadoStock: D, disponible: true }, "2026-11-01T00:00:00.000Z");
  previo = r.catalogo;
  r = corrida(previo, { precio: 999990, estadoStock: D, disponible: true }, "2026-11-01T06:00:00.000Z");
  assert.equal(r.nuevosRebotando.length, 1);
  previo = r.catalogo;
  // el reloj corre: pasada la ventana ya no figura rebotando...
  const tarde = new Date(Date.parse("2026-11-01T06:00:00.000Z") + (VENTANA_REBOTE_HORAS + 1) * 3600000).toISOString();
  assert.equal(rebotesDe(previo, tarde).length, 0, "el contador de rebotes tambien se poda por reloj");
  // ...y un vaiven nuevo empieza de cero y vuelve a avisar
  r = corrida(previo, { precio: 699990, estadoStock: D, disponible: true }, tarde);
  previo = r.catalogo;
  const masTarde = new Date(Date.parse(tarde) + 6 * 3600000).toISOString();
  r = corrida(previo, { precio: 999990, estadoStock: D, disponible: true }, masTarde);
  assert.equal(r.nuevosRebotando.length, 1, "episodio nuevo, aviso nuevo");
});

test("un producto con memoria pero SIN rebotes no figura en la lista de rebotando", () => {
  // una sola baja: el producto tiene memoria (para reconocer la vuelta) pero no
  // esta rebotando. Contarlo inflaria el numero que vigila el operador y le
  // mandaria un aviso tecnico por un producto que se porto bien.
  const r = corrida(arranque({ precio: 999990, estadoStock: D, disponible: true }), { precio: 699990, estadoStock: D, disponible: true }, "2026-11-01T00:00:00.000Z");
  assert.ok(r.catalogo[SKU].rebotePrecio, "la memoria si queda guardada");
  assert.equal(r.catalogo[SKU].rebotePrecio.n, 0);
  assert.equal(rebotesDe(r.catalogo, "2026-11-01T01:00:00.000Z").length, 0);
  // y tambien SIN reloj: "rebotando" quiere decir "tiene rebotes", no "tiene
  // memoria". Sin esta guarda, los ~290 productos que llevan memoria en el peor
  // momento del mes se contarian todos como si estuvieran rebotando.
  assert.equal(rebotesDe(r.catalogo).length, 0);
});

test("rebotesDe nunca reporta 'desconocido' como valor actual", () => {
  // el stock ilegible no es un valor (misma regla que src/stock.mjs): si el aviso
  // tecnico dijera "ahora: desconocido", el operador leeria una medicion donde
  // solo hay una lectura fallida.
  const catalogo = {
    [SKU]: base({
      precio: 999990,
      estadoStock: ESTADO.DESCONOCIDO,
      disponible: null,
      reboteStock: { v: [A, D], hasta: "2026-11-01T00:00:00.000Z", n: 2, ultimo: "2026-11-01T00:00:00.000Z", desde: "2026-11-01T00:00:00.000Z" },
    }),
  };
  const lista = rebotesDe(catalogo, "2026-11-01T01:00:00.000Z");
  assert.equal(lista.length, 1);
  assert.equal(lista[0].valor, null);
  assert.doesNotMatch(mensajeRebotando(lista), /desconocido/i);
});

// ---------------------------------------------------------------------------
// COMO LO VE EL OPERADOR EN DISCORD
// ---------------------------------------------------------------------------

test("el resumen pone los rebotes en su propia seccion compacta, no entre las bajas", async () => {
  const original = globalThis.fetch;
  const enviados = [];
  try {
    globalThis.fetch = async (url, opts) => {
      enviados.push(JSON.parse(opts.body).content);
      return { ok: true };
    };
    await notifyDiscord("https://fake.webhook", {
      totalRevisado: 100,
      errores: 0,
      changes: [
        { tipo: "baja", modelo: "SM-REAL", nombre: "Tablet", precio: 479990, precioAnterior: 729990, categoria: "Tablets", url: "https://x/1" },
        {
          tipo: "baja", modelo: MON, nombre: "Monitor Odyssey G3", precio: 199990, precioAnterior: 279990,
          categoria: "Monitores", url: "https://x/2",
          rebote: true, valoresRebote: [199990, 279990], vecesRebotado: 7,
        },
      ],
    });
  } finally {
    globalThis.fetch = original;
  }
  const texto = enviados.join("\n");
  assert.match(texto, /Siguen rebotando/, "el rebote tiene su propia seccion");
  assert.match(texto, /Bajas de precio \(1\)/, "la baja REAL sigue sola en su seccion");
  // la linea compacta trae lo unico accionable: el precio de hoy y entre que va
  assert.match(texto, /LS32DG300ELXZS.*\$199\.990.*\$279\.990.*ahora \*\*\$199\.990\*\*/s);
  assert.match(texto, /7ª vez/);
  // y el rebote NO se dibuja como una alerta de baja
  assert.doesNotMatch(texto, /Precio antes: \$279\.990/);
});

test("un rebote de STOCK se dibuja con las palabras de stock, no con precios", async () => {
  const original = globalThis.fetch;
  const enviados = [];
  try {
    globalThis.fetch = async (url, opts) => {
      enviados.push(JSON.parse(opts.body).content);
      return { ok: true };
    };
    await notifyDiscord("https://fake.webhook", {
      totalRevisado: 1,
      errores: 0,
      changes: [
        {
          tipo: "stock", modelo: "SM-F761BZKJCHO", nombre: "Galaxy Z Flip7 FE", estado: A, estadoAnterior: N,
          disponible: false, precio: 999990, categoria: "Smartphones", url: "https://x/3",
          rebote: true, valoresRebote: [A, N], vecesRebotado: 3,
        },
      ],
    });
  } finally {
    globalThis.fetch = original;
  }
  const texto = enviados.join("\n");
  assert.match(texto, /Siguen rebotando/);
  assert.match(texto, /agotado/i);
  assert.doesNotMatch(texto, /\$999\.990/, "el precio no es la magnitud que rebota");
});

// ---------------------------------------------------------------------------
// EL MODULO, DIRECTO
// ---------------------------------------------------------------------------

test("evaluarEstabilidad es pura: no toca el registro anterior", () => {
  const ant = { rebotePrecio: { v: [999990], hasta: "2026-11-01T00:00:00.000Z", n: 0, ultimo: null, desde: null } };
  const copia = JSON.parse(JSON.stringify(ant));
  evaluarEstabilidad({
    ant,
    cambios: [{ tipo: "baja", precio: 999990, precioAnterior: 699990 }],
    timestamp: "2026-11-01T02:00:00.000Z",
  });
  assert.deepEqual(ant, copia, "el camino en vivo y el cierre la llaman con el MISMO ant");
});

test("el valor que se deja atras tambien cuenta como conocido", () => {
  // primera vez: 999990 -> 699990 es novedad, pero volver a 999990 no lo es,
  // porque 999990 es lo que el catalogo venia diciendo
  const r1 = evaluarEstabilidad({
    ant: undefined,
    cambios: [{ tipo: "baja", precio: 699990, precioAnterior: 999990 }],
    timestamp: "2026-11-01T00:00:00.000Z",
  });
  assert.equal(esRebote(r1.cambios[0]), false);
  const r2 = evaluarEstabilidad({
    ant: r1.memorias,
    cambios: [{ tipo: "sube", precio: 999990, precioAnterior: 699990 }],
    timestamp: "2026-11-01T03:00:00.000Z",
  });
  assert.equal(esRebote(r2.cambios[0]), true);
  assert.equal(r2.nuevosRebotando.length, 1);
});
