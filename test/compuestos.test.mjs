// Paginas que exponen VARIOS productos: digitalData.product.model_code viene con
// los codigos pegados por coma. Guardarlo asi vigilaba 2 a 4 equipos con un solo
// precio. Medido en vivo el 2026-08-01: la pagina del Book3 360 publica 4
// precios distintos y el monitor guardaba uno solo.
import { test } from "node:test";
import assert from "node:assert/strict";
import { extractSingleProduct, productosDesdeApi, RE_API_PRODUCTOS } from "../src/extract.mjs";

// respuesta REAL capturada de api.shop.samsung.com para el Book3 360
const RESPUESTA_API = {
  products: [
    { code: "NP750QFG-KB2CL", price: { value: 1399990 } },
    { code: "NP750XFG-KB4CL", price: { value: 849990 } },
    { code: "NP750XFG-KB3CL", price: { value: 749990 } },
    { code: "NP730QFG-KB2CL", price: { value: 1299991 } },
  ],
};

function paginaCompuesta({ model_code, displayName, respuestas }) {
  let llamadas = 0;
  return {
    respuestas,
    async waitForFunction() {},
    async evaluate() {
      llamadas++;
      if (llamadas === 1) return { model_price: "1399990", model_code, displayName };
      if (llamadas === 2) return "texto";
      return {}; // especificaciones
    },
  };
}

test("la URL de la API de precios se reconoce", () => {
  assert.ok(RE_API_PRODUCTOS.test("https://api.shop.samsung.com/tokocommercewebservices/v2/cl/products?productCodes=NP750QFG-KB2CL"));
  assert.ok(!RE_API_PRODUCTOS.test("https://www.samsung.com/cl/computers/galaxy-book/galaxy-book3-360/buy/"));
});

test("indexa por SKU los precios de la respuesta que la pagina ya pide", () => {
  const m = productosDesdeApi([RESPUESTA_API]);
  assert.equal(m.get("NP750QFG-KB2CL").precio, 1399990);
  assert.equal(m.get("NP750XFG-KB4CL").precio, 849990);
  assert.equal(m.size, 4);
});

test("ignora respuestas basura, sin precio o con precio invalido", () => {
  assert.equal(productosDesdeApi(null).size, 0);
  assert.equal(productosDesdeApi([null, "texto", 42, {}]).size, 0);
  assert.equal(productosDesdeApi([{ products: [{ code: "A" }, { code: "B", price: { value: 0 } }, { code: "C", price: { value: "x" } }] }]).size, 0);
});

test("una pagina con 2 productos emite 2 registros, cada uno con SU precio", async () => {
  const page = paginaCompuesta({
    model_code: "NP750QFG-KB2CL,NP750XFG-KB4CL",
    displayName: "Galaxy Book3 360;Galaxy Book3",
    respuestas: [RESPUESTA_API],
  });
  const r = await extractSingleProduct(page, "https://x/buy/", [RESPUESTA_API]);
  assert.ok(Array.isArray(r), "debe devolver un registro por producto");
  assert.equal(r.length, 2);
  assert.deepEqual(
    r.map((x) => [x.modelo, x.nombre, x.precio]),
    [
      ["NP750QFG-KB2CL", "Galaxy Book3 360", 1399990],
      ["NP750XFG-KB4CL", "Galaxy Book3", 849990],
    ],
  );
  assert.ok(!r.some((x) => x.modelo.includes(",")), "ningun SKU puede quedar con coma");
});

test("si la API no respondio, se trata como pagina fallida en vez de guardar la ficha fusionada", async () => {
  const page = paginaCompuesta({
    model_code: "NP750QFG-KB2CL,NP750XFG-KB4CL",
    displayName: "Galaxy Book3 360;Galaxy Book3",
    respuestas: [],
  });
  await assert.rejects(() => extractSingleProduct(page, "https://x/buy/", []), /varios productos sin datos por SKU/);
});

test("un SKU sin precio propio no se inventa: se emite solo el que si lo tiene", async () => {
  const parcial = { products: [{ code: "NP750QFG-KB2CL", price: { value: 1399990 } }] };
  const page = paginaCompuesta({
    model_code: "NP750QFG-KB2CL,NP750XFG-KB4CL",
    displayName: "Galaxy Book3 360;Galaxy Book3",
    respuestas: [parcial],
  });
  const r = await extractSingleProduct(page, "https://x/buy/", [parcial]);
  assert.equal(r.length, 1);
  assert.equal(r[0].modelo, "NP750QFG-KB2CL");
});

test("una pagina normal de un solo producto sigue devolviendo UN registro", async () => {
  let llamadas = 0;
  const page = {
    async waitForFunction() {},
    async evaluate() {
      llamadas++;
      if (llamadas === 1) return { model_price: "679990", model_code: "SM-S711BZWJLTL", displayName: "Galaxy S23 FE" };
      if (llamadas === 2) return "texto";
      return {};
    },
  };
  const r = await extractSingleProduct(page, "https://x/p", []);
  assert.ok(!Array.isArray(r));
  assert.equal(r.modelo, "SM-S711BZWJLTL");
  assert.equal(r.precio, 679990);
});
