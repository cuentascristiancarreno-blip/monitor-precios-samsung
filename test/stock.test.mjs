// La maquina de estados de stock, contra los TEXTOS REALES medidos en paginas
// de samsung.com/cl el 2026-09-11.
//
// Contexto: hasta ese dia el stock salia de buscar 4 palabras en el texto de
// TODA la pagina, con "disponible" por defecto; 894 de 928 productos activos
// figuraban disponibles. Medido sobre 42 productos (2 por categoria
// notificable), la regla vieja acertaba 26 de 42 y los 16 errores iban TODOS en
// el mismo sentido: decia "disponible" sobre 13 agotados y 5 que ni siquiera
// estaban a la venta.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ESTADO, disponibleDe, estadoDesdeApi, estadoDesdeBloqueCompra, estadoDesdeJsonLd, estadoObservado, textoEstado } from "../src/stock.mjs";

// --- textos literales del bloque de compra, copiados de paginas reales -------

const BLOQUE_DISPONIBLE_COMPRAR =
  "Desde $ 48.333 en 12 cuotas sin intereses* o $579.990 Precio original: $829.990 Ahorra $ 250.000 *Aplican condiciones Comprar";
const BLOQUE_DISPONIBLE_CARRO =
  "Desde $ 19.166 en 12 cuotas sin intereses* o $ 229.990 Precio original: $ 299.989 Ahorra $ 69.999 *Aplican condiciones Agregar al carro";
const BLOQUE_AGOTADO =
  "Desde $ 83.333 en 12 cuotas sin intereses* o $999.990 *Aplican condiciones Avísame";
const BLOQUE_AGOTADO_REFRIGERADOR =
  "Desde $ 108.333 en 12 cuotas sin intereses* o $1.299.991 *Aplican condiciones Avísame";
const BLOQUE_NO_A_LA_VENTA = "no está a la venta";

test("los tres textos medidos dan los tres estados", () => {
  assert.equal(estadoDesdeBloqueCompra(BLOQUE_DISPONIBLE_COMPRAR), ESTADO.DISPONIBLE);
  assert.equal(estadoDesdeBloqueCompra(BLOQUE_AGOTADO), ESTADO.AGOTADO);
  assert.equal(estadoDesdeBloqueCompra(BLOQUE_NO_A_LA_VENTA), ESTADO.NO_A_LA_VENTA);
});

test("'Agregar al carro' tambien es comprable (TV y linea blanca)", () => {
  // medido en el TV F6000 y en The Frame 50": los celulares dicen "Comprar" y
  // los televisores "Agregar al carro". Con solo "Comprar" en la lista, TODA la
  // categoria Televisores habria quedado en "desconocido".
  assert.equal(estadoDesdeBloqueCompra(BLOQUE_DISPONIBLE_CARRO), ESTADO.DISPONIBLE);
});

test("el refrigerador RS5300T, medido sin stock, da agotado", () => {
  assert.equal(estadoDesdeBloqueCompra(BLOQUE_AGOTADO_REFRIGERADOR), ESTADO.AGOTADO);
});

// --- LA TRAMPA DEL TV F6000 -------------------------------------------------

test("la trampa del F6000: 'avisame' en la pagina no es 'avisame' en el bloque de compra", () => {
  // El TV F6000 SI tiene stock, pero su pagina contiene "avisame" dos veces en
  // el carrusel "¿Buscas alternativas?". Por eso NO se puede buscar la palabra
  // en el texto completo: hay que acotarse al bloque de compra.
  const paginaCompleta = [
    "40\" Full HD F6000 Smart TV (2025)",
    BLOQUE_DISPONIBLE_CARRO,
    "¿Buscas alternativas?",
    "Galaxy TV QLED 55\" Avísame",
    "Galaxy TV OLED 65\" Avísame",
  ].join("\n");

  assert.equal(
    estadoDesdeBloqueCompra(paginaCompleta),
    ESTADO.DESCONOCIDO,
    "leer la pagina entera mezcla el carrusel con el boton y no puede decidir",
  );
  assert.equal(
    estadoDesdeBloqueCompra(BLOQUE_DISPONIBLE_CARRO),
    ESTADO.DISPONIBLE,
    "acotado al bloque de compra, el F6000 queda disponible, que es la verdad",
  );
});

test("'hasta agotar stock' es una promesa comercial, no un agotado", () => {
  // texto real del selector de la pagina del Galaxy Tab A9:
  // "Buying Tool Dispositivo Galaxy Tab A9 Desde $ 159.990 ... Hasta agostar Stock"
  // el precio va incluido porque el bloque REAL lo trae: un bloque sin precio no
  // es un bloque de compra (ver la prueba del enlace suelto mas abajo).
  assert.equal(estadoDesdeBloqueCompra("Desde $ 159.990 Promocion valida hasta agotar stock Comprar"), ESTADO.DISPONIBLE);
  assert.equal(estadoDesdeBloqueCompra("Desde $ 159.990 Hasta agostar Stock Agregar al carro"), ESTADO.DISPONIBLE);
});

// --- "desconocido" nunca se inventa un estado -------------------------------

test("sin bloque de compra legible el estado es desconocido, jamas disponible", () => {
  for (const entrada of [null, undefined, "", "   ", "Cargando..."]) {
    assert.equal(estadoDesdeBloqueCompra(entrada), ESTADO.DESCONOCIDO, JSON.stringify(entrada));
  }
});

test("senales contradictorias dan desconocido, no un estado inventado", () => {
  // un selector de color donde una variante no tiene stock puede traer las dos
  // cosas: mejor no cambiar el estado que arriesgar un falso "se agoto"
  assert.equal(estadoDesdeBloqueCompra("Avísame Comprar"), ESTADO.DESCONOCIDO);
});

test("la tilde y las mayusculas no cambian el resultado", () => {
  for (const t of ["Avísame", "avisame", "AVÍSAME", "AVISAME"]) {
    assert.equal(estadoDesdeBloqueCompra(t), ESTADO.AGOTADO, t);
  }
  assert.equal(estadoDesdeBloqueCompra("No Está A La Venta"), ESTADO.NO_A_LA_VENTA);
});

// --- las otras dos fuentes, consistentes con la misma maquina ----------------

test("la API por SKU mapea a los mismos estados", () => {
  // forma real medida: { stock: { stockLevelStatus: "inStock", stockLevel: 24 } }
  assert.equal(estadoDesdeApi({ stock: { stockLevelStatus: "inStock", stockLevel: 24 } }), ESTADO.DISPONIBLE);
  assert.equal(estadoDesdeApi({ stock: { stockLevelStatus: "outOfStock", stockLevel: 0 } }), ESTADO.AGOTADO);
  assert.equal(estadoDesdeApi({ stock: { stockLevelStatus: "lowStock" } }), ESTADO.DISPONIBLE);
  for (const p of [null, undefined, {}, { stock: {} }, { stock: { stockLevelStatus: "loQueSea" } }]) {
    assert.equal(estadoDesdeApi(p), ESTADO.DESCONOCIDO, JSON.stringify(p));
  }
});

test("el JSON-LD de las paginas familia mapea a los mismos estados", () => {
  assert.equal(estadoDesdeJsonLd("https://schema.org/InStock"), ESTADO.DISPONIBLE);
  assert.equal(estadoDesdeJsonLd("https://schema.org/LimitedAvailability"), ESTADO.DISPONIBLE);
  assert.equal(estadoDesdeJsonLd("https://schema.org/OutOfStock"), ESTADO.AGOTADO);
  assert.equal(estadoDesdeJsonLd("https://schema.org/SoldOut"), ESTADO.AGOTADO);
  assert.equal(estadoDesdeJsonLd("https://schema.org/Discontinued"), ESTADO.NO_A_LA_VENTA);
  // PreOrder no es ni una cosa ni la otra: no se adivina
  assert.equal(estadoDesdeJsonLd("https://schema.org/PreOrder"), ESTADO.DESCONOCIDO);
  assert.equal(estadoDesdeJsonLd(null), ESTADO.DESCONOCIDO);
});

// --- puentes con el resto del sistema ---------------------------------------

test("disponibleDe traduce a los tres valores del booleano historico", () => {
  assert.equal(disponibleDe(ESTADO.DISPONIBLE), true);
  assert.equal(disponibleDe(ESTADO.AGOTADO), false);
  assert.equal(disponibleDe(ESTADO.NO_A_LA_VENTA), false, "no a la venta tampoco se puede comprar");
  assert.equal(disponibleDe(ESTADO.DESCONOCIDO), null, "desconocido NO es false: es 'no se sabe'");
});

test("estadoObservado lee el campo nuevo y el booleano viejo, y nunca inventa", () => {
  assert.equal(estadoObservado({ estadoStock: ESTADO.AGOTADO }), ESTADO.AGOTADO);
  assert.equal(estadoObservado({ estadoStock: ESTADO.NO_A_LA_VENTA }), ESTADO.NO_A_LA_VENTA);
  // registros del esquema viejo (solo booleano)
  assert.equal(estadoObservado({ disponible: true }), ESTADO.DISPONIBLE);
  assert.equal(estadoObservado({ disponible: false }), ESTADO.AGOTADO);
  // "desconocido" y la ausencia de dato se traducen a null = no cambies nada
  assert.equal(estadoObservado({ estadoStock: ESTADO.DESCONOCIDO }), null);
  assert.equal(estadoObservado({ estadoStock: "basura" }), null);
  assert.equal(estadoObservado({ disponible: null }), null);
  assert.equal(estadoObservado({}), null);
  assert.equal(estadoObservado(null), null);
});

test("el estado nuevo le gana al booleano viejo cuando vienen los dos", () => {
  // extract.mjs emite los dos campos; el booleano es el respaldo, no la fuente
  assert.equal(estadoObservado({ estadoStock: ESTADO.NO_A_LA_VENTA, disponible: false }), ESTADO.NO_A_LA_VENTA);
});

test("los textos para el operador distinguen agotado de no a la venta", () => {
  assert.equal(textoEstado(ESTADO.DISPONIBLE), "disponible");
  assert.equal(textoEstado(ESTADO.AGOTADO), "agotado");
  assert.equal(textoEstado(ESTADO.NO_A_LA_VENTA), "no está a la venta");
  assert.equal(textoEstado(ESTADO.DESCONOCIDO), "desconocido");
});

// --- "Dónde comprar" no es un boton de compra -------------------------------

test("'Dónde comprar' es el buscador de tiendas: no a la venta, no 'agotado'", () => {
  // Medido el 2026-09-11 en el Flip Pro WM85B (Signage, $3.272.500), en el hub
  // SmartThings ET-WV521BWEGCH y en el soporte de pared WMN-M13EA/ZS: su bloque
  // de compra dice exactamente eso y nada mas. Samsung no los vende online. La
  // palabra "comprar" que lleva dentro los daba por disponibles, que es justo el
  // falso positivo a eliminar.
  //
  // POR QUE "no-a-la-venta" Y NO "desconocido" (corregido, defecto 3 de la
  // revision): con "desconocido", extractSingleProduct se caia enseguida a la
  // API por SKU, que para estos productos responde outOfStock, y el catalogo
  // terminaba diciendo "agotado" -- o sea que la decision de callarse duraba una
  // linea. Peor: si algun dia la API dijera inStock saldria un "volvió el stock"
  // de un producto que Samsung nunca vendio online. "No está a la venta" es
  // literalmente lo que ve el cliente, es un estado comprometido y corta el
  // fallback a la API.
  assert.equal(estadoDesdeBloqueCompra("Dónde comprar"), ESTADO.NO_A_LA_VENTA);
  assert.equal(estadoDesdeBloqueCompra("¿Dónde comprar?"), ESTADO.NO_A_LA_VENTA);
  assert.equal(estadoDesdeBloqueCompra("Where to buy"), ESTADO.NO_A_LA_VENTA);
  // y por el camino fuerte, el del boton
  assert.equal(estadoDesdeBloqueCompra("", ["Dónde comprar"]), ESTADO.NO_A_LA_VENTA);
});

test("pero un boton de compra real no se pierde por estar al lado del buscador", () => {
  assert.equal(estadoDesdeBloqueCompra("$ 100.000 Comprar ahora Dónde comprar"), ESTADO.DISPONIBLE);
});

test("'Comprar ahora' tambien es comprable (relojes y combos)", () => {
  // medido en el Galaxy Watch Ultra y en los combos celular+tablet
  assert.equal(
    estadoDesdeBloqueCompra("Desde $ 41.666 en 12 cuotas sin intereses* o $499.990 *Aplican condiciones Comprar ahora"),
    ESTADO.DISPONIBLE,
  );
});

// --- LA TRAMPA DEL BUYING TOOL (defecto 1 de la revision del 2026-09-11) -----
//
// En las paginas /buy/ con plantilla "hubble" el primer [class*='buying'] del
// documento NO es la barra de precio: es el Buying Tool entero, con el pie
// promocional de Samsung adentro. Texto LITERAL medido en vivo el 2026-09-11 en
// https://www.samsung.com/cl/smartphones/galaxy-z-flip7/buy/ -- producto que la
// API daba outOfStock en las 17 cargas medidas y que no expone ningun boton de
// compra. Buscar la palabra "comprar" ahi devolvia DISPONIBLE, y de forma
// intermitente segun si el pie alcanzaba a renderizarse (~1,2-1,7 s), asi que el
// mismo SKU alternaba entre disponible y agotado de una corrida a otra: 3 avisos
// falsos de stock por cada 10 corridas.

const PIE_PROMOCIONAL_FLIP7 = [
  "Buying Tool",
  "Dispositivo",
  "Selecciona tu dispositivo",
  "Galaxy Z Flip7",
  "Desde $ 48.749 al mes o",
  "$ 1.169.990",
  "Color",
  "Azul Intenso",
  "Menta",
  "Negro Intenso",
  "Regalos y promociones",
  "Obtén 6 meses de regalo de Google AI Pro",
  "¡Al comprar tu Galaxy Z Flip7!",
  "Ventajes Samsung.com",
  "Samsung Rewards",
  "Acumula puntos al comprar tus productos favoritos y luego paga con puntos en futuras compras.",
  "Conoce más",
].join("\n");

test("el pie promocional del Buying Tool NO es un boton de compra", () => {
  assert.equal(
    estadoDesdeBloqueCompra(PIE_PROMOCIONAL_FLIP7),
    ESTADO.DESCONOCIDO,
    "no hay ningun CTA: lo correcto es callarse y dejar decidir a la API por SKU",
  );
  // tambien colapsado en una sola linea, que es como llega si la pagina no trae
  // saltos de linea en ese contenedor
  assert.equal(estadoDesdeBloqueCompra(PIE_PROMOCIONAL_FLIP7.replace(/\n/g, " ")), ESTADO.DESCONOCIDO);
});

test("cada frase promocional medida, por separado, tampoco vale como compra", () => {
  for (const frase of [
    "¡Al comprar tu Galaxy Z Flip7!",
    "Acumula puntos al comprar tus productos favoritos y luego paga con puntos",
    "Obtén un reembolso por tu equipo usado al comprar uno nuevo",
    "Q. ¿Cuáles son los beneficios de comprar mi dispositivo Galaxy?",
  ]) {
    assert.equal(estadoDesdeBloqueCompra(frase), ESTADO.DESCONOCIDO, frase);
  }
});

test("el veredicto es el mismo con o sin el pie: no puede depender de si alcanzo a renderizar", () => {
  // esta es la parte que hacia el detector NO determinista
  const sinPie = PIE_PROMOCIONAL_FLIP7.slice(0, PIE_PROMOCIONAL_FLIP7.indexOf("Regalos y promociones"));
  assert.equal(estadoDesdeBloqueCompra(sinPie), estadoDesdeBloqueCompra(PIE_PROMOCIONAL_FLIP7));
});

// --- los BOTONES le ganan al texto ------------------------------------------

test("los botones del bloque mandan sobre cualquier texto que los rodee", () => {
  // el texto dice "al comprar" (prosa) y el boton dice la verdad
  assert.equal(estadoDesdeBloqueCompra(PIE_PROMOCIONAL_FLIP7, ["Avísame"]), ESTADO.AGOTADO);
  assert.equal(estadoDesdeBloqueCompra(PIE_PROMOCIONAL_FLIP7, ["Comprar"]), ESTADO.DISPONIBLE);
  // medido en el F6000: el bloque trae los dos botones y el que manda es el real
  assert.equal(estadoDesdeBloqueCompra("", ["Agregar al carro", "Dónde comprar"]), ESTADO.DISPONIBLE);
  assert.equal(estadoDesdeBloqueCompra("", ["Agregar al carrito"]), ESTADO.DISPONIBLE);
  assert.equal(estadoDesdeBloqueCompra("", ["Comprar ahora"]), ESTADO.DISPONIBLE);
});

test("un boton que no es de compra no decide nada", () => {
  // "Conoce más", "Más información" y "Ver más" viven dentro del Buying Tool
  assert.equal(estadoDesdeBloqueCompra(PIE_PROMOCIONAL_FLIP7, ["Conoce más", "Más información", "Ver más"]), ESTADO.DESCONOCIDO);
});

test("botones contradictorios dan desconocido, igual que el texto", () => {
  assert.equal(estadoDesdeBloqueCompra("", ["Avísame", "Comprar"]), ESTADO.DESCONOCIDO);
});

// --- el enlace suelto a /buy/ no es un boton de compra (medido 2026-09-12) ----

// Texto LITERAL del bloque de compra de la ficha plana del Galaxy Book4
// NP750XGJ-KS4CL: el bloque entero es eso, sin precio ni cuotas. Su pagina
// /buy/, cargada el mismo dia, dice "Avísame": el producto NO se puede comprar.
const BLOQUE_SOLO_ENLACE = "Comprar ahora";

test("un bloque sin precio no declara stock: es un enlace a /buy/, no un boton", () => {
  // por texto y por boton, que son las dos capas que podian darlo por disponible
  assert.equal(estadoDesdeBloqueCompra(BLOQUE_SOLO_ENLACE), ESTADO.DESCONOCIDO);
  assert.equal(estadoDesdeBloqueCompra(BLOQUE_SOLO_ENLACE, ["Comprar ahora"]), ESTADO.DESCONOCIDO);
  assert.equal(estadoDesdeBloqueCompra("Comprar", ["Comprar"]), ESTADO.DESCONOCIDO);
});

test("los 5 bloques CON precio de la misma medicion siguen dando disponible", () => {
  // textos literales de las fichas planas cuyo /buy/ confirmo "Agregar al carro"
  const conPrecio = [
    "Desde $ 33.333 en 12 cuotas sin intereses* o $399.990 *Aplican condiciones Comprar ahora",
    "Desde $ 23.333 en 12 cuotas sin intereses* o $279.990 Precio original: $369.990 Ahorra $ 90.000 *Aplican condiciones Comprar ahora",
    "$379.990 Precio original: $499.990 Ahorra $ 120.000 *Aplican condiciones Comprar ahora",
    "$494.990 Precio original: $549.989 Ahorra $ 54.999 *Aplican condiciones Comprar ahora",
    "$1.999.990 Precio original: $2.599.991 Ahorra $ 600.001 *Aplican condiciones Comprar",
  ];
  for (const t of conPrecio) {
    assert.equal(estadoDesdeBloqueCompra(t), ESTADO.DISPONIBLE, t);
    assert.equal(estadoDesdeBloqueCompra(t, ["Comprar ahora"]), ESTADO.DISPONIBLE, t);
  }
});

test("sin precio se puede seguir AFIRMANDO que no hay stock", () => {
  // la exigencia de precio es solo para decir "disponible": "Avísame" y "no está
  // a la venta" son decisivos con o sin precio, y ese es el lado seguro
  assert.equal(estadoDesdeBloqueCompra("Avísame", ["Avísame"]), ESTADO.AGOTADO);
  assert.equal(estadoDesdeBloqueCompra("Este producto no está a la venta"), ESTADO.NO_A_LA_VENTA);
  assert.equal(estadoDesdeBloqueCompra("Dónde comprar", ["Dónde comprar"]), ESTADO.NO_A_LA_VENTA);
});

test("la barra de precio se consulta sin texto y por eso no se le exige precio", () => {
  // extract.mjs la llama como estadoDesdeBloqueCompra(null, ctasBarra): si la
  // exigencia se aplicara ahi, la barra dejaria de servir para nada
  assert.equal(estadoDesdeBloqueCompra(null, ["Comprar"]), ESTADO.DISPONIBLE);
  assert.equal(estadoDesdeBloqueCompra("", ["Agregar al carro"]), ESTADO.DISPONIBLE);
});
