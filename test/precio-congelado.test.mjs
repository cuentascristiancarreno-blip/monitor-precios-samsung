// PRECIOS CONGELADOS DE MAS (2026-09-13).
//
// El arreglo del vaiven (2026-09-12) exige que el monto este ESCRITO en la
// pagina antes de adoptarlo, y si no hay ninguno escrito la observacion va SIN
// precio. Eso cerro la carrera contra el render, pero dejo 94 SKU sin poder leer
// su precio nunca mas: paginas "no-a-la-venta", que no dibujan ningun monto
// porque Samsung no vende ese producto online. Un producto sin precio legible
// queda con el ultimo precio bueno presentado como vigente y NO se puede enterar
// de que Samsung se lo cambio.
//
// LO MEDIDO EN PRODUCCION: el contador precioCongelado del resumen fue
// 72 -> 85 -> 91 -> 94 en cuatro corridas seguidas (ejecuciones.jsonl del
// 2026-09-12); 57 de esos 94 llevaban las 4 corridas sin poder leer su precio,
// 47 son notificables y los 94 estan "no-a-la-venta".
//
// LAS CUATRO FICHAS DE ABAJO SE CARGARON EN VIVO el 2026-09-13. En tres de las
// cuatro, digitalData publica model_price y list_price con EL MISMO NUMERO y el
// precio guardado coincide con el. EL CONTROL es la cuarta, F-UN85MHWB450, con
// los dos montos DISTINTOS (1.659.980 = 1.099.990 + 559.990, la suma de las
// partes del pack): ahi hay dos candidatos y tiene que seguir congelada.
//
// POR QUE LA REGLA NO ES "LOS DOS MONTOS IGUALES" A SECAS (defecto medido, y
// esta es la razon de ser de la mitad de este archivo). La primera version de
// este arreglo devolvia el model_price desde precioVisiblePreferido en cuanto
// los dos montos de digitalData coincidian. Hay un TERCER numero, el del bloque
// de compra, y es el que manda cuando se deja leer: con model_price ===
// list_price === el TACHADO y el bloque a medio pintar, esa version reabria el
// vaiven con su forma de siempre (4 avisos falsos en 5 corridas; 5 en el orden
// inverso). Y gatear la concesion en "el bloque se dejo leer" tampoco alcanza:
// un bloque que ya tiene texto pero todavia no escribio su monto ("Comprar" a
// secas, "Cargando...") daba otros 4 y 3 avisos falsos. La regla que quedo es
// mas estrecha: se adopta el candidato unico SOLO cuando la pagina misma declara
// que no lo vende online ("Dónde comprar" / "No está a la venta"), que es
// literalmente el caso de las tres fichas medidas.
import { test } from "node:test";
import assert from "node:assert/strict";
import { extractSingleProduct, precioAdoptable, precioVisiblePreferido, VERSION_PRECIO } from "../src/extract.mjs";
import { integrarVariantes } from "../src/catalogo.mjs";
import { comparar } from "../src/comparar.mjs";
import { RANGO } from "../src/identidad.mjs";

// --- las cuatro fichas reales, con sus numeros literales ---------------------
//
// El `body` es lo que devuelve document.body.innerText en estas paginas: NO
// trae ningun monto escrito. Eso es justo lo que las congela.

const COCINA = {
  sku: "NX52A5411CS/ZS",
  url: "https://www.samsung.com/cl/cooking-appliances/nx52a5411cs-zs/",
  modelPrice: "479990",
  listPrice: "479990",
  bloque: "No está a la venta",
  body: "Cocina empotrable NX52A5411CS/ZS\nCaracteristicas\nNo está a la venta",
  guardado: 479990,
};

const NOTEBOOK = {
  sku: "NP750XGJ-KS3CL",
  url: "https://www.samsung.com/cl/computers/galaxy-book/np750xgj-ks3cl/",
  modelPrice: "899990",
  listPrice: "899990",
  bloque: "No está a la venta",
  body: "Galaxy Book4\nEspecificaciones\nNo está a la venta",
  guardado: 899990,
};

const FRAME = {
  sku: "QN43LS03BAGXZS",
  url: "https://www.samsung.com/cl/lifestyle-tvs/the-frame/ls03b-43-inch-qn43ls03bagxzs/",
  modelPrice: "839990",
  listPrice: "839990",
  bloque: "Dónde comprar",
  body: "The Frame 43''\nDónde comprar",
  guardado: 839990,
};

// EL CONTROL: los dos montos distintos, o sea carrera posible.
const PACK = {
  sku: "F-UN85MHWB450",
  url: "https://www.samsung.com/cl/tvs/f-un85mhwb450/",
  modelPrice: "1099990",
  listPrice: "1659980",
  bloque: "Dónde comprar",
  body: "TV 85'' + Barra de sonido\nDónde comprar",
  guardado: 1099990,
};

// EL OTRO CONTROL, el que refuto la primera version del arreglo: una ficha que
// SI se vende, con oferta, y cuyo digitalData publica el mismo numero en los dos
// campos -- y ese numero es el TACHADO. El precio de verdad (lo que el cliente
// paga) solo aparece en el bloque de compra.
const OFERTA_TEXTO = "Desde $ 49.999 en 12 cuotas sin intereses* o $599.990 Precio original: $839.990 Ahorra $ 240.000";
const OFERTA = {
  sku: FRAME.sku,
  url: FRAME.url,
  modelPrice: "839990",
  listPrice: "839990",
  bloque: OFERTA_TEXTO,
  ctas: ["Comprar"],
  body: `The Frame 43''\n${OFERTA_TEXTO}\nComprar`,
  guardado: 599990,
};
// la MISMA ficha leida a medio renderizar: el body todavia sin montos y el
// bloque en alguno de sus tres estados posibles
const SIN_PINTAR = "The Frame 43''\nCaracteristicas\nOpiniones";

/**
 * Doble de pagina con las lecturas del DOM separadas, igual que el de
 * test/precio-sin-carrera.test.mjs. `bloque` puede ser "auto" (el de la ficha),
 * "ilegible" (el evaluate revienta, que es lo que atrapa el `.catch(() => null)`
 * de leerBloqueCompra) o un texto propio; `body` reemplaza al de la ficha.
 */
function pagina(ficha, { bloque = "auto", body = null, ctas = null } = {}) {
  let evaluaciones = 0;
  return {
    url: () => ficha.url,
    async waitForFunction() {},
    async evaluate() {
      evaluaciones += 1;
      if (evaluaciones === 1) {
        return { model_price: ficha.modelPrice, list_price: ficha.listPrice, model_code: ficha.sku, displayName: "Producto" };
      }
      if (evaluaciones === 2) return body ?? ficha.body;
      if (evaluaciones === 3) {
        if (bloque === "ilegible") throw new Error("evaluate fallido");
        const texto = bloque === "auto" ? ficha.bloque : bloque;
        return { texto, ctas: ctas ?? (bloque === "auto" ? ficha.ctas ?? [] : []), ctasBarra: [] };
      }
      return {};
    },
  };
}

const registro = (ficha, extra = {}) => ({
  modelo: ficha.sku,
  nombre: "Producto",
  precio: ficha.guardado,
  moneda: "CLP",
  categoria: "Televisores",
  url: ficha.url,
  paginaOrigen: ficha.url,
  rango: RANGO.PROPIA,
  presencia: "activo",
  ausencias: 0,
  notificadoDesaparecido: false,
  estadoStock: "no-a-la-venta",
  disponible: false,
  versionStock: 2,
  // las tres cuartas partes de los 94 congelados siguen con versionPrecio 2 (la
  // ventana de migracion quedo abierta porque no hubo lectura util que la sellara)
  versionPrecio: 2,
  corridasSinPrecio: 4,
  sinPrecioDesde: "T0",
  ...extra,
});

let reloj = 0;
// Una corrida entera: una o mas paginas leidas y despues comparar(). El
// timestamp avanza 6 h por corrida, como en produccion.
async function corrida(lecturas, catalogo) {
  reloj += 1;
  const timestamp = new Date(Date.UTC(2026, 8, 13, reloj * 6)).toISOString();
  const observado = {};
  for (const { ficha, url, ...opciones } of lecturas) {
    const destino = url ?? ficha.url;
    const obs = await extractSingleProduct(pagina({ ...ficha, url: destino }, opciones), destino);
    integrarVariantes(observado, { url: destino, categoria: "Televisores", subcategoria: null, variante: null }, [obs], {
      via: "individual",
      timestamp,
    });
  }
  return comparar({ previo: catalogo, observado, paginasFallidas: new Set(), corridaConfiable: true, timestamp });
}

async function unaCorrida(ficha, catalogo, opciones = {}) {
  return corrida([{ ficha, ...opciones }], catalogo);
}

// avisos de PRECIO (los que salen a Discord como "subio"/"bajo"), sin los de stock
const dePrecio = (cambios) => cambios.filter((c) => c.tipo === "sube" || c.tipo === "baja" || c.tipo === "nuevo");

// === 1. la regla, en la funcion que adopta ==================================
//
// La concesion vive en precioAdoptable y NO en precioVisiblePreferido: solo
// aca se sabe que dijo el bloque de compra.

test("con los dos montos iguales y la pagina declarando que no lo vende, hay precio", () => {
  // los tres casos medidos en vivo el 2026-09-13: la pagina no dibuja ningun
  // monto porque no lo vende online, asi que el unico numero que existe vale
  for (const [monto, texto] of [
    [479990, COCINA.body],
    [899990, NOTEBOOK.body],
    [839990, FRAME.body],
  ]) {
    assert.equal(
      precioAdoptable({
        precioBloque: null,
        precioFinal: null,
        modelPrice: monto,
        listPrice: monto,
        bloqueLegible: true,
        paginaNoLoVendeOnline: true,
        bodyText: texto,
      }),
      monto,
    );
  }
});

test("si la pagina NO dijo que deja de venderlo, no se adopta nada", () => {
  // el bloque se dejo leer pero todavia no escribio su monto ("Comprar" a
  // secas): es indistinguible de uno que no lo va a escribir nunca
  assert.equal(
    precioAdoptable({
      precioBloque: null,
      precioFinal: null,
      modelPrice: 839990,
      listPrice: 839990,
      bloqueLegible: true,
      paginaNoLoVendeOnline: false,
      bodyText: SIN_PINTAR,
    }),
    null,
  );
  // y el bloque que directamente no se pudo leer, tampoco
  assert.equal(
    precioAdoptable({
      precioBloque: null,
      precioFinal: null,
      modelPrice: 839990,
      listPrice: 839990,
      bloqueLegible: false,
      paginaNoLoVendeOnline: false,
      bodyText: SIN_PINTAR,
    }),
    null,
  );
});

test("EL CONTROL: con DOS candidatos no se adopta ninguno, en cualquier orden", () => {
  const pack = (modelPrice, listPrice) =>
    precioAdoptable({
      precioBloque: null,
      precioFinal: null,
      modelPrice,
      listPrice,
      bloqueLegible: true,
      paginaNoLoVendeOnline: true,
      bodyText: PACK.body,
    });
  // F-UN85MHWB450 tal como lo publica su pagina
  assert.equal(pack(1099990, 1659980), null);
  // y el mismo par dado vuelta: la regla es "un solo candidato", no "el menor de
  // los dos" (fija el otro lado del limite: >= y <= mueren aca)
  assert.equal(pack(1659980, 1099990), null);
});

test("precioVisiblePreferido NO resuelve el caso: sin monto escrito devuelve null", () => {
  // la primera version del arreglo ponia la concesion aca, donde no se sabe si
  // el bloque se dejo leer. Esta prueba es el ancla de esa refutacion.
  assert.equal(precioVisiblePreferido(479990, 479990, COCINA.body), null);
  assert.equal(precioVisiblePreferido(839990, 839990, ""), null);
  assert.equal(precioVisiblePreferido(1099990, 1659980, PACK.body), null);
  assert.equal(precioVisiblePreferido(1659980, 1099990, PACK.body), null);
  // lo que si sigue haciendo: elegir el que ESTA escrito
  assert.equal(precioVisiblePreferido(555980, 974980, "o $974.980"), 974980);
});

test("un monto marcado 'Precio original' no se adopta ni con los dos montos iguales", () => {
  // si la propia pagina dice que ese numero es el de ANTES, no es el precio
  // aunque sea el unico candidato de digitalData
  assert.equal(
    precioAdoptable({
      precioBloque: null,
      precioFinal: null,
      modelPrice: 479990,
      listPrice: 479990,
      bloqueLegible: true,
      paginaNoLoVendeOnline: true,
      bodyText: "Producto\nPrecio original: $479.990\nDónde comprar",
    }),
    null,
  );
});

// === 2. el cableado: la misma regla por el flujo real de la ficha ============

test("las tres fichas de montos iguales se destraban y salen con su precio", async () => {
  for (const ficha of [COCINA, NOTEBOOK, FRAME]) {
    const r = await extractSingleProduct(pagina(ficha), ficha.url);
    assert.equal(r.precio, ficha.guardado, `${ficha.sku} tiene que leer su precio`);
    assert.equal(r.precioIlegible, undefined, `${ficha.sku}: la lectura no es ilegible, la pagina si publica el numero`);
    assert.equal(r.estadoStock, "no-a-la-venta", `${ficha.sku} sigue sin venderse online`);
  }
});

test("EL CONTROL sigue congelado por el flujo real", async () => {
  const r = await extractSingleProduct(pagina(PACK), PACK.url);
  assert.equal("precio" in r, false, "el pack tiene dos candidatos: no se adopta ninguno");
  assert.equal(r.precioIlegible, true, "y la lectura queda marcada, para que la contracara se vea");
  assert.equal(r.precioTachado, 1659980, "el tachado queda como rastro para la migracion");
});

test("la ficha que no dice nada sobre la venta tampoco se destraba", async () => {
  // el bloque se leyo, tiene texto y hasta un CTA, pero no escribio el monto:
  // ahi la respuesta honesta sigue siendo "no se"
  const r = await extractSingleProduct(pagina(FRAME, { bloque: "Comprar", body: SIN_PINTAR, ctas: ["Comprar"] }), FRAME.url);
  assert.equal("precio" in r, false);
  assert.equal(r.precioIlegible, true);
});

test("el veredicto de la API no destraba nada: la llave es lo que dice la PAGINA", async () => {
  // la API por SKU describe el stock de una bodega, no lo que la ficha publica.
  // Con el bloque ilegible, un "outOfStock" de la API decide el stock pero no
  // puede hacer de permiso para adoptar el numero de digitalData: "no se puede
  // comprar" no es lo mismo que "la pagina declaro que no publica precio".
  const api = [{ code: FRAME.sku, stock: { stockLevelStatus: "outOfStock" } }];
  const r = await extractSingleProduct(pagina(FRAME, { bloque: "ilegible", body: SIN_PINTAR }), FRAME.url, api);
  assert.equal(r.estadoStock, "agotado", "el stock si se decide con la API...");
  assert.equal("precio" in r, false, "...pero el precio no");
  assert.equal(r.precioIlegible, true);
});

test("la barra pegajosa decide el stock pero NO destraba el precio", async () => {
  // medido el 2026-09-11 en las paginas "hubble": el bloque de compra no trae
  // ningun CTA y el boton que el cliente ve esta en la barra de abajo, diciendo
  // literalmente "No está a la venta". Esa barra alcanza para el stock, pero la
  // llave del precio es el BLOQUE, que es donde iria el monto: nadie midio si la
  // barra puede decir eso mientras el bloque se termina de pintar, asi que se
  // prefiere seguir congelado.
  let n = 0;
  const conBarra = {
    url: () => FRAME.url,
    async waitForFunction() {},
    async evaluate() {
      n += 1;
      if (n === 1) return { model_price: FRAME.modelPrice, list_price: FRAME.listPrice, model_code: FRAME.sku, displayName: "Producto" };
      if (n === 2) return FRAME.body;
      if (n === 3) return { texto: null, ctas: [], ctasBarra: ["No está a la venta"] };
      return {};
    },
  };
  const r = await extractSingleProduct(conBarra, FRAME.url);
  assert.equal(r.estadoStock, "no-a-la-venta", "el stock si se decide con la barra...");
  assert.equal("precio" in r, false, "...pero el precio no");
});

// === 3. destrabar no manda avisos ===========================================

test("destrabar las tres fichas NO emite ningun aviso de precio", async () => {
  // el precio guardado ES el model_price (medido: los tres coinciden exacto),
  // asi que adoptarlo no cambia nada
  for (const ficha of [COCINA, NOTEBOOK, FRAME]) {
    const paso = await unaCorrida(ficha, { [ficha.sku]: registro(ficha) });
    assert.deepEqual(paso.cambios, [], `${ficha.sku} no puede mandar un aviso`);
    assert.equal(paso.catalogo[ficha.sku].precio, ficha.guardado);
    assert.equal(paso.catalogo[ficha.sku].corridasSinPrecio, undefined, `${ficha.sku} deja de estar congelado`);
    assert.equal(paso.catalogo[ficha.sku].sinPrecioDesde, undefined, "y el ancla de reloj se va con el contador");
  }
});

test("EL CONTROL: sigue congelado, conserva su precio y suma una corrida", async () => {
  const paso = await unaCorrida(PACK, { [PACK.sku]: registro(PACK) });
  assert.deepEqual(paso.cambios, [], "un pack congelado tampoco avisa nada");
  assert.equal(paso.catalogo[PACK.sku].precio, PACK.guardado, "conserva el ultimo precio bueno");
  assert.equal(paso.catalogo[PACK.sku].corridasSinPrecio, 5, "y el contador sigue subiendo: 4 -> 5");
  assert.equal(paso.catalogo[PACK.sku].sinPrecioDesde, "T0", "el ancla de reloj no se mueve");
});

// === 4. lo que se RECUPERA: la cobertura ====================================

test("destrabada, una baja de verdad en esa ficha SI se avisa", async () => {
  // esto es lo que costaba el congelamiento: mientras el SKU no tenga precio, un
  // cambio de Samsung no se puede detectar nunca. Medido sobre los 94: 15
  // eventos de precio en 54,5 dias, o sea el hecho ocurre.
  const rebajada = { ...COCINA, modelPrice: "399990", listPrice: "399990" };
  const paso = await unaCorrida(rebajada, { [COCINA.sku]: registro(COCINA) });
  assert.equal(paso.cambios.length, 1, "una baja real tiene que salir");
  assert.equal(paso.cambios[0].tipo, "baja");
  assert.equal(paso.cambios[0].precioAnterior, 479990);
  assert.equal(paso.cambios[0].precio, 399990);
});

// === 5. la regla no reabre la puerta del vaiven =============================
//
// Los cuatro escenarios que refutaron las dos versiones anteriores. Todos usan
// la MISMA ficha con oferta (model_price === list_price === el tachado) y solo
// cambian en que instante se la leyo.

test("ficha con oferta y montos iguales: el render intermitente no manda un solo aviso", async () => {
  // ESTE es el escenario que reabria el vaiven: el bloque publica $599.990 y
  // digitalData publica 839.990 en los dos campos, que es el TACHADO
  let catalogo = { [OFERTA.sku]: registro(OFERTA, { estadoStock: "disponible", disponible: true, versionPrecio: 3, corridasSinPrecio: undefined, sinPrecioDesde: undefined }) };
  const avisos = [];
  for (const opciones of [{}, { bloque: "ilegible", body: SIN_PINTAR }, {}, { bloque: "ilegible", body: SIN_PINTAR }, {}]) {
    const paso = await unaCorrida(OFERTA, catalogo, opciones);
    catalogo = paso.catalogo;
    avisos.push(...dePrecio(paso.cambios));
  }
  assert.deepEqual(avisos, [], "ni un aviso en 5 corridas");
  assert.equal(catalogo[OFERTA.sku].precio, 599990, "y el precio guardado es el que cobra el bloque");
});

test("el mismo material en el ORDEN INVERSO tampoco avisa (simetria)", async () => {
  let catalogo = { [OFERTA.sku]: registro(OFERTA, { estadoStock: "disponible", disponible: true, versionPrecio: 3, corridasSinPrecio: undefined, sinPrecioDesde: undefined }) };
  const avisos = [];
  for (const opciones of [{ bloque: "ilegible", body: SIN_PINTAR }, {}, { bloque: "ilegible", body: SIN_PINTAR }, {}, { bloque: "ilegible", body: SIN_PINTAR }]) {
    const paso = await unaCorrida(OFERTA, catalogo, opciones);
    catalogo = paso.catalogo;
    avisos.push(...dePrecio(paso.cambios));
  }
  assert.deepEqual(avisos, [], "ni un aviso en 5 corridas");
  assert.equal(catalogo[OFERTA.sku].precio, 599990);
});

test("un bloque con texto pero todavia sin monto tampoco reabre el vaiven", async () => {
  // la variante que mata al mutante "alcanza con que el bloque sea legible":
  // "Comprar" a secas y "Cargando..." son bloques legibles que NO declaran nada
  for (const aMedias of [
    { bloque: "Comprar", ctas: ["Comprar"], body: SIN_PINTAR },
    { bloque: "Cargando...", ctas: [], body: SIN_PINTAR },
  ]) {
    let catalogo = { [OFERTA.sku]: registro(OFERTA, { estadoStock: "disponible", disponible: true, versionPrecio: 3, corridasSinPrecio: undefined, sinPrecioDesde: undefined }) };
    const avisos = [];
    for (const opciones of [{}, aMedias, {}, aMedias, {}]) {
      const paso = await unaCorrida(OFERTA, catalogo, opciones);
      catalogo = paso.catalogo;
      avisos.push(...dePrecio(paso.cambios));
    }
    assert.deepEqual(avisos, [], `ni un aviso con el bloque "${aMedias.bloque}"`);
    assert.equal(catalogo[OFERTA.sku].precio, 599990);
  }
});

test("con la pagina declarando siempre lo mismo, cinco corridas dan lo mismo", async () => {
  // el caso medido de verdad: la ficha no-a-la-venta, cinco veces seguidas
  let catalogo = { [COCINA.sku]: registro(COCINA) };
  const avisos = [];
  for (let i = 0; i < 5; i += 1) {
    const paso = await unaCorrida(COCINA, catalogo);
    catalogo = paso.catalogo;
    avisos.push(...paso.cambios);
  }
  assert.deepEqual(avisos, [], "ni un aviso en 5 corridas");
  assert.equal(catalogo[COCINA.sku].precio, 479990);
  assert.equal(catalogo[COCINA.sku].versionPrecio, VERSION_PRECIO, "y la lectura util si sella la migracion");
});

test("EL CONTROL: el pack con el bloque ilegible NO adopta el tachado", async () => {
  // la defensa central del arreglo del vaiven sigue en pie donde hace falta
  const r = await extractSingleProduct(pagina(PACK, { bloque: "ilegible" }), PACK.url);
  assert.equal("precio" in r, false);
  assert.notEqual(r.precio, 1659980);
});

// === 6. la amnistia de la migracion no se quema con una lectura ciega =======

test("una lectura que no vio nada NO sella versionPrecio ni quema la amnistia", async () => {
  // 57 de los 94 congelados estan exactamente asi: versionPrecio 2 y, guardado,
  // un numero que nadie verifico nunca contra la pagina (puede ser el tachado).
  // Si una lectura ciega sellara la version, la primera lectura buena saldria a
  // Discord como "bajo 839.990 -> 599.990" en vez de como correccion tecnica.
  const inicial = { [OFERTA.sku]: registro({ ...OFERTA, guardado: 839990 }) };
  const ciega = await unaCorrida(OFERTA, inicial, { bloque: "ilegible", body: SIN_PINTAR });
  assert.equal(ciega.catalogo[OFERTA.sku].versionPrecio, 2, "la ventana de migracion sigue abierta");
  assert.deepEqual(dePrecio(ciega.cambios), [], "y la lectura ciega no avisa nada");

  const buena = await unaCorrida(OFERTA, ciega.catalogo);
  assert.deepEqual(dePrecio(buena.cambios), [], "la lectura buena no sale como aviso de precio");
  assert.equal(buena.correccionesDePrecio.length, 1, "sale por el canal tecnico silencioso");
  assert.equal(buena.correccionesDePrecio[0].precioAnterior, 839990);
  assert.equal(buena.correccionesDePrecio[0].precio, 599990);
  assert.equal(buena.catalogo[OFERTA.sku].versionPrecio, VERSION_PRECIO);
});

// === 7. dos paginas del mismo SKU en la misma corrida =======================

test("las dos paginas del mismo SKU no dependen del orden de llegada", async () => {
  // 135 SKU se scrapean dos veces por corrida (su ficha plana del seed y su
  // propia /buy/), las dos con rango PROPIA, y run.mjs manda las paginas lentas
  // al final: el orden no es estable. Si la que no se dejo leer trajera un
  // precio igual, conservaPrecio (src/catalogo.mjs) no se activaria y el
  // resultado cambiaria segun quien llegue primero.
  const BUY = `${OFERTA.url}buy/`;
  const pintada = { ficha: OFERTA, url: BUY };
  const aMedias = { ficha: OFERTA, bloque: "ilegible", body: SIN_PINTAR };
  for (const orden of [
    [pintada, aMedias],
    [aMedias, pintada],
  ]) {
    let catalogo = {
      [OFERTA.sku]: registro(OFERTA, { url: BUY, paginaOrigen: BUY, estadoStock: "disponible", disponible: true, versionPrecio: 3, corridasSinPrecio: undefined, sinPrecioDesde: undefined }),
    };
    const avisos = [];
    for (let i = 0; i < 4; i += 1) {
      const paso = await corrida(orden, catalogo);
      catalogo = paso.catalogo;
      avisos.push(...dePrecio(paso.cambios));
    }
    assert.deepEqual(avisos, [], "ni un aviso en 4 corridas");
    assert.equal(catalogo[OFERTA.sku].precio, 599990, "y el precio queda en el que publica el bloque");
  }
});
