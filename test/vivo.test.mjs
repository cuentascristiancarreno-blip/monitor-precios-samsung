// Pruebas del camino de avisos EN VIVO (src/despachador-vivo.mjs + el
// transporte robusto de src/discord.mjs).
//
// REGLA QUE NO SE NEGOCIA: jamas se le manda un mensaje al webhook real del
// operador. Todo pasa por globalThis.fetch interceptado y una URL falsa, igual
// que en test/discord.test.mjs.
//
// El tiempo tambien es simulado (src/reloj.mjs): asi se puede verificar el
// ritmo REAL de produccion (una ficha cada 2,3 s) sobre 600 cambios sin que la
// suite duerma tres minutos.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { crearDespachadorVivo, firmaCambio } from "../src/despachador-vivo.mjs";
import { comparar, evaluarObservado } from "../src/comparar.mjs";
import { notifyDiscord, reiniciarRitmo, enviarMensaje } from "../src/discord.mjs";
import { esAccesorio } from "../src/catalogo.mjs";
import { estaSilenciado } from "../src/silenciados.mjs";
import { reloj, relojVirtual } from "../src/reloj.mjs";

const WEBHOOK = "https://fake.webhook/no-es-el-real";
const TS = "2026-09-11T12:00:00.000Z";

let virtual;
let fetchOriginal;

beforeEach(() => {
  fetchOriginal = globalThis.fetch;
  virtual = relojVirtual();
  reiniciarRitmo();
  for (const k of Object.keys(process.env)) if (k.startsWith("VIVO_") || k.startsWith("DISCORD_")) delete process.env[k];
});

afterEach(() => {
  virtual.restaurar();
  globalThis.fetch = fetchOriginal;
});

/** Captura cada POST con el instante (virtual) en que salio. */
function capturar(responder) {
  const envios = [];
  globalThis.fetch = async (url, opts) => {
    assert.equal(url, WEBHOOK, "solo se puede postear al webhook falso de las pruebas");
    const content = JSON.parse(opts.body).content;
    envios.push({ content, t: reloj.ahora() });
    const r = responder ? responder(envios.length, content) : { ok: true, status: 204 };
    if (r instanceof Error) throw r;
    return r;
  };
  return envios;
}

function respuesta429({ retryAfter = 1.5, global = false } = {}) {
  return {
    ok: false,
    status: 429,
    json: async () => ({ retry_after: retryAfter, global, message: "You are being rate limited." }),
    text: async () => "rate limited",
    headers: { get: (n) => (n.toLowerCase() === "x-ratelimit-scope" ? (global ? "global" : "shared") : null) },
  };
}

const URL_BASE = "https://www.samsung.com/cl/producto/";

function registroPrevio(extra = {}) {
  return {
    modelo: "SKU-1",
    nombre: "Smart TV Crystal UHD 55",
    categoria: "Televisores",
    precio: 100000,
    disponible: true,
    url: `${URL_BASE}1/`,
    paginaOrigen: `${URL_BASE}1/`,
    presencia: "activo",
    estadoStock: "disponible",
    stockPendiente: null,
    ausencias: 0,
    notificadoDesaparecido: false,
    ...extra,
  };
}

function observacion(extra = {}) {
  return {
    modelo: "SKU-1",
    nombre: "Smart TV Crystal UHD 55",
    categoria: "Televisores",
    precio: 90000,
    disponible: true,
    url: `${URL_BASE}1/`,
    paginaOrigen: `${URL_BASE}1/`,
    ...extra,
  };
}

function crear(opciones = {}) {
  return crearDespachadorVivo({ webhook: WEBHOOK, timestamp: TS, totalPaginas: 1183, rutaNotificados: null, ...opciones });
}

const textoDe = (envios) => envios.map((e) => e.content).join("\n");

// --- 1. se avisa APENAS se scrapea, sin esperar el final ---------------------

test("un cambio detectado en una pagina se envia durante la corrida, no al final", async () => {
  const envios = capturar();
  const previo = { "SKU-1": registroPrevio() };
  const observado = { "SKU-1": observacion({ precio: 80000 }) };

  const d = crear({ previo });
  const encolados = d.evaluar(observado, ["SKU-1"], { pagina: 640 });
  assert.equal(encolados, 1);

  // todavia no: la ventana no se cumplio y la tanda no esta llena
  await d.quizasEnviar();
  assert.equal(envios.length, 0, "no deberia mandar antes de cumplirse la ventana");

  virtual.avanzar(15001);
  await d.quizasEnviar();

  assert.equal(envios.length, 1, "pasada la ventana tiene que salir sin esperar el final de la corrida");
  const m = envios[0].content;
  assert.match(m, /aviso en curso/, "tiene que quedar claro que la revisión sigue");
  assert.match(m, /revisando página 640 de 1183/, "el avance del barrido ayuda en Cyber");
  assert.match(m, /📺 \*\*Smart TV Crystal UHD 55\*\* \(SKU-1\)/, "icono por categoria, titulo y SKU");
  assert.match(m, /\$100\.000 → \*\*ahora: \$80\.000\*\*/, "precio antes y despues");
  assert.match(m, /−\$20\.000 · −20\.0%/, "diferencia en pesos y en porcentaje");
  assert.match(m, /🔥/, "una baja de 20% se marca como oportunidad");
  assert.ok(m.includes(`${URL_BASE}1/`), "el link tiene que ir");
});

test("una tanda llena sale al instante, sin esperar la ventana", async () => {
  const envios = capturar();
  process.env.VIVO_MAX_CAMBIOS = "3";
  const previo = {};
  const observado = {};
  for (let i = 0; i < 3; i++) {
    previo[`SKU-${i}`] = registroPrevio({ modelo: `SKU-${i}`, precio: 100000 });
    observado[`SKU-${i}`] = observacion({ modelo: `SKU-${i}`, precio: 95000 });
  }
  const d = crear({ previo });
  d.evaluar(observado, Object.keys(observado), { pagina: 1 });
  await d.quizasEnviar(); // sin avanzar el reloj

  assert.equal(envios.length, 1);
  for (let i = 0; i < 3; i++) assert.ok(envios[0].content.includes(`SKU-${i}`));
});

test("los cinco tipos en vivo se detectan apenas se observa la pagina", async () => {
  const envios = capturar();
  const previo = {
    NUEVOPRECIO: registroPrevio({ modelo: "NUEVOPRECIO", precio: null }),
    BAJA: registroPrevio({ modelo: "BAJA", precio: 200000 }),
    SUBE: registroPrevio({ modelo: "SUBE", precio: 100000 }),
    STOCK: registroPrevio({ modelo: "STOCK", estadoStock: "agotado", stockPendiente: "disponible", disponible: false }),
    RECU: registroPrevio({ modelo: "RECU", notificadoDesaparecido: true }),
  };
  const observado = {
    NUEVOPRECIO: observacion({ modelo: "NUEVOPRECIO", precio: 50000 }),
    BAJA: observacion({ modelo: "BAJA", precio: 150000 }),
    SUBE: observacion({ modelo: "SUBE", precio: 130000 }),
    STOCK: observacion({ modelo: "STOCK", precio: 100000, disponible: true }),
    RECU: observacion({ modelo: "RECU", precio: 100000 }),
  };
  const d = crear({ previo });
  d.evaluar(observado, Object.keys(observado), { pagina: 2 });
  await d.cerrar();

  const texto = textoDe(envios);
  for (const sku of Object.keys(previo)) assert.ok(texto.includes(sku), `falta el aviso en vivo de ${sku}`);
  assert.equal(d.stats().avisados, 5);
});

// --- 2. accesorios y Book3 NO salen en vivo ----------------------------------

test("accesorios y Galaxy Book3 no se avisan en vivo", async () => {
  const envios = capturar();
  const previo = {
    ACC: registroPrevio({ modelo: "ACC", categoria: "Accesorios móviles", nombre: "Funda", precio: 20000 }),
    BOOK: registroPrevio({ modelo: "NP750QFG-KB2CL", categoria: "Computadores", nombre: "Galaxy Book3 Pro 360", precio: 900000 }),
    OK: registroPrevio({ modelo: "OK", precio: 100000 }),
  };
  const observado = {
    ACC: observacion({ modelo: "ACC", categoria: "Accesorios móviles", nombre: "Funda", precio: 10000 }),
    BOOK: observacion({ modelo: "NP750QFG-KB2CL", categoria: "Computadores", nombre: "Galaxy Book3 Pro 360", precio: 700000 }),
    OK: observacion({ modelo: "OK", precio: 90000 }),
  };

  const d = crear({ previo });
  const encolados = d.evaluar(observado, Object.keys(observado), { pagina: 1 });
  await d.cerrar();

  assert.equal(encolados, 1, "solo el producto no filtrado se encola");
  const texto = textoDe(envios);
  assert.ok(!texto.includes("Funda"), "un accesorio jamas puede salir en vivo");
  assert.ok(!texto.includes("Book3"), "Book3 esta silenciado por pedido expreso del operador");
  assert.ok(texto.includes("(OK)"));
});

test("un accesorio visto desde una pagina familia tampoco se cuela", async () => {
  // trampa real: obs.categoria es "Familia (auto-descubierta)" y esAccesorio()
  // daria false; solo la categoria resuelta contra el registro anterior lo
  // delata. Por eso el filtro se aplica sobre el cambio ya armado.
  const envios = capturar();
  const previo = { ACC: registroPrevio({ modelo: "ACC", categoria: "Accesorios móviles", nombre: "Cargador", precio: 20000 }) };
  const observado = { ACC: observacion({ modelo: "ACC", categoria: "Familia (auto-descubierta)", nombre: "Cargador", precio: 15000 }) };

  const d = crear({ previo });
  assert.equal(d.evaluar(observado, ["ACC"], { pagina: 1 }), 0);
  await d.cerrar();
  assert.equal(envios.length, 0);
});

// --- 3. el envio final no repite lo ya enviado en vivo -----------------------

test("el resumen final no repite lo ya avisado en vivo, y lo declara", async () => {
  const envios = capturar();
  const previo = {
    "SKU-1": registroPrevio({ modelo: "SKU-1", precio: 100000 }),
    "SKU-2": registroPrevio({ modelo: "SKU-2", precio: 100000 }),
  };
  const observado = {
    "SKU-1": observacion({ modelo: "SKU-1", precio: 90000 }),
    "SKU-2": observacion({ modelo: "SKU-2", precio: 120000 }),
  };

  const d = crear({ previo });
  d.evaluar(observado, Object.keys(observado), { pagina: 1 });
  const stats = await d.cerrar();
  const enviadosEnVivo = envios.length;
  assert.equal(stats.avisados, 2);

  // ...y ahora el cierre, exactamente como lo hace run.mjs
  const { cambios } = comparar({ previo, observado, paginasFallidas: new Set(), corridaConfiable: true, timestamp: TS });
  const restantes = cambios.filter((c) => !esAccesorio(c.categoria) && !estaSilenciado(c) && !d.yaEnviado(c));
  assert.deepEqual(restantes, [], "no puede quedar nada repetido para el final");

  await notifyDiscord(WEBHOOK, { changes: restantes, errores: 0, totalRevisado: 1183, avisadosEnVivo: stats.avisados });
  const cierre = envios.slice(enviadosEnVivo);
  assert.equal(cierre.length, 1, "el cierre igual se manda: es la senal de que la revision termino");
  assert.match(cierre[0].content, /2 cambios \(2 ya avisados en vivo · 0 en este resumen\)/);
  assert.ok(!cierre[0].content.includes("SKU-1"), "no se repite el producto");
});

test("un cambio que NO se pudo confirmar en vivo vuelve a salir en el resumen final", async () => {
  const envios = capturar(() => ({ ok: false, status: 500, text: async () => "boom", headers: { get: () => null } }));
  process.env.DISCORD_REINTENTOS_RED = "1";
  const previo = { "SKU-1": registroPrevio({ precio: 100000 }) };
  const observado = { "SKU-1": observacion({ precio: 90000 }) };

  const d = crear({ previo });
  d.evaluar(observado, ["SKU-1"], { pagina: 1 });
  const stats = await d.cerrar();

  assert.equal(stats.avisados, 0, "sin 2xx no hay huella confirmada");
  assert.ok(envios.length > 0, "se intento de verdad");

  const { cambios } = comparar({ previo, observado, paginasFallidas: new Set(), corridaConfiable: true, timestamp: TS });
  const restantes = cambios.filter((c) => !d.yaEnviado(c));
  assert.equal(restantes.length, 1, "lo que no se confirmo tiene que volver a salir al final");
});

test("un SKU re-emitido con otro precio en la misma corrida se corrige al final", async () => {
  // pasa de verdad: un SKU que aparece en su pagina individual y tambien en una
  // pagina multiproducto (RS60T5200B1/ZS, QN50LS03FAGXZS, SM-S931BDBKLTL)
  const envios = capturar();
  const previo = { "SKU-1": registroPrevio({ precio: 100000 }) };
  const observado = { "SKU-1": observacion({ precio: 90000 }) };

  const d = crear({ previo });
  d.evaluar(observado, ["SKU-1"], { pagina: 1 });
  await d.cerrar();
  assert.equal(envios.length, 1);

  observado["SKU-1"] = observacion({ precio: 85000 }); // la segunda pagina pisa
  const { cambios } = comparar({ previo, observado, paginasFallidas: new Set(), corridaConfiable: true, timestamp: TS });
  const restantes = cambios.filter((c) => !d.yaEnviado(c));
  assert.equal(restantes.length, 1, "el valor corregido tiene que llegar: comparar() es la autoridad");
  assert.equal(restantes[0].precio, 85000);
});

// --- 4. 600 cambios: ni se pasa del limite de Discord ni se pierde ninguno ----

function maxEnVentana(tiempos, ventanaMs) {
  let max = 0;
  for (let i = 0; i < tiempos.length; i++) {
    let n = 0;
    for (let j = i; j < tiempos.length && tiempos[j] - tiempos[i] < ventanaMs; j++) n += 1;
    if (n > max) max = n;
  }
  return max;
}

test("600 cambios de golpe: ninguno se pierde y no se pasa del limite de Discord", async () => {
  const envios = capturar();
  const previo = {};
  const observado = {};
  for (let i = 0; i < 600; i++) {
    const sku = `SM-S948BZDJLT${i}`;
    previo[sku] = registroPrevio({
      modelo: sku,
      nombre: "Lavadora Secadora 14Kg / 9Kg Bespoke AI con Estación de Limpieza Steam",
      categoria: "Lavado y secado",
      precio: 1199990,
      url: `${URL_BASE}${i}/`,
      paginaOrigen: `${URL_BASE}${i}/`,
    });
    observado[sku] = observacion({
      modelo: sku,
      nombre: "Lavadora Secadora 14Kg / 9Kg Bespoke AI con Estación de Limpieza Steam",
      categoria: "Lavado y secado",
      precio: 999990,
      url: `${URL_BASE}${i}/`,
      paginaOrigen: `${URL_BASE}${i}/`,
    });
  }

  const d = crear({ previo });
  assert.equal(d.evaluar(observado, Object.keys(observado), { pagina: 1 }), 600);
  const stats = await d.cerrar();

  // nada perdido
  assert.equal(stats.avisados, 600, "los 600 tienen que quedar confirmados");
  const texto = textoDe(envios);
  for (let i = 0; i < 600; i++) assert.ok(texto.includes(`SM-S948BZDJLT${i}`), `se perdio el cambio ${i}`);

  // ningun mensaje por encima del tope duro de Discord
  for (const e of envios) assert.ok(e.content.length <= 2000, `mensaje de ${e.content.length} caracteres`);

  // ritmo: cubo de rafaga (5 cada 2 s) y techo sostenido (~30 cada 60 s)
  const tiempos = envios.map((e) => e.t);
  assert.ok(maxEnVentana(tiempos, 2000) <= 5, `rafaga: ${maxEnVentana(tiempos, 2000)} POST en 2 s`);
  assert.ok(maxEnVentana(tiempos, 60000) <= 30, `sostenido: ${maxEnVentana(tiempos, 60000)} POST en 60 s`);

  // y sigue siendo util: el ultimo aviso no llega 40 minutos tarde
  const ultimo = tiempos[tiempos.length - 1];
  assert.ok(ultimo < 6 * 60 * 1000, `el ultimo aviso tardo ${Math.round(ultimo / 1000)} s`);
});

// --- 5. 429 ------------------------------------------------------------------

test("un 429 con retry_after se respeta y el mensaje se reintenta, no se pierde", async () => {
  let primera = true;
  const envios = capturar(() => {
    if (primera) {
      primera = false;
      return respuesta429({ retryAfter: 1.5 });
    }
    return { ok: true, status: 204 };
  });

  const previo = { "SKU-1": registroPrevio({ precio: 100000 }) };
  const observado = { "SKU-1": observacion({ precio: 90000 }) };
  const d = crear({ previo });
  d.evaluar(observado, ["SKU-1"], { pagina: 1 });
  const stats = await d.cerrar();

  assert.equal(envios.length, 2, "el mismo mensaje se reintenta una vez");
  assert.equal(envios[0].content, envios[1].content);
  assert.ok(envios[1].t - envios[0].t >= 1500, `no espero el retry_after: ${envios[1].t - envios[0].t} ms`);
  assert.equal(stats.avisados, 1, "tras el 2xx el aviso cuenta como enviado");
  assert.ok(d.yaEnviado({ tipo: "baja", modelo: "SKU-1", precio: 90000, precioAnterior: 100000 }));
});

test("un 429 global frena toda la cola, no solo ese mensaje", async () => {
  process.env.VIVO_MAX_CAMBIOS = "1";
  let n = 0;
  const envios = capturar(() => {
    n += 1;
    return n === 1 ? respuesta429({ retryAfter: 3, global: true }) : { ok: true, status: 204 };
  });

  const previo = {};
  const observado = {};
  for (let i = 0; i < 3; i++) {
    previo[`SKU-${i}`] = registroPrevio({ modelo: `SKU-${i}`, precio: 100000 });
    observado[`SKU-${i}`] = observacion({ modelo: `SKU-${i}`, precio: 90000 });
  }
  const d = crear({ previo });
  d.evaluar(observado, Object.keys(observado), { pagina: 1 });
  await d.cerrar();

  assert.equal(d.stats().avisados, 3, "los tres terminan avisados");
  const tiempos = envios.map((e) => e.t);
  assert.ok(tiempos[1] - tiempos[0] >= 3000, "la pausa global aplica a los mensajes siguientes");
});

test("un 429 eterno no cuelga la corrida: se rinde y lo deja para el final", async () => {
  process.env.DISCORD_REINTENTOS_429 = "2";
  const envios = capturar(() => respuesta429({ retryAfter: 2 }));
  const previo = { "SKU-1": registroPrevio({ precio: 100000 }) };
  const observado = { "SKU-1": observacion({ precio: 90000 }) };

  const d = crear({ previo });
  d.evaluar(observado, ["SKU-1"], { pagina: 1 });
  const stats = await d.cerrar();

  assert.equal(envios.length, 3, "2 reintentos y se rinde");
  assert.equal(stats.avisados, 0);
  assert.equal(d.yaEnviado({ tipo: "baja", modelo: "SKU-1", precio: 90000, precioAnterior: 100000 }), false);
});

// --- 6. un fallo de Discord no puede abortar la revision ---------------------

test("si el fetch a Discord es RECHAZADO, la corrida sigue (no se propaga)", async () => {
  process.env.DISCORD_REINTENTOS_RED = "2";
  const envios = capturar(() => new Error("getaddrinfo ENOTFOUND discord.com"));
  const previo = { "SKU-1": registroPrevio({ precio: 100000 }) };
  const observado = { "SKU-1": observacion({ precio: 90000 }) };

  const d = crear({ previo });
  d.evaluar(observado, ["SKU-1"], { pagina: 1 });

  // lo importante: esto resuelve, no rechaza
  const stats = await d.cerrar();
  assert.equal(stats.avisados, 0);
  assert.equal(envios.length, 3, "reintenta con backoff y se rinde");

  // y el cambio no se pierde: llega en el resumen final
  const { cambios } = comparar({ previo, observado, paginasFallidas: new Set(), corridaConfiable: true, timestamp: TS });
  assert.equal(cambios.filter((c) => !d.yaEnviado(c)).length, 1);
});

test("enviarMensaje nunca lanza, ni con un webhook muerto (404)", async () => {
  capturar(() => ({ ok: false, status: 404, text: async () => "Unknown Webhook", headers: { get: () => null } }));
  const r = await enviarMensaje(WEBHOOK, "hola");
  assert.equal(r.ok, false);
  assert.equal(r.permanente, true);
});

test("un 404 apaga el camino en vivo en vez de insistir contra un webhook muerto", async () => {
  const envios = capturar(() => ({ ok: false, status: 404, text: async () => "Unknown Webhook", headers: { get: () => null } }));
  process.env.VIVO_MAX_CAMBIOS = "1";
  const previo = {};
  const observado = {};
  for (let i = 0; i < 5; i++) {
    previo[`SKU-${i}`] = registroPrevio({ modelo: `SKU-${i}`, precio: 100000 });
    observado[`SKU-${i}`] = observacion({ modelo: `SKU-${i}`, precio: 90000 });
  }
  const d = crear({ previo });
  d.evaluar(observado, Object.keys(observado), { pagina: 1 });
  await d.cerrar();

  assert.equal(envios.length, 1, "un webhook muerto no se reintenta 5 veces");
  assert.equal(d.habilitado, false);
  assert.equal(d.stats().apagadoPor, "webhook-permanente");
});

// --- 7. "desaparecido" solo al final ----------------------------------------

test("los desaparecidos no salen en vivo: solo los puede decidir el cierre", async () => {
  const envios = capturar();
  const previo = {
    "SKU-1": registroPrevio({ modelo: "SKU-1", precio: 100000 }),
    IDO: registroPrevio({ modelo: "IDO", nombre: "Producto que se fue", ausencias: 1, url: `${URL_BASE}ido/`, paginaOrigen: `${URL_BASE}ido/` }),
  };
  const observado = { "SKU-1": observacion({ modelo: "SKU-1", precio: 90000 }) };

  const d = crear({ previo });
  d.evaluar(observado, ["SKU-1"], { pagina: 1 });
  const stats = await d.cerrar();
  const enVivo = textoDe(envios);
  assert.ok(!enVivo.includes("IDO"), "en vivo no se sabe si un producto desaparecio de TODA la corrida");

  const { cambios } = comparar({ previo, observado, paginasFallidas: new Set(), corridaConfiable: true, timestamp: TS });
  const restantes = cambios.filter((c) => !d.yaEnviado(c));
  assert.deepEqual(
    restantes.map((c) => c.tipo),
    ["desaparecido"],
  );

  const antes = envios.length;
  await notifyDiscord(WEBHOOK, { changes: restantes, errores: 0, totalRevisado: 1183, avisadosEnVivo: stats.avisados });
  const cierre = textoDe(envios.slice(antes));
  assert.match(cierre, /Ya no aparece en el sitio/);
  assert.ok(cierre.includes("(IDO)"));
});

test("una corrida no confiable no emite desaparecidos, y lo avisado en vivo sigue valiendo", async () => {
  const envios = capturar();
  const previo = {
    "SKU-1": registroPrevio({ modelo: "SKU-1", precio: 100000 }),
    IDO: registroPrevio({ modelo: "IDO", ausencias: 1 }),
  };
  const observado = { "SKU-1": observacion({ modelo: "SKU-1", precio: 90000 }) };

  const d = crear({ previo });
  d.evaluar(observado, ["SKU-1"], { pagina: 1 });
  await d.cerrar();
  assert.equal(d.stats().avisados, 1, "la baja de precio se avisa igual: es una observacion real");

  const { cambios } = comparar({ previo, observado, paginasFallidas: new Set(), corridaConfiable: false, timestamp: TS });
  assert.equal(cambios.filter((c) => c.tipo === "desaparecido").length, 0);
  assert.ok(textoDe(envios).includes("SKU-1"));
});

// --- 8. corrida que muere a mitad: sin duplicados en la siguiente ------------

test("una corrida que murio a mitad no hace que la siguiente reavise lo mismo", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "vivo-"));
  const ruta = path.join(dir, "notificados.jsonl");
  capturar();

  const previo = { "SKU-1": registroPrevio({ precio: 100000 }) };
  const observado = { "SKU-1": observacion({ precio: 90000 }) };

  // corrida 1: avisa en vivo y "muere" (nunca escribe latest.json)
  const d1 = crear({ previo, rutaNotificados: ruta });
  await d1.cargarNotificados();
  d1.evaluar(observado, ["SKU-1"], { pagina: 1 });
  await d1.cerrar();
  assert.equal(d1.stats().avisados, 1);
  // Lo que hace util a la huella es que lleva tipo, SKU y los DOS precios: por
  // eso distingue una correccion de un duplicado. Esa parte se sigue fijando
  // literal. Los campos de stock que van detras cambiaron el 2026-09-11 (se
  // sumaron `estadoAnterior`/`estado`, porque "agotado" y "no-a-la-venta"
  // comparten el booleano false), asi que el formato completo se compara contra
  // firmaCambio en vez de copiarlo a mano y volver a romperse al proximo campo.
  const lineaHuella = await readFile(ruta, "utf-8");
  assert.match(lineaHuella, /"firma":"baja\|SKU-1\|100000\|90000\|/);
  assert.equal(
    JSON.parse(lineaHuella.trim()).firma,
    firmaCambio({ tipo: "baja", modelo: "SKU-1", precioAnterior: 100000, precio: 90000 }),
  );

  // corrida 2: arranca con el MISMO previo (el estado nunca se guardo)
  const envios2 = [];
  globalThis.fetch = async (url, opts) => {
    envios2.push(JSON.parse(opts.body).content);
    return { ok: true, status: 204 };
  };
  const d2 = crear({ previo, rutaNotificados: ruta });
  assert.equal(await d2.cargarNotificados(), 1, "hereda la huella de la corrida muerta");
  assert.equal(d2.evaluar(observado, ["SKU-1"], { pagina: 1 }), 0, "no lo vuelve a encolar");
  await d2.cerrar();
  assert.equal(envios2.length, 0);

  // y el cierre de la corrida 2 tampoco lo repite
  const { cambios } = comparar({ previo, observado, paginasFallidas: new Set(), corridaConfiable: true, timestamp: TS });
  assert.deepEqual(cambios.filter((c) => !d2.yaEnviado(c)), []);
});

test("una huella vieja no silencia un cambio legitimo", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "vivo-"));
  const ruta = path.join(dir, "notificados.jsonl");
  const viejo = new Date(Date.now() - 20 * 3600 * 1000).toISOString();
  const cambio = { tipo: "baja", modelo: "SKU-1", precio: 90000, precioAnterior: 100000 };
  await writeFile(ruta, JSON.stringify({ ts: viejo, firma: firmaCambio(cambio) }) + "\nlinea a medio escribir{\n");

  const envios = capturar();
  const d = crear({ previo: { "SKU-1": registroPrevio({ precio: 100000 }) }, rutaNotificados: ruta });
  assert.equal(await d.cargarNotificados(), 0, "mas de 8 horas: se ignora");
  d.evaluar({ "SKU-1": observacion({ precio: 90000 }) }, ["SKU-1"], { pagina: 1 });
  await d.cerrar();
  assert.equal(envios.length, 1, "un silencio equivocado es peor que un duplicado");
});

// --- 9. el vivo y el cierre no pueden divergir -------------------------------

test("evaluarObservado produce exactamente los mismos cambios que comparar()", async () => {
  const previo = {
    A: registroPrevio({ modelo: "A", precio: 100000 }),
    B: registroPrevio({ modelo: "B", precio: null }),
    C: registroPrevio({ modelo: "C", estadoStock: "disponible", stockPendiente: "agotado", disponible: true }),
    D: registroPrevio({ modelo: "D", notificadoDesaparecido: true, precio: 100000 }),
  };
  const observado = {
    A: observacion({ modelo: "A", precio: 120000 }),
    B: observacion({ modelo: "B", precio: 50000 }),
    C: observacion({ modelo: "C", precio: 100000, disponible: false }),
    D: observacion({ modelo: "D", precio: 80000 }),
  };

  const { cambios } = comparar({ previo, observado, paginasFallidas: new Set(), corridaConfiable: true, timestamp: TS });
  const porSku = [];
  for (const modelo of Object.keys(observado)) {
    porSku.push(...evaluarObservado({ modelo, ant: previo[modelo], obs: observado[modelo], timestamp: TS }).cambios);
  }
  assert.deepEqual(porSku, cambios, "una sola implementacion de 'que cambio' para los dos caminos");

  // el caso del reclamo: recuperado + baja en la misma corrida para el mismo SKU
  const deD = cambios.filter((c) => c.modelo === "D").map((c) => c.tipo);
  assert.deepEqual(deD, ["recuperado", "baja"]);
});

test("el despachador no toca previo ni observado", async () => {
  capturar();
  const previo = { "SKU-1": registroPrevio({ precio: 100000, stockPendiente: "agotado" }) };
  const observado = { "SKU-1": observacion({ precio: 90000, disponible: false }) };
  const copiaPrevio = structuredClone(previo);
  const copiaObservado = structuredClone(observado);

  const d = crear({ previo });
  d.evaluar(observado, ["SKU-1"], { pagina: 1 });
  await d.cerrar();

  assert.deepEqual(previo, copiaPrevio, "previo es de solo lectura: si no, se rompe la regla de stock");
  assert.deepEqual(observado, copiaObservado);
});

test("VIVO=0 apaga el camino en vivo y todo queda para el final", async () => {
  const envios = capturar();
  const previo = { "SKU-1": registroPrevio({ precio: 100000 }) };
  const observado = { "SKU-1": observacion({ precio: 90000 }) };

  const d = crear({ previo, activo: false });
  assert.equal(d.evaluar(observado, ["SKU-1"], { pagina: 1 }), 0);
  await d.cerrar();
  assert.equal(envios.length, 0);

  const { cambios } = comparar({ previo, observado, paginasFallidas: new Set(), corridaConfiable: true, timestamp: TS });
  assert.equal(cambios.filter((c) => !d.yaEnviado(c)).length, 1);
});

// --- 11. la huella distingue los 4 estados, no solo el booleano --------------
//
// Defecto 6 de la revision del 2026-09-11: los dos campos que se le agregaron a
// firmaCambio (`estadoAnterior` y `estado`) no los cubria ninguna prueba -- la
// unica que los rozaba se comparaba contra firmaCambio, o sea contra si misma.
// Se podian borrar y la suite seguia verde. Sin ellos, "agotado" y
// "no está a la venta" comparten disponible:false, asi que un SKU que va de uno
// al otro y vuelve produce DOS VECES la misma huella y el segundo aviso se
// pierde por deduplicacion dentro de la ventana de 8 h.

function cambioStock(estadoAnterior, estado) {
  return {
    tipo: "stock",
    modelo: "SKU-1",
    precio: 100000,
    categoria: "Televisores",
    url: "https://example.com/p",
    estadoAnterior,
    estado,
    disponible: estado === "disponible",
    disponibleAnterior: estadoAnterior === "disponible",
  };
}

test("agotado->no-a-la-venta y no-a-la-venta->agotado NO comparten huella", () => {
  const ida = cambioStock("agotado", "no-a-la-venta");
  const vuelta = cambioStock("no-a-la-venta", "agotado");
  // los dos tienen disponible:false y disponibleAnterior:false: sin los campos
  // de estado serian el mismo string
  assert.equal(ida.disponible, vuelta.disponible);
  assert.equal(ida.disponibleAnterior, vuelta.disponibleAnterior);
  assert.notEqual(firmaCambio(ida), firmaCambio(vuelta), "los 4 estados tienen que entrar en la huella");
});

test("y por eso el de vuelta NO se da por avisado (la deduplicacion los distingue)", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "vivo-huella-"));
  const ruta = path.join(dir, "notificados.jsonl");
  capturar();

  const ida = cambioStock("agotado", "no-a-la-venta");
  const vuelta = cambioStock("no-a-la-venta", "agotado");

  // la corrida anterior dejo anotado que la IDA ya salio en vivo
  await writeFile(ruta, JSON.stringify({ ts: new Date().toISOString(), firma: firmaCambio(ida), sku: "SKU-1", tipo: "stock" }) + "\n");

  const d = crear({ previo: {}, rutaNotificados: ruta });
  assert.equal(await d.cargarNotificados(), 1);
  assert.equal(d.yaEnviado(ida), true, "la ida ya se aviso: no se repite");
  assert.equal(
    d.yaEnviado(vuelta),
    false,
    "la vuelta es un cambio DISTINTO; sin estadoAnterior/estado en la huella quedaria silenciada",
  );
});
