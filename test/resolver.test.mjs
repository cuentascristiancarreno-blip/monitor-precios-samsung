// COMO SE RESUELVE UNA PAGINA /buy/: cuando alcanza el HTML plano y cuando hay
// que abrir el navegador.
//
// Existe por el defecto 2 de la revision del 2026-09-11: procesarEntrada cortaba
// con `if (variants.length > 0) return {..., via: "familia"}` apenas el JSON-LD
// devolvia UNA variante, asi que para esos SKU el bloque de compra no se leia
// jamas. Y el `availability` del JSON-LD miente: medido en vivo en
// .../galaxy-book4-15-6-inch-13th-core-5-16gb-1tb-np750xgj-ks4cl/buy/, el HTML
// servido dice "availability":"inStock" mientras el bloque de compra de esa
// misma pagina dice "Avísame" y la API responde outOfStock. Como esa pagina es
// la UNICA fuente de ese SKU, el rango FAMILIA no salvaba nada: no hay ninguna
// observacion PROPIA con que arbitrar.
import { test } from "node:test";
import assert from "node:assert/strict";
import { procesarEntrada } from "../src/resolver.mjs";
import { ESTADO, VERSION_STOCK } from "../src/stock.mjs";
import { RANGO } from "../src/identidad.mjs";

const U_BOOK4 = "https://www.samsung.com/cl/computers/galaxy-book/galaxy-book4-15-6-inch-13th-core-5-16gb-1tb-np750xgj-ks4cl/buy/";
const U_TABS9FE = "https://www.samsung.com/cl/tablets/galaxy-tab-s9-fe/buy/";

/** JSON-LD como el que sirve Samsung, con la disponibilidad DECLARADA. */
function htmlFamilia(variantes) {
  const productos = variantes.map((v) => ({
    "@type": "Product",
    sku: v.sku,
    name: v.nombre,
    offers: {
      "@type": "Offer",
      url: `https://www.samsung.com/cl/x/buy/?${v.sku}`,
      price: String(v.precio),
      priceCurrency: "CLP",
      availability: v.availability ?? "https://schema.org/InStock",
    },
  }));
  return `<html><script type="application/ld+json">${JSON.stringify(productos)}</script></html>`;
}

/** Doble del context de Playwright. Anota si alguien abrio una pagina. */
function contextoFalso({ salida = null, error = null, abiertas = [] } = {}) {
  return {
    abiertas,
    async newPage() {
      return {
        on() {},
        url: () => abiertas[abiertas.length - 1],
        async goto(url) {
          abiertas.push(url);
          if (error) throw error;
        },
        async waitForFunction() {},
        async evaluate(fn) {
          const fuente = String(fn);
          if (fuente.includes("digitalData")) return salida?.dd ?? null;
          if (fuente.includes("body.innerText")) return salida?.body ?? "";
          if (fuente.includes("buying")) return salida?.bloque ?? null;
          return {};
        },
        async close() {},
      };
    },
  };
}

function conFetchFalso(html, fn) {
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => ({ ok: true, url, async text() { return html; } });
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      globalThis.fetch = original;
    });
}

test("una /buy/ de UNA sola variante ya no se cree el 'inStock' del JSON-LD: abre el navegador", async () => {
  const html = htmlFamilia([
    { sku: "NP750XGJ-KS4CL", nombre: "Galaxy Book4 15,6\" 16GB/1TB", precio: 699990, availability: "https://schema.org/InStock" },
  ]);
  const abiertas = [];
  const ctx = contextoFalso({
    abiertas,
    salida: {
      dd: { model_code: "NP750XGJ-KS4CL", displayName: "Galaxy Book4", model_price: "699990" },
      body: "Galaxy Book4 $ 699.990",
      // texto literal medido en esa pagina el 2026-09-11
      bloque: {
        texto: "Desde $ 58.333 en 12 cuotas sin intereses* o $ 699.990 Precio original: $ 999.990 Ahorra $ 300.000 *Aplican condiciones Avisame",
        ctas: ["Avísame"],
      },
    },
  });

  const r = await conFetchFalso(html, () => procesarEntrada({ url: U_BOOK4 }, ctx, 30000));

  assert.deepEqual(abiertas, [U_BOOK4], "tiene que haber abierto el navegador");
  assert.equal(r.variants.length, 1);
  assert.equal(r.variants[0].modelo, "NP750XGJ-KS4CL");
  assert.equal(r.variants[0].estadoStock, ESTADO.AGOTADO, "manda el boton 'Avísame', no el 'inStock' declarado");
  assert.equal(r.variants[0].rango, RANGO.PROPIA);
  assert.equal(
    r.variants[0].nombre,
    'Galaxy Book4 15,6" 16GB/1TB',
    "el nombre rico del JSON-LD se conserva: si no, el titulo perderia capacidad y RAM",
  );
  assert.equal(r.via, "familia", "para que catalogo.mjs lo guarde como nombreFamilia");
});

test("una /buy/ de VARIAS variantes sigue resolviendose barata, sin navegador", async () => {
  // el bloque de compra de estas paginas es un selector de grupo que no se puede
  // atribuir a ningun SKU: abrir el navegador no daria un stock mejor, y el
  // JSON-LD es la unica fuente con precio POR VARIANTE
  const html = htmlFamilia([
    { sku: "SM-X510NLGACHO", nombre: "Tab S9 FE WiFi", precio: 499990 },
    { sku: "SM-X516BZAACHO", nombre: "Tab S9 FE 5G", precio: 619990 },
  ]);
  const abiertas = [];
  const ctx = contextoFalso({ abiertas });

  const r = await conFetchFalso(html, () => procesarEntrada({ url: U_TABS9FE }, ctx, 30000));

  assert.deepEqual(abiertas, [], "ni una carga de navegador");
  assert.equal(r.variants.length, 2);
  assert.equal(r.via, "familia");
  assert.deepEqual(r.variants.map((v) => v.precio), [499990, 619990]);
});

test("si el navegador falla, el SKU NO se pierde: precio del JSON-LD y stock desconocido", async () => {
  // perder el SKU seria peor que no saber su stock: dos corridas asi y comparar()
  // lo anuncia como desaparecido
  const html = htmlFamilia([
    { sku: "NP750XGJ-KS4CL", nombre: "Galaxy Book4 15,6\"", precio: 699990, availability: "https://schema.org/InStock" },
  ]);
  const ctx = contextoFalso({ error: new Error("Timeout 30000ms exceeded") });

  const r = await conFetchFalso(html, () => procesarEntrada({ url: U_BOOK4 }, ctx, 30000));

  assert.equal(r.variants.length, 1);
  assert.equal(r.variants[0].precio, 699990, "el precio se conserva");
  assert.equal(
    r.variants[0].estadoStock,
    ESTADO.DESCONOCIDO,
    "y el stock NO: la disponibilidad declarada es justo el dato que se demostro falso",
  );
  assert.equal(r.variants[0].disponible, null);
  assert.equal(r.variants[0].versionStock, VERSION_STOCK);
});

test("una redireccion sigue subiendo como PaginaAjena aunque haya JSON-LD de respaldo", async () => {
  const html = htmlFamilia([{ sku: "NP750XGJ-KS4CL", nombre: "Book4", precio: 699990 }]);
  const ajena = Object.assign(new Error("otra ficha"), { ajena: true, urlFinal: "https://otra/", ajenos: ["X"] });
  const ctx = contextoFalso({ error: ajena });

  await assert.rejects(
    () => conFetchFalso(html, () => procesarEntrada({ url: U_BOOK4 }, ctx, 30000)),
    (err) => err.ajena === true,
  );
});
