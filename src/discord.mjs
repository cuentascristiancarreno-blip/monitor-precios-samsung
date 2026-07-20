const CLP = new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 });

function fmt(n) {
  return typeof n === "number" ? CLP.format(n) : "sin precio";
}

function pct(anterior, nuevo) {
  if (!anterior) return "";
  const cambio = ((nuevo - anterior) / anterior) * 100;
  const signo = cambio > 0 ? "+" : "";
  return ` (${signo}${cambio.toFixed(1)}%)`;
}

function lineFor(change) {
  const nombre = change.nombre || change.modelo;
  const titulo = `${nombre} (${change.modelo})`;
  switch (change.tipo) {
    case "nuevo":
      return `🆕 **${titulo}**\n　Precio: **${fmt(change.precio)}** (no estaba antes en el catálogo)`;
    case "eliminado":
      return `❌ **${titulo}**\n　Ya no aparece en el sitio. Antes: **${fmt(change.precioAnterior)}**`;
    case "baja":
      return `🟢 **${titulo}**\n　Precio antes: ${fmt(change.precioAnterior)} → **ahora: ${fmt(change.precio)}**${pct(change.precioAnterior, change.precio)}`;
    case "sube":
      return `🔴 **${titulo}**\n　Precio antes: ${fmt(change.precioAnterior)} → **ahora: ${fmt(change.precio)}**${pct(change.precioAnterior, change.precio)}`;
    case "stock":
      return `📦 **${titulo}**\n　Stock antes: **${change.disponibleAnterior ? "disponible" : "agotado"}** → ahora: **${change.disponible ? "disponible" : "agotado"}**`;
    default:
      return titulo;
  }
}

const TITULOS = {
  nuevo: "🆕 Productos nuevos",
  baja: "🟢 Bajas de precio",
  sube: "🔴 Subas de precio",
  stock: "📦 Cambios de stock",
  eliminado: "❌ Ya no aparecen",
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
function armarMensajes(encabezado, secciones) {
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

  const porTipo = { nuevo: [], baja: [], sube: [], stock: [], eliminado: [] };
  for (const c of changes) (porTipo[c.tipo] ?? porTipo.nuevo).push(lineFor(c));

  const resumen = `Revisados ${totalRevisado} productos · ${changes.length} cambios${errores > 0 ? ` · ${errores} paginas con error` : ""}`;
  const encabezado = `**Monitor de precios Samsung Chile**\n${resumen}`;

  const secciones = [
    ["baja", porTipo.baja],
    ["sube", porTipo.sube],
    ["stock", porTipo.stock],
    ["nuevo", porTipo.nuevo],
    ["eliminado", porTipo.eliminado],
  ];

  const mensajes = armarMensajes(encabezado, secciones);
  for (const mensaje of mensajes) {
    await enviarMensaje(webhookUrl, mensaje);
  }
}
