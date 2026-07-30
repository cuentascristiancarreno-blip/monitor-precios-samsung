// Pruebas de la lectura de especificaciones POR SKU (color, capacidad, RAM) que
// alimenta el titulo. Los datos de estas pruebas son capturas REALES tomadas en
// vivo el 2026-07-29 de samsung.com/cl (ver docs/auditoria-2026-07-24.md).
import { test } from "node:test";
import assert from "node:assert/strict";
import { filtrarEspecificacionesUtiles, componerTitulo } from "../src/titulo.mjs";
import { especificacionesDesdeHtml, extractFamilyVariants } from "../src/extract.mjs";
import { integrarVariantes } from "../src/catalogo.mjs";
import { comparar } from "../src/comparar.mjs";

// captura literal del S26 Ultra 256GB Pink Gold (el caso que reclamo el operador)
const ESPEC_S26 = {
  Color: "Oro rosa",
  "Cantidad de SIMs": "Dual SIM",
  Almacenamiento: "256 GB",
  RAM: "12 GB",
  "Velocidad CPU": "4.74GHz, 3.6GHz",
  "Tipo de CPU": "Octa-Core",
  "Tamaño Pantalla Principal": '174.9mm (rectángulo completo de 6.9") / 171.4mm (esquinas redondeadas de 6.7")',
  "Memoria_(GB)": "12",
  "Almacenamiento (GB)": "256",
  "Almacenamiento Disponible (GB)": "224.5",
  "Capacidad de batería (mAh, típica)": "5000",
};

test("el filtro deja solo las 4 llaves canonicas que el titulo sabe usar", () => {
  const utiles = filtrarEspecificacionesUtiles(ESPEC_S26);
  // 11 llaves de Samsung entran, 3 canonicas salen (este producto no informa tamaño util)
  assert.deepEqual(utiles, { color: "Oro rosa", almacenamiento: "256 GB", ram: "12 GB" });
  assert.ok(!("Velocidad CPU" in utiles), "la velocidad de CPU no sirve para el titulo");
  assert.ok(!("Tamaño Pantalla Principal" in utiles), "el largo en mm de la pantalla no es el tamaño del producto");
});

test("no se guarda el mismo dato dos veces con distinto nombre de Samsung", () => {
  // captura real del TV F6000: publica la medida como "tamaño" y "Tamaño de pantalla"
  assert.deepEqual(filtrarEspecificacionesUtiles({ tamaño: '40"', "Tamaño de pantalla": '40"' }), { tamano: '40"' });
});

test("el caso reclamado por el operador queda con capacidad, RAM y color", () => {
  const titulo = componerTitulo({
    modelo: "SM-S948BZDJLTL",
    nombre: "Galaxy S26 Ultra (Exclusivo en Samsung.com)",
    categoria: "Smartphones",
    especificaciones: filtrarEspecificacionesUtiles(ESPEC_S26),
  });
  assert.equal(titulo, "Galaxy S26 Ultra (Exclusivo en Samsung.com) · 256GB · 12GB RAM · Oro rosa");
});

test("las especificaciones por SKU le ganan al slug y al listado", () => {
  // el slug dice pink-gold-256gb y el listado "256GB, Pink Gold"; el sitio dice
  // "Oro rosa" y ademas aporta la RAM, que ninguna de las otras fuentes tiene
  const titulo = componerTitulo({
    modelo: "SM-S948BZDJLTL",
    nombre: "Galaxy S26 Ultra (Exclusivo en Samsung.com)",
    categoria: "Smartphones",
    variante: "256GB, Pink Gold",
    paginaOrigen: "https://www.samsung.com/cl/smartphones/galaxy-s/galaxy-s26-ultra-pink-gold-256gb-sm-s948bzdjltl/",
    especificaciones: filtrarEspecificacionesUtiles(ESPEC_S26),
  });
  assert.match(titulo, /12GB RAM/);
  assert.equal((titulo.match(/256GB/g) || []).length, 1, "la capacidad no se repite entre fuentes");
});

test("las memorias en MB de los wearables no ensucian el titulo", () => {
  // captura real del Galaxy Fit3: "16 MB" de RAM en una pulsera no es un dato de
  // compra, y "256 MB" de storage tampoco
  const espec = filtrarEspecificacionesUtiles({ Color: "Pink Gold", "Memory (MB)": "16 MB", "Storage (MB)": "256 MB" });
  const titulo = componerTitulo({ modelo: "SM-R390NIDACHO", nombre: "Galaxy Fit3", categoria: "Relojes (Galaxy Watch)", especificaciones: espec });
  assert.equal(titulo, "Galaxy Fit3 · Pink Gold");
  assert.ok(!/MB/.test(titulo));
});

test("la RAM en GB si aparece, y etiquetada", () => {
  const espec = filtrarEspecificacionesUtiles({ "Memoria_(GB)": "8", "Almacenamiento (GB)": "256" });
  const titulo = componerTitulo({ modelo: "SM-A366BZKQ", nombre: "Galaxy A36", categoria: "Smartphones", especificaciones: espec });
  assert.match(titulo, /8GB RAM/);
  assert.ok(!/· 8GB ·/.test(titulo), "la RAM nunca puede confundirse con almacenamiento");
});

test("no se repite lo que el nombre ya dice", () => {
  // captura real del TV F6000: el sitio publica tamaño 40" y el nombre ya lo trae
  const espec = filtrarEspecificacionesUtiles({ tamaño: '40"', "Tamaño de pantalla": '40"' });
  const titulo = componerTitulo({ modelo: "UN40F6000FGXZS", nombre: '40" Full HD F6000 Smart TV (2025)', categoria: "Televisores", especificaciones: espec });
  assert.equal(titulo, '40" Full HD F6000 Smart TV (2025)');
});

test("valores hostiles del sitio no ensucian ni rompen el titulo", () => {
  const hostiles = [
    { Color: "★★★" },
    { Color: "x".repeat(200) },
    { Almacenamiento: "sin dato" },
    { RAM: {} },
    { RAM: [] },
    { Color: null },
    { Color: "" },
    { "": "Gris" },
    { Color: "**Negro**" },
  ];
  for (const espec of hostiles) {
    const filtrado = filtrarEspecificacionesUtiles(espec);
    const titulo = componerTitulo({ modelo: "SKU", nombre: "Producto", categoria: "Cocina", especificaciones: filtrado });
    assert.ok(titulo && !/undefined|NaN|null|\[object/.test(titulo), `titulo sucio con ${JSON.stringify(espec)}: ${titulo}`);
    assert.equal(componerTitulo({ modelo: "SKU", nombre: titulo, categoria: "Cocina", especificaciones: filtrado }), titulo, "idempotencia");
  }
});

test("un diccionario vacio o basura devuelve null, no un objeto inutil", () => {
  assert.equal(filtrarEspecificacionesUtiles({}), null);
  assert.equal(filtrarEspecificacionesUtiles(null), null);
  assert.equal(filtrarEspecificacionesUtiles("texto"), null);
  assert.equal(filtrarEspecificacionesUtiles([1, 2]), null);
  assert.equal(filtrarEspecificacionesUtiles({ "Capacidad de batería": "5000" }), null);
});

// ---- lectura desde el HTML de una pagina familia (sin navegador) -------------

const HTML_FAMILIA = `<html><body>
<input type="hidden" id="BV-buyingOptionData" value="{&#34;SM-A1&#34;:{&#34;Color&#34;:&#34;Negro&#34;,&#34;Almacenamiento&#34;:&#34;128 GB &#34;},&#34;SM-A2&#34;:{&#34;Color&#34;:&#34;Azul&#34;,&#34;Almacenamiento&#34;:&#34;256 GB &#34;}}">
<script type="application/ld+json">{"@type":"ProductGroup","hasVariant":[
 {"@type":"Product","sku":"SM-A1","name":"Galaxy A","offers":{"@type":"Offer","url":"https://x/buy/?SM-A1","price":"100000","priceCurrency":"CLP"}},
 {"@type":"Product","sku":"SM-A2","name":"Galaxy A","offers":{"@type":"Offer","url":"https://x/buy/?SM-A2","price":"150000","priceCurrency":"CLP"}}]}</script>
</body></html>`;

test("el diccionario del buy-box se lee del HTML servido, escapado y por SKU", () => {
  assert.deepEqual(especificacionesDesdeHtml(HTML_FAMILIA, "SM-A1"), { Color: "Negro", Almacenamiento: "128 GB " });
  assert.deepEqual(especificacionesDesdeHtml(HTML_FAMILIA, "SM-A2"), { Color: "Azul", Almacenamiento: "256 GB " });
  assert.deepEqual(especificacionesDesdeHtml(HTML_FAMILIA, "SM-NO-EXISTE"), {});
  assert.deepEqual(especificacionesDesdeHtml("<html></html>", "SM-A1"), {});
  assert.deepEqual(especificacionesDesdeHtml('<input id="BV-buyingOptionData" value="{roto">', "SM-A1"), {});
  assert.deepEqual(especificacionesDesdeHtml(HTML_FAMILIA, "constructor"), {}, "un SKU heredado del prototipo no devuelve una funcion");
});

test("cada variante de una pagina familia recibe SUS propias especificaciones", () => {
  const variantes = extractFamilyVariants(HTML_FAMILIA);
  assert.equal(variantes.length, 2);
  const porSku = Object.fromEntries(variantes.map((v) => [v.modelo, v]));
  assert.equal(porSku["SM-A1"].especificaciones.color, "Negro");
  assert.equal(porSku["SM-A2"].especificaciones.color, "Azul");
  // dos SKU con el MISMO nombre que antes eran indistinguibles en Discord
  const t1 = componerTitulo({ ...porSku["SM-A1"], categoria: "Smartphones" });
  const t2 = componerTitulo({ ...porSku["SM-A2"], categoria: "Smartphones" });
  assert.notEqual(t1, t2);
  assert.match(t1, /128GB · Negro/);
  assert.match(t2, /256GB · Azul/);
});

// ---- viaje del dato por el resto del sistema --------------------------------

test("las especificaciones sobreviven la integracion al catalogo y la comparacion", () => {
  const entry = { url: "https://x/p", categoria: "Smartphones", subcategoria: "galaxy-s", variante: "256GB, Pink Gold" };
  const variants = [{ modelo: "SKU-1", nombre: "Galaxy X", precio: 100000, disponible: true, url: "https://x/p", especificaciones: { Color: "Oro rosa", RAM: "12 GB" } }];
  const observado = integrarVariantes({}, entry, variants, { timestamp: "T1" });
  assert.deepEqual(observado["SKU-1"].especificaciones, { Color: "Oro rosa", RAM: "12 GB" });

  // llegan a los avisos de Discord: se arma el titulo desde el cambio, no del registro
  const { catalogo, cambios } = comparar({
    previo: {},
    observado,
    paginasFallidas: new Set(),
    corridaConfiable: true,
    timestamp: "T1",
  });
  assert.equal(cambios.length, 1);
  // capacidad del listado + RAM y color del sitio, cada campo de su mejor fuente:
  // el color oficial "Oro rosa" le gana al "Pink Gold" del listado sin duplicarse
  assert.equal(componerTitulo(cambios[0]), "Galaxy X · 256GB · 12GB RAM · Oro rosa");
  assert.deepEqual(catalogo["SKU-1"].especificaciones, { Color: "Oro rosa", RAM: "12 GB" });
});

test("si una corrida no logra leer las especificaciones, no se pierden las anteriores", () => {
  const previo = {
    "SKU-1": {
      modelo: "SKU-1", nombre: "Galaxy X", precio: 100000, disponible: true, url: "https://x/p",
      categoria: "Smartphones", paginaOrigen: "https://x/p", estadoStock: "disponible",
      especificaciones: { Color: "Oro rosa", RAM: "12 GB" },
    },
  };
  // la pagina cargo y dio precio, pero el bloque de especificaciones no estaba
  const observado = { "SKU-1": { ...previo["SKU-1"], precio: 90000, especificaciones: null } };
  const { catalogo, cambios } = comparar({ previo, observado, paginasFallidas: new Set(), corridaConfiable: true, timestamp: "T2" });
  assert.deepEqual(catalogo["SKU-1"].especificaciones, { Color: "Oro rosa", RAM: "12 GB" });
  assert.match(componerTitulo(cambios[0]), /12GB RAM · Oro rosa/, "el aviso de baja de precio conserva el titulo rico");
});

test("una pagina familia le presta especificaciones a un SKU ya capturado sin pisarle el precio", () => {
  const individual = { url: "https://x/p", categoria: "Smartphones", subcategoria: "galaxy-s" };
  const observado = integrarVariantes({}, individual, [{ modelo: "SKU-1", nombre: "Galaxy Z Fold7", precio: 1000, disponible: true, url: "https://x/p" }], { timestamp: "T1" });
  const familia = { url: "https://x/fam/buy/", categoria: "Familia (auto-descubierta)" };
  integrarVariantes(observado, familia, [{ modelo: "SKU-1", nombre: "Galaxy Z Fold7 512GB", precio: 9999, disponible: true, url: "https://x/fam/buy/", especificaciones: { color: "Azul Intenso" } }], { via: "familia", timestamp: "T1" });
  assert.equal(observado["SKU-1"].precio, 1000, "el precio de la pagina autoritativa no se toca");
  assert.equal(observado["SKU-1"].categoria, "Smartphones", "la categoria especifica no se pisa");
  assert.equal(observado["SKU-1"].especificaciones.color, "Azul Intenso");
});

test("un SKU entra al catalogo aunque la lectura de especificaciones haya fallado", () => {
  const observado = integrarVariantes({}, { url: "https://x/p", categoria: "Cocina" }, [{ modelo: "SKU-9", nombre: "Horno", precio: 100, disponible: true, url: "https://x/p", especificaciones: null }], { timestamp: "T1" });
  assert.ok(observado["SKU-9"], "la identidad es el SKU: nunca depende del titulo");
  assert.equal(observado["SKU-9"].especificaciones, null);
});
