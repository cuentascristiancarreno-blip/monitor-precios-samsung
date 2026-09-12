// EL ORDEN DEL RECORRIDO. Dos cosas distintas se prueban aca:
//
//  1. que el recorrido EMPIECE por las categorias que pidio el operador, en su
//     orden, y que eso no se rompa ni se calle si el listado cambia;
//  2. que cambiar el orden NO cambie el RESULTADO. Esta es la parte importante:
//     el sistema ya tuvo un defecto medido por orden de llegada de las paginas
//     (2026-09-12, el precio de LISTA de la pagina familia firmado como si fuera
//     de la ficha propia; ver BITACORA.md), asi que un reordenamiento tiene que
//     demostrar que no despierta nada parecido.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CATEGORIAS_PRINCIPALES,
  inversionesIntraSeccion,
  medicionPrincipales,
  ordenarRecorrido,
  prepararRecorrido,
  seccionDeUrl,
  skusQueCambiaronDeSeccion,
} from "../src/prioridad.mjs";
import { integrarVariantes } from "../src/catalogo.mjs";
import { comparar } from "../src/comparar.mjs";
import { ganaElEmpate } from "../src/identidad.mjs";

const TS = "2026-09-12T18:00:00.000Z";

const listado = (categoria, url, extra = {}) => ({ categoria, subcategoria: "x", nombre: "n", variante: "—", modelo: "z", url, ...extra });
const familia = (url) => ({ categoria: "Familia (auto-descubierta)", subcategoria: null, nombre: null, variante: null, modelo: null, url, tipo: "familia" });

// El listado REAL: varias pruebas se apoyan en el, porque es ahi donde las
// suposiciones de este modulo pueden dejar de ser ciertas.
const SEED_REAL = JSON.parse(readFileSync(new URL("../src/seed.json", import.meta.url), "utf-8"));

// ---------------------------------------------------------------------------
// 1. La lista que edita el operador
// ---------------------------------------------------------------------------

test("las categorias principales son las cinco que pidio el operador, en su orden", () => {
  assert.deepStrictEqual(
    CATEGORIAS_PRINCIPALES.map((c) => c.categoria),
    ["Smartphones", "Tablets", "Audio y Galaxy Buds", "Relojes (Galaxy Watch)", "Computadores"],
  );
});

test("los nombres declarados existen tal cual en el listado real", () => {
  // Si alguien escribe "Computadoras" (como lo dijo el operador) en vez de
  // "Computadores" (como lo dice seed.json), la categoria se vuelve invisible.
  const seed = JSON.parse(readFileSync(new URL("../src/seed.json", import.meta.url), "utf-8"));
  const reales = new Set(seed.map((e) => e.categoria));
  for (const { categoria } of CATEGORIAS_PRINCIPALES) {
    assert.ok(reales.has(categoria), `"${categoria}" no existe en src/seed.json`);
  }
});

test("los soundbars NO son una categoria principal: el operador no los pidio", () => {
  const nombres = CATEGORIAS_PRINCIPALES.map((c) => c.categoria);
  assert.ok(!nombres.includes("Audio (Soundbars/Torres)"));
  // y no se cuelan por la seccion: audio-sound (Buds) y audio-devices (torres)
  // son secciones distintas, verificado sobre las 1.023 paginas del listado
  const soundbar = listado("Audio (Soundbars/Torres)", "https://www.samsung.com/cl/audio-devices/soundbar/hw-q990f/");
  const buds = listado("Audio y Galaxy Buds", "https://www.samsung.com/cl/audio-sound/galaxy-buds/buds3-pro/");
  const { recorrido, paginasPrincipales } = ordenarRecorrido([soundbar, buds]);
  assert.equal(paginasPrincipales, 1);
  assert.equal(recorrido[0], buds);
});

test("seccionDeUrl saca el tramo bajo /cl/ y no revienta con una URL rota", () => {
  assert.equal(seccionDeUrl("https://www.samsung.com/cl/smartphones/galaxy-s/x/"), "smartphones");
  assert.equal(seccionDeUrl("https://www.samsung.com/cl/watches/galaxy-fit/x/buy/"), "watches");
  assert.equal(seccionDeUrl("no-es-una-url"), "no-es-una-url");
  assert.equal(seccionDeUrl(null), null);
  assert.equal(seccionDeUrl(""), null);
});

// ---------------------------------------------------------------------------
// 2. El reordenamiento
// ---------------------------------------------------------------------------

const RECORRIDO_CRUDO = [
  // el listado real viene ordenado alfabeticamente por categoria: las que el
  // operador quiere primero estan en los puestos 11, 24, 26 y 28 de 28
  listado("Accesorios móviles", "https://www.samsung.com/cl/mobile-accessories/funda-a/"),
  listado("Accesorios móviles", "https://www.samsung.com/cl/mobile-accessories/funda-b/"),
  listado("Audio y Galaxy Buds", "https://www.samsung.com/cl/audio-sound/galaxy-buds/buds3-pro/"),
  listado("Computadores", "https://www.samsung.com/cl/computers/galaxy-book/book5/"),
  listado("Relojes (Galaxy Watch)", "https://www.samsung.com/cl/watches/galaxy-watch/w8/"),
  listado("Smartphones", "https://www.samsung.com/cl/smartphones/galaxy-s/s26-ultra/"),
  listado("Smartphones", "https://www.samsung.com/cl/smartphones/galaxy-z/fold7/"),
  listado("Tablets", "https://www.samsung.com/cl/tablets/galaxy-tab-s/tab-s10/"),
  listado("Televisores", "https://www.samsung.com/cl/tvs/qled/q80f/"),
  familia("https://www.samsung.com/cl/computers/galaxy-book/book5/buy/"),
  familia("https://www.samsung.com/cl/smartphones/galaxy-s/s26-ultra/buy/"),
  familia("https://www.samsung.com/cl/tvs/qled/q80f/buy/"),
  familia("https://www.samsung.com/cl/watches/galaxy-fit/fit3/buy/"),
];

const urls = (lista) => lista.map((e) => e.url);

test("el recorrido arranca por las categorias principales, en el orden del operador", () => {
  const { recorrido, paginasPrincipales } = ordenarRecorrido(RECORRIDO_CRUDO);
  assert.deepStrictEqual(urls(recorrido).slice(0, paginasPrincipales), [
    // Smartphones: listado y despues su pagina familia
    "https://www.samsung.com/cl/smartphones/galaxy-s/s26-ultra/",
    "https://www.samsung.com/cl/smartphones/galaxy-z/fold7/",
    "https://www.samsung.com/cl/smartphones/galaxy-s/s26-ultra/buy/",
    // Tablets
    "https://www.samsung.com/cl/tablets/galaxy-tab-s/tab-s10/",
    // Audio y Galaxy Buds
    "https://www.samsung.com/cl/audio-sound/galaxy-buds/buds3-pro/",
    // Relojes
    "https://www.samsung.com/cl/watches/galaxy-watch/w8/",
    "https://www.samsung.com/cl/watches/galaxy-fit/fit3/buy/",
    // Computadores
    "https://www.samsung.com/cl/computers/galaxy-book/book5/",
    "https://www.samsung.com/cl/computers/galaxy-book/book5/buy/",
  ]);
  assert.equal(paginasPrincipales, 9);
});

test("dentro de una categoria se conserva el orden del listado", () => {
  const { recorrido } = ordenarRecorrido(RECORRIDO_CRUDO);
  const i = urls(recorrido).indexOf("https://www.samsung.com/cl/smartphones/galaxy-s/s26-ultra/");
  const j = urls(recorrido).indexOf("https://www.samsung.com/cl/smartphones/galaxy-z/fold7/");
  assert.ok(i < j, "el S26 Ultra viene antes que el Fold7 en el listado y tiene que seguir asi");
});

test("las paginas familia de una seccion principal van en el bloque de SU categoria", () => {
  const { recorrido } = ordenarRecorrido(RECORRIDO_CRUDO);
  const pos = new Map(recorrido.map((e, i) => [e.url, i]));
  // la familia de relojes entra antes que el listado de Computadores: esta
  // adentro del bloque de Relojes, no en un bloque unico al final
  assert.ok(pos.get("https://www.samsung.com/cl/watches/galaxy-fit/fit3/buy/") < pos.get("https://www.samsung.com/cl/computers/galaxy-book/book5/"));
  // y la familia de TV, que no es de ninguna categoria principal, no se cuela
  assert.ok(pos.get("https://www.samsung.com/cl/tvs/qled/q80f/buy/") > pos.get("https://www.samsung.com/cl/computers/galaxy-book/book5/buy/"));
});

test("dentro de una categoria, la pagina familia va DESPUES de la del listado", () => {
  // Es la propiedad de la que depende todo lo demas: hay 126 paginas /buy/
  // descubiertas cuya ficha plana tambien esta en el listado, y para ese par el
  // orden de llegada decide quien firma el registro.
  const { recorrido } = ordenarRecorrido(RECORRIDO_CRUDO);
  const pos = new Map(recorrido.map((e, i) => [e.url, i]));
  assert.ok(pos.get("https://www.samsung.com/cl/smartphones/galaxy-s/s26-ultra/") < pos.get("https://www.samsung.com/cl/smartphones/galaxy-s/s26-ultra/buy/"));
  assert.ok(pos.get("https://www.samsung.com/cl/computers/galaxy-book/book5/") < pos.get("https://www.samsung.com/cl/computers/galaxy-book/book5/buy/"));
});

test("una pagina descubierta se reconoce por cualquiera de sus dos marcas", () => {
  // discover.mjs marca sus paginas de dos formas (tipo "familia" y la categoria
  // generica). Mirar las dos es lo que evita que renombrar una deje la
  // deteccion coja y una /buy/ se adelante a la ficha plana de su producto.
  const soloTipo = { categoria: "Smartphones", url: "https://www.samsung.com/cl/smartphones/galaxy-s/a/buy/", tipo: "familia" };
  const soloCategoria = { categoria: "Familia (auto-descubierta)", url: "https://www.samsung.com/cl/smartphones/galaxy-s/b/buy/" };
  const ficha = listado("Smartphones", "https://www.samsung.com/cl/smartphones/galaxy-s/c/");
  // llegan ANTES que la ficha en el insumo: si alguna dejara de reconocerse como
  // descubierta, se quedaria adelante
  const { recorrido } = ordenarRecorrido([soloTipo, soloCategoria, ficha]);
  assert.deepStrictEqual(urls(recorrido), [ficha.url, soloTipo.url, soloCategoria.url]);
});

test("lo que no es categoria principal va despues, en su orden original", () => {
  const { recorrido, paginasPrincipales } = ordenarRecorrido(RECORRIDO_CRUDO);
  assert.deepStrictEqual(urls(recorrido).slice(paginasPrincipales), [
    "https://www.samsung.com/cl/mobile-accessories/funda-a/",
    "https://www.samsung.com/cl/mobile-accessories/funda-b/",
    "https://www.samsung.com/cl/tvs/qled/q80f/",
    "https://www.samsung.com/cl/tvs/qled/q80f/buy/",
  ]);
});

test("no se pierde ni se duplica ninguna pagina", () => {
  const { recorrido } = ordenarRecorrido(RECORRIDO_CRUDO);
  assert.equal(recorrido.length, RECORRIDO_CRUDO.length);
  assert.deepStrictEqual(urls(recorrido).slice().sort(), urls(RECORRIDO_CRUDO).slice().sort());
  for (const e of RECORRIDO_CRUDO) assert.ok(recorrido.includes(e), `${e.url} desaparecio del recorrido`);
});

test("el reordenamiento es estable: mismo insumo, mismo orden, siempre", () => {
  const a = ordenarRecorrido(RECORRIDO_CRUDO).recorrido;
  const b = ordenarRecorrido(RECORRIDO_CRUDO).recorrido;
  assert.deepStrictEqual(urls(a), urls(b));
  // y reordenar lo ya ordenado no lo mueve (idempotente)
  assert.deepStrictEqual(urls(ordenarRecorrido(a).recorrido), urls(a));
});

test("un recorrido vacio no revienta", () => {
  assert.deepStrictEqual(ordenarRecorrido([]).recorrido, []);
  assert.equal(ordenarRecorrido([]).paginasPrincipales, 0);
  assert.deepStrictEqual(ordenarRecorrido(undefined).recorrido, []);
});

test("porCategoria cuenta las paginas de cada bloque principal", () => {
  const { porCategoria } = ordenarRecorrido(RECORRIDO_CRUDO);
  assert.deepStrictEqual(porCategoria, [
    { categoria: "Smartphones", listado: 2, familia: 1 },
    { categoria: "Tablets", listado: 1, familia: 0 },
    { categoria: "Audio y Galaxy Buds", listado: 1, familia: 0 },
    { categoria: "Relojes (Galaxy Watch)", listado: 1, familia: 1 },
    { categoria: "Computadores", listado: 1, familia: 1 },
  ]);
});

test("LA SECCION DECLARADA DE CADA CATEGORIA ES LA QUE USA DE VERDAD EN EL LISTADO", () => {
  // Esta prueba existe por un agujero medido: el valor `seccion: "tablets"` era
  // el unico de los cinco que sobrevivia a su mutante (escribir "tablet" dejaba
  // la suite entera en verde), porque el recorrido de juguete no tenia ninguna
  // pagina familia bajo /tablets/ y esa entrada siempre calzaba por NOMBRE.
  //
  // Y OJO CON LA TRAMPA: fabricar la pagina de prueba a partir del `seccion`
  // declarado no sirve de nada -- el typo se fabricaria a si mismo y la prueba
  // pasaria igual. La seccion tiene que salir de los DATOS REALES: donde viven
  // de verdad, en src/seed.json, las paginas de esa categoria.
  const seccionReal = new Map();
  for (const e of SEED_REAL) {
    if (!seccionReal.has(e.categoria)) seccionReal.set(e.categoria, new Set());
    seccionReal.get(e.categoria).add(seccionDeUrl(e.url));
  }
  for (const { categoria, seccion } of CATEGORIAS_PRINCIPALES) {
    const reales = [...(seccionReal.get(categoria) ?? [])];
    assert.deepStrictEqual(
      reales,
      [seccion],
      `"${categoria}" vive de verdad en ${JSON.stringify(reales)} y en src/prioridad.mjs dice "${seccion}"`,
    );
  }
});

test("...y una pagina familia de esa seccion real cae en el bloque de su categoria", () => {
  // La otra mitad: que el valor declarado se USE para rutear. Se recorre la
  // lista entera, asi quedan cubiertas las cinco y las que se agreguen manana.
  const seccionReal = new Map(
    CATEGORIAS_PRINCIPALES.map(({ categoria }) => [
      categoria,
      seccionDeUrl(SEED_REAL.find((e) => e.categoria === categoria)?.url),
    ]),
  );
  for (const { categoria } of CATEGORIAS_PRINCIPALES) {
    const seccion = seccionReal.get(categoria);
    const paginaFamilia = familia(`https://www.samsung.com/cl/${seccion}/una-familia/buy/`);
    // se mete al final del recorrido crudo: solo la seccion puede traerla al frente
    const { recorrido, paginasPrincipales, porCategoria } = ordenarRecorrido([...RECORRIDO_CRUDO, paginaFamilia]);
    assert.ok(
      urls(recorrido).slice(0, paginasPrincipales).includes(paginaFamilia.url),
      `la familia de /${seccion}/ no entro al bloque principal: la seccion de "${categoria}" no calza`,
    );
    const fila = porCategoria.find((c) => c.categoria === categoria);
    assert.equal(
      fila.familia,
      RECORRIDO_CRUDO.filter((e) => e.tipo === "familia" && seccionDeUrl(e.url) === seccion).length + 1,
      `la familia de /${seccion}/ no se conto en el bloque de "${categoria}"`,
    );
  }
});

// ---------------------------------------------------------------------------
// 3. Cuando el listado cambia: ni se rompe ni se calla
// ---------------------------------------------------------------------------

test("si una categoria principal se RENOMBRA, sus paginas siguen entrando temprano y queda denunciada", () => {
  const renombrado = RECORRIDO_CRUDO.map((e) => (e.categoria === "Relojes (Galaxy Watch)" ? { ...e, categoria: "Relojes inteligentes" } : e));
  const { recorrido, ausentes, paginasPrincipales } = ordenarRecorrido(renombrado);
  assert.deepStrictEqual(ausentes, [
    { categoria: "Relojes (Galaxy Watch)", seccion: "watches", paginasEnLaSeccion: 2 },
  ]);
  // no se perdio ninguna pagina...
  assert.equal(recorrido.length, renombrado.length);
  // ...y la ficha renombrada sigue en el bloque principal, por su URL
  assert.ok(urls(recorrido).slice(0, paginasPrincipales).includes("https://www.samsung.com/cl/watches/galaxy-watch/w8/"));
});

test("si una categoria principal DESAPARECE del todo, se distingue del renombre", () => {
  const sinRelojes = RECORRIDO_CRUDO.filter((e) => seccionDeUrl(e.url) !== "watches");
  const { ausentes } = ordenarRecorrido(sinRelojes);
  assert.deepStrictEqual(ausentes, [
    // 0 paginas en la seccion = la categoria ya no existe en el sitio; > 0
    // habria sido un cambio de nombre
    { categoria: "Relojes (Galaxy Watch)", seccion: "watches", paginasEnLaSeccion: 0 },
  ]);
});

test("con las cinco categorias presentes no se denuncia ninguna", () => {
  assert.deepStrictEqual(ordenarRecorrido(RECORRIDO_CRUDO).ausentes, []);
});

test("una pagina familia NO alcanza para dar por presente a su categoria", () => {
  // Si solo quedara la /buy/, la categoria del listado igual desaparecio y hay
  // que decirlo: contarla taparia justo lo que se quiere detectar.
  const soloFamilia = [familia("https://www.samsung.com/cl/watches/galaxy-fit/fit3/buy/")];
  const { ausentes } = ordenarRecorrido(soloFamilia);
  const relojes = ausentes.find((a) => a.seccion === "watches");
  assert.ok(relojes, "la categoria sin listado tiene que salir denunciada");
  assert.equal(relojes.paginasEnLaSeccion, 1);
});

// ---------------------------------------------------------------------------
// 4. Lo que la corrida le informa al operador
// ---------------------------------------------------------------------------

test("la medicion del bloque principal informa paginas y minutos", () => {
  const desde = Date.UTC(2026, 8, 12, 10, 0, 0);
  assert.deepStrictEqual(medicionPrincipales({ paginas: 185, desde, hasta: desde + 20 * 60000 }), {
    paginasPrincipales: 185,
    duracionPrincipalesMin: 20,
  });
});

test("si la corrida no alcanzo a terminar el bloque principal, la duracion es null y no 0", () => {
  const desde = Date.UTC(2026, 8, 12, 10, 0, 0);
  assert.deepStrictEqual(medicionPrincipales({ paginas: 3, desde, hasta: null }), {
    paginasPrincipales: 3,
    duracionPrincipalesMin: null,
  });
});

test("un bloque que no se termino informa su tamano REAL y duracion null", () => {
  // El caso que de verdad se daba y que el resumen contaba mal: el bloque son
  // 347 paginas y la corrida solo visito 8. Informar {paginasPrincipales: 8,
  // duracionPrincipalesMin: 1} se lee como "el bloque eran 8 paginas y las
  // termine en 1 minuto", que es mentira con cara de verdad.
  const desde = Date.UTC(2026, 8, 12, 10, 0, 0);
  assert.deepStrictEqual(medicionPrincipales({ paginas: 347, desde, hasta: null }), {
    paginasPrincipales: 347,
    duracionPrincipalesMin: null,
  });
});

// ---------------------------------------------------------------------------
// 4 bis. EL CABLEADO. Antes vivia adentro de main() en src/run.mjs, que arranca
// al importarse: borrar la linea que aplicaba el reordenamiento dejaba la suite
// entera en verde con la funcionalidad apagada. Ahora es una funcion pura.
// ---------------------------------------------------------------------------

const SEMILLA = RECORRIDO_CRUDO.filter((e) => e.tipo !== "familia");
const DESCUBIERTAS = RECORRIDO_CRUDO.filter((e) => e.tipo === "familia");

test("prepararRecorrido REORDENA de verdad: la primera pagina es de la primera categoria", () => {
  const { entries } = prepararRecorrido({ seedRaw: SEMILLA, familyEntries: DESCUBIERTAS });
  assert.equal(entries[0].url, "https://www.samsung.com/cl/smartphones/galaxy-s/s26-ultra/");
  assert.equal(entries.length, RECORRIDO_CRUDO.length);
});

test("prepararRecorrido saca las URL repetidas, y lo hace ANTES de reordenar", () => {
  const repetida = { ...SEMILLA[5] };
  const { entries } = prepararRecorrido({ seedRaw: [...SEMILLA, repetida], familyEntries: DESCUBIERTAS });
  assert.equal(entries.length, RECORRIDO_CRUDO.length);
  assert.equal(entries.filter((e) => e.url === repetida.url).length, 1);
});

test("el recorte por LIMITE_PAGINAS se aplica DESPUES de reordenar", () => {
  // Es lo que hace que una corrida de prueba corta visite justo lo que hay que
  // poder comprobar. Al reves, visitaria las primeras del listado crudo
  // ("Accesorios móviles") y no se podria comprobar nada.
  const { entries } = prepararRecorrido({ seedRaw: SEMILLA, familyEntries: DESCUBIERTAS, limite: 2 });
  assert.deepStrictEqual(urls(entries), [
    "https://www.samsung.com/cl/smartphones/galaxy-s/s26-ultra/",
    "https://www.samsung.com/cl/smartphones/galaxy-z/fold7/",
  ]);
});

test("un LIMITE_PAGINAS vacio, cero, negativo o basura NO recorta nada", () => {
  for (const limite of [undefined, "", "0", "-5", "abc", null]) {
    const { entries } = prepararRecorrido({ seedRaw: SEMILLA, familyEntries: DESCUBIERTAS, limite });
    assert.equal(entries.length, RECORRIDO_CRUDO.length, `LIMITE_PAGINAS=${JSON.stringify(limite)} recorto`);
  }
});

test("una corrida recortada informa el tamano REAL del bloque y que no lo termino", () => {
  const completa = prepararRecorrido({ seedRaw: SEMILLA, familyEntries: DESCUBIERTAS });
  assert.equal(completa.paginasPrincipales, 9);
  assert.equal(completa.recorridasPrincipales, 9);
  assert.equal(completa.bloquePrincipalCompleto, true);

  const corta = prepararRecorrido({ seedRaw: SEMILLA, familyEntries: DESCUBIERTAS, limite: 2 });
  // el tamano del bloque NO cambia porque la corrida sea corta
  assert.equal(corta.paginasPrincipales, 9);
  // ...pero solo se van a recorrer 2, y eso se dice aparte
  assert.equal(corta.recorridasPrincipales, 2);
  assert.equal(corta.bloquePrincipalCompleto, false);
  // y asi el resumen puede informar la duracion en null, que es la verdad
  assert.equal(
    medicionPrincipales({ paginas: corta.paginasPrincipales, desde: 0, hasta: corta.bloquePrincipalCompleto ? 60000 : null })
      .duracionPrincipalesMin,
    null,
  );
});

test("prepararRecorrido tambien devuelve el desglose, las ausentes y las inversiones", () => {
  const { porCategoria, ausentes, inversiones } = prepararRecorrido({ seedRaw: SEMILLA, familyEntries: DESCUBIERTAS });
  assert.equal(porCategoria.length, CATEGORIAS_PRINCIPALES.length);
  assert.deepStrictEqual(ausentes, []);
  assert.deepStrictEqual(inversiones, []);
});

test("prepararRecorrido AVISA de una inversion intra-seccion, no la calla", () => {
  // Sin esto, devolver siempre [] pasaba la prueba de arriba (que compara contra
  // una lista vacia) y la corrida nunca se enteraria de que el orden volvio a
  // poder cambiar resultados.
  const mezclado = [
    listado("Tablets", "https://www.samsung.com/cl/tablets/galaxy-tab-s/tab-s11/"),
    listado("Smartphones", "https://www.samsung.com/cl/tablets/galaxy-tab-s/tab-que-llama/"),
  ];
  const { inversiones } = prepararRecorrido({ seedRaw: mezclado, familyEntries: [] });
  assert.equal(inversiones.length, 1);
  assert.equal(inversiones[0].seccion, "tablets");
});

test("prepararRecorrido sin nada no revienta", () => {
  const r = prepararRecorrido();
  assert.deepStrictEqual(r.entries, []);
  assert.equal(r.paginasPrincipales, 0);
  assert.equal(r.recorridasPrincipales, 0);
});

// ---------------------------------------------------------------------------
// 5. LO IMPORTANTE: cambiar el orden no cambia el resultado
// ---------------------------------------------------------------------------

// Un recorrido de juguete con TODAS las formas de colision que el sistema tiene
// de verdad: el mismo SKU visto desde dos paginas del mismo rango (ficha plana +
// su /buy/), desde rangos distintos (ficha propia + pagina familia con el precio
// de LISTA), una pagina que no logra leer el precio, otra que no logra leer el
// stock, un SKU que solo existe en una pagina familia, un accesorio y un
// producto que ya no aparece.
const V = (modelo, extra) => ({ modelo, nombre: modelo, moneda: "CLP", versionStock: 2, versionPrecio: 3, ...extra });

// la URL de la funda NOMBRA a su SKU en el slug, como las fichas de verdad de
// Samsung ("...-ef-funda26/"): es lo que la hace duena del producto cuando otra
// pagina lo publica de pasada
const L_ACC = listado("Accesorios móviles", "https://www.samsung.com/cl/mobile-accessories/funda-galaxy-s26-ultra-ef-funda26/");
const L_BOOK = listado("Computadores", "https://www.samsung.com/cl/computers/galaxy-book/book5/");
const L_FIT = listado("Relojes (Galaxy Watch)", "https://www.samsung.com/cl/watches/galaxy-fit/fit3/");
const L_S26 = listado("Smartphones", "https://www.samsung.com/cl/smartphones/galaxy-s/s26-ultra/");
const L_TAB = listado("Tablets", "https://www.samsung.com/cl/tablets/galaxy-tab-s/tab-s10-fe/");
const L_TV = listado("Televisores", "https://www.samsung.com/cl/tvs/qled/q80f/");
const F_BOOK = familia("https://www.samsung.com/cl/computers/galaxy-book/book5/buy/");
const F_S26 = familia("https://www.samsung.com/cl/smartphones/galaxy-s/s26-ultra/buy/");
const F_TAB = familia("https://www.samsung.com/cl/tablets/galaxy-tab-s/tab-s10-fe/buy/");
const F_FIT = familia("https://www.samsung.com/cl/watches/galaxy-fit/fit3/buy/");
const F_TV = familia("https://www.samsung.com/cl/tvs/qled/q80f/buy/");

// [entrada, variantes, via]
const LISTADO = [
  [L_ACC, [V("EF-FUNDA26", { precio: 29990, rango: 3, estadoStock: "disponible", disponible: true, url: L_ACC.url })], "individual"],
  // el Book no logra leer su stock desde la ficha plana (bloque sin boton)
  [L_BOOK, [V("NP750XGJ-KS4CL", { precio: 999990, rango: 3, estadoStock: "desconocido", disponible: null, url: L_BOOK.url })], "individual"],
  // la ficha del Fit no pinta el precio: el campo va AUSENTE, que es el "no se sabe"
  [L_FIT, [V("SM-R390NZAACHO", { rango: 3, estadoStock: "disponible", disponible: true, url: L_FIT.url })], "individual"],
  [
    L_S26,
    [
      V("SM-S948BZDJLTL", { precio: 1199990, rango: 3, estadoStock: "disponible", disponible: true, url: L_S26.url }),
      // LA COLISION QUE EL REORDENAMIENTO SI PUEDE MOVER, y que este recorrido
      // de juguete no tenia: el mismo SKU publicado por una pagina de una
      // seccion PRINCIPAL (/smartphones/) y por una de una seccion que NO lo es
      // (/mobile-accessories/), las dos con el MISMO rango. Es la ficha de un
      // telefono que publica tambien la funda que trae en el combo, con otro
      // precio. Todas las demas colisiones del recorrido son intra-seccion
      // (ficha plana + su /buy/) y el reordenamiento nunca las invierte, asi que
      // sin esta el "orden viejo contra orden nuevo" no probaba nada del caso
      // que importa. Paso de verdad en produccion una vez: GP-TOS928SBEYW, el
      // 2026-07-25 (ver BITACORA.md).
      V("EF-FUNDA26", { precio: 24990, rango: 3, estadoStock: "disponible", disponible: true, url: L_S26.url }),
    ],
    "individual",
  ],
  [L_TAB, [V("SM-X520NLBACHO", { precio: 656990, rango: 3, estadoStock: "disponible", disponible: true, url: L_TAB.url })], "individual"],
  [L_TV, [V("QN55LS03FAGXZS", { precio: 899990, rango: 3, estadoStock: "agotado", disponible: false, url: L_TV.url })], "individual"],
];

const FAMILIA = [
  // misma pagina del Book, esta vez con el stock legible: mismo rango
  [F_BOOK, [V("NP750XGJ-KS4CL", { precio: 999990, rango: 3, estadoStock: "agotado", disponible: false, url: F_BOOK.url })], "familia"],
  // pagina de grupo: precio de LISTA (rango FAMILIA) para un SKU que ya tiene
  // ficha propia, y un segundo SKU que SOLO existe aca
  [
    F_S26,
    [
      V("SM-S948BZDJLTL", { nombre: "Galaxy S26 Ultra 256 GB｜12 GB Pinkgold", precio: 1549990, rango: 2, estadoStock: "disponible", disponible: true, url: F_S26.url }),
      V("SM-S938BZKJLTL", { nombre: "Galaxy S26+ 512 GB｜12 GB Negro", precio: 1099990, rango: 2, estadoStock: "disponible", disponible: true, url: F_S26.url }),
    ],
    "familia",
  ],
  // la /buy/ de la tablet no pinta el precio: mismo rango, hay que conservar el
  // que si se leyo
  [F_TAB, [V("SM-X520NLBACHO", { nombre: "Tab S10 FE 128 GB Azul", rango: 3, estadoStock: "disponible", disponible: true, url: F_TAB.url })], "familia"],
  [F_FIT, [V("SM-R390NZAACHO", { nombre: "Galaxy Fit3 Gris", precio: 129990, rango: 3, estadoStock: "disponible", disponible: true, url: F_FIT.url })], "familia"],
  [F_TV, [V("QN55LS03FAGXZS", { nombre: "The Frame 55", precio: 1199990, rango: 2, estadoStock: "disponible", disponible: true, url: F_TV.url })], "familia"],
];

const PREVIO = {
  // baja real de precio: tiene que salir un aviso, para que la comparacion no
  // sea entre dos listas vacias
  "SM-S948BZDJLTL": { modelo: "SM-S948BZDJLTL", nombre: "Galaxy S26 Ultra", precio: 1299990, rango: 3, paginaOrigen: L_S26.url, url: L_S26.url, categoria: "Smartphones", estadoStock: "disponible", disponible: true, presencia: "activo", versionStock: 2, versionPrecio: 3, ausencias: 0 },
  "SM-X520NLBACHO": { modelo: "SM-X520NLBACHO", nombre: "Tab S10 FE", precio: 656990, rango: 3, paginaOrigen: L_TAB.url, url: L_TAB.url, categoria: "Tablets", estadoStock: "disponible", disponible: true, presencia: "activo", versionStock: 2, versionPrecio: 3, ausencias: 0 },
  "NP750XGJ-KS4CL": { modelo: "NP750XGJ-KS4CL", nombre: "Galaxy Book5", precio: 999990, rango: 3, paginaOrigen: L_BOOK.url, url: L_BOOK.url, categoria: "Computadores", estadoStock: "agotado", disponible: false, presencia: "activo", versionStock: 2, versionPrecio: 3, ausencias: 0 },
  "EF-FUNDA26": { modelo: "EF-FUNDA26", nombre: "Funda", precio: 39990, rango: 3, paginaOrigen: L_ACC.url, url: L_ACC.url, categoria: "Accesorios móviles", estadoStock: "disponible", disponible: true, presencia: "activo", versionStock: 2, versionPrecio: 3, ausencias: 0 },
  "QN55LS03FAGXZS": { modelo: "QN55LS03FAGXZS", nombre: "The Frame 55", precio: 899990, rango: 3, paginaOrigen: L_TV.url, url: L_TV.url, categoria: "Televisores", estadoStock: "agotado", disponible: false, presencia: "activo", versionStock: 2, versionPrecio: 3, ausencias: 0 },
  // producto que ya no aparece y esta a una ausencia de declararse desaparecido
  "SM-VIEJO": { modelo: "SM-VIEJO", nombre: "Galaxy viejo", precio: 199990, rango: 3, paginaOrigen: "https://www.samsung.com/cl/smartphones/galaxy-a/a10/", url: "https://www.samsung.com/cl/smartphones/galaxy-a/a10/", categoria: "Smartphones", estadoStock: "disponible", disponible: true, presencia: "activo", versionStock: 2, versionPrecio: 3, ausencias: 1 },
};

/** Recorre las paginas en el orden dado y devuelve lo mismo que produce una corrida. */
function correr(paginas) {
  const observado = {};
  for (const [entry, variants, via] of paginas) integrarVariantes(observado, entry, variants, { via, timestamp: TS });
  const { catalogo, cambios } = comparar({
    previo: structuredClone(PREVIO),
    observado,
    paginasFallidas: new Set(),
    corridaConfiable: true,
    timestamp: TS,
  });
  return { catalogo, cambios, visitadas: paginas.map(([e]) => e.url) };
}

/** Las paginas, en el orden en que las va a recorrer run.mjs. */
function enOrdenNuevo(paginas) {
  const porUrl = new Map(paginas.map((p) => [p[0].url, p]));
  return ordenarRecorrido(paginas.map((p) => p[0])).recorrido.map((e) => porUrl.get(e.url));
}

const claveCambio = (c) => `${c.tipo}|${c.modelo}|${c.precio ?? ""}|${c.precioAnterior ?? ""}|${c.estado ?? ""}`;
const ordenados = (cambios) => cambios.map(claveCambio).slice().sort();

test("el mismo conjunto de observaciones da el MISMO catalogo en el orden viejo y en el nuevo", () => {
  const viejo = correr([...LISTADO, ...FAMILIA]);
  const nuevo = correr(enOrdenNuevo([...LISTADO, ...FAMILIA]));
  // deepStrictEqual no mira el orden de las claves de un objeto: compara SKU por
  // SKU, que es justo lo que tiene que ser identico.
  assert.deepStrictEqual(nuevo.catalogo, viejo.catalogo);
});

test("...y los MISMOS cambios emitidos", () => {
  const viejo = correr([...LISTADO, ...FAMILIA]);
  const nuevo = correr(enOrdenNuevo([...LISTADO, ...FAMILIA]));
  assert.deepStrictEqual(ordenados(nuevo.cambios), ordenados(viejo.cambios));
  // y no es una comparacion entre dos listas vacias
  assert.ok(viejo.cambios.length >= 2, `se esperaban cambios de verdad, salieron ${viejo.cambios.length}`);
  assert.ok(viejo.cambios.some((c) => c.tipo === "baja" && c.modelo === "SM-S948BZDJLTL"));
  assert.ok(viejo.cambios.some((c) => c.tipo === "desaparecido" && c.modelo === "SM-VIEJO"));
});

test("lo que SI cambia a proposito es el orden en que el operador se entera", () => {
  const nuevo = correr(enOrdenNuevo([...LISTADO, ...FAMILIA]));
  assert.equal(nuevo.visitadas[0], L_S26.url, "la primera pagina del recorrido tiene que ser un smartphone");
  const viejo = correr([...LISTADO, ...FAMILIA]);
  assert.notEqual(viejo.visitadas[0], nuevo.visitadas[0]);
});

test("las decisiones delicadas caen igual en los dos ordenes", () => {
  const viejo = correr([...LISTADO, ...FAMILIA]).catalogo;
  const nuevo = correr(enOrdenNuevo([...LISTADO, ...FAMILIA])).catalogo;
  for (const c of [viejo, nuevo]) {
    // el precio de LISTA de la pagina familia (rango 2) no le gana a la ficha propia
    assert.equal(c["SM-S948BZDJLTL"].precio, 1199990);
    // el precio que si se leyo no se pierde porque la otra pagina del mismo rango no lo leyo
    assert.equal(c["SM-X520NLBACHO"].precio, 656990);
    // el precio que solo publica la /buy/ del mismo rango si se adopta
    assert.equal(c["SM-R390NZAACHO"].precio, 129990);
    // el stock legible le gana al "desconocido" de la otra pagina del mismo rango
    assert.equal(c["NP750XGJ-KS4CL"].estadoStock, "agotado");
    // el SKU que solo existe en la pagina familia entra igual
    assert.equal(c["SM-S938BZKJLTL"].precio, 1099990);
    // Y LA COLISION ENTRE SECCIONES: la funda la publican su propia ficha de
    // accesorios ($29.990) y la ficha del telefono ($24.990), las dos con el
    // mismo rango. Gana la que NOMBRA al SKU en su slug, en los dos ordenes; sin
    // ese desempate ganaba la ultima en llegar, o sea el orden del recorrido.
    assert.equal(c["EF-FUNDA26"].precio, 29990);
    assert.equal(c["EF-FUNDA26"].paginaOrigen, L_ACC.url);
    assert.equal(c["EF-FUNDA26"].categoria, "Accesorios móviles");
  }
});

test("la colision ENTRE SECCIONES ya no la decide el orden de llegada", () => {
  // El caso aislado, sin el resto del recorrido, para que se vea de que va: la
  // misma pagina de accesorios y la del telefono, procesadas en los dos ordenes
  // posibles. Antes del desempate esto daba dos catalogos distintos (medido:
  // paginaOrigen, categoria, precio, precioPendiente y fuentePrecio diferian).
  const funda = [L_ACC, [V("EF-FUNDA26", { precio: 29990, rango: 3, estadoStock: "disponible", disponible: true, url: L_ACC.url })], "individual"];
  const telefono = [L_S26, [V("EF-FUNDA26", { precio: 24990, rango: 3, estadoStock: "disponible", disponible: true, url: L_S26.url })], "individual"];
  const a = correr([funda, telefono]).catalogo["EF-FUNDA26"];
  const b = correr([telefono, funda]).catalogo["EF-FUNDA26"];
  assert.deepStrictEqual(b, a, "el mismo insumo en distinto orden tiene que dar el mismo registro");
  assert.equal(a.paginaOrigen, L_ACC.url, "gana la pagina que nombra al SKU en su slug");
  // y el desempate es un orden TOTAL: exactamente una de las dos gana
  assert.equal(ganaElEmpate(L_ACC.url, L_S26.url, "EF-FUNDA26"), true);
  assert.equal(ganaElEmpate(L_S26.url, L_ACC.url, "EF-FUNDA26"), false);
});

test("el reordenamiento nunca adelanta una /buy/ delante de la ficha plana del mismo producto", () => {
  // La pareja mas comun que escribe el mismo SKU con el MISMO rango: 126 paginas
  // /buy/ descubiertas tienen su ficha plana en el listado (116 SKU). No es la
  // UNICA -- dos fichas de secciones distintas tambien pueden hacerlo, y eso
  // ocurrio de verdad en produccion (GP-TOS928SBEYW el 2026-07-25) --, pero si
  // es la unica que se empareja por la URL, y para ella el orden se conserva.
  const seed = JSON.parse(readFileSync(new URL("../src/seed.json", import.meta.url), "utf-8"));
  const familias = seed.map((e) => familia(`${e.url}buy/`));
  const { recorrido } = ordenarRecorrido([...seed, ...familias]);
  const pos = new Map(recorrido.map((e, i) => [e.url, i]));
  for (const e of seed) {
    assert.ok(pos.get(e.url) < pos.get(`${e.url}buy/`), `la /buy/ de ${e.url} se adelanto a su ficha plana`);
  }
});

// ---------------------------------------------------------------------------
// 6. LOS GUARDIANES DEL INVARIANTE.
//
// Que reordenar no cambie el resultado NO se apoya en "el listado va siempre
// antes que lo descubierto" (eso se midio y es FALSO: el reordenamiento invierte
// 273.380 pares de paginas del recorrido real, 146.246 de ellos listado/familia).
// Se apoya en dos hechos, y estas pruebas son las que los vigilan:
//
//   a. el reordenamiento no invierte NUNCA dos paginas de la MISMA seccion;
//   b. dos paginas que hablan del mismo producto viven bajo la misma seccion.
// ---------------------------------------------------------------------------

test("a) sobre el listado REAL, el reordenamiento no invierte ningun par de la misma seccion", () => {
  const familias = SEED_REAL.map((e) => familia(`${e.url}buy/`));
  const crudo = [...SEED_REAL, ...familias];
  const { recorrido } = ordenarRecorrido(crudo);
  assert.deepStrictEqual(inversionesIntraSeccion(crudo, recorrido), []);
});

test("a) y el guardian NO es vacuo: caza una categoria principal con paginas en la seccion de OTRA", () => {
  // Sin esta prueba el guardian podria devolver siempre [] y nadie se enteraria.
  //
  // El caso que de verdad rompe el invariante es este: una pagina catalogada
  // como "Smartphones" pero que vive bajo /tablets/. Se va al bloque de
  // Smartphones (por su NOMBRE) mientras las tablets se van al de Tablets, que
  // va despues -- o sea que dos paginas de la MISMA seccion cambian de orden
  // relativo, y el orden vuelve a poder decidir quien firma un SKU compartido.
  // (Que una categoria NO principal se mude a una seccion principal, en cambio,
  // no rompe nada: el respaldo por seccion se la lleva al mismo bloque.)
  const mezclado = [
    listado("Tablets", "https://www.samsung.com/cl/tablets/galaxy-tab-s/tab-s11/"),
    listado("Smartphones", "https://www.samsung.com/cl/tablets/galaxy-tab-s/tab-que-llama/"),
  ];
  const { recorrido } = ordenarRecorrido(mezclado);
  const inversiones = inversionesIntraSeccion(mezclado, recorrido);
  assert.equal(inversiones.length, 1);
  assert.equal(inversiones[0].seccion, "tablets");
  assert.equal(inversiones[0].antes, "https://www.samsung.com/cl/tablets/galaxy-tab-s/tab-s11/");
  assert.equal(inversiones[0].ahora, "https://www.samsung.com/cl/tablets/galaxy-tab-s/tab-que-llama/");
});

test("a) una categoria NO principal mudada a una seccion principal no rompe el invariante", () => {
  // El respaldo por seccion se la lleva al mismo bloque, asi que su orden
  // relativo con las paginas de esa seccion se conserva. Queda documentado
  // porque es la primera hipotesis que a uno se le ocurre y es FALSA.
  const mudado = [
    listado("Accesorios móviles", "https://www.samsung.com/cl/smartphones/accesorios/funda-x/"),
    listado("Smartphones", "https://www.samsung.com/cl/smartphones/galaxy-s/s26-ultra/"),
  ];
  const { recorrido } = ordenarRecorrido(mudado);
  assert.deepStrictEqual(inversionesIntraSeccion(mudado, recorrido), []);
});

test("b) en el listado REAL, cada seccion pertenece a UNA sola categoria", () => {
  // Este es el hecho del que cuelga todo: si una seccion tuviera dos categorias y
  // solo una fuera principal, el reordenamiento las separaria. Se comprueba sobre
  // las 1.023 paginas reales, que es donde puede dejar de ser cierto.
  const porSeccion = new Map();
  for (const e of SEED_REAL) {
    const s = seccionDeUrl(e.url);
    if (!porSeccion.has(s)) porSeccion.set(s, new Set());
    porSeccion.get(s).add(e.categoria);
  }
  const mezcladas = [...porSeccion].filter(([, cats]) => cats.size > 1).map(([s, cats]) => `${s}: ${[...cats].join(" + ")}`);
  assert.deepStrictEqual(mezcladas, []);
});

test("b) y ninguna categoria del listado REAL vive repartida en dos secciones", () => {
  // La otra mitad del mismo hecho: si "Smartphones" tuviera paginas fuera de
  // /smartphones/, el respaldo por seccion dejaria de alcanzar.
  const porCategoria = new Map();
  for (const e of SEED_REAL) {
    if (!porCategoria.has(e.categoria)) porCategoria.set(e.categoria, new Set());
    porCategoria.get(e.categoria).add(seccionDeUrl(e.url));
  }
  const repartidas = [...porCategoria].filter(([, secs]) => secs.size > 1).map(([c, secs]) => `${c}: ${[...secs].join(" + ")}`);
  assert.deepStrictEqual(repartidas, []);
});

test("el sintoma en produccion: se denuncia el SKU que cambio de seccion", () => {
  // Es lo unico observable en datos reales de que dos secciones se pelean un
  // producto. Caso real: GP-TOS928SBEYW, 2026-07-25.
  const previo = {
    "GP-TOS928SBEYW": { paginaOrigen: "https://www.samsung.com/cl/mobile-accessories/flipsuit-card-gp-tos928sbeyw/" },
    "SM-S948BZDJLTL": { paginaOrigen: "https://www.samsung.com/cl/smartphones/galaxy-s/s26-ultra/" },
  };
  const catalogo = {
    // cambio de seccion: hay que denunciarlo
    "GP-TOS928SBEYW": { paginaOrigen: "https://www.samsung.com/cl/tv-accessories/customizable-frame--vg-scfa43wtbru/" },
    // cambio de pagina DENTRO de su seccion (ficha plana -> su /buy/): normal, no se denuncia
    "SM-S948BZDJLTL": { paginaOrigen: "https://www.samsung.com/cl/smartphones/galaxy-s/s26-ultra/buy/" },
    // producto nuevo, sin pasado: tampoco
    "SM-NUEVO": { paginaOrigen: "https://www.samsung.com/cl/tablets/tab-s11/" },
  };
  assert.deepStrictEqual(skusQueCambiaronDeSeccion(previo, catalogo), [
    {
      modelo: "GP-TOS928SBEYW",
      antes: "mobile-accessories",
      ahora: "tv-accessories",
      paginaAntes: previo["GP-TOS928SBEYW"].paginaOrigen,
      paginaAhora: catalogo["GP-TOS928SBEYW"].paginaOrigen,
    },
  ]);
});

test("...y la lista sale ordenada por SKU, no en el orden del recorrido", () => {
  // El aviso muestra como maximo los primeros 5: cuales se muestran no puede
  // depender de por donde empezo la revision.
  const previo = {
    "SM-Z": { paginaOrigen: "https://www.samsung.com/cl/tablets/a/" },
    "SM-A": { paginaOrigen: "https://www.samsung.com/cl/tablets/b/" },
    "SM-M": { paginaOrigen: "https://www.samsung.com/cl/tablets/c/" },
  };
  const catalogo = {
    "SM-Z": { paginaOrigen: "https://www.samsung.com/cl/smartphones/a/" },
    "SM-A": { paginaOrigen: "https://www.samsung.com/cl/smartphones/b/" },
    "SM-M": { paginaOrigen: "https://www.samsung.com/cl/smartphones/c/" },
  };
  assert.deepStrictEqual(skusQueCambiaronDeSeccion(previo, catalogo).map((c) => c.modelo), ["SM-A", "SM-M", "SM-Z"]);
});

test("el desempate entre paginas es un orden total y no depende del orden de llegada", () => {
  const propia = "https://www.samsung.com/cl/mobile-accessories/flipsuit-card-gp-tos928sbeyw/";
  const ajena = "https://www.samsung.com/cl/tv-accessories/customizable-frame--vg-scfa43wtbru/";
  // la que nombra al SKU gana, la otra pierde
  assert.equal(ganaElEmpate(propia, ajena, "GP-TOS928SBEYW"), true);
  assert.equal(ganaElEmpate(ajena, propia, "GP-TOS928SBEYW"), false);
  // Y GANA POR NOMBRAR AL SKU, no de casualidad por ir antes en el alfabeto:
  // aca la que lo nombra es la que va DESPUES ("tv-" > "mobile-"). Sin este par,
  // borrar la regla del slug dejaba la suite en verde.
  const nombraYVaDespues = "https://www.samsung.com/cl/tv-accessories/soporte-pared-vg-stb1234/";
  const noNombraYVaAntes = "https://www.samsung.com/cl/mobile-accessories/combo-con-soporte/";
  assert.equal(ganaElEmpate(nombraYVaDespues, noNombraYVaAntes, "VG-STB1234"), true);
  assert.equal(ganaElEmpate(noNombraYVaAntes, nombraYVaDespues, "VG-STB1234"), false);
  // si ninguna lo nombra, el desempate es alfabetico: arbitrario pero SIEMPRE el
  // mismo, que es lo unico que se le pide
  const a = "https://www.samsung.com/cl/mobile-accessories/pack-x/";
  const b = "https://www.samsung.com/cl/smartphones/combo-y/";
  assert.equal(ganaElEmpate(a, b, "SM-SINSLUG"), true);
  assert.equal(ganaElEmpate(b, a, "SM-SINSLUG"), false);
});
