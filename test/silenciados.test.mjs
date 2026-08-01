import { test } from "node:test";
import assert from "node:assert/strict";
import { estaSilenciado, resumirSilenciados } from "../src/silenciados.mjs";

// nombres REALES del catalogo (data/latest.json al 2026-08-01)
const BOOK3 = [
  { modelo: "NP730QFG-KB2CL", nombre: 'Galaxy book3 360 (13,3", i7, 8GB)' },
  { modelo: "NP750QFG-KB2CL,NP750XFG-KB4CL", nombre: "Galaxy Book3 360;Galaxy Book3" },
  { modelo: "NP960XFG-KC2CL", nombre: 'Galaxy Book3 Pro (16", i7, 16G)' },
  { modelo: "NP960XFG-KC2CL,NP960QFG-KA1CL", nombre: "Galaxy Book3 Pro;Galaxy Book3 Pro 360" },
];

// los que NO deben caer: otras generaciones y productos ajenos
const NO_BOOK3 = [
  { modelo: "NP730QED-KB1CL", nombre: 'Galaxy Book2 360 (13,3", i5, 8GB)' },
  { modelo: "NP750XGJ-KS4CL", nombre: 'Galaxy Book 4 (15,6", Intel® Core i5, 16GB)' },
  { modelo: "NP750XGJ-KS6CL", nombre: 'Galaxy Book4 (15.6", Intel® Core™ i5, 8GB)' },
  { modelo: "NP960QHA-KG1CL", nombre: "Galaxy Book5 Pro 360, Copilot+ PC" },
  { modelo: "NP740VJG-KA2CL", nombre: "Galaxy Book 6 (14'', Ultra 5, 16GB), Copilot+ PC" },
  { modelo: "NP960UJH-XG2CL", nombre: "Galaxy Book 6 Ultra (16'', Ultra 7, 32GB), Copilot+ PC" },
  { modelo: "SM-S948BZDJLTL", nombre: "Galaxy S26 Ultra (Exclusivo en Samsung.com)" },
  { modelo: "EF-DX715UBEGWW", nombre: "Galaxy Tab S9 Book Cover Keyboard" },
];

test("silencia todas las variantes Book3 del catalogo", () => {
  for (const p of BOOK3) assert.ok(estaSilenciado(p), `deberia silenciar: ${p.nombre} (${p.modelo})`);
});

test("no silencia Book2, Book4, Book5, Book 6 ni otros productos", () => {
  for (const p of NO_BOOK3) assert.ok(!estaSilenciado(p), `NO deberia silenciar: ${p.nombre} (${p.modelo})`);
});

test("silencia los SKU sueltos que apareceran al separar las fichas fusionadas", () => {
  // hoy viven dentro de un registro con coma; tras el arreglo saldran solos y
  // el nombre puede venir de la API, sin la palabra "Book3"
  const futuros = ["NP750QFG-KB2CL", "NP750XFG-KB4CL", "NP960QFG-KA1CL", "NP940XFG-KC2CL", "NP730QFG-KB2CL"];
  for (const modelo of futuros) {
    assert.ok(estaSilenciado({ modelo, nombre: "Galaxy Book" }), `deberia silenciar por codigo: ${modelo}`);
    assert.ok(estaSilenciado({ modelo, nombre: null }), `deberia silenciar sin nombre: ${modelo}`);
  }
});

test("silencia TODOS los tipos de aviso del producto silenciado", () => {
  for (const tipo of ["nuevo", "baja", "sube", "stock", "recuperado", "desaparecido"]) {
    assert.ok(estaSilenciado({ ...BOOK3[0], tipo }), `${tipo} deberia quedar silenciado`);
  }
});

test("no revienta con datos faltantes o basura", () => {
  for (const c of [{}, { modelo: null, nombre: null }, { modelo: "", nombre: "" }, { modelo: 123, nombre: {} }, null, undefined]) {
    assert.equal(typeof estaSilenciado(c), "boolean");
  }
});

test("el resumen cuenta los avisos silenciados por regla", () => {
  const cambios = [...BOOK3, ...NO_BOOK3];
  const r = resumirSilenciados(cambios);
  assert.equal(r.get("book3"), BOOK3.length);
});
