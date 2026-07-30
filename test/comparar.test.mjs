import { test } from "node:test";
import assert from "node:assert/strict";
import { comparar, UMBRAL_AUSENCIAS } from "../src/comparar.mjs";
import { componerTitulo } from "../src/titulo.mjs";

const TS = "2026-07-24T12:00:00.000Z";

function base(extra = {}) {
  return {
    modelo: "SKU-1",
    nombre: "Producto de prueba",
    precio: 100000,
    moneda: "CLP",
    disponible: true,
    url: "https://example.com/p",
    categoria: "Televisores",
    paginaOrigen: "https://example.com/p",
    ...extra,
  };
}

function correr({ previo = {}, observado = {}, fallidas = [], confiable = true }) {
  return comparar({
    previo,
    observado,
    paginasFallidas: new Set(fallidas),
    corridaConfiable: confiable,
    timestamp: TS,
  });
}

test("producto nunca visto genera cambio 'nuevo' y entra al catalogo", () => {
  const { catalogo, cambios } = correr({ observado: { "SKU-1": base() } });
  assert.equal(cambios.length, 1);
  assert.equal(cambios[0].tipo, "nuevo");
  assert.equal(cambios[0].precio, 100000);
  assert.equal(catalogo["SKU-1"].presencia, "activo");
  assert.equal(catalogo["SKU-1"].estadoStock, "disponible");
});

test("baja de precio incluye precio anterior y nuevo", () => {
  const { cambios } = correr({
    previo: { "SKU-1": base({ estadoStock: "disponible" }) },
    observado: { "SKU-1": base({ precio: 80000 }) },
  });
  assert.equal(cambios.length, 1);
  assert.deepEqual(
    { tipo: cambios[0].tipo, precio: cambios[0].precio, precioAnterior: cambios[0].precioAnterior },
    { tipo: "baja", precio: 80000, precioAnterior: 100000 },
  );
});

test("suba de precio se detecta igual que la baja", () => {
  const { cambios } = correr({
    previo: { "SKU-1": base({ estadoStock: "disponible" }) },
    observado: { "SKU-1": base({ precio: 120000 }) },
  });
  assert.equal(cambios[0].tipo, "sube");
  assert.equal(cambios[0].precioAnterior, 100000);
});

test("precio anterior corrupto (NaN) no genera sube/baja sino un unico 'nuevo'", () => {
  const { cambios } = correr({
    previo: { "SKU-1": base({ precio: NaN }) },
    observado: { "SKU-1": base({ precio: 90000 }) },
  });
  assert.equal(cambios.length, 1);
  assert.equal(cambios[0].tipo, "nuevo");
});

test("cambio de stock requiere 2 observaciones seguidas antes de notificar", () => {
  // 1a observacion distinta: sin alerta, queda pendiente
  const paso1 = correr({
    previo: { "SKU-1": base({ estadoStock: "disponible" }) },
    observado: { "SKU-1": base({ disponible: false }) },
  });
  assert.equal(paso1.cambios.length, 0);
  assert.equal(paso1.catalogo["SKU-1"].estadoStock, "disponible");
  assert.equal(paso1.catalogo["SKU-1"].stockPendiente, "agotado");

  // 2a observacion igual: ahora si alerta y compromete el estado
  const paso2 = correr({
    previo: paso1.catalogo,
    observado: { "SKU-1": base({ disponible: false }) },
  });
  assert.equal(paso2.cambios.length, 1);
  assert.equal(paso2.cambios[0].tipo, "stock");
  assert.equal(paso2.cambios[0].disponible, false);
  assert.equal(paso2.cambios[0].precio, 100000);
  assert.equal(paso2.catalogo["SKU-1"].estadoStock, "agotado");
});

test("un parpadeo de stock (cambia y vuelve) nunca alerta", () => {
  const paso1 = correr({
    previo: { "SKU-1": base({ estadoStock: "disponible" }) },
    observado: { "SKU-1": base({ disponible: false }) },
  });
  const paso2 = correr({
    previo: paso1.catalogo,
    observado: { "SKU-1": base({ disponible: true }) },
  });
  assert.equal(paso2.cambios.length, 0);
  assert.equal(paso2.catalogo["SKU-1"].estadoStock, "disponible");
  assert.equal(paso2.catalogo["SKU-1"].stockPendiente, null);
});

test("desaparicion requiere ausencia en corridas confiables consecutivas", () => {
  // ausencia 1: sin alerta
  const paso1 = correr({ previo: { "SKU-1": base({ estadoStock: "disponible" }) } });
  assert.equal(paso1.cambios.length, 0);
  assert.equal(paso1.catalogo["SKU-1"].presencia, "ausente");
  assert.equal(paso1.catalogo["SKU-1"].ausencias, 1);

  // ausencia 2 (= UMBRAL_AUSENCIAS): recien ahora alerta, una sola vez
  const paso2 = correr({ previo: paso1.catalogo });
  assert.equal(paso2.cambios.length, 1);
  assert.equal(paso2.cambios[0].tipo, "desaparecido");
  assert.equal(paso2.cambios[0].precioAnterior, 100000);
  assert.equal(paso2.catalogo["SKU-1"].presencia, "desaparecido");
  assert.equal(UMBRAL_AUSENCIAS, 2);

  // ausencia 3: no repite la alerta
  const paso3 = correr({ previo: paso2.catalogo });
  assert.equal(paso3.cambios.length, 0);
  assert.equal(paso3.catalogo["SKU-1"].presencia, "desaparecido");
});

test("si la pagina del producto fallo, la ausencia NO cuenta ni alerta", () => {
  const { catalogo, cambios } = correr({
    previo: { "SKU-1": base({ estadoStock: "disponible", ausencias: 1 }) },
    fallidas: ["https://example.com/p"],
  });
  assert.equal(cambios.length, 0);
  assert.equal(catalogo["SKU-1"].presencia, "error_verificacion");
  assert.equal(catalogo["SKU-1"].ausencias, 1); // no incremento
  assert.equal(catalogo["SKU-1"].precio, 100000); // conserva ultimo dato bueno
});

test("una corrida no confiable no incrementa ausencias de nadie", () => {
  const { catalogo, cambios } = correr({
    previo: { "SKU-1": base({ estadoStock: "disponible", ausencias: 1 }) },
    confiable: false,
  });
  assert.equal(cambios.length, 0);
  assert.equal(catalogo["SKU-1"].ausencias, 1);
  assert.equal(catalogo["SKU-1"].presencia, "error_verificacion");
});

test("producto que reaparece tras desaparicion confirmada se anuncia como recuperado", () => {
  const { catalogo, cambios } = correr({
    previo: { "SKU-1": base({ estadoStock: "disponible", presencia: "desaparecido", ausencias: 3, notificadoDesaparecido: true }) },
    observado: { "SKU-1": base({ precio: 95000 }) },
  });
  const tipos = cambios.map((c) => c.tipo).sort();
  assert.ok(tipos.includes("recuperado"));
  assert.ok(!tipos.includes("nuevo"), "no debe re-anunciarse como nuevo");
  assert.equal(catalogo["SKU-1"].presencia, "activo");
  assert.equal(catalogo["SKU-1"].notificadoDesaparecido, false);
  assert.equal(catalogo["SKU-1"].ausencias, 0);
});

test("producto que reaparece tras UNA ausencia no genera ninguna alerta", () => {
  const paso1 = correr({ previo: { "SKU-1": base({ estadoStock: "disponible" }) } });
  const paso2 = correr({
    previo: paso1.catalogo,
    observado: { "SKU-1": base() },
  });
  assert.equal(paso2.cambios.length, 0, "reaparicion tras ausencia corta debe ser silenciosa");
  assert.equal(paso2.catalogo["SKU-1"].presencia, "activo");
});

test("la categoria especifica no es pisada por una pagina familia generica", () => {
  const { catalogo } = correr({
    previo: { "SKU-1": base({ estadoStock: "disponible", categoria: "Smartphones" }) },
    observado: { "SKU-1": base({ categoria: "Familia (auto-descubierta)" }) },
  });
  assert.equal(catalogo["SKU-1"].categoria, "Smartphones");
});

// --- identidad: el nombre/titulo NUNCA puede decidir que cambio ---------------

test("cambiar el nombre de un SKU no genera ningun aviso (la identidad es el SKU)", () => {
  const { catalogo, cambios } = correr({
    previo: { "SKU-1": base({ estadoStock: "disponible", nombre: "Galaxy S26 Ultra (Exclusivo en Samsung.com)" }) },
    observado: { "SKU-1": base({ nombre: "Galaxy S26 Ultra 256 GB | 12 GB Pinkgold" }) },
  });
  assert.equal(cambios.length, 0, "renombrar no es novedad: Samsung renombro 59 SKU sin cambiar nada");
  assert.equal(catalogo["SKU-1"].presencia, "activo");
  assert.equal(catalogo["SKU-1"].nombre, "Galaxy S26 Ultra 256 GB | 12 GB Pinkgold");
});

test("cambiar variante/nombreFamilia tampoco genera avisos ni renombra el SKU", () => {
  const { catalogo, cambios } = correr({
    previo: { "SKU-1": base({ estadoStock: "disponible", variante: "256GB, Black" }) },
    observado: { "SKU-1": base({ variante: "256GB, Phantom Black", nombreFamilia: "X 256 GB|8 GB Negro" }) },
  });
  assert.equal(cambios.length, 0);
  assert.equal(catalogo["SKU-1"].variante, "256GB, Phantom Black");
});

test("el mismo producto con nombre distinto no aparece dos veces ni como 'nuevo'", () => {
  const paso1 = correr({ observado: { "SKU-1": base({ nombre: "Nombre A" }) } });
  const paso2 = correr({ previo: paso1.catalogo, observado: { "SKU-1": base({ nombre: "Nombre B" }) } });
  assert.equal(Object.keys(paso2.catalogo).length, 1);
  assert.equal(paso2.cambios.length, 0);
});

test("los datos del titulo se conservan si la corrida los observa vacios", () => {
  // caso real: el SKU se observa desde una pagina familia (sin fila en el
  // listado) y su variante llega en null; el titulo no puede degradarse
  const { catalogo } = correr({
    previo: { "SKU-1": base({ estadoStock: "disponible", variante: "256GB, Pink Gold", nombreFamilia: "X 256 GB|12 GB", nombre: "Bueno" }) },
    observado: { "SKU-1": base({ variante: null, nombreFamilia: null, nombre: null }) },
  });
  assert.equal(catalogo["SKU-1"].variante, "256GB, Pink Gold");
  assert.equal(catalogo["SKU-1"].nombreFamilia, "X 256 GB|12 GB");
  assert.equal(catalogo["SKU-1"].nombre, "Bueno");
});

test("los seis tipos de cambio llevan los datos que el titulo necesita", () => {
  const conDatos = (extra) => base({ variante: "256GB, Pink Gold", nombreFamilia: "X 256 GB|12 GB", ...extra });
  const recolectados = [];

  recolectados.push(...correr({ observado: { "SKU-1": conDatos() } }).cambios);
  recolectados.push(...correr({ previo: { "SKU-1": conDatos({ estadoStock: "disponible" }) }, observado: { "SKU-1": conDatos({ precio: 80000 }) } }).cambios);
  recolectados.push(...correr({ previo: { "SKU-1": conDatos({ estadoStock: "disponible" }) }, observado: { "SKU-1": conDatos({ precio: 120000 }) } }).cambios);
  recolectados.push(
    ...correr({
      previo: { "SKU-1": conDatos({ estadoStock: "disponible", stockPendiente: "agotado" }) },
      observado: { "SKU-1": conDatos({ disponible: false }) },
    }).cambios,
  );
  recolectados.push(
    ...correr({
      previo: { "SKU-1": conDatos({ estadoStock: "disponible", notificadoDesaparecido: true }) },
      observado: { "SKU-1": conDatos() },
    }).cambios,
  );
  recolectados.push(...correr({ previo: { "SKU-1": conDatos({ estadoStock: "disponible", ausencias: 1 }) } }).cambios);

  const tipos = new Set(recolectados.map((c) => c.tipo));
  for (const t of ["nuevo", "baja", "sube", "stock", "recuperado", "desaparecido"]) {
    assert.ok(tipos.has(t), `falta el tipo ${t}`);
  }
  for (const c of recolectados) {
    assert.equal(c.variante, "256GB, Pink Gold", `${c.tipo} sin variante`);
    assert.equal(c.nombreFamilia, "X 256 GB|12 GB", `${c.tipo} sin nombreFamilia`);
    assert.ok(c.nombre, `${c.tipo} sin nombre`);
    // lo que de verdad importa: los seis arman el mismo titulo completo
    assert.equal(componerTitulo(c), "Producto de prueba · 256GB · 12GB RAM · Pink Gold", `${c.tipo} con titulo pobre`);
  }
});

// --- regresiones de la auditoria 2026-07-29 -----------------------------------

test("el evento que se escribe en history.jsonl no lleva campos inertes", () => {
  // cada cambio se escribe como una linea de data/history.jsonl, que esta en git
  // y en un repo publico: mandar 5 campos por evento pesaba +203 bytes cada uno
  const { cambios } = correr({
    observado: { "SKU-1": base({ variante: "256GB, Pink Gold", subcategoria: "galaxy-s" }) },
  });
  const evento = cambios[0];
  assert.ok(!("subcategoria" in evento), "subcategoria no cambia ningun titulo: no se manda");
  assert.ok(!("paginaOrigen" in evento), "paginaOrigen igual a url: no se manda (componerTitulo cae a url)");
  assert.ok(!("nombreFamilia" in evento), "los campos vacios no se mandan");
  // y aun asi el titulo sale completo, porque componerTitulo usa change.url
  assert.equal(componerTitulo(evento), "Producto de prueba · 256GB · Pink Gold");
});

test("paginaOrigen SI viaja en el evento cuando difiere de la url", () => {
  // caso real: el SKU se vio en una pagina familia y su url propia es otra
  const { cambios } = correr({
    observado: {
      "SKU-1": base({
        nombre: "Galaxy A17 5G",
        url: "https://www.samsung.com/cl/smartphones/galaxy-a/galaxy-a17-5g/buy/?SKU-1",
        paginaOrigen: "https://www.samsung.com/cl/smartphones/galaxy-a/galaxy-a17-5g-phantom-black-128gb-sm-a176bzkoltl/",
      }),
    },
  });
  assert.equal(cambios[0].paginaOrigen, "https://www.samsung.com/cl/smartphones/galaxy-a/galaxy-a17-5g-phantom-black-128gb-sm-a176bzkoltl/");
  assert.equal(componerTitulo(cambios[0]), "Galaxy A17 5G · 128GB · Phantom Black");
});

test("un nombre nuevo que es el anterior recortado no degrada el titulo", () => {
  // el mismo SKU visto por su pagina individual trae "Galaxy Z Fold7" pelado; el
  // de la pagina familia traia la variante. Antes el titulo perdia el color de
  // una corrida a otra segun por donde se hubiera visto el producto.
  const rico = "Galaxy Z Fold7 256 GB｜12 GB Azul Intenso";
  const { catalogo, cambios } = correr({
    previo: { "SKU-1": base({ estadoStock: "disponible", nombre: rico, nombreFamilia: rico }) },
    observado: { "SKU-1": base({ nombre: "Galaxy Z Fold7", precio: 90000 }) },
  });
  assert.equal(catalogo["SKU-1"].nombre, rico, "se conserva el nombre que trae la variante");
  assert.equal(componerTitulo(cambios[0]), "Galaxy Z Fold7 256 GB / 12 GB Azul Intenso");

  // ...pero un nombre realmente distinto SI reemplaza al anterior
  const renombrado = correr({
    previo: { "SKU-1": base({ estadoStock: "disponible", nombre: "Galaxy Z Fold7 256 GB" }) },
    observado: { "SKU-1": base({ nombre: "Galaxy Z Fold7 (Exclusivo en Samsung.com)" }) },
  });
  assert.equal(renombrado.catalogo["SKU-1"].nombre, "Galaxy Z Fold7 (Exclusivo en Samsung.com)");
  assert.equal(renombrado.cambios.length, 0, "renombrar sigue sin ser una novedad");
});

test("conservar el nombre rico no crea ni duplica productos", () => {
  // blindaje de la regla de oro: la identidad es el SKU, el nombre no decide nada
  const paso1 = correr({ observado: { "SKU-1": base({ nombre: "Galaxy Z Fold7 256 GB Azul" }) } });
  const paso2 = correr({ previo: paso1.catalogo, observado: { "SKU-1": base({ nombre: "Galaxy Z Fold7" }) } });
  assert.equal(Object.keys(paso2.catalogo).length, 1);
  assert.equal(paso2.cambios.length, 0);
  assert.equal(paso2.catalogo["SKU-1"].presencia, "activo");
});

test("registros con esquema viejo (sin presencia/estadoStock) se migran sin alertas falsas", () => {
  const viejo = { modelo: "SKU-1", nombre: "P", precio: 100000, disponible: true, url: "u", categoria: "Cocina", paginaOrigen: "u" };
  const { catalogo, cambios } = correr({
    previo: { "SKU-1": viejo },
    observado: { "SKU-1": base({ categoria: "Cocina", precio: 100000 }) },
  });
  assert.equal(cambios.length, 0);
  assert.equal(catalogo["SKU-1"].estadoStock, "disponible");
  assert.equal(catalogo["SKU-1"].presencia, "activo");
});
