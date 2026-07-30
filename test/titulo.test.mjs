import { test } from "node:test";
import assert from "node:assert/strict";
import { componerTitulo, limpiarNombre, varianteUtil, slugDe, normalizar } from "../src/titulo.mjs";

// Casos tomados de data/latest.json y src/seed.json reales (2026-07-29).
const S26_ULTRA = {
  modelo: "SM-S948BZDJLTL",
  nombre: "Galaxy S26 Ultra (Exclusivo en Samsung.com)",
  categoria: "Smartphones",
  subcategoria: "galaxy-s",
  variante: "256GB, Pink Gold",
  paginaOrigen: "https://www.samsung.com/cl/smartphones/galaxy-s/galaxy-s26-ultra-pink-gold-256gb-sm-s948bzdjltl/",
};

test("el caso del reclamo queda identificable: capacidad y color en el titulo", () => {
  const t = componerTitulo(S26_ULTRA);
  assert.equal(t, "Galaxy S26 Ultra (Exclusivo en Samsung.com) · 256GB · Pink Gold");
  assert.ok(t.startsWith(S26_ULTRA.nombre), "el nombre original se conserva entero");
});

test("dos SKU del mismo modelo dejan de tener el mismo titulo", () => {
  const otro = {
    ...S26_ULTRA,
    modelo: "SM-S948BZSKLTL",
    variante: "512GB, Silver",
    paginaOrigen: "https://www.samsung.com/cl/smartphones/galaxy-s/galaxy-s26-ultra-silver-shadow-512gb-sm-s948bzskltl/",
  };
  assert.notEqual(componerTitulo(S26_ULTRA), componerTitulo(otro));
  assert.equal(componerTitulo(otro), "Galaxy S26 Ultra (Exclusivo en Samsung.com) · 512GB · Silver Shadow");
});

test("composicion por tipo: smartphone, tablet, reloj, notebook, TV, linea blanca", () => {
  // tablet: capacidad + color desde el slug
  assert.equal(
    componerTitulo({
      modelo: "SM-X133NZAAL07",
      nombre: "Galaxy Tab A11",
      categoria: "Tablets",
      variante: "64GB, Gray",
      paginaOrigen: "https://www.samsung.com/cl/tablets/galaxy-tab-a/galaxy-tab-a11-gray-64gb-sm-x133nzaal07/",
    }),
    "Galaxy Tab A11 · 64GB · Gray",
  );

  // reloj: el tamano de caja va en mm, no en pulgadas
  assert.equal(
    componerTitulo({
      modelo: "SM-L330NDAALTA",
      nombre: "Galaxy Watch8",
      categoria: "Relojes (Galaxy Watch)",
      paginaOrigen: "https://www.samsung.com/cl/watches/galaxy-watch/galaxy-watch8-44mm-graphite-bluetooth-sm-l330ndaalta/buy/",
    }),
    "Galaxy Watch8 · 44mm · Graphite",
  );

  // notebook: el nombre ya trae pulgadas, CPU y RAM -> solo aporta el SSD
  assert.equal(
    componerTitulo({
      modelo: "NP750XGJ-KS4CL",
      nombre: 'Galaxy Book 4 (15,6", Intel® Core i5, 16GB)',
      categoria: "Computadores",
      variante: "16GB, 1TB",
      paginaOrigen: "https://www.samsung.com/cl/computers/galaxy-book/galaxy-book4-15-6-inch-13th-core-5-16gb-1tb-np750xgj-ks4cl/",
    }),
    'Galaxy Book 4 (15,6", Intel® Core i5, 16GB) · 1TB',
  );

  // notebook sin especificaciones en el nombre: aporta las cuatro
  assert.equal(
    componerTitulo({
      modelo: "NP960QHA-KG1CL",
      nombre: "Galaxy Book5 Pro 360, Copilot+ PC",
      categoria: "Computadores",
      paginaOrigen: "https://www.samsung.com/cl/computers/galaxy-book/galaxy-book5-pro-360-16-inch-ultra-7-16gb-512gb-np960qha-kg1cl/",
    }),
    'Galaxy Book5 Pro 360, Copilot+ PC · 16" · 512GB · 16GB RAM · Ultra 7',
  );

  // TV: las pulgadas ya estan en el nombre, no se repiten
  assert.equal(
    componerTitulo({
      modelo: "UN40F6000FGXZS",
      nombre: '40" Full HD F6000 Smart TV (2025)',
      categoria: "Televisores",
      variante: '40"',
      paginaOrigen: "https://www.samsung.com/cl/tvs/full-hd-tv/f6000-40-inch-un40f6000fgxzs/",
    }),
    '40" Full HD F6000 Smart TV (2025)',
  );

  // linea blanca: solo el color; los kg del slug NO se usan (contradicen al nombre)
  assert.equal(
    componerTitulo({
      modelo: "DV90TA040BE/ZS",
      nombre: "Secadora 9Kg Por Bomba de Calor",
      categoria: "Lavado y secado",
      variante: "White",
      paginaOrigen: "https://www.samsung.com/cl/washers-and-dryers/dryers/dv5000t-front-loading-optimaldry-8kg-white-dv90ta040be-zs/",
    }),
    "Secadora 9Kg Por Bomba de Calor · White",
  );
});

test("la RAM aparece etiquetada cuando la fuente la trae (diccionario por SKU)", () => {
  const t = componerTitulo({
    ...S26_ULTRA,
    especificaciones: { Color: "Oro rosa", "Cantidad de SIMs": "Dual SIM", Almacenamiento: "256 GB ", RAM: "12 GB" },
  });
  assert.equal(t, "Galaxy S26 Ultra (Exclusivo en Samsung.com) · 256GB · 12GB RAM · Oro rosa");
  assert.ok(!/12GB · /.test(t.replace(" 12GB RAM", "")), "la RAM nunca se muestra sin etiqueta");
});

test("el acordeon/BV manda sobre el slug y el slug sobre el seed", () => {
  // el seed dice "Black" y el slug dice "Phantom Black": gana el slug (mas preciso)
  assert.equal(
    componerTitulo({
      modelo: "SM-A176BZKOLTL",
      nombre: "Galaxy A17 5G",
      categoria: "Smartphones",
      variante: "128GB, Black",
      paginaOrigen: "https://www.samsung.com/cl/smartphones/galaxy-a/galaxy-a17-5g-phantom-black-128gb-sm-a176bzkoltl/",
    }),
    "Galaxy A17 5G · 128GB · Phantom Black",
  );
  // y el diccionario por SKU manda sobre el slug
  assert.match(
    componerTitulo({
      modelo: "SM-A176BZKOLTL",
      nombre: "Galaxy A17 5G",
      categoria: "Smartphones",
      variante: "128GB, Black",
      especificaciones: { Color: "Negro", Almacenamiento: "256 GB" },
      paginaOrigen: "https://www.samsung.com/cl/smartphones/galaxy-a/galaxy-a17-5g-phantom-black-128gb-sm-a176bzkoltl/",
    }),
    /256GB · Negro$/,
  );
});

test("el nombre de la pagina familia aporta capacidad y RAM cuando el nombre propio no las tiene", () => {
  assert.equal(
    componerTitulo({
      modelo: "SM-S731BZKKLTL",
      nombre: "Galaxy S25 FE",
      categoria: "Smartphones",
      nombreFamilia: "Galaxy S25 FE 256 GB｜8 GB Jetblack",
      paginaOrigen: "https://www.samsung.com/cl/smartphones/galaxy-s/galaxy-s25-fe-jetblack-256gb-sm-s731bzkkltl/buy/",
    }),
    "Galaxy S25 FE · 256GB · 8GB RAM · Jet Black",
  );
});

test("nunca duplica lo que el nombre ya dice, ni en castellano", () => {
  const yaCompleto = componerTitulo({
    modelo: "SM-A366EZKGLTL",
    nombre: "Galaxy A36 256GB｜8GB Grafito increíble",
    categoria: "Smartphones",
    variante: "256GB, Graphite",
    paginaOrigen: "https://www.samsung.com/cl/smartphones/galaxy-a/galaxy-a36-graphite-256gb-sm-a366ezkgltl/",
  });
  // el pipe del nombre se traduce a " / ", NO al " · " de las caracteristicas
  assert.equal(yaCompleto, "Galaxy A36 256GB / 8GB Grafito increíble");
  assert.ok(!/Graphite/.test(yaCompleto), "'Grafito' en el nombre ya cubre 'Graphite'");
  assert.equal((yaCompleto.match(/256GB/g) || []).length, 1);

  // "Gris" en el nombre cubre al "silver" del slug
  assert.equal(
    componerTitulo({
      modelo: "RS57DG4000M9ZS",
      nombre: "Refrigerador Side by Side 564L Gris",
      categoria: "Refrigeradores",
      paginaOrigen: "https://www.samsung.com/cl/refrigerators/side-by-side/rs5000dg-564l-silver-rs57dg4000m9zs/",
    }),
    "Refrigerador Side by Side 564L Gris",
  );
});

test("la deduplicacion usa limite de palabra: 'Bluetooth' no es el color 'Blue'", () => {
  const t = componerTitulo({
    modelo: "SM-L330NZBACHO",
    nombre: "Galaxy Watch8 (Bluetooth, 44 mm)",
    categoria: "Relojes (Galaxy Watch)",
    paginaOrigen: "https://www.samsung.com/cl/watches/galaxy-watch/galaxy-watch8-44mm-blue-bluetooth-sm-l330nzbacho/",
  });
  assert.match(t, /· Blue$/);
});

test("productos combinados: dos colores en el slug -> ninguno; uno solo y sin color en el nombre -> se usa", () => {
  // bundle con el color del telefono Y el del regalo: no se arriesga
  const bundle = componerTitulo({
    modelo: "F-SMA27R90NZS",
    nombre: "Samsung Galaxy A27 5G + Fit3",
    categoria: "Smartphones",
    paginaOrigen: "https://www.samsung.com/cl/smartphones/galaxy-a/bundle-a27-blue-128gb-fit3-white-f-sma27r90nzs/",
  });
  assert.equal(bundle, "Samsung Galaxy A27 5G + Fit3 · 128GB");

  // combo con un solo color en el slug y ninguno en el nombre: si se usa
  assert.equal(
    componerTitulo({
      modelo: "SM-P613NZBWCHO",
      nombre: 'Galaxy Tab S6 Lite + Book Cover 2022 (10.4", WIFI)',
      categoria: "Tablets",
      paginaOrigen: "https://www.samsung.com/cl/tablets/galaxy-tab-s/galaxy-tab-s6-lite-blue-128gb-sm-p613nzbwcho/buy/",
    }),
    'Galaxy Tab S6 Lite + Book Cover 2022 (10.4", WIFI) · 128GB · Blue',
  );

  // combo cuyo nombre ya menciona un color: no se agrega otro
  assert.equal(
    componerTitulo({
      modelo: "F-SMR540EP240",
      nombre: "Galaxy Buds4 + Wireless Charger Pad (15W) P2400 Black",
      categoria: "Audio y Galaxy Buds",
      paginaOrigen: "https://www.samsung.com/cl/audio-sound/galaxy-buds/combo-buds-white-acc-f-smr540ep240/",
    }),
    "Galaxy Buds4 + Wireless Charger Pad (15W) P2400 Black",
  );
});

test("las pulgadas solo se agregan donde el tamano de pantalla es la caracteristica", () => {
  // refrigerador con pantalla Family Hub: el 32" del slug NO es del producto
  assert.equal(
    componerTitulo({
      modelo: "RF29DB9950QDZS",
      nombre: "Refrigerador Bespoke AI 4-Door French Door Family Hub 699L",
      categoria: "Refrigeradores",
      paginaOrigen: "https://www.samsung.com/cl/refrigerators/french-door/bespoke-4-door-flex-32-inch-family-hub-rf29db9950qdzs/",
    }),
    "Refrigerador Bespoke AI 4-Door French Door Family Hub 699L",
  );
  // pantalla profesional sin pulgadas en el nombre: si se agregan
  assert.equal(
    componerTitulo({
      modelo: "LH85WMBWLGCXZA",
      nombre: "Pantalla interactiva Flip Pro WM85B",
      categoria: "Signage",
      paginaOrigen: "https://www.samsung.com/cl/business/displays/flip/wm85b-85-inch-lh85wmbwlgcxza/",
    }),
    'Pantalla interactiva Flip Pro WM85B · 85"',
  );
});

test("registros que fusionan varios productos no se enriquecen", () => {
  const t = componerTitulo({
    modelo: "NP750QFG-KB2CL,NP750XFG-KB4CL",
    nombre: "Galaxy Book3 360;Galaxy Book3",
    categoria: "Familia (auto-descubierta)",
    paginaOrigen: "https://www.samsung.com/cl/computers/galaxy-book/galaxy-book3-360/buy/",
  });
  assert.equal(t, "Galaxy Book3 360 / Galaxy Book3");
  assert.ok(!/GB|"|·/.test(t.replace(" / ", "")), "no inventa una capacidad ni un color para 2 productos");
});

test("productos sin variante ni datos en el slug devuelven el nombre tal cual", () => {
  const sinNada = {
    modelo: "F-2KHX1PKHX1PK",
    nombre: "Multi Split Wind-Free, Inverter, Wi-Fi, Frío and Calor 1 x 9000 + 1 x 12000 Btu/hr",
    categoria: "Aire acondicionado",
    variante: "—",
    paginaOrigen: "https://www.samsung.com/cl/air-conditioners/ac-multisplit-with-wifi-kit-f-2khx1pkhx1pk/",
  };
  assert.equal(componerTitulo(sinNada), sinNada.nombre);
  assert.equal(componerTitulo({ ...sinNada, variante: "(múltiples variantes en una página)" }), sinNada.nombre);
});

test("nunca devuelve vacio, undefined ni NaN", () => {
  const basura = [
    {},
    { modelo: "SKU-1" },
    { nombre: "Solo nombre" },
    { modelo: "SKU-1", nombre: null, variante: undefined, paginaOrigen: undefined },
    { modelo: "SKU-1", nombre: "X", variante: "—", nombreFamilia: null, paginaOrigen: "" },
    { modelo: "SKU-1", nombre: "X", variante: NaN, especificaciones: null },
    { modelo: "SKU-1", nombre: "X", especificaciones: { Color: undefined, RAM: NaN, Almacenamiento: "—" } },
    { modelo: "SKU-1", nombre: "X", especificaciones: [] },
    { modelo: "SKU-1", nombre: "X", paginaOrigen: "no-es-una-url" },
    { modelo: 12345, nombre: 678 },
    undefined,
    null,
  ];
  for (const p of basura) {
    const t = componerTitulo(p);
    assert.equal(typeof t, "string");
    assert.ok(t.trim().length > 0, `titulo vacio para ${JSON.stringify(p)}`);
    assert.ok(!/undefined|NaN|\[object/.test(t), `titulo con basura: ${t}`);
  }
  assert.equal(componerTitulo({ modelo: "SKU-1", nombre: "" }), "SKU-1", "sin nombre queda el SKU");
  assert.equal(componerTitulo({}), "Producto sin identificar");
});

test("es idempotente: aplicarla sobre su propia salida no cambia nada", () => {
  const casos = [
    S26_ULTRA,
    { ...S26_ULTRA, especificaciones: { Color: "Oro rosa", Almacenamiento: "256 GB ", RAM: "12 GB" } },
    {
      modelo: "NP960QHA-KG1CL",
      nombre: "Galaxy Book5 Pro 360, Copilot+ PC",
      categoria: "Computadores",
      paginaOrigen: "https://www.samsung.com/cl/computers/galaxy-book/galaxy-book5-pro-360-16-inch-ultra-7-16gb-512gb-np960qha-kg1cl/",
    },
    {
      modelo: "SM-S731BZKKLTL",
      nombre: "Galaxy S25 FE",
      categoria: "Smartphones",
      nombreFamilia: "Galaxy S25 FE 256 GB｜8 GB Jetblack",
      paginaOrigen: "https://www.samsung.com/cl/smartphones/galaxy-s/galaxy-s25-fe-jetblack-256gb-sm-s731bzkkltl/buy/",
    },
    {
      modelo: "SM-R390NIDACHO",
      nombre: "Galaxy Fit3",
      categoria: "Relojes (Galaxy Watch)",
      variante: "Pink Gold",
      paginaOrigen: "https://www.samsung.com/cl/watches/galaxy-fit/galaxy-fit3-pink-gold-sm-r390nidacho/",
    },
  ];
  for (const caso of casos) {
    const unaVez = componerTitulo(caso);
    const dosVeces = componerTitulo({ ...caso, nombre: unaVez });
    const tresVeces = componerTitulo({ ...caso, nombre: dosVeces });
    assert.equal(dosVeces, unaVez, `no idempotente: ${unaVez}`);
    assert.equal(tresVeces, unaVez);
  }
});

test("limpia el ruido real del catalogo: HTML, entidades, pipes, tabuladores, parentesis vacios", () => {
  assert.equal(
    componerTitulo({ modelo: "LC27F390FHLXZS", nombre: 'Monitor curvo esencial de 27" <br>  ', categoria: "Monitores" }),
    'Monitor curvo esencial de 27"',
  );
  assert.equal(limpiarNombre("Galaxy Z Fold7 256 GB｜12 GB Azul Intenso"), "Galaxy Z Fold7 256 GB / 12 GB Azul Intenso");
  assert.equal(limpiarNombre("Athleisure Band (S/M) para Galaxy Watch8 | Watch8 Classic"), "Athleisure Band (S/M) para Galaxy Watch8 / Watch8 Classic");
  assert.equal(limpiarNombre("Unidad Interior Muro Multisplit 18.000 BTU\t"), "Unidad Interior Muro Multisplit 18.000 BTU");
  assert.equal(limpiarNombre("Monitor  Plano   24 IPS FHD"), "Monitor Plano 24 IPS FHD");
  assert.equal(limpiarNombre("Cocina a Gas ( ) 5Q"), "Cocina a Gas 5Q");
  assert.equal(limpiarNombre('Pantalla 32&quot; &amp; algo'), 'Pantalla 32" & algo');
  assert.equal(limpiarNombre("360 Cassette CAC AC071MN4PKH/EU "), "360 Cassette CAC AC071MN4PKH/EU");
  assert.equal(limpiarNombre(null), "");
  assert.equal(limpiarNombre(undefined), "");
});

test("varianteUtil descarta los placeholders del seed", () => {
  assert.equal(varianteUtil("—"), null);
  assert.equal(varianteUtil(" — "), null);
  assert.equal(varianteUtil("-"), null);
  assert.equal(varianteUtil("(múltiples variantes en una página)"), null);
  assert.equal(varianteUtil(""), null);
  assert.equal(varianteUtil(null), null);
  assert.equal(varianteUtil(undefined), null);
  assert.equal(varianteUtil(42), null);
  assert.equal(varianteUtil("256GB, Pink Gold"), "256GB, Pink Gold");
  assert.equal(varianteUtil("  White  "), "White");
});

test("slugDe toma el penultimo segmento cuando la URL termina en /buy/", () => {
  assert.equal(slugDe("https://www.samsung.com/cl/smartphones/galaxy-a/galaxy-a17-5g-black-128gb-sm-a176bzkolel/buy/"), "galaxy-a17-5g-black-128gb-sm-a176bzkolel");
  assert.equal(slugDe("https://www.samsung.com/cl/tvs/full-hd-tv/f6000-40-inch-un40f6000fgxzs/"), "f6000-40-inch-un40f6000fgxzs");
  // URL de Offer de una pagina familia: ?SKU al final
  assert.equal(slugDe("https://www.samsung.com/cl/smartphones/galaxy-s/galaxy-s26-ultra/buy/?SM-S948BZDJLTL"), "galaxy-s26-ultra");
  assert.equal(slugDe(""), "");
  assert.equal(slugDe(undefined), "");
  assert.equal(slugDe("https://www.samsung.com/cl/"), "cl");
});

test("normalizar deja texto comparable sin acentos ni simbolos", () => {
  assert.equal(normalizar("Grafito increíble ｜ 256 GB"), "grafito increible 256 gb");
  assert.equal(normalizar(undefined), "");
});

// --- regresiones de la auditoria 2026-07-29 -----------------------------------

test("el CPU abreviado del nombre ('i5') deduplica contra 'Core i5'", () => {
  // los 3 registros reales del catalogo donde el nombre escribe el CPU corto:
  // con el patron viejo (la frase completa "core i5") el titulo lo repetia
  const casos = [
    ["NP730QED-KB1CL", 'Galaxy Book2 360 (13,3", i5, 8GB)', "galaxy-book2-360-13inch-i5-8gb-512gb-np730qed-kb1cl"],
    ["NP730QFG-KB2CL", 'Galaxy book3 360 (13,3", i7, 8GB)', "galaxy-book3-360-13inch-i7-8gb-512gb-np730qfg-kb2cl"],
  ];
  for (const [modelo, nombre, slug] of casos) {
    const t = componerTitulo({
      modelo,
      nombre,
      categoria: "Familia (auto-descubierta)",
      paginaOrigen: `https://www.samsung.com/cl/computers/galaxy-book/${slug}/`,
    });
    assert.equal(t, `${nombre} · 512GB`, `CPU repetido: ${t}`);
    assert.equal((t.match(/i[57]/g) || []).length, 1, `el numero de CPU aparece dos veces: ${t}`);
  }
  // y la forma larga sigue deduplicando igual que antes
  assert.ok(!/Core i5$/.test(componerTitulo({
    modelo: "NP750XGJ-KS4CL",
    nombre: 'Galaxy Book 4 (15,6", Intel® Core i5, 16GB)',
    categoria: "Computadores",
    paginaOrigen: "https://www.samsung.com/cl/computers/galaxy-book/galaxy-book4-15-6-inch-13th-core-5-16gb-1tb-np750xgj-ks4cl/",
  })));
});

test("'Ultra 7' no se abrevia a '7': un numero suelto calzaria con cualquier cosa", () => {
  // el nombre trae un 7 (Book**5**... no, aca el 360 y el 16) pero el CPU debe
  // agregarse igual; abreviar "Ultra 7" a "7" lo habria bloqueado
  const t = componerTitulo({
    modelo: "NP960QHA-KG1CL",
    nombre: "Galaxy Book5 Pro 360 7 en 1, Copilot+ PC",
    categoria: "Computadores",
    paginaOrigen: "https://www.samsung.com/cl/computers/galaxy-book/galaxy-book5-pro-360-16-inch-ultra-7-16gb-512gb-np960qha-kg1cl/",
  });
  assert.match(t, /· Ultra 7$/, t);
});

test("la RAM abreviada del nombre ('16G') deduplica contra '16GB RAM'", () => {
  // NP960XFG-KC2CL real: era el titulo mas redundante del catalogo (repetia RAM Y CPU)
  const t = componerTitulo({
    modelo: "NP960XFG-KC2CL",
    nombre: 'Galaxy Book3 Pro (16", i7, 16G)',
    categoria: "Familia (auto-descubierta)",
    paginaOrigen: "https://www.samsung.com/cl/computers/galaxy-book/galaxy-book3-pro-16-inch-i7-16gb-512gb-np960xfg-kc2cl/",
  });
  assert.equal(t, 'Galaxy Book3 Pro (16", i7, 16G) · 512GB');
  assert.ok(!/RAM/.test(t), `la RAM se repite: ${t}`);
  // pero cuando el nombre NO trae la memoria, la RAM sigue apareciendo etiquetada
  assert.match(
    componerTitulo({
      modelo: "NP960XFG-KC2CL",
      nombre: "Galaxy Book3 Pro",
      categoria: "Computadores",
      paginaOrigen: "https://www.samsung.com/cl/computers/galaxy-book/galaxy-book3-pro-16-inch-i7-16gb-512gb-np960xfg-kc2cl/",
    }),
    /· 16GB RAM ·/,
  );
  // "16GB" y "16 GB" completos siguen deduplicando como siempre
  for (const nombre of ["Galaxy Book3 Pro 16GB", "Galaxy Book3 Pro 16 GB"]) {
    assert.ok(
      !/16GB RAM/.test(componerTitulo({
        modelo: "NP960XFG-KC2CL",
        nombre,
        categoria: "Computadores",
        paginaOrigen: "https://www.samsung.com/cl/computers/galaxy-book/galaxy-book3-pro-16-inch-i7-16gb-512gb-np960xfg-kc2cl/",
      })),
      nombre,
    );
  }
});

test("'Grafito' del nombre cubre al 'Charcoal' del slug (mismo color, dos idiomas)", () => {
  // las 3 lavadoras notificables reales: Samsung traduce "Glam Deep Charcoal"
  // como "Grafito" y el titulo decia el color dos veces
  for (const kg of [15, 17, 19]) {
    const t = componerTitulo({
      modelo: `WA40F${kg}E7CZS`,
      nombre: `Lavadora Carga Superior ${kg} Kg con Eco Bubble™ 2026 Grafito`,
      categoria: "Lavado y secado",
      paginaOrigen: `https://www.samsung.com/cl/washers-and-dryers/washing-machines/wa80f-25-top-load-washer-${kg}kg-glam-deep-charcoal-wa40f${kg}e7czs/`,
    });
    assert.ok(!/Charcoal/i.test(t), `color repetido en dos idiomas: ${t}`);
  }
});

test("un color mal extraido del seed no se pega al titulo ('Blue' de 'Bluetooth')", () => {
  // las 3 filas reales del seed donde el color esta mal extraido del nombre
  const malas = [
    ["MWR-WE13N", "Wired Remote Controller", "Red"],
    ["EJ-M3400DBEGWW", "Samsung Mouse Bluetooth delgado, Negro, M3400", "Blue"],
    ["EJ-M3400DSEGWW", "Samsung Mouse Bluetooth delgado, Plateado, M3400", "Blue"],
  ];
  for (const [modelo, nombre, variante] of malas) {
    const t = componerTitulo({ modelo, nombre, categoria: "Accesorios PC", variante });
    assert.equal(t, nombre, `color inventado desde el seed: ${t}`);
  }
  // y un color legitimo del seed (que no aparece dentro de otra palabra) sigue usandose
  assert.equal(
    componerTitulo({ modelo: "SM-R390NIDACHO", nombre: "Galaxy Fit3", categoria: "Relojes (Galaxy Watch)", variante: "Pink Gold" }),
    "Galaxy Fit3 · Pink Gold",
  );
});

test("el titulo distingue el texto del nombre de las caracteristicas agregadas", () => {
  // el pipe del JSON-LD va a " / " y el " · " queda solo para lo que agrega el
  // modulo: antes "Galaxy Z Fold7 256 GB · 12 GB Azul Intenso" hacia parecer que
  // los 12 GB eran una especificacion mas (y sin la etiqueta RAM que el diseño exige)
  const fold = componerTitulo({
    modelo: "SM-F966BDBJCHO",
    nombre: "Galaxy Z Fold7 256 GB｜12 GB Azul Intenso",
    categoria: "Familia (auto-descubierta)",
    paginaOrigen: "https://www.samsung.com/cl/smartphones/galaxy-z-fold7/buy/",
  });
  assert.equal(fold, "Galaxy Z Fold7 256 GB / 12 GB Azul Intenso");
  assert.ok(!fold.includes("·"), "el punto medio esta reservado para las caracteristicas");

  const banda = componerTitulo({
    modelo: "EF-XL330CLEGWW",
    nombre: "Athleisure Band (S/M) para Galaxy Watch8 | Watch8 Classic",
    categoria: "Accesorios móviles",
    paginaOrigen: "https://www.samsung.com/cl/mobile-accessories/athleisure-band-blue-ef-xl330clegww/",
  });
  assert.equal(banda, "Athleisure Band (S/M) para Galaxy Watch8 / Watch8 Classic · Blue");
  assert.equal(banda.split(" · ").length, 2, "solo el color va tras el punto medio");
});

test("un color con nombre de miembro de Object.prototype no revienta", () => {
  // el diccionario de especificaciones se llena con texto del sitio: con un
  // objeto con prototipo, COLORES["constructor"] devolvia una funcion, el for...of
  // lanzaba TypeError y se perdian TODOS los avisos de la corrida
  for (const color of ["constructor", "toString", "valueOf", "hasOwnProperty", "__proto__", "propertyIsEnumerable"]) {
    const t = componerTitulo({ ...S26_ULTRA, especificaciones: { Color: color } });
    assert.equal(typeof t, "string");
    assert.ok(t.startsWith(S26_ULTRA.nombre), t);
  }
});

test("un valor de especificacion sin nada comparable se descarta (idempotencia)", () => {
  // "★★" o ".*" no se pueden deduplicar: se repetian en cada pasada
  const sinEspecs = componerTitulo(S26_ULTRA);
  for (const valor of ["★★", ".*", "()", "—", "  ", "·", "​"]) {
    const caso = { ...S26_ULTRA, especificaciones: { Color: valor, Tamaño: valor } };
    const unaVez = componerTitulo(caso);
    assert.equal(unaVez, sinEspecs, `un valor sin sentido cambio el titulo: ${unaVez}`);
    assert.equal(componerTitulo({ ...caso, nombre: unaVez }), unaVez, `no idempotente: ${unaVez}`);
  }
  // y un valor kilometrico del sitio no infla el mensaje
  const largo = componerTitulo({ ...S26_ULTRA, especificaciones: { Color: "x".repeat(300) } });
  assert.ok(largo.length < 120, largo);
});

test("sobrevive a caracteres raros sin romper el texto ni el formato", () => {
  const t = componerTitulo({
    modelo: "SM-X",
    nombre: 'Monitor 34” ultra*ancho_gamer `tick` ~ 15,6" cocina 9.5Kg /  ',
    categoria: "Monitores",
    variante: "Black",
    paginaOrigen: "https://www.samsung.com/cl/monitors/gaming/odyssey-34-inch-black-sm-x/",
  });
  assert.ok(t.includes("Black"));
  assert.ok(!/undefined|NaN/.test(t));
  assert.ok(!/\s{2,}/.test(t), "sin espacios dobles");
  assert.ok(!/·\s*$/.test(t), "sin separadores huerfanos al final");
});
