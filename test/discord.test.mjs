import { test } from "node:test";
import assert from "node:assert/strict";
import { notifyDiscord, notifyTecnico, armarMensajes } from "../src/discord.mjs";

function capturarEnvios() {
  const enviados = [];
  globalThis.fetch = async (url, opts) => {
    enviados.push(JSON.parse(opts.body).content);
    return { ok: true };
  };
  return enviados;
}

test("cada tipo de cambio muestra su precio de referencia y el link", async () => {
  const enviados = capturarEnvios();
  await notifyDiscord("https://fake.webhook", {
    totalRevisado: 100,
    errores: 0,
    changes: [
      { tipo: "baja", modelo: "M1", nombre: "Tele", precio: 80000, precioAnterior: 100000, categoria: "Televisores", url: "https://x/1" },
      { tipo: "sube", modelo: "M2", nombre: "Notebook", precio: 120000, precioAnterior: 100000, categoria: "Computadores", url: "https://x/2" },
      { tipo: "stock", modelo: "M3", nombre: "Reloj", disponible: true, disponibleAnterior: false, precio: 50000, categoria: "Relojes (Galaxy Watch)", url: "https://x/3" },
      { tipo: "nuevo", modelo: "M4", nombre: "Aspiradora", precio: 30000, categoria: "Aspiradoras", url: "https://x/4" },
      { tipo: "recuperado", modelo: "M5", nombre: "Micro", precio: 70000, categoria: "Microondas", url: "https://x/5" },
      { tipo: "desaparecido", modelo: "M6", nombre: "Horno", precioAnterior: 90000, categoria: "Cocina", url: "https://x/6" },
    ],
  });
  const texto = enviados.join("\n");
  assert.match(texto, /\$100\.000 → \*\*ahora: \$80\.000\*\*/);
  assert.match(texto, /−\$20\.000 · −20\.0%/); // diferencia en pesos y porcentaje
  assert.match(texto, /\+\$20\.000 · \+20\.0%/);
  assert.match(texto, /Precio actual: \*\*\$50\.000\*\*/); // stock muestra precio
  assert.match(texto, /\*\*\$30\.000\*\* \(primera vez/);
  assert.match(texto, /Volvió a aparecer.*\$70\.000/);
  assert.match(texto, /Último precio: \*\*\$90\.000\*\*/);
  for (let i = 1; i <= 6; i++) assert.ok(texto.includes(`https://x/${i}`), `falta el link ${i}`);
  assert.ok(!texto.includes("NaN"), "jamas debe aparecer NaN en un mensaje");
});

test("precio invalido se muestra como 'sin precio', nunca $NaN", async () => {
  const enviados = capturarEnvios();
  await notifyDiscord("https://fake.webhook", {
    totalRevisado: 10,
    errores: 0,
    changes: [{ tipo: "baja", modelo: "M1", nombre: "X", precio: NaN, precioAnterior: undefined, categoria: "Cocina", url: "https://x/1" }],
  });
  assert.ok(enviados[0].includes("sin precio"));
  assert.ok(!enviados[0].includes("NaN"));
});

test("muchos cambios se parten en varios mensajes bajo el limite de Discord", async () => {
  const enviados = capturarEnvios();
  const changes = [];
  for (let i = 0; i < 150; i++) {
    changes.push({ tipo: "nuevo", modelo: `SKU-${i}`, nombre: `Producto numero ${i}`, precio: 10000 + i, categoria: "Televisores", url: `https://x/${i}` });
  }
  await notifyDiscord("https://fake.webhook", { totalRevisado: 900, errores: 0, changes });
  assert.ok(enviados.length > 1, "deberia partirse en varios mensajes");
  for (const m of enviados) assert.ok(m.length <= 2000, "ningun mensaje puede superar 2000 caracteres");
  const texto = enviados.join("\n");
  for (let i = 0; i < 150; i++) assert.ok(texto.includes(`SKU-${i}`), `se perdio el cambio ${i}`);
});

test("sin cambios no se envia nada", async () => {
  const enviados = capturarEnvios();
  await notifyDiscord("https://fake.webhook", { totalRevisado: 900, errores: 3, changes: [] });
  assert.equal(enviados.length, 0);
});

test("sin webhook configurado no revienta", async () => {
  await notifyDiscord(undefined, { totalRevisado: 1, errores: 0, changes: [{ tipo: "nuevo", modelo: "M", precio: 1 }] });
  await notifyTecnico(undefined, "alerta");
});

test("notifyTecnico envia un unico mensaje recortado al limite", async () => {
  const enviados = capturarEnvios();
  await notifyTecnico("https://fake.webhook", "x".repeat(5000));
  assert.equal(enviados.length, 1);
  assert.ok(enviados[0].length <= 1900);
});

test("armarMensajes nunca corta una linea a la mitad", () => {
  const lineas = Array.from({ length: 50 }, (_, i) => `linea completa numero ${i} con bastante texto para llenar espacio rapidamente`);
  const mensajes = armarMensajes("encabezado", [["nuevo", lineas]]);
  const todo = mensajes.join("\n");
  for (const l of lineas) assert.ok(todo.includes(l));
});
