// TERCERA VUELTA DEL VAIVEN (2026-09-13): el precio se elegia mirando el texto
// de TODA la pagina, y toda la pagina esta llena de montos que no son de este SKU.
//
// LO MEDIDO ANTES DE TOCAR NADA
//  - Despues del arreglo del 2026-09-12 14:00Z quedaban DOS SKU bailando, no 40:
//    reconstruido de los 22 snapshots de data/latest.json en git y confirmado
//    contra data/history.jsonl (5 avisos de precio despues del corte, 2 SKU).
//      SM-A366ELVGLTL  369.990 <-> 539.990   desde /cl/smartphones/galaxy-a36/buy/
//      LS32DG300ELXZS  199.990 <-> 279.990   desde su propia ficha plana
//    En los dos, la paginaOrigen es SIEMPRE LA MISMA y el rango siempre 3: es UNA
//    pagina devolviendo dos precios distintos segun la corrida.
//  - Las dos fichas cargadas en vivo el 2026-09-13 (UA CazadorBot, 5 s entre
//    cargas porque habia una revision de produccion en curso):
//      galaxy-a36/buy/  model 369.990 · list 539.990 · bloque = "Buying Tool" de
//        plantilla hubble. A veces se pinta entero y a veces queda cortado en
//        "Galaxy A36 Desde". Cortado no publica ningun monto.
//      odyssey-g3-...-ls32dg300elxzs/  model 199.990 · list 279.990 · bloque =
//        la barra de precio de verdad (pd-buying-price) diciendo solo "Dónde
//        comprar". El model_price NO esta escrito en ninguna parte del body; el
//        list_price SI. Medido contra la API que la propia pagina pide:
//        price = "$279.990" (BUY) y promotionPrice = "$199.990", o sea que
//        model_price es el precio con promocion y list_price el de lista. Que el
//        279.990 aparezca ademas pegado a la tarjeta del Odyssey G4 del carrusel
//        es casualidad, no la causa (corregido el 2026-09-13, tarde).
//
// LA CAUSA. Cuando el bloque de compra no entrega un monto, quien elegia entre
// model_price y list_price era precioVisiblePreferido, y su criterio es "cual de
// los dos esta escrito en document.body.innerText". Ese texto incluye el
// carrusel de productos relacionados y, en las /buy/ hubble, el selector con los
// precios de todas las variantes. Cual alcanza a aparecer cambia de una carga a
// otra, y con el cambia el precio guardado. Es EXACTAMENTE la trampa que el
// proyecto ya habia cerrado para el STOCK: el TV F6000 traia "Avísame" dos veces
// en el carrusel de alternativas, y por eso la lectura de stock se acoto al
// bloque de compra. El precio nunca se acoto.
//
// EL ARREGLO, en tres piezas, todas del mismo lado: el precio sale de la barra
// de precio de ESTE SKU, o de una pagina que declara que no tiene precio, o de
// ningun lado.
//   1. precioAdoptable: con el bloque mudo y DOS candidatos, el body deja de
//      arbitrar. Si la pagina declara que no la vende online -> model_price
//      (nunca el de lista). Si no declara nada -> no hay precio.
//   2. precioDelBloqueCompra: un bloque que publica VARIOS montos es un selector
//      de grupo; solo decide si senala a un unico candidato de digitalData.
//   3. VERSION_PRECIO 3 -> 4, para que la correccion de los dos SKU que hoy
//      tienen guardado el numero equivocado salga por el canal TECNICO y no como
//      dos avisos de "baja" del 26-31% a dias del Cyber.
import { test } from "node:test";
import assert from "node:assert/strict";
import { extractSingleProduct, precioAdoptable, precioDelBloqueCompra, VERSION_PRECIO } from "../src/extract.mjs";
import { integrarVariantes } from "../src/catalogo.mjs";
import { comparar } from "../src/comparar.mjs";
import { RANGO } from "../src/identidad.mjs";

// --- las dos fichas, con sus textos LITERALES medidos en vivo ----------------

const A36_BUY = "https://www.samsung.com/cl/smartphones/galaxy-a36/buy/";
const A36_PLANA =
  "https://www.samsung.com/cl/smartphones/galaxy-a/galaxy-a36-5g-awesome-lavender-256gb-sm-a366elvgltl/";

// El Buying Tool de la /buy/ hubble CUANDO SE PINTA ENTERO. Publica el monto de
// cada opcion que ofrece, no solo el de este SKU: 369.990 (el elegido por
// omision), 429.990 (la otra capacidad) y los accesorios.
const A36_TOOL_PINTADO =
  "Buying Tool Dispositivo Dispositivo Justo el que necesitas Galaxy A36 Desde $ 30.832 al mes o $ 369.990 " +
  "Almacenamiento Selecciona tu almacenamiento 128GB｜6GB $ 35.832 al mes o $ 429.990 256GB｜8GB $ 30.832 al mes o $ 369.990 " +
  "Color Verde lima increíble Violeta increíble Accesorios Desde $ 4.165 al mes o $ 49.990";
// y CUANDO QUEDA CORTADO, que es como lo encontro la medicion del encargo
const A36_TOOL_CORTADO = "Buying Tool Dispositivo Dispositivo Justo el que necesitas Galaxy A36 Desde";

// El body de la /buy/ trae los DOS numeros escritos, y el 539.990 SIN la
// etiqueta "Precio original" que lo delataria: por eso la carrera podia
// entregarlo. La ficha de resumen de abajo es la que lo escribe.
const A36_BODY_LOS_DOS =
  "Galaxy A36 5G\n" + A36_TOOL_PINTADO + "\nGalaxy A36 SM-A366ELVGLTL 256GB｜8GB Violeta increíble $369.990 $539.990 Ahorra $170.000";
// el mismo body cuando el tool no alcanzo a pintarse: solo queda la ficha de
// resumen, que escribe primero el 539.990
const A36_BODY_SOLO_EL_TACHADO =
  "Galaxy A36 5G\n" + A36_TOOL_CORTADO + "\nGalaxy A36 SM-A366ELVGLTL 256GB｜8GB Violeta increíble $539.990";

// La ficha PLANA del A36: su bloque es la barra de precio de verdad y publica UN
// solo monto, el que se cobra, con el tachado marcado con todas sus letras.
const A36_BARRA =
  "Desde $ 30.833 en 12 cuotas sin intereses* o $369.990 Precio original: $539.990 Ahorra $ 170.000 *Aplican condiciones Comprar";

const MONITOR_BODY =
  "32\" Odyssey G3 G30D FHD 180Hz Monitor Gamer Plano\nDónde comprar\n" +
  "Productos relacionados 27\" Odyssey G4 G40H FHD 300Hz Monitor Gamer $279.990 32\" Odyssey G5 $349.990";

// LOS DOS ELEMENTOS DE LOS QUE PUEDE SALIR EL BLOQUE, con el nombre que tienen
// en vivo. La diferencia no es cosmetica: de ella depende si un monto solitario
// manda o tiene que señalar a un candidato de digitalData.
//  - la /buy/ del A36 es plantilla hubble y ahi gana `[class*='pd-buy']`: el
//    Buying Tool ENTERO, que publica el monto de cada variante y de cada
//    accesorio (medido en vivo el 2026-09-13).
//  - la ficha plana del A36 y la del monitor tienen `pd-buying-price`, la barra
//    de precio de ESE producto.
const BARRA_DE_PRECIO = "[class*='pd-buying-price']";
const BUYING_TOOL = "[class*='pd-buy']";

/**
 * Doble de pagina con las tres lecturas del DOM separadas (digitalData, body y
 * bloque), que es como ocurren en produccion.
 */
function pagina({ sku, modelPrice, listPrice, body, bloque, ctas = ["Comprar"], buyingTool = false }) {
  let evaluaciones = 0;
  return {
    url: () => null,
    async waitForFunction() {},
    async evaluate() {
      evaluaciones += 1;
      if (evaluaciones === 1) return { model_price: modelPrice, list_price: listPrice, model_code: sku, displayName: "Producto" };
      if (evaluaciones === 2) return body;
      if (evaluaciones === 3)
        return bloque === null
          ? null
          : { texto: bloque, ctas, ctasBarra: [], selector: buyingTool ? BUYING_TOOL : BARRA_DE_PRECIO };
      return {};
    },
  };
}

const entrada = (url, categoria = "Smartphones") => ({ url, categoria, subcategoria: null, variante: null });

const registro = (extra) => ({
  nombre: "Producto",
  moneda: "CLP",
  categoria: "Smartphones",
  presencia: "activo",
  ausencias: 0,
  notificadoDesaparecido: false,
  estadoStock: "disponible",
  disponible: true,
  versionStock: 2,
  ...extra,
});

const corrida = (previo, observado, timestamp = "T") =>
  comparar({ previo, observado, paginasFallidas: new Set(), corridaConfiable: true, timestamp });

// === 1. LA PRUEBA QUE MAS IMPORTA ===========================================
//
// Varias corridas seguidas de la MISMA pagina alternando cual de los dos montos
// aparece en el body, exigiendo CERO avisos. Y su contraparte: una baja REAL de
// esa misma pagina se sigue avisando.

test("A36: 6 corridas alternando si el Buying Tool se pinta -> CERO avisos", async () => {
  // Es el vaiven real, tal como quedo en data/history.jsonl:
  //   09-12 16:16 sube 369.990 -> 539.990 · 21:06 baja · 23:39 sube
  // El catalogo arranca ya corregido (369.990) y con versionPrecio sellado, asi
  // que ninguna amnistia puede tapar un aviso: si sale uno, es un aviso falso.
  let catalogo = {
    "SM-A366ELVGLTL": registro({
      modelo: "SM-A366ELVGLTL",
      precio: 369990,
      url: A36_BUY,
      paginaOrigen: A36_BUY,
      rango: RANGO.PROPIA,
      versionPrecio: VERSION_PRECIO,
    }),
  };
  const avisos = [];
  for (const pintado of [true, false, true, false, false, true]) {
    const r = await extractSingleProduct(
      pagina({
        sku: "SM-A366ELVGLTL",
        modelPrice: "369990",
        listPrice: "539990",
        body: pintado ? A36_BODY_LOS_DOS : A36_BODY_SOLO_EL_TACHADO,
        bloque: pintado ? A36_TOOL_PINTADO : A36_TOOL_CORTADO,
        ctas: ["Dispositivo", "Almacenamiento", "Color"],
      buyingTool: true,
      }),
      A36_BUY,
    );
    const observado = {};
    integrarVariantes(observado, entrada(A36_BUY), [r], { via: "individual", timestamp: "T" });
    const paso = corrida(catalogo, observado);
    catalogo = paso.catalogo;
    avisos.push(...paso.cambios);
  }
  assert.deepEqual(avisos, [], "seis lecturas de la misma pagina no pueden producir un solo aviso");
  assert.equal(catalogo["SM-A366ELVGLTL"].precio, 369990, "y el precio bueno queda intacto");
});

test("A36: una baja de VERDAD en esa misma pagina se sigue avisando, en la primera corrida", async () => {
  // La contraparte obligatoria. Samsung baja el A36 de 369.990 a 329.990: el
  // Buying Tool publica el numero nuevo y el aviso tiene que salir al tiro, sin
  // esperar corroboracion. Sin esto, "cero avisos" solo probaria que el canal
  // esta muerto.
  const previo = {
    "SM-A366ELVGLTL": registro({
      modelo: "SM-A366ELVGLTL",
      precio: 369990,
      url: A36_BUY,
      paginaOrigen: A36_BUY,
      rango: RANGO.PROPIA,
      versionPrecio: VERSION_PRECIO,
    }),
  };
  const r = await extractSingleProduct(
    pagina({
      sku: "SM-A366ELVGLTL",
      modelPrice: "329990",
      listPrice: "539990",
      body: "Galaxy A36 5G\nBuying Tool Galaxy A36 Desde $ 27.499 al mes o $ 329.990\n$539.990",
      bloque: "Buying Tool Dispositivo Galaxy A36 Desde $ 27.499 al mes o $ 329.990 128GB｜6GB $ 35.832 al mes o $ 429.990",
      ctas: ["Dispositivo"],
      buyingTool: true,
    }),
    A36_BUY,
  );
  const observado = {};
  integrarVariantes(observado, entrada(A36_BUY), [r], { via: "individual", timestamp: "T" });
  const paso = corrida(previo, observado);
  assert.equal(paso.cambios.length, 1, "la baja real tiene que salir");
  assert.equal(paso.cambios[0].tipo, "baja");
  assert.equal(paso.cambios[0].precioAnterior, 369990);
  assert.equal(paso.cambios[0].precio, 329990);
});

test("monitor: 6 corridas con el carrusel escribiendo el 279.990 -> CERO avisos", async () => {
  let catalogo = {
    LS32DG300ELXZS: registro({
      modelo: "LS32DG300ELXZS",
      precio: 199990,
      categoria: "Monitores",
      estadoStock: "no-a-la-venta",
      disponible: false,
      url: "https://x/odyssey",
      paginaOrigen: "https://x/odyssey",
      rango: RANGO.PROPIA,
      versionPrecio: VERSION_PRECIO,
    }),
  };
  const avisos = [];
  // el bloque siempre dice lo mismo (es una propiedad estable de la ficha); lo
  // que alterna es si el carrusel de alternativas alcanzo a escribir su monto
  for (const conCarrusel of [true, false, true, false, true, false]) {
    const r = await extractSingleProduct(
      pagina({
        sku: "LS32DG300ELXZS",
        modelPrice: "199990",
        listPrice: "279990",
        body: conCarrusel ? MONITOR_BODY : "32\" Odyssey G3 G30D FHD 180Hz Monitor Gamer Plano\nDónde comprar",
        bloque: "Dónde comprar",
        ctas: ["Dónde comprar"],
      }),
      "https://x/odyssey",
    );
    const observado = {};
    integrarVariantes(observado, entrada("https://x/odyssey", "Monitores"), [r], { via: "individual", timestamp: "T" });
    const paso = corrida(catalogo, observado);
    catalogo = paso.catalogo;
    avisos.push(...paso.cambios);
  }
  assert.deepEqual(avisos, [], "el precio del monitor de al lado no puede mover el de este");
  assert.equal(catalogo.LS32DG300ELXZS.precio, 199990);
});

test("monitor: una baja de VERDAD en su ficha se sigue avisando", async () => {
  const previo = {
    LS32DG300ELXZS: registro({
      modelo: "LS32DG300ELXZS",
      precio: 199990,
      categoria: "Monitores",
      estadoStock: "no-a-la-venta",
      disponible: false,
      url: "https://x/odyssey",
      paginaOrigen: "https://x/odyssey",
      rango: RANGO.PROPIA,
      versionPrecio: VERSION_PRECIO,
    }),
  };
  const r = await extractSingleProduct(
    pagina({
      sku: "LS32DG300ELXZS",
      modelPrice: "169990",
      listPrice: "279990",
      body: MONITOR_BODY,
      bloque: "Dónde comprar",
      ctas: ["Dónde comprar"],
    }),
    "https://x/odyssey",
  );
  const observado = {};
  integrarVariantes(observado, entrada("https://x/odyssey", "Monitores"), [r], { via: "individual", timestamp: "T" });
  const paso = corrida(previo, observado);
  assert.equal(paso.cambios.length, 1);
  assert.equal(paso.cambios[0].tipo, "baja");
  assert.equal(paso.cambios[0].precio, 169990);
});

// === 2. la pieza 1: el body deja de arbitrar ================================

test("con el bloque mudo y DOS candidatos, el texto de la pagina ya no decide", () => {
  // el corazon del arreglo, en una linea: el MISMO estado del bloque y dos
  // bodies distintos tienen que dar la MISMA respuesta.
  const conUno = precioAdoptable({
    precioBloque: null,
    precioFinal: 369990,
    modelPrice: 369990,
    listPrice: 539990,
    bloqueLegible: true,
    paginaNoLoVendeOnline: false,
    bodyText: A36_BODY_LOS_DOS,
  });
  const conElOtro = precioAdoptable({
    precioBloque: null,
    precioFinal: 539990,
    modelPrice: 369990,
    listPrice: 539990,
    bloqueLegible: true,
    paginaNoLoVendeOnline: false,
    bodyText: A36_BODY_SOLO_EL_TACHADO,
  });
  assert.equal(conUno, conElOtro, "la respuesta no puede depender de que alcanzo a pintarse");
  assert.equal(conUno, null, "y la respuesta honesta es que no se sabe");
});

test("la regla mira que los DOS candidatos sean DISTINTOS, no cual es mayor", () => {
  // fija los dos lados del limite: los mutantes que cambian `!==` por `<` o por
  // `>` mueren aca, porque con uno de los dos ordenes dejarian de ver la carrera
  // y volverian a devolver lo que diga el body.
  const conPar = (modelPrice, listPrice, bodyText) =>
    precioAdoptable({
      precioBloque: null,
      // `precioFinal` es lo que devolveria precioVisiblePreferido mirando el
      // body: el monto que este escrito
      precioFinal: modelPrice,
      modelPrice,
      listPrice,
      bloqueLegible: true,
      paginaNoLoVendeOnline: false,
      bodyText,
    });
  assert.equal(conPar(369990, 539990, A36_BODY_LOS_DOS), null);
  assert.equal(conPar(539990, 369990, A36_BODY_LOS_DOS), null, "el par dado vuelta es la misma carrera");
});

test("un bloque que se leyo pero no declara nada NO destraba el precio", () => {
  // la contracara medida el 2026-09-12 (E9/E9b/E9c): un bloque con texto que
  // todavia no escribio su monto es indistinguible de uno que no lo va a
  // escribir nunca. Solo destraba el vocabulario cerrado de "no lo vendo online".
  for (const ctaBloque of ["Comprar", "Cargando...", "Agregar al carro"]) {
    assert.equal(
      precioAdoptable({
        precioBloque: null,
        precioFinal: 199990,
        modelPrice: 199990,
        listPrice: 279990,
        bloqueLegible: true,
        paginaNoLoVendeOnline: false,
        bodyText: `algo $199.990 ${ctaBloque}`,
      }),
      null,
      ctaBloque,
    );
  }
  // y con la pagina declarandolo, si
  assert.equal(
    precioAdoptable({
      precioBloque: null,
      precioFinal: 279990,
      modelPrice: 199990,
      listPrice: 279990,
      bloqueLegible: true,
      paginaNoLoVendeOnline: true,
      bodyText: MONITOR_BODY,
    }),
    199990,
  );
});

test("un bloque que NO se pudo leer no adopta nada, aunque le digan que no se vende", () => {
  // EL ORDEN DE LAS GUARDAS ES PARTE DEL CONTRATO. "No pude leer el bloque" tiene
  // que ganarle a cualquier concesion: si no se leyo, no se sabe que declara la
  // pagina. Hoy las dos cosas no pueden pasar juntas (con el bloque ilegible,
  // estadoDesdeBloqueCompra devuelve "desconocido" y paginaNoLoVendeOnline queda
  // en false), pero eso es un acoplamiento entre dos modulos, y el proyecto ya
  // pago caro una decision de callarse que "duraba una linea". Esta prueba lo
  // fija aca, donde se decide.
  assert.equal(
    precioAdoptable({
      precioBloque: null,
      precioFinal: 279990,
      modelPrice: 199990,
      listPrice: 279990,
      bloqueLegible: false,
      paginaNoLoVendeOnline: true,
      bodyText: MONITOR_BODY,
    }),
    null,
  );
});

test("con UN solo candidato, un monto marcado 'Precio original' tampoco se adopta", () => {
  // La ficha con oferta cuyo digitalData publica el TACHADO en los dos campos
  // (medida el 2026-09-13: The Frame 43", model === list === 839.990 mientras el
  // bloque cobra 599.990). Aca hay un solo candidato, asi que la regla nueva no
  // interviene y el que responde es el ultimo filtro de precioAdoptable. Sin el,
  // una lectura en que el bloque no alcanzo a publicar su monto adoptaria el
  // precio de ANTES y mandaria una "suba" que no existe.
  assert.equal(
    precioAdoptable({
      precioBloque: null,
      // el monto ESTA escrito en la pagina, asi que precioVisiblePreferido lo
      // elige: es justo el caso que el ultimo filtro tiene que atajar
      precioFinal: 839990,
      modelPrice: 839990,
      listPrice: 839990,
      bloqueLegible: true,
      paginaNoLoVendeOnline: false,
      bodyText: "The Frame 43''\nPrecio original: $839.990\nComprar",
    }),
    null,
  );
});

// === 3. la pieza 2: un bloque con VARIOS montos es un selector ==============

test("el Buying Tool publica el monto de cada variante: gana el que es de ESTE SKU", () => {
  // medido en vivo: galaxy-a36/buy/ deja 8 montos en el bloque y el primero es el
  // de la opcion que el selector trae elegida por omision. Tomar "el primero"
  // era otra moneda al aire, esta vez a merced de Samsung y no del render.
  assert.equal(precioDelBloqueCompra(A36_TOOL_PINTADO, [369990, 539990]), 369990);
  // el mismo bloque, si el selector cambiara de opcion por omision, NO puede
  // mover el precio de este SKU
  const alReves =
    "Buying Tool Galaxy A36 Desde $ 35.832 al mes o $ 429.990 128GB｜6GB $ 35.832 al mes o $ 429.990 256GB｜8GB $ 30.832 al mes o $ 369.990";
  assert.equal(precioDelBloqueCompra(alReves, [369990, 539990]), 369990, "sigue ganando el que digitalData nombra");
});

test("si el selector señala a los DOS candidatos, o a ninguno, no decide", () => {
  const ambos = "Buying Tool o $ 369.990 y tambien o $ 539.990";
  assert.equal(precioDelBloqueCompra(ambos, [369990, 539990]), null);
  const ninguno = "Buying Tool o $ 111.111 o $ 222.222";
  assert.equal(precioDelBloqueCompra(ninguno, [369990, 539990]), null);
});

test("una barra de precio normal publica UN monto y manda, aunque digitalData no lo tenga", () => {
  // es el arreglo del 2026-09-12 y no se puede romper: SM-X400NZRDCHO cobra
  // $494.990 mientras digitalData publica 379.990 y 549.989. Un solo monto en el
  // bloque = es la barra de precio de esta ficha, y vale.
  assert.equal(
    precioDelBloqueCompra(
      "Desde $ 41.249 en 12 cuotas sin intereses* o $494.990 Precio original: $549.989 Ahorra $ 54.999 *Aplican condiciones Comprar ahora",
      [379990, 549989],
    ),
    494990,
  );
  // y la barra del A36, con su tachado marcado
  assert.equal(precioDelBloqueCompra(A36_BARRA, [369990, 539990]), 369990);
});

// === 4. la migracion: los dos SKU se corrigen SIN aviso de precio ===========

test("el A36 pasa de su tachado a su precio real por el canal TECNICO, no como una baja", async () => {
  // Es el estado REAL del catalogo hoy: SM-A366ELVGLTL guardado en 539.990, que
  // es su precio TACHADO, con versionPrecio 3. Sin la migracion, la primera
  // corrida con este arreglo mandaria "bajo un 31%" a dias del Cyber por un
  // producto que nunca bajo.
  const previo = {
    "SM-A366ELVGLTL": registro({
      modelo: "SM-A366ELVGLTL",
      precio: 539990,
      url: A36_BUY,
      paginaOrigen: A36_BUY,
      rango: RANGO.PROPIA,
      versionPrecio: 3,
    }),
  };
  const r = await extractSingleProduct(
    pagina({
      sku: "SM-A366ELVGLTL",
      modelPrice: "369990",
      listPrice: "539990",
      body: A36_BODY_LOS_DOS,
      bloque: A36_TOOL_PINTADO,
      ctas: ["Dispositivo"],
      buyingTool: true,
    }),
    A36_BUY,
  );
  const observado = {};
  integrarVariantes(observado, entrada(A36_BUY), [r], { via: "individual", timestamp: "T" });
  const paso = corrida(previo, observado);
  assert.deepEqual(paso.cambios, [], "ni un aviso de precio al operador");
  assert.equal(paso.correccionesDePrecio.length, 1, "pero la correccion NO es silenciosa: sale por el canal tecnico");
  assert.equal(paso.correccionesDePrecio[0].precioAnterior, 539990);
  assert.equal(paso.correccionesDePrecio[0].precio, 369990);
  assert.equal(paso.catalogo["SM-A366ELVGLTL"].precio, 369990, "y queda guardado el numero bueno");
  assert.equal(paso.catalogo["SM-A366ELVGLTL"].versionPrecio, VERSION_PRECIO, "la ventana se cierra por SKU");
});

test("el monitor tambien, y su tachado es justo el rastro que lo permite", async () => {
  const previo = {
    LS32DG300ELXZS: registro({
      modelo: "LS32DG300ELXZS",
      precio: 279990,
      categoria: "Monitores",
      estadoStock: "no-a-la-venta",
      disponible: false,
      url: "https://x/odyssey",
      paginaOrigen: "https://x/odyssey",
      rango: RANGO.PROPIA,
      versionPrecio: 3,
    }),
  };
  const r = await extractSingleProduct(
    pagina({
      sku: "LS32DG300ELXZS",
      modelPrice: "199990",
      listPrice: "279990",
      body: MONITOR_BODY,
      bloque: "Dónde comprar",
      ctas: ["Dónde comprar"],
    }),
    "https://x/odyssey",
  );
  assert.equal(r.precioTachado, 279990, "el list_price viaja como rastro de la lectura");
  const observado = {};
  integrarVariantes(observado, entrada("https://x/odyssey", "Monitores"), [r], { via: "individual", timestamp: "T" });
  const paso = corrida(previo, observado);
  assert.deepEqual(paso.cambios, []);
  assert.equal(paso.correccionesDePrecio.length, 1);
  assert.equal(paso.catalogo.LS32DG300ELXZS.precio, 199990);
});

test("la amnistia NO se traga una baja de verdad de la misma corrida", () => {
  // el limite de la migracion: solo calla cuando el guardado es EXACTAMENTE uno
  // de los dos numeros que la pagina publica hoy. Si el guardado es otro, es un
  // cambio real y se avisa aunque la version suba.
  const previo = {
    "SM-A366ELVGLTL": registro({
      modelo: "SM-A366ELVGLTL",
      precio: 349990, // un precio real anterior, que no es ni el tachado ni el interno
      url: A36_BUY,
      paginaOrigen: A36_BUY,
      rango: RANGO.PROPIA,
      versionPrecio: 3,
    }),
  };
  const observado = {};
  integrarVariantes(
    observado,
    entrada(A36_BUY),
    [
      {
        modelo: "SM-A366ELVGLTL",
        precio: 329990,
        moneda: "CLP",
        rango: RANGO.PROPIA,
        estadoStock: "disponible",
        disponible: true,
        url: A36_BUY,
        versionPrecio: VERSION_PRECIO,
        precioTachado: 539990,
      },
    ],
    { via: "individual", timestamp: "T" },
  );
  const paso = corrida(previo, observado);
  assert.equal(paso.cambios.length, 1, "349.990 no es el tachado: es una baja de verdad");
  assert.equal(paso.cambios[0].tipo, "baja");
});

// === 5. la ficha plana rescata a la /buy/ que no puede decidir ==============

test("con la /buy/ muda, el precio de la ficha PLANA es el que queda", async () => {
  // Es lo que hace innecesario tocar el rango. La /buy/ hubble cortada ya no
  // entrega un precio, y en la misma corrida la ficha plana del A36 -- que si
  // tiene barra de precio -- publica 369.990. Las dos valen rango PROPIA, asi
  // que conservaPrecio (src/catalogo.mjs) deja pasar el unico precio que se pudo
  // leer, sin importar cual de las dos paginas llegue ultima.
  const observado = {};
  const plana = await extractSingleProduct(
    pagina({
      sku: "SM-A366ELVGLTL",
      modelPrice: "369990",
      listPrice: "539990",
      body: `Galaxy A36 5G\n${A36_BARRA}`,
      bloque: A36_BARRA,
    }),
    A36_PLANA,
  );
  assert.equal(plana.precio, 369990, "la barra de precio de la ficha plana publica el numero bueno");
  integrarVariantes(observado, entrada(A36_PLANA), [plana], { via: "individual", timestamp: "T" });

  const buy = await extractSingleProduct(
    pagina({
      sku: "SM-A366ELVGLTL",
      modelPrice: "369990",
      listPrice: "539990",
      body: A36_BODY_SOLO_EL_TACHADO,
      bloque: A36_TOOL_CORTADO,
      ctas: ["Dispositivo"],
      buyingTool: true,
    }),
    A36_BUY,
  );
  assert.equal("precio" in buy, false, "la /buy/ cortada no entrega precio");
  integrarVariantes(observado, entrada(A36_BUY), [buy], { via: "individual", timestamp: "T" });

  assert.equal(observado["SM-A366ELVGLTL"].precio, 369990, "el precio de la ficha plana sobrevive a la /buy/");
  assert.equal(observado["SM-A366ELVGLTL"].paginaOrigen, A36_BUY, "aunque el registro lo firme la /buy/, que es lo de hoy");
});
