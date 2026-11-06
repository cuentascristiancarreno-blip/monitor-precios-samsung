// UNA NOTIFICACION POR AVISO EN EL CELULAR (ntfy) — pedido del operador 2026-11-06.
//
// REGLAS QUE NO SE NEGOCIAN EN ESTE ARCHIVO, y son dos porque ahora hay dos
// canales que se pueden tocar por error:
//   - jamas se le manda un mensaje al webhook REAL de Discord;
//   - jamas se publica en un tema REAL de ntfy. Todo pasa por globalThis.fetch
//     interceptado, con un servidor de mentira en 127.0.0.1 y un tema inventado
//     que no existe en ninguna parte.
// La ultima prueba del archivo revisa, ademas, que ningun archivo del repo
// contenga algo con forma de tema real.
//
// LO QUE ESTAS PRUEBAS DEFIENDEN, en orden de importancia:
//   1. UNA notificacion por baja, no una por mensaje de Discord (Discord agrupa
//      hasta 6 cambios; el celular no puede agrupar ninguno: es el pedido).
//   2. Lo que el filtro del operador bloquea NO se escapa por este camino nuevo
//      -- seria el agujero que tuvo data/pendientes.jsonl y se tapo el
//      2026-10-14.
//   3. Una baja avisada en vivo NO se vuelve a notificar en el cierre.
//   4. ntfy no puede romper una revision: ni caido, ni lento, ni con 280 avisos.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  avisadorDelEntorno,
  avisoDeCambio,
  avisoDeCorreccion,
  avisoDeTopeAlCruzar,
  avisoDeTopeFinal,
  avisoTecnico,
  cerrarCorridaNtfy,
  crearAvisadorNtfy,
  publicar,
  temaDelEntorno,
  POR_DEFECTO,
  PRIORIDAD_BAJA,
  PRIORIDAD_CORRECCION,
  PRIORIDAD_TECNICA,
  SERVIDOR_POR_DEFECTO,
} from "../src/ntfy.mjs";
import { fijarDestinoNtfy, notifyDiscord, notifyTecnico, reiniciarRitmo } from "../src/discord.mjs";
import { enviarTandaVivo } from "../src/discord.mjs";
import { esNotificable, esParaCelular, esParaVivo, pendientesParaAvisar, repartirCierre } from "../src/despachador-vivo.mjs";

const WEBHOOK = "https://fake.webhook/no-es-el-real";
// Un servidor que no existe y un tema inventado: si alguna prueba llegara a
// salir a la red de verdad, se cae sola en vez de publicar en algun lado.
const SERVIDOR = "http://127.0.0.1:9/no-es-ntfy-de-verdad";
const TEMA = "tema-de-prueba-que-no-existe";

// El contenido de los mensajes, no el ritmo: sin esto el cubo de fichas de
// Discord (una cada 2,3 s) haria dormir la suite de verdad. El ritmo se verifica
// en test/vivo.test.mjs con reloj virtual.
process.env.DISCORD_PAUSA_MS = "0";

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

let fetchOriginal;

beforeEach(() => {
  fetchOriginal = globalThis.fetch;
  reiniciarRitmo();
  fijarDestinoNtfy(null);
  for (const k of Object.keys(process.env)) if (k.startsWith("NTFY_")) delete process.env[k];
});

afterEach(() => {
  globalThis.fetch = fetchOriginal;
  fijarDestinoNtfy(null);
  for (const k of Object.keys(process.env)) if (k.startsWith("NTFY_")) delete process.env[k];
});

/**
 * Captura los POST de los dos canales por separado.
 * @param respuestaNtfy que contesta el servidor de ntfy (por numero de llamada)
 */
function capturar({ respuestaNtfy } = {}) {
  const discord = [];
  const ntfy = [];
  globalThis.fetch = async (url, opts) => {
    if (url === WEBHOOK) {
      discord.push(JSON.parse(opts.body).content);
      return { ok: true, status: 204 };
    }
    assert.equal(url, SERVIDOR, `solo se puede postear al webhook y al ntfy de mentira (llego a ${url})`);
    ntfy.push({ url, cuerpo: JSON.parse(opts.body), signal: opts.signal });
    const r = respuestaNtfy ? respuestaNtfy(ntfy.length, JSON.parse(opts.body)) : { ok: true, status: 200 };
    if (r instanceof Error) throw r;
    return r;
  };
  return { discord, ntfy };
}

/** El avisador de las pruebas: tema inventado, servidor de mentira. */
function avisador(opciones = {}) {
  const a = crearAvisadorNtfy({ tema: TEMA, servidor: SERVIDOR, log: { error() {}, log() {} }, ...opciones });
  fijarDestinoNtfy(a);
  return a;
}

/** Una baja real de la semana que midio el operador (los Galaxy Buds4, 2026-10-11). */
function baja(extra = {}) {
  return {
    tipo: "baja",
    modelo: "SM-R540NZKACHO",
    nombre: "Galaxy Buds4 · Negro",
    categoria: "Audio y Galaxy Buds",
    precioAnterior: 199990,
    precio: 139990,
    url: "https://www.samsung.com/cl/audio-sound/galaxy-buds/galaxy-buds4-black-sm-r540nzkacho/",
    ...extra,
  };
}

function bajas(n) {
  return Array.from({ length: n }, (_, i) =>
    baja({ modelo: `SKU-${i}`, nombre: `Producto numero ${i}`, precio: 139990 - i, url: `https://x/${i}` }),
  );
}

// ---------------------------------------------------------------------------
// 1. EL TEMA: ES UN SECRETO Y SE LEE COMO SE LEEN LOS NUMEROS DEL ENTORNO
// ---------------------------------------------------------------------------

test("sin NTFY_TEMA no hay tema, y una variable VACIA tampoco cuenta", () => {
  assert.equal(temaDelEntorno({}), null, "sin la variable no puede haber tema");
  // LA TRAMPA MEDIDA DE src/entorno.mjs: `NTFY_TEMA: ${{ secrets.NTFY_TEMA }}`
  // con el secreto sin crear deja la variable DEFINIDA Y VACIA. Tratarla como
  // configurada deja al monitor publicando en el tema "" en cada corrida.
  assert.equal(temaDelEntorno({ NTFY_TEMA: "" }), null, "una variable vacia no es un tema");
  assert.equal(temaDelEntorno({ NTFY_TEMA: "   " }), null, "espacios tampoco son un tema");
  assert.equal(temaDelEntorno({ NTFY_TEMA: " abc-123 " }), "abc-123", "el tema se limpia de espacios");
});

test("sin tema configurado el monitor se comporta EXACTAMENTE como antes: ni un POST a ntfy", async () => {
  // Es lo que permite desplegar esto antes de que el operador cree su tema.
  const dicho = [];
  const a = avisadorDelEntorno({ env: {}, log: { log: (m) => dicho.push(m), error: () => {} } });
  assert.equal(a, null, "sin tema no se crea ningun avisador");
  assert.equal(dicho.length, 1, "lo dice UNA vez, sin ruido");
  assert.match(dicho[0], /NTFY_TEMA no configurado/);

  fijarDestinoNtfy(a);
  const { discord, ntfy } = capturar();
  await notifyDiscord(WEBHOOK, { totalRevisado: 10, errores: 0, changes: [baja()] });
  assert.equal(ntfy.length, 0, "sin tema no se puede publicar nada");
  assert.ok(discord.length >= 1, "y Discord sigue recibiendo todo igual");
});

test("el tema NUNCA viaja en la URL: va en el cuerpo del POST", async () => {
  // Una URL queda escrita en el log de Actions, en cabeceras y en cualquier
  // proxy del camino, y el tema ES la clave de acceso al canal: quien lo sabe
  // recibe los avisos y puede publicar en el.
  const { ntfy } = capturar();
  avisador();
  await notifyTecnico(WEBHOOK, "🧭 **Monitor Samsung — prueba**\ndetalle");
  assert.equal(ntfy.length, 1);
  assert.equal(ntfy[0].url, SERVIDOR, "la URL es el servidor pelado");
  assert.ok(!ntfy[0].url.includes(TEMA), "el tema no puede aparecer en la URL");
  assert.equal(ntfy[0].cuerpo.topic, TEMA, "el tema viaja en el cuerpo");
});

// ---------------------------------------------------------------------------
// 2. EL TEXTO DE LA NOTIFICACION
// ---------------------------------------------------------------------------

test("el aviso de una baja trae las cuatro cosas que pidio el operador, y el link al tocarlo", () => {
  const a = avisoDeCambio(baja());
  assert.match(a.titulo, /BAJÓ DE PRECIO/, "tiene que decir que es una baja");
  assert.match(a.titulo, /🟢⬇️/, "con la flecha verde, igual que en Discord");
  assert.match(a.titulo, /Galaxy Buds4 · Negro/, "el nombre completo");
  assert.match(a.mensaje, /De \$199\.990 a \$139\.990/, "de que precio a que precio");
  assert.match(a.mensaje, /ahorras \$60\.000 \(−30,0%\)/, "cuanto se ahorra, con coma decimal es-CL");
  assert.match(a.mensaje, /SM-R540NZKACHO/, "el SKU, que es el unico identificador estable");
  assert.equal(a.click, baja().url, "al tocar la notificacion se abre la ficha del producto");
  assert.equal(a.prioridad, PRIORIDAD_BAJA);
  assert.ok(!a.titulo.includes("**") && !a.mensaje.includes("**"), "el celular no entiende Markdown: un ** se veria literal");
  assert.ok(!a.mensaje.includes("NaN"), "jamas debe aparecer NaN");
});

test("una SUBA no se puede rotular como baja (el dia que el operador revierta la regla)", () => {
  // Hoy por este camino solo pasan bajas, pero la regla se revierte borrando una
  // linea. Una suba rotulada "BAJÓ DE PRECIO" seria el peor aviso posible: el
  // operador iria a comprar algo que subio.
  const a = avisoDeCambio({ ...baja(), tipo: "sube", precioAnterior: 139990, precio: 199990 });
  assert.ok(!a.titulo.includes("BAJÓ"), "una suba no puede decir que bajo");
  assert.match(a.titulo, /SUBIÓ DE PRECIO/);
  assert.match(a.mensaje, /De \$139\.990 a \$199\.990/);
  const stock = avisoDeCambio({ ...baja(), tipo: "stock" });
  assert.ok(!stock.titulo.includes("BAJÓ"), "un cambio de stock tampoco");
});

test("precio ilegible: 'sin precio', nunca $NaN", () => {
  const a = avisoDeCambio({ tipo: "baja", modelo: "M1", nombre: "X", precio: NaN, precioAnterior: undefined });
  assert.ok(a.mensaje.includes("sin precio"));
  assert.ok(!a.mensaje.includes("NaN"));
});

test("el aviso del celular y la linea de Discord no se pueden contradecir", async () => {
  // El medio es otro (sin Markdown, con titulo aparte), pero los HECHOS tienen
  // que ser los mismos: si alguien cambia el formato de un lado y no del otro,
  // esta prueba muere. Es la misma forma de prueba que ata el texto de
  // `mensajeRebotando` con `esNotificable` (2026-10-14, segunda vuelta).
  const { discord } = capturar();
  await notifyDiscord(WEBHOOK, { totalRevisado: 10, errores: 0, changes: [baja()] });
  const lineaDiscord = discord.join("\n");
  const a = avisoDeCambio(baja());

  const montos = (t) => [...t.matchAll(/\$[\d.]+/g)].map((m) => m[0]);
  const pct = (t) => (t.match(/−\d+,\d%/) ?? [])[0];
  for (const m of ["$199.990", "$139.990", "$60.000"]) {
    assert.ok(montos(lineaDiscord).includes(m), `Discord deberia decir ${m}`);
    assert.ok(montos(`${a.titulo}\n${a.mensaje}`).includes(m), `el celular deberia decir ${m}`);
  }
  assert.equal(pct(`${a.titulo}\n${a.mensaje}`), pct(lineaDiscord), "el porcentaje tiene que ser el mismo");
  assert.ok(lineaDiscord.includes("BAJÓ DE PRECIO") && a.titulo.includes("BAJÓ DE PRECIO"), "los dos dicen la palabra");
});

// ---------------------------------------------------------------------------
// 3. UNA NOTIFICACION POR BAJA — EL PEDIDO
// ---------------------------------------------------------------------------

test("UNA notificacion por baja, no una por mensaje: 6 bajas en un mensaje de Discord son 6 avisos", async () => {
  // Es literalmente el pedido: "para que llegue una notificacion por una".
  // Discord agrupa hasta VIVO_MAX_CAMBIOS=6 cambios en un mensaje.
  const { discord, ntfy } = capturar();
  avisador();
  const tanda = bajas(6);
  const r = await enviarTandaVivo(WEBHOOK, tanda, { encabezado: "⚡ encabezado" });
  assert.equal(r.mensajes, 1, "las 6 caben en UN mensaje de Discord");
  assert.equal(discord.length, 1);
  assert.equal(ntfy.length, 6, "y en SEIS notificaciones del celular");
  const titulos = ntfy.map((n) => n.cuerpo.title);
  for (let i = 0; i < 6; i++) assert.ok(titulos.some((t) => t.includes(`Producto numero ${i}`)), `falta la notificacion de ${i}`);
  assert.equal(new Set(ntfy.map((n) => n.cuerpo.click)).size, 6, "cada notificacion abre la ficha de SU producto");
});

test("y en el resumen de cierre tambien: una por baja, no una por mensaje", async () => {
  const { discord, ntfy } = capturar();
  avisador();
  await notifyDiscord(WEBHOOK, { totalRevisado: 100, errores: 0, changes: bajas(5) });
  assert.equal(discord.length, 1, "las 5 caben en un mensaje de cierre");
  assert.equal(ntfy.length, 5);
});

// ---------------------------------------------------------------------------
// 4. EL FILTRO DEL OPERADOR NO SE ESCAPA POR ESTE CAMINO
// ---------------------------------------------------------------------------

test("lo que el filtro del operador bloquea NO llega al celular (ni accesorios, ni Book3, ni subas, ni stock)", async () => {
  // Es el agujero que tuvo data/pendientes.jsonl y que se tapo el 2026-10-14:
  // un camino nuevo al canal que no pasa por el porton. Aca se comprueba con el
  // porton REAL del repo (repartirCierre -> esNotificable), no a mano.
  const { ntfy } = capturar();
  avisador();
  const detectados = [
    baja(),
    { ...baja(), tipo: "sube", modelo: "SUBE-1", precioAnterior: 100000, precio: 120000 },
    { ...baja(), tipo: "stock", modelo: "STOCK-1", disponible: false, disponibleAnterior: true },
    { ...baja(), modelo: "ACC-1", nombre: "Cargador", categoria: "Accesorios moviles" },
    { ...baja(), modelo: "NP750QFG-KB2CL", nombre: "Galaxy Book3 Pro", categoria: "Computadores" },
    { ...baja(), tipo: "desaparecido", modelo: "DESAP-1" },
  ];
  const { paraDiscord, detectados: cuantos } = repartirCierre(detectados, null);
  // Las dos reglas de CATALOGO sacan dos de los seis del conteo honesto (un
  // accesorio y el Book3 silenciado); los otros cuatro si son cambios de
  // productos vigilados, y de esos cuatro solo uno es una baja.
  assert.equal(cuantos, 4, "ni el accesorio ni el Book3 son productos vigilados");
  assert.equal(paraDiscord.length, 1, "el porton deja pasar solo la baja");

  await notifyDiscord(WEBHOOK, { totalRevisado: 100, errores: 0, changes: paraDiscord, detectados: cuantos });
  assert.equal(ntfy.length, 1, "al celular llega SOLO la baja");
  assert.match(ntfy[0].cuerpo.title, /BAJÓ DE PRECIO/);
  const todo = JSON.stringify(ntfy);
  for (const prohibido of ["SUBE-1", "STOCK-1", "ACC-1", "NP750QFG-KB2CL", "DESAP-1"]) {
    assert.ok(!todo.includes(prohibido), `${prohibido} se escapo al celular`);
  }
});

test("los avisos atrasados tambien pasan por el porton antes de llegar al celular", async () => {
  // data/pendientes.jsonl es el unico material que llega al canal de productos
  // sin pasar por el detector de ESTA corrida: lo escribio otra corrida, se
  // fusiona por union ante un conflicto de git y puede venir editado a mano.
  const { ntfy } = capturar();
  avisador();
  const ts = new Date().toISOString();
  const archivo = [
    { ts, ...baja() },
    { ts, ...baja(), tipo: "sube", modelo: "SUBE-VIEJO" },
    { ts, ...baja(), modelo: "INVERTIDO", precioAnterior: 300000, precio: 400000 },
    { ts, ...baja(), modelo: "MATIZ", matiz: true },
  ].map((o) => JSON.stringify(o)).join("\n");

  const pendientes = pendientesParaAvisar(archivo);
  assert.equal(pendientes.length, 1, "solo la baja creible sobrevive al porton");
  await notifyDiscord(WEBHOOK, { totalRevisado: 10, errores: 0, changes: [], pendientes });
  assert.equal(ntfy.length, 1, "y al celular llega una sola notificacion");
  const todo = JSON.stringify(ntfy);
  for (const prohibido of ["SUBE-VIEJO", "INVERTIDO", "MATIZ"]) {
    assert.ok(!todo.includes(prohibido), `${prohibido} se escapo al celular`);
  }
});

test("si Discord RECHAZA el mensaje, no se copia nada al celular", async () => {
  // La copia va DESPUES del 2xx. Al reves, el operador recibiria en el celular
  // un aviso que no quedo registrado en ninguna parte y que la corrida siguiente
  // volveria a mandar desde data/pendientes.jsonl: dos notificaciones por una
  // baja.
  const ntfy = [];
  globalThis.fetch = async (url, opts) => {
    if (url === WEBHOOK) return { ok: false, status: 404, text: async () => "webhook muerto", headers: { get: () => null } };
    ntfy.push(JSON.parse(opts.body));
    return { ok: true };
  };
  avisador();
  const r = await enviarTandaVivo(WEBHOOK, bajas(3), { encabezado: "⚡" });
  assert.equal(r.confirmados.length, 0);
  assert.equal(r.fallidos.length, 3, "los 3 vuelven al resumen final");
  assert.equal(ntfy.length, 0, "y ninguno se notifico al celular");
});

test("una baja avisada EN VIVO no se vuelve a notificar en el cierre", async () => {
  // El pedido lo dice explicito. No hace falta ningun mecanismo nuevo:
  // repartirCierre ya saca del cierre todo cambio con huella confirmada en vivo,
  // asi que al celular no puede llegar dos veces.
  const { ntfy } = capturar();
  avisador();
  const cambios = [baja()];
  const r = await enviarTandaVivo(WEBHOOK, cambios, { encabezado: "⚡" });
  assert.equal(r.confirmados.length, 1);
  assert.equal(ntfy.length, 1, "una notificacion al avisar en vivo");

  const despachador = { yaEnviado: (c) => c.modelo === "SM-R540NZKACHO" };
  const { paraDiscord, suprimidos } = repartirCierre(cambios, despachador);
  assert.equal(suprimidos, 1);
  assert.equal(paraDiscord.length, 0);
  await notifyDiscord(WEBHOOK, { totalRevisado: 100, errores: 0, changes: paraDiscord, avisadosEnVivo: suprimidos });
  assert.equal(ntfy.length, 1, "el cierre NO repite la notificacion del celular");
});

// ---------------------------------------------------------------------------
// 5. NTFY NO PUEDE ROMPER UNA REVISION
// ---------------------------------------------------------------------------

test("ntfy caido no rompe nada: Discord entrega igual y los cambios quedan confirmados", async () => {
  const caidas = [new Error("ECONNREFUSED"), { ok: false, status: 500 }, { ok: false, status: 429 }];
  for (const [i, respuesta] of caidas.entries()) {
    reiniciarRitmo();
    const { discord, ntfy } = capturar({ respuestaNtfy: () => respuesta });
    avisador({ maxFallosSeguidos: 99 });
    const r = await enviarTandaVivo(WEBHOOK, bajas(2), { encabezado: "⚡" });
    assert.equal(r.confirmados.length, 2, `caso ${i}: el aviso de Discord vale aunque el celular falle`);
    assert.equal(discord.length, 1, `caso ${i}: Discord recibio el mensaje`);
    assert.equal(ntfy.length, 2, `caso ${i}: se intento, no se trago el intento`);
  }
});

test("el error de ntfy queda en el log y no se reintenta nunca", async () => {
  // No se reintenta porque el aviso NO se pierde (esta en Discord) y porque el
  // cupo de ntfy.sh es por IP y la IP del runner de Actions es ajena: insistir
  // gasta un cupo que no es nuestro. Es la misma decision que ya tomo
  // src/discord.mjs con los 400.
  const dicho = [];
  const { ntfy } = capturar({ respuestaNtfy: () => ({ ok: false, status: 503 }) });
  avisador({ log: { error: (m) => dicho.push(m), log: () => {} } });
  await enviarTandaVivo(WEBHOOK, [baja()], { encabezado: "⚡" });
  assert.equal(ntfy.length, 1, "UN intento por aviso, sin reintentos");
  assert.ok(dicho.some((m) => /no se pudo copiar un aviso al celular/.test(m)), "el fallo tiene que verse en el log");
  assert.ok(dicho.some((m) => /503/.test(m)), "con el motivo");
});

test("tras 3 fallos seguidos la copia al celular se apaga sola y deja de intentar", async () => {
  // El techo del dano de un ntfy que no responde: 3 esperas, una vez, en toda la
  // corrida. Sin esto serian 3 s por CADA baja de CADA tanda, en el hueco entre
  // paginas, o sea tiempo de scraping tirado por el eslabon menos importante.
  // Es el mismo freno que VIVO_MAX_FALLOS_SEGUIDOS en src/despachador-vivo.mjs.
  const { discord, ntfy } = capturar({ respuestaNtfy: () => ({ ok: false, status: 500 }) });
  const a = avisador({ maxFallosSeguidos: 3 });
  const r = await enviarTandaVivo(WEBHOOK, bajas(10), { encabezado: "⚡" });
  assert.equal(ntfy.length, 3, "se apaga al tercer fallo y no intenta los 7 restantes");
  assert.equal(a.activo, false);
  assert.equal(a.stats().apagadoPor, "fallos-seguidos");
  assert.equal(r.confirmados.length, 10, "y las 10 bajas siguen avisadas por Discord");
  assert.ok(discord.length >= 1);
});

test("un fallo aislado NO apaga nada: el contador se reinicia al primer exito", async () => {
  const { ntfy } = capturar({ respuestaNtfy: (n) => (n % 2 === 1 ? { ok: false, status: 500 } : { ok: true }) });
  const a = avisador({ maxFallosSeguidos: 3 });
  await enviarTandaVivo(WEBHOOK, bajas(6), { encabezado: "⚡" });
  assert.equal(ntfy.length, 6, "intento las 6");
  assert.equal(a.activo, true, "fallos alternados no son fallos SEGUIDOS");
  assert.equal(a.stats().fallidos, 3);
  assert.equal(a.stats().enviados, 3);
});

test("una ola de bajas no desborda el cupo del servidor: tope por corrida, y se dice lo que no cupo", async () => {
  // MEDIDO sobre data/history.jsonl con el filtro real: la peor corrida del
  // historial tuvo 141 bajas (2026-10-01T22:16) y el peor dia 237. ntfy.sh
  // documenta una rafaga de 60 peticiones, despues una cada 5 s, y un tope de
  // 250 mensajes al dia. Mandar 141 de a una son 81 esperas de 5 s con el
  // barrido parado. El tope corta, y lo que no cupo se DICE: un aviso que
  // desaparece en silencio es peor que un aviso de mas.
  const { discord, ntfy } = capturar();
  const a = avisador({ tope: 4 });
  const r = await enviarTandaVivo(WEBHOOK, bajas(10), { encabezado: "⚡" });
  assert.equal(r.confirmados.length, 10, "las 10 llegan completas a Discord: el tope es solo del celular");
  assert.ok(discord.length >= 1);
  assert.equal(ntfy.length, 5, "4 notificaciones de producto + 1 que dice que hay mas");
  assert.match(ntfy[4].cuerpo.title, /Hay más bajas de las que caben/);
  assert.match(ntfy[4].cuerpo.message, /Están TODAS completas en Discord/);
  assert.equal(a.stats().omitidosPorTope, 6);
  // y no se repite por cada una de las que faltan
  assert.equal(ntfy.filter((n) => /caben en el teléfono|caben/.test(n.cuerpo.title)).length, 1);
});

test("EL AVISO DEL TOPE NO PUEDE MENTIR EL NUMERO: el del momento no lo dice y el del cierre dice el real", async () => {
  // DEFECTO MEDIDO (2026-11-06, dos verificadores). El aviso salia en la PRIMERA
  // omision, cuando el contador valia 1, asi que el titulo decia "1 bajas mas
  // que no caben" tambien cuando faltaban 220 -- y "1 bajas" ni siquiera esta en
  // castellano. Es la misma falta que este proyecto peleo el 2026-10-14: un
  // mensaje al operador no puede mentir por omision. El numero solo se sabe al
  // final, asi que al final se dice.
  const { ntfy } = capturar();
  const a = avisador({ tope: 4 });
  await enviarTandaVivo(WEBHOOK, bajas(10), { encabezado: "⚡" });

  const alCruzar = ntfy.find((n) => /Hay más bajas/.test(n.cuerpo.title));
  assert.ok(alCruzar, "tiene que salir un aviso en el momento (la corrida se puede morir antes del cierre)");
  assert.ok(!/\d/.test(alCruzar.cuerpo.title), `el aviso del momento no puede traer ningun numero: "${alCruzar.cuerpo.title}"`);

  const n = await cerrarCorridaNtfy(a, { log: { log() {} } });
  assert.equal(n.omitidosPorTope, 6);
  const final = ntfy[ntfy.length - 1].cuerpo;
  assert.match(final.title, /\b6 bajas más\b/, `el aviso del cierre tiene que decir 6: "${final.title}"`);
  assert.match(final.message, /esas 6 no llegaron/);
  assert.match(final.message, /Están TODAS completas en Discord/);
  // y no se manda dos veces si alguien cierra dos veces
  const antes = ntfy.length;
  await cerrarCorridaNtfy(a, { log: { log() {} } });
  assert.equal(ntfy.length, antes, "cerrar dos veces no manda dos avisos");
});

test("y el aviso del cierre esta escrito en castellano, singular incluido", async () => {
  const { ntfy } = capturar();
  const a = avisador({ tope: 4 });
  await enviarTandaVivo(WEBHOOK, bajas(5), { encabezado: "⚡" });
  await cerrarCorridaNtfy(a, { log: { log() {} } });
  const final = ntfy[ntfy.length - 1].cuerpo;
  assert.equal(a.stats().omitidosPorTope, 1);
  assert.match(final.title, /1 baja más que no cabe/, `"1 bajas" no es castellano: "${final.title}"`);
  assert.ok(!/1 bajas/.test(final.title + final.message));
  // sin nada omitido no hay aviso de cierre: el canal no inventa mensajes
  reiniciarRitmo();
  const { ntfy: ntfy2 } = capturar();
  const b = avisador({ tope: 60 });
  await enviarTandaVivo(WEBHOOK, bajas(2), { encabezado: "⚡" });
  const cuantos = ntfy2.length;
  await cerrarCorridaNtfy(b, { log: { log() {} } });
  assert.equal(ntfy2.length, cuantos, "sin omitidos, cerrar no manda nada");
});

test("si el aviso del tope FALLA, se vuelve a intentar: no se pierde para siempre", async () => {
  // DEFECTO MEDIDO (2026-11-06): la bandera se levantaba ANTES de mandar, asi
  // que un 503 o un timeout en ese unico POST lo perdia para siempre y la
  // corrida seguia omitiendo bajas sin volver a decirlo. Medido con tope=3 y 8
  // bajas: 3 notificaciones y CERO avisos de que faltaban 5.
  let primera = true;
  const { ntfy } = capturar({
    respuestaNtfy: (_n, cuerpo) => {
      if (/Hay más bajas/.test(cuerpo.title) && primera) {
        primera = false;
        return { ok: false, status: 503 };
      }
      return { ok: true };
    },
  });
  const a = avisador({ tope: 3, maxFallosSeguidos: 99 });
  await enviarTandaVivo(WEBHOOK, bajas(8), { encabezado: "⚡" });
  const entregados = ntfy.filter((n) => /Hay más bajas/.test(n.cuerpo.title)).length;
  assert.equal(entregados, 2, "el primer intento del aviso se perdio y el siguiente omitido lo volvio a intentar");
  assert.equal(a.stats().omitidosPorTope, 5);
  // y aun si todos los intentos fallaran, el del cierre lo dice igual
  await cerrarCorridaNtfy(a, { log: { log() {} } });
  assert.match(ntfy[ntfy.length - 1].cuerpo.title, /5 bajas más/);
});

test("LOS AVISOS TECNICOS NO SE COMEN EL CUPO DE LAS BAJAS", async () => {
  // DEFECTO MEDIDO (2026-11-06): el comentario del modulo decia que no contaban
  // y contaban, porque el tope se comparaba contra `enviados`, que los suma
  // todos. Medido con tope=10: 4 avisos tecnicos antes del cierre dejaban sonar
  // 6 bajas en vez de 10, y omitidosPorTope quedaba en 14 en vez de 10.
  const { ntfy } = capturar();
  const a = avisador({ tope: 4 });
  for (let i = 0; i < 3; i++) await notifyTecnico(WEBHOOK, `⚠️ **Monitor Samsung — tecnico ${i}**\ndetalle`);
  await enviarTandaVivo(WEBHOOK, bajas(10), { encabezado: "⚡" });
  const deProducto = ntfy.filter((n) => /BAJÓ DE PRECIO/.test(n.cuerpo.title)).length;
  assert.equal(deProducto, 4, "los 3 tecnicos no pueden gastar el cupo de las bajas");
  assert.equal(a.stats().deProducto, 4);
  assert.equal(a.stats().tecnicos, 3);
  assert.equal(a.stats().omitidosPorTope, 6);
  // una correccion tampoco gasta cupo de producto: es el aviso que menos puede faltar
  reiniciarRitmo();
  const { ntfy: n2 } = capturar();
  const b = avisador({ tope: 2 });
  await notifyDiscord(WEBHOOK, {
    totalRevisado: 10,
    errores: 0,
    changes: bajas(2),
    avisadosEnVivo: 1,
    correcciones: [{ aviso: baja({ modelo: "FALSO-1" }), actual: baja({ modelo: "FALSO-1", precio: 199990 }) }],
  });
  assert.equal(n2.filter((n) => /BAJÓ DE PRECIO/.test(n.cuerpo.title)).length, 2, "las 2 bajas del tope siguen sonando");
  assert.equal(b.stats().omitidosPorTope, 0);
  assert.equal(b.stats().correcciones, 1);
});

test("los tres frenos que se DESPLIEGAN son 3 s, 3 fallos y 60 avisos", async () => {
  // DEFECTO MEDIDO (2026-11-06): ninguna prueba ataba estos numeros, porque cada
  // prueba pasa su propio valor (`tope: 4`, `timeoutMs: 5`). Tres mutantes que
  // los subian a 300.000 / 100.000 / 100.000 dejaban la suite ENTERA en verde,
  // o sea los tres frenos en que se apoya toda la resiliencia de este canal
  // estaban sin probar. Aca se mira un avisador creado SIN opciones.
  assert.deepEqual(POR_DEFECTO, { timeoutMs: 3000, maxFallosSeguidos: 3, tope: 60 });
  const porDefecto = crearAvisadorNtfy({ tema: TEMA, servidor: SERVIDOR, log: { error() {}, log() {} } });
  assert.deepEqual(porDefecto.config(), { timeoutMs: 3000, maxFallosSeguidos: 3, tope: 60 });

  // Y `config()` tiene que decir el numero QUE SE USA, no un literal escrito a
  // mano: si no, seria un instrumento que miente y las tres aserciones de arriba
  // no probarian nada.
  process.env.NTFY_TIMEOUT_MS = "7";
  process.env.NTFY_TOPE_AVISOS = "11";
  const conEntorno = crearAvisadorNtfy({ tema: TEMA, servidor: SERVIDOR, log: { error() {}, log() {} } });
  assert.equal(conEntorno.config().timeoutMs, 7, "config() no refleja el valor que de verdad se usa");
  assert.equal(conEntorno.config().tope, 11);
  // y ese timeoutMs es el que corta de verdad el POST
  let abortada = false;
  const r = await publicar(TEMA, avisoDeCambio(baja()), {
    servidor: SERVIDOR,
    timeoutMs: conEntorno.config().timeoutMs,
    fetchFn: (url, opts) =>
      new Promise((_, rechazar) => {
        opts.signal.addEventListener("abort", () => {
          abortada = true;
          rechazar(new Error("The operation was aborted"));
        });
      }),
  });
  assert.equal(abortada, true, "el tope de espera que declara config() tiene que ser el que corta");
  assert.equal(r.ok, false);
  delete process.env.NTFY_TIMEOUT_MS;
  delete process.env.NTFY_TOPE_AVISOS;

  // y se comportan como dicen, sin pasarles ninguna opcion:
  fijarDestinoNtfy(porDefecto);
  const { ntfy } = capturar({ respuestaNtfy: () => ({ ok: false, status: 500 }) });
  await enviarTandaVivo(WEBHOOK, bajas(10), { encabezado: "⚡" });
  assert.equal(ntfy.length, 3, "el avisador por defecto se apaga al TERCER fallo seguido");
  assert.equal(porDefecto.stats().apagadoPor, "fallos-seguidos");

  reiniciarRitmo();
  const otro = avisador();
  const { ntfy: n2 } = capturar();
  await enviarTandaVivo(WEBHOOK, bajas(62), { encabezado: "⚡" });
  assert.equal(n2.filter((n) => /BAJÓ DE PRECIO/.test(n.cuerpo.title)).length, 60, "el tope por defecto es 60 avisos de producto");
  assert.equal(otro.stats().omitidosPorTope, 2);
});

test("tope 0 = sin tope", () => {
  assert.equal(avisoDeTopeAlCruzar(4).prioridad, PRIORIDAD_BAJA);
  assert.equal(avisoDeTopeFinal(6, 4).prioridad, PRIORIDAD_BAJA);
  const a = crearAvisadorNtfy({ tema: TEMA, servidor: SERVIDOR, tope: 0 });
  assert.equal(a.activo, true);
});

test("el POST al celular se corta solo y no cuelga la revision", async () => {
  // Esto corre en el hueco entre dos paginas, asi que todo lo que espere aca
  // DETIENE el barrido: es el mismo razonamiento de topeEspera en
  // src/discord.mjs, pero mas estricto (3 s contra 70 s) porque Discord puede
  // perder un aviso y ntfy no puede perder nada.
  let abortada = false;
  const r = await publicar(
    TEMA,
    avisoDeCambio(baja()),
    {
      servidor: SERVIDOR,
      timeoutMs: 5,
      fetchFn: (url, opts) =>
        new Promise((_, rechazar) => {
          opts.signal.addEventListener("abort", () => {
            abortada = true;
            rechazar(new Error("The operation was aborted"));
          });
        }),
    },
  );
  assert.equal(abortada, true, "el POST se corta con el tope de espera");
  assert.equal(r.ok, false);
  assert.match(r.error, /ntfy:/);
});

test("publicar nunca lanza, ni sin tema ni con el servidor reventando", async () => {
  assert.deepEqual(await publicar(null, avisoDeCambio(baja())), { ok: false, error: "ntfy: sin tema configurado" });
  const r = await publicar(TEMA, avisoDeCambio(baja()), {
    servidor: SERVIDOR,
    fetchFn: () => {
      throw new Error("boom");
    },
  });
  assert.equal(r.ok, false);
  assert.match(r.error, /boom/);
});

// ---------------------------------------------------------------------------
// 6. EL CANAL TECNICO
// ---------------------------------------------------------------------------

test("los avisos tecnicos tambien llegan al celular, con prioridad distinta a una oferta", async () => {
  // LA RAZON DE PESO: el incidente del 2026-09-23. El monitor estuvo 30 horas
  // caido y el operador se entero por un correo de GitHub. Ese aviso es tecnico
  // y es justo el que no puede quedar sepultado bajo una notificacion agrupada.
  const { ntfy } = capturar();
  avisador();
  await notifyTecnico(
    WEBHOOK,
    "📊 **Monitor Samsung — pulso del día**\nÚltimas 24 h, 20 revisiones: **185 cambios detectados** y **11 avisos**.\ntercera linea",
  );
  assert.equal(ntfy.length, 1);
  assert.equal(ntfy[0].cuerpo.title, "📊 Monitor Samsung — pulso del día", "el titulo es la primera linea, sin Markdown");
  assert.match(ntfy[0].cuerpo.message, /185 cambios detectados/);
  assert.equal(ntfy[0].cuerpo.priority, PRIORIDAD_TECNICA, "un problema no puede verse igual que una oferta");
  assert.notEqual(PRIORIDAD_TECNICA, PRIORIDAD_BAJA);
  assert.ok(!ntfy[0].cuerpo.click, "un aviso tecnico no abre una ficha de producto");
});

test("un aviso tecnico NO se queda sin mandar por culpa de una ola de bajas", async () => {
  // Si compartieran el tope, 141 bajas dejarian sin mandar justo el aviso que
  // dice que el monitor esta roto. Los tecnicos ya tienen su propio freno (una
  // vez al dia por clave, src/avisos-repetidos.mjs): son 2 a 4 al dia medidos
  // sobre data/avisos-tecnicos.jsonl.
  const { ntfy } = capturar();
  avisador({ tope: 2 });
  await enviarTandaVivo(WEBHOOK, bajas(5), { encabezado: "⚡" });
  const antes = ntfy.length;
  await notifyTecnico(WEBHOOK, "⚠️ **Monitor Samsung — revisión marcada como NO confiable**\ndetalle");
  assert.equal(ntfy.length, antes + 1, "el aviso tecnico sale aunque el tope de producto este agotado");
  assert.match(ntfy[ntfy.length - 1].cuerpo.title, /NO confiable/);
});

test("sin webhook de Discord no hay copia al celular (ntfy es la copia, no el canal)", async () => {
  const { ntfy } = capturar();
  avisador();
  const r = await notifyTecnico(undefined, "⚠️ **algo**\ndetalle");
  assert.equal(r.entregado, true, "sin webhook no hay nada que reintentar (regla del proyecto)");
  assert.equal(ntfy.length, 0, "y tampoco hay nada que copiar");
  await notifyDiscord(undefined, { totalRevisado: 1, errores: 0, changes: [baja()] });
  assert.equal(ntfy.length, 0);
});

test("avisoTecnico sobrevive a un texto de una sola linea o vacio", () => {
  const una = avisoTecnico("🧭 **Monitor Samsung — algo**");
  assert.equal(una.titulo, "🧭 Monitor Samsung — algo");
  assert.equal(una.mensaje, "🧭 Monitor Samsung — algo", "el cuerpo no puede quedar vacio");
  assert.equal(avisoTecnico("").titulo, "Monitor Samsung");
  assert.equal(avisoTecnico(undefined).titulo, "Monitor Samsung");
});

test("ni el titulo ni el cuerpo pueden pasarse de los limites del servidor", () => {
  // ntfy rechaza con HTTP 400 un titulo de mas de 1 KB, y un mensaje de mas de
  // 4.096 bytes lo convierte en archivo adjunto en vez de notificacion.
  const largo = "x".repeat(5000);
  const a = avisoDeCambio({ ...baja(), nombre: largo });
  assert.ok(a.titulo.length <= 250, `titulo de ${a.titulo.length}`);
  assert.ok(a.mensaje.length <= 3500);
  const t = avisoTecnico(`primera\n${largo}`);
  assert.ok(t.titulo.length <= 250);
  assert.ok(t.mensaje.length <= 3500);
});

// ---------------------------------------------------------------------------
// 6 bis. LO QUE SUENA Y LO QUE NO (defectos medidos el 2026-11-06)
// ---------------------------------------------------------------------------

test("UN REBOTE NO SUENA EN EL CELULAR: Discord lo manda compacto y el telefono se queda callado", async () => {
  // DEFECTO ALTO MEDIDO. El freno anti-parpadeo existe para que un producto que
  // hace bajo/subio/bajo/subio deje de generar una alerta por vez: `esParaVivo`
  // lo saca del canal urgente a proposito y notifyDiscord lo manda compacto bajo
  // "🌀 Siguen rebotando (ya te los avisé, no es novedad)". La copia al celular
  // copiaba TODO cambio que viajara en el mensaje, asi que cada rebote se volvia
  // su propia notificacion titulada "BAJÓ DE PRECIO", con la misma prioridad que
  // una oferta fresca y sin decir en ninguna parte que era un rebote: era la
  // "notificacion constante" que el operador pidio sacar (2026-09-13)
  // reintroducida por la puerta nueva, y encima contradiciendo el rotulo que
  // Discord pone en el MISMO mensaje. Medido sobre la corrida real
  // 2026-10-01T18:00:16Z: 2 mensajes de Discord contra 15 notificaciones.
  const { discord, ntfy } = capturar();
  avisador();
  const rebotes = bajas(15).map((c) => ({ ...c, rebote: true, vecesRebotado: 2, valoresRebote: [199990, 139990] }));
  await notifyDiscord(WEBHOOK, { totalRevisado: 100, errores: 0, changes: rebotes });

  assert.ok(discord.length >= 1, "a Discord sí llegan: no se pierde nada");
  assert.match(discord.join("\n"), /Siguen rebotando/, "y llegan rotulados como lo que son");
  assert.equal(ntfy.length, 0, `al celular no puede sonar ningun rebote (sonaron ${ntfy.length})`);
  assert.equal(ntfy.filter((n) => /BAJÓ DE PRECIO/.test(n.cuerpo.title)).length, 0);

  // y una baja NORMAL en la misma corrida si suena: el filtro no apaga el canal
  const { ntfy: n2 } = capturar();
  reiniciarRitmo();
  avisador();
  await notifyDiscord(WEBHOOK, { totalRevisado: 100, errores: 0, changes: [...rebotes, baja({ modelo: "FRESCA-1" })] });
  assert.equal(n2.length, 1, "solo la baja fresca suena");
  assert.match(JSON.stringify(n2[0].cuerpo), /FRESCA-1/);
});

test("el porton del celular es el del canal en vivo, no una copia a mano que se pueda desalinear", () => {
  // La leccion mas repetida de este repo: mientras un filtro estuvo escrito a
  // mano en dos caminos se le podia borrar de uno y la suite seguia en verde.
  const casos = [
    baja(),
    { ...baja(), rebote: true },
    { ...baja(), tipo: "stock", matiz: true },
    { ...baja(), tipo: "sube" },
    { ...baja(), categoria: "Accesorios moviles", nombre: "Cargador" },
  ];
  for (const c of casos) {
    assert.equal(esParaCelular(c), esParaVivo(c), `esParaCelular y esParaVivo no pueden discrepar: ${JSON.stringify(c.tipo)}`);
    if (esParaCelular(c)) assert.equal(esNotificable(c), true, "nada que el filtro del operador bloquee puede sonar");
  }
  assert.equal(esParaCelular(baja()), true);
  assert.equal(esParaCelular({ ...baja(), rebote: true }), false);
});

test("EL DESMENTIDO DE UN AVISO FALSO SI SUENA, y no se puede confundir con la oferta", async () => {
  // DEFECTO ALTO MEDIDO por dos verificadores. Un aviso en vivo que la revision
  // completa no ratifica genera en Discord la seccion "Correcciones de avisos",
  // que el repo pone PRIMERA a proposito porque desmiente algo que el operador
  // ya recibio y por lo que puede estar por ir a comprar. Esos items se armaban
  // solo con {linea}, sin cambio, asi que no habia nada que copiar: la oferta
  // FALSA sonaba (salio en vivo) y el desmentido no sonaba nunca. 20
  // correcciones en 897 corridas, 4 en la semana que midio el operador.
  const { discord, ntfy } = capturar();
  avisador();
  const falsa = baja();
  await enviarTandaVivo(WEBHOOK, [falsa], { encabezado: "⚡" });
  assert.equal(ntfy.length, 1, "la oferta (que despues resulto falsa) sono");
  assert.match(ntfy[0].cuerpo.title, /BAJÓ DE PRECIO/);

  await notifyDiscord(WEBHOOK, {
    totalRevisado: 100,
    errores: 0,
    changes: [],
    avisadosEnVivo: 1,
    correcciones: [{ aviso: falsa, actual: { ...falsa, precio: 199990 } }],
  });
  assert.match(discord.join("\n"), /no se confirmó/, "Discord manda su seccion de correcciones");
  assert.equal(ntfy.length, 2, "y el desmentido tambien suena");
  const d = ntfy[1].cuerpo;
  assert.match(d.title, /SE CORRIGE/, "el titulo tiene que empezar diciendo que corrige algo");
  assert.ok(!/BAJÓ DE PRECIO/.test(d.title), "no puede repetir la frase del aviso que desmiente");
  assert.match(d.message, /NO se confirmó/);
  assert.match(d.message, /\$199\.990/, "tiene que decir el precio que si esta vigente");
  assert.equal(d.priority, PRIORIDAD_CORRECCION);
  assert.equal(d.click, falsa.url, "al tocarlo se abre la ficha para mirarlo");
});

test("una correccion que Discord RECHAZA no suena, y no vuelve como aviso de baja", async () => {
  // La copia va despues del 2xx, igual que todo lo demas. Y el item de
  // correccion NO viaja dentro de `cambios`: si viajara, un mensaje rechazado
  // mandaria a data/pendientes.jsonl el cambio que la correccion viene a
  // DESMENTIR, y la corrida siguiente lo reenviaria como oferta.
  const ntfy = [];
  globalThis.fetch = async (url, opts) => {
    // 404 y no 500: un 500 se reintenta con espera creciente y haria dormir la
    // suite 30 s. Lo que se prueba es el rechazo, no el reintento.
    if (url === WEBHOOK) return { ok: false, status: 404, text: async () => "webhook muerto", headers: { get: () => null } };
    ntfy.push(JSON.parse(opts.body));
    return { ok: true };
  };
  avisador();
  const falsa = baja();
  const r = await notifyDiscord(WEBHOOK, {
    totalRevisado: 10,
    errores: 0,
    changes: [],
    avisadosEnVivo: 1,
    correcciones: [{ aviso: falsa, actual: { ...falsa, precio: 199990 } }],
  });
  assert.equal(ntfy.length, 0, "sin 2xx no hay copia");
  assert.deepEqual(r.noEntregados, [], "y la correccion no se convierte en un aviso atrasado");
});

test("un aviso TECNICO que Discord rechaza tampoco se copia", async () => {
  // La regla "solo despues del 2xx" estaba probada para el canal de productos y
  // no para el tecnico: un mutante que copiaba igual sobrevivia (medido
  // 2026-11-06).
  const ntfy = [];
  globalThis.fetch = async (url, opts) => {
    if (url === WEBHOOK) return { ok: false, status: 404, text: async () => "webhook muerto", headers: { get: () => null } };
    ntfy.push(JSON.parse(opts.body));
    return { ok: true };
  };
  avisador();
  const r = await notifyTecnico(WEBHOOK, "⚠️ **Monitor Samsung — algo**\ndetalle");
  assert.equal(r.entregado, false);
  assert.equal(ntfy.length, 0, "un aviso que no quedo registrado en Discord no puede sonar en el celular");
});

test("apagar el destino (fijarDestinoNtfy(null)) deja de copiar de verdad", async () => {
  const { ntfy } = capturar();
  avisador();
  await enviarTandaVivo(WEBHOOK, [baja()], { encabezado: "⚡" });
  assert.equal(ntfy.length, 1);
  fijarDestinoNtfy(null);
  await enviarTandaVivo(WEBHOOK, [baja({ modelo: "OTRA" })], { encabezado: "⚡" });
  assert.equal(ntfy.length, 1, "con el destino apagado no se copia nada");
});

test("el tema NUNCA se imprime en el log, ni al encender ni al fallar", async () => {
  // El log de Actions es publico para quien tenga acceso al repo y queda
  // guardado 90 dias. GitHub enmascara los secretos, pero no se puede depender
  // de eso: el tema es la clave del canal.
  const dicho = [];
  const log = { log: (m) => dicho.push(String(m)), error: (m) => dicho.push(String(m)) };
  const a = avisadorDelEntorno({ env: { NTFY_TEMA: TEMA, NTFY_SERVIDOR: SERVIDOR }, log });
  assert.ok(a, "con tema si se crea el avisador");
  capturar({ respuestaNtfy: () => ({ ok: false, status: 401 }) });
  fijarDestinoNtfy(a);
  await enviarTandaVivo(WEBHOOK, [baja()], { encabezado: "⚡" });
  await cerrarCorridaNtfy(a, { log });
  assert.ok(dicho.length >= 2, "algo tiene que decir");
  for (const linea of dicho) assert.ok(!linea.includes(TEMA), `el tema se escapo al log: ${linea}`);
});

test("la linea INFO del cierre existe y declara TODO lo que paso en el canal", async () => {
  // Es la unica observabilidad de este canal (el pendiente nº1 del encargo:
  // "mirar la linea INFO ntfy las primeras corridas"). Un mutante que la borraba
  // dejaba la suite en verde porque vivia en run.mjs, donde ninguna prueba
  // llega; ahora vive en src/ntfy.mjs.
  const { ntfy } = capturar();
  const a = avisador({ tope: 2 });
  await notifyTecnico(WEBHOOK, "⚠️ **Monitor Samsung — algo**\ndetalle");
  await enviarTandaVivo(WEBHOOK, [...bajas(4), { ...baja({ modelo: "REB" }), rebote: true }], { encabezado: "⚡" });
  const dicho = [];
  const n = await cerrarCorridaNtfy(a, { log: { log: (m) => dicho.push(String(m)) } });
  assert.equal(dicho.length, 1, "una linea, no un parrafo");
  assert.match(dicho[0], /^INFO ntfy /);
  for (const campo of ["enviados=", "de_producto=", "fallidos=", "tecnicos=", "correcciones=", "no_urgentes=", "omitidos_por_tope=", "apagado_por="]) {
    assert.ok(dicho[0].includes(campo), `la linea INFO tiene que declarar ${campo}: ${dicho[0]}`);
  }
  assert.equal(n.deProducto, 2);
  assert.equal(n.noUrgentes, 1, "el rebote que no sono queda contado, no desaparece");
  assert.equal(n.tecnicos, 1);
  assert.ok(ntfy.length >= 1);
  assert.equal(await cerrarCorridaNtfy(null), null, "sin avisador no hace nada ni se cae");
});

// ---------------------------------------------------------------------------
// 6 ter. NTFY NO PUEDE DEJAR COLGADA UNA CORRIDA (HTTP de verdad)
// ---------------------------------------------------------------------------

test("un 200 cuyo CUERPO no cierra no deja ningun socket vivo", async () => {
  // DEFECTO ALTO MEDIDO (2026-11-06). `fetch` resuelve con las CABECERAS y el
  // tope de espera se cancela ahi, asi que el cuerpo de la respuesta quedaba
  // abierto: con un servidor que responde 200 y no cierra el cuerpo (un proxy
  // atascado), cada notificacion dejaba un socket vivo y Node NO TERMINABA
  // aunque la revision ya hubiera hecho todo su trabajo. Medido: el proceso
  // salia a los 323 s en vez de 19, o no salia nunca con un cuerpo que gotea.
  // En Actions eso es el timeout de 330 min, el aviso falso de "no hubo
  // revision" y el grupo de concurrencia tomado 5,5 h.
  //
  // ESTA PRUEBA NECESITA HTTP DE VERDAD: ninguna de las otras puede cazarlo,
  // porque todas interceptan globalThis.fetch y devuelven objetos sin cuerpo.
  // Por eso el servidor es propio, en 127.0.0.1, y el tema es inventado.
  const http = await import("node:http");
  const sockets = [];
  const latidos = [];
  const servidor = http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.write("{"); // responde 2xx y NUNCA termina el cuerpo
    latidos.push(setInterval(() => { try { res.write(" "); } catch {} }, 50).unref());
  });
  servidor.on("connection", (s) => sockets.push(s));
  await new Promise((r) => servidor.listen(0, "127.0.0.1", r));
  try {
    const url = `http://127.0.0.1:${servidor.address().port}`;
    const r = await publicar(TEMA, avisoDeCambio(baja()), { servidor: url, timeoutMs: 3000 });
    assert.equal(r.ok, true, "el servidor contesto 200: el aviso se dio por copiado");
    // el socket se cierra al salir de publicar, sin esperar a que el servidor cierre nada
    const cerrados = async () => {
      for (let i = 0; i < 100; i++) {
        if (sockets.length > 0 && sockets.every((s) => s.destroyed)) return true;
        await new Promise((r) => setTimeout(r, 20));
      }
      return false;
    };
    assert.equal(await cerrados(), true, `quedaron ${sockets.filter((s) => !s.destroyed).length} sockets vivos: la corrida se cuelga hasta el timeout del job`);
  } finally {
    for (const t of latidos) clearInterval(t);
    for (const s of sockets) s.destroy();
    await new Promise((r) => servidor.close(r));
  }
});

test("el tope de espera no deja temporizadores vivos: se cancela Y va con unref", async () => {
  // Un timer vivo impide que Node termine, que es la otra forma de dejar el job
  // colgado hasta el timeout de 330 min. Hay DOS defensas y las dos hacen falta:
  //   - clearTimeout, para no dejar un temporizador de 10 min colgando del
  //     cierre de la revision;
  //   - unref(), para que ni siquiera mientras existe pueda mantener vivo el
  //     proceso (es el que salva el caso en que el fetch no vuelve nunca).
  // Cada una por separado tapa el sintoma de la otra, asi que contar recursos
  // activos no distingue: se miran los llamados. (Medido el 2026-11-06: con
  // unref puesto, un temporizador sin cancelar NO aparece en
  // getActiveResourcesInfo, asi que el mutante sobrevivia.)
  const originalSet = globalThis.setTimeout;
  const originalClear = globalThis.clearTimeout;
  let creados = 0;
  let cancelados = 0;
  let desreferenciados = 0;
  try {
    globalThis.setTimeout = (...args) => {
      const t = originalSet(...args);
      creados += 1;
      const suUnref = t?.unref?.bind(t);
      if (suUnref) {
        t.unref = () => {
          desreferenciados += 1;
          return suUnref();
        };
      }
      return t;
    };
    globalThis.clearTimeout = (t) => {
      cancelados += 1;
      return originalClear(t);
    };
    await publicar(TEMA, avisoDeCambio(baja()), { servidor: SERVIDOR, timeoutMs: 600000, fetchFn: async () => ({ ok: true }) });
  } finally {
    globalThis.setTimeout = originalSet;
    globalThis.clearTimeout = originalClear;
  }
  assert.equal(creados, 1, "publicar arma UN temporizador de tope de espera");
  assert.equal(desreferenciados, 1, "ese temporizador tiene que ir con unref(): si no, mantiene vivo el proceso");
  assert.equal(cancelados, 1, "y tiene que cancelarse al salir: si no, quedan 10 minutos de temporizador colgando");
});

// ---------------------------------------------------------------------------
// 7. LOS DOS CANDADOS: UN SOLO PORTON, Y EL TEMA FUERA DEL REPO
// ---------------------------------------------------------------------------

test("toda entrega a Discord pasa por una de las dos funciones que copian al celular", () => {
  // EL MUTANTE QUE ESTA PRUEBA MATA: alguien agrega un tercer camino de envio
  // (una seccion nueva, un aviso nuevo) llamando a `enviarMensaje` directo, y
  // esos avisos llegan a Discord pero nunca al celular. Es exactamente la forma
  // del defecto que este repo ya tuvo dos veces con el filtro de accesorios
  // (escrito a mano en los dos caminos) y con los avisos atrasados.
  const fuente = readFileSync(path.join(RAIZ, "src", "discord.mjs"), "utf-8");
  const sinComentarios = fuente.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/gm, "$1 ");
  const llamados = [...sinComentarios.matchAll(/await\s+enviarMensaje\(/g)].length;
  assert.equal(
    llamados,
    2,
    `hay ${llamados} llamados a enviarMensaje y deberian ser 2: el de entregarConCopia (canal de productos) ` +
      `y el de notifyTecnico (canal tecnico). Un tercero llegaria a Discord y nunca al celular.`,
  );
  assert.match(sinComentarios, /async function entregarConCopia[\s\S]*?destinoNtfy\.avisarCambio/, "entregarConCopia dejo de copiar");
  assert.match(sinComentarios, /async function entregarConCopia[\s\S]*?destinoNtfy\.avisarCorreccion/, "entregarConCopia dejo de copiar las correcciones");
  assert.match(sinComentarios, /export async function notifyTecnico[\s\S]*?destinoNtfy\.avisarTecnico/, "notifyTecnico dejo de copiar");
  // y los dos caminos del canal de productos usan la funcion que copia
  assert.match(sinComentarios, /export async function enviarTandaVivo[\s\S]*?entregarConCopia\(/, "el camino EN VIVO no copia");
  assert.match(sinComentarios, /export async function notifyDiscord[\s\S]*?entregarConCopia\(/, "el camino del CIERRE no copia");
});

test("el tema de ntfy no esta escrito en ninguna parte del repositorio", () => {
  // El tema ES la clave: quien lo sabe recibe los avisos del operador y puede
  // publicar en su canal. Vive solo en el secreto NTFY_TEMA del repositorio.
  // Esta prueba busca cualquier cosa con forma de tema real: una URL de ntfy con
  // un tema pegado, o una asignacion de NTFY_TEMA a algo que no sea el secreto.
  const PLACEHOLDERS = ["TU-TEMA-SECRETO", "tema-de-prueba-que-no-existe", "no-es-ntfy-de-verdad"];
  const archivos = [
    ...readdirSync(path.join(RAIZ, "src")).map((f) => path.join("src", f)),
    ...readdirSync(path.join(RAIZ, "test")).filter((f) => f.endsWith(".mjs")).map((f) => path.join("test", f)),
    ...readdirSync(path.join(RAIZ, ".github", "workflows")).map((f) => path.join(".github", "workflows", f)),
    "README.md",
    "BITACORA.md",
  ];
  const culpables = [];
  for (const rel of archivos) {
    let texto;
    try {
      texto = readFileSync(path.join(RAIZ, rel), "utf-8");
    } catch {
      continue; // una carpeta en src/, por ejemplo
    }
    // El `[^.\w]` de delante deja fuera los subdominios de documentacion
    // (`docs.ntfy.sh/publish/`, que es donde estan escritos los limites del
    // servidor) y caza solo el servidor pelado con un tema pegado detras, que es
    // la forma en que un tema real se escaparia a un archivo.
    for (const m of texto.matchAll(/(^|[^.\w])ntfy\.sh\/([A-Za-z0-9_-]{3,})/g)) {
      if (!PLACEHOLDERS.includes(m[2])) culpables.push(`${rel}: ntfy.sh/${m[2]}`);
    }
    for (const m of texto.matchAll(/NTFY_TEMA\s*[:=]\s*["']?([A-Za-z0-9_-]{6,})/g)) {
      if (!PLACEHOLDERS.includes(m[1])) culpables.push(`${rel}: NTFY_TEMA=${m[1]}`);
    }
  }
  assert.deepEqual(culpables, [], `el tema de ntfy no puede quedar escrito en el repo: ${culpables.join(", ")}`);
});

test("y tampoco escrito a secas en un bloque de copiar y pegar del README", () => {
  // AGUJERO MEDIDO (2026-11-06): el repositorio es PUBLICO (`gh repo view` dice
  // PUBLIC) y el README traia, en un bloque de codigo, un tema completo y listo
  // para usar ("elige algo como: …"). El guardia de arriba no lo veia porque
  // solo busca `ntfy.sh/<tema>` y `NTFY_TEMA=<valor>`, y un operador que no
  // programa es justamente quien copia el valor que aparece en el bloque. El
  // tema ES la clave: quien lo sabe recibe los avisos y puede publicar avisos
  // falsos de baja de precio en el telefono del operador.
  //
  // Lo que se busca: en los bloques de codigo del README y de la bitacora, una
  // palabra con forma de tema real -- larga, de minusculas/numeros/guiones y con
  // un trozo hexadecimal de los que nadie escribe a mano.
  const PERMITIDOS = [/^TU-TEMA-SECRETO/i];
  const culpables = [];
  for (const rel of ["README.md", "BITACORA.md"]) {
    const texto = readFileSync(path.join(RAIZ, rel), "utf-8");
    for (const bloque of texto.matchAll(/```[\s\S]*?```/g)) {
      for (const m of bloque[0].matchAll(/[a-z0-9]+(?:-[a-z0-9]+){1,}/g)) {
        const palabra = m[0];
        if (palabra.length < 12) continue;
        if (PERMITIDOS.some((p) => p.test(palabra))) continue;
        // un trozo de 8+ caracteres hexadecimales con digitos y letras mezclados
        // es la firma de un nombre aleatorio, no de una frase en castellano
        if (/[0-9a-f]{8,}/.test(palabra) && /\d/.test(palabra)) culpables.push(`${rel}: ${palabra}`);
      }
    }
  }
  assert.deepEqual(culpables, [], `esto parece un tema de ntfy de verdad escrito en un repo publico: ${culpables.join(", ")}`);
});

test("el servidor por defecto es el publico y se puede apuntar a otro sin tocar codigo", () => {
  // NTFY_SERVIDOR existe para poder correr el pipeline real contra un servidor
  // de mentira en 127.0.0.1 sin publicar jamas en un tema de verdad.
  assert.equal(SERVIDOR_POR_DEFECTO, "https://ntfy.sh");
  process.env.NTFY_SERVIDOR = SERVIDOR;
  const a = crearAvisadorNtfy({ tema: TEMA });
  assert.equal(a.activo, true);
  delete process.env.NTFY_SERVIDOR;
});

test("el workflow le pasa el tema a la revision y al censo, y el aviso de monitor caido tambien copia", () => {
  const monitor = readFileSync(path.join(RAIZ, ".github", "workflows", "monitor.yml"), "utf-8").replace(/\r\n/g, "\n");
  const aviso = readFileSync(path.join(RAIZ, ".github", "workflows", "avisar-falla.yml"), "utf-8").replace(/\r\n/g, "\n");
  const pasos = [...monitor.matchAll(/NTFY_TEMA:\s*\$\{\{\s*secrets\.NTFY_TEMA\s*\}\}/g)].length;
  assert.equal(pasos, 2, "el tema tiene que llegar a los dos procesos que avisan: la revision y el censo");
  // EL AVISO DE "EL MONITOR NO CORRIO" VIVE EN OTRO WORKFLOW y no pasa por
  // Node: sin esto, el unico aviso que no llegaria al celular seria justo el del
  // incidente de las 30 horas (2026-09-23).
  assert.match(aviso, /NTFY_TEMA:\s*\$\{\{\s*secrets\.NTFY_TEMA\s*\}\}/, "el aviso de monitor caido se quedo sin copia al celular");
  assert.match(aviso, /ntfy\.sh/, "falta el envio a ntfy en el aviso de monitor caido");
  assert.match(aviso, /continue-on-error:\s*true/, "la copia al celular no puede poner rojo el aviso de falla");
});

test("el paso de ntfy del aviso de monitor caido cumple las MISMAS reglas que el de Node", () => {
  // AGUJERO MEDIDO (2026-11-06): este paso vive fuera de Node y su prueba solo
  // exigia /ntfy\.sh/, con lo cual "https://ntfy.sh/$NTFY_TEMA" la pasaba igual
  // de bien. O sea las dos propiedades que mas se justifican -- el tema en el
  // CUERPO y no en la URL, y el tope de espera -- no estaban guardadas por nada,
  // justo en el canal que no puede perderse (el incidente de las 30 horas).
  const aviso = readFileSync(path.join(RAIZ, ".github", "workflows", "avisar-falla.yml"), "utf-8").replace(/\r\n/g, "\n");
  // el tema NO puede ir pegado a la URL en ninguna parte del archivo
  for (const m of aviso.matchAll(/ntfy\.sh\/(\S+)/g)) {
    assert.ok(/^publish/.test(m[1]), `el tema no puede viajar en la URL: ntfy.sh/${m[1]}`);
  }
  assert.match(aviso, /-d @ntfy\.json "https:\/\/ntfy\.sh"/, "el POST va al servidor pelado, con el cuerpo en un archivo");
  assert.match(aviso, /jq -n --arg tema "\$NTFY_TEMA"[\s\S]*?\{topic: \$tema/, "el tema tiene que ir dentro del JSON");
  // OJO: el tope de espera se exige sobre la LINEA DEL CURL. Un /--max-time \d+/
  // a secas lo cumple el COMENTARIO que lo explica, y entonces la prueba no
  // defiende nada (medido: el mutante que se lo quitaba al curl sobrevivia).
  assert.match(aviso, /curl -sS --max-time \d+ -X POST[^\n]*ntfy\.json/, "el curl de la copia necesita tope de espera: no puede colgar el workflow");
  // LAS DOS GUARDAS: sin tema no se copia, y sin webhook TAMPOCO -- el paso de
  // Discord termina en verde con `exit 0` cuando falta su secreto, o sea sin
  // mandar nada, y una copia sin original es un aviso que no existe en ninguna
  // parte (defecto medido el 2026-11-06).
  const paso = aviso.slice(aviso.indexOf("Copia al celular por ntfy"));
  assert.match(paso, /if \[ -z "\$\{NTFY_TEMA:-\}" \]/, "falta la guarda del tema");
  assert.match(paso, /if \[ -z "\$\{WEBHOOK:-\}" \]/, "falta la guarda del webhook: se copiaria un aviso que Discord no mando");
  assert.match(paso, /WEBHOOK:\s*\$\{\{\s*secrets\.DISCORD_WEBHOOK_URL\s*\}\}/, "el paso necesita el webhook para poder comprobarlo");
});
