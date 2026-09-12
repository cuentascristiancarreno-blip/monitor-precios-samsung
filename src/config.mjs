export const USER_AGENT = "CazadorBot/1.0 (contacto: cuentascristiancarreno@gmail.com)";
// Pausa minima entre requests al mismo host. La politica del proyecto pide
// >= 2,5 s y el codigo decia 2.000: el sistema estaba fuera de su propia regla
// (lo levanto la revision del 2026-09-12). Cuesta ~10 min mas por corrida sobre
// las 1.183 paginas del recorrido, que caben de sobra en el presupuesto: las
// corridas reales tardan 169-210 min y el job corta a los 330. Ademas, el
// arreglo del tope de espera de precio de esta misma tanda (ver
// PRECIO_TIMEOUT_MS en src/extract.mjs) libera bastante mas que eso.
export const DELAY_MS = 2500;
export const SITE_ROOT = "https://www.samsung.com/cl/";

export const SITEMAPS = [
  "https://www.samsung.com/cl/im-sitemap.xml", // mobile
  "https://www.samsung.com/cl/vd-sitemap.xml", // TV / video / display
  "https://www.samsung.com/cl/da-sitemap.xml", // linea blanca / electrodomesticos
  "https://www.samsung.com/cl/assorted-sitemap.xml", // varios
];
