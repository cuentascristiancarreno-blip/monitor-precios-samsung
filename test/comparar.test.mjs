import { test } from "node:test";
import assert from "node:assert/strict";
import { comparar, UMBRAL_AUSENCIAS } from "../src/comparar.mjs";

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
