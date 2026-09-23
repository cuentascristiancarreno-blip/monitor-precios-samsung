// EL CAMINO DE ENTREGA DEL CENSO: LO QUE DE VERDAD LE LLEGA AL OPERADOR.
//
// POR QUE EXISTE ESTE ARCHIVO (segunda vuelta del 2026-09-23, defecto de un
// verificador). `src/censo.mjs` es puro y estaba bien cubierto: todos sus
// mutantes morian. Pero `src/censo-cli.mjs` -- el unico archivo nuevo con
// EFECTOS, el que manda el mensaje, frena las repeticiones y guarda la serie --
// solo estaba probado para "se va en cero". Se podia desconectar entero y la
// suite seguia en verde: cinco mutantes sobrevivian, y dos eran serios.
//
//   (a) que el CLI dejara de mandarle el aviso a Discord, que es LA razon de
//       ser del censo;
//   (b) que la huella se guardara aunque Discord hubiera rechazado el envio --
//       con eso, una alarma que NO se entrego queda marcada como avisada y no
//       se reintenta nunca. Es exactamente la leccion del 2026-09-13 que el
//       propio comentario del archivo cita, reimplementada sin cobertura.
//
// COMO SE PRUEBA, y es el mismo trato que ya recibe el camino de avisos de la
// revision: se lanza el CLI como proceso, con la carpeta de datos en un
// directorio temporal y con `DISCORD_WEBHOOK_URL` apuntando a un servidor HTTP
// local de mentira. Nunca se toca el webhook real ni la carpeta de produccion.
import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, writeFile, readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { formaDe } from "../src/censo.mjs";
import { prepararRecorrido, BLOQUE_PRINCIPAL } from "../src/prioridad.mjs";
import { MODO_LIVIANO } from "../src/alcance.mjs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLI = path.join(RAIZ, "src", "censo-cli.mjs");

/**
 * UN SITIO DE JUGUETE CON EL APORTE DEL DESCUBRIMIENTO PUESTO A MANO.
 *
 * OJO CON UNA TRAMPA QUE ESTA PRUEBA PISO Y QUEDA ESCRITA: el CLI lee el seed
 * REAL del repo (`src/seed.json`), no uno de juguete. Un catalogo con URL
 * inventadas deja TODAS sus paginas del lado del descubrimiento, asi que
 * cambiar la proporcion del catalogo no cambia nada de lo que el censo mide.
 * Las paginas de listado salen del seed de verdad y lo unico que se construye
 * es CUANTAS paginas aporta el descubrimiento.
 *
 * Y se construye como PROPORCION, no como numero fijo: si alguien le agrega 200
 * productos al seed, la cuenta sigue dando lo mismo. Es la leccion del incidente
 * aplicada a esta prueba.
 */
const SEED = JSON.parse(readFileSync(path.join(RAIZ, "src", "seed.json"), "utf-8"));
const URLS_SEED = [...new Set(SEED.map((e) => e.url))];

/** Cuantas paginas descubiertas hacen falta para que el descubrimiento aporte `p` del recorrido. */
const familiaPara = (p) => Math.max(1, Math.round((URLS_SEED.length * p) / (1 - p)));

function catalogoConAporte(p) {
  const catalogo = {};
  // unos cuantos SKU colgando de paginas del listado de verdad
  URLS_SEED.slice(0, 40).forEach((url, i) => {
    catalogo[`SEED-${i}`] = { modelo: `SEED-${i}`, categoria: "Smartphones", url, paginaOrigen: url, presencia: "activo", precio: 100 };
  });
  for (let i = 0; i < familiaPara(p); i++) {
    const url = `https://www.samsung.com/cl/smartphones/familia-de-juguete-${i}/buy/`;
    catalogo[`FAM-${i}`] = { modelo: `FAM-${i}`, categoria: "Smartphones", url, paginaOrigen: url, presencia: "activo", precio: 100 };
  }
  return catalogo;
}

/** El descubrimiento aportando MENOS del piso de 10%: el censo tiene algo que decir. */
const CATALOGO_QUE_HABLA = catalogoConAporte(0.05);
/** El descubrimiento comodo sobre el piso: por ese lado el censo se calla. */
const CATALOGO_COMODO = catalogoConAporte(0.4);

/** Un webhook de mentira: guarda lo que le mandan y contesta lo que se le pida. */
async function webhookDeMentira({ responde = 204 } = {}) {
  const recibidos = [];
  // Se lee el cuerpo con `for await` y no con el evento del stream a proposito:
  // el nombre de ese evento es, literal, el de la carpeta que
  // test/candado-offline.test.mjs prohibe nombrar en una prueba, asi que el
  // vigilante lo denunciaria. Es un falso positivo suyo -- no puede distinguir
  // un nombre de evento de un pedazo de ruta -- y la salida correcta es no
  // escribir el literal, no aflojarle el detector.
  const servidor = createServer(async (req, res) => {
    let cuerpo = "";
    for await (const trozo of req) cuerpo += trozo;
    recibidos.push(cuerpo);
    res.writeHead(responde, { "Content-Type": "application/json" });
    res.end("{}");
  });
  await new Promise((listo) => servidor.listen(0, "127.0.0.1", listo));
  const { port } = servidor.address();
  return {
    url: `http://127.0.0.1:${port}/webhook`,
    recibidos,
    cerrar: () => new Promise((listo) => servidor.close(listo)),
  };
}

function correrCli(dir, webhook, extra = {}) {
  return new Promise((resolver) => {
    const env = { ...process.env, CARPETA_DATOS: dir, ...extra };
    delete env.DISCORD_WEBHOOK_URL;
    if (webhook) env.DISCORD_WEBHOOK_URL = webhook;
    execFile(process.execPath, [CLI], { env, cwd: RAIZ }, (err, stdout, stderr) => resolver({ codigo: err?.code ?? 0, stdout, stderr }));
  });
}

async function carpetaCon(catalogo) {
  const dir = await mkdtemp(path.join(tmpdir(), "censo-entrega-"));
  await writeFile(path.join(dir, "latest.json"), JSON.stringify(catalogo));
  await writeFile(path.join(dir, "ejecuciones.jsonl"), `${JSON.stringify({ modo: "completo", alcance: "todo", fin: "2026-09-22T08:00:00Z", confiable: true })}\n`);
  return dir;
}

const serieDe = async (dir) =>
  (await readFile(path.join(dir, "censo.jsonl"), "utf-8").catch(() => ""))
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));

// ---------------------------------------------------------------------------

test("el censo le MANDA el aviso a Discord, y una sola vez", async () => {
  // MUTANTE MEDIDO QUE SOBREVIVIA: reemplazar la llamada a notifyTecnico por
  // `{ entregado: true }` dejaba al censo sin hablarle a Discord -- o sea sin su
  // razon de ser -- con la suite entera en verde.
  const dir = await carpetaCon(CATALOGO_QUE_HABLA);
  const w = await webhookDeMentira();
  try {
    const r = await correrCli(dir, w.url);
    assert.equal(r.codigo, 0, `el censo se fue en ${r.codigo}: eso vuelve a apagar el monitor\n${r.stderr}`);
    assert.equal(w.recibidos.length, 1, "el censo no le mando nada a Discord teniendo algo que decir");
    const contenido = JSON.parse(w.recibidos[0]).content;
    assert.match(contenido, /censo del cat/i);
    assert.match(contenido, /no\*{0,2} detiene el monitor/, "el mensaje no dice que esto no bloquea nada");
  } finally {
    await w.cerrar();
  }
});

test("EL FRENO ES POR CAMBIO: la misma condicion no vuelve a mandar el mismo mensaje todos los dias", async () => {
  // EL DEFECTO QUE ESTO CIERRA. El freno era "una vez al DIA por clave", y el
  // censo esta en atencion permanente (hoy lo esta: la razon de observables
  // quedo pegada a la raya del 80%). Una vez al dia por una condicion que ya se
  // dijo son 365 mensajes identicos al ano por el mismo canal donde llegan las
  // bajas de precio, y la forma mas rapida de que el operador aprenda a
  // saltarselos -- justo antes del dia en que el mensaje traiga algo nuevo.
  const dir = await carpetaCon(CATALOGO_QUE_HABLA);
  const w = await webhookDeMentira();
  try {
    await correrCli(dir, w.url);
    assert.equal(w.recibidos.length, 1);

    const segunda = await correrCli(dir, w.url);
    assert.equal(w.recibidos.length, 1, "el censo repitio el mismo aviso sin que nada hubiera cambiado");
    assert.match(segunda.stdout, /aviso_tecnico_omitido/);

    // ...pero la serie SI queda escrita en las dos corridas: la curva es lo que
    // hace falta la proxima vez, no el ultimo punto
    const serie = await serieDe(dir);
    assert.equal(serie.length, 2, "una corrida que se callo tambien tiene que dejar su fila");
    assert.equal(serie[0].avisado !== null, true, "la primera corrida hablo y no quedo registrada como tal");
    assert.equal(serie[1].avisado, null, "una corrida que NO hablo quedo marcada como si hubiera hablado");
  } finally {
    await w.cerrar();
  }
});

test("...y cuando la condicion CAMBIA, el censo vuelve a hablar en la misma corrida", async () => {
  const dir = await carpetaCon(CATALOGO_QUE_HABLA);
  const w = await webhookDeMentira();
  try {
    await correrCli(dir, w.url);
    assert.equal(w.recibidos.length, 1);

    // el catalogo se mueve: el aporte del descubrimiento sube y el indicador
    // deja la alarma, o sea la clave cambia
    await writeFile(path.join(dir, "latest.json"), JSON.stringify(CATALOGO_COMODO));
    await correrCli(dir, w.url);
    assert.equal(w.recibidos.length, 2, "el censo se quedo callado con una condicion distinta: el freno se comio la novedad");
  } finally {
    await w.cerrar();
  }
});

test("si Discord RECHAZA el aviso, no se marca como avisado y la corrida siguiente lo reintenta", async () => {
  // MUTANTE MEDIDO QUE SOBREVIVIA: guardar la huella sin mirar si el envio se
  // entrego. Con eso una alarma que nunca llego queda marcada como dicha y no
  // se reintenta nunca -- que es literal la leccion del 2026-09-13 que el
  // comentario del archivo cita.
  const dir = await carpetaCon(CATALOGO_QUE_HABLA);
  // 404 ("Unknown Webhook") y no 5xx a proposito: un 5xx dispara los cuatro
  // reintentos con espera exponencial del envio (30 s medidos) y esta suite es
  // el candado que bloquea cada revision. Lo que se prueba es el veredicto, y
  // para el veredicto los dos casos terminan igual: no entregado.
  const malo = await webhookDeMentira({ responde: 404 });
  try {
    const r = await correrCli(dir, malo.url);
    assert.equal(r.codigo, 0, "un rechazo de Discord no puede tumbar la corrida");
    assert.equal(malo.recibidos.length, 1, "ni siquiera intento mandarlo");
    assert.match(r.stderr, /no llego a Discord/);
    const serie = await serieDe(dir);
    assert.equal(serie.at(-1).avisado, null, "se marco como avisado un mensaje que Discord rechazo: no se reintentaria nunca");
  } finally {
    await malo.cerrar();
  }

  const bueno = await webhookDeMentira();
  try {
    await correrCli(dir, bueno.url);
    assert.equal(bueno.recibidos.length, 1, "la corrida siguiente no reintento el aviso que no se habia entregado");
    const serie = await serieDe(dir);
    assert.equal(serie.at(-1).avisado !== null, true);
  } finally {
    await bueno.cerrar();
  }
});

test("la fila de la serie trae los DOCE indicadores, tambien los que estan en verde", async () => {
  // MUTANTE MEDIDO QUE SOBREVIVIA: guardar (o imprimir) solo los indicadores que
  // no estan en ok. Sin los verdes no hay curva, y sin curva la deriva del 79,5%
  // vuelve a tener que reconstruirse a mano desde git DESPUES del incidente, que
  // es exactamente lo que paso.
  const dir = await carpetaCon(CATALOGO_COMODO);
  const w = await webhookDeMentira();
  try {
    const r = await correrCli(dir, w.url);
    assert.equal(r.codigo, 0);
    const serie = await serieDe(dir);
    assert.equal(serie.length, 1, "la corrida no dejo su fila: ahi se pierde la curva");
    assert.ok(serie[0].t, "la fila no trae marca de tiempo: sin eso no se puede calcular ninguna deriva");
    assert.equal(Object.keys(serie[0].censo).length, 12, "la fila no trae los doce indicadores");
    assert.ok(typeof serie[0].censo["aporte-descubrimiento"] === "number", "la fila no trae los numeros");
    assert.ok(typeof serie[0].censo["observables-sin-descubrimiento"] === "number");
    // y los verdes estan adentro: el log de la corrida los imprime todos
    assert.match(r.stdout, /INFO censo aporte-descubrimiento/, "los indicadores en verde dejaron de salir en el log de la corrida");
    assert.match(r.stdout, /INFO censo completas-sospechosas/);
  } finally {
    await w.cerrar();
  }
});

test("la deriva que sale en el mensaje viene de la serie, no de la nada", async () => {
  // Es la comprobacion de punta a punta de lo que el operador va a leer: que la
  // linea "hace N dias iba en X" salga del archivo que el propio censo escribio
  // en las corridas anteriores.
  const dir = await carpetaCon(CATALOGO_COMODO);
  const w = await webhookDeMentira();
  try {
    // primera corrida: el descubrimiento comodo, y deja su fila
    await correrCli(dir, w.url);
    const antes = w.recibidos.length;

    // el descubrimiento se derrumba: hay algo NUEVO que decir, y el mensaje
    // tiene que traer de donde venia
    await writeFile(path.join(dir, "latest.json"), JSON.stringify(CATALOGO_QUE_HABLA));
    await correrCli(dir, w.url);
    assert.equal(w.recibidos.length, antes + 1, "el censo no volvio a hablar con una condicion distinta");
    const contenido = JSON.parse(w.recibidos.at(-1)).content;
    assert.match(contenido, /↳ /, "el mensaje no trajo la deriva");
    assert.match(contenido, /saltó en esta revisión desde 40\.0%/, "la deriva no salio de la fila que la corrida anterior escribio");
  } finally {
    await w.cerrar();
  }
});

test("sin webhook el censo no manda nada y NO se marca como avisado", async () => {
  // Es el caso de una corrida de prueba local. Marcarlo como avisado dejaria el
  // freno envenenado: la corrida de produccion siguiente creeria que la
  // condicion ya salio y se quedaria callada.
  const dir = await carpetaCon(CATALOGO_QUE_HABLA);
  const r = await correrCli(dir, null);
  assert.equal(r.codigo, 0);
  const serie = await serieDe(dir);
  assert.equal(serie.length, 1);
  assert.equal(serie.at(-1).avisado, null, "una corrida sin webhook se marco como avisada: el freno queda envenenado para produccion");
});

test("el censo no puede tumbar la corrida ni siquiera con el webhook apuntando a la nada", async () => {
  // Un puerto muerto: el fetch falla con una excepcion, no con un 500. Si esa
  // excepcion escapara, el paso del workflow se pondria rojo -- y el censo
  // volveria a ser un canario cableado al interruptor.
  const dir = await carpetaCon(CATALOGO_QUE_HABLA);
  // sin reintentos de red: el envio los hace con espera exponencial (30 s
  // medidos) y aca lo que importa es el veredicto, no la paciencia
  const r = await correrCli(dir, "http://127.0.0.1:1/webhook", { DISCORD_REINTENTOS_RED: "0", DISCORD_BACKOFF_MS: "1" });
  assert.equal(r.codigo, 0, `el censo se fue en ${r.codigo} con el webhook muerto: eso vuelve a apagar el monitor\n${r.stderr}`);
  const serie = await serieDe(dir);
  assert.equal(serie.at(-1)?.avisado ?? null, null, "se marco como avisado un mensaje que nunca salio");
});

/**
 * UN CATALOGO CONSTRUIDO QUE DEJA EL CENSO ENTERO EN VERDE.
 *
 * POR QUE ESTA CONSTRUIDO Y NO HEREDADO, y es la leccion del incidente aplicada
 * a esta prueba: la primera version partia de la fixture congelada y le agregaba
 * SKU. Medido poniendo cada uno de los 532 snapshots del historial como
 * fixture, esa version era LA ASERCION MAS FRAGIL DE TODA LA SUITE -- rompia en
 * 344 de 532, mas que las dos preexistentes (340) -- porque exigia que la
 * fixture se pareciera al catalogo de produccion de hoy. O sea: una prueba del
 * candado atada al contenido de un archivo que una persona va a cambiar.
 *
 * Aca no se hereda nada salvo los NOMBRES de los campos de la fixture, que es lo
 * unico que `fixture-al-dia` compara. Las paginas salen del seed real y las
 * proporciones estan puestas a mano:
 *   185 SKU dentro del bloque liviano · 146 televisores fuera (la premisa del
 *   televisor) · 650 SKU mas fuera del bloque · 160 paginas de familia
 *   inventadas bajo /smartphones/.../buy/ (el descubrimiento aporta 13,5%).
 * Medido sobre 7 fixtures repartidas en los 65 dias de historia: verde en 6 de
 * 7; la unica que no es la del 2026-07-19, de antes de que el registro tuviera
 * `categoria` y `presencia`.
 */
function catalogoConElCensoEnVerde(fixture) {
  const campos = formaDe(fixture);
  const liviano = prepararRecorrido({ seedRaw: SEED, familyEntries: [], modo: MODO_LIVIANO, bloque: BLOQUE_PRINCIPAL });
  const dentro = SEED.filter((e) => liviano.alcance.paginas.has(e.url)).map((e) => e.url);
  const teleFuera = SEED.filter((e) => e.categoria === "Televisores" && !liviano.alcance.paginas.has(e.url)).map((e) => e.url);
  const restoFuera = SEED.filter((e) => !liviano.alcance.paginas.has(e.url) && e.categoria !== "Televisores").map((e) => e.url);

  // El registro trae EXACTAMENTE los campos de la fixture y ninguno mas: si
  // agregara uno, `fixture-al-dia` lo denunciaria y la prueba dejaria de medir
  // lo que dice medir.
  const registro = (modelo, url, categoria) => {
    const r = {};
    for (const k of campos) r[k] = null;
    const poner = (k, v) => {
      if (k in r) r[k] = v;
    };
    r.url = url;
    poner("paginaOrigen", url);
    poner("modelo", modelo);
    poner("categoria", categoria);
    poner("presencia", "activo");
    poner("precio", 100);
    return r;
  };

  const catalogo = {};
  dentro.slice(0, 185).forEach((u, i) => (catalogo[`DENTRO-${i}`] = registro(`DENTRO-${i}`, u, "Smartphones")));
  teleFuera.slice(0, 146).forEach((u, i) => (catalogo[`TV-${i}`] = registro(`TV-${i}`, u, "Televisores")));
  restoFuera.slice(0, 650).forEach((u, i) => (catalogo[`FUERA-${i}`] = registro(`FUERA-${i}`, u, "Refrigeradores")));
  for (let i = 0; i < 160; i++) {
    const url = `https://www.samsung.com/cl/smartphones/galaxy-construido-${i}/buy/`;
    catalogo[`FAM-${i}`] = registro(`FAM-${i}`, url, "Smartphones");
  }
  return catalogo;
}

test("con el censo ENTERO EN VERDE no se manda nada, pero la fila de la serie se escribe igual", async () => {
  // MUTANTE MEDIDO QUE SOBREVIVIA: sacar el `guardarSerie(null)` de la rama "no
  // hay nada que decir". Con eso la serie solo guarda los dias en que algo anda
  // mal, y la curva -- que es lo unico que contesta "¿esto saltó hoy o viene
  // derivando hace días?" -- queda con agujeros justo en los tramos sanos, que
  // son la referencia contra la que se mide todo lo demas. Es la forma callada
  // de volver al 2026-09-22, cuando la deriva hubo que reconstruirla a mano.
  const fixture = JSON.parse(readFileSync(path.join(RAIZ, "test", "fixtures", "catalogo.json"), "utf-8"));
  const dir = await carpetaCon(catalogoConElCensoEnVerde(fixture));
  const w = await webhookDeMentira();
  try {
    const r = await correrCli(dir, w.url);
    assert.equal(r.codigo, 0);
    assert.match(r.stdout, /censo_estado ok/, "esta prueba necesita un censo entero en verde y no lo consiguio");
    assert.equal(w.recibidos.length, 0, "el censo hablo sin tener nada que decir");
    const serie = await serieDe(dir);
    assert.equal(serie.length, 1, "un dia sano no dejo su fila: la curva queda con agujeros justo en los tramos de referencia");
    assert.equal(serie[0].censoEstado, "ok");
    assert.equal(Object.keys(serie[0].censo).length, 12);
  } finally {
    await w.cerrar();
  }
});
