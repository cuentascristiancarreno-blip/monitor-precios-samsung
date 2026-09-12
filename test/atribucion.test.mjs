// ¿DE QUIEN ES ESTE PRODUCTO? Pruebas de la regla de propiedad y precedencia,
// armadas con los casos REALES medidos el 2026-09-11 cargando las paginas.
//
// El sintoma: la pagina del Galaxy S25 FE 512GB producia en el catalogo 4 SKU
// que no son S25 FE sino S25 normal, todos a $1.069.990.
// La causa: REDIRECCIONES. Samsung manda la ficha que deja de vender a la de un
// hermano, y el monitor anotaba el producto del hermano como si fuera de la URL
// que habia pedido. Verificado:
//   ls03f-55-inch-...-qn55ls03fagxzs/        -> ls03f-50-inch-...-qn50ls03fagxzs/
//   rs5300t-...-natural-gray-rs60t5200s9-zs/ -> rs5300t-...-ebony-black-rs60t5200b1-zs/
//   galaxy-s25-fe-navy-512gb-sm-s731bdbpltl/buy/ -> galaxy-s25/buy/?modelCode=SM-S731BDBPLTL
import { test } from "node:test";
import assert from "node:assert/strict";
import { RANGO, mismaPagina, repartirPorPropiedad, rutaDe, slugNombraSku } from "../src/identidad.mjs";
import { clasificarVariantesFamilia, extractSingleProduct, productosDesdeApi } from "../src/extract.mjs";
import { integrarVariantes } from "../src/catalogo.mjs";
import { comparar } from "../src/comparar.mjs";
import { ESTADO, VERSION_STOCK } from "../src/stock.mjs";

const TS = "2026-09-11T12:00:00.000Z";

// URLs reales
const U_FE512 = "https://www.samsung.com/cl/smartphones/galaxy-s/galaxy-s25-fe-navy-512gb-sm-s731bdbpltl/buy/";
const U_FE512_FINAL = "https://www.samsung.com/cl/smartphones/galaxy-s25/buy/?modelCode=SM-S731BDBPLTL";
const U_FE256 = "https://www.samsung.com/cl/smartphones/galaxy-s/galaxy-s25-fe-navy-256gb-sm-s731bdbkltl/";
const U_FRAME55 = "https://www.samsung.com/cl/lifestyle-tvs/the-frame/ls03f-55-inch-art-store-black-qn55ls03fagxzs/";
const U_FRAME50 = "https://www.samsung.com/cl/lifestyle-tvs/the-frame/ls03f-50-inch-art-store-black-qn50ls03fagxzs/";
const U_NEVERA_VIEJA = "https://www.samsung.com/cl/refrigerators/side-by-side/rs5300t-large-capacity-22-cu-ft-ebony-black-rs60t5200b1-zs/";
const U_NEVERA_NUEVA = "https://www.samsung.com/cl/refrigerators/side-by-side/rs5300t-large-capacity-628l-ebony-black-rs60t5200b1-zs/";
const U_TABS9FE = "https://www.samsung.com/cl/tablets/galaxy-tab-s9-fe/buy/";

// ---------------------------------------------------------------------------
// 1. la regla pura
// ---------------------------------------------------------------------------

test("rutaDe ignora la query, el ancla y la barra final", () => {
  assert.equal(rutaDe(U_FE512_FINAL), "www.samsung.com/cl/smartphones/galaxy-s25/buy");
  assert.equal(rutaDe("https://www.samsung.com/cl/x/"), rutaDe("https://www.samsung.com/cl/x"));
  assert.equal(rutaDe("https://www.samsung.com/cl/x/?a=1#b"), rutaDe("https://www.samsung.com/cl/x/"));
  assert.equal(rutaDe(null), null);
});

test("sin informacion de la URL final no se asume redireccion", () => {
  // regla de oro: este modulo jamas descarta un producto por falta de datos
  assert.equal(mismaPagina(U_FE512, null), true);
  assert.equal(mismaPagina(null, U_FE512), true);
  assert.equal(mismaPagina(U_FE512, U_FE512), true);
  assert.equal(mismaPagina(U_FE512, U_FE512_FINAL), false);
});

test("slugNombraSku tolera los separadores del slug", () => {
  assert.equal(slugNombraSku(U_FE512, "SM-S731BDBPLTL"), true);
  assert.equal(slugNombraSku(U_FE512, "SM-S931BDBKLTL"), false);
  // el SKU del refrigerador lleva barra y el slug guion: "RS60T5200B1/ZS"
  assert.equal(slugNombraSku(U_NEVERA_VIEJA, "RS60T5200B1/ZS"), true);
  assert.equal(slugNombraSku(U_NEVERA_VIEJA, "RS60T5200S9/ZS"), false);
  // codigos demasiado cortos no pueden calzar por accidente
  assert.equal(slugNombraSku(U_FE512, "S25"), false);
});

test("caso S25 FE 512GB: la pagina redirigida no es suya, ni siquiera la parte que la URL nombra", () => {
  // ESTA PRUEBA FIJABA LO CONTRARIO HASTA EL 2026-09-12 Y LA PRODUCCION LA
  // DESMINTIO. Esperaba propios=["SM-S731BDBPLTL"] porque la URL PEDIDA nombra a
  // ese SKU. Pero la pagina a la que se aterriza (.../galaxy-s25/buy/) es el
  // selector de compra del S25, y adoptarla como "su" ficha metio su precio por
  // defecto -- $1.229.990, que es el del Galaxy S25+ -- en las CINCO versiones
  // del S25 FE del catalogo, incluidas las tres de 256 GB que se venden a
  // $579.990, y mando 4 avisos falsos a Discord (history.jsonl, 2026-09-12
  // 05:19Z: "recuperado" y "sube" de SM-S731BZKJLEL y SM-S731BDBPLTL a
  // $1.229.990). La pagina redirige: no es de esta entrada y punto. El SKU que
  // la URL nombra ya se captura desde su propia ficha.
  // digitalData real: "SM-S936BDBJLTL,SM-S931BDBJLTL,SM-S731BDBPLTL"
  const { propios, ajenos, motivo } = repartirPorPropiedad(U_FE512, U_FE512_FINAL, [
    "SM-S936BDBJLTL",
    "SM-S931BDBJLTL",
    "SM-S731BDBPLTL",
  ]);
  assert.deepEqual(propios, []);
  assert.deepEqual(ajenos, ["SM-S936BDBJLTL", "SM-S931BDBJLTL", "SM-S731BDBPLTL"]);
  assert.match(motivo, /redirigida/);
});

test("el codigo en la QUERY de la URL final no rescata a una pagina redirigida", () => {
  // la redireccion real termina en ".../galaxy-s25/buy/?modelCode=SM-S731BDBPLTL":
  // el SKU viaja en la query. Si la regla mirara la URL final completa en vez de
  // su RUTA, volveria a adoptar el selector como ficha propia.
  const { propios, motivo } = repartirPorPropiedad(
    U_FE512,
    "https://www.samsung.com/cl/smartphones/galaxy-s25/buy/?modelCode=SM-S731BDBPLTL",
    ["SM-S731BDBPLTL"],
  );
  assert.deepEqual(propios, []);
  assert.match(motivo, /redirigida/);
});

test("caso The Frame: una ficha redirigida a la de otro producto no se queda con nada", () => {
  const { propios, ajenos, motivo } = repartirPorPropiedad(U_FRAME55, U_FRAME50, ["QN50LS03FAGXZS"]);
  assert.deepEqual(propios, []);
  assert.deepEqual(ajenos, ["QN50LS03FAGXZS"]);
  assert.match(motivo, /redirigida/);
});

test("caso refrigerador: un slug RENOMBRADO sigue siendo el mismo producto", () => {
  // Samsung cambio "22-cu-ft" por "628l" en la misma ficha. Si la regla mirara
  // solo la redireccion, este producto real se perderia del catalogo.
  const { propios } = repartirPorPropiedad(U_NEVERA_VIEJA, U_NEVERA_NUEVA, ["RS60T5200B1/ZS"]);
  assert.deepEqual(propios, ["RS60T5200B1/ZS"]);
});

test("las paginas de grupo legitimas conservan TODOS sus SKU", () => {
  // verificado en vivo: Tab S9 FE, Tab A9, Book3, Book3 Pro y Z Fold7 NO
  // redirigen y su slug no nombra ningun SKU. Agrupan variantes que pertenecen a
  // la familia y no tienen ficha propia: tienen que seguir en el catalogo.
  const skus = ["SM-X510NLGACHO", "SM-X516BZAACHO", "SM-X610NLGACHO", "SM-X616BZAACHO"];
  const { propios, ajenos } = repartirPorPropiedad(U_TABS9FE, U_TABS9FE, skus);
  assert.deepEqual(propios, skus);
  assert.deepEqual(ajenos, []);
});

// ---------------------------------------------------------------------------
// 2. camino JSON-LD (paginas familia, sin navegador)
// ---------------------------------------------------------------------------

function htmlConOfertas(ofertas) {
  const json = {
    "@context": "https://schema.org",
    "@type": "ProductGroup",
    hasVariant: ofertas.map((o) => ({
      "@type": "Product",
      sku: o.sku,
      name: o.name,
      offers: { "@type": "Offer", url: o.url, price: String(o.price), priceCurrency: "CLP", availability: o.availability },
    })),
  };
  return `<html><head><script type="application/ld+json">${JSON.stringify(json)}</script></head><body></body></html>`;
}

// Lo que publica de verdad el JSON-LD al pedir la pagina del S25 FE 512GB: las
// ofertas son de galaxy-s25/buy/, o sea de la pagina a la que redirigio.
const HTML_FE512 = htmlConOfertas([
  { sku: "SM-S931BDBKLTL", name: "Galaxy S25 256GB｜12GB Azul Marino", url: "https://www.samsung.com/cl/smartphones/galaxy-s25/buy/?SM-S931BDBKLTL", price: 1069990, availability: "https://schema.org/InStock" },
  { sku: "SM-S931BLBKLTL", name: "Galaxy S25 256GB｜12GB Azul", url: "https://www.samsung.com/cl/smartphones/galaxy-s25/buy/?SM-S931BLBKLTL", price: 1069990, availability: "https://schema.org/InStock" },
  { sku: "SM-S931BZKKLTL", name: "Galaxy S25 256GB｜12GB Negro Azulado", url: "https://www.samsung.com/cl/smartphones/galaxy-s25/buy/?SM-S931BZKKLTL", price: 1069990, availability: "https://schema.org/InStock" },
  { sku: "SM-S931BZDKLTL", name: "Galaxy S25 256GB｜12GB Oro Rosa", url: "https://www.samsung.com/cl/smartphones/galaxy-s25/buy/?SM-S931BZDKLTL", price: 1069990, availability: "https://schema.org/InStock" },
]);

test("los 4 SKU S931 bajo la pagina del S25 FE quedan fuera del catalogo", () => {
  const { propias, ajenas } = clasificarVariantesFamilia(HTML_FE512, { urlPedida: U_FE512, urlFinal: U_FE512_FINAL });
  assert.deepEqual(propias, [], "ninguno de los S931 es del S25 FE");
  assert.deepEqual(
    ajenas.map((v) => v.modelo).sort(),
    ["SM-S931BDBKLTL", "SM-S931BLBKLTL", "SM-S931BZDKLTL", "SM-S931BZKKLTL"],
  );
});

test("la misma pagina, pedida por su propia URL, si se queda con sus variantes", () => {
  const propia = "https://www.samsung.com/cl/smartphones/galaxy-s25/buy/";
  const { propias } = clasificarVariantesFamilia(HTML_FE512, { urlPedida: propia, urlFinal: propia });
  assert.equal(propias.length, 4);
});

test("el JSON-LD trae el stock por variante y pasa por la misma maquina de estados", () => {
  const html = htmlConOfertas([
    { sku: "A-12345", name: "Con stock", url: "https://x/fam/buy/?A-12345", price: 1000, availability: "https://schema.org/InStock" },
    { sku: "B-12345", name: "Sin stock", url: "https://x/fam/buy/?B-12345", price: 2000, availability: "https://schema.org/OutOfStock" },
    { sku: "C-12345", name: "Sin dato", url: "https://x/fam/buy/?C-12345", price: 3000 },
  ]);
  const { propias } = clasificarVariantesFamilia(html);
  const porSku = Object.fromEntries(propias.map((v) => [v.modelo, v]));
  assert.equal(porSku["A-12345"].estadoStock, ESTADO.DISPONIBLE);
  assert.equal(porSku["A-12345"].disponible, true);
  assert.equal(porSku["B-12345"].estadoStock, ESTADO.AGOTADO);
  assert.equal(porSku["B-12345"].disponible, false);
  assert.equal(porSku["C-12345"].estadoStock, ESTADO.DESCONOCIDO);
  assert.equal(porSku["C-12345"].disponible, null, "sin availability el stock NO se inventa");
  // y todas entran con rango FAMILIA: le ceden el paso a la ficha propia
  for (const v of propias) assert.equal(v.rango, RANGO.FAMILIA);
});

// ---------------------------------------------------------------------------
// 3. camino del navegador (digitalData)
// ---------------------------------------------------------------------------

/**
 * Doble de una pagina de Playwright. Reparte segun QUE pide cada evaluate, para
 * no depender del orden de las llamadas.
 */
function paginaFalsa({ dd, bloque = null, ctas = [], ctasBarra = [], body = "texto de la pagina", urlFinal, especificaciones = {} }) {
  return {
    url: () => urlFinal,
    async waitForFunction() {},
    async evaluate(fn) {
      const fuente = String(fn);
      if (fuente.includes("digitalData")) return dd;
      if (fuente.includes("body.innerText")) return body;
      // el bloque de compra viaja con sus BOTONES desde el 2026-09-11: el texto
      // solo no alcanza, porque el pie promocional del Buying Tool trae frases
      // como "Acumula puntos al comprar tus productos favoritos"
      if (fuente.includes("buying")) {
        return bloque === null && ctas.length === 0 && ctasBarra.length === 0 ? null : { texto: bloque, ctas, ctasBarra };
      }
      return especificaciones;
    },
  };
}

const API_S25 = {
  products: [
    { code: "SM-S936BDBJLTL", price: { value: 1229990 }, stock: { stockLevelStatus: "inStock" } },
    { code: "SM-S931BDBJLTL", price: { value: 979990 }, stock: { stockLevelStatus: "inStock" } },
    { code: "SM-S731BDBPLTL", price: { value: 969990 }, stock: { stockLevelStatus: "inStock" } },
  ],
};

test("la pagina del S25 FE 512GB no emite NINGUN producto: redirige al selector del S25", async () => {
  // Antes esta prueba esperaba un registro de SM-S731BDBPLTL con el precio de la
  // API. Produccion demostro que ese registro es basura: el precio que sale de
  // esa pagina es el del Galaxy S25+. Ver la nota larga en la prueba de
  // repartirPorPropiedad de mas arriba.
  const page = paginaFalsa({
    dd: {
      model_code: "SM-S936BDBJLTL,SM-S931BDBJLTL,SM-S731BDBPLTL",
      displayName: "Galaxy S25+;Galaxy S25;Galaxy S25 FE",
      model_price: "969990",
    },
    urlFinal: U_FE512_FINAL,
  });
  await assert.rejects(
    () => extractSingleProduct(page, U_FE512, [API_S25]),
    (e) => e?.ajena === true,
    "tiene que subir como PaginaAjena, que protege a sus SKU en vez de declararlos desaparecidos",
  );
});

test("una ficha redirigida a la de otro producto se declara ajena, no fallida", async () => {
  // The Frame 55": la pagina redirige al 50" y su digitalData trae QN50
  const page = paginaFalsa({
    dd: { model_code: "QN50LS03FAGXZS", displayName: '50" The Frame LS03F', model_price: "619990" },
    bloque: "Desde $ 51.666 en 12 cuotas sin intereses* o $ 619.990 *Aplican condiciones Agregar al carro",
    urlFinal: U_FRAME50,
  });
  await assert.rejects(
    () => extractSingleProduct(page, U_FRAME55, []),
    (err) => {
      assert.equal(err.ajena, true, "run.mjs la distingue de un error para no reintentarla");
      assert.deepEqual(err.ajenos, ["QN50LS03FAGXZS"]);
      assert.equal(err.urlFinal, U_FRAME50);
      return true;
    },
  );
});

test("un slug renombrado NO se declara ajeno: el producto es el mismo", async () => {
  const page = paginaFalsa({
    dd: { model_code: "RS60T5200B1/ZS", displayName: "Refrigerador Side By Side Con Dispensador 628 lt", model_price: "1299991" },
    bloque: "Desde $ 108.333 en 12 cuotas sin intereses* o $1.299.991 *Aplican condiciones Avísame",
    urlFinal: U_NEVERA_NUEVA,
  });
  const r = await extractSingleProduct(page, U_NEVERA_VIEJA, []);
  assert.equal(r.modelo, "RS60T5200B1/ZS");
  assert.equal(r.estadoStock, ESTADO.AGOTADO, "el bloque de compra dice Avísame");
  assert.equal(r.disponible, false);
});

test("la pagina de grupo legitima sigue emitiendo sus 4 tablets, con stock por SKU", async () => {
  const api = {
    products: [
      { code: "SM-X510NLGACHO", price: { value: 499990 }, stock: { stockLevelStatus: "outOfStock" } },
      { code: "SM-X516BZAACHO", price: { value: 619990 }, stock: { stockLevelStatus: "outOfStock" } },
      { code: "SM-X610NLGACHO", price: { value: 669990 }, stock: { stockLevelStatus: "outOfStock" } },
      { code: "SM-X616BZAACHO", price: { value: 779990 }, stock: { stockLevelStatus: "inStock" } },
    ],
  };
  const page = paginaFalsa({
    dd: {
      model_code: "SM-X510NLGACHO,SM-X516BZAACHO,SM-X610NLGACHO,SM-X616BZAACHO",
      displayName: "Galaxy Tab S9 FE (WiFi);Galaxy Tab S9 FE 5G;Galaxy Tab S9 FE+ (WiFi);Galaxy Tab S9 FE+ 5G",
      model_price: "499990",
    },
    // el bloque de compra de estas paginas es un selector de grupo: NO se puede
    // atribuir a ningun SKU, asi que el stock tiene que venir de la API
    bloque: "Buying Tool Dispositivo Galaxy Tab S9 FE (WiFi) Desde $ 499.990 Galaxy Tab S9 FE 5G Desde $ 619.990",
    urlFinal: U_TABS9FE,
  });
  const r = await extractSingleProduct(page, U_TABS9FE, [api]);
  assert.equal(r.length, 4);
  assert.deepEqual(r.map((x) => x.precio), [499990, 619990, 669990, 779990]);
  assert.deepEqual(r.map((x) => x.estadoStock), [ESTADO.AGOTADO, ESTADO.AGOTADO, ESTADO.AGOTADO, ESTADO.DISPONIBLE]);
  for (const x of r) assert.equal(x.rango, RANGO.AGRUPADA);
});

test("en una pagina de grupo sin stock en la API el estado queda desconocido", async () => {
  const api = { products: [{ code: "AAA-11111", price: { value: 1000 } }, { code: "BBB-22222", price: { value: 2000 } }] };
  const page = paginaFalsa({
    dd: { model_code: "AAA-11111,BBB-22222", displayName: "Uno;Dos", model_price: "1000" },
    urlFinal: "https://x/grupo/buy/",
  });
  const r = await extractSingleProduct(page, "https://x/grupo/buy/", [api]);
  assert.deepEqual(r.map((x) => x.estadoStock), [ESTADO.DESCONOCIDO, ESTADO.DESCONOCIDO]);
  assert.deepEqual(r.map((x) => x.disponible), [null, null]);
});

test("la ficha propia usa su bloque de compra y cae a la API solo si no lo puede leer", async () => {
  const base = { dd: { model_code: "SM-S731BDBKLTL", displayName: "Galaxy S25 FE", model_price: "579990" }, urlFinal: U_FE256 };
  const api = { code: "SM-S731BDBKLTL", stock: { stockLevelStatus: "inStock" }, price: { value: 829990 } };

  const conBloque = await extractSingleProduct(
    paginaFalsa({ ...base, bloque: "*Aplican condiciones Avísame" }),
    U_FE256,
    [api],
  );
  assert.equal(conBloque.estadoStock, ESTADO.AGOTADO, "manda el bloque de compra, no la API");

  const sinBloque = await extractSingleProduct(paginaFalsa({ ...base, bloque: null }), U_FE256, [api]);
  assert.equal(sinBloque.estadoStock, ESTADO.DISPONIBLE, "sin bloque legible, respaldo de la API");

  const sinNada = await extractSingleProduct(paginaFalsa({ ...base, bloque: null }), U_FE256, []);
  assert.equal(sinNada.estadoStock, ESTADO.DESCONOCIDO, "sin ninguna fuente NO se inventa un estado");
  assert.equal(sinNada.disponible, null);
});

test("de la respuesta de UN producto se toma el stock, jamas el precio", () => {
  // medido en The Frame 50": la API de un solo producto publica el precio de
  // LISTA (949.990) mientras el cliente ve 619.990. Usarlo seria inventar avisos.
  const m = productosDesdeApi([{ code: "QN50LS03FAGXZS", price: { value: 949990 }, stock: { stockLevelStatus: "inStock" } }]);
  assert.equal(m.get("QN50LS03FAGXZS").precio, null);
  assert.equal(m.get("QN50LS03FAGXZS").estado, ESTADO.DISPONIBLE);
});

// ---------------------------------------------------------------------------
// 4. precedencia: la ficha propia le gana a la pagina que solo agrupa
// ---------------------------------------------------------------------------

const FICHA_PROPIA = {
  categoria: "Smartphones",
  subcategoria: "galaxy-s",
  variante: "256GB, Navy",
  url: U_FE256,
};
const PAGINA_AGRUPADA = {
  categoria: "Familia (auto-descubierta)",
  subcategoria: null,
  variante: null,
  url: U_FE512,
};

// $579.990 con boton "Comprar" en la ficha donde el cliente compra...
const DESDE_FICHA = {
  modelo: "SM-S731BDBKLTL",
  nombre: "Galaxy S25 FE",
  precio: 579990,
  estadoStock: ESTADO.DISPONIBLE,
  disponible: true,
  rango: RANGO.PROPIA,
  url: U_FE256,
};
// ...contra $829.990 y "agotado" en la pagina agrupada, para el MISMO SKU
const DESDE_AGRUPADA = {
  modelo: "SM-S731BDBKLTL",
  nombre: "Galaxy S25 FE 256 GB｜8 GB Azul Marino",
  precio: 829990,
  estadoStock: ESTADO.AGOTADO,
  disponible: false,
  rango: RANGO.FAMILIA,
  url: `${U_FE512}?SM-S731BDBKLTL`,
};

test("caso S25 FE: gana el precio y el stock de la ficha donde se compra", () => {
  const observado = integrarVariantes({}, FICHA_PROPIA, [DESDE_FICHA], { via: "individual", timestamp: TS });
  integrarVariantes(observado, PAGINA_AGRUPADA, [DESDE_AGRUPADA], { via: "familia", timestamp: TS });
  const rec = observado["SM-S731BDBKLTL"];
  assert.equal(rec.precio, 579990);
  assert.equal(rec.estadoStock, ESTADO.DISPONIBLE);
  assert.equal(rec.categoria, "Smartphones");
  assert.equal(rec.paginaOrigen, U_FE256);
  // el nombre rico de la pagina agrupada igual se aprovecha para el titulo
  assert.equal(rec.nombreFamilia, "Galaxy S25 FE 256 GB｜8 GB Azul Marino");
});

test("caso S25 FE en el orden inverso: el resultado es el mismo", () => {
  // antes esto dependia del orden de llegada y por eso el precio bailaba entre
  // corridas; ahora decide el rango, no quien escribio ultimo
  const observado = integrarVariantes({}, PAGINA_AGRUPADA, [DESDE_AGRUPADA], { via: "familia", timestamp: TS });
  assert.equal(observado["SM-S731BDBKLTL"].precio, 829990, "por ahora es lo unico que hay");
  integrarVariantes(observado, FICHA_PROPIA, [DESDE_FICHA], { via: "individual", timestamp: TS });
  const rec = observado["SM-S731BDBKLTL"];
  assert.equal(rec.precio, 579990);
  assert.equal(rec.estadoStock, ESTADO.DISPONIBLE);
  assert.equal(rec.variante, "256GB, Navy");
});

test("una pagina agrupada tampoco le gana a una pagina familia", () => {
  const familia = { categoria: "Tablets", url: "https://x/fam/buy/" };
  const agrupada = { categoria: "Tablets", url: "https://x/grupo/buy/" };
  const observado = integrarVariantes({}, familia, [{ modelo: "SKU-1", precio: 100, rango: RANGO.FAMILIA, url: "u" }], {
    via: "familia",
    timestamp: TS,
  });
  integrarVariantes(observado, agrupada, [{ modelo: "SKU-1", precio: 999, rango: RANGO.AGRUPADA, url: "u" }], {
    via: "agrupada",
    timestamp: TS,
  });
  assert.equal(observado["SKU-1"].precio, 100);
});

test("entre paginas del mismo rango sigue mandando la ultima observacion", () => {
  // el catalogo tiene que poder corregirse dentro de la misma corrida cuando las
  // dos fuentes valen lo mismo; de eso depende la correccion final del envio
  const entrada = { categoria: "Cocina", url: "https://x/p" };
  const observado = integrarVariantes({}, entrada, [{ modelo: "SKU-1", precio: 100, rango: RANGO.PROPIA, url: "u" }], {
    via: "individual",
    timestamp: TS,
  });
  integrarVariantes(observado, entrada, [{ modelo: "SKU-1", precio: 200, rango: RANGO.PROPIA, url: "u" }], {
    via: "individual",
    timestamp: TS,
  });
  assert.equal(observado["SKU-1"].precio, 200);
});

// ---------------------------------------------------------------------------
// 5. la red de seguridad: una redireccion NUNCA puede volverse un falso "ya no aparece"
// ---------------------------------------------------------------------------

test("los SKU de una pagina redirigida conservan su dato y no acumulan ausencias", () => {
  // run.mjs le pasa a comparar() las paginas fallidas MAS las redirigidas, bajo
  // el mismo concepto: "no verificadas". Si una ficha empieza a redirigir, sus
  // productos dejan de observarse y sin esto comparar() los daria por
  // desaparecidos en 2 corridas. Este es el contrato entre los dos modulos.
  const previo = {
    "QN55LS03FAGXZS": {
      modelo: "QN55LS03FAGXZS",
      nombre: '55" The Frame LS03F',
      precio: 689990,
      url: U_FRAME55,
      paginaOrigen: U_FRAME55,
      categoria: "TV Lifestyle",
      presencia: "activo",
      estadoStock: ESTADO.DISPONIBLE,
      ausencias: 1,
      notificadoDesaparecido: false,
    },
  };
  const { catalogo, cambios } = comparar({
    previo,
    observado: {}, // la pagina redirigio y no emitio nada
    paginasFallidas: new Set([U_FRAME55]), // run.mjs mete aqui las redirigidas
    corridaConfiable: true,
    timestamp: TS,
  });
  assert.equal(cambios.length, 0, "ni un aviso");
  assert.equal(catalogo["QN55LS03FAGXZS"].presencia, "error_verificacion");
  assert.equal(catalogo["QN55LS03FAGXZS"].ausencias, 1, "la ausencia NO cuenta");
  assert.equal(catalogo["QN55LS03FAGXZS"].precio, 689990, "conserva su ultimo dato bueno");
});

test("un SKU borrado del catalogo no genera ningun evento", () => {
  // Justificacion de la limpieza de data/latest.json: los 4 SM-S931* colgaban de
  // la pagina del S25 FE y su pagina duena (galaxy-s25/buy/) no esta ni en
  // seed.json ni en los sitemaps, asi que nadie los va a observar nunca mas.
  // Dejarlos en el catalogo daria 4 falsos "ya no aparece"; borrar la llave los
  // saca del bucle de comparar(), que solo recorre lo que existe en `previo`.
  const { catalogo, cambios } = comparar({
    previo: {}, // la llave ya no existe
    observado: {},
    paginasFallidas: new Set(),
    corridaConfiable: true,
    timestamp: TS,
  });
  assert.deepEqual(cambios, []);
  assert.deepEqual(catalogo, {});
});

// ---------------------------------------------------------------------------
// 6. EL PRECIO QUE VALE ES EL QUE EL CLIENTE VE (defecto 5 de la revision)
// ---------------------------------------------------------------------------
//
// La regla se agrego el 2026-08-03 despues del pack "Watch Ultra (2025) Blue +
// Galaxy Buds4 Pro": digitalData publicaba model_price=555980, un numero que no
// aparecia en ninguna parte de la pagina, mientras el cliente veia $974.980, y
// el monitor avisaba bajadas de un precio inexistente.
//
// La rama `varios ? precioApi : precioFinal` tiraba esa defensa justo en el caso
// que vino a cubrir: en una ficha fusionada se quedaba con el precio de la API,
// que es el de LISTA (en el S25 FE: API 829.990 contra 579.990 con boton
// "Comprar" en pantalla). Ahora la API solo entra cuando el precio leido no
// aparece escrito en ningun lado, que es la senal de que no es de este SKU.

const U_FE256_BUY = "https://www.samsung.com/cl/smartphones/galaxy-s/galaxy-s25-fe-navy-256gb-sm-s731bdbkltl/";

test("en una ficha fusionada gana el precio ESCRITO en la pagina, no el de la API", async () => {
  const base = {
    dd: {
      // la ficha publica los tres hermanos; la URL nombra solo al ultimo
      model_code: "SM-S936BDBJLTL,SM-S931BDBJLTL,SM-S731BDBKLTL",
      displayName: "Galaxy S25+;Galaxy S25;Galaxy S25 FE",
      model_price: "579990",
      list_price: "829990",
    },
    body: "Galaxy S25 FE Desde $ 48.333 en 12 cuotas o $ 579.990 Precio original: $ 829.990 Comprar",
    bloque: "*Aplican condiciones Comprar",
    urlFinal: U_FE256_BUY,
  };
  const apiLista = { products: [{ code: "SM-S731BDBKLTL", price: { value: 829990 }, stock: { stockLevelStatus: "inStock" } }] };

  const conApi = await extractSingleProduct(paginaFalsa(base), U_FE256_BUY, [apiLista]);
  const sinApi = await extractSingleProduct(paginaFalsa(base), U_FE256_BUY, []);

  assert.equal(conApi.precio, 579990, "el cliente ve 579.990: la API de lista no puede pisarlo");
  assert.equal(sinApi.precio, 579990);
  assert.equal(conApi.precio, sinApi.precio, "la respuesta de la API no puede cambiar el precio guardado");
});

test("pero si el precio leido NO esta escrito en la pagina, la API sigue siendo el respaldo", async () => {
  // es el motivo original de la rama: en una ficha fusionada el model_price
  // puede ser el de otro hermano
  const page = paginaFalsa({
    dd: { model_code: "AAA-11111,SM-S731BDBKLTL", displayName: "Otro;Galaxy S25 FE", model_price: "1234567" },
    body: "Galaxy S25 FE $ 579.990",
    bloque: "*Aplican condiciones Comprar",
    urlFinal: U_FE256_BUY,
  });
  const api = { products: [{ code: "SM-S731BDBKLTL", price: { value: 579990 } }] };
  const r = await extractSingleProduct(page, U_FE256_BUY, [api]);
  assert.equal(r.precio, 579990);
});

test("precioVisiblePreferido esta CABLEADO: el pack real sale con el precio que se ve", async () => {
  // pack "Watch Ultra (2025) Blue + Galaxy Buds4 Pro" (F-SMR640SML70), medido el
  // 2026-08-03: model_price=555980 no aparece en la pagina y list_price=974980 si.
  // Sin este cableado la funcion se puede borrar y la suite sigue verde.
  const page = paginaFalsa({
    dd: { model_code: "F-SMR640SML70", displayName: "Watch Ultra + Buds4 Pro", model_price: "555980", list_price: "974980" },
    body: "Watch Ultra (2025) Blue + Galaxy Buds4 Pro $ 974.980 Comprar ahora",
    bloque: "*Aplican condiciones Comprar ahora",
    urlFinal: "https://www.samsung.com/cl/watches/pack-f-smr640sml70/",
  });
  const r = await extractSingleProduct(page, "https://www.samsung.com/cl/watches/pack-f-smr640sml70/", []);
  assert.equal(r.precio, 974980, "gana el precio ESCRITO en la pagina");
});

// ---------------------------------------------------------------------------
// 7. CONTRATO DE versionStock EN EL ORIGEN (defecto 13 de la revision)
// ---------------------------------------------------------------------------
//
// Toda la proteccion contra la avalancha de avisos cuelga de que CADA
// observacion traiga versionStock: si el campo falta, reestableceLineaBase()
// devuelve false en silencio y el SKU se va por el camino normal (medido: 400
// eventos de stock y 253 avisos a Discord en la corrida 2). Hoy los tres caminos
// de extraccion lo ponen, pero era un acoplamiento implicito que ninguna prueba
// fijaba: un cuarto camino, o un refactor, lo re-armaba sin que nada fallara.

test("los TRES caminos de extraccion sellan la version del detector", async () => {
  const conEstado = [];

  // camino 1: JSON-LD de una pagina familia
  const html = `<html><script type="application/ld+json">${JSON.stringify([
    { "@type": "Product", sku: "AAA-11111", offers: { "@type": "Offer", url: "https://x/buy/?AAA-11111", price: "1000", availability: "https://schema.org/InStock" } },
  ])}</script></html>`;
  conEstado.push(...clasificarVariantesFamilia(html, { urlPedida: "https://x/buy/", urlFinal: "https://x/buy/" }).propias);

  // camino 2: pagina de grupo (varios SKU propios, stock por API)
  const grupo = await extractSingleProduct(
    paginaFalsa({
      dd: { model_code: "BBB-22222,CCC-33333", displayName: "Uno;Dos", model_price: "2000" },
      urlFinal: "https://x/grupo/buy/",
    }),
    "https://x/grupo/buy/",
    [{ products: [
      { code: "BBB-22222", price: { value: 2000 }, stock: { stockLevelStatus: "inStock" } },
      { code: "CCC-33333", price: { value: 3000 }, stock: { stockLevelStatus: "outOfStock" } },
    ] }],
  );
  conEstado.push(...grupo);

  // camino 3: ficha propia (bloque de compra)
  conEstado.push(
    await extractSingleProduct(
      paginaFalsa({
        dd: { model_code: "DDD-44444", displayName: "Tres", model_price: "4000" },
        bloque: "*Aplican condiciones Comprar",
        urlFinal: "https://x/ficha/",
      }),
      "https://x/ficha/",
      [],
    ),
  );

  assert.equal(conEstado.length, 4, "los tres caminos, 4 registros");
  for (const v of conEstado) {
    assert.ok(v.estadoStock, `${v.modelo} trae estadoStock`);
    assert.equal(v.versionStock, VERSION_STOCK, `${v.modelo} sella la version del detector`);
  }
});

// ---------------------------------------------------------------------------
// 8. LA BARRA DE PRECIO PEGAJOSA, segundo intento antes de la API
// ---------------------------------------------------------------------------
//
// Medido el 2026-09-11 en https://www.samsung.com/cl/smartphones/galaxy-z-flip7/buy/
// (plantilla "hubble"): el bloque de compra no expone NINGUN boton, pero la barra
// de abajo si, y dice literalmente "No está a la venta"
// (a.cta.price-bar-cart-btn.is-cta-disabled, visible), fuera de [class*='buying'].
// Sin mirarla, ese SKU se guardaba como "agotado" porque la API responde
// outOfStock -- un estado distinto del que ve el cliente, y el operador quiere
// distinguirlos.

test("si el bloque no decide, manda la barra de precio antes que la API", async () => {
  const base = {
    dd: { model_code: "SM-F766BDBJCHO", displayName: "Galaxy Z Flip7", model_price: "1169990" },
    body: "Galaxy Z Flip7 $ 1.169.990",
    // el Buying Tool: mucho texto promocional y ningun CTA
    bloque: "Buying Tool Galaxy Z Flip7 Desde $ 48.749 al mes o $ 1.169.990 Regalos y promociones ¡Al comprar tu Galaxy Z Flip7!",
    ctas: ["Conoce más", "Más información"],
    urlFinal: "https://www.samsung.com/cl/smartphones/galaxy-z-flip7/buy/",
  };
  const api = { code: "SM-F766BDBJCHO", stock: { stockLevelStatus: "outOfStock" } };

  const conBarra = await extractSingleProduct(
    paginaFalsa({ ...base, ctasBarra: ["No está a la venta"] }),
    base.urlFinal,
    [api],
  );
  assert.equal(conBarra.estadoStock, ESTADO.NO_A_LA_VENTA, "lo que ve el cliente, no el outOfStock de la API");

  const sinBarra = await extractSingleProduct(paginaFalsa(base), base.urlFinal, [api]);
  assert.equal(sinBarra.estadoStock, ESTADO.AGOTADO, "sin barra legible, la API sigue siendo el ultimo respaldo");
});

test("la barra NO puede quitarle el veredicto al bloque de compra", async () => {
  // el orden es bloque -> barra -> API: si el bloque decidio, nadie lo pisa
  const r = await extractSingleProduct(
    paginaFalsa({
      dd: { model_code: "UN40F6000FGXZS", displayName: "F6000", model_price: "229990" },
      bloque: "Desde $ 19.166 en 12 cuotas sin intereses* o $ 229.990 *Aplican condiciones Agregar al carro",
      ctas: ["Agregar al carro", "Dónde comprar"],
      ctasBarra: ["Avísame"],
      urlFinal: "https://www.samsung.com/cl/tvs/f6000/",
    }),
    "https://www.samsung.com/cl/tvs/f6000/",
    [],
  );
  assert.equal(r.estadoStock, ESTADO.DISPONIBLE);
});

// --- el precio COBRADO gana al tachado, pasando por extractSingleProduct -----

test("el precio que gana es el del bloque, no el tachado de digitalData", async () => {
  // Caso real medido el 2026-09-12 en el Galaxy Tab S10 Lite SM-X400NZRDCHO:
  // model_price 379990 no esta escrito en la pagina; list_price 549989 SI, pero
  // es el precio TACHADO; el cliente paga 494990, que solo existe en el bloque.
  const r = await extractSingleProduct(
    paginaFalsa({
      dd: { model_code: "SM-X400NZRDCHO", displayName: "Galaxy Tab S10 Lite", model_price: "379990", list_price: "549989" },
      bloque: "Desde $ 41.249 en 12 cuotas sin intereses* o $494.990 Precio original: $549.989 Ahorra $ 54.999 *Aplican condiciones Comprar ahora",
      ctas: ["Comprar ahora"],
      body: "Precio original: $549.989 Ahorra $ 54.999",
      urlFinal: "https://www.samsung.com/cl/tablets/galaxy-tab-s/galaxy-tab-s10-lite-coralred-128gb-sm-x400nzrdcho/",
    }),
    "https://www.samsung.com/cl/tablets/galaxy-tab-s/galaxy-tab-s10-lite-coralred-128gb-sm-x400nzrdcho/",
    [],
  );
  assert.equal(r.precio, 494990);
  assert.equal(r.estadoStock, "disponible"); // el bloque trae precio: el CTA vale
});

test("sin la frase del bloque, el precio sigue saliendo de digitalData", async () => {
  // no se cambia el comportamiento de las paginas que no publican esa frase
  const r = await extractSingleProduct(
    paginaFalsa({
      dd: { model_code: "UN50M75HAGXZS", displayName: "M70H", model_price: "389990", list_price: "389990" },
      bloque: "$ 389.990 Agregar al carro",
      ctas: ["Agregar al carro"],
      body: "$ 389.990",
      urlFinal: "https://www.samsung.com/cl/tvs/m70h/",
    }),
    "https://www.samsung.com/cl/tvs/m70h/",
    [],
  );
  assert.equal(r.precio, 389990);
});
