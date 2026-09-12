// Pruebas de las REPARACIONES al camino de avisos en vivo (2026-09-11).
//
// Cada test de este archivo corresponde a un defecto reproducido por los
// verificadores. El comentario de arriba de cada uno dice cual era el sintoma
// que veia el operador: si alguna vez hay que revertir algo, ahi esta el costo.
//
// REGLA QUE NO SE NEGOCIA: jamas se le manda un mensaje al webhook real del
// operador. Todo pasa por globalThis.fetch interceptado y una URL falsa.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { crearDespachadorVivo, firmaCambio, repartirCierre, esNotificable } from "../src/despachador-vivo.mjs";
import { comparar } from "../src/comparar.mjs";
import { notifyDiscord, reiniciarRitmo, enviarMensaje } from "../src/discord.mjs";
import { integrarVariantes } from "../src/catalogo.mjs";
import { leerPendientes, serializarPendientes } from "../src/pendientes.mjs";
import { reloj, relojVirtual } from "../src/reloj.mjs";

const WEBHOOK = "https://fake.webhook/no-es-el-real";
const TS = "2026-09-11T12:00:00.000Z";
const URL_BASE = "https://www.samsung.com/cl/producto/";

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

const textoDe = (envios) => envios.map((e) => e.content).join("\n");

function registroPrevio(extra = {}) {
  return {
    modelo: "SM-S931BDBKLTL",
    nombre: "Galaxy S25 256 GB Azul",
    categoria: "Smartphones",
    precio: 899990,
    disponible: true,
    url: `${URL_BASE}s25/`,
    paginaOrigen: `${URL_BASE}s25/`,
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
    modelo: "SM-S931BDBKLTL",
    nombre: "Galaxy S25 256 GB Azul",
    categoria: "Smartphones",
    precio: 899990,
    disponible: true,
    url: `${URL_BASE}s25/`,
    paginaOrigen: `${URL_BASE}s25/`,
    ...extra,
  };
}

function crear(opciones = {}) {
  return crearDespachadorVivo({ webhook: WEBHOOK, timestamp: TS, totalPaginas: 1183, rutaNotificados: null, ...opciones });
}

/** El cierre tal cual lo arma run.mjs, para no probar una version de juguete. */
async function cerrarComoRunMjs(despachador, { previo, observado, corridaConfiable = true, pendientes = [], errores = 0, totalRevisado = 1183 }) {
  const { catalogo, cambios } = comparar({ previo, observado, paginasFallidas: new Set(), corridaConfiable, timestamp: TS });
  const { paraDiscord, suprimidos } = repartirCierre(cambios, despachador);
  const correcciones = despachador.avisosNoRatificados(cambios).map((aviso) => ({ aviso, actual: catalogo[aviso.modelo] }));
  const envio = await notifyDiscord(WEBHOOK, {
    changes: paraDiscord,
    errores,
    totalRevisado,
    avisadosEnVivo: suprimidos,
    correcciones,
    pendientes,
  });
  return { catalogo, cambios, paraDiscord, suprimidos, correcciones, envio };
}

// --- DEFECTO CRITICO: aviso en vivo falso que nadie desmiente ----------------
// Sintoma: el operador recibia "🔥 −$200.000 · −22,2%" a mitad de la revision,
// iba a comprar y el precio era el de siempre. Y como latest.json nunca se
// enteraba del aviso, la corrida siguiente lo volvia a mandar: 7 veces al dia.

test("un aviso en vivo que la revision NO ratifica sale corregido en el cierre", async () => {
  const envios = capturar();
  const previo = { "SM-S931BDBKLTL": registroPrevio({ precio: 899990 }) };

  // pagina 1 (la /buy/ de celulares) publica el S25 a $699.990 -> aviso en vivo
  const observado = { "SM-S931BDBKLTL": observacion({ precio: 699990 }) };
  const d = crear({ previo });
  d.evaluar(observado, ["SM-S931BDBKLTL"], { pagina: 1 });
  await d.cerrar();
  assert.equal(envios.length, 1);
  assert.match(envios[0].content, /ahora: \$699\.990/, "el aviso en vivo salio de verdad");
  const enVivo = envios.length;

  // pagina 6 (linea blanca) vuelve a publicar el MISMO SKU con el precio viejo
  observado["SM-S931BDBKLTL"] = observacion({ precio: 899990 });

  const { cambios, paraDiscord, correcciones } = await cerrarComoRunMjs(d, { previo, observado });
  assert.deepEqual(cambios, [], "comparar() no emite nada: el estado no cambio");
  assert.deepEqual(paraDiscord, []);
  assert.equal(correcciones.length, 1, "el aviso en vivo quedo sin ratificar");

  const cierre = textoDe(envios.slice(enVivo));
  assert.match(cierre, /Correcciones de avisos en vivo/);
  assert.match(cierre, /no se confirmó/);
  assert.match(cierre, /El precio vigente sigue siendo \*\*\$899\.990\*\*/);
  assert.ok(cierre.includes("SM-S931BDBKLTL"), "tiene que decir de que producto habla");
  assert.ok(
    !cierre.includes("Todo lo detectado ya se avisó en vivo"),
    "ese texto convertiria una alerta falsa en una confirmacion",
  );
});

test("un aviso no ratificado por CORRECCION de precio no se desmiente dos veces", async () => {
  // aca la segunda pagina publica OTRO precio, no el viejo: comparar() emite la
  // baja corregida y esa linea YA es la correccion. Una seccion de correcciones
  // ademas seria decir lo mismo dos veces.
  const envios = capturar();
  const previo = { "SM-S931BDBKLTL": registroPrevio({ precio: 899990 }) };
  const observado = { "SM-S931BDBKLTL": observacion({ precio: 699990 }) };

  const d = crear({ previo });
  d.evaluar(observado, ["SM-S931BDBKLTL"], { pagina: 1 });
  await d.cerrar();
  const enVivo = envios.length;

  observado["SM-S931BDBKLTL"] = observacion({ precio: 749990 });
  const { paraDiscord, correcciones } = await cerrarComoRunMjs(d, { previo, observado });

  assert.equal(correcciones.length, 0, "la linea corregida ya es la correccion");
  assert.equal(paraDiscord.length, 1);
  assert.equal(paraDiscord[0].precio, 749990);
  assert.match(textoDe(envios.slice(enVivo)), /ahora: \$749\.990/);
});

test("un aviso en vivo ratificado por la revision NO genera correccion", async () => {
  const envios = capturar();
  const previo = { "SM-S931BDBKLTL": registroPrevio({ precio: 899990 }) };
  const observado = { "SM-S931BDBKLTL": observacion({ precio: 699990 }) };

  const d = crear({ previo });
  d.evaluar(observado, ["SM-S931BDBKLTL"], { pagina: 1 });
  await d.cerrar();
  const enVivo = envios.length;

  const { correcciones, suprimidos } = await cerrarComoRunMjs(d, { previo, observado });
  assert.equal(correcciones.length, 0);
  assert.equal(suprimidos, 1);
  const cierre = textoDe(envios.slice(enVivo));
  assert.match(cierre, /1 cambios \(1 ya avisados en vivo · 0 en este resumen\)/);
  assert.match(cierre, /Todo lo detectado ya se avisó en vivo/);
});

// --- DEFECTO ALTO: un 429 global congelaba el barrido sin tope ---------------
// Sintoma: un ban tipo Cloudflare (retry_after de minutos u horas) detenia el
// bucle de paginas todo ese tiempo, con un job que muere a los 330 min.

test("un 429 global con retry_after enorme no congela la corrida mas que el tope", async () => {
  process.env.DISCORD_PAUSA_MS = "0"; // aislar: solo se mide la pausa global
  const envios = capturar((n) =>
    n === 1
      ? {
          ok: false,
          status: 429,
          json: async () => ({ retry_after: 1800, global: true }), // 30 minutos
          text: async () => "rate limited",
          headers: { get: (h) => (h.toLowerCase() === "x-ratelimit-scope" ? "global" : null) },
        }
      : { ok: true, status: 204 },
  );

  const r1 = await enviarMensaje(WEBHOOK, "primero");
  assert.equal(r1.ok, false, "1800 s pasa el tope de 70 s: este mensaje se rinde");
  await enviarMensaje(WEBHOOK, "segundo");

  const congelado = envios[1].t - envios[0].t;
  assert.ok(congelado <= 75000, `el barrido quedo congelado ${Math.round(congelado / 1000)} s (antes: 1.801 s)`);
  assert.ok(congelado >= 70000, "igual se respeta el tope declarado antes de volver a insistir");
});

test("una cabecera de rate limit con reset-after enorme tampoco congela la corrida", async () => {
  process.env.DISCORD_PAUSA_MS = "0";
  capturar(() => ({
    ok: true,
    status: 204,
    json: async () => ({}),
    text: async () => "",
    headers: {
      get: (h) => {
        const n = h.toLowerCase();
        if (n === "x-ratelimit-remaining") return "0";
        if (n === "x-ratelimit-reset-after") return "900"; // 15 minutos
        return null;
      },
    },
  }));

  const antes = reloj.ahora();
  const r = await enviarMensaje(WEBHOOK, "hola");
  const dormido = reloj.ahora() - antes;
  assert.equal(r.ok, true, "la respuesta fue 204: el mensaje llego");
  assert.ok(dormido <= 75000, `durmio ${Math.round(dormido / 1000)} s tras un envio EXITOSO (antes: 900 s)`);
});

// --- DEFECTO MEDIO: Discord caido toda la corrida = avisos perdidos ----------
// Sintoma: 4 bajas reales detectadas, 0 avisos entregados, latest.json escrito
// igual -> ninguna corrida futura las vuelve a ver. Silencio permanente.

test("lo que Discord nunca acepto queda anotado y sale en la revision siguiente", async () => {
  process.env.DISCORD_REINTENTOS_RED = "0";
  const envios = capturar(() => new Error("getaddrinfo ENOTFOUND discord.com"));
  const previo = { "SM-S931BDBKLTL": registroPrevio({ precio: 899990 }) };
  const observado = { "SM-S931BDBKLTL": observacion({ precio: 699990 }) };

  const d = crear({ previo, activo: false }); // el vivo apagado: todo al cierre
  const { envio } = await cerrarComoRunMjs(d, { previo, observado });

  assert.ok(envios.length > 0, "se intento de verdad");
  assert.equal(envio.fallidos, envio.mensajes, "Discord no acepto nada");
  assert.equal(envio.noEntregados.length, 1, "se sabe exactamente que cambio quedo sin entregar");
  assert.equal(envio.noEntregados[0].modelo, "SM-S931BDBKLTL");

  // ...y la corrida siguiente lo manda, con la fecha original
  const texto = serializarPendientes(envio.noEntregados, TS);
  const recuperados = leerPendientes(texto, { ahora: Date.parse(TS) + 3600 * 1000 });
  assert.equal(recuperados.length, 1);

  const envios2 = capturar();
  const d2 = crear({ previo: {}, activo: false });
  const { envio: envio2 } = await cerrarComoRunMjs(d2, { previo: {}, observado: {}, pendientes: recuperados });
  assert.equal(envio2.fallidos, 0);
  assert.equal(envio2.noEntregados.length, 0, "entregado: deja de estar pendiente");
  const cierre = textoDe(envios2);
  assert.match(cierre, /Avisos atrasados/);
  assert.ok(cierre.includes("SM-S931BDBKLTL"));
  assert.match(cierre, /no se pudo avisar en su momento/);
});

test("un fallo PARCIAL del resumen final solo deja pendiente lo que iba en el mensaje rechazado", async () => {
  // sin esto habria que elegir entre reintentar todo (y duplicar lo que si
  // llego) o no reintentar nada (y perderlo en silencio)
  process.env.DISCORD_REINTENTOS_RED = "0";
  capturar((n) => (n === 1 ? { ok: true, status: 204 } : new Error("socket hang up")));

  const changes = [];
  for (let i = 0; i < 40; i++) {
    changes.push({
      tipo: "baja",
      modelo: `SKU-${i}`,
      nombre: "Smart TV Crystal UHD 55 pulgadas con procesador Crystal 4K",
      categoria: "Televisores",
      precio: 399990,
      precioAnterior: 499990,
      url: `${URL_BASE}${i}/`,
    });
  }
  const r = await notifyDiscord(WEBHOOK, { changes, errores: 0, totalRevisado: 1183 });
  assert.ok(r.mensajes > 1, "40 bajas no caben en un solo mensaje");
  assert.equal(r.fallidos, r.mensajes - 1);
  assert.ok(r.noEntregados.length > 0 && r.noEntregados.length < changes.length, `noEntregados=${r.noEntregados.length} de ${changes.length}`);
  const entregados = changes.filter((c) => !r.noEntregados.includes(c));
  assert.ok(entregados.length > 0, "lo que si llego no se vuelve a mandar");
});

test("un cierre que arrastra avisos atrasados no dice que ya se aviso todo", async () => {
  const envios = capturar();
  const atrasado = { ts: TS, tipo: "baja", modelo: "SM-S931BDBKLTL", nombre: "Galaxy S25 256 GB Azul", categoria: "Smartphones", precio: 699990, precioAnterior: 899990, url: `${URL_BASE}s25/` };
  await notifyDiscord(WEBHOOK, { changes: [], errores: 0, totalRevisado: 1183, avisadosEnVivo: 0, pendientes: [atrasado] });

  assert.equal(envios.length, 1, "el atrasado obliga a mandar el cierre aunque no haya cambios nuevos");
  assert.ok(
    !envios[0].content.includes("Todo lo detectado ya se avisó en vivo"),
    "en esta revision no se aviso nada en vivo: ese texto seria falso",
  );
  assert.match(envios[0].content, /Avisos atrasados/);
});

test("un aviso atrasado caduca a las 48 h en vez de quedar dando vueltas", async () => {
  const viejo = JSON.stringify({ ts: new Date(Date.parse(TS) - 72 * 3600 * 1000).toISOString(), tipo: "baja", modelo: "VIEJO", precio: 1, precioAnterior: 2 });
  const reciente = JSON.stringify({ ts: new Date(Date.parse(TS) - 2 * 3600 * 1000).toISOString(), tipo: "baja", modelo: "RECIENTE", precio: 1, precioAnterior: 2 });
  const vigentes = leerPendientes(`${viejo}\n${reciente}\n{linea rota\n`, { ahora: Date.parse(TS) });
  assert.deepEqual(
    vigentes.map((c) => c.modelo),
    ["RECIENTE"],
  );
  // y la union de git (ver .gitattributes) no puede producir avisos repetidos
  assert.equal(leerPendientes(`${reciente}\n${reciente}\n`, { ahora: Date.parse(TS) }).length, 1);
});

// --- DEFECTO MEDIO: accesorio nuevo visto desde una pagina familia -----------
// Sintoma: el operador recibia en vivo un cargador, que pidio expresamente no
// recibir, y el resumen final lo filtraba bien pero ya era tarde.

test("un SKU NUEVO visto solo desde una pagina familia no se avisa en vivo", async () => {
  const envios = capturar();
  const previo = { "SM-S931BDBKLTL": registroPrevio() }; // catalogo con algo, para que el vivo aplique
  const observado = {
    "ACC-NUEVO": {
      modelo: "ACC-NUEVO",
      nombre: "Cargador rapido 45W",
      // asi llega cuando la primera pagina que lo publica es una /buy/ del
      // sitemap: la categoria real ("Accesorios móviles") todavia no se conoce
      categoria: "Familia (auto-descubierta)",
      precio: 39990,
      disponible: true,
      url: `${URL_BASE}acc/`,
      paginaOrigen: `${URL_BASE}acc/`,
    },
  };

  const d = crear({ previo });
  assert.equal(d.evaluar(observado, ["ACC-NUEVO"], { pagina: 1 }), 0, "sin categoria real no se puede decidir si es accesorio");
  await d.cerrar();
  assert.equal(envios.length, 0);
});

test("un SKU que el catalogo anterior ya tenia como accesorio nunca sale en vivo", async () => {
  const envios = capturar();
  const previo = { ACC: registroPrevio({ modelo: "ACC", categoria: "Accesorios móviles", nombre: "Funda", precio: 20000 }) };
  // esta pagina lo publica bajo otra categoria: igual no se avisa en vivo
  const observado = { ACC: observacion({ modelo: "ACC", categoria: "Smartphones", nombre: "Funda", precio: 10000 }) };

  const d = crear({ previo });
  assert.equal(d.evaluar(observado, ["ACC"], { pagina: 1 }), 0);
  await d.cerrar();
  assert.equal(envios.length, 0);
});

test("postergar un SKU nuevo no lo pierde: sale en el resumen final", async () => {
  const envios = capturar();
  const previo = { "SM-S931BDBKLTL": registroPrevio() };
  const observado = {
    "SM-S931BDBKLTL": observacion(),
    "TV-NUEVO": {
      modelo: "TV-NUEVO",
      nombre: "Smart TV Crystal UHD 55",
      categoria: "Familia (auto-descubierta)",
      precio: 399990,
      disponible: true,
      url: `${URL_BASE}tv/`,
      paginaOrigen: `${URL_BASE}tv/`,
    },
  };

  const d = crear({ previo });
  d.evaluar(observado, Object.keys(observado), { pagina: 1 });
  await d.cerrar();
  assert.equal(envios.length, 0, "en vivo no");

  const { paraDiscord, correcciones } = await cerrarComoRunMjs(d, { previo, observado });
  assert.deepEqual(
    paraDiscord.map((c) => c.modelo),
    ["TV-NUEVO"],
    "en el cierre si: ahi la categoria ya es la definitiva",
  );
  assert.equal(correcciones.length, 0);
});

// --- DEFECTO MEDIO: el cableado de run.mjs no lo cubria ninguna prueba -------
// Se podia borrar la funcionalidad entera (o el filtro de accesorios, o la
// deduplicacion) y la suite quedaba en verde.

test("integrarVariantes marca los SKU que escribio de verdad, y solo esos", async () => {
  const observado = {};
  const entradaPropia = { url: `${URL_BASE}s25/`, categoria: "Smartphones" };
  const entradaFamilia = { url: `${URL_BASE}galaxy-s/buy/`, categoria: "Familia (auto-descubierta)" };

  const escritos1 = [];
  integrarVariantes(observado, entradaPropia, [{ modelo: "SM-S931BDBKLTL", precio: 899990, disponible: true }], { via: "individual", timestamp: TS, escritos: escritos1 });
  assert.deepEqual(escritos1, ["SM-S931BDBKLTL"]);

  const escritos2 = [];
  integrarVariantes(
    observado,
    entradaFamilia,
    [
      // el mismo SKU, pero desde una pagina que vale MENOS: solo enriquece el
      // titulo, no toca precio ni stock -> no se evalua en vivo
      { modelo: "SM-S931BDBKLTL", nombre: "Galaxy S25 256 GB｜12 GB Azul", precio: 1069990, disponible: false },
      { modelo: "SM-S938BZKGLTL", nombre: "Galaxy S25 Ultra 512 GB Negro", precio: 1499990, disponible: true },
    ],
    { via: "familia", timestamp: TS, escritos: escritos2 },
  );
  assert.deepEqual(escritos2, ["SM-S938BZKGLTL"], "el SKU que solo se enriquecio no cuenta como escrito");
  assert.equal(observado["SM-S931BDBKLTL"].precio, 899990, "la ficha propia manda");

  // y ese array es exactamente lo que el despachador recibe
  const envios = capturar();
  const d = crear({ previo: { "SM-S931BDBKLTL": registroPrevio({ precio: 999990 }) } });
  assert.equal(d.evaluar(observado, escritos2, { pagina: 1 }), 0, "el SKU no escrito no se evalua...");
  assert.equal(d.evaluar(observado, escritos1, { pagina: 1 }), 1, "...y el escrito si");
  await d.cerrar();
  assert.match(textoDe(envios), /ahora: \$899\.990/);
});

test("repartirCierre descarta accesorios, silenciados y lo ya confirmado en vivo", () => {
  const cambios = [
    { tipo: "baja", modelo: "OK", categoria: "Televisores", precio: 1, precioAnterior: 2 },
    { tipo: "baja", modelo: "ACC", categoria: "Accesorios móviles", precio: 1, precioAnterior: 2 },
    { tipo: "baja", modelo: "NP750QFG-KB2CL", nombre: "Galaxy Book3 Pro", categoria: "Computadores", precio: 1, precioAnterior: 2 },
    { tipo: "baja", modelo: "YA", categoria: "Televisores", precio: 1, precioAnterior: 2 },
  ];
  const falso = { yaEnviado: (c) => c.modelo === "YA" };
  const { paraDiscord, suprimidos } = repartirCierre(cambios, falso);

  assert.deepEqual(
    paraDiscord.map((c) => c.modelo),
    ["OK"],
  );
  assert.equal(suprimidos, 1, "solo cuenta lo notificable que se omitio por haber salido ya");
  assert.equal(esNotificable(cambios[1]), false);
  assert.equal(esNotificable(cambios[2]), false);
});

// --- DEFECTO BAJO: el cierre subdeclaraba con huellas heredadas --------------
// Sintoma: 3 heredados + 2 nuevos decia "2 cambios"; si TODO era heredado, el
// operador no recibia ningun mensaje de cierre.

test("con huellas heredadas de una corrida muerta el cierre igual se manda y cuenta bien", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "cierre-"));
  const ruta = path.join(dir, "notificados.jsonl");
  const cambio = { tipo: "baja", modelo: "SM-S931BDBKLTL", precio: 699990, precioAnterior: 899990 };
  await writeFile(ruta, JSON.stringify({ ts: new Date().toISOString(), firma: firmaCambio(cambio) }) + "\n");

  const envios = capturar();
  const previo = { "SM-S931BDBKLTL": registroPrevio({ precio: 899990 }) };
  const observado = { "SM-S931BDBKLTL": observacion({ precio: 699990 }) };

  const d = crear({ previo, rutaNotificados: ruta });
  assert.equal(await d.cargarNotificados(), 1);
  assert.equal(d.evaluar(observado, ["SM-S931BDBKLTL"], { pagina: 1 }), 0, "no lo reavisa");
  const stats = await d.cerrar();
  assert.equal(stats.avisados, 0, "esta corrida no confirmo nada: el aviso salio en la anterior");
  assert.equal(envios.length, 0);

  const { suprimidos, correcciones } = await cerrarComoRunMjs(d, { previo, observado });
  assert.equal(suprimidos, 1, "el heredado igual es un cambio de esta corrida");
  assert.equal(correcciones.length, 0, "un heredado no se desmiente: su aviso salio en otra corrida");
  assert.equal(envios.length, 1, "el operador tiene que recibir la senal de que la revision termino");
  assert.match(envios[0].content, /1 cambios \(1 ya avisados en vivo · 0 en este resumen\)/);
});

// --- DEFECTO BAJO: una huella con fecha ilegible silenciaba para siempre -----

test("una huella con ts ilegible caduca en vez de silenciar el aviso para siempre", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "cierre-"));
  const ruta = path.join(dir, "notificados.jsonl");
  const cambio = { tipo: "baja", modelo: "SM-S931BDBKLTL", precio: 699990, precioAnterior: 899990 };
  await writeFile(ruta, JSON.stringify({ ts: "no-es-fecha", firma: firmaCambio(cambio) }) + "\n");

  const envios = capturar();
  const d = crear({ previo: { "SM-S931BDBKLTL": registroPrevio({ precio: 899990 }) }, rutaNotificados: ruta });
  assert.equal(await d.cargarNotificados(), 0, "sin fecha creible la huella no vale");
  d.evaluar({ "SM-S931BDBKLTL": observacion({ precio: 699990 }) }, ["SM-S931BDBKLTL"], { pagina: 1 });
  await d.cerrar();
  assert.equal(envios.length, 1, "un silencio equivocado es peor que un duplicado");
});

// --- DEFECTO BAJO: una variable de entorno VACIA valia cero ------------------
// Sintoma latente: `env: X: ${{ vars.NO_EXISTE }}` deja la variable definida y
// vacia. DISCORD_PAUSA_MS="" apagaba el limitador entero (112 POST en 2 s) y
// VIVO_MAX_CAMBIOS="" mandaba un mensaje por producto.

function maxEnVentana(tiempos, ventanaMs) {
  let max = 0;
  for (let i = 0; i < tiempos.length; i++) {
    let n = 0;
    for (let j = i; j < tiempos.length && tiempos[j] - tiempos[i] < ventanaMs; j++) n += 1;
    if (n > max) max = n;
  }
  return max;
}

test("una variable de entorno definida pero VACIA cae al valor por defecto", async () => {
  process.env.DISCORD_PAUSA_MS = "";
  process.env.VIVO_MAX_CAMBIOS = "";
  const envios = capturar();

  const previo = {};
  const observado = {};
  for (let i = 0; i < 30; i++) {
    previo[`SKU-${i}`] = registroPrevio({ modelo: `SKU-${i}`, precio: 899990, url: `${URL_BASE}${i}/`, paginaOrigen: `${URL_BASE}${i}/` });
    observado[`SKU-${i}`] = observacion({ modelo: `SKU-${i}`, precio: 699990, url: `${URL_BASE}${i}/`, paginaOrigen: `${URL_BASE}${i}/` });
  }
  const d = crear({ previo });
  d.evaluar(observado, Object.keys(observado), { pagina: 1 });
  await d.cerrar();

  assert.equal(envios.length, 5, `30 cambios tienen que caber en 5 tandas de 6, no en 30 mensajes (salieron ${envios.length})`);
  const tiempos = envios.map((e) => e.t);
  assert.ok(maxEnVentana(tiempos, 2000) <= 5, "el limitador de ritmo tiene que seguir encendido");
  // con el limitador apagado los 5 salian en el instante 0 (medido: 112 POST en
  // la misma ventana de 2 s)
  assert.ok(tiempos[tiempos.length - 1] >= 2300, `el ultimo salio en t=${tiempos[tiempos.length - 1]}: el cubo de fichas no esta frenando nada`);
});

// --- DEFECTO BAJO: el drenaje bloqueaba el barrido hasta vaciar la cola ------
// Sintoma: 1.000 cambios detectados en una sola pagina dejaban el bucle de
// paginas parado 428 s.

test("una rafaga no deja el barrido parado: cada llamada manda a lo mas 3 tandas", async () => {
  process.env.VIVO_MAX_CAMBIOS = "2";
  const envios = capturar();
  const previo = {};
  const observado = {};
  for (let i = 0; i < 20; i++) {
    previo[`SKU-${i}`] = registroPrevio({ modelo: `SKU-${i}`, precio: 899990, url: `${URL_BASE}${i}/`, paginaOrigen: `${URL_BASE}${i}/` });
    observado[`SKU-${i}`] = observacion({ modelo: `SKU-${i}`, precio: 699990, url: `${URL_BASE}${i}/`, paginaOrigen: `${URL_BASE}${i}/` });
  }

  const d = crear({ previo });
  assert.equal(d.evaluar(observado, Object.keys(observado), { pagina: 1 }), 20);

  await d.quizasEnviar(); // el hueco de UNA pagina
  assert.equal(envios.length, 3, "3 tandas y devuelve el control al barrido");
  assert.equal(d.pendientes, 14, "el resto sale en los huecos de las paginas siguientes");

  await d.quizasEnviar();
  assert.equal(envios.length, 6);

  // y el cierre vacia todo lo que quede: nada se pierde
  const stats = await d.cerrar();
  assert.equal(stats.avisados, 20);
  assert.equal(d.pendientes, 0);
});
