// EL STOCK SE MIDE POR CRUCE DE FRONTERA, NO POR ESTADO (src/estabilidad.mjs).
//
// Estas pruebas defienden los dos defectos que el encargo del 2026-10-05 puso
// primeros, y los defienden contra la SEMANA REAL del Cyber chileno, no contra
// casos inventados.
//
// DEFECTO 1 — EL FRENO SE COMIA REPOSICIONES REALES. 15 avisos de "volvio el
// stock" de productos que de verdad volvieron a estar comprables salieron como
// linea chica bajo el titulo "Siguen rebotando (ya te los avise, no es
// novedad)". 14 de los 15 eran la PRIMERA vez que ese producto volvia. Entre
// ellos el 75" Micro RGB R85H ($1.399.990, 97 h disponible) y el S26 Ultra +
// monitor Odyssey OLED G5 ($1.346.490, 92 h). Suman 1.018 horas de
// disponibilidad real; 10 duraron 24 h o mas y 8 seguian disponibles.
//
// La causa era ESTRUCTURAL: el stock tiene solo tres estados con valor, asi que
// "volver a un valor que ya escuchaste" es, para el stock, volver a estar
// disponible. Al agotarse, el freno recordaba las DOS puntas del cambio
// (disponible y agotado) en la misma pasada, asi que la reposicion de 48 h
// despues ya era "conocida" sin que hubiera habido ningun parpadeo. Dos de los
// 15 venian de 63,3 y 71,9 h agotados, a horas de la ventana de 72 h.
//
// DEFECTO 2 — UNA DE CADA CINCO ALERTAS NO SERVIA PARA NADA. 107 de las 590
// alertas fuertes de la semana (18,1%) avisaban un paso de "agotado" a "no esta
// a la venta". 89 de ellas (132 contando accesorios) salieron en UNA sola
// revision, la del 2026-10-02T11:19. Las dos cosas significan que el operador no
// puede comprar: no podia antes y no puede ahora.
//
// EL MATERIAL. `test/fixtures/stock-semana-cyber.json` es una FOTO CONGELADA de
// los 243 eventos de stock notificables de data/history.jsonl entre el
// 2026-09-26 (72 h antes de la semana, para que la memoria del freno llegue
// caliente) y el 2026-10-05. No se refresca: es regresion contra un hecho, no un
// censo de hoy (ver test/fixtures/LEEME.md y test/candado-offline.test.mjs).
//
// LO OBSERVADO ES UNA RECONSTRUCCION, y se dice: un cambio de stock necesita DOS
// observaciones seguidas para confirmarse, asi que cada evento del historial se
// sirve dos veces -- una a ts-1 min, que deja el pendiente, y otra en el ts REAL,
// que lo confirma y emite el evento. Asi el evento cae en su hora de verdad, que
// es lo unico de lo que dependen las ventanas del freno.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";
import { comparar, rebotesDe, resumenDeRebotes } from "../src/comparar.mjs";
import { esNotificable, esParaVivo } from "../src/despachador-vivo.mjs";
import {
  LADO,
  MATIZ,
  VENTANA_QUIEBRE_HORAS,
  crucesVigentes,
  cruceDeStock,
  esMatiz,
  esMatizNoComprable,
  esMatizQueVuelve,
  esRebote,
  evaluarEstabilidad,
  ladoDe,
  matizDe,
} from "../src/estabilidad.mjs";
import { TOPE_MATICES, mensajeRebotando, notifyDiscord } from "../src/discord.mjs";
import { ESTADO } from "../src/stock.mjs";
import { relojVirtual } from "../src/reloj.mjs";

// Estas pruebas miran el CONTENIDO de los mensajes, no el ritmo de envio: sin
// esto el cubo de fichas (una ficha cada 2,3 s) haria dormir la suite de verdad.
// El ritmo se verifica aparte en test/vivo.test.mjs, con reloj virtual y el
// valor de produccion.
process.env.DISCORD_PAUSA_MS = "0";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const FOTO = JSON.parse(readFileSync(path.join(AQUI, "fixtures", "stock-semana-cyber.json"), "utf8"));
const SEMANA = FOTO.ventanaSemana;

const D = ESTADO.DISPONIBLE;
const A = ESTADO.AGOTADO;
const N = ESTADO.NO_A_LA_VENTA;

/**
 * Los 15 avisos de reposicion que la semana del Cyber degrado, con su SKU y su
 * hora, copiados uno por uno del historial. Es la lista del encargo.
 */
const LOS_15 = FOTO.eventos.filter((e) => e.ts >= SEMANA && e.a === D && e.degradado === true);

function registro(sku, estado, precio, extra = {}) {
  const p = FOTO.productos[sku];
  return {
    modelo: sku,
    nombre: p.nombre,
    moneda: "CLP",
    estadoStock: estado,
    disponible: estado === D,
    versionStock: 2,
    versionPrecio: 4,
    rango: 3,
    url: p.url,
    paginaOrigen: p.url,
    categoria: p.categoria,
    ...(Number.isFinite(precio) ? { precio } : {}),
    ...extra,
  };
}

/**
 * Replay de la semana REAL con `comparar()` de verdad, evento a evento.
 * @returns {{detectados, entregados}}
 */
function replaySemana() {
  // catalogo inicial: cada SKU arranca en el estado DE DONDE sale su primer
  // evento, que es lo que el catalogo tenia guardado en ese momento
  const previo = {};
  for (const e of FOTO.eventos) {
    if (previo[e.sku]) continue;
    previo[e.sku] = registro(e.sku, e.de, e.precio, {
      presencia: "activo",
      ausencias: 0,
      notificadoDesaparecido: false,
      ultimaVezVisto: FOTO.desde,
    });
  }

  // los eventos agrupados por corrida
  const porCorrida = new Map();
  for (const e of FOTO.eventos) {
    if (!porCorrida.has(e.ts)) porCorrida.set(e.ts, []);
    porCorrida.get(e.ts).push(e);
  }

  let catalogo = previo;
  const detectados = [];
  for (const [ts, grupo] of porCorrida) {
    const paginas = new Set(grupo.map((e) => FOTO.productos[e.sku].url));
    const alcance = { parcial: true, paginas };
    const observado = {};
    for (const e of grupo) observado[e.sku] = registro(e.sku, e.a, e.precio);
    // la primera observacion deja el pendiente, la segunda (en el ts real) emite
    const antes = new Date(new Date(ts).getTime() - 60_000).toISOString();
    let r = comparar({ previo: catalogo, observado, paginasFallidas: new Set(), alcance, corridaConfiable: true, timestamp: antes });
    detectados.push(...r.cambios);
    catalogo = r.catalogo;
    r = comparar({ previo: catalogo, observado, paginasFallidas: new Set(), alcance, corridaConfiable: true, timestamp: ts });
    detectados.push(...r.cambios.map((c) => ({ ...c, ts })));
    catalogo = r.catalogo;
  }
  return { detectados, entregados: detectados.filter(esNotificable), catalogo };
}

const deLaSemana = (c) => c.ts >= SEMANA;
const esFuerte = (c) => !esRebote(c) && !esMatiz(c);

// ---------------------------------------------------------------------------
// LA PRUEBA QUE MAS IMPORTA
// ---------------------------------------------------------------------------

test("la SEMANA REAL del Cyber: los 15 avisos de reposicion degradados salen como ALERTA FUERTE", () => {
  const { detectados } = replaySemana();
  assert.equal(LOS_15.length, 15, "la foto trae los 15 del encargo");

  const reposiciones = detectados.filter((c) => c.tipo === "stock" && deLaSemana(c) && c.estado === D);
  assert.equal(reposiciones.length, 73, "los 73 avisos de reposicion de la semana se detectan igual");

  // ANTES: 58 fuertes y 15 degradados (medido sobre el historial real).
  // AHORA: los 73.
  assert.equal(reposiciones.filter(esFuerte).length, 73, "las 73 reposiciones son alerta fuerte");

  // y los 15 del encargo, uno por uno, con su SKU
  for (const esperado of LOS_15) {
    const c = reposiciones.find((x) => x.modelo === esperado.sku && x.ts === esperado.ts);
    assert.ok(c, `falta la reposicion de ${esperado.sku} del ${esperado.ts}`);
    assert.equal(esRebote(c), false, `${esperado.sku} ya no sale degradado`);
    assert.equal(esMatiz(c), false, `${esperado.sku} no es un matiz`);
    // CON PRECIO Y LINK, que son las dos cosas que la linea chica no llevaba
    assert.equal(c.precio, esperado.precio, `${esperado.sku} lleva su precio`);
    assert.ok(c.url && c.url.startsWith("https://"), `${esperado.sku} lleva su link`);
  }
});

test("...y los 118 avisos de agotado <-> no-a-la-venta NO salen como alerta fuerte", () => {
  const { detectados } = replaySemana();
  const sinCruce = detectados.filter(
    (c) =>
      c.tipo === "stock" &&
      deLaSemana(c) &&
      ((c.estadoAnterior === A && c.estado === N) || (c.estadoAnterior === N && c.estado === A)),
  );
  // 103 de agotado -> no-a-la-venta y 15 de vuelta, medidos sobre el historial.
  // De esos 118, 107 eran alerta fuerte: el 18,1% de las 590 de la semana.
  assert.equal(sinCruce.length, 118, "los 118 se detectan igual");
  assert.equal(sinCruce.filter(esFuerte).length, 0, "ninguno es alerta fuerte");
  assert.equal(sinCruce.filter(esMatiz).length, 118, "los 118 salen como matiz");
  // y la revision del 2-oct, que mando 89 de una sola vez
  const elPico = sinCruce.filter((c) => c.ts === "2026-10-02T11:19:56.333Z");
  assert.equal(elPico.length, 89, "la revision del 2026-10-02T11:19 traia 89 notificables");
  assert.equal(elPico.filter(esFuerte).length, 0);
});

test("NO se silencia ni un aviso: lo detectado y lo entregado siguen siendo lo mismo", () => {
  const { detectados, entregados } = replaySemana();
  assert.equal(entregados.length, detectados.length, "ningun cambio se calla");
  // los dos avisos que el operador NO puede perder siguen enteros
  const seAgoto = detectados.filter((c) => c.tipo === "stock" && deLaSemana(c) && c.estadoAnterior === D);
  const volvio = detectados.filter((c) => c.tipo === "stock" && deLaSemana(c) && c.estado === D);
  assert.equal(seAgoto.length, 35, "los 35 'se agoto' de la semana");
  assert.equal(volvio.length, 73, "los 73 'volvio el stock' de la semana");
  assert.equal(volvio.filter(esFuerte).length, 73, "las reposiciones, todas fuertes");
  // De los 35 quiebres, 6 son el SEGUNDO "se agoto" del mismo SKU dentro de las
  // 72 h: esos salen compactos, que es el trabajo del freno. Los otros 29 son
  // alerta fuerte.
  assert.equal(seAgoto.filter(esFuerte).length, 29, "29 quiebres fuertes");
  assert.equal(seAgoto.filter(esRebote).length, 6, "y 6 quiebres repetidos, compactos");
});

test("el freno de stock sigue vivo: lo que de verdad parpadea sale compacto", () => {
  const { detectados } = replaySemana();
  const degradados = detectados.filter((c) => c.tipo === "stock" && esRebote(c));
  // Medido sobre los 342 cruces de frontera del historial completo (213
  // reposiciones + 129 quiebres) con la regla nueva: 19 se repiten dentro de su
  // ventana y los 19 son QUIEBRES. En la semana son 6. Los numeros de la primera
  // vuelta de este arreglo (241 cruces, 8 degradados) estaban medidos con un
  // clasificador que se dejaba afuera los 101 eventos anteriores al 2026-09-12
  // -- los que solo traen los booleanos --, que el codigo SI maneja.
  assert.ok(degradados.length > 0, "el freno degrada algo: no es codigo muerto");
  assert.ok(degradados.length <= 12, `degradados = ${degradados.length}, tendrian que ser pocos`);
  for (const c of degradados) {
    // UN REBOTE DE STOCK SOLO PUEDE SER UN QUIEBRE REPETIDO. Una reposicion no
    // se degrada nunca, asi que `ladoRebote` no puede ser el lado comprable.
    assert.equal(c.ladoRebote, LADO.NO_COMPRABLE);
    assert.ok(c.vecesRebotado >= 1);
  }
});

// ---------------------------------------------------------------------------
// LA FRONTERA, DIRECTO
// ---------------------------------------------------------------------------

test("agotado y no-a-la-venta son el MISMO lado de la frontera", () => {
  assert.equal(ladoDe(D), LADO.COMPRABLE);
  assert.equal(ladoDe(A), LADO.NO_COMPRABLE);
  assert.equal(ladoDe(N), LADO.NO_COMPRABLE);
  assert.equal(ladoDe(ESTADO.DESCONOCIDO), null);
});

test("el cruce de un cambio de stock es el lado al que se mueve", () => {
  assert.equal(cruceDeStock({ tipo: "stock", estadoAnterior: A, estado: D }), LADO.COMPRABLE);
  assert.equal(cruceDeStock({ tipo: "stock", estadoAnterior: N, estado: D }), LADO.COMPRABLE);
  assert.equal(cruceDeStock({ tipo: "stock", estadoAnterior: D, estado: A }), LADO.NO_COMPRABLE);
  assert.equal(cruceDeStock({ tipo: "stock", estadoAnterior: D, estado: N }), LADO.NO_COMPRABLE);
  // los que NO cruzan
  assert.equal(cruceDeStock({ tipo: "stock", estadoAnterior: A, estado: N }), null);
  assert.equal(cruceDeStock({ tipo: "stock", estadoAnterior: N, estado: A }), null);
  // y lo que no se puede leer
  assert.equal(cruceDeStock({ tipo: "stock", estadoAnterior: ESTADO.DESCONOCIDO, estado: D }), null);
  assert.equal(cruceDeStock({ tipo: "baja", precio: 1, precioAnterior: 2 }), null);
});

test("el matiz exige que los DOS lados sean el no-comprable", () => {
  assert.equal(esMatizNoComprable({ tipo: "stock", estadoAnterior: A, estado: N }), true);
  assert.equal(esMatizNoComprable({ tipo: "stock", estadoAnterior: N, estado: A }), true);
  assert.equal(esMatizNoComprable({ tipo: "stock", estadoAnterior: D, estado: A }), false);
  assert.equal(esMatizNoComprable({ tipo: "stock", estadoAnterior: A, estado: D }), false);
  // un cambio con los booleanos viejos de history.jsonl se lee igual
  assert.equal(esMatizNoComprable({ tipo: "stock", disponibleAnterior: false, disponible: false }), true);
  assert.equal(esMatizNoComprable({ tipo: "stock", disponibleAnterior: true, disponible: false }), false);
});

// ---------------------------------------------------------------------------
// LAS DOS VENTANAS, Y POR QUE SON DISTINTAS
// ---------------------------------------------------------------------------

const ANT = (campo) => ({ modelo: "SM-X", estadoStock: A, ...campo });
const cambioStock = (de, a) => ({ tipo: "stock", modelo: "SM-X", estadoAnterior: de, estado: a, disponible: a === D });

test("una REPOSICION no se degrada NUNCA, ni repetida tres veces en un dia de Cyber", () => {
  // LA PRIMERA VERSION DE ESTE ARREGLO LE PUSO UN PISO DE 12 h Y SE SACO, porque
  // no compraba nada y cargaba el unico riesgo que el encargo prohibe: la
  // reposicion es el unico aviso de stock con el que el operador puede COMPRAR.
  // Medido sobre los 478 eventos de stock notificables del historial completo
  // (clasificados con cruceDeStock, o sea con el respaldo a los booleanos de los
  // 101 eventos anteriores al 2026-09-12): de las 213 reposiciones, el piso de
  // 12 h degradaba CERO; las 52 repeticiones de reposicion tienen minimo 20,44 h
  // (NP750XGJ-KS4CL, 2026-08-15) y solo 3 bajan de 24 h. Sacarlo cuesta cero
  // eventos distintos en 2,5 meses.
  //
  // El caso que el piso pretendia atajar es este: un dia de Cyber en que el
  // producto se agota y vuelve tres veces. Las tres reposiciones salen FUERTES y
  // las tres salen EN VIVO, porque las tres son una oportunidad de compra nueva:
  // entre una y otra el producto se agoto, asi que la ventana de disponibilidad
  // es otra.
  let ant = {};
  const veredictos = [];
  const horas = ["09:00", "11:00", "13:00", "15:00", "17:00", "19:00"];
  for (let i = 0; i < horas.length; i++) {
    const ts = `2026-10-01T${horas[i]}:00.000Z`;
    const cambio = i % 2 === 0 ? cambioStock(D, A) : cambioStock(A, D);
    const r = evaluarEstabilidad({ ant, cambios: [cambio], timestamp: ts });
    ant = { reboteStock: r.memorias.reboteStock };
    if (i % 2 === 1) veredictos.push({ fuerte: !esRebote(r.cambios[0]), vivo: esParaVivo(r.cambios[0]) });
  }
  assert.deepEqual(
    veredictos,
    [
      { fuerte: true, vivo: true },
      { fuerte: true, vivo: true },
      { fuerte: true, vivo: true },
    ],
    "las tres reposiciones del dia salen fuertes y en vivo",
  );
});

test("...y la reposicion tampoco deja memoria: no hay instante contra el cual degradarla", () => {
  // Es la otra mitad del mismo arreglo. Si el cruce hacia comprable se guardara
  // "por si acaso", bastaria cambiar una constante para que volviera a degradar;
  // y ademas esa llave es la que el aviso tecnico imprimia como una afirmacion
  // sobre si se puede comprar.
  const t0 = "2026-10-01T00:00:00.000Z";
  const r = evaluarEstabilidad({ ant: {}, cambios: [cambioStock(A, D)], timestamp: t0 });
  assert.equal(r.memorias.reboteStock, undefined, "una reposicion sola no deja memoria de stock");
  const r2 = evaluarEstabilidad({ ant: {}, cambios: [cambioStock(D, A)], timestamp: t0 });
  assert.deepEqual(Object.keys(r2.memorias.reboteStock.c), [LADO.NO_COMPRABLE], "el quiebre si, y es la UNICA llave posible");
});

test("un quiebre repetido tiene 72 h de ventana, no 12", () => {
  const t0 = "2026-10-01T00:00:00.000Z";
  const r1 = evaluarEstabilidad({ ant: {}, cambios: [cambioStock(D, A)], timestamp: t0 });
  assert.equal(esRebote(r1.cambios[0]), false);
  // 48 h despues se agota otra vez: para la reposicion ya estaria fuera de
  // ventana, para el quiebre no
  const t1 = new Date(Date.parse(t0) + 48 * 3600000).toISOString();
  const r2 = evaluarEstabilidad({ ant: { reboteStock: r1.memorias.reboteStock }, cambios: [cambioStock(D, A)], timestamp: t1 });
  assert.equal(esRebote(r2.cambios[0]), true, "el segundo quiebre en 48 h es un rebote");
  assert.equal(r2.cambios[0].ladoRebote, LADO.NO_COMPRABLE);
  // y pasadas las 72 h, no
  const t2 = new Date(Date.parse(t0) + (VENTANA_QUIEBRE_HORAS + 1) * 3600000).toISOString();
  const r3 = evaluarEstabilidad({ ant: { reboteStock: r1.memorias.reboteStock }, cambios: [cambioStock(D, A)], timestamp: t2 });
  assert.equal(esRebote(r3.cambios[0]), false);
});

test("el caso que el encargo midio: se agota y vuelve 48 h despues, sin ningun parpadeo", () => {
  // Es la forma exacta de 14 de los 15: un solo quiebre y una sola reposicion.
  const t0 = "2026-10-01T00:00:00.000Z";
  const r1 = evaluarEstabilidad({ ant: {}, cambios: [cambioStock(D, A)], timestamp: t0 });
  assert.equal(esRebote(r1.cambios[0]), false, "el quiebre es novedad");
  const t1 = new Date(Date.parse(t0) + 48 * 3600000).toISOString();
  const r2 = evaluarEstabilidad({ ant: { reboteStock: r1.memorias.reboteStock }, cambios: [cambioStock(A, D)], timestamp: t1 });
  assert.equal(esRebote(r2.cambios[0]), false, "y la reposicion TAMBIEN, aunque 'disponible' sea el estado de antes");
});

test("el cruce se REFRESCA: un episodio largo no vuelve a parecer novedad cada 72 h", () => {
  // Es la misma leccion que el precio aprendio en la segunda vuelta del
  // 2026-09-13: sin refrescar el instante del cruce, cada vuelta se mide contra
  // la PRIMERA y pasadas las 72 h el parpadeo vuelve a sonar fuerte. Aca se
  // agota cada 48 h cinco veces: con refresco, las cuatro repeticiones salen
  // compactas; sin refresco, la tercera (96 h despues de la primera) y la quinta
  // vuelven a ser alerta fuerte.
  let ant = {};
  const veredictos = [];
  for (let i = 0; i < 5; i++) {
    const t0 = new Date(Date.parse("2026-10-01T00:00:00.000Z") + i * 48 * 3600000).toISOString();
    const r1 = evaluarEstabilidad({ ant, cambios: [cambioStock(D, A)], timestamp: t0 });
    veredictos.push(esRebote(r1.cambios[0]));
    ant = { reboteStock: r1.memorias.reboteStock };
    // vuelve el stock en el medio, para poder agotarse otra vez
    const t1 = new Date(Date.parse(t0) + 24 * 3600000).toISOString();
    const r2 = evaluarEstabilidad({ ant, cambios: [cambioStock(A, D)], timestamp: t1 });
    ant = { reboteStock: r2.memorias.reboteStock };
  }
  assert.deepEqual(veredictos, [false, true, true, true, true], "solo el primer quiebre es novedad");
});

test("un cruce que no se puede leer sale fuerte y no deja memoria", () => {
  // `estadoDesdeBloqueCompra` puede devolver "desconocido" y los eventos viejos
  // de history.jsonl pueden venir sin estados. Darle a eso un lado de la
  // frontera por omision haria que dos lecturas ilegibles seguidas se vieran
  // como un rebote, que es el mismo defecto que el stock "desconocido" ya tiene
  // cerrado para la memoria del precio.
  const ilegible = { tipo: "stock", modelo: "SM-X", estadoAnterior: ESTADO.DESCONOCIDO, estado: ESTADO.DESCONOCIDO };
  const r1 = evaluarEstabilidad({ ant: {}, cambios: [ilegible], timestamp: "2026-10-01T00:00:00.000Z" });
  assert.equal(esRebote(r1.cambios[0]), false);
  assert.equal(esMatiz(r1.cambios[0]), false);
  assert.equal(r1.memorias.reboteStock, undefined, "no deja memoria");
  const r2 = evaluarEstabilidad({
    ant: { reboteStock: r1.memorias.reboteStock },
    cambios: [ilegible],
    timestamp: "2026-10-01T01:00:00.000Z",
  });
  assert.equal(esRebote(r2.cambios[0]), false, "la segunda ilegible tampoco es un rebote");
});

test("un matiz nunca entra a la memoria de cruces", () => {
  const t0 = "2026-10-01T00:00:00.000Z";
  const r = evaluarEstabilidad({ ant: {}, cambios: [cambioStock(A, N), cambioStock(N, A)], timestamp: t0 });
  assert.equal(r.cambios.every(esMatiz), true, "los dos son matices");
  assert.equal(r.cambios.some(esRebote), false, "y ninguno es rebote");
  assert.equal(r.memorias.reboteStock, undefined, "no dejan memoria que podar");
  assert.equal(r.matices.length, 2);
});

test("la memoria de stock de la version anterior se lee como vacia: ninguna tanda al desplegar", () => {
  // La version anterior guardaba ESTADOS (`v: ["disponible","agotado"]`). Con la
  // forma nueva (`c: {cruce: instante}`) esa memoria no habilita ningun rebote,
  // asi que la primera corrida con este codigo solo puede producir MAS alertas
  // fuertes, nunca menos. El tope es la cantidad de cambios de stock de esa
  // corrida: la peor de la semana del Cyber tuvo 100 notificables, y 89 de ellos
  // pasan a ser matices.
  const vieja = { v: ["disponible", "agotado"], hasta: "2026-10-01T00:00:00.000Z", n: 1, ultimo: "2026-10-01T00:00:00.000Z", desde: "2026-10-01T00:00:00.000Z" };
  const reposicion = evaluarEstabilidad({
    ant: ANT({ reboteStock: vieja }),
    cambios: [cambioStock(A, D)],
    timestamp: "2026-10-01T02:00:00.000Z",
  });
  assert.equal(esRebote(reposicion.cambios[0]), false, "la memoria vieja no degrada nada");
  // Y SU CONTADOR TAMPOCO SOBREVIVE: lo conto una regla retirada. Se mira con un
  // QUIEBRE, que es el unico cruce que deja memoria desde que la reposicion no
  // se degrada nunca.
  const r = evaluarEstabilidad({
    ant: ANT({ reboteStock: vieja }),
    cambios: [cambioStock(D, A)],
    timestamp: "2026-10-01T02:00:00.000Z",
  });
  assert.equal(esRebote(r.cambios[0]), false, "y tampoco degrada un quiebre");
  assert.equal(r.memorias.reboteStock.n, 0, "el contador arranca de cero con la forma nueva");
  const soloHeredada = evaluarEstabilidad({ ant: ANT({ reboteStock: vieja }), cambios: [], timestamp: "2026-10-01T02:00:00.000Z" });
  assert.equal(soloHeredada.memorias.reboteStock, undefined, "y sin cambios nuevos la memoria heredada se olvida entera");
});

test("...y tampoco figura en la lista de los que estan rebotando", () => {
  // Medido en la corrida real del pipeline contra una copia del catalogo: sin
  // esto, la PRIMERA corrida con este codigo manda un aviso tecnico nombrando 17
  // productos "rebotando" segun una regla que ya no existe (190 de los 1.086
  // registros traen la memoria vieja). Es ruido de migracion, no un hecho.
  const hace2h = new Date(Date.now() - 2 * 3600000).toISOString();
  const heredado = {
    estadoStock: A,
    nombre: "Galaxy heredado",
    categoria: "Smartphones",
    url: "https://x/1",
    reboteStock: { v: [D, A], hasta: hace2h, n: 2, ultimo: hace2h, desde: hace2h },
  };
  const nuevo = {
    ...heredado,
    reboteStock: { c: { [LADO.NO_COMPRABLE]: hace2h }, n: 2, ultimo: hace2h, desde: hace2h },
  };
  assert.equal(rebotesDe({ "SM-VIEJO": heredado }, new Date().toISOString()).length, 0);
  assert.equal(rebotesDe({ "SM-NUEVO": nuevo }, new Date().toISOString()).length, 1, "y el de la forma nueva si figura");
});

// ---------------------------------------------------------------------------
// COMO LO VE EL OPERADOR
// ---------------------------------------------------------------------------

async function mensajesDe(changes) {
  const original = globalThis.fetch;
  const enviados = [];
  try {
    globalThis.fetch = async (url, opts) => {
      enviados.push(JSON.parse(opts.body).content);
      return { ok: true };
    };
    await notifyDiscord("https://fake.webhook", { totalRevisado: 1, errores: 0, changes });
  } finally {
    globalThis.fetch = original;
  }
  return enviados.join("\n");
}

test("un matiz sale en su propia seccion, con los DOS estados escritos", async () => {
  const texto = await mensajesDe([
    {
      tipo: "stock", modelo: "QN75QN800DGXZS", nombre: '75" Neo QLED', estado: N, estadoAnterior: A,
      disponible: false, disponibleAnterior: false, precio: 2999990, categoria: "Televisores",
      url: "https://www.samsung.com/cl/tvs/x/", matiz: true,
    },
  ]);
  assert.match(texto, /Siguen sin poder comprarse/, "su propia seccion");
  assert.doesNotMatch(texto, /Siguen rebotando/, "y NO la de los rebotes: no es un vaiven, es un cambio real del sitio");
  // el operador pidio distinguir los dos estados: los dos van escritos
  assert.match(texto, /agotado/);
  assert.match(texto, /no está a la venta/);
  // y no se dibuja como la alerta fuerte de stock que era hasta el 2026-10-05
  assert.doesNotMatch(texto, /Stock antes:/);
});

test("una reposicion sale con su bloque, su precio y su link", async () => {
  const texto = await mensajesDe([
    {
      tipo: "stock", modelo: "MRN75R85HAGXZS", nombre: '75" Micro RGB R85H', estado: D, estadoAnterior: A,
      disponible: true, disponibleAnterior: false, precio: 1399990, categoria: "Televisores",
      url: "https://www.samsung.com/cl/tvs/micro-rgb/",
    },
  ]);
  assert.match(texto, /Cambios de stock/);
  assert.match(texto, /Stock antes: \*\*agotado\*\* → ahora: \*\*disponible\*\*/);
  assert.match(texto, /\$1\.399\.990/);
  assert.match(texto, /https:\/\/www\.samsung\.com\/cl\/tvs\/micro-rgb\//);
});

test("un matiz no sale EN VIVO: no hay nada urgente en seguir sin poder comprar", () => {
  const matiz = { tipo: "stock", modelo: "SM-X", estadoAnterior: A, estado: N, disponible: false, categoria: "Televisores", matiz: true };
  const cruce = { tipo: "stock", modelo: "SM-X", estadoAnterior: A, estado: D, disponible: true, categoria: "Televisores" };
  assert.equal(esNotificable(matiz), true, "se entrega igual, al cierre");
  assert.equal(esParaVivo(matiz), false, "pero no en vivo");
  assert.equal(esParaVivo(cruce), true, "una reposicion si sale en vivo");
});

test("la linea compacta de un QUIEBRE repetido dice el numero de CRUCE, no 'Nª vez'", async () => {
  // `vecesRebotado` cuenta REBOTES, asi que la primera repeticion se anunciaba
  // "1ª vez" dentro de una seccion titulada "ya te los avisé, no es novedad":
  // se lee como lo contrario de lo que el titulo promete. El numero de cruce
  // (rebotes + 1) no se contradice. Y la ventana es la del cruce que rebota.
  const texto = await mensajesDe([
    {
      tipo: "stock", modelo: "SM-A276BZBKLTL", nombre: "Galaxy A27 5G", estado: A, estadoAnterior: D,
      disponible: false, disponibleAnterior: true, precio: 279990, categoria: "Smartphones",
      url: "https://www.samsung.com/cl/smartphones/galaxy-a/", rebote: true, ladoRebote: LADO.NO_COMPRABLE, vecesRebotado: 1,
    },
  ]);
  assert.match(texto, /2º cruce igual en 72 h/);
  assert.doesNotMatch(texto, /1ª vez/, "nunca 'la 1ª vez' bajo un titulo que dice 'ya te los avisé'");
});

test("el precio de una linea compacta de stock lleva su advertencia si esta viejo", async () => {
  // La alerta FUERTE de stock termina en `sinComprobar` ("último precio
  // conocido: la página no lo publica hace N revisiones") y la linea compacta no
  // lo hacia: imprimia el ultimo precio conocido a secas, o sea presentandolo
  // como vigente, en el unico aviso de stock con el que el operador va a ir a
  // comprar. El dato ya viajaba en el cambio (comparar.mjs le mete
  // `...sinComprobar(rec)` a todos los cambios de stock) y no se usaba.
  const base = {
    tipo: "stock", modelo: "LS27FG500SLXZS", nombre: "Monitor Odyssey OLED G5", estado: A, estadoAnterior: D,
    disponible: false, disponibleAnterior: true, precio: 449990, corridasSinPrecio: 4,
    categoria: "Monitores", url: "https://www.samsung.com/cl/monitors/g5/",
  };
  const fuerte = await mensajesDe([base]);
  assert.match(fuerte, /no la publica hace 4 revisiones|no lo publica hace 4 revisiones/);
  const compacta = await mensajesDe([{ ...base, rebote: true, ladoRebote: LADO.NO_COMPRABLE, vecesRebotado: 1 }]);
  assert.match(compacta, /\$449\.990/, "la linea compacta lleva el precio");
  assert.match(compacta, /hace 4 revisiones/, "...y la advertencia de que puede estar viejo");
});

test("rebotesDe reporta un rebote de stock a las 48 h, que para el precio ya seria tarde", () => {
  // La poda de `rebotesDe` tiene que usar la ventana de CADA magnitud. Un quiebre
  // repetido a las 48 h sigue vigente (72 h) y el producto sigue figurando como
  // "rebotando" en el resumen de la corrida y en el aviso tecnico.
  const ahora = "2026-10-03T00:00:00.000Z";
  const hace48 = "2026-10-01T00:00:00.000Z";
  const catalogo = {
    "SM-X": {
      estadoStock: A,
      categoria: "Smartphones",
      url: "https://x/1",
      reboteStock: { c: { [LADO.NO_COMPRABLE]: hace48 }, n: 1, ultimo: hace48, desde: hace48 },
    },
  };
  const r = resumenDeRebotes({ cambios: [], catalogo, nuevosRebotando: [], timestamp: ahora });
  assert.equal(r.productosRebotando, 1, "a las 48 h el quiebre repetido sigue vigente");
  const tarde = "2026-10-05T00:00:00.000Z"; // 96 h
  const r2 = resumenDeRebotes({ cambios: [], catalogo, nuevosRebotando: [], timestamp: tarde });
  assert.equal(r2.productosRebotando, 0, "a las 96 h ya no");
});

test("el resumen de la corrida cuenta los matices, y no clavado en cero", () => {
  const r = resumenDeRebotes({
    cambios: [
      { tipo: "stock", matiz: true },
      { tipo: "stock", matiz: true },
      { tipo: "stock" },
      { tipo: "baja", rebote: true },
    ],
    catalogo: {},
    nuevosRebotando: [],
    timestamp: "2026-10-05T00:00:00.000Z",
  });
  assert.equal(r.avisosMatizStock, 2);
  assert.equal(r.avisosDegradados, 1);
});

// ---------------------------------------------------------------------------
// LA DIRECCION DEL MATIZ IMPORTA, Y ESTA MEDIDA (segunda vuelta, 2026-10-05)
// ---------------------------------------------------------------------------
//
// De los 136 matices del historial completo, 113 son "agotado -> no esta a la
// venta" y 23 son la vuelta. Mirando el evento de stock SIGUIENTE del mismo SKU:
// 9 de los 23 ya estaban DISPONIBLES -- 6 de ellos a las 8,4 h (seis combos
// Galaxy Watch + Buds de $674.980 a $1.024.980, revision del 2026-10-02T15:54) --
// contra 0 de los 113. O sea "no esta a la venta -> agotado" es Samsung volviendo
// a LISTAR el producto, y anticipa que se va a poder comprar: 43% tienen
// reposicion dentro de 72 h, contra una base de 24%.

test("matizDe separa las dos direcciones", () => {
  assert.equal(matizDe({ tipo: "stock", estadoAnterior: N, estado: A }), MATIZ.VUELVE);
  assert.equal(matizDe({ tipo: "stock", estadoAnterior: A, estado: N }), MATIZ.SALE);
  assert.equal(matizDe({ tipo: "stock", estadoAnterior: D, estado: A }), null, "un cruce no es matiz");
  // los eventos viejos de history.jsonl solo traen los booleanos: ahi las dos
  // puntas se leen "agotado" y la direccion no se puede saber. Cae en la clase
  // generica, nunca en la que promete que el producto puede volver.
  assert.equal(matizDe({ tipo: "stock", disponibleAnterior: false, disponible: false }), MATIZ.SALE);
});

test("el matiz que ANTICIPA una reposicion va en su propia seccion, con precio y link", async () => {
  const texto = await mensajesDe([
    {
      tipo: "stock", modelo: "F-SML34SMR602", nombre: "Galaxy Watch8 + Buds Core", estado: A, estadoAnterior: N,
      disponible: false, disponibleAnterior: false, precio: 674980, categoria: "Relojes (Galaxy Watch)",
      url: "https://www.samsung.com/cl/watches/combo/", matiz: true, matizClase: MATIZ.VUELVE,
    },
  ]);
  assert.match(texto, /Volvieron al catálogo, todavía sin stock/);
  assert.doesNotMatch(texto, /Siguen sin poder comprarse/, "no es el mismo aviso que el otro sentido");
  assert.doesNotMatch(texto, /Siguen rebotando/);
  // los dos estados siguen escritos (el operador pidio distinguirlos)
  assert.match(texto, /no está a la venta/);
  assert.match(texto, /agotado/);
  // y lleva con que actuar: 6 de estos tuvieron el stock de vuelta 8,4 h despues
  assert.match(texto, /\$674\.980/);
  assert.match(texto, /https:\/\/www\.samsung\.com\/cl\/watches\/combo\//);
});

test("...y el otro sentido sigue SIN precio ni link: no hay nada que comprar", async () => {
  const texto = await mensajesDe([
    {
      tipo: "stock", modelo: "QN75QN800DGXZS", nombre: "Neo QLED 75", estado: N, estadoAnterior: A,
      disponible: false, disponibleAnterior: false, precio: 2999990, categoria: "Televisores",
      url: "https://www.samsung.com/cl/tvs/x/", matiz: true, matizClase: MATIZ.SALE,
    },
  ]);
  assert.match(texto, /Siguen sin poder comprarse/);
  assert.doesNotMatch(texto, /\$2\.999\.990/, "sin precio: en 113 casos NI UNO volvio a estar disponible");
  assert.doesNotMatch(texto, /https:\/\/www\.samsung\.com\/cl\/tvs\/x\//, "y sin link");
});

test("ninguna de las dos clases de matiz sale EN VIVO", () => {
  const vuelve = { tipo: "stock", modelo: "SM-X", estadoAnterior: N, estado: A, disponible: false, matiz: true, matizClase: MATIZ.VUELVE };
  const sale = { tipo: "stock", modelo: "SM-X", estadoAnterior: A, estado: N, disponible: false, matiz: true, matizClase: MATIZ.SALE };
  // En el momento del matiz no se puede comprar nada, asi que no hay urgencia:
  // la reposicion, cuando llegue, sale fuerte y en vivo por su propia cuenta.
  assert.equal(esParaVivo(vuelve), false);
  assert.equal(esParaVivo(sale), false);
  assert.equal(esNotificable(vuelve), true, "pero se entregan las dos, al cierre");
  assert.equal(esNotificable(sale), true);
  assert.equal(esMatizQueVuelve(vuelve), true);
  assert.equal(esMatizQueVuelve(sale), false);
});

test("la SEMANA REAL reparte los 118 matices en 103 + 15, y la reposicion de las 8,4 h sale fuerte", () => {
  const { detectados } = replaySemana();
  const matices = detectados.filter((c) => c.tipo === "stock" && deLaSemana(c) && esMatiz(c));
  assert.equal(matices.length, 118);
  assert.equal(matices.filter((c) => c.matizClase === MATIZ.SALE).length, 103, "agotado -> no esta a la venta");
  assert.equal(matices.filter((c) => c.matizClase === MATIZ.VUELVE).length, 15, "no esta a la venta -> agotado");
  // los seis combos Watch + Buds del 2026-10-02T15:54, que 8,4 h despues
  // estaban DISPONIBLES: su matiz avisa temprano y su reposicion sale fuerte
  const combos = ["F-SML34SMR602", "F-SML35SMR64X", "F-SML71SMR602", "F-SML34SMR640", "F-SML35SMR640", "F-SML71SMR640"];
  for (const sku of combos) {
    // los seis hacen el recorrido entero en tres eventos: salen de venta
    // (01:32), vuelven al catalogo sin stock (15:54) y 8,4 h despues estan
    // disponibles (00:18 del dia siguiente)
    const aviso = matices.find((c) => c.modelo === sku && c.matizClase === MATIZ.VUELVE);
    assert.ok(aviso, `falta el matiz de vuelta al catalogo de ${sku}`);
    assert.equal(aviso.ts, "2026-10-02T15:54:36.793Z", `${sku} volvio al catalogo en esa revision`);
    assert.ok(Number.isFinite(aviso.precio), `${sku} lleva su precio`);
    const reposicion = detectados.find((c) => c.tipo === "stock" && c.modelo === sku && c.estado === D);
    assert.ok(reposicion, `falta la reposicion de ${sku}`);
    assert.equal(esFuerte(reposicion), true, `la reposicion de ${sku} es alerta fuerte`);
  }
});

// ---------------------------------------------------------------------------
// LA SECCION DE MATICES TIENE TOPE, Y NO SILENCIA NADA
// ---------------------------------------------------------------------------

function olaDeMatices(n) {
  const categorias = ["Televisores", "Lavado y secado", "Aspiradoras", "Monitores", "Cocina"];
  return Array.from({ length: n }, (_, i) => ({
    tipo: "stock",
    modelo: `SKU-${i}`,
    nombre: `Producto ${i}`,
    estado: N,
    estadoAnterior: A,
    disponible: false,
    disponibleAnterior: false,
    precio: 399990,
    categoria: categorias[i % categorias.length],
    url: `https://www.samsung.com/cl/x/${i}/`,
    matiz: true,
    matizClase: MATIZ.SALE,
  }));
}

test("una ola de 500 matices no se convierte en 34 mensajes: hay tope y resumen por categoria", async () => {
  // La ola real del 2026-10-02T11:19 dejo 89 matices que decian LITERALMENTE lo
  // mismo: 6 mensajes y 11.037 caracteres sin nada accionable. El aviso tecnico
  // hermano (mensajeRebotando) ya tenia tope desde el 2026-09-13 y esta seccion
  // no, asi que escalaba lineal.
  const original = globalThis.fetch;
  const mensajes = [];
  try {
    globalThis.fetch = async (url, opts) => {
      mensajes.push(JSON.parse(opts.body).content);
      return { ok: true };
    };
    await notifyDiscord("https://fake.webhook", { totalRevisado: 1, errores: 0, changes: olaDeMatices(500) });
  } finally {
    globalThis.fetch = original;
  }
  const texto = mensajes.join("\n");
  assert.ok(mensajes.length <= 4, `${mensajes.length} mensajes: la seccion no puede escalar lineal`);
  // el conteo del titulo sigue siendo el de los CAMBIOS, no el de las lineas
  assert.match(texto, /Siguen sin poder comprarse[^\n]*\(500\)/);
  assert.match(texto, new RegExp(`…y ${500 - TOPE_MATICES} más`), "la cola va contada");
  assert.match(texto, /\d+ televisores/, "y resumida por categoria");
  assert.match(texto, /el detalle completo queda en el historial/);
});

test("...y la cola recortada NO se silencia: viaja con el mensaje que la resume", async () => {
  // Es la mitad del diseño: si Discord rechaza el mensaje de la cola, los
  // cambios que resume vuelven ENTEROS a pendientes.jsonl y se reintentan.
  const original = globalThis.fetch;
  // reloj virtual: los reintentos del transporte no duermen de verdad
  const virtual = relojVirtual();
  let r;
  try {
    globalThis.fetch = async () => ({ ok: false, status: 500, headers: { get: () => null }, json: async () => ({}) });
    r = await notifyDiscord("https://fake.webhook", { totalRevisado: 1, errores: 0, changes: olaDeMatices(120) });
  } finally {
    globalThis.fetch = original;
    virtual.restaurar();
  }
  assert.equal(r.noEntregados.length, 120, "los 120 vuelven, no solo los que tenian linea propia");
  assert.equal(new Set(r.noEntregados.map((c) => c.modelo)).size, 120);
});

// ---------------------------------------------------------------------------
// UN MATIZ RECHAZADO POR DISCORD NO VUELVE COMO ALERTA FUERTE
// ---------------------------------------------------------------------------

async function conPendientes(pendientes) {
  const original = globalThis.fetch;
  const enviados = [];
  try {
    globalThis.fetch = async (url, opts) => {
      enviados.push(JSON.parse(opts.body).content);
      return { ok: true };
    };
    await notifyDiscord("https://fake.webhook", { totalRevisado: 1, errores: 0, changes: [], pendientes });
  } finally {
    globalThis.fetch = original;
  }
  return enviados.join("\n");
}

test("un matiz que vuelve por pendientes.jsonl sigue siendo una linea compacta", async () => {
  // El camino de pendientes llamaba a `lineFor` sin mirar la clasificacion, asi
  // que un matiz rechazado por Discord volvia a la corrida siguiente con el
  // bloque de tres lineas y link: justo lo que este arreglo viene a quitar. Con
  // 89 matices en una revision basta UN mensaje rechazado para que ~15 vuelvan
  // convertidos en alertas fuertes.
  const texto = await conPendientes([
    {
      ts: "2026-10-02T11:19:56.333Z",
      tipo: "stock", modelo: "AR50F09C1FH/ZS", nombre: "Split WindFree 9.000 BTU", estado: N, estadoAnterior: A,
      disponible: false, disponibleAnterior: false, precio: 399990, categoria: "Aire acondicionado",
      url: "https://www.samsung.com/cl/air-conditioners/x/", matiz: true, matizClase: MATIZ.SALE,
    },
  ]);
  assert.match(texto, /Avisos atrasados/);
  assert.doesNotMatch(texto, /Stock antes:/, "no vuelve como alerta fuerte");
  assert.doesNotMatch(texto, /https:\/\/www\.samsung\.com\/cl\/air-conditioners\/x\//, "ni con link");
  assert.match(texto, /no se pudo avisar en su momento/, "pero dice que es atrasado");
  assert.match(texto, /no está a la venta/);
});

test("y un rebote atrasado tampoco", async () => {
  const texto = await conPendientes([
    {
      ts: "2026-10-02T11:19:56.333Z",
      tipo: "stock", modelo: "SM-A276BZBKLTL", nombre: "Galaxy A27 5G", estado: A, estadoAnterior: D,
      disponible: false, disponibleAnterior: true, precio: 289990, categoria: "Smartphones",
      url: "https://x/9", rebote: true, ladoRebote: LADO.NO_COMPRABLE, vecesRebotado: 1,
    },
  ]);
  assert.doesNotMatch(texto, /Stock antes:/);
  assert.match(texto, /2º cruce igual en 72 h/);
});

// ---------------------------------------------------------------------------
// EL AVISO TECNICO NO PUEDE AFIRMAR ALGO FALSO SOBRE LA COMPRA
// ---------------------------------------------------------------------------

test("el aviso tecnico dice el estado de AHORA, no solo los cruces ya avisados", () => {
  // Medido replayando el historial completo contra el catalogo al lado: 8 avisos
  // tecnicos ENTREGABLES afirmaban "no se puede comprar" de un producto que el
  // catalogo daba por DISPONIBLE (NP750XGJ-KS6CL 24/25/26-08, NP750XGJ-KS4CL 10
  // y 11-09, SM-A366ELVGLTL 16 y 17-09, SM-A276BZBKLTL 02-10). Es la direccion
  // que cuesta plata: le dicen que no puede comprar algo que si puede.
  const hace2h = new Date(Date.now() - 2 * 3600000).toISOString();
  const catalogo = {
    "NP750XGJ-KS4CL": {
      estadoStock: D, // DISPONIBLE: se agoto, se volvio a agotar, y despues volvio
      nombre: "Galaxy Book 4",
      categoria: "Computadores",
      url: "https://x/1",
      reboteStock: { c: { [LADO.NO_COMPRABLE]: hace2h }, n: 1, ultimo: hace2h, desde: hace2h },
    },
  };
  const lista = rebotesDe(catalogo, new Date().toISOString());
  assert.equal(lista.length, 1);
  const texto = mensajeRebotando(lista);
  assert.match(texto, /ahora \*\*disponible\*\*/, "el estado real, que ya viajaba en el item");
  assert.match(texto, /ya avisados: se agotó/, "y el cruce etiquetado como lo que es");
  assert.doesNotMatch(texto, /no se puede comprar/, "nunca una afirmacion falsa sobre la compra");
});

test("el aviso tecnico no imprime un cruce que ya salio de SU ventana", () => {
  // La poda por cruce vivia solo dentro de la decision (`memoriaDeStock`), asi
  // que `rebotesDe` publicaba las llaves CRUDAS del registro: una llave podia
  // seguir impresa mucho despues de que la regla la diera por olvidada.
  const hace100h = new Date(Date.now() - 100 * 3600000).toISOString();
  const hace2h = new Date(Date.now() - 2 * 3600000).toISOString();
  const catalogo = {
    "SM-X": {
      estadoStock: A,
      nombre: "Galaxy X",
      categoria: "Smartphones",
      url: "https://x/2",
      // el contador esta fresco, pero el cruce guardado es de hace 100 h
      reboteStock: { c: { [LADO.NO_COMPRABLE]: hace100h }, n: 2, ultimo: hace2h, desde: hace100h },
    },
  };
  const lista = rebotesDe(catalogo, new Date().toISOString());
  assert.equal(lista.length, 1, "el producto sigue figurando: su contador esta vigente");
  assert.deepEqual(lista[0].valores, [], "pero el cruce de hace 100 h ya no se imprime");
  assert.match(mensajeRebotando(lista), /ahora \*\*agotado\*\*/);
});

test("crucesVigentes descarta las llaves que no tienen ventana", () => {
  // Dos casos de una vez: la reposicion (que no se degrada nunca, asi que no hay
  // nada que recordar) y una llave ajena o corrupta, que si se guardara no la
  // podaria NUNCA el tiempo -- la poda es por ventana, y para una llave
  // desconocida no hay ninguna, asi que el campo quedaria vivo para siempre.
  const ahora = "2026-10-05T00:00:00.000Z";
  const hace1h = "2026-10-04T23:00:00.000Z";
  const vigentes = crucesVigentes(
    { c: { basura: hace1h, [LADO.COMPRABLE]: hace1h, [LADO.NO_COMPRABLE]: hace1h } },
    ahora,
  );
  assert.deepEqual(Object.keys(vigentes), [LADO.NO_COMPRABLE]);
  // y una memoria cuyas unicas llaves son ajenas no sobrevive en el registro
  const r = evaluarEstabilidad({
    ant: { reboteStock: { c: { basura: hace1h }, n: 0, ultimo: null, desde: null } },
    cambios: [],
    timestamp: ahora,
  });
  assert.equal(r.memorias.reboteStock, undefined);
});
