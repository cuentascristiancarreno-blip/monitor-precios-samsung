import { test } from "node:test";
import assert from "node:assert/strict";
import { integrarVariantes, esAccesorio } from "../src/catalogo.mjs";
import { componerTitulo } from "../src/titulo.mjs";
import { comparar } from "../src/comparar.mjs";

const TS = "2026-07-29T12:00:00.000Z";

const filaListado = {
  categoria: "Smartphones",
  subcategoria: "galaxy-s",
  nombre: "Galaxy S26 Ultra",
  variante: "256GB, Pink Gold",
  modelo: "SM-S948BZDJLTL", // OJO: el "modelo" del listado no es el SKU real
  url: "https://www.samsung.com/cl/smartphones/galaxy-s/galaxy-s26-ultra-pink-gold-256gb-sm-s948bzdjltl/",
};

const paginaFamilia = {
  categoria: "Familia (auto-descubierta)",
  subcategoria: null,
  nombre: null,
  variante: null,
  modelo: null,
  url: "https://www.samsung.com/cl/smartphones/galaxy-s/galaxy-s26-ultra/buy/",
};

const desdeDigitalData = {
  modelo: "SM-S948BZDJLTL",
  nombre: "Galaxy S26 Ultra (Exclusivo en Samsung.com)",
  precio: 1199990,
  moneda: "CLP",
  disponible: true,
  url: filaListado.url,
};

const desdeFamilia = {
  modelo: "SM-S948BZDJLTL",
  nombre: "Galaxy S26 Ultra 256 GB｜12 GB Pinkgold",
  precio: 1549990, // list_price: la pagina familia NO es autoritativa para precio
  moneda: "CLP",
  disponible: true,
  url: paginaFamilia.url + "?SM-S948BZDJLTL",
};

test("la variante del listado llega al registro (union por URL, no por 'modelo')", () => {
  const observado = integrarVariantes({}, filaListado, [desdeDigitalData], { via: "individual", timestamp: TS });
  assert.equal(observado["SM-S948BZDJLTL"].variante, "256GB, Pink Gold");
  assert.equal(observado["SM-S948BZDJLTL"].paginaOrigen, filaListado.url);
  assert.match(componerTitulo({ ...observado["SM-S948BZDJLTL"], modelo: "SM-S948BZDJLTL" }), /256GB · Pink Gold$/);
});

test("los placeholders del listado no se guardan como variante", () => {
  const observado = integrarVariantes({}, { ...filaListado, variante: "—" }, [desdeDigitalData], { timestamp: TS });
  assert.equal(observado["SM-S948BZDJLTL"].variante, null);
});

test("la pagina familia no pisa precio, stock ni categoria de la pagina especifica", () => {
  const observado = integrarVariantes({}, filaListado, [desdeDigitalData], { via: "individual", timestamp: TS });
  integrarVariantes(observado, paginaFamilia, [desdeFamilia], { via: "familia", timestamp: TS });
  const rec = observado["SM-S948BZDJLTL"];
  assert.equal(rec.precio, 1199990, "el precio autoritativo es el de la pagina individual");
  assert.equal(rec.categoria, "Smartphones");
  assert.equal(rec.paginaOrigen, filaListado.url);
  // pero el nombre rico de la familia se aprovecha para el titulo
  assert.equal(rec.nombreFamilia, "Galaxy S26 Ultra 256 GB｜12 GB Pinkgold");
  assert.match(componerTitulo({ ...rec, modelo: "SM-S948BZDJLTL" }), /12GB RAM/);
});

test("en el orden inverso (familia primero) tampoco se pierde nada", () => {
  const observado = integrarVariantes({}, paginaFamilia, [desdeFamilia], { via: "familia", timestamp: TS });
  assert.equal(observado["SM-S948BZDJLTL"].categoria, "Familia (auto-descubierta)");
  integrarVariantes(observado, filaListado, [desdeDigitalData], { via: "individual", timestamp: TS });
  const rec = observado["SM-S948BZDJLTL"];
  assert.equal(rec.precio, 1199990);
  assert.equal(rec.categoria, "Smartphones");
  assert.equal(rec.variante, "256GB, Pink Gold");
  assert.equal(rec.nombreFamilia, "Galaxy S26 Ultra 256 GB｜12 GB Pinkgold");
});

test("un nombre vacio nunca reemplaza a un nombre bueno ya capturado", () => {
  const observado = integrarVariantes({}, filaListado, [desdeDigitalData], { via: "individual", timestamp: TS });
  integrarVariantes(observado, { ...filaListado, categoria: "Smartphones" }, [{ ...desdeDigitalData, nombre: null }], {
    via: "individual",
    timestamp: TS,
  });
  assert.equal(observado["SM-S948BZDJLTL"].nombre, "Galaxy S26 Ultra (Exclusivo en Samsung.com)");
});

test("una variante sin SKU no entra al catalogo (la identidad es el SKU)", () => {
  const observado = integrarVariantes({}, filaListado, [{ ...desdeDigitalData, modelo: null }], { timestamp: TS });
  assert.deepEqual(observado, {});
});

test("el titulo jamas decide si un SKU entra al catalogo", () => {
  // sin nombre, sin variante y con un slug inservible: igual tiene que entrar,
  // porque si desaparece del observado comparar() lo declara desaparecido
  const entradaPelada = { categoria: null, subcategoria: null, variante: null, url: "https://www.samsung.com/cl/x/" };
  const observado = integrarVariantes({}, entradaPelada, [{ modelo: "SKU-RARO", nombre: null, precio: 100, disponible: null, url: "u" }], {
    timestamp: TS,
  });
  assert.ok(observado["SKU-RARO"], "el SKU tiene que estar en el catalogo");
  assert.equal(componerTitulo({ ...observado["SKU-RARO"], modelo: "SKU-RARO" }), "SKU-RARO");
});

test("lista vacia o nula no revienta", () => {
  assert.deepEqual(integrarVariantes({}, filaListado, [], { timestamp: TS }), {});
  assert.deepEqual(integrarVariantes({}, filaListado, undefined, { timestamp: TS }), {});
});

test("nombreFamilia repetido en nombre es el respaldo de la corrida siguiente", () => {
  // POR QUE se guarda dos veces el mismo texto (~15 KB por snapshot): el registro
  // entra por una pagina familia y en la corrida siguiente el mismo SKU puede
  // verse por su pagina individual, que trae el nombre pobre. Si nombreFamilia no
  // estuviera guardado, ahi se perderia la capacidad del titulo.
  const soloFamilia = integrarVariantes({}, paginaFamilia, [desdeFamilia], { via: "familia", timestamp: TS });
  const rec = soloFamilia["SM-S948BZDJLTL"];
  assert.equal(rec.nombreFamilia, rec.nombre, "la repeticion es a proposito");

  const { catalogo } = comparar({
    previo: soloFamilia,
    observado: { "SM-S948BZDJLTL": { ...desdeDigitalData, nombre: "Galaxy S26 Ultra (Exclusivo en Samsung.com)", nombreFamilia: null } },
    paginasFallidas: new Set(),
    corridaConfiable: true,
    timestamp: TS,
  });
  assert.equal(catalogo["SM-S948BZDJLTL"].nombreFamilia, "Galaxy S26 Ultra 256 GB｜12 GB Pinkgold");
  assert.match(componerTitulo({ ...catalogo["SM-S948BZDJLTL"], modelo: "SM-S948BZDJLTL" }), /256GB · 12GB RAM/);
});

test("esAccesorio reconoce todas las categorias de accesorios y ninguna otra", () => {
  for (const c of ["Accesorios móviles", "Accesorios TV", "Accesorios línea blanca", "Accesorios PC", "accesorios varios"]) {
    assert.equal(esAccesorio(c), true, c);
  }
  for (const c of ["Smartphones", "Televisores", "Familia (auto-descubierta)", "", null, undefined]) {
    assert.equal(esAccesorio(c), false, String(c));
  }
});
