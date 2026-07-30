// Compone el titulo legible de un producto: nombre + caracteristicas clave
// (capacidad, RAM, color, pulgadas/CPU cuando aportan).
//
// POR QUE EXISTE: digitalData.displayName -- la fuente del nombre en las paginas
// individuales -- no trae variante. Cuatro SKU distintos se llamaban todos
// "Galaxy S26 Ultra (Exclusivo en Samsung.com)" y una notificacion de precio no
// permitia saber cual era (reclamo del operador 2026-07-29).
//
// MODULO PURO: sin I/O, sin red, sin dependencias. Todo lo que decide como se
// LEE un producto vive aca; nada de esto puede influir en si un producto se
// considera nuevo/desaparecido/cambiado (la identidad es y sigue siendo el SKU).
//
// ORDEN DE PRIORIDAD DE FUENTES (campo por campo, la primera que responde gana):
//  1. producto.especificaciones -- diccionario indexado por el SKU real
//     (#BV-buyingOptionData + acordeon de especificaciones de la pagina). Es la
//     unica fuente sin ambiguedad de variante. Hoy nadie la llena todavia: ver
//     "pendientes" del reporte de este cambio. El slot esta listo y probado.
//  2. slug de paginaOrigen -- medido: 100% de precision en capacidad y 95,5% en
//     color contra el seed, y donde discrepan el slug es mas preciso en 16 de 18
//     casos ("Phantom Black" vs "Black"). Cubre 83% de los notificables,
//     incluidos los 45 registros de pagina familia que el seed no tiene.
//  3. nombreFamilia -- nombre del JSON-LD de la pagina familia, especifico del
//     SKU ("Galaxy S26 Ultra 256 GB|12 GB Pinkgold"). SOLO se le leen capacidades
//     (numeros, inequivocos); su color viene en castellano de marketing
//     ("Violeta increible") y no se parsea.
//  4. seed.variante -- ultimo recurso. Es un archivo estatico: envejece, no cubre
//     SKU nuevos y tiene filas mal extraidas ("Blue" sacado de "Bluetooth").
//     Medido sobre los 969 registros reales: solo cambia 3 titulos y en los 3 el
//     color estaba mal, asi que su color pasa por el filtro colorMalExtraido().
//
// LO QUE NO SE USA, A PROPOSITO:
//  - Las lineas de especificacion de las RESENAS (.pdd44-review__side-option):
//    es lo primero que aparece al buscar "RAM" en la pagina y esta PROHIBIDO.
//    Las resenas se agregan por MODELO, no por SKU: la pagina del A17 de 128 GB
//    muestra lineas de 256 GB. Anunciaria la variante equivocada, que es peor
//    que no anunciar ninguna.
//  - El precio de la pagina familia (publica list_price: 1.549.990 donde la
//    pagina individual dice 1.199.990). Aca solo se le leen especificaciones.
//  - Las pulgadas de seed.variante: 99,2% redundantes con el nombre.

const SEPARADOR = " · ";

// ---------------------------------------------------------------- normalizacion

// Forma comparable: minuscula, sin acentos, todo lo no alfanumerico a espacio.
// NUNCA se muestra al usuario, solo se usa para comparar.
export function normalizar(texto) {
  return String(texto ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// Presencia con limite de palabra. Con substring "Blue" calza dentro de
// "Bluetooth" y "Red" dentro de "Wired": medido, las 5 coincidencias que da
// substring en el catalogo real son falsos positivos.
function contiene(textoNormalizado, patron) {
  if (!textoNormalizado || !patron) return false;
  return new RegExp(`(?<![a-z0-9])(?:${patron})(?![a-z0-9])`).test(textoNormalizado);
}

const PLACEHOLDER_VARIANTE = /^(?:[—–\-.·]+|n\/?a|sin variante|null|undefined)$/i;

// Una variante "no vacia" no es lo mismo que una variante util: 234 de las 1023
// filas del seed traen el guion largo U+2014 y 13 dicen "(multiples variantes
// en una pagina)". Concatenarlas produce "Refrigerador Bespoke · —".
export function varianteUtil(valor) {
  if (typeof valor !== "string") return null;
  const t = valor.replace(/\s+/g, " ").trim();
  if (!t) return null;
  if (PLACEHOLDER_VARIANTE.test(t)) return null;
  if (/m[uú]ltiples variantes/i.test(t)) return null;
  return t;
}

// ---------------------------------------------------------------- limpieza

const ENTIDADES = [
  [/&nbsp;?/gi, " "],
  [/&(?:quot|#0*34);/gi, '"'],
  [/&(?:apos|#0*39);/gi, "'"],
  [/&amp;/gi, "&"],
];

export function limpiarNombre(nombre) {
  if (typeof nombre !== "string") return "";
  let t = nombre;
  t = t.replace(/<[^>]*>/g, " "); // 16 nombres del catalogo traen <br>
  for (const [re, con] of ENTIDADES) t = t.replace(re, con);
  // El pipe del JSON-LD de Samsung separa el nombre de su variante ("Galaxy Z
  // Fold7 256 GB｜12 GB Azul Intenso"). Se traduce a " / " y NO al " · " de
  // SEPARADOR: ese punto medio esta reservado para las caracteristicas que agrega
  // componerTitulo. Usarlo para las dos cosas hacia ilegible el resultado ("256
  // GB · 12 GB Azul Intenso" parecia traer dos capacidades como especificaciones,
  // y "...Galaxy Watch8 · Watch8 Classic · Blue" mezclaba compatibilidad y color).
  t = t.replace(/｜/g, " / "); // pipe fullwidth del JSON-LD de Samsung
  t = t.replace(/\s*\|\s*/g, " / "); // pipe ASCII (mismo rol)
  t = t.replace(/\s*;\s*/g, " / "); // registros que fusionan varios productos
  t = t.replace(/[\t\r\n ]+/g, " ");
  t = t.replace(/\(\s*\)/g, " ").replace(/\[\s*\]/g, " "); // parentesis vacios
  t = t.replace(/\s+([),.])/g, "$1");
  t = t.replace(/\s+/g, " ").trim();
  t = t.replace(/^[·,;:\-–—/\s]+/, "").replace(/[·,;:\-–—/\s]+$/, "");
  return t.trim();
}

// ---------------------------------------------------------------- vocabularios

// Colores base medidos en seed.json (46 valores distintos) mas su equivalente en
// castellano, que es el idioma de los nombres del catalogo. El equivalente se usa
// SOLO para deduplicar: si el nombre ya dice "Grafito" no se agrega "Graphite".
// Sin prototipo a proposito: los valores de color pueden venir del HTML del sitio
// (ver desdeEspecificaciones) y con un objeto normal un color llamado
// "constructor" o "toString" devolvia una funcion en vez de una lista, el for...of
// lanzaba TypeError y se perdian TODOS los avisos de la corrida.
const COLORES = Object.assign(Object.create(null), {
  black: ["negr[oa]"],
  white: ["blanc[oa]"],
  gray: ["gris"],
  grey: ["gris"],
  // "gris" cuenta como Silver a proposito: el catalogo llama "Gris" a lo que el
  // slug llama "silver" (RS57DG4000M9ZS = "Refrigerador Side by Side 564L Gris").
  // Sin esto el titulo quedaba "... 564L Gris · Silver".
  silver: ["platead[oa]", "plata", "gris"],
  blue: ["azul"],
  navy: ["azul marino", "marino"],
  green: ["verde"],
  red: ["roj[oa]"],
  pink: ["rosa", "rosad[oa]"],
  purple: ["morad[oa]", "purpura"],
  violet: ["violeta"],
  lavender: ["lavanda"],
  yellow: ["amarill[oa]"],
  orange: ["naranja"],
  beige: [],
  cream: ["crema"],
  mint: ["menta"],
  lime: ["lima"],
  olive: ["oliva"],
  sand: ["arena"],
  gold: ["dorad[oa]", "oro"],
  graphite: ["grafito"],
  // "grafito" tambien cuenta como Charcoal: Samsung Chile traduce su "Glam Deep
  // Charcoal" como "Grafito" en el nombre (3 lavadoras notificables medidas,
  // WA40F15E4CZS/WA40F17E7CZS/WA40F19E7CZS). Sin esto el titulo decia el mismo
  // color dos veces en dos idiomas: "... 2026 Grafito · Deep Charcoal".
  charcoal: ["carbon", "grafito"],
  transparent: ["transparente"],
  coral: [],
  bronze: ["bronce"],
  titanium: ["titanio"],
  // medidos en slugs reales del catalogo: "Awesome Lilac" (A57),
  // "Silver Shadow" (S26 Ultra), "Satin Greige" (Bespoke), "Refined Inox"
  lilac: ["lila"],
  shadow: ["sombra"],
  greige: [],
  inox: [],
});

// Solo valen como color si van SEGUIDOS de un color base ("Awesome Blue",
// "Pink Gold"). Sueltos no son color: "light" y "jet" aparecen en slugs de
// productos que no tienen nada que ver con un color.
const MODIFICADORES = new Set([
  "awesome", "titanium", "light", "dark", "deep", "frost", "mystic", "jet", "icy",
  "coral", "phantom", "clean", "silver", "pink", "navy", "marble", "cobalt",
  "ocean", "sky", "satin", "elegant", "refined",
]);

const esBase = (t) => Object.prototype.hasOwnProperty.call(COLORES, t);
const esModificador = (t) => MODIFICADORES.has(t);

// "Pinkgold", "Icyblue", "Jetblack", "Coralred", "Graygreen", "Lightblue":
// Samsung escribe el mismo color pegado y separado en la misma familia.
function separarPegado(token) {
  for (let i = 3; i <= token.length - 3; i++) {
    const a = token.slice(0, i);
    const b = token.slice(i);
    if ((esBase(a) || esModificador(a)) && esBase(b)) return `${a} ${b}`;
  }
  return null;
}

const tituloCase = (t) =>
  t
    .split(" ")
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(" ");

// Patron de dedup de un color: la frase completa, cada palabra suelta y su
// equivalente en castellano. Si el nombre ya menciona cualquiera, no se agrega.
function patronColor(frase) {
  const palabras = frase.split(" ").filter(Boolean);
  const alternativas = new Set([frase]);
  for (const p of palabras) {
    alternativas.add(p);
    for (const es of COLORES[p] ?? []) alternativas.add(es);
  }
  return [...alternativas].join("|");
}

// Una frase es color si termina en un color base y todo lo anterior es
// modificador o base: "blue", "gray green", "awesome icy blue", "silver shadow".
function fraseDeColor(frase) {
  const palabras = frase.split(" ").filter(Boolean);
  if (palabras.length === 0) return false;
  if (!esBase(palabras[palabras.length - 1])) return false;
  return palabras.slice(0, -1).every((p) => esModificador(p) || esBase(p));
}

const soloModificadores = (frase) => frase.split(" ").every((p) => esModificador(p));

// Patron unico para saber si un nombre YA menciona algun color, en ingles o en
// castellano. Se usa para decidir si conviene arriesgarse con el color del slug
// de un producto combinado.
const PATRON_ALGUN_COLOR = Object.entries(COLORES)
  .flatMap(([base, esp]) => [base, ...esp])
  .join("|");

function nombreMencionaColor(nombreNormalizado) {
  return contiene(nombreNormalizado, PATRON_ALGUN_COLOR);
}

// ---------------------------------------------------------------- capacidades

const enGB = (n, unidad) => (unidad === "tb" ? n * 1024 : unidad === "mb" ? n / 1024 : n);
const textoCapacidad = (n, unidad) => `${n}${unidad.toUpperCase()}`;

// Con 2 capacidades la MENOR es RAM y la MAYOR almacenamiento (validado en las
// 4 filas del seed que traen ambas y en todos los slugs de Galaxy Book).
// Con 1 sola capacidad es almacenamiento, nunca RAM.
function repartirCapacidades(caps) {
  const unicas = [];
  for (const c of caps) if (!unicas.some((u) => u.gb === c.gb)) unicas.push(c);
  if (unicas.length === 0) return {};
  if (unicas.length === 1) return { almacenamiento: unicas[0] };
  const orden = [...unicas].sort((a, b) => a.gb - b.gb);
  return { ram: orden[0], almacenamiento: orden[orden.length - 1] };
}

function especEntrada(texto, patron) {
  return { texto, patron };
}

function capacidadEntrada(cap, sufijo = "") {
  // El patron acepta "256GB", "256 GB" y la abreviatura SIN la B, que es una
  // convencion de Samsung en los nombres de notebook ("Galaxy Book3 Pro (16",
  // i7, 16G)"). Sin la B opcional el titulo agregaba "· 16GB RAM" a un nombre
  // que ya decia 16G. Se deja "mb" estricto: un "16 M" suelto no es una unidad.
  const unidad = cap.unidad === "mb" ? "mb" : `${cap.unidad[0]}b?`;
  return especEntrada(`${cap.texto}${sufijo}`, `${cap.n}\\s?${unidad}`);
}

// ---------------------------------------------------------------- fuente: slug

// Ultimo segmento de la ruta, o el PENULTIMO si el ultimo es "buy": sin esto los
// 61 registros de pagina familia (que son los de titulo mas ambiguo) dan cero.
export function slugDe(url) {
  if (typeof url !== "string" || !url) return "";
  const sinQuery = url.split(/[?#]/)[0];
  const partes = sinQuery.split("/").filter(Boolean);
  if (partes.length === 0) return "";
  let ultimo = partes[partes.length - 1];
  if (ultimo === "buy" && partes.length >= 2) ultimo = partes[partes.length - 2];
  if (/^https?:$/i.test(ultimo) || ultimo.includes(".")) return "";
  return ultimo;
}

function tokensDeSlug(slug, sku) {
  const delSku = new Set(
    String(sku ?? "")
      .toLowerCase()
      .replace(/[/,]/g, "-")
      .split("-")
      .filter(Boolean),
  );
  return slug
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t && !delSku.has(t));
}

// Devuelve TODAS las frases de color del slug, en orden. Solo se unen dos
// tokens vecinos cuando el primero es modificador ("Awesome Blue", "Pink Gold",
// "Silver Shadow"); dos colores base sueltos NO se fusionan, porque en un combo
// son los colores de dos productos distintos ("...-black-white-...").
function extraerColores(tokens) {
  const expandidos = tokens.map((t) => (esBase(t) || esModificador(t) ? t : separarPegado(t) ?? t));
  const colores = [];
  for (let i = 0; i < expandidos.length; i++) {
    const actual = expandidos[i];
    const sig = expandidos[i + 1];
    const combinada = sig ? `${actual} ${sig}` : null;
    if (combinada && soloModificadores(actual) && fraseDeColor(combinada)) {
      colores.push(combinada);
      i++;
      continue;
    }
    if (fraseDeColor(actual)) colores.push(actual);
  }
  return colores;
}

// Devuelve el CPU con su patron de deduplicacion. El patron incluye la forma
// CORTA ademas de la frase completa: los nombres del catalogo escriben "i5", no
// "Core i5" ("Galaxy Book2 360 (13,3", i5, 8GB)"), y con la frase completa el
// titulo terminaba repitiendo el CPU. "Ultra 7" NO se abrevia a "7": un numero
// suelto calzaria con cualquier cosa del nombre.
function extraerCPU(tokens) {
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const sig = tokens[i + 1] ?? "";
    if (/^i[3579]$/.test(t)) return especEntrada(`Core ${t}`, `core\\s?${t}|${t}`);
    if (t === "ultra" && /^\d$/.test(sig)) return especEntrada(`Ultra ${sig}`, `ultra\\s?${sig}`);
    if (t === "core" && /^\d$/.test(sig)) return especEntrada(`Core i${sig}`, `core\\s?i?${sig}|i${sig}`);
    if (t === "core" && /^i[3579]$/.test(sig)) return especEntrada(`Core ${sig}`, `core\\s?${sig}|${sig}`);
  }
  return null;
}

function extraerTamano(tokens) {
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const pegado = /^(\d{1,3})inch(?:es)?$/.exec(t);
    if (pegado) return { texto: `${pegado[1]}"`, patron: pegado[1] };
    const mm = /^(\d{2})mm$/.exec(t); // caja del reloj: NO son pulgadas
    if (mm) return { texto: `${mm[1]}mm`, patron: `${mm[1]}\\s?mm` };
    if (t === "inch" || t === "inches") {
      const uno = tokens[i - 1];
      const dos = tokens[i - 2];
      if (!/^\d{1,3}$/.test(uno ?? "")) continue;
      // 15-6-inch = 15,6" (el decimal viaja partido en el slug)
      if (/^\d{1,2}$/.test(dos ?? "") && uno.length === 1) {
        return { texto: `${dos},${uno}"`, patron: `${dos}[ ,.]?${uno}` };
      }
      return { texto: `${uno}"`, patron: uno };
    }
  }
  return null;
}

// Los kg del slug NO se usan: medido contra el catalogo real, el slug arrastra
// los kg de la familia y contradicen al producto (DV90TA040BE/ZS se llama
// "Secadora 9Kg" y su slug dice "8kg"; F-WA17CVS2030 dice 17Kg en el nombre y
// 18kg en el slug). Los kg/litros/BTU ya vienen en el nombre en linea blanca.

// Las pulgadas solo se agregan donde el tamano de pantalla ES la caracteristica
// del producto. Sin este filtro el slug del refrigerador Family Hub
// (RF29DB9950QDZS) aportaba el 32" de su pantalla al titulo del refrigerador.
const CATEGORIAS_CON_TAMANO = /televisor|monitor|signage|proyector|computador|notebook|\btv\b|familia|reloj|watch|tablet/i;

function admiteTamano(producto) {
  return CATEGORIAS_CON_TAMANO.test(`${producto.categoria ?? ""} ${producto.subcategoria ?? ""}`);
}

function desdeSlug(url, sku, { combinado, nombreNormalizado }) {
  const slug = slugDe(url);
  if (!slug) return {};
  const tokens = tokensDeSlug(slug, sku);
  if (tokens.length === 0) return {};

  const caps = [];
  for (const t of tokens) {
    const m = /^(\d{1,4})(gb|tb)$/.exec(t);
    if (m) caps.push({ n: Number(m[1]), unidad: m[2], gb: enGB(Number(m[1]), m[2]), texto: textoCapacidad(m[1], m[2]) });
  }
  const { ram, almacenamiento } = repartirCapacidades(caps);

  const salida = {};
  const tamano = extraerTamano(tokens);
  if (tamano) salida.tamano = especEntrada(tamano.texto, tamano.patron);
  if (almacenamiento) salida.almacenamiento = capacidadEntrada(almacenamiento);
  if (ram) salida.ram = capacidadEntrada(ram, " RAM");

  // El color del slug de un combo/bundle puede ser ambiguo: trae el del producto
  // Y el del regalo ("bundle-a27-blue-128gb-fit3-white" -> un barrido ingenuo se
  // queda con el color del Fit3; son los 2 unicos errores de color medidos).
  // Regla: en un producto combinado el color solo se usa si el slug menciona UN
  // solo color y el nombre no menciona ninguno (ahi no hay con que confundirlo).
  const colores = extraerColores(tokens);
  const color = colores[0];
  const seguro = !combinado || (colores.length === 1 && !nombreMencionaColor(nombreNormalizado ?? ""));
  if (color && seguro) salida.color = especEntrada(tituloCase(color), patronColor(color));
  // El CPU solo cuenta si el slug ademas trae RAM + almacenamiento; si no,
  // "galaxy-watch-ultra" produce el CPU "Ultra", que es parte del nombre.
  if (ram && almacenamiento) {
    const cpu = extraerCPU(tokens);
    if (cpu) salida.cpu = cpu;
  }
  return salida;
}

// ------------------------------------------------- fuente: nombre de la familia

// Del nombre del JSON-LD de la pagina familia solo se leen CAPACIDADES: son
// numeros y no admiten interpretacion. El color de esos nombres viene en
// castellano de marketing ("Violeta increible", "Azul Intenso") y no se parsea.
function desdeNombreRico(nombre) {
  if (typeof nombre !== "string" || !nombre) return {};
  const caps = [];
  for (const m of nombre.matchAll(/(?<![a-z0-9])(\d{1,4})\s?(GB|TB)(?![a-z0-9])/gi)) {
    const n = Number(m[1]);
    const unidad = m[2].toLowerCase();
    caps.push({ n, unidad, gb: enGB(n, unidad), texto: textoCapacidad(n, unidad) });
  }
  const { ram, almacenamiento } = repartirCapacidades(caps);
  const salida = {};
  if (almacenamiento) salida.almacenamiento = capacidadEntrada(almacenamiento);
  if (ram) salida.ram = capacidadEntrada(ram, " RAM");
  return salida;
}

// ------------------------------------------------------- fuente: seed.variante

// Orden interno del seed, consistente en sus 1023 filas: pulgadas, RAM,
// almacenamiento, color. Las pulgadas se ignoran a proposito (redundantes).
function desdeVariante(variante, { combinado, nombreNormalizado = "" }) {
  const util = varianteUtil(variante);
  if (!util) return {};
  const caps = [];
  const colores = [];
  for (const parte of util.split(",")) {
    const p = parte.trim();
    if (!p) continue;
    const cap = /^(\d{1,4})\s?(GB|TB)$/i.exec(p);
    if (cap) {
      const n = Number(cap[1]);
      const unidad = cap[2].toLowerCase();
      caps.push({ n, unidad, gb: enGB(n, unidad), texto: textoCapacidad(n, unidad) });
      continue;
    }
    if (/^\d+([.,]\d+)?\s*(?:"|''|”|″|mm|cm)$/.test(p)) continue; // pulgadas: no aportan
    // el seed escribe el mismo color pegado y separado ("Jetblack" y "Jet Black")
    const detectados = extraerColores(normalizar(p).split(" "));
    if (detectados.length > 0) colores.push(detectados[0]);
  }
  const { ram, almacenamiento } = repartirCapacidades(caps);
  const salida = {};
  if (almacenamiento) salida.almacenamiento = capacidadEntrada(almacenamiento);
  if (ram) salida.ram = capacidadEntrada(ram, " RAM");
  if (!combinado && colores.length > 0 && !colorMalExtraido(colores[0], nombreNormalizado)) {
    salida.color = especEntrada(tituloCase(colores[0]), patronColor(colores[0]));
  }
  return salida;
}

// El seed tiene filas con el color mal extraido del nombre: "Red" sacado de
// "Wired" y "Blue" de "Bluetooth". Medido sobre los 969 registros reales, esas
// filas son los 3 UNICOS casos en que seed.variante cambia un titulo, y los 3
// dicen un color que el producto no tiene ("Wired Remote Controller · Red").
// Senal inequivoca de la mala extraccion: la palabra aparece DENTRO de otra
// palabra del nombre y no como palabra suelta. El limite de palabra de contiene()
// protege el lado del nombre, no el valor que trae el seed.
function colorMalExtraido(frase, nombreNormalizado) {
  if (!nombreNormalizado) return false;
  return frase
    .split(" ")
    .filter(Boolean)
    .some((p) => nombreNormalizado.includes(p) && !contiene(nombreNormalizado, p));
}

// ------------------------------- fuente: diccionario indexado por SKU (BV/spec)

const LLAVES_ESPEC = [
  ["color", /^color$/i],
  ["almacenamiento", /^(?:almacenamiento|storage|capacidad de almacenamiento)$/i],
  ["ram", /^(?:ram|memoria ram|memoria|memory)(?:[\s_]*\((?:gb|mb)\))?$/i],
  ["tamano", /^(?:pulgadas|tama[nñ]o|tama[nñ]o de pantalla|size|screen size)$/i],
];

// Cada pagina de Samsung expone ~60 especificaciones; guardarlas todas en
// data/latest.json (que se commitea 7 veces al dia) lo inflaria por nada. Esta
// funcion deja SOLO las llaves que el titulo sabe usar y es la unica autoridad
// sobre esa lista: extract.mjs la llama al leer la pagina, asi que la lista
// blanca no queda duplicada en dos archivos.
export function filtrarEspecificacionesUtiles(espec) {
  if (!espec || typeof espec !== "object" || Array.isArray(espec)) return null;
  const salida = Object.create(null);
  for (const [campoBruto, valorBruto] of Object.entries(espec)) {
    if (typeof valorBruto !== "string" && typeof valorBruto !== "number") continue;
    const valor = String(valorBruto).replace(/\s+/g, " ").trim();
    if (!valor || valor.length > 40) continue;
    const campo = String(campoBruto).replace(/[_]+/g, " ").trim();
    const match = LLAVES_ESPEC.find(([, re]) => re.test(campo));
    if (!match) continue;
    // Se guarda con la llave CANONICA, no con la de Samsung: el TV publica el
    // mismo dato como "tamaño" y como "Tamaño de pantalla", y guardar los dos
    // solo engorda data/latest.json (se commitea 7 veces al dia).
    const destino = match[0];
    if (destino in salida) continue;
    // Las memorias en MB no se guardan: son detalle interno de los wearables
    // ("Memory (MB): 16 MB" del Galaxy Fit3) y el titulo las descarta igual.
    if ((destino === "ram" || destino === "almacenamiento") && /\bmb\b/i.test(valor)) continue;
    salida[destino] = valor;
  }
  return Object.keys(salida).length > 0 ? { ...salida } : null;
}

function desdeEspecificaciones(espec) {
  if (!espec || typeof espec !== "object" || Array.isArray(espec)) return {};
  const salida = {};
  for (const [campoBruto, valorBruto] of Object.entries(espec)) {
    if (typeof valorBruto !== "string" && typeof valorBruto !== "number") continue;
    const valor = String(valorBruto).replace(/\s+/g, " ").trim();
    if (!valor || varianteUtil(valor) === null) continue;
    // Este valor sale del HTML del sitio, asi que se valida como texto hostil:
    //  - sin nada alfanumerico ("★★", ".*") el patron de dedup queda vacio, el
    //    dato no se deduplica nunca y el titulo lo repite en cada pasada
    //    (rompia la idempotencia que promete el modulo).
    //  - un valor kilometrico solo sirve para inflar el mensaje de Discord.
    if (normalizar(valor) === "" || valor.length > 40) continue;
    const campo = String(campoBruto).replace(/[_]+/g, " ").trim();
    const match = LLAVES_ESPEC.find(([, re]) => re.test(campo));
    if (!match) continue;
    const destino = match[0];
    if (salida[destino]) continue;
    if (destino === "color") {
      salida.color = especEntrada(valor, patronColor(normalizar(valor)));
      continue;
    }
    if (destino === "tamano") {
      salida.tamano = especEntrada(valor, normalizar(valor).replace(/\s+/g, "\\s?"));
      continue;
    }
    // capacidades: el bloque de Samsung trae "256 GB " (con espacio sobrante) y a
    // veces solo el numero ("12" para Memoria_(GB))
    const m = /(\d{1,4})\s*(gb|tb|mb)?/i.exec(valor);
    if (!m) continue;
    const unidad = (m[2] || (destino === "ram" ? "gb" : "gb")).toLowerCase();
    // Las memorias en MB son detalle interno de los wearables, no un dato de
    // compra: el Galaxy Fit3 publica "Memory (MB) 16 MB" y "16MB RAM" al lado de
    // una pulsera de $49.990 confunde mas de lo que informa.
    if (unidad === "mb") continue;
    const cap = { n: Number(m[1]), unidad, gb: enGB(Number(m[1]), unidad), texto: textoCapacidad(m[1], unidad) };
    salida[destino] = capacidadEntrada(cap, destino === "ram" ? " RAM" : "");
  }
  return salida;
}

// ---------------------------------------------------------------- composicion

// Orden de lectura del operador y del propio seed: tamano, almacenamiento, RAM,
// color, CPU. La RAM va etiquetada ("12GB RAM") para que no se confunda con el
// almacenamiento.
const CAMPOS_EN_ORDEN = ["tamano", "almacenamiento", "ram", "color", "cpu"];

function primeroQueResponda(fuentes) {
  const salida = {};
  for (const campo of CAMPOS_EN_ORDEN) {
    for (const fuente of fuentes) {
      if (fuente && fuente[campo]) {
        salida[campo] = fuente[campo];
        break;
      }
    }
  }
  return salida;
}

// Un registro puede fusionar 2 a 4 productos reales (SKU con coma, nombre con
// ";"): ahi no existe "una" capacidad ni "un" color, y inventarlos seria peor
// que no decir nada.
function esCompuesto(producto) {
  return /,/.test(String(producto.modelo ?? "")) || /;/.test(String(producto.nombre ?? ""));
}

function esCombinado(producto, slug) {
  if (/(?:^|-)(?:bundle|combo|kit)(?:-|$)/.test(slug)) return true;
  return / \+ /.test(String(producto.nombre ?? ""));
}

/**
 * Devuelve el titulo legible del producto. Nunca devuelve vacio, "undefined"
 * ni "NaN": si no hay nada mejor devuelve el nombre y, sin nombre, el SKU.
 * Idempotente: aplicarla sobre su propia salida da el mismo texto.
 */
export function componerTitulo(producto = {}) {
  const datos = producto && typeof producto === "object" ? producto : {};
  const sku = typeof datos.modelo === "string" ? datos.modelo.trim() : "";
  const nombre = limpiarNombre(datos.nombre);
  const base = nombre || sku;
  if (!base) return "Producto sin identificar";
  if (esCompuesto(datos)) return base;

  const urlSlug = datos.paginaOrigen || datos.url || "";
  const slug = slugDe(urlSlug).toLowerCase();
  const combinado = esCombinado(datos, slug);
  const baseNorm = normalizar(base);

  const especs = primeroQueResponda([
    desdeEspecificaciones(datos.especificaciones),
    desdeSlug(urlSlug, sku, { combinado, nombreNormalizado: baseNorm }),
    desdeNombreRico(datos.nombreFamilia),
    desdeVariante(datos.variante, { combinado, nombreNormalizado: baseNorm }),
  ]);
  if (!admiteTamano(datos)) delete especs.tamano;

  const partes = [];
  const yaPuestas = [];
  for (const campo of CAMPOS_EN_ORDEN) {
    const entrada = especs[campo];
    if (!entrada) continue;
    const texto = String(entrada.texto ?? "").trim();
    if (!texto || /undefined|null|NaN/.test(texto)) continue;
    // no repetir lo que el nombre ya dice (263 de 592 notificables ya traen GB
    // o pulgadas en el nombre) ni lo que otra caracteristica ya puso
    if (contiene(baseNorm, entrada.patron)) continue;
    if (yaPuestas.some((p) => contiene(normalizar(texto), p))) continue;
    partes.push(texto);
    yaPuestas.push(entrada.patron);
  }

  if (partes.length === 0) return base;
  return [base, ...partes].join(SEPARADOR);
}

export default componerTitulo;
