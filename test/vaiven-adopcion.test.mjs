// EL VAIVEN DEL 1 DE OCTUBRE: UN REBOTE HACIA ARRIBA NO SE ADOPTA CON UNA SOLA
// LECTURA (src/estabilidad.mjs `reboteArribaReciente`, src/comparar.mjs).
//
// EL HECHO, RECONSTRUIDO DE data/history.jsonl, DEL HISTORIAL DE GIT DE
// data/latest.json Y DE data/ejecuciones.jsonl. Tres revisiones seguidas del
// 2026-10-01, las tres con 0 errores y marcadas confiables:
//
//     16:37  bajan 26 productos (la oferta real del Cyber)
//     17:20  16 de esos mismos "suben" a su precio EXACTO de antes
//     18:00  los 16 "bajan" otra vez al precio de oferta EXACTO
//
// LO QUE TIENEN EN COMUN LOS 16, medido: son 16 paginas DISTINTAS (11 son /buy/ y
// 5 son fichas planas), de 5 categorias a la vez (3 tablets, 5 audifonos, 4
// relojes, 2 notebooks, 2 de familia auto-descubierta) y las 16 estan firmadas
// con rango 3 (su propia ficha). O sea: no es una pagina contaminando a las
// otras, ni el camino del selector de grupo. Cuatro dias despues los 16 estan en
// el valor BAJO o mas abajo y NINGUNO en el alto (Tab S10 Lite $494.990 -> hoy
// $299.990; Buds4 Pro $274.990 -> $199.990; Watch8 Classic $519.990 -> $299.990;
// Book4 $699.990 -> $599.990): las subidas del 17:20 fueron lecturas malas.
//
// LA CAUSA RAIZ NO ESTA DIAGNOSTICADA, y estas pruebas no finjen lo contrario.
// Lo que SI esta medido es que el camino conocido queda descartado: la corrida
// del 17:20 informa `digitalDataSinAsentar: 1` y `sinPrecioVisible: 1` sobre 346
// paginas, o sea UNA pagina marcada, y una pagina no explica 16 productos en 16
// paginas distintas. Las dos hipotesis que quedan -- digitalData publicando
// `model_price === list_price === precio de lista` (la promocion todavia sin
// aplicar, donde todas las guardas se bajan por diseño porque `dosCandidatos` es
// false) y Samsung sirviendo ~40 min la pagina sin la promocion -- son
// indistinguibles sin red. Estan escritas en BITACORA.md.
//
// LA DEFENSA CUBRE EL SINTOMA: un rebote HACIA ARRIBA que llega a menos de 2 h
// del cambio que deshace no se adopta ni se avisa con una sola lectura. Queda
// pendiente y necesita que la lectura siguiente de la MISMA pagina lo repita.
//
// EL MATERIAL: `test/fixtures/vaiven-1-oct.json`, una FOTO CONGELADA de los 16
// productos con sus cuatro precios reales y los contadores de diagnostico de las
// tres corridas. No se refresca (ver test/fixtures/LEEME.md).
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";
import { comparar, resumenDeRebotes } from "../src/comparar.mjs";
import { esNotificable } from "../src/despachador-vivo.mjs";
import { HORAS_MIN_REBOTE_ARRIBA, esRebote, reboteArribaReciente } from "../src/estabilidad.mjs";
import { ESTADO } from "../src/stock.mjs";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const FOTO = JSON.parse(readFileSync(path.join(AQUI, "fixtures", "vaiven-1-oct.json"), "utf8"));
const [T_OFERTA, T_SUBE, T_VUELVE] = FOTO.corridas;
const BASE = "2026-10-01T16:16:58.000Z"; // la corrida anterior, sin cambios

function registro(p, precio, extra = {}) {
  return {
    modelo: p.sku,
    nombre: p.nombre,
    moneda: "CLP",
    precio,
    estadoStock: ESTADO.DISPONIBLE,
    disponible: true,
    versionStock: 2,
    versionPrecio: 4,
    rango: p.rango ?? 3,
    url: p.url,
    paginaOrigen: p.url,
    categoria: p.categoria,
    ...extra,
  };
}

/**
 * Replay de las tres corridas con `comparar()` real.
 * @param leidos precio que cada corrida LEE de la pagina, por SKU
 */
function replay(leidos) {
  let catalogo = Object.fromEntries(
    FOTO.productos.map((p) => [
      p.sku,
      registro(p, p.antes, { presencia: "activo", ausencias: 0, notificadoDesaparecido: false, ultimaVezVisto: BASE }),
    ]),
  );
  const porCorrida = [];
  for (const [ts, precioDe] of leidos) {
    const observado = Object.fromEntries(FOTO.productos.map((p) => [p.sku, registro(p, precioDe(p))]));
    const r = comparar({ previo: catalogo, observado, paginasFallidas: new Set(), corridaConfiable: true, timestamp: ts });
    catalogo = r.catalogo;
    porCorrida.push({ ts, cambios: r.cambios, catalogo });
  }
  return porCorrida;
}

// ---------------------------------------------------------------------------
// EL HECHO REAL
// ---------------------------------------------------------------------------

test("la foto dice lo que el encargo midio: 16 productos, 16 paginas, 5 categorias", () => {
  assert.equal(FOTO.productos.length, 16);
  assert.equal(new Set(FOTO.productos.map((p) => p.url)).size, 16, "16 paginas distintas");
  assert.equal(new Set(FOTO.productos.map((p) => p.categoria)).size, 5, "5 categorias");
  assert.equal(FOTO.productos.filter((p) => p.rango === 3).length, 16, "las 16 son su propia ficha");
  // los 16 suben EXACTAMENTE al precio de antes de la oferta
  assert.equal(FOTO.productos.filter((p) => p.sube === p.antes).length, 16);
  // y hoy ninguno esta en el valor alto
  assert.equal(FOTO.productos.filter((p) => p.hoy === p.sube).length, 0);
  assert.equal(FOTO.productos.filter((p) => p.hoy <= p.oferta).length, 16, "los 16 estan en el valor bajo o mas abajo");
  // el camino conocido queda descartado por los propios contadores de la corrida
  assert.equal(FOTO.diagnostico[T_SUBE].digitalDataSinAsentar, 1, "UNA pagina marcada, no 16");
  assert.equal(FOTO.diagnostico[T_SUBE].errores, 0);
  assert.equal(FOTO.diagnostico[T_SUBE].confiable, true);
});

test("las tres corridas REALES: la oferta se avisa y el vaiven no deja rastro", () => {
  const corridas = replay([
    [T_OFERTA, (p) => p.oferta],
    [T_SUBE, (p) => p.sube],
    [T_VUELVE, (p) => p.oferta],
  ]);

  // 1. la oferta real del Cyber sale como alerta fuerte, las 16
  const bajas = corridas[0].cambios.filter((c) => c.tipo === "baja");
  assert.equal(bajas.length, 16, "las 16 bajas reales se avisan");
  assert.equal(bajas.filter((c) => !esRebote(c)).length, 16, "y las 16 son alerta fuerte");

  // 2. la corrida del medio no produce NI UN aviso...
  assert.equal(corridas[1].cambios.length, 0, "las 16 subidas falsas no producen ningun aviso");
  // ...y tampoco deja el numero mal leido guardado como si fuera el de hoy, que
  // era el otro daño medido: los 16 avisos del 18:00 median contra el tachado.
  for (const p of FOTO.productos) {
    assert.equal(corridas[1].catalogo[p.sku].precio, p.oferta, `${p.sku} conserva el precio de oferta`);
    assert.equal(corridas[1].catalogo[p.sku].precioPendiente, p.sube, `${p.sku} deja el numero como PENDIENTE`);
  }

  // 3. y la tercera corrida, que leyo otra vez el precio de oferta, tampoco
  assert.equal(corridas[2].cambios.length, 0, "las 16 'bajas' del 18:00 desaparecen");
  for (const p of FOTO.productos) {
    assert.equal(corridas[2].catalogo[p.sku].precio, p.oferta);
    assert.equal(corridas[2].catalogo[p.sku].precioPendiente, undefined, "el pendiente muere solo");
  }

  // ANTES: 26 + 16 + 16 = 58 eventos, 32 de ellos falsos. AHORA: 16.
  const total = corridas.reduce((n, c) => n + c.cambios.length, 0);
  assert.equal(total, 16);
});

test("si la subida fuera REAL, se avisa: es un atraso de una lectura, no un silencio", () => {
  // misma oferta, y despues la pagina publica DOS veces seguidas el precio alto
  const corridas = replay([
    [T_OFERTA, (p) => p.oferta],
    [T_SUBE, (p) => p.sube],
    [T_VUELVE, (p) => p.sube],
  ]);
  assert.equal(corridas[1].cambios.length, 0, "la primera lectura queda pendiente");
  const subes = corridas[2].cambios.filter((c) => c.tipo === "sube");
  assert.equal(subes.length, 16, "la segunda lectura de la MISMA pagina lo confirma y se avisa");
  for (const c of subes) {
    assert.equal(esNotificable(c), true);
    // sale por la rama de la corroboracion, no por la de "otra pagina del
    // sitio": el numero lo publico la misma ficha dos veces seguidas
    assert.equal(c.desdeOtraFuente, undefined, "misma pagina: sin la etiqueta de otra fuente");
  }
  for (const p of FOTO.productos) assert.equal(corridas[2].catalogo[p.sku].precio, p.sube);
});

// ---------------------------------------------------------------------------
// LOS CONTROLES: QUE NO SE FRENA
// ---------------------------------------------------------------------------

const SKU = "SM-CONTROL";
const ctrl = (precio, extra = {}) => ({
  modelo: SKU,
  nombre: "Galaxy de control",
  moneda: "CLP",
  precio,
  estadoStock: ESTADO.DISPONIBLE,
  disponible: true,
  versionStock: 2,
  versionPrecio: 4,
  rango: 3,
  url: "https://www.samsung.com/cl/smartphones/galaxy-x/galaxy-x-sm-control/",
  paginaOrigen: "https://www.samsung.com/cl/smartphones/galaxy-x/galaxy-x-sm-control/",
  categoria: "Smartphones",
  ...extra,
});
const paso = (previo, precio, ts) =>
  comparar({ previo, observado: { [SKU]: ctrl(precio) }, paginasFallidas: new Set(), corridaConfiable: true, timestamp: ts });
const arranque = (precio) => ({
  [SKU]: ctrl(precio, { presencia: "activo", ausencias: 0, notificadoDesaparecido: false, ultimaVezVisto: "2026-10-01T00:00:00.000Z" }),
});

test("una BAJA nunca se atrasa, aunque vuelva a un precio ya conocido", () => {
  // En Cyber un aviso perdido cuesta mas que uno de mas: la guarda es solo hacia
  // arriba, y esta prueba es la que lo fija.
  let previo = arranque(999990);
  let r = paso(previo, 699990, "2026-10-01T09:00:00.000Z"); // baja real
  assert.equal(r.cambios.filter((c) => c.tipo === "baja").length, 1);
  previo = r.catalogo;
  r = paso(previo, 999990, "2026-10-01T15:00:00.000Z"); // sube 6 h despues: fuera de la guarda
  previo = r.catalogo;
  // y vuelve a bajar 30 min despues: es un rebote hacia ABAJO y se avisa IGUAL
  r = paso(previo, 699990, "2026-10-01T15:30:00.000Z");
  const bajas = r.cambios.filter((c) => c.tipo === "baja");
  assert.equal(bajas.length, 1, "la baja sale en su corrida");
  assert.equal(bajas[0].precio, 699990, "con el precio de hoy");
  assert.equal(esRebote(bajas[0]), true, "compacta, porque ya lo escucho, pero entregada");
  assert.equal(r.catalogo[SKU].precio, 699990, "y adoptada");
});

test("un rebote hacia arriba MAS LENTO que 2 h se adopta y se avisa: nada queda congelado", () => {
  // Es el caso del monitor Odyssey G3, que en 30 dias reales nunca volvio a un
  // valor en menos de 2,55 h. Si la guarda no mirara el reloj, un producto que
  // rebota de verdad quedaria clavado en uno de sus dos precios para siempre.
  let previo = arranque(279990);
  let r = paso(previo, 199990, "2026-10-01T09:00:00.000Z");
  assert.equal(r.cambios.length, 1);
  previo = r.catalogo;
  r = paso(previo, 279990, "2026-10-01T12:00:00.000Z"); // 3 h despues
  const subes = r.cambios.filter((c) => c.tipo === "sube");
  assert.equal(subes.length, 1, "a las 3 h el rebote hacia arriba se avisa");
  assert.equal(r.catalogo[SKU].precio, 279990, "y se adopta");
  assert.equal(r.catalogo[SKU].precioPendiente, undefined);
});

test("una subida a un precio NUEVO no se frena, y eso es el limite conocido de la defensa", () => {
  // Lo dice el encargo con todas sus letras: "si la proxima vez el salto cae a un
  // valor NUEVO, va a salir como alerta fuerte FALSA". Esta guarda NO lo cubre y
  // no puede: un numero que nadie escucho antes es indistinguible de un cambio
  // real de Samsung. Queda como prueba para que nadie crea que esta cubierto.
  let previo = arranque(999990);
  let r = paso(previo, 699990, "2026-10-01T09:00:00.000Z");
  previo = r.catalogo;
  r = paso(previo, 888888, "2026-10-01T09:40:00.000Z"); // 40 min, valor nuevo
  const subes = r.cambios.filter((c) => c.tipo === "sube");
  assert.equal(subes.length, 1, "un valor nuevo sale al tiro, frenado o no");
  assert.equal(esRebote(subes[0]), false, "y como alerta fuerte");
});

// ---------------------------------------------------------------------------
// LA REGLA, DIRECTO
// ---------------------------------------------------------------------------

const memoria = (hasta) => ({ rebotePrecio: { v: [999990, 699990], hasta, n: 0, ultimo: null, desde: null } });

test("reboteArribaReciente exige las TRES condiciones", () => {
  const t = "2026-10-01T10:00:00.000Z";
  const hace40min = "2026-10-01T09:20:00.000Z";
  const base = { ant: memoria(hace40min), timestamp: t };
  // sube + conocido + reciente
  assert.equal(reboteArribaReciente({ ...base, precio: 999990, precioAnterior: 699990 }), true);
  // ...pero no si BAJA
  assert.equal(reboteArribaReciente({ ...base, precio: 699990, precioAnterior: 999990 }), false);
  // ...ni si el valor es NUEVO
  assert.equal(reboteArribaReciente({ ...base, precio: 888888, precioAnterior: 699990 }), false);
  // ...ni si paso mas tiempo que el umbral
  const viejo = new Date(Date.parse(t) - (HORAS_MIN_REBOTE_ARRIBA + 1) * 3600000).toISOString();
  assert.equal(reboteArribaReciente({ ant: memoria(viejo), timestamp: t, precio: 999990, precioAnterior: 699990 }), false);
});

test("si el tiempo no se puede medir, NO se frena: el lado seguro es avisar", () => {
  const t = "2026-10-01T10:00:00.000Z";
  assert.equal(reboteArribaReciente({ ant: memoria(null), timestamp: t, precio: 999990, precioAnterior: 699990 }), false);
  assert.equal(reboteArribaReciente({ ant: memoria("no es una fecha"), timestamp: t, precio: 999990, precioAnterior: 699990 }), false);
  assert.equal(reboteArribaReciente({ ant: {}, timestamp: t, precio: 999990, precioAnterior: 699990 }), false);
});

test("el umbral son 2 h, y el numero esta medido", () => {
  // 17 de los 119 rebotes hacia arriba del historial completo caen bajo 2 h, y
  // son exactamente los 16 del 2026-10-01T17:20 mas SM-A075MLVGLTL del 22:16.
  // El rebote hacia arriba real mas rapido que existe esta a 2,55 h.
  assert.equal(HORAS_MIN_REBOTE_ARRIBA, 2);
});

// ---------------------------------------------------------------------------
// LA GUARDA TIENE QUE DEJAR HUELLA EN EL RESUMEN DE LA CORRIDA
// ---------------------------------------------------------------------------
//
// EL DEFECTO (segunda vuelta, 2026-10-05). El plan de vigilancia de este arreglo
// decia: "mientras la causa raiz no se diagnostique, el aviso de que volvio a
// pasar es `avisosDegradados` subiendo de golpe en una sola corrida". Medido:
// la corrida REAL del 2026-10-01T17:20 reporto `avisosDegradados: 16` cuando el
// numero mal leido todavia se adoptaba; con esta guarda esa misma corrida emite
// 0 cambios, asi que los tres contadores del freno quedan en 0 y las 16 lecturas
// malas no aparecen en ninguna parte del resumen. El operador quedaba ciego
// justo en el caso en que hay que escalar a la captura en vivo (pendiente nº3).

test("la corrida del vaiven deja los 16 contados en el resumen, aunque no emita ningun aviso", () => {
  const corridas = replay([
    [T_OFERTA, (p) => p.oferta],
    [T_SUBE, (p) => p.sube],
  ]);
  const r = resumenDeRebotes({
    cambios: corridas[1].cambios,
    catalogo: corridas[1].catalogo,
    nuevosRebotando: [],
    timestamp: T_SUBE,
  });
  assert.equal(corridas[1].cambios.length, 0, "no emite ningun aviso");
  // los tres contadores del freno, en cero: la señal vieja esta muda
  assert.equal(r.avisosDegradados, 0);
  assert.equal(r.productosRebotando, 0);
  assert.equal(r.productosNuevosRebotando, 0);
  // y los dos nuevos, que son la señal de verdad
  assert.equal(r.rebotesArribaRetenidos, 16, "16 lecturas frenadas en UNA corrida: volvio a pasar");
  assert.equal(r.preciosEnEspera, 16, "y los 16 registros estan esperando corroboracion");
});

test("...y cuando el pendiente se resuelve, los contadores vuelven a cero", () => {
  const corridas = replay([
    [T_OFERTA, (p) => p.oferta],
    [T_SUBE, (p) => p.sube],
    [T_VUELVE, (p) => p.oferta],
  ]);
  const r = resumenDeRebotes({
    cambios: corridas[2].cambios,
    catalogo: corridas[2].catalogo,
    nuevosRebotando: [],
    timestamp: T_VUELVE,
  });
  assert.equal(r.rebotesArribaRetenidos, 0);
  assert.equal(r.preciosEnEspera, 0);
});

test("un pendiente de OTRA PAGINA cuenta en preciosEnEspera pero no como rebote frenado", () => {
  // Los dos contadores miden cosas distintas y por eso son dos: `preciosEnEspera`
  // es "cuantas lecturas estan esperando corroboracion, por cualquier motivo" y
  // `rebotesArribaRetenidos` es "cuantas freno ESTA guarda". Si fueran uno solo,
  // el ruido normal de la corroboracion por otra pagina taparia la señal.
  const previo = arranque(999990);
  const otra = {
    ...ctrl(1299990),
    rango: 3,
    url: "https://www.samsung.com/cl/smartphones/galaxy-x/familia/",
    paginaOrigen: "https://www.samsung.com/cl/smartphones/galaxy-x/familia/",
  };
  const r = comparar({
    previo,
    observado: { [SKU]: otra },
    paginasFallidas: new Set(),
    corridaConfiable: true,
    timestamp: "2026-10-01T09:00:00.000Z",
  });
  const resumen = resumenDeRebotes({ cambios: r.cambios, catalogo: r.catalogo, nuevosRebotando: [], timestamp: "2026-10-01T09:00:00.000Z" });
  assert.equal(resumen.preciosEnEspera, 1, "esta esperando corroboracion");
  assert.equal(resumen.rebotesArribaRetenidos, 0, "pero no lo freno la guarda del rebote hacia arriba");
});
