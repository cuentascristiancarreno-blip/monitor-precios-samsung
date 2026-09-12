// EL VAIVEN DE PRECIOS: el mismo producto rebotando entre dos valores corrida a
// corrida, y un aviso falso de "subio"/"bajo" en cada rebote.
//
// LO MEDIDO (2026-09-12, cargando las paginas reales y minando data/):
//  - En las 5 fichas que mas avisos falsos generaron, los DOS valores que bailan
//    son exactamente los dos numeros que window.digitalData publica en la MISMA
//    ficha: model_price (que NO esta escrito en ninguna parte de la pagina) y
//    list_price (el "Precio original" TACHADO). El precio que el cliente paga no
//    es ninguno de los dos: esta en el bloque de compra, despues de " o $".
//      SM-X520NLBACHO  model 479.990 · list 729.990 · bloque "o $656.990"
//      LS32DG300ELXZS  model 199.990 · list 279.990 · bloque "Dónde comprar" (sin monto)
//  - Quien elegia entre los dos era precioVisiblePreferido, mirando si el monto
//    estaba escrito en document.body.innerText. Y ese texto se leia sin esperar
//    a que el precio se PINTARA: solo se esperaba a que existiera la VARIABLE
//    digitalData.model_price. Resultado: la misma pagina devolvia dos precios
//    estables segun quien ganara la carrera del render.
//  - Impacto: 68 SKU con el precio volviendo a un valor ya visto en 30 dias y
//    361 de los 784 avisos de precio del mes (46%) sobre esos SKU. El peor,
//    LS32DG300ELXZS, con 56 avisos rebotando entre $199.990 y $279.990.
//  - Segunda puerta, mas chica: el MISMO SKU visto desde DOS paginas distintas
//    (135 SKU se scrapean dos veces por corrida: su ficha plana del seed y su
//    propia /buy/ descubierta por sitemap; y el JSON-LD de una pagina familia
//    publica el precio de lista, 10 de 10 veces igual al tachado).
//
// Cada prueba de este archivo muere si se deshace una de las piezas del arreglo.
import { test } from "node:test";
import assert from "node:assert/strict";
import { extractSingleProduct, VERSION_PRECIO } from "../src/extract.mjs";
import { integrarVariantes } from "../src/catalogo.mjs";
import { comparar, marcarSinPrecioProlongado, UMBRAL_PRECIO_OTRA_FUENTE, UMBRAL_SIN_VERIFICAR } from "../src/comparar.mjs";
import { RANGO } from "../src/identidad.mjs";

// --- dobles de pagina, con los textos LITERALES de las fichas medidas --------

const TAB = {
  sku: "SM-X520NLBACHO",
  url: "https://www.samsung.com/cl/tablets/galaxy-tab-s/galaxy-tab-s10-fe-blue-128gb-sm-x520nlbacho/",
  modelPrice: "479990",
  listPrice: "729990",
  bloque: "Desde $ 54.749 en 12 cuotas sin intereses* o $656.990 Precio original: $729.990 Ahorra $ 73.000 *Aplican condiciones Comprar",
  // innerText de la pagina YA pintada (el bloque de compra forma parte de el)
  body: "Galaxy Tab S10 FE\nDesde $ 54.749 en 12 cuotas sin intereses* o $656.990\nPrecio original: $729.990\nAhorra $ 73.000\nComprar",
  cobra: 656990,
};

const MONITOR = {
  sku: "LS32DG300ELXZS",
  url: "https://www.samsung.com/cl/monitors/gaming/odyssey-g3-32-inch-ls32dg300elxzs/",
  modelPrice: "199990",
  listPrice: "279990",
  // su bloque de compra NO trae monto: Samsung no lo vende online
  bloque: "Dónde comprar",
  body: "Odyssey G3 32''\n$279.990\nProductos relacionados $249.990 $949.990 $1.099.990\nDónde comprar",
  cobra: 279990,
};

/**
 * Doble de una pagina de Playwright que RENDERIZA TARDE, que es el escenario
 * real: digitalData ya tiene los numeros y el bloque de compra todavia no se
 * pinto. `pintaEnLaEspera: false` congela la pagina a medio pintar para siempre.
 *
 * LAS DOS LECTURAS QUE DECIDEN EL PRECIO SE CONTROLAN POR SEPARADO (2026-09-12,
 * defecto del doble anterior). En produccion son dos page.evaluate distintos, en
 * momentos distintos, contra ambitos distintos del DOM, y el segundo va envuelto
 * en `.catch(() => null)`:
 *   - el BODY (document.body.innerText), que es lo que mira precioVisiblePreferido;
 *   - el BLOQUE de compra, que es lo que mira precioDelBloqueCompra y lo que
 *     realmente manda.
 * El doble las manejaba con UNA sola bandera `pintado`, asi que solo podia
 * producir "las dos pintadas" o "ninguna pintada". El estado que de verdad
 * fallaba -- body pintado con el tachado escrito + bloque ilegible -- era
 * inexpresable, y por eso 274 pruebas verdes y 13 mutantes no decian NADA sobre
 * el. Ahora el bloque se pide aparte:
 *   "auto"     acompana al body (comportamiento de siempre)
 *   "ilegible" el evaluate revienta -> el `.catch(() => null)` del codigo real
 *   "vacio"    el elemento existe pero todavia no tiene texto
 *   <string>   un texto propio (p.ej. la barra pegajosa, sin la frase de cuotas)
 */
function fichaQuePintaTarde(ficha, { pintaEnLaEspera = true, bloque = "auto" } = {}) {
  let pintado = false;
  let evaluaciones = 0;
  let esperas = 0;
  const bloqueLeido = () => {
    if (bloque === "ilegible") throw new Error("evaluate fallido");
    if (bloque === "vacio") return { texto: "", ctas: [], ctasBarra: [] };
    if (bloque === "auto") {
      return { texto: pintado ? ficha.bloque : null, ctas: pintado ? ["Comprar"] : [], ctasBarra: [] };
    }
    return { texto: bloque, ctas: ["Comprar"], ctasBarra: [] };
  };
  return {
    get esperas() {
      return esperas;
    },
    // MISMA FIRMA QUE PLAYWRIGHT: (pageFunction, arg, options). Ver la nota de
    // PRECIO_TIMEOUT_MS en src/extract.mjs.
    async waitForFunction(_fn, _arg, _opciones) {
      esperas += 1;
      // la 1a espera es la de digitalData (que ya esta lista); la 2a es la del
      // monto PINTADO, y es la que este arreglo agrego
      if (esperas >= 2 && pintaEnLaEspera) pintado = true;
    },
    async evaluate() {
      evaluaciones += 1;
      if (evaluaciones === 1) {
        return { model_price: ficha.modelPrice, list_price: ficha.listPrice, model_code: ficha.sku, displayName: "Producto" };
      }
      if (evaluaciones === 2) return pintado ? ficha.body : "";
      if (evaluaciones === 3) return bloqueLeido();
      return {};
    },
  };
}


const entradaDe = (ficha, url = ficha.url) => ({ url, categoria: "Tablets", subcategoria: null, variante: null });

function observar(ficha, salida, { url } = {}) {
  const observado = {};
  integrarVariantes(observado, entradaDe(ficha, url), [salida], { via: "individual", timestamp: "T" });
  return observado;
}

const registro = (extra) => ({
  modelo: extra.modelo,
  nombre: "Producto",
  moneda: "CLP",
  categoria: "Tablets",
  presencia: "activo",
  ausencias: 0,
  notificadoDesaparecido: false,
  estadoStock: "disponible",
  disponible: true,
  versionStock: 2,
  ...extra,
});

// --- 1. la carrera de render --------------------------------------------------

test("se espera a que el precio se PINTE antes de leer la pagina", async () => {
  const page = fichaQuePintaTarde(TAB);
  const r = await extractSingleProduct(page, TAB.url);
  assert.equal(r.precio, TAB.cobra, "si no se espera al render, el body se lee vacio y no hay precio");
  assert.ok(page.esperas >= 2, "tiene que haber una espera ADEMAS de la de digitalData");
});

test("una pagina que no alcanza a pintar el precio NO devuelve un precio inventado", async () => {
  const page = fichaQuePintaTarde(TAB, { pintaEnLaEspera: false });
  const r = await extractSingleProduct(page, TAB.url);
  assert.equal("precio" in r, false, "el campo se OMITE: null pisaria el precio guardado");
  assert.equal(r.precioIlegible, true);
  // y el numero interno queda solo como rastro, para la adopcion silenciosa
  assert.equal(r.precioInterno, 479990);
});

test("la ficha del monitor: gana el monto escrito, nunca el interno", async () => {
  // su bloque de compra no trae monto ("Dónde comprar"), asi que decide
  // precioVisiblePreferido: el list_price esta escrito y el model_price no
  const pintada = await extractSingleProduct(fichaQuePintaTarde(MONITOR), MONITOR.url);
  assert.equal(pintada.precio, MONITOR.cobra);
  const aMedias = await extractSingleProduct(fichaQuePintaTarde(MONITOR, { pintaEnLaEspera: false }), MONITOR.url);
  assert.equal("precio" in aMedias, false, "sin texto pintado, 199.990 NO es un precio");
});

// --- 2. corrida a corrida: el vaiven completo, extremo a extremo --------------

test("tres corridas seguidas, una a medio pintar: cero avisos y el precio bueno intacto", async () => {
  // C1: la pagina pinta -> precio del bloque
  const c1 = await extractSingleProduct(fichaQuePintaTarde(TAB), TAB.url);
  const paso1 = comparar({
    previo: { [TAB.sku]: registro({ modelo: TAB.sku, precio: TAB.cobra, url: TAB.url, paginaOrigen: TAB.url, rango: RANGO.PROPIA, versionPrecio: VERSION_PRECIO }) },
    observado: observar(TAB, c1),
    paginasFallidas: new Set(),
    corridaConfiable: true,
    timestamp: "T1",
  });
  assert.deepEqual(paso1.cambios, [], "misma pagina, mismo precio: nada que avisar");

  // C2: la MISMA pagina no alcanza a pintar. Antes esto devolvia 479.990 y
  // mandaba "bajo -27%"; ahora no devuelve precio y no cambia nada.
  const c2 = await extractSingleProduct(fichaQuePintaTarde(TAB, { pintaEnLaEspera: false }), TAB.url);
  const paso2 = comparar({
    previo: paso1.catalogo,
    observado: observar(TAB, c2),
    paginasFallidas: new Set(),
    corridaConfiable: true,
    timestamp: "T2",
  });
  assert.deepEqual(paso2.cambios, [], "una lectura sin precio no avisa nada");
  assert.equal(paso2.catalogo[TAB.sku].precio, TAB.cobra, "conserva el precio bueno");
  assert.equal(paso2.catalogo[TAB.sku].corridasSinPrecio, 1, "pero queda contado, para que no sea una momia silenciosa");

  // C3: vuelve a pintar. Antes esto mandaba "subio +37%"; ahora no pasa nada.
  const c3 = await extractSingleProduct(fichaQuePintaTarde(TAB), TAB.url);
  const paso3 = comparar({
    previo: paso2.catalogo,
    observado: observar(TAB, c3),
    paginasFallidas: new Set(),
    corridaConfiable: true,
    timestamp: "T3",
  });
  assert.deepEqual(paso3.cambios, [], "el rebote de vuelta tampoco existe");
  assert.equal(paso3.catalogo[TAB.sku].precio, TAB.cobra);
  assert.equal(paso3.catalogo[TAB.sku].corridasSinPrecio, undefined, "el contador se borra al volver a leerse");
});

test("una baja de VERDAD, desde la misma pagina, sigue avisandose en la primera corrida", async () => {
  // el Cyber: el bloque de compra cambia de monto y hay que avisar al tiro
  const enOferta = { ...TAB, bloque: TAB.bloque.replace("o $656.990", "o $499.990"), body: TAB.body.replace("o $656.990", "o $499.990") };
  const obs = await extractSingleProduct(fichaQuePintaTarde(enOferta), TAB.url);
  const { cambios, catalogo } = comparar({
    previo: { [TAB.sku]: registro({ modelo: TAB.sku, precio: TAB.cobra, url: TAB.url, paginaOrigen: TAB.url, rango: RANGO.PROPIA, versionPrecio: VERSION_PRECIO }) },
    observado: observar(enOferta, obs),
    paginasFallidas: new Set(),
    corridaConfiable: true,
    timestamp: "T1",
  });
  assert.equal(cambios.length, 1);
  assert.equal(cambios[0].tipo, "baja");
  assert.equal(cambios[0].precio, 499990);
  assert.equal(catalogo[TAB.sku].precio, 499990, "y se adopta en el acto");
});

// --- 3. adopcion silenciosa de la correccion de fuente ------------------------

test("el SKU que tenia guardado el numero INTERNO adopta el precio bueno en silencio", async () => {
  // medido: los SKU que bailan tienen hoy guardado uno de los dos valores del
  // baile (50 de 68). Sin esto, la primera corrida con el arreglo mandaria del
  // orden de 50-68 avisos de "subio 20-40%" por productos que nunca cambiaron.
  const obs = await extractSingleProduct(fichaQuePintaTarde(TAB), TAB.url);
  const { cambios, catalogo } = comparar({
    previo: { [TAB.sku]: registro({ modelo: TAB.sku, precio: 479990, url: TAB.url, paginaOrigen: TAB.url, rango: RANGO.PROPIA, versionPrecio: 2 }) },
    observado: observar(TAB, obs),
    paginasFallidas: new Set(),
    corridaConfiable: true,
    timestamp: "T1",
  });
  assert.deepEqual(cambios, [], "cambio de FUENTE, no de precio: no se avisa");
  assert.equal(catalogo[TAB.sku].precio, TAB.cobra, "pero el precio bueno si se adopta");
  assert.equal(catalogo[TAB.sku].versionPrecio, VERSION_PRECIO, "y se sella, para que valga una sola vez");
});

test("el SKU que tenia guardado el TACHADO tambien se corrige en silencio", async () => {
  const obs = await extractSingleProduct(fichaQuePintaTarde(TAB), TAB.url);
  const { cambios, catalogo } = comparar({
    previo: { [TAB.sku]: registro({ modelo: TAB.sku, precio: 729990, url: TAB.url, paginaOrigen: TAB.url, rango: RANGO.PROPIA, versionPrecio: 2 }) },
    observado: observar(TAB, obs),
    paginasFallidas: new Set(),
    corridaConfiable: true,
    timestamp: "T1",
  });
  assert.deepEqual(cambios, []);
  assert.equal(catalogo[TAB.sku].precio, TAB.cobra);
});

test("la adopcion silenciosa NO tapa una baja real, y vale una sola vez por SKU", async () => {
  // mismo SKU, misma migracion de version, pero el precio guardado no es ni el
  // tachado ni el interno: es un precio real anterior. Eso SI se avisa.
  const obs = await extractSingleProduct(fichaQuePintaTarde(TAB), TAB.url);
  const primera = comparar({
    previo: { [TAB.sku]: registro({ modelo: TAB.sku, precio: 699990, url: TAB.url, paginaOrigen: TAB.url, rango: RANGO.PROPIA, versionPrecio: 2 }) },
    observado: observar(TAB, obs),
    paginasFallidas: new Set(),
    corridaConfiable: true,
    timestamp: "T1",
  });
  assert.equal(primera.cambios.length, 1);
  assert.equal(primera.cambios[0].tipo, "baja");

  // y en la corrida siguiente, ya sellado, un cambio al numero interno tampoco
  // se adopta callado: la migracion se auto-desactivo
  const enOtroPrecio = { ...TAB, bloque: TAB.bloque.replace("o $656.990", "o $479.990"), body: TAB.body.replace("o $656.990", "o $479.990") };
  const obs2 = await extractSingleProduct(fichaQuePintaTarde(enOtroPrecio), TAB.url);
  const segunda = comparar({
    previo: primera.catalogo,
    observado: observar(enOtroPrecio, obs2),
    paginasFallidas: new Set(),
    corridaConfiable: true,
    timestamp: "T2",
  });
  assert.equal(segunda.cambios.length, 1, "ya migrado: cualquier cambio de precio vuelve a avisarse");
  assert.equal(segunda.cambios[0].tipo, "baja");
});

// --- 4. la segunda puerta: el mismo SKU visto desde otra pagina ---------------

test("el precio de LISTA de una pagina familia no vuelca el de la ficha propia", () => {
  // el JSON-LD de galaxy-tab-s10-fe/buy/ publica 729.990 para este SKU: medido,
  // 10 de 10 variantes coinciden con el "Precio original" tachado de su ficha
  const previo = { [TAB.sku]: registro({ modelo: TAB.sku, precio: TAB.cobra, url: TAB.url, paginaOrigen: TAB.url, rango: RANGO.PROPIA, versionPrecio: VERSION_PRECIO }) };
  const familia = { modelo: TAB.sku, nombre: "Galaxy Tab S10 FE 128 GB", precio: 729990, moneda: "CLP", rango: RANGO.FAMILIA, estadoStock: "disponible", disponible: true, url: "https://www.samsung.com/cl/tablets/galaxy-tab-s10-fe/buy/" };
  const observado = {};
  integrarVariantes(observado, { url: familia.url, categoria: "Familia (auto-descubierta)", subcategoria: null, variante: null }, [familia], { via: "familia", timestamp: "T1" });

  const paso1 = comparar({ previo, observado, paginasFallidas: new Set(), corridaConfiable: true, timestamp: "T1" });
  assert.deepEqual(paso1.cambios, [], "otra fuente: se espera corroboracion antes de avisar");
  assert.equal(paso1.catalogo[TAB.sku].precio, TAB.cobra, "y NO se adopta todavia");
  assert.equal(paso1.catalogo[TAB.sku].precioPendiente, 729990);

  // si la ficha propia vuelve a leerse bien, el rebote muere aca
  const vuelta = comparar({
    previo: paso1.catalogo,
    observado: observar(TAB, { modelo: TAB.sku, precio: TAB.cobra, moneda: "CLP", rango: RANGO.PROPIA, estadoStock: "disponible", disponible: true, url: TAB.url, versionPrecio: VERSION_PRECIO }),
    paginasFallidas: new Set(),
    corridaConfiable: true,
    timestamp: "T2",
  });
  assert.deepEqual(vuelta.cambios, [], "el vaiven entre dos paginas no gasta ni un aviso");
  assert.equal(vuelta.catalogo[TAB.sku].precio, TAB.cobra);
  assert.equal(vuelta.catalogo[TAB.sku].precioPendiente, undefined);
});

test("dos corridas de la pagina familia y vuelve la ficha propia: CERO avisos", () => {
  // EL CASO MEDIDO SOBRE EL HISTORIAL REAL, que la regla anterior convertia en
  // DOS avisos falsos. La ficha propia falla dos corridas seguidas (el reintento
  // de run.mjs declara 10-30 timeouts por corrida, asi que un doble fallo no es
  // raro); la pagina familia repite su precio de LISTA, la corroboracion lo daba
  // por bueno -> "sube", y al volver la ficha propia -> "baja". Un precio que
  // nunca cambio, dos avisos, y tres corridas con el numero equivocado guardado.
  const previo = { [TAB.sku]: registro({ modelo: TAB.sku, precio: TAB.cobra, url: TAB.url, paginaOrigen: TAB.url, rango: RANGO.PROPIA, versionPrecio: VERSION_PRECIO }) };
  const entry = { url: "https://www.samsung.com/cl/tablets/galaxy-tab-s10-fe/buy/", categoria: "Familia (auto-descubierta)", subcategoria: null, variante: null };
  const familia = { modelo: TAB.sku, nombre: "Galaxy Tab S10 FE", precio: 729990, moneda: "CLP", rango: RANGO.FAMILIA, estadoStock: "disponible", disponible: true, url: entry.url };
  const obsFamilia = () => integrarVariantes({}, entry, [familia], { via: "familia", timestamp: "T" });

  const t1 = comparar({ previo, observado: obsFamilia(), paginasFallidas: new Set(), corridaConfiable: true, timestamp: "T1" });
  assert.deepEqual(t1.cambios, [], "una pagina que vale MENOS no toca el precio de la ficha propia");
  const t2 = comparar({ previo: t1.catalogo, observado: obsFamilia(), paginasFallidas: new Set(), corridaConfiable: true, timestamp: "T2" });
  assert.deepEqual(t2.cambios, [], "ni repitiendolo: repetir no es corroborar cuando el rango es menor");
  assert.equal(t2.catalogo[TAB.sku].precio, TAB.cobra, "el precio guardado sigue siendo el de la ficha propia");

  const t3 = comparar({
    previo: t2.catalogo,
    observado: observar(TAB, { modelo: TAB.sku, precio: TAB.cobra, moneda: "CLP", rango: RANGO.PROPIA, estadoStock: "disponible", disponible: true, url: TAB.url, versionPrecio: VERSION_PRECIO }),
    paginasFallidas: new Set(),
    corridaConfiable: true,
    timestamp: "T3",
  });
  assert.deepEqual(t3.cambios, [], "y la vuelta de la ficha propia tampoco cuesta un aviso");
  assert.equal(t3.catalogo[TAB.sku].precio, TAB.cobra);
});

test("pero si la ficha propia NO vuelve, el precio de la familia se adopta igual (con tope)", () => {
  // el caso que un arreglo ingenuo ("que el rango menor no toque el precio nunca")
  // congelaria para siempre: la ficha propia murio y la unica fuente que queda es
  // la pagina familia. Se atrasa UMBRAL_PRECIO_OTRA_FUENTE corridas, no se pierde.
  const previo = { [TAB.sku]: registro({ modelo: TAB.sku, precio: TAB.cobra, url: TAB.url, paginaOrigen: TAB.url, rango: RANGO.PROPIA, versionPrecio: VERSION_PRECIO }) };
  const entry = { url: "https://www.samsung.com/cl/tablets/galaxy-tab-s10-fe/buy/", categoria: "Familia (auto-descubierta)", subcategoria: null, variante: null };
  const familia = { modelo: TAB.sku, nombre: "Galaxy Tab S10 FE", precio: 599990, moneda: "CLP", rango: RANGO.FAMILIA, estadoStock: "disponible", disponible: true, url: entry.url };
  const obsFamilia = () => integrarVariantes({}, entry, [familia], { via: "familia", timestamp: "T" });

  let catalogo = previo;
  let ultimos = [];
  for (let i = 0; i < UMBRAL_PRECIO_OTRA_FUENTE; i++) {
    const paso = comparar({ previo: catalogo, observado: obsFamilia(), paginasFallidas: new Set(), corridaConfiable: true, timestamp: `T${i}` });
    catalogo = paso.catalogo;
    ultimos = paso.cambios;
    if (i < UMBRAL_PRECIO_OTRA_FUENTE - 1) assert.deepEqual(ultimos, [], `corrida ${i + 1}: todavia se espera a la ficha propia`);
  }
  assert.equal(ultimos.length, 1, "al agotarse la espera se adopta y se avisa: nada queda congelado para siempre");
  assert.equal(ultimos[0].tipo, "baja");
  assert.equal(ultimos[0].desdeOtraFuente, true, "y el aviso declara que el numero viene de otra pagina");
  assert.equal(catalogo[TAB.sku].precio, 599990);
});



test("paginas GEMELAS (las dos rango PROPIA) tampoco pueden volcarse el precio", () => {
  // 135 SKU se scrapean dos veces por corrida: su ficha plana del seed y su
  // propia /buy/ descubierta por sitemap. Las dos valen PROPIA, asi que el rango
  // no arbitra nada y decide el orden de llegada.
  const gemela = `${TAB.url}buy/`;
  const previo = { [TAB.sku]: registro({ modelo: TAB.sku, precio: TAB.cobra, url: TAB.url, paginaOrigen: TAB.url, rango: RANGO.PROPIA, versionPrecio: VERSION_PRECIO }) };
  const desdeGemela = observar(TAB, { modelo: TAB.sku, precio: 729990, moneda: "CLP", rango: RANGO.PROPIA, estadoStock: "disponible", disponible: true, url: gemela, versionPrecio: VERSION_PRECIO }, { url: gemela });
  const paso = comparar({ previo, observado: desdeGemela, paginasFallidas: new Set(), corridaConfiable: true, timestamp: "T1" });
  assert.deepEqual(paso.cambios, [], "otra pagina, aunque valga lo mismo: corroboracion primero");
  assert.equal(paso.catalogo[TAB.sku].precio, TAB.cobra);
});

// --- 5. una lectura sin precio no borra nada, y se ve --------------------------

test("dos paginas del mismo SKU en la misma corrida: la que no leyo precio no borra la que si", () => {
  const observado = {};
  const buena = { modelo: TAB.sku, precio: TAB.cobra, moneda: "CLP", rango: RANGO.PROPIA, estadoStock: "disponible", disponible: true, url: TAB.url };
  const sinPrecio = { modelo: TAB.sku, moneda: "CLP", rango: RANGO.PROPIA, estadoStock: "disponible", disponible: true, url: `${TAB.url}buy/`, precioIlegible: true };
  integrarVariantes(observado, entradaDe(TAB), [buena], { via: "individual", timestamp: "T" });
  integrarVariantes(observado, entradaDe(TAB, `${TAB.url}buy/`), [sinPrecio], { via: "individual", timestamp: "T" });
  assert.equal(observado[TAB.sku].precio, TAB.cobra, "el orden de llegada no puede borrar el unico precio leido");
});

test("un SKU visto por PRIMERA vez sin precio no se anuncia como nuevo", async () => {
  const obs = await extractSingleProduct(fichaQuePintaTarde(TAB, { pintaEnLaEspera: false }), TAB.url);
  const paso1 = comparar({ previo: {}, observado: observar(TAB, obs), paginasFallidas: new Set(), corridaConfiable: true, timestamp: "T1" });
  assert.deepEqual(paso1.cambios, [], "sin precio no hay nada que contar todavia");
  assert.ok(paso1.catalogo[TAB.sku], "pero el SKU queda vigilado");

  // y cuando por fin se lee, ahi si sale el "nuevo"
  const obs2 = await extractSingleProduct(fichaQuePintaTarde(TAB), TAB.url);
  const paso2 = comparar({ previo: paso1.catalogo, observado: observar(TAB, obs2), paginasFallidas: new Set(), corridaConfiable: true, timestamp: "T2" });
  assert.equal(paso2.cambios.length, 1);
  assert.equal(paso2.cambios[0].tipo, "nuevo");
  assert.equal(paso2.cambios[0].precio, TAB.cobra);
});

test("un precio congelado muchas corridas se avisa UNA vez por el canal tecnico", () => {
  let estado = { [TAB.sku]: registro({ modelo: TAB.sku, precio: TAB.cobra, url: TAB.url, paginaOrigen: TAB.url, rango: RANGO.PROPIA, versionPrecio: VERSION_PRECIO }) };
  const sinPrecio = { modelo: TAB.sku, moneda: "CLP", rango: RANGO.PROPIA, estadoStock: "disponible", disponible: true, url: TAB.url, precioIlegible: true };
  for (let i = 0; i < UMBRAL_SIN_VERIFICAR; i++) {
    const paso = comparar({ previo: estado, observado: observar(TAB, sinPrecio), paginasFallidas: new Set(), corridaConfiable: true, timestamp: `T${i}` });
    assert.deepEqual(paso.cambios, [], "callarse no es avisar");
    estado = paso.catalogo;
  }
  assert.equal(estado[TAB.sku].precio, TAB.cobra, "el precio bueno sigue ahi");
  const avisos = marcarSinPrecioProlongado(estado);
  assert.equal(avisos.length, 1);
  assert.equal(avisos[0].modelo, TAB.sku);
  assert.equal(marcarSinPrecioProlongado(estado).length, 0, "una sola vez por SKU");
});

test("un producto que Samsung no vende no genera aviso tecnico por no mostrar precio", () => {
  // medido en vivo el 2026-09-12 en la ficha del control remoto AR-KH00E: su
  // bloque dice "no está a la venta" y la pagina no escribe NINGUN monto
  // (digitalData publica 47.020 en model_price y en list_price, y ese numero no
  // aparece en la pagina). Son 426 de los 933 registros activos los que no estan
  // "disponible": avisarlos seria un aviso tecnico inservible.
  let estado = { "AR-KH00E": registro({ modelo: "AR-KH00E", precio: 47020, url: "https://x/ar", paginaOrigen: "https://x/ar", rango: RANGO.PROPIA, versionPrecio: VERSION_PRECIO, estadoStock: "no-a-la-venta", disponible: false }) };
  const sinPrecio = { modelo: "AR-KH00E", moneda: "CLP", rango: RANGO.PROPIA, estadoStock: "no-a-la-venta", disponible: false, url: "https://x/ar", precioIlegible: true };
  for (let i = 0; i < UMBRAL_SIN_VERIFICAR + 2; i++) {
    estado = comparar({
      previo: estado,
      observado: integrarVariantes({}, { url: "https://x/ar", categoria: "Accesorios línea blanca", subcategoria: null, variante: null }, [sinPrecio], { via: "individual", timestamp: `T${i}` }),
      paginasFallidas: new Set(),
      corridaConfiable: true,
      timestamp: `T${i}`,
    }).catalogo;
  }
  assert.ok(estado["AR-KH00E"].corridasSinPrecio > UMBRAL_SIN_VERIFICAR, "se cuenta igual, para el resumen de la corrida");
  assert.deepEqual(marcarSinPrecioProlongado(estado), [], "pero no se avisa: no hay nada que arreglar");
});

test("un precio null EXPLICITO tampoco borra el precio guardado", () => {
  // el campo se omite (extract.mjs), pero si alguna vez llegara en null el
  // resultado tiene que ser el mismo: medido, un `precio: null` dejaba el
  // registro sin precio y la corrida siguiente emitia "nuevo".
  const previo = { [TAB.sku]: registro({ modelo: TAB.sku, precio: TAB.cobra, url: TAB.url, paginaOrigen: TAB.url, rango: RANGO.PROPIA, versionPrecio: VERSION_PRECIO }) };
  const paso1 = comparar({
    previo,
    observado: observar(TAB, { modelo: TAB.sku, precio: null, moneda: "CLP", rango: RANGO.PROPIA, estadoStock: "disponible", disponible: true, url: TAB.url, versionPrecio: VERSION_PRECIO }),
    paginasFallidas: new Set(),
    corridaConfiable: true,
    timestamp: "T1",
  });
  assert.deepEqual(paso1.cambios, []);
  assert.equal(paso1.catalogo[TAB.sku].precio, TAB.cobra);
  const paso2 = comparar({
    previo: paso1.catalogo,
    observado: observar(TAB, { modelo: TAB.sku, precio: TAB.cobra, moneda: "CLP", rango: RANGO.PROPIA, estadoStock: "disponible", disponible: true, url: TAB.url, versionPrecio: VERSION_PRECIO }),
    paginasFallidas: new Set(),
    corridaConfiable: true,
    timestamp: "T2",
  });
  assert.deepEqual(paso2.cambios, [], "y la corrida siguiente no lo anuncia como nuevo");
});

test("los rastros de diagnostico del precio nunca se guardan en el catalogo", async () => {
  const obs = await extractSingleProduct(fichaQuePintaTarde(TAB), TAB.url);
  assert.equal(obs.precioInterno, 479990, "el extractor SI los emite...");
  const nuevo = comparar({ previo: {}, observado: observar(TAB, obs), paginasFallidas: new Set(), corridaConfiable: true, timestamp: "T1" });
  const existente = comparar({
    previo: { [TAB.sku]: registro({ modelo: TAB.sku, precio: TAB.cobra, url: TAB.url, paginaOrigen: TAB.url, rango: RANGO.PROPIA, versionPrecio: VERSION_PRECIO }) },
    observado: observar(TAB, obs),
    paginasFallidas: new Set(),
    corridaConfiable: true,
    timestamp: "T1",
  });
  for (const cat of [nuevo.catalogo, existente.catalogo]) {
    for (const campo of ["precioTachado", "precioInterno", "precioIlegible"]) {
      assert.equal(campo in cat[TAB.sku], false, `${campo} describe la lectura, no el producto`);
    }
  }
});
