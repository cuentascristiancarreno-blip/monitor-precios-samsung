// Lectura de numeros desde variables de entorno. Una sola implementacion para
// todo el proyecto.
//
// POR QUE EXISTE ESTE ARCHIVO (defecto real, 2026-09-11)
// `Number("")` es 0 y ademas es finito, asi que un `Number(process.env[X])`
// pelado trata una variable DEFINIDA PERO VACIA como un cero valido en vez de
// caer al valor por defecto. Y una variable vacia es exactamente lo que deja
// GitHub Actions cuando alguien escribe `env: DISCORD_PAUSA_MS: ${{ vars.ALGO }}`
// y esa variable de repositorio no existe.
//
// El costo de esa trampa no es teorico:
//   DISCORD_PAUSA_MS=""   -> recarga 0 -> `if (recarga <= 0) return` apaga el
//                            limitador de ritmo ENTERO: medido, 112 POST en la
//                            misma ventana de 2 s (Discord tolera ~5).
//   VIVO_MAX_CAMBIOS=""   -> Math.max(1, 0) = 1 cambio por mensaje: 300 cambios
//                            se van en 300 mensajes, justo lo que el diseno
//                            prohibe.
// Los tres modulos que leen entorno (run.mjs, discord.mjs, despachador-vivo.mjs)
// importan esta funcion para que no vuelvan a divergir.

/**
 * Numero desde una variable de entorno, con valor por defecto.
 * Una variable ausente, vacia, no numerica o negativa cae al valor por defecto.
 */
export function entorno(nombre, porDefecto) {
  const crudo = process.env[nombre];
  if (crudo === undefined || crudo === null || String(crudo).trim() === "") return porDefecto;
  const v = Number(crudo);
  return Number.isFinite(v) && v >= 0 ? v : porDefecto;
}
