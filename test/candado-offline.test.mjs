// EL CANDADO CORRE OFFLINE Y NO ABRE LA CARPETA DE DATOS DE PRODUCCION.
//
// ESTA ES LA PRUEBA QUE IMPIDE QUE EL INCIDENTE DEL 2026-09-22/23 VUELVA A
// PASAR, y es la unica del proyecto cuyo sujeto es la propia suite.
//
// LO QUE PASO. `npm test` es el paso del workflow que BLOQUEA la corrida
// (.github/workflows/monitor.yml, "Pruebas automatizadas"). Dentro de ese
// candado habia aserciones que no preguntaban nada sobre el codigo: preguntaban
// sobre la FORMA DEL CATALOGO DE HOY, leyendo el catalogo de produccion, que las
// propias corridas reescriben y commitean 20 veces al dia. Eso no es una prueba,
// es un canario -- y un canario no puede estar cableado a un interruptor que
// apaga el sistema. El catalogo crecio, cruzo solo una raya del 80%, y el
// monitor quedo 30 HORAS CAIDO: 24 corridas fallidas seguidas, cero avisos a
// Discord, y el operador se entero por un correo de GitHub.
//
// LA MEDICION QUE LO DIMENSIONA. Se cargaron los 532 snapshots del catalogo que
// hay en el historial de git (2026-07-19 a 2026-09-22), uno por uno, en arboles
// fuera del repo, y se corrio la suite ENTERA contra cada uno: **340 de 532
// (63,9%) tumbaban `npm test`**. Por mes: julio 62 de 66, agosto 199 de 199,
// septiembre 79 de 267. La suite estaba verde solo para la forma de catalogo que
// existe desde el 2026-09-12/13, o sea 10 dias de los 65 del historial. Despues
// del desacople: **0 de 532**.
//
// LA REGLA, EN UNA LINEA: una prueba del candado no abre la carpeta de datos. Si
// su respuesta puede cambiar sin que nadie toque una linea de codigo, no es una
// prueba: es un canario, y su lugar es `npm run censo` (src/censo.mjs), que
// avisa por el canal tecnico y no bloquea ninguna corrida.
//
// QUE NO VIGILA ESTA PRUEBA, dicho con todas sus letras: mira el TEXTO de los
// archivos de prueba, asi que caza la forma en que el acoplamiento se introduce
// de verdad (un `readFileSync` con la ruta escrita), pero no una ruta armada en
// tiempo de ejecucion a pedazos. Por eso ademas esta la segunda prueba, que
// comprueba lo mismo por el otro lado: que ningun archivo de prueba importe
// `src/run.mjs` ni `src/discover.mjs`, que son las dos puertas al exterior.
//
// Y TIENE FALSOS POSITIVOS, que tambien se dicen: el nombre de la carpeta
// prohibida es ademas el nombre del evento con que un stream de Node entrega su
// cuerpo, asi que un servidor HTTP de mentira escrito con ese evento queda
// denunciado sin haber abierto nada. Paso de verdad escribiendo
// test/censo-entrega.test.mjs el 2026-09-23. La salida correcta es no escribir
// el literal (ahi se uso `for await`), no aflojarle el detector: un detector
// mas permisivo deja pasar el acoplamiento de verdad, y el costo de un falso
// positivo es una linea distinta en una prueba.
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const YO = path.basename(fileURLToPath(import.meta.url));

/**
 * El nombre de la carpeta prohibida se arma en pedazos A PROPOSITO.
 *
 * Si estuviera escrito entero, este mismo archivo -- que es uno de los que se
 * revisan -- se denunciaria a si mismo, y la salida facil seria excluirlo de la
 * revision: o sea dejar sin vigilancia justo al vigilante. Armandolo asi, el
 * archivo se revisa como todos los demas y la prueba sigue siendo honesta. Es la
 * misma razon por la que los ejemplos de la ultima prueba se arman igual.
 */
const PROHIBIDA = ["da", "ta"].join("");

/**
 * Las dos formas en que una ruta a la carpeta de produccion aparece en el
 * codigo, y solo esas dos:
 *   1. como argumento suelto de un path.join, entre comillas;
 *   2. como segmento de una ruta escrita entera, con su separador detras.
 * Ninguna de las dos caza "metadata/x" ni "datacenter": la primera exige
 * comillas a los dos lados, la segunda exige que lo que precede sea el principio
 * de la ruta, una comilla o un separador.
 */
const PATRONES = [
  new RegExp(`["'\`]${PROHIBIDA}["'\`]`),
  new RegExp(`(^|["'\`./\\\\])${PROHIBIDA}[/\\\\]`),
];

const ARCHIVOS_DE_PRUEBA = readdirSync(AQUI)
  .filter((f) => f.endsWith(".test.mjs"))
  .sort();

/**
 * Le saca al codigo fuente los comentarios.
 *
 * POR QUE HACE FALTA: los archivos de prueba de este proyecto citan el catalogo
 * y el historial de produccion en sus comentarios todo el tiempo, porque ahi
 * esta escrita la medicion de la que salio cada prueba. Esas citas son
 * documentacion y tienen que poder quedarse; lo que no puede quedarse es una
 * ruta de verdad. Medido: de los 28 archivos de prueba que existian el
 * 2026-09-23, NUEVE nombraban el catalogo en comentarios y solo DOS lo abrian.
 *
 * Se revisa el codigo entero y no solo el interior de los strings a proposito:
 * un tokenizador de strings hecho a mano se puede desincronizar con una comilla
 * dentro de un template y dejar de ver justo lo que busca. Esto no se
 * desincroniza.
 */
function sinComentarios(fuente) {
  return fuente
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/gm, "$1 ");
}

/** Los culpables de un archivo: las rutas a la carpeta de datos que quedan en el codigo. */
function rutasDeProduccion(fuente) {
  const codigo = sinComentarios(fuente);
  return PATRONES.some((p) => p.test(codigo));
}

/**
 * Las dos puertas al exterior. `src/run.mjs` arranca `main()` al importarse --
 * por eso `procesarEntrada` se mudo a `src/resolver.mjs` el 2026-09-11 -- y
 * `src/discover.mjs` le pide los sitemaps a Samsung. Importar cualquiera de los
 * dos desde una prueba serian requests reales a samsung.com en cada `npm test`,
 * o sea 20 veces al dia desde el runner de GitHub, contra la politica de
 * scraping del propio proyecto.
 */
function importaPuertaAlExterior(fuente) {
  const codigo = sinComentarios(fuente);
  return [...codigo.matchAll(/(?:from|import)\s*\(?\s*(["'`])([^"'`]+)\1/g)].map((m) => m[2]).filter((r) => /\/(run|discover)\.mjs$/.test(r));
}

test("ninguna prueba del candado abre la carpeta de datos: si su respuesta cambia sola, no es una prueba", () => {
  const culpables = ARCHIVOS_DE_PRUEBA.filter((f) => rutasDeProduccion(readFileSync(path.join(AQUI, f), "utf-8")));
  assert.deepEqual(
    culpables,
    [],
    `estas pruebas volvieron a cablear el canario al interruptor: ${culpables.join(", ")}. ` +
      `Un archivo que las corridas reescriben 20 veces al dia no puede decidir si el monitor arranca. ` +
      `Congela una fixture en test/fixtures/ (ver test/fixtures/LEEME.md) o mueve la comprobacion a src/censo.mjs.`,
  );
});

test("y tampoco se importa ninguna de las dos puertas al exterior (run.mjs, discover.mjs)", () => {
  const culpables = ARCHIVOS_DE_PRUEBA.flatMap((f) =>
    importaPuertaAlExterior(readFileSync(path.join(AQUI, f), "utf-8")).map((r) => `${f}: ${r}`),
  );
  assert.deepEqual(culpables, [], `una prueba importa una puerta al exterior: ${culpables.join(", ")}`);
});

test("la revision se aplica a TODOS los archivos de prueba, incluido este", () => {
  // El mutante obvio contra las dos pruebas de arriba es achicar la lista de
  // archivos que revisan (excluir uno, o excluirse a si misma) y dejarlas verdes
  // sin que vigilen nada. Esta prueba fija el tamano de la lista contra lo que
  // hay en el disco y exige que este mismo archivo este adentro.
  const enDisco = readdirSync(AQUI).filter((f) => f.endsWith(".test.mjs"));
  assert.equal(ARCHIVOS_DE_PRUEBA.length, enDisco.length, "la revision se salta archivos de prueba");
  assert.ok(ARCHIVOS_DE_PRUEBA.length >= 29, `solo se encontraron ${ARCHIVOS_DE_PRUEBA.length} archivos de prueba: la lista se vacio`);
  assert.ok(ARCHIVOS_DE_PRUEBA.includes(YO), "el vigilante se saco a si mismo de la revision");
});

test("el detector caza una ruta de produccion y deja pasar el comentario que la nombra", () => {
  // LA PRUEBA DE LA PRUEBA. Sin esto, un detector que no encuentra NADA no se
  // distingue de uno roto, y las tres pruebas de arriba serian decorativas. Las
  // dos mitades importan: que cace lo que tiene que cazar, y que deje pasar la
  // documentacion -- que es lo que hace falta para que los 29 archivos de hoy
  // pasen sin borrarles las mediciones de sus comentarios.
  //
  // Los ejemplos se arman con PROHIBIDA por la misma razon que la constante: si
  // estuvieran escritos enteros, este archivo seria culpable de su propia
  // revision.
  const D = PROHIBIDA;
  const caza = (fuente) => rutasDeProduccion(fuente);

  assert.equal(caza(`readFileSync(path.join(RAIZ, "${D}", "latest.json"))`), true, "no caza el segmento suelto");
  assert.equal(caza(`readFileSync("${D}/latest.json")`), true, "no caza la ruta entera");
  assert.equal(caza(`readFileSync("./${D}/history.jsonl")`), true, "no caza la ruta relativa");
  assert.equal(caza(`readFileSync(new URL("../${D}/ejecuciones.jsonl", import.meta.url))`), true, "no caza el new URL");
  assert.equal(caza(`const RUTA = \`\${RAIZ}/${D}/latest.json\`;`), true, "no caza la ruta dentro de un template");

  assert.equal(caza(`// medido sobre ${D}/latest.json: 929 vivos`), false, "se comio un comentario de linea");
  assert.equal(caza(`  // la ola de ${D}/history.jsonl del 09-09`), false, "se comio un comentario indentado");
  assert.equal(caza(`/* la ola de ${D}/history.jsonl del 09-09 */`), false, "se comio un comentario de bloque");
  assert.equal(caza(`const x = "meta${D}/algo"; const y = "${D}center";`), false, "caza palabras que solo contienen el nombre");
  assert.equal(caza(`readFileSync(path.join(RAIZ, "test", "fixtures", "catalogo.json"))`), false, "una fixture congelada no puede ser culpable");

  // Y LA MISMA PRUEBA PARA EL DETECTOR DE PUERTAS AL EXTERIOR. Sin esto, borrar
  // esa comprobacion entera dejaba la suite en verde (mutante medido): el
  // detector no encontraba nada porque hoy nadie importa esas puertas, y no
  // encontrar nada era indistinguible de estar roto.
  //
  // Los nombres se arman en pedazos por la misma razon que PROHIBIDA: escritos
  // enteros, estos ejemplos serian imports de verdad a los ojos de la prueba de
  // arriba y este archivo se denunciaria a si mismo.
  const RUN = ["ru", "n"].join("");
  const DESCUBRIR = ["disco", "ver"].join("");
  assert.deepEqual(importaPuertaAlExterior(`import { main } from "../src/${RUN}.mjs";`), [`../src/${RUN}.mjs`]);
  assert.deepEqual(importaPuertaAlExterior(`const m = await import("../src/${DESCUBRIR}.mjs");`), [`../src/${DESCUBRIR}.mjs`]);
  assert.deepEqual(importaPuertaAlExterior(`import { comparar } from "../src/comparar.mjs";`), [], "una puerta que no lo es quedo denunciada");
  assert.deepEqual(importaPuertaAlExterior(`  // no se puede importar ../src/${RUN}.mjs desde una prueba`), [], "se comio un comentario que la nombra");
});
