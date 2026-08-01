// Productos que NO se notifican por Discord, por decisión del operador.
//
// IMPORTANTE, para no repetir el error que costó ~150 avisos falsos (BITACORA.md):
// silenciar es SOLO dejar de mandar el mensaje. El producto sigue entrando al
// catálogo (data/latest.json), al historial (data/history.jsonl) y a todas las
// comparaciones. Si se lo excluyera antes, comparar() lo vería ausente, le
// contaría ausencias y en 2 corridas lo declararía desaparecido.
// Por eso el filtro se aplica en run.mjs DESPUÉS de escribir catálogo e
// historial, en la misma línea donde se filtran los accesorios.
//
// Para reactivar un producto: borrar (o comentar) su regla de esta lista. El
// historial de precios de todo el período silenciado sigue guardado, así que no
// se pierde nada.

export const REGLAS_SILENCIO = [
  {
    id: "book3",
    // Pedido del operador el 2026-08-01: "el producto Book3 y todas sus
    // variantes Book3, no vuelvas a notificarlas hasta que te indique lo
    // contrario".
    motivo: "Silenciado a pedido del operador (2026-08-01) — reactivar cuando lo indique",
    // Por NOMBRE: cubre "Galaxy Book3", "Galaxy book3 360", "Galaxy Book3 Pro",
    // "Galaxy Book3 Pro 360" y cualquier variante futura, sin tocar Book2,
    // Book4, Book5 ni Book 6 (el \b y el 3 explícito los dejan fuera).
    nombre: /\bbook\s*3\b/i,
    // Por CÓDIGO: respaldo por si Samsung publica una variante con otro nombre.
    // Son los prefijos de modelo de la familia Book3 medidos en el catálogo y en
    // la propia API de Samsung (incluye NP940XFG, que aparece al separar las
    // fichas fusionadas del Book3 Pro).
    modelos: [/^NP730QFG/i, /^NP750QFG/i, /^NP750XFG/i, /^NP960XFG/i, /^NP960QFG/i, /^NP940XFG/i],
  },
];

/**
 * ¿Este cambio corresponde a un producto silenciado?
 * Se evalúa contra el nombre y el código de modelo. Un registro fusionado
 * ("NP750QFG-KB2CL,NP750XFG-KB4CL") queda cubierto porque basta con que UNO de
 * sus códigos coincida.
 */
export function estaSilenciado(cambio) {
  const nombre = String(cambio?.nombre ?? "");
  const codigos = String(cambio?.modelo ?? "")
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);

  return REGLAS_SILENCIO.some((regla) => {
    if (regla.nombre && regla.nombre.test(nombre)) return true;
    return (regla.modelos ?? []).some((re) => codigos.some((c) => re.test(c)));
  });
}

/** Para el log de la corrida: qué se silenció y por qué regla. */
export function resumirSilenciados(cambios) {
  const porRegla = new Map();
  for (const c of cambios) {
    for (const regla of REGLAS_SILENCIO) {
      const nombre = String(c?.nombre ?? "");
      const codigos = String(c?.modelo ?? "").split(",").map((x) => x.trim());
      const calza = (regla.nombre && regla.nombre.test(nombre)) || (regla.modelos ?? []).some((re) => codigos.some((x) => re.test(x)));
      if (calza) {
        porRegla.set(regla.id, (porRegla.get(regla.id) ?? 0) + 1);
        break;
      }
    }
  }
  return porRegla;
}
