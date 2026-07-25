import { test } from "node:test";
import assert from "node:assert/strict";
import { extractFamilyVariants } from "../src/extract.mjs";

function envolver(json) {
  return `<html><head><script type="application/ld+json" data-type="seo">${JSON.stringify(json)}</script></head><body></body></html>`;
}

test("extrae variantes desde ProductGroup/hasVariant (patron celulares)", () => {
  const html = envolver([
    {
      "@context": "https://schema.org",
      "@type": "ProductGroup",
      name: "Galaxy Test",
      hasVariant: [
        {
          "@type": "Product",
          sku: "SM-TEST1",
          name: "Galaxy Test 128GB Azul",
          offers: {
            "@type": "Offer",
            url: "https://www.samsung.com/cl/x/buy/?SM-TEST1",
            price: "500000",
            priceCurrency: "CLP",
            availability: "https://schema.org/InStock",
          },
        },
        {
          "@type": "Product",
          sku: "SM-TEST2",
          name: "Galaxy Test 256GB Azul",
          // sin offers: variante sin stock -> no debe aparecer
        },
      ],
    },
  ]);
  const variants = extractFamilyVariants(html);
  assert.equal(variants.length, 1);
  assert.equal(variants[0].modelo, "SM-TEST1");
  assert.equal(variants[0].precio, 500000);
  assert.equal(variants[0].disponible, true);
});

test("extrae un Product suelto con offers directo", () => {
  const html = envolver({
    "@type": "Product",
    name: "Producto suelto",
    offers: { "@type": "Offer", url: "https://x/?MOD-1", price: "19990", priceCurrency: "CLP" },
  });
  const variants = extractFamilyVariants(html);
  assert.equal(variants.length, 1);
  assert.equal(variants[0].modelo, "MOD-1");
  assert.equal(variants[0].disponible, null); // sin availability -> desconocido
});

test("precio 'NaN' del propio sitio (bug combos Samsung) se descarta", () => {
  const html = envolver({
    "@type": "Product",
    name: "Combo con precio roto",
    offers: { "@type": "Offer", url: "https://x/?F-COMBO", price: "NaN", priceCurrency: "CLP" },
  });
  assert.equal(extractFamilyVariants(html).length, 0);
});

test("precio cero o negativo se descarta", () => {
  const html = envolver({
    "@type": "Product",
    offers: { "@type": "Offer", url: "https://x/?MOD-0", price: "0" },
  });
  assert.equal(extractFamilyVariants(html).length, 0);
});

test("JSON-LD malformado no rompe la extraccion del resto", () => {
  const roto = '<script type="application/ld+json">{esto no es json</script>';
  const bueno = envolver({
    "@type": "Product",
    offers: { "@type": "Offer", url: "https://x/?MOD-2", price: "10000" },
  });
  const variants = extractFamilyVariants(roto + bueno);
  assert.equal(variants.length, 1);
  assert.equal(variants[0].modelo, "MOD-2");
});

test("el mismo Offer repetido en varios bloques no duplica la variante", () => {
  const bloque = envolver({
    "@type": "Product",
    offers: { "@type": "Offer", url: "https://x/?MOD-3", price: "10000" },
  });
  assert.equal(extractFamilyVariants(bloque + bloque).length, 1);
});
