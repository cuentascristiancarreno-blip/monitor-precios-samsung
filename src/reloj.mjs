// Reloj inyectable. Todo lo que espera o mide tiempo en el camino de avisos
// (el limitador de ritmo de Discord y la ventana de la cola en vivo) pasa por
// aca, para que las pruebas puedan simular 3 minutos de envios en milisegundos
// sin dormir de verdad y sin tocar jamas el webhook real.
//
// En produccion son Date.now() y setTimeout, tal cual.
export const reloj = {
  ahora: () => Date.now(),
  dormir: (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms))),
};

/** Reloj virtual para pruebas: avanza solo cuando alguien "duerme". */
export function relojVirtual() {
  const original = { ahora: reloj.ahora, dormir: reloj.dormir };
  let t = 0;
  reloj.ahora = () => t;
  reloj.dormir = async (ms) => {
    t += Math.max(0, ms);
  };
  return {
    ahora: () => t,
    avanzar: (ms) => {
      t += ms;
    },
    restaurar: () => {
      reloj.ahora = original.ahora;
      reloj.dormir = original.dormir;
    },
  };
}
