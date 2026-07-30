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

// --- titulo enriquecido -------------------------------------------------------

const S26 = {
  modelo: "SM-S948BZDJLTL",
  nombre: "Galaxy S26 Ultra (Exclusivo en Samsung.com)",
  categoria: "Smartphones",
  variante: "256GB, Pink Gold",
  paginaOrigen: "https://www.samsung.com/cl/smartphones/galaxy-s/galaxy-s26-ultra-pink-gold-256gb-sm-s948bzdjltl/",
  url: "https://www.samsung.com/cl/smartphones/galaxy-s/galaxy-s26-ultra-pink-gold-256gb-sm-s948bzdjltl/",
};

test("el titulo del mensaje trae las caracteristicas y el SKU sigue visible", async () => {
  const enviados = capturarEnvios();
  await notifyDiscord("https://fake.webhook", {
    totalRevisado: 900,
    errores: 0,
    changes: [{ ...S26, tipo: "baja", precio: 1099990, precioAnterior: 1199990 }],
  });
  assert.match(enviados[0], /📱 \*\*Galaxy S26 Ultra \(Exclusivo en Samsung\.com\) · 256GB · Pink Gold\*\* \(SM-S948BZDJLTL\)/);
  assert.match(enviados[0], /−\$100\.000 · −8\.3%/, "la variacion en pesos y porcentaje sigue intacta");
  assert.ok(enviados[0].includes(S26.url), "el link sigue intacto");
});

test("ningun tipo de cambio imprime undefined ni NaN, con o sin datos de variante", async () => {
  const tipos = ["nuevo", "baja", "sube", "stock", "recuperado", "desaparecido"];
  const variantes = [undefined, null, "", "—", "(múltiples variantes en una página)", "256GB, Pink Gold"];
  for (const variante of variantes) {
    const enviados = capturarEnvios();
    const changes = tipos.map((tipo, i) => ({
      tipo,
      modelo: `SKU-${i}`,
      nombre: i % 2 === 0 ? "Galaxy X" : null, // la mitad sin nombre: solo SKU
      variante,
      categoria: "Smartphones",
      precio: tipo === "desaparecido" ? undefined : 100000,
      precioAnterior: ["baja", "sube", "desaparecido"].includes(tipo) ? 120000 : undefined,
      disponible: tipo === "stock" ? false : undefined,
      disponibleAnterior: tipo === "stock" ? true : undefined,
      url: "https://x/1",
      paginaOrigen: "https://www.samsung.com/cl/smartphones/galaxy-s/galaxy-s26-ultra-pink-gold-256gb-sku-1/",
    }));
    await notifyDiscord("https://fake.webhook", { totalRevisado: 10, errores: 0, changes });
    const texto = enviados.join("\n");
    assert.ok(!texto.includes("undefined"), `undefined con variante=${variante}: ${texto.slice(0, 300)}`);
    assert.ok(!texto.includes("NaN"), `NaN con variante=${variante}`);
    assert.ok(!/\*\*\*\*/.test(texto), "titulo vacio entre asteriscos");
    for (let i = 0; i < tipos.length; i++) assert.ok(texto.includes(`(SKU-${i})`), `falta el SKU ${i}`);
  }
});

test("un cambio armado desde el catalogo viejo (sin los campos nuevos) no imprime undefined", async () => {
  // primera corrida despues del deploy: desaparecido/recuperado se arman con el
  // registro que escribio la version anterior, que no tenia variante ni paginaOrigen
  const enviados = capturarEnvios();
  await notifyDiscord("https://fake.webhook", {
    totalRevisado: 10,
    errores: 0,
    changes: [
      { tipo: "desaparecido", modelo: "SKU-VIEJO", nombre: "Galaxy A17 5G", precioAnterior: 200000, categoria: "Smartphones", url: "https://x/1" },
      { tipo: "recuperado", modelo: "SKU-VIEJO2", nombre: "Galaxy A17 5G", precio: 200000, categoria: "Smartphones", url: "https://x/2" },
    ],
  });
  const texto = enviados.join("\n");
  assert.ok(!texto.includes("undefined") && !texto.includes("NaN"));
  assert.match(texto, /\*\*Galaxy A17 5G\*\* \(SKU-VIEJO\)/);
});

test("el markdown que venga en el nombre no rompe el formato del mensaje", async () => {
  const enviados = capturarEnvios();
  await notifyDiscord("https://fake.webhook", {
    totalRevisado: 1,
    errores: 0,
    changes: [{ tipo: "nuevo", modelo: "SKU-1", nombre: "SYSTEM A/C Acc.._ PC4NUNMAN *oferta*", precio: 1000, categoria: "Cocina", url: "https://x/1" }],
  });
  assert.ok(enviados[0].includes("\\_"), "el guion bajo va escapado");
  assert.ok(enviados[0].includes("\\*oferta\\*"), "los asteriscos van escapados");
  assert.match(enviados[0], /Precio: \*\*\$1\.000\*\*/, "el negrita del precio sigue funcionando");
});

test("con titulos largos reales los mensajes siguen bajo el limite y no explota la cantidad", async () => {
  const enviados = capturarEnvios();
  const changes = [];
  for (let i = 0; i < 150; i++) {
    changes.push({
      tipo: "baja",
      modelo: `SM-S948BZDJLT${i}`,
      nombre: "Lavadora Secadora 14Kg / 9Kg Bespoke AI con Estación de Limpieza Steam y AI Energy Mode",
      variante: "256GB, Pink Gold",
      categoria: "Lavado y secado",
      precio: 999990,
      precioAnterior: 1199990,
      paginaOrigen: "https://www.samsung.com/cl/washers-and-dryers/washer-dryers/bespoke-ai-14kg-9kg-white-wd14dg7b40bezs/",
      url: "https://www.samsung.com/cl/washers-and-dryers/washer-dryers/bespoke-ai-14kg-9kg-white-wd14dg7b40bezs/",
    });
  }
  await notifyDiscord("https://fake.webhook", { totalRevisado: 900, errores: 0, changes });
  for (const m of enviados) assert.ok(m.length <= 2000, "ningun mensaje puede superar 2000 caracteres");
  assert.ok(enviados.length <= 30, `demasiados mensajes para 150 cambios: ${enviados.length}`);
  const texto = enviados.join("\n");
  for (let i = 0; i < 150; i++) assert.ok(texto.includes(`SM-S948BZDJLT${i}`), `se perdio el cambio ${i}`);
});

test("los caracteres raros del catalogo sobreviven al mensaje", async () => {
  const enviados = capturarEnvios();
  await notifyDiscord("https://fake.webhook", {
    totalRevisado: 1,
    errores: 0,
    changes: [
      {
        tipo: "nuevo",
        modelo: "SM-F966BDBJCHO",
        nombre: "Galaxy Z Fold7 256 GB｜12 GB Azul Intenso",
        categoria: "Smartphones",
        precio: 1000000,
        url: "https://x/1",
      },
      { tipo: "nuevo", modelo: "LC32R500FHLXZS", nombre: 'Monitor Curvo 32” FHD Diseño sin bordes<br>  ', categoria: "Monitores", precio: 200000, url: "https://x/2" },
    ],
  });
  const texto = enviados.join("\n");
  assert.ok(texto.includes("Azul Intenso"));
  assert.ok(!texto.includes("｜"), "el pipe fullwidth se reemplaza por algo legible");
  assert.ok(!texto.includes("<br>"), "no se filtra HTML al mensaje");
  assert.ok(texto.includes("Diseño"));
});

// --- regresiones de la auditoria 2026-07-29 -----------------------------------

// cuenta los ** que abren/cierran negrita, ignorando los escapados (\*)
function negritasBalanceadas(texto) {
  return texto.split("\n").every((linea) => {
    const sinEscapados = linea.replace(/\\./g, "");
    return ((sinEscapados.match(/\*\*/g) || []).length % 2) === 0;
  });
}

test("una barra invertida al final del nombre no arrastra el resto del mensaje", async () => {
  // la barra invertida es el propio caracter de escape: sin escaparla, el ** de
  // cierre quedaba como asterisco literal y la negrita se comia el precio, el
  // link y los productos siguientes del mismo mensaje
  const enviados = capturarEnvios();
  await notifyDiscord("https://fake.webhook", {
    totalRevisado: 2,
    errores: 0,
    changes: [
      { tipo: "baja", modelo: "SM-X", nombre: "Galaxy Tab S10 FE 5G\\", categoria: "Tablets", precio: 100000, precioAnterior: 200000, url: "https://x/1" },
      { tipo: "baja", modelo: "SM-Y", nombre: "Galaxy S26", categoria: "Smartphones", precio: 100000, precioAnterior: 200000, url: "https://x/2" },
    ],
  });
  assert.ok(enviados[0].includes("\\\\"), "la barra invertida va escapada");
  assert.ok(negritasBalanceadas(enviados[0]), `negrita sin cerrar: ${enviados[0]}`);
  assert.match(enviados[0], /\*\*Galaxy S26\*\* \(SM-Y\)/, "el producto siguiente sigue en negrita propia");
});

test("un pipe en el nombre no crea un spoiler de Discord", async () => {
  const enviados = capturarEnvios();
  await notifyDiscord("https://fake.webhook", {
    totalRevisado: 1,
    errores: 0,
    changes: [{ tipo: "nuevo", modelo: "SM-Z", nombre: "Galaxy ||oculto|| Tab", categoria: "Tablets", precio: 1000, url: "https://x/1" }],
  });
  assert.ok(!/(?<!\\)\|\|/.test(enviados[0]), `spoiler sin escapar: ${enviados[0]}`);
  assert.ok(negritasBalanceadas(enviados[0]));
});

test("ninguna combinacion de markdown del sitio desbalancea la negrita", async () => {
  const nombres = ["a\\", "**a**", "_a_", "~~a~~", "`a`", "||a||", "\\*a", "a\\\\", "*_~`|\\", "Galaxy S26 \\"];
  for (const nombre of nombres) {
    const enviados = capturarEnvios();
    await notifyDiscord("https://fake.webhook", {
      totalRevisado: 1,
      errores: 0,
      changes: [
        { tipo: "baja", modelo: "SM-A", nombre, categoria: "Tablets", precio: 100, precioAnterior: 200, url: "https://x/1" },
        { tipo: "baja", modelo: "SM-B", nombre: "Producto siguiente", categoria: "Tablets", precio: 100, precioAnterior: 200, url: "https://x/2" },
      ],
    });
    assert.ok(negritasBalanceadas(enviados.join("\n")), `negrita rota con nombre=${JSON.stringify(nombre)}`);
    assert.ok(enviados.join("\n").includes("(SM-B)"), `se perdio el producto siguiente con nombre=${JSON.stringify(nombre)}`);
  }
});

test("el titulo del reclamo llega literal al mensaje, con SKU y sin ruido", async () => {
  const enviados = capturarEnvios();
  await notifyDiscord("https://fake.webhook", {
    totalRevisado: 1,
    errores: 0,
    changes: [{ ...S26, tipo: "baja", precio: 1099990, precioAnterior: 1199990 }],
  });
  assert.ok(
    enviados[0].includes("📱 **Galaxy S26 Ultra (Exclusivo en Samsung.com) · 256GB · Pink Gold** (SM-S948BZDJLTL)"),
    enviados[0],
  );
});

test("armarMensajes nunca corta una linea a la mitad", () => {
  const lineas = Array.from({ length: 50 }, (_, i) => `linea completa numero ${i} con bastante texto para llenar espacio rapidamente`);
  const mensajes = armarMensajes("encabezado", [["nuevo", lineas]]);
  const todo = mensajes.join("\n");
  for (const l of lineas) assert.ok(todo.includes(l));
});
