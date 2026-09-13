// LOS DEFECTOS QUE ENCONTRARON LOS VERIFICADORES DEL 2026-09-12, Y LO QUE LOS
// CIERRA.
//
// El alcance declarado (test/alcance.test.mjs) resolvio el problema de fondo del
// encargo: una corrida declara que se propuso mirar, y no puede declarar
// desaparecido lo que no miro. Tres revisiones independientes lo atacaron y
// encontraron agujeros REALES que aquel archivo no cubria. Este archivo es uno a
// uno: cada prueba muere si se deshace su arreglo.
//
// EL MAS GRAVE, Y EL QUE MAS SE PARECE A LA HISTORIA DE ESTE PROYECTO: un
// producto que no desaparece sino que se MUDA a una pagina de otra seccion
// recibia un "DESAPARECIDO" falso de una revision liviana y un "RECUPERADO" del
// completo siguiente, con el producto a la venta todo el tiempo. Es la forma
// exacta del incidente de los ~150 avisos falsos en 4 dias (BITACORA.md), y era
// una REGRESION: el sistema anterior, con todas las corridas completas, daba 0
// eventos para el mismo hecho.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";
import {
  alcanceDe,
  claveNoConfiable,
  decidirModo,
  evaluarConfiabilidad,
  HORAS_SIN_COMPLETO,
  MODO_COMPLETO,
  MODO_LIVIANO,
  TOLERANCIA_ENCOGIMIENTO,
  TOLERANCIA_SIN_PAGINA,
  ultimoCompleto,
  ultimoRecorrido,
} from "../src/alcance.mjs";
import { comparar, HORAS_MIN_DESAPARICION, HORAS_MIN_MOMIA, UMBRAL_AUSENCIAS, UMBRAL_SIN_VERIFICAR } from "../src/comparar.mjs";
import { BLOQUE_CYBER, BLOQUE_PRINCIPAL, CATEGORIAS_PRINCIPALES, ordenarRecorrido, prepararRecorrido } from "../src/prioridad.mjs";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.join(AQUI, "..");

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
const copiaDelCatalogo = () => JSON.parse(JSON.stringify(CATALOGO_REAL));
const horas = (base, h) => new Date(new Date(base).getTime() + h * 3600000).toISOString();

const CAMPOS_DE_ESTADO = [
  "presencia",
  "ausencias",
  "ausenciaEnCompleto",
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
function observacionDe(rec, timestamp, extra = {}) {
  const obs = { ...rec, ultimaRevision: timestamp, ...extra };
  for (const campo of CAMPOS_DE_ESTADO) delete obs[campo];
  return obs;
}

/** Un registro de catalogo cualquiera, con su reloj puesto. */
const TS = "2026-09-13T00:00:00.000Z";
function registro(extra = {}) {
  return {
    modelo: "SKU-1",
    nombre: "Producto",
    categoria: "Smartphones",
    url: "https://x/tel",
    paginaOrigen: "https://x/tel",
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
const alcanceCompleto = () => alcanceDe({ modo: MODO_COMPLETO, entries: [] });

/** Una corrida suelta, con los dos parametros que importan. */
function corrida({ previo, observado = {}, alcance, timestamp, confiable = true, fallidas = new Set() }) {
  return comparar({ previo, observado, paginasFallidas: fallidas, alcance, corridaConfiable: confiable, timestamp });
}

// ===========================================================================
// DEFECTO 1 (dos verificadores, por separado): UN PRODUCTO QUE SE MUDA DE
// SECCION RECIBIA UN "DESAPARECIDO" FALSO DE UNA REVISION LIVIANA.
// ===========================================================================

test("dos revisiones livianas seguidas NO pueden declarar desaparecido, por mucha evidencia que junten", () => {
  // Las dos ausencias estan, el piso de reloj esta cumplido, la corrida es
  // confiable y la pagina no fallo: antes de este arreglo, con eso bastaba. Y
  // no basta, porque una corrida parcial no puede distinguir "ya no se vende"
  // de "se mudo a una pagina que yo no miro".
  const alcance = alcanceLiviano("https://x/tel");
  let estado = { "SKU-1": registro({ ultimaVezVisto: horas(TS, -12) }) };

  estado = corrida({ previo: estado, alcance, timestamp: horas(TS, -1) }).catalogo;
  assert.equal(estado["SKU-1"].ausencias, 1);
  assert.equal(estado["SKU-1"].ausenciaEnCompleto, false, "una liviana marco su ausencia como verificada");

  const segunda = corrida({ previo: estado, alcance, timestamp: TS });
  assert.deepEqual(segunda.cambios, [], "dos revisiones livianas declararon desaparecido un producto que ninguna de las dos podia verificar");
  assert.equal(segunda.catalogo["SKU-1"].presencia, "ausente");
  assert.ok(segunda.catalogo["SKU-1"].ausencias >= UMBRAL_AUSENCIAS, "la ausencia igual se cuenta: lo que espera es el aviso");
});

test("...pero en cuanto una revision COMPLETA aporta una ausencia, la liviana siguiente ya puede declararlo", () => {
  // La mitad que es facil olvidar: esto no es una excusa para dejar de
  // detectar. Un completo es lo unico que puede decir "no esta en ninguna
  // parte del sitio"; una vez dicho, la deteccion rapida del bloque liviano
  // vuelve a valer.
  const alcance = alcanceLiviano("https://x/tel");
  let estado = { "SKU-1": registro({ ultimaVezVisto: horas(TS, -12) }) };

  estado = corrida({ previo: estado, alcance: alcanceCompleto(), timestamp: horas(TS, -1) }).catalogo;
  assert.equal(estado["SKU-1"].ausenciaEnCompleto, true);

  const segunda = corrida({ previo: estado, alcance, timestamp: TS });
  assert.deepEqual(segunda.cambios.map((c) => c.tipo), ["desaparecido"]);
});

test("la marca de ausencia verificada se borra cuando el producto vuelve a verse", () => {
  // Si sobreviviera a la observacion, una racha vieja avalada por un completo le
  // serviria de aval a una racha NUEVA puesta solo por livianas, y el arreglo se
  // deshace solo con el paso de los dias.
  const alcance = alcanceLiviano("https://x/tel");
  let estado = corrida({ previo: { "SKU-1": registro({ ultimaVezVisto: horas(TS, -12) }) }, alcance: alcanceCompleto(), timestamp: horas(TS, -8) }).catalogo;
  assert.equal(estado["SKU-1"].ausenciaEnCompleto, true);

  // se vuelve a ver
  estado = corrida({ previo: estado, observado: { "SKU-1": observacionDe(registro(), horas(TS, -7)) }, alcance, timestamp: horas(TS, -7) }).catalogo;
  assert.equal("ausenciaEnCompleto" in estado["SKU-1"], false, "la marca sobrevivio a la observacion");
  assert.equal(estado["SKU-1"].ausencias, 0);

  // y ahora dos livianas seguidas no alcanzan, igual que si nunca hubiera habido un completo
  estado = corrida({ previo: estado, alcance, timestamp: horas(TS, -1) }).catalogo;
  const segunda = corrida({ previo: estado, alcance, timestamp: horas(TS, 1) });
  assert.deepEqual(segunda.cambios, [], "una racha vieja verificada le sirvio de aval a una racha nueva");
});

test("un registro heredado de la version anterior no queda inmortal: sus ausencias cuentan como verificadas", () => {
  // Hasta el 2026-09-12 todas las corridas eran completas, asi que un registro
  // con ausencias acumuladas y sin la marca las junto necesariamente en
  // corridas completas. Si el campo ausente se leyera como "sin verificar",
  // ningun registro escrito por la version anterior podria declararse
  // desaparecido hasta que un completo volviera a pasar.
  const heredado = registro({ ausencias: 1, ultimaVezVisto: horas(TS, -HORAS_MIN_DESAPARICION) });
  delete heredado.ausenciaEnCompleto;
  const r = corrida({ previo: { "SKU-1": heredado }, alcance: alcanceLiviano("https://x/tel"), timestamp: TS });
  assert.deepEqual(r.cambios.map((c) => c.tipo), ["desaparecido"]);
});

test("UN PRODUCTO QUE SE MUDA A UNA PAGINA DE FUERA DEL BLOQUE no produce ningun aviso, sobre el catalogo REAL", () => {
  // LA PRUEBA QUE VALE POR TODAS LAS DE ESTE ARCHIVO. Reproduce el defecto
  // exacto que midieron los verificadores: un SKU vivo, publicado hoy por una
  // pagina del bloque liviano, deja de publicarse ahi y pasa a publicarse desde
  // una pagina de fuera del bloque. El producto esta a la venta todo el tiempo.
  //
  // Antes del arreglo: "desaparecido" en la liviana de las 6 h y "recuperado" en
  // el completo de las 12 h. Ahora: nada.
  const completo = recorrido();
  const liviano = recorrido({ modo: MODO_LIVIANO });
  const paginasLivianas = liviano.alcance.paginas;

  const destino = completo.entries.map((e) => e.url).find((u) => !paginasLivianas.has(u));
  assert.ok(destino, "no se encontro una pagina de fuera del bloque liviano");

  const mudado = Object.entries(CATALOGO_REAL).find(
    ([, r]) => r.presencia !== "desaparecido" && paginasLivianas.has(r.paginaOrigen ?? r.url),
  );
  assert.ok(mudado, "no se encontro un SKU vivo dentro del bloque liviano");
  const [sku] = mudado;

  let estado = copiaDelCatalogo();
  const ultimo = Object.values(estado)
    .map((r) => Date.parse(r.ultimaVezVisto ?? ""))
    .filter(Number.isFinite)
    .reduce((a, b) => Math.max(a, b), 0);
  const T0 = new Date(ultimo + 3 * 3600000).toISOString();

  const plan = [{ modo: MODO_COMPLETO, hora: 0 }];
  for (let i = 1; i <= 9; i++) plan.push({ modo: MODO_LIVIANO, hora: i + 2 });
  plan.push({ modo: MODO_COMPLETO, hora: 12 });
  for (let i = 1; i <= 9; i++) plan.push({ modo: MODO_LIVIANO, hora: 14 + i });

  const eventos = [];
  for (const paso of plan) {
    const ts = horas(T0, paso.hora);
    const esLiviana = paso.modo === MODO_LIVIANO;
    const alcance = esLiviana ? liviano.alcance : completo.alcance;
    // la mudanza ocurre justo despues del primer completo
    const yaSeMudo = paso.hora >= 3;

    const observado = {};
    for (const [modelo, rec] of Object.entries(estado)) {
      if (rec.presencia === "desaparecido") continue;
      // de que pagina lo publica el SITIO en este momento (no la guardada)
      const pagina = modelo === sku && yaSeMudo ? destino : rec.paginaOrigen ?? rec.url;
      if (esLiviana && !paginasLivianas.has(pagina)) continue;
      observado[modelo] = observacionDe(rec, ts, modelo === sku && yaSeMudo ? { paginaOrigen: destino, url: destino } : {});
    }

    const juicio = evaluarConfiabilidad({ previo: estado, observado, alcance, fallidas: 0, paginas: alcance.paginas.size });
    const r = corrida({ previo: estado, observado, alcance, timestamp: ts, confiable: juicio.confiable });
    eventos.push(...r.cambios.map((c) => ({ ...c, hora: paso.hora, modo: paso.modo })));
    estado = r.catalogo;
  }

  const suyos = eventos.filter((c) => c.modelo === sku);
  assert.deepEqual(
    suyos.map((c) => `${c.tipo}@${c.hora}h/${c.modo}`),
    [],
    `${sku} se mudo de pagina y el monitor lo trato como si hubiera desaparecido`,
  );
  assert.deepEqual(eventos, [], `la mudanza de un SKU produjo ${eventos.length} aviso(s) en el resto del catalogo`);
  assert.equal(estado[sku].presencia, "activo");
  assert.equal(estado[sku].paginaOrigen, destino, "el catalogo no se entero de la pagina nueva");
});

test("una desaparicion DE VERDAD dentro del bloque liviano se sigue avisando, y como maximo 12 h despues", () => {
  // El costo del arreglo, medido y acotado: dentro del bloque la deteccion pasa
  // de 5-7 h a entre 5 h y 12 h, porque hace falta que pase un completo. Fuera
  // del bloque no cambia nada (ahi las dos ausencias siempre vinieron de
  // completos). Si esta prueba muere, el arreglo se convirtio en una excusa para
  // no detectar.
  const alcance = alcanceLiviano("https://x/tel");
  let estado = { "SKU-1": registro({ ultimaVezVisto: horas(TS, -1) }) };
  const plan = [];
  for (let h = 0; h < 24; h++) plan.push({ hora: h, modo: h === 12 ? MODO_COMPLETO : MODO_LIVIANO });

  let avisado = null;
  for (const paso of plan) {
    const r = corrida({
      previo: estado,
      alcance: paso.modo === MODO_COMPLETO ? alcanceCompleto() : alcance,
      timestamp: horas(TS, paso.hora),
    });
    if (avisado === null && r.cambios.some((c) => c.tipo === "desaparecido")) avisado = paso.hora;
    estado = r.catalogo;
  }
  assert.notEqual(avisado, null, "un producto del bloque liviano desaparecio de verdad y nadie aviso nunca");
  assert.equal(avisado, 12, "tenia que avisarlo la primera corrida completa que pasa, ni antes ni despues");
});

// ===========================================================================
// DEFECTO 2: EL ALCANCE PODIA ENCOGERSE SOLO, EN SILENCIO.
// ===========================================================================

test("ultimoRecorrido lee la ultima corrida del MISMO tipo, no la ultima a secas", () => {
  const filas = [
    { modo: "completo", alcance: "todo", paginasDelAlcance: 1185 },
    { modo: "liviano", alcance: "principales", paginasDelAlcance: 347 },
    { modo: "liviano", alcance: "cyber", paginasDelAlcance: 216 },
    { modo: "liviano", alcance: "principales", paginasDelAlcance: 344 },
  ].map((f) => JSON.stringify(f)).join("\n");

  assert.equal(ultimoRecorrido(filas, { modo: "liviano", etiqueta: "principales" }), 344, "devolvio una fila que no era la ultima de su tipo");
  assert.equal(ultimoRecorrido(filas, { modo: "completo", etiqueta: "todo" }), 1185);
  assert.equal(ultimoRecorrido(filas, { modo: "liviano", etiqueta: "cyber" }), 216);
  assert.equal(ultimoRecorrido("", { modo: "completo", etiqueta: "todo" }), null);
  assert.equal(ultimoRecorrido("{no es json\n", { modo: "completo", etiqueta: "todo" }), null);
});

test("una fila con el modo y la etiqueta en desacuerdo no le sirve de vara a nadie", () => {
  // POR QUE SE FILTRA POR LAS DOS COSAS, si hoy la etiqueta ya determina el modo
  // ("todo" solo la escribe una completa). Porque data/ejecuciones.jsonl se
  // COMMITEA y se fusiona por union entre corridas concurrentes
  // (.gitattributes), asi que una fila mezclada o editada a mano es posible, y
  // esta es la vara con la que se decide si una revision es confiable. Con un
  // solo filtro, esa fila se cuela y una revision completa se compara contra un
  // recorrido liviano: 1.185 contra 347 es un "encogimiento" del 71% y la
  // revision buena queda marcada sospechosa, que es como se apaga la deteccion
  // de desaparecidos sin que nadie lo pida.
  const mezclada = [
    { modo: "completo", alcance: "todo", paginasDelAlcance: 1185 },
    { modo: "liviano", alcance: "todo", paginasDelAlcance: 347 },
  ].map((f) => JSON.stringify(f)).join("\n");
  assert.equal(ultimoRecorrido(mezclada, { modo: "completo", etiqueta: "todo" }), 1185, "una fila liviana etiquetada 'todo' se uso como vara de una completa");

  const alReves = [
    { modo: "liviano", alcance: "principales", paginasDelAlcance: 347 },
    { modo: "completo", alcance: "principales", paginasDelAlcance: 1185 },
  ].map((f) => JSON.stringify(f)).join("\n");
  assert.equal(ultimoRecorrido(alReves, { modo: "liviano", etiqueta: "principales" }), 347);
});

test("una fila anterior a este cambio cuenta como completa y su `paginas` es su alcance", () => {
  // Sin esto, el primer completo despues del despliegue no tendria contra que
  // compararse justo el dia en que mas conviene mirar.
  const vieja = JSON.stringify({ inicio: "2026-09-12T00:00:00Z", paginas: 1183, productosEncontrados: 929 });
  assert.equal(ultimoRecorrido(vieja, { modo: MODO_COMPLETO, etiqueta: "todo" }), 1183);
  assert.equal(ultimoRecorrido(vieja, { modo: MODO_LIVIANO, etiqueta: "principales" }), null);
});

test("un recorrido que se encoge mas de la tolerancia marca la corrida como NO confiable", () => {
  // El caso real: el descubrimiento por sitemap devuelve 0 paginas y el bloque
  // liviano pasa de 347 a 185. Con `esperados` calculado contra el alcance, la
  // heuristica de "faltan productos" no ve NADA: 196 esperados pasan a 36 y los
  // 36 encontrados son el 100%. Esta es la unica senal que queda.
  const previo = {};
  for (let i = 0; i < 40; i++) previo[`SKU-${i}`] = registro({ modelo: `SKU-${i}`, url: `https://x/p${i}`, paginaOrigen: `https://x/p${i}` });
  const alcance = alcanceDe({ modo: MODO_LIVIANO, entries: Array.from({ length: 40 }, (_, i) => ({ url: `https://x/p${i}` })) });
  const observado = Object.fromEntries(Object.entries(previo).map(([k, v]) => [k, observacionDe(v, TS)]));

  const sano = evaluarConfiabilidad({ previo, observado, alcance, fallidas: 0, paginas: 40, recorrido: { actual: 347, anterior: 347 } });
  assert.equal(sano.confiable, true);

  const encogido = evaluarConfiabilidad({ previo, observado, alcance, fallidas: 0, paginas: 40, recorrido: { actual: 185, anterior: 347 } });
  assert.equal(encogido.confiable, false, "el recorrido perdio el 47% de sus paginas y la corrida se dio por buena");
  assert.deepEqual(encogido.motivos.map((m) => m.tipo), ["recorrido-encogido"]);
  assert.match(encogido.motivos[0].texto, /185/);
  assert.match(encogido.motivos[0].texto, /347/);
});

test("...y el movimiento normal del sitio no la marca", () => {
  // Samsung publica y retira fichas todos los dias. Si cualquier variacion
  // disparara el aviso, el operador recibiria uno diario y dejaria de leerlos.
  const juicio = (actual, anterior) => evaluarConfiabilidad({ previo: {}, observado: { A: {} }, fallidas: 0, paginas: 10, recorrido: { actual, anterior } });
  assert.equal(juicio(1185, 1183).confiable, true);
  assert.equal(juicio(1100, 1185).confiable, true, `una caida del 7% no puede ser una falla (tolerancia ${TOLERANCIA_ENCOGIMIENTO})`);
  assert.equal(juicio(1300, 1185).confiable, true, "crecer no es encogerse");
  assert.equal(juicio(347, null).confiable, true, "sin corrida anterior del mismo tipo no hay nada que comparar");
  assert.equal(juicio(1000, 1185).confiable, false);
});

test("con el descubrimiento caido, una revision COMPLETA no declara ni un desaparecido", () => {
  // El caso peor, que es preexistente pero que este mismo chequeo cubre: si el
  // descubrimiento se cae en DOS completos seguidos son 160 desaparecidos falsos
  // + 160 recuperados, y el umbral del 80% no los atrapa (el margen de un
  // completo son 184 SKU y el descubrimiento aporta 160: pasa por debajo).
  const completo = recorrido();
  const sinDescubrimiento = prepararRecorrido({ seedRaw: SEED, familyEntries: [] });
  assert.ok(sinDescubrimiento.alcance.paginas.size < completo.alcance.paginas.size * (1 - TOLERANCIA_ENCOGIMIENTO), "el descubrimiento aporta menos paginas de las que esta prueba supone");

  const estado = copiaDelCatalogo();
  const ts = horas(new Date().toISOString(), 0);
  // solo se observan los SKU de las paginas que quedaron
  const observado = {};
  for (const [modelo, rec] of Object.entries(estado)) {
    if (rec.presencia === "desaparecido") continue;
    if (!sinDescubrimiento.alcance.paginas.has(rec.paginaOrigen ?? rec.url)) continue;
    observado[modelo] = observacionDe(rec, ts);
  }

  // EL UMBRAL DEL 80% NO LA ATRAPA: es el agujero que esta prueba vigila.
  const umbral80 = Object.values(estado).filter((r) => r.presencia !== "desaparecido").length * 0.8;
  assert.ok(Object.keys(observado).length >= umbral80, "esta corrida ya cae por el umbral del 80%: la prueba dejo de medir lo que dice medir");

  const visto = evaluarConfiabilidad({
    previo: estado,
    observado,
    alcance: sinDescubrimiento.alcance,
    fallidas: 0,
    paginas: sinDescubrimiento.entries.length,
    recorrido: { actual: sinDescubrimiento.alcance.paginas.size, anterior: completo.alcance.paginas.size },
  });
  assert.equal(visto.confiable, false);
  assert.deepEqual(visto.motivos.map((m) => m.tipo).sort(), ["recorrido-encogido", "sku-sin-pagina"], "las dos redes tienen que atrapar esta corrida, no una sola");

  const r = corrida({ previo: estado, observado, alcance: sinDescubrimiento.alcance, timestamp: ts, confiable: visto.confiable });
  assert.deepEqual(r.cambios.filter((c) => c.tipo === "desaparecido"), [], "una caida del descubrimiento se convirtio en desaparecidos");
});

test("y si el descubrimiento NO vuelve, la revision completa siguiente tampoco declara nada (la vara no se normaliza sola)", () => {
  // DEFECTO MEDIDO AL RE-VERIFICAR (2026-09-12): `recorrido-encogido` se mide
  // contra la ULTIMA corrida del mismo tipo, asi que a la segunda completa con
  // el descubrimiento caido la vara YA es 1.023 y el motivo deja de dispararse.
  // Simulando 7 dias de la cadencia real, eso daba **160 desaparecidos falsos** a
  // las ~24 h del corte. `sku-sin-pagina` se juzga contra el CATALOGO y por eso
  // no se normaliza: mientras el descubrimiento siga caido, cada completa vuelve
  // a encontrar los mismos 160 productos sin pagina.
  const sinDescubrimiento = prepararRecorrido({ seedRaw: SEED, familyEntries: [] });
  const estado = copiaDelCatalogo();
  const ts = horas(new Date().toISOString(), 0);
  const observado = {};
  for (const [modelo, rec] of Object.entries(estado)) {
    if (rec.presencia === "desaparecido") continue;
    if (!sinDescubrimiento.alcance.paginas.has(rec.paginaOrigen ?? rec.url)) continue;
    observado[modelo] = observacionDe(rec, ts);
  }

  const segunda = evaluarConfiabilidad({
    previo: estado,
    observado,
    alcance: sinDescubrimiento.alcance,
    fallidas: 0,
    paginas: sinDescubrimiento.entries.length,
    // la vara ya se movio al tamano roto: `recorrido-encogido` no puede saltar
    recorrido: { actual: sinDescubrimiento.alcance.paginas.size, anterior: sinDescubrimiento.alcance.paginas.size },
  });
  assert.equal(segunda.motivos.some((m) => m.tipo === "recorrido-encogido"), false, "la vara del encogimiento ya se normalizo: es la premisa de esta prueba");
  assert.equal(segunda.confiable, false, "la segunda completa con el descubrimiento caido se dio por buena");
  assert.equal(segunda.motivos.some((m) => m.tipo === "sku-sin-pagina"), true);

  const r = corrida({ previo: estado, observado, alcance: sinDescubrimiento.alcance, timestamp: ts, confiable: segunda.confiable });
  assert.deepEqual(r.cambios.filter((c) => c.tipo === "desaparecido"), []);
});

test("una revision completa SANA no dispara el chequeo de productos sin pagina", () => {
  // La contraparte obligatoria: el umbral no puede estar tan apretado que la
  // revision normal quede sospechosa. Medido hoy: una completa sana deja 0 de
  // los 929 vivos sin pagina en su recorrido, y el peor dia de desapariciones
  // reales de toda la historia son 29 (3,1%), debajo del 5% del umbral.
  const completo = recorrido();
  const estado = copiaDelCatalogo();
  const ts = horas(new Date().toISOString(), 0);
  const observado = {};
  for (const [modelo, rec] of Object.entries(estado)) {
    if (rec.presencia === "desaparecido") continue;
    observado[modelo] = observacionDe(rec, ts);
  }
  const sano = evaluarConfiabilidad({
    previo: estado,
    observado,
    alcance: completo.alcance,
    fallidas: 0,
    paginas: completo.entries.length,
    recorrido: { actual: completo.alcance.paginas.size, anterior: completo.alcance.paginas.size },
  });
  assert.deepEqual(sano.motivos, [], "una revision completa normal quedo marcada como sospechosa");

  const vivos = Object.values(estado).filter((r) => r.presencia !== "desaparecido");
  const sinPagina = vivos.filter((r) => !completo.alcance.paginas.has(r.paginaOrigen ?? r.url)).length;
  assert.ok(sinPagina <= vivos.length * TOLERANCIA_SIN_PAGINA * 0.5, `el catalogo real ya va en ${sinPagina} de ${vivos.length} productos sin pagina en el recorrido: queda poco margen antes del ${TOLERANCIA_SIN_PAGINA * 100}%`);
});

test("una revision LIVIANA no se marca sospechosa por los 733 productos que no se propuso mirar", () => {
  // El chequeo nuevo solo aplica a las completas. En una liviana, "sin pagina en
  // el recorrido" es la normalidad y lo resuelve enAlcance(): esos SKU no
  // acumulan nada, asi que no pueden producir un falso desaparecido. Si el
  // chequeo se aplicara igual, las 18 revisiones livianas del dia serian
  // sospechosas y volveriamos al aviso tecnico cada hora.
  const liviano = recorrido({ modo: MODO_LIVIANO });
  const estado = copiaDelCatalogo();
  const ts = horas(new Date().toISOString(), 0);
  const observado = {};
  for (const [modelo, rec] of Object.entries(estado)) {
    if (rec.presencia === "desaparecido") continue;
    if (!liviano.alcance.paginas.has(rec.paginaOrigen ?? rec.url)) continue;
    observado[modelo] = observacionDe(rec, ts);
  }
  const r = evaluarConfiabilidad({
    previo: estado,
    observado,
    alcance: liviano.alcance,
    fallidas: 0,
    paginas: liviano.entries.length,
    recorrido: { actual: liviano.alcance.paginas.size, anterior: liviano.alcance.paginas.size },
  });
  assert.deepEqual(r.motivos, []);
});

// ===========================================================================
// DEFECTO 3: EL AVISO DE MOMIA SE ATRASABA DE ~3 DIAS A ~10 DIAS PARA EL 73%
// DEL CATALOGO, Y EL COMENTARIO DEL CODIGO DECIA LO CONTRARIO.
// ===========================================================================

test("UMBRAL_SIN_VERIFICAR vale 6, y ese numero es el que hace que el aviso signifique ~3 dias en las dos puntas del catalogo", () => {
  // El contador solo avanza cuando la corrida MIRA al producto. Con 20:
  //  - dentro del bloque liviano (hasta 20 miradas al dia) 20 corridas son ~1 dia
  //    y mandaba el piso de reloj;
  //  - fuera del bloque (2 miradas al dia) 20 corridas son ~10 DIAS y mandaba el
  //    contador, asi que el aviso llegaba 3 veces mas tarde de lo prometido.
  // Los pisos de reloj solo retrasan, nunca adelantan: 72 h no podia arreglarlo.
  assert.equal(UMBRAL_SIN_VERIFICAR, 6, "si este numero sube, el aviso vuelve a significar ~10 dias para los 733 productos de fuera del bloque");
  // 6 miradas a 2 por dia son 3 dias, que es justo el piso de reloj
  assert.equal((UMBRAL_SIN_VERIFICAR / 2) * 24, HORAS_MIN_MOMIA, "el contador y el piso de reloj dejaron de significar lo mismo fuera del bloque");
});

// ===========================================================================
// DEFECTO 4: EL FRENO DE UNA VEZ AL DIA TAPABA UNA CATASTROFE CON UNA ANOMALIA
// LEVE DEL MISMO TIPO.
// ===========================================================================

test("una falla leve y una catastrofe del mismo tipo NO comparten la clave del freno diario", () => {
  // Medido por los verificadores: una liviana con 36 de 347 paginas caidas a las
  // 05:23 consumia la clave del dia, y la de las 13:23 con 340 de 347 caidas
  // quedaba silenciada. Y una corrida no confiable ademas no declara
  // desaparecidos, asi que el dia podia quedar con la deteccion apagada y un
  // solo mensaje, con los numeros del caso leve.
  const base = { previo: {}, observado: { A: {} }, paginas: 347 };
  const leve = evaluarConfiabilidad({ ...base, fallidas: 36 });
  const grave = evaluarConfiabilidad({ ...base, fallidas: 340 });

  assert.deepEqual(leve.motivos.map((m) => m.tipo), ["errores"]);
  assert.deepEqual(grave.motivos.map((m) => m.tipo), ["errores"], "los dos son del mismo tipo: por eso la clave tiene que distinguirlos de otra forma");
  assert.equal(leve.motivos[0].gravedad, "leve");
  assert.equal(grave.motivos[0].gravedad, "grave");
  assert.notEqual(
    claveNoConfiable(MODO_LIVIANO, leve.motivos),
    claveNoConfiable(MODO_LIVIANO, grave.motivos),
    "36 de 347 paginas caidas silencia 340 de 347 el mismo dia",
  );
});

test("dos corridas igual de rotas SI comparten clave: el freno diario sigue frenando", () => {
  const a = evaluarConfiabilidad({ previo: {}, observado: { A: {} }, fallidas: 40, paginas: 347 });
  const b = evaluarConfiabilidad({ previo: {}, observado: { A: {} }, fallidas: 51, paginas: 347 });
  assert.equal(claveNoConfiable(MODO_LIVIANO, a.motivos), claveNoConfiable(MODO_LIVIANO, b.motivos), "los numeros crudos se colaron en la clave y el freno dejo de frenar");
});

test("la clave no depende del orden en que vengan los motivos", () => {
  const motivos = [
    { tipo: "errores", gravedad: "leve" },
    { tipo: "faltan-productos", gravedad: "grave" },
  ];
  assert.equal(claveNoConfiable(MODO_LIVIANO, motivos), claveNoConfiable(MODO_LIVIANO, [...motivos].reverse()));
});

test("el modo sigue estando en la clave: la misma falla en liviano y en completo son dos avisos distintos", () => {
  const m = evaluarConfiabilidad({ previo: {}, observado: { A: {} }, fallidas: 40, paginas: 347 }).motivos;
  assert.notEqual(claveNoConfiable(MODO_LIVIANO, m), claveNoConfiable(MODO_COMPLETO, m));
});

// ===========================================================================
// DEFECTO 5: EL MODO CYBER APAGABA EN SILENCIO EL AVISO DE "UNA CATEGORIA
// PRINCIPAL YA NO ESTA EN EL LISTADO" -- Y LO APAGABA TAMBIEN EN LAS COMPLETAS.
// ===========================================================================

test("con el Cyber encendido se sigue vigilando que esten las CINCO categorias principales", () => {
  // El bloque decide que se mira SEGUIDO, no que se vigila. Antes, con el Cyber
  // encendido, que el listado le cambiara el nombre a "Tablets" no lo denunciaba
  // nadie -- ni siquiera las revisiones completas, que si recorren Tablets.
  const renombrado = SEED.map((e) => (e.categoria === "Tablets" ? { ...e, categoria: "Tabletas" } : e));
  const conCyber = prepararRecorrido({ seedRaw: renombrado, familyEntries: FAMILIA, bloque: BLOQUE_CYBER, modo: MODO_LIVIANO });
  const conCyberCompleto = prepararRecorrido({ seedRaw: renombrado, familyEntries: FAMILIA, bloque: BLOQUE_CYBER });
  const normal = prepararRecorrido({ seedRaw: renombrado, familyEntries: FAMILIA, bloque: BLOQUE_PRINCIPAL, modo: MODO_LIVIANO });

  assert.deepEqual(normal.ausentes.map((a) => a.categoria), ["Tablets"]);
  assert.deepEqual(conCyber.ausentes.map((a) => a.categoria), ["Tablets"], "el Cyber apago el aviso de una categoria principal que ya no esta");
  assert.deepEqual(conCyberCompleto.ausentes.map((a) => a.categoria), ["Tablets"], "y lo apago tambien en las revisiones completas");
  assert.ok(conCyber.ausentes[0].paginasEnLaSeccion > 0, "es un renombre: las paginas siguen ahi");
});

test("ordenarRecorrido separa el bloque que recorre de las categorias que vigila", () => {
  const renombrado = SEED.map((e) => (e.categoria === "Relojes (Galaxy Watch)" ? { ...e, categoria: "Smartwatches" } : e));
  const { ausentes } = ordenarRecorrido(renombrado, BLOQUE_CYBER.categorias, CATEGORIAS_PRINCIPALES);
  assert.deepEqual(ausentes.map((a) => a.categoria), ["Relojes (Galaxy Watch)"]);
  // y el bloque que se recorre sigue siendo el del Cyber
  const { ausentes: soloCyber } = ordenarRecorrido(renombrado, BLOQUE_CYBER.categorias, BLOQUE_CYBER.categorias);
  assert.deepEqual(soloCyber, [], "el bloque Cyber no incluye Relojes: esta es la version que callaba");
});

// ===========================================================================
// DEFECTO 6: PIEZAS NUEVAS QUE NINGUNA PRUEBA SOSTENIA (mutantes que
// sobrevivian con la suite entera en verde).
// ===========================================================================

test("ultimoCompleto devuelve la ULTIMA revision completa, no la primera", () => {
  // Invertir la direccion del bucle dejaba las 411 pruebas en verde y rompia la
  // red de seguridad entera: medido sobre el data/ejecuciones.jsonl real, la
  // version correcta da 0 h de antiguedad y la invertida 1.191 h, o sea TODA
  // revision liviana se convertiria en un completo de ~3 h mas un aviso diario.
  const filas = [
    { modo: "completo", fin: "2026-09-12T06:00:00Z" },
    { modo: "liviano", fin: "2026-09-12T07:00:00Z" },
    { modo: "completo", fin: "2026-09-12T08:00:00Z" },
    { modo: "liviano", fin: "2026-09-12T09:00:00Z" },
  ].map((f) => JSON.stringify(f)).join("\n");
  assert.equal(ultimoCompleto(filas), "2026-09-12T08:00:00Z");
});

test("...y sobre el archivo de ejecuciones REAL no escala una revision liviana de hoy", () => {
  const texto = readFileSync(path.join(RAIZ, "data", "ejecuciones.jsonl"), "utf-8");
  const fin = ultimoCompleto(texto);
  assert.ok(fin, "el archivo de ejecuciones real no trae ninguna revision completa");
  const d = decidirModo({ pedido: MODO_LIVIANO, ultimoCompletoFin: fin, ahora: horas(fin, 1) });
  assert.equal(d.modo, MODO_LIVIANO, "una liviana lanzada 1 h despues de un completo se ascendio sola");
  assert.equal(d.escalado, false);
});

test("HORAS_SIN_COMPLETO vale 16, y el umbral esta fijado por numeros y no por si mismo", () => {
  // La prueba anterior derivaba su entrada de la propia constante, asi que
  // pasaba con cualquier valor: con 9999 la escalada no se gatillaria nunca y la
  // suite quedaba verde igual.
  assert.equal(HORAS_SIN_COMPLETO, 16, "12-14 h se gatillarian solas casi todos los dias con el atraso medido de GitHub (mediana 68 min)");
  const conAtraso = (h) => decidirModo({ pedido: MODO_LIVIANO, ultimoCompletoFin: horas(TS, -h), ahora: TS });
  assert.equal(conAtraso(15.9).modo, MODO_LIVIANO);
  assert.equal(conAtraso(16.1).modo, MODO_COMPLETO);
  assert.equal(conAtraso(16.1).escalado, true);
  // 13,5 h es el atraso normal de un completo que llego tarde: no puede escalar
  assert.equal(conAtraso(13.5).modo, MODO_LIVIANO);
});

test("cada corrida escribe en ejecuciones.jsonl QUE bloque recorrio, no siempre 'todo'", () => {
  // Es el campo que vuelve comparables las filas de una liviana y una completa, y
  // el que lee ultimoRecorrido para saber contra que compararse. Fijarlo en
  // "todo" hacia que toda revision liviana MINTIERA sobre su propio alcance con
  // la suite en verde.
  assert.equal(recorrido({ modo: MODO_LIVIANO }).alcance.etiqueta, "principales");
  assert.equal(recorrido({ modo: MODO_LIVIANO, bloque: BLOQUE_CYBER }).alcance.etiqueta, "cyber");
  assert.equal(recorrido().alcance.etiqueta, "todo");
  assert.equal(recorrido({ bloque: BLOQUE_CYBER }).alcance.etiqueta, "todo", "una revision completa recorre todo, se llame como se llame el bloque");
});

test("prepararRecorrido ya no devuelve un campo `modo` que nadie lee", () => {
  // Era grasa: un mutante que lo fijaba en "completo" dejaba las 411 pruebas en
  // verde porque no lo consume nadie. El modo de la corrida lo decide
  // src/alcance.mjs y viaja en `alcance.modo`.
  const r = recorrido({ modo: MODO_LIVIANO });
  assert.equal("modo" in r, false);
  assert.equal(r.alcance.modo, MODO_LIVIANO);
});

// ===========================================================================
// DEFECTO 7 (el que NO tiene arreglo de codigo): CON DOS REVISIONES COMPLETAS AL
// DIA, UN HECHO QUE DURA MENOS DE MEDIO DIA PUEDE NO EXISTIR NUNCA PARA EL
// SISTEMA, FUERA DEL BLOQUE LIVIANO.
// ===========================================================================

test("dentro del bloque liviano, un quiebre de stock corto SI se confirma y se avisa", () => {
  // Esta es la mitad que el sistema gana, y hay que vigilarla: dos observaciones
  // seguidas dentro del bloque estan a 1 hora, no a 12. Fuera del bloque el
  // mismo quiebre de 2 h no lo ve nadie, y eso es aritmetica de muestreo (2
  // revisiones completas al dia), no un defecto que se pueda arreglar en el
  // codigo: esta escrito en README.md y en BITACORA.md para que el operador lo
  // sepa antes de que pase.
  const alcance = alcanceLiviano("https://x/tel");
  const agotado = (ts) => ({ "SKU-1": observacionDe(registro({ estadoStock: "agotado", disponible: false }), ts) });

  let estado = { "SKU-1": registro() };
  const uno = corrida({ previo: estado, observado: agotado(horas(TS, 1)), alcance, timestamp: horas(TS, 1) });
  assert.deepEqual(uno.cambios, [], "un solo avistamiento no puede cambiar el stock: el detector parpadea");
  assert.equal(uno.catalogo["SKU-1"].stockPendiente, "agotado");

  const dos = corrida({ previo: uno.catalogo, observado: agotado(horas(TS, 2)), alcance, timestamp: horas(TS, 2) });
  assert.deepEqual(dos.cambios.map((c) => c.tipo), ["stock"], "dos revisiones livianas seguidas tienen que poder confirmar un quiebre de stock");
});

test("FUERA del bloque, un quiebre de stock que dura menos que el hueco entre completas no existe para el sistema", () => {
  // LA MITAD QUE SE PIERDE, medida y fijada aca para que nadie la descubra por
  // accidente. Un televisor se agota a las 06:00 y vuelve a las 16:00: las dos
  // revisiones completas del dia (02:07 y 14:07) NO caen las dos dentro de la
  // ventana, asi que el quiebre nunca se confirma. Barrido de 72 momentos de
  // inicio x 8 duraciones con comparar() real: un quiebre de hasta 12 h se avisa
  // 0 de cada 100 veces fuera del bloque (antes, con 7 revisiones diarias, uno
  // de 8 h se avisaba 92 de cada 100).
  //
  // NO ES UN DEFECTO QUE SE PUEDA ARREGLAR EN EL CODIGO: es aritmetica de
  // muestreo con 2 completas al dia, que es lo que pidio el operador. Lo que si
  // se puede es DECIRLO, y por eso la segunda mitad de esta prueba vigila que
  // siga dicho en el README.
  const pagina = "https://x/tv";
  const fuera = alcanceLiviano("https://x/tel"); // el televisor no esta en el bloque
  const tv = () => registro({ modelo: "TV-1", categoria: "Televisores", url: pagina, paginaOrigen: pagina });
  const obs = (ts, agotado) => ({ "TV-1": observacionDe(registro({ modelo: "TV-1", categoria: "Televisores", url: pagina, paginaOrigen: pagina, estadoStock: agotado ? "agotado" : "disponible", disponible: !agotado }), ts) });

  let estado = { "TV-1": tv() };
  const avisos = [];
  // 06:00 se agota, 16:00 vuelve. Completas a las 02:07 y 14:07; las livianas ni
  // siquiera miran esta pagina.
  for (const { h, agotado } of [
    { h: 2.1, agotado: false },
    { h: 14.1, agotado: true },
    { h: 26.1, agotado: false },
    { h: 38.1, agotado: false },
  ]) {
    const r = corrida({ previo: estado, observado: obs(horas(TS, h), agotado), alcance: alcanceCompleto(), timestamp: horas(TS, h) });
    avisos.push(...r.cambios.map((c) => c.tipo));
    estado = r.catalogo;
  }
  assert.deepEqual(avisos, [], "el quiebre corto de un producto de fuera del bloque llego a avisarse: la tabla del README quedo desactualizada");
  assert.equal(estado["TV-1"].estadoStock, "disponible");
  assert.equal(estado["TV-1"].stockPendiente, null, "el pendiente tiene que resolverse, no quedar colgado");
  assert.ok(fuera.parcial);

  // Y QUE SIGA DICHO. Si alguien borra la advertencia del README, esto cae.
  const readme = readFileSync(path.join(RAIZ, "README.md"), "utf-8");
  assert.ok(readme.includes("De qué DEJAS de enterarte"), "el README ya no advierte de que deja de enterarse el operador");
  assert.ok(
    readme.includes("un quiebre de stock de menos de medio día en algo que no sea de las 5 categorías ya no te va a llegar nunca"),
    "el README ya no dice, con todas las letras, que los quiebres de stock cortos de fuera del bloque no se avisan",
  );
});

// ===========================================================================
// EL WORKFLOW: lo que se puede comprobar sin GitHub.
// ===========================================================================

const YML = readFileSync(path.join(RAIZ, ".github", "workflows", "monitor.yml"), "utf-8");
const lineasYml = YML.split(/\r?\n/);
const cronsActivos = lineasYml
  .map((l) => l.match(/^\s*- cron: "([^"]+)"\s*(?:#\s*(\d{2}):(\d{2}) Chile)?/))
  .filter(Boolean)
  .map((m) => ({ cron: m[1], horaChile: m[2] == null ? null : Number(m[2]), minutoChile: m[3] == null ? null : Number(m[3]) }));

test("el workflow declara 20 horarios: 2 completos y 18 livianos, ni uno mas", () => {
  assert.equal(cronsActivos.length, 20, `el workflow tiene ${cronsActivos.length} horarios activos: ${cronsActivos.map((c) => c.cron).join(", ")}`);
  assert.equal(new Set(cronsActivos.map((c) => c.cron)).size, 20, "hay horarios repetidos");
  const completos = cronsActivos.filter((c) => c.cron.startsWith("7 "));
  assert.deepEqual(completos.map((c) => c.cron), ["7 5 * * *", "7 17 * * *"]);
  assert.equal(cronsActivos.filter((c) => c.cron.startsWith("23 ")).length, 18);
});

test("los horarios del modo Cyber NO estan declarados mientras el Cyber este apagado", () => {
  // El `if` que los salta esta a nivel de JOB y la concurrencia a nivel de
  // WORKFLOW: GitHub mete la corrida al grupo ANTES de evaluar el `if`, asi que
  // una corrida del minuto 53 que no va a hacer nada puede desalojar de la
  // ranura pendiente a una revision liviana de verdad. Encender el Cyber incluye
  // descomentarlos (ver README.md).
  assert.deepEqual(cronsActivos.filter((c) => c.cron.startsWith("53 ")), [], "los horarios del Cyber quedaron activos: se comen la ranura de la cola");
  assert.ok(YML.includes('# - cron: "53 8 * * *"'), "se borraron los horarios del Cyber en vez de dejarlos comentados y listos para usar");
  assert.ok(/if:.*startsWith\(github\.event\.schedule, '53 '\)/.test(YML), "se saco la red de seguridad que salta las corridas del Cyber");
  // Y el operador tiene que enterarse de que encender el Cyber son DOS pasos: si
  // el README sigue diciendo "dos clicks", enciende la variable, no pasa nada, y
  // no tiene como saber por que.
  const readme = readFileSync(path.join(RAIZ, "README.md"), "utf-8");
  assert.ok(readme.includes("borrar el `# ` del principio de las 18 líneas"), "el README no dice que encender el Cyber incluye descomentar los 18 horarios");
});

test("cada comentario de hora de Chile dice la verdad (UTC-3)", () => {
  for (const { cron, horaChile, minutoChile } of cronsActivos) {
    const [minuto, hora] = cron.split(" ");
    assert.notEqual(horaChile, null, `el horario "${cron}" perdio su comentario de hora de Chile`);
    assert.equal(horaChile, (Number(hora) + 24 - 3) % 24, `el comentario de "${cron}" no calza con UTC-3`);
    assert.equal(minutoChile, Number(minuto), `el comentario de "${cron}" no calza en los minutos`);
  }
});

test("una revision lanzada a mano recorre el catalogo COMPLETO salvo que se pida lo contrario", () => {
  // Hasta que existieron los dos modos, "Run workflow" recorria todo. Con
  // `default: liviano`, el operador que aprieta el boton sin tocar el
  // desplegable -- que es lo que hizo siempre -- se llevaria el 21% del catalogo
  // creyendo haber revisado todo.
  const dispatch = YML.slice(YML.indexOf("workflow_dispatch:"), YML.indexOf("concurrency:"));
  assert.match(dispatch, /default: completo/);
  assert.doesNotMatch(dispatch, /default: liviano/);
});

test("la concurrencia sigue a nivel de WORKFLOW y sin cancelar la corrida en curso", () => {
  assert.match(YML, /^concurrency:\n {2}group: monitor-samsung\n {2}cancel-in-progress: false$/m);
});

test("el paso que decide el alcance manda completo en los dos horarios de completo y liviano en el resto", () => {
  // Se ejecuta la misma condicion del bash del workflow contra los 20 horarios.
  const decidir = (cron, manual = "") => {
    if (manual) return manual;
    if (cron === "7 5 * * *" || cron === "7 17 * * *") return "completo";
    return "liviano";
  };
  assert.ok(YML.includes('[ "$CRON" = "7 5 * * *" ] || [ "$CRON" = "7 17 * * *" ]'), "el paso del workflow ya no reconoce los horarios de revision completa");
  const modos = cronsActivos.map((c) => decidir(c.cron));
  assert.equal(modos.filter((m) => m === "completo").length, 2);
  assert.equal(modos.filter((m) => m === "liviano").length, 18);
  assert.equal(decidir("", "completo"), "completo");
  assert.equal(decidir("", "liviano"), "liviano");
});
