import { componerTitulo } from "./titulo.mjs";

const CLP = new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 });

function fmt(n) {
  return Number.isFinite(n) ? CLP.format(n) : "sin precio";
}

// diferencia en pesos y porcentaje, ej: " (−$170.000 · −15,9%)"
function variacion(anterior, nuevo) {
  if (!Number.isFinite(anterior) || !Number.isFinite(nuevo) || anterior === 0) return "";
  const diff = nuevo - anterior;
  const signo = diff > 0 ? "+" : "−";
  const pctAbs = Math.abs((diff / anterior) * 100).toFixed(1);
  return ` (${signo}${CLP.format(Math.abs(diff))} · ${signo}${pctAbs}%)`;
}

// Icono por categoria real de src/seed.json (nunca se usa para "Accesorios *"
// porque esas categorias se filtran antes de llegar aca -- ver esAccesorio en
// src/catalogo.mjs, aplicado en run.mjs justo antes de llamar a notifyDiscord).
const ICONO_CATEGORIA = {
  Smartphones: "📱",
  Tablets: "📱",
  Computadores: "💻",
  "Relojes (Galaxy Watch)": "⌚",
  "Audio y Galaxy Buds": "🎧",
  "Audio (Soundbars/Torres)": "🔊",
  Televisores: "📺",
  "TV Lifestyle": "🖼️",
  Monitores: "🖥️",
  Proyectores: "📽️",
  Signage: "📟",
  "LED Signage": "📟",
  Refrigeradores: "🧊",
  "Línea blanca": "🧊",
  Lavavajillas: "🍽️",
  Cocina: "🍳",
  Microondas: "♨️",
  "Lavado y secado": "🧺",
  "Aire acondicionado": "❄️",
  "Aire acondicionado (sistemas)": "❄️",
  Aspiradoras: "🧹",
  "Purificadores de aire": "🌬️",
  SmartThings: "🏠",
  Reproductores: "📀",
};
const ICONO_DEFAULT = "🔹";

function iconoPara(categoria) {
  return ICONO_CATEGORIA[categoria] || ICONO_DEFAULT;
}

// El titulo va en negrita: un "*" o "_" que venga del sitio rompe el formato del
// resto del mensaje (precios y links incluidos). Hoy ningun nombre del catalogo
// los trae, pero el texto es de Samsung y puede cambiar en cualquier corrida.
// La barra invertida va PRIMERO en la clase y en la misma pasada: es el propio
// caracter de escape, y un nombre terminado en "\" convertia el ** de cierre en
// un asterisco literal -- la negrita no cerraba y se arrastraba el precio, el
// link y los productos siguientes del mismo mensaje. El pipe tambien se escapa
// porque "||texto||" es un spoiler en Discord (oculta el resto de la linea).
function escaparMarkdown(texto) {
  return texto.replace(/([\\*_`~|])/g, "\\$1");
}

function lineFor(change) {
  const icono = iconoPara(change.categoria);
  // el titulo ahora incluye las caracteristicas de la variante (capacidad, RAM,
  // color...) y el SKU sigue visible al final: es el unico identificador estable
  const nombre = escaparMarkdown(componerTitulo(change));
  const sku = change.modelo || "sin SKU";
  const titulo = `${icono} **${nombre}** (${sku})`;
  const link = change.url ? `\n　🔗 ${change.url}` : "";
  switch (change.tipo) {
    case "nuevo":
      return `${titulo}\n　🆕 Precio: **${fmt(change.precio)}** (primera vez visto en el catálogo)${link}`;
    case "desaparecido":
      return `${titulo}\n　❌ Ya no aparece en el sitio (confirmado en 2 revisiones seguidas). Último precio: **${fmt(change.precioAnterior)}**${link}`;
    case "recuperado":
      return `${titulo}\n　✅ Volvió a aparecer en el sitio. Precio actual: **${fmt(change.precio)}**${link}`;
    case "baja":
      return `${titulo}\n　🟢 Precio antes: ${fmt(change.precioAnterior)} → **ahora: ${fmt(change.precio)}**${variacion(change.precioAnterior, change.precio)}${link}`;
    case "sube":
      return `${titulo}\n　🔴 Precio antes: ${fmt(change.precioAnterior)} → **ahora: ${fmt(change.precio)}**${variacion(change.precioAnterior, change.precio)}${link}`;
    case "stock":
      return `${titulo}\n　📦 Stock antes: **${change.disponibleAnterior ? "disponible" : "agotado"}** → ahora: **${change.disponible ? "disponible" : "agotado"}**\n　Precio actual: **${fmt(change.precio)}**${link}`;
    default:
      return titulo + link;
  }
}

const TITULOS = {
  nuevo: "🆕 Productos nuevos",
  baja: "🟢 Bajas de precio",
  sube: "🔴 Subas de precio",
  stock: "📦 Cambios de stock",
  recuperado: "✅ De vuelta en el sitio",
  desaparecido: "❌ Ya no aparecen (confirmado)",
};

async function enviarMensaje(webhookUrl, content) {
  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
  });
  if (!res.ok) {
    console.error(`Fallo el envio a Discord: ${res.status} ${await res.text()}`);
  }
  return res.ok;
}

// Discord corta cada mensaje en 2000 caracteres. En vez de truncar y perder
// cambios, se arman varios mensajes seguidos -- ninguna novedad se pierde.
export function armarMensajes(encabezado, secciones) {
  const LIMITE = 1900;
  const mensajes = [];
  let actual = encabezado;

  const agregarLinea = (linea) => {
    if ((actual + "\n\n" + linea).length > LIMITE) {
      mensajes.push(actual);
      actual = linea;
    } else {
      actual += "\n\n" + linea;
    }
  };

  for (const [tipo, lineas] of secciones) {
    if (lineas.length === 0) continue;
    agregarLinea(`**${TITULOS[tipo]} (${lineas.length})**`);
    for (const linea of lineas) agregarLinea(linea);
  }

  mensajes.push(actual);
  return mensajes;
}

export async function notifyDiscord(webhookUrl, { changes, errores, totalRevisado }) {
  if (!webhookUrl) {
    console.log("DISCORD_WEBHOOK_URL no configurado, no se envia notificacion.");
    return;
  }
  if (changes.length === 0) return; // sin novedades, no molestar

  const porTipo = { nuevo: [], baja: [], sube: [], stock: [], recuperado: [], desaparecido: [] };
  for (const c of changes) (porTipo[c.tipo] ?? porTipo.nuevo).push(lineFor(c));

  const resumen = `Revisados ${totalRevisado} productos · ${changes.length} cambios${errores > 0 ? ` · ${errores} paginas con error` : ""}`;
  const encabezado = `**Monitor de precios Samsung Chile**\n${resumen}`;

  const secciones = [
    ["baja", porTipo.baja],
    ["sube", porTipo.sube],
    ["stock", porTipo.stock],
    ["recuperado", porTipo.recuperado],
    ["nuevo", porTipo.nuevo],
    ["desaparecido", porTipo.desaparecido],
  ];

  const mensajes = armarMensajes(encabezado, secciones);
  for (const mensaje of mensajes) {
    await enviarMensaje(webhookUrl, mensaje);
  }
}

// alerta tecnica (corrida sospechosa, error critico): un solo mensaje simple
export async function notifyTecnico(webhookUrl, texto) {
  if (!webhookUrl) {
    console.log("DISCORD_WEBHOOK_URL no configurado, no se envia alerta tecnica.");
    return;
  }
  await enviarMensaje(webhookUrl, texto.slice(0, 1900));
}
