const CLP = new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 });

function fmt(n) {
  return typeof n === "number" ? CLP.format(n) : "?";
}

function lineFor(change) {
  const nombre = change.nombre || change.modelo;
  switch (change.tipo) {
    case "nuevo":
      return `**Nuevo** ${nombre} (${change.modelo}) — ${fmt(change.precio)}`;
    case "eliminado":
      return `**Ya no aparece** ${nombre} (${change.modelo}) — ultimo precio visto: ${fmt(change.precioAnterior)}`;
    case "baja":
      return `**Baja de precio** ${nombre} (${change.modelo}) — ${fmt(change.precioAnterior)} → ${fmt(change.precio)}`;
    case "sube":
      return `**Sube de precio** ${nombre} (${change.modelo}) — ${fmt(change.precioAnterior)} → ${fmt(change.precio)}`;
    case "stock":
      return `**Cambio de stock** ${nombre} (${change.modelo}) — ${change.disponibleAnterior ? "disponible" : "agotado"} → ${change.disponible ? "disponible" : "agotado"}`;
    default:
      return `${nombre} (${change.modelo})`;
  }
}

export async function notifyDiscord(webhookUrl, { changes, errores, totalRevisado }) {
  if (!webhookUrl) {
    console.log("DISCORD_WEBHOOK_URL no configurado, no se envia notificacion.");
    return;
  }
  if (changes.length === 0) return; // sin novedades, no molestar

  const orden = { nuevo: 0, baja: 1, sube: 2, stock: 3, eliminado: 4 };
  changes.sort((a, b) => (orden[a.tipo] ?? 9) - (orden[b.tipo] ?? 9));

  const MAX_LINEAS = 40;
  const lineas = changes.slice(0, MAX_LINEAS).map(lineFor);
  if (changes.length > MAX_LINEAS) {
    lineas.push(`… y ${changes.length - MAX_LINEAS} cambios mas (ver historial en el repo).`);
  }

  const resumen = `Revisados ${totalRevisado} productos · ${changes.length} cambios${errores > 0 ? ` · ${errores} paginas con error` : ""}`;

  const content = [`**Monitor de precios Samsung Chile**`, resumen, "", ...lineas].join("\n").slice(0, 1900);

  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
  });

  if (!res.ok) {
    console.error(`Fallo el envio a Discord: ${res.status} ${await res.text()}`);
  }
}
