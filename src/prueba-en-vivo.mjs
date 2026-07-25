// Prueba rapida y manual: corre el pipeline real contra un punado de URLs
// (no las 1023) para verificar que la extraccion funciona antes de publicar.
// No se commitea al repo final (es solo para verificacion en este momento).
import { chromium } from "playwright";
import { USER_AGENT } from "./config.mjs";
import { extractFamilyVariants, extractSingleProduct } from "./extract.mjs";

const CASOS = [
  { tipo: "familia", url: "https://www.samsung.com/cl/smartphones/galaxy-s25/buy/" },
  { tipo: "individual", url: "https://www.samsung.com/cl/mobile-accessories/galaxy-s25-silicone-case-black-ef-ps931cbegww/" },
  { tipo: "individual", url: "https://www.samsung.com/cl/home-appliance-accessories/air-conditioners-accessories-ar-kh00e/" },
];

async function main() {
  const browser = await chromium.launch();
  const context = await browser.newContext({ userAgent: USER_AGENT });

  for (const caso of CASOS) {
    console.log(`\n=== ${caso.tipo}: ${caso.url}`);
    if (caso.tipo === "familia") {
      const res = await fetch(caso.url, { headers: { "User-Agent": USER_AGENT } });
      const variants = extractFamilyVariants(await res.text());
      console.log(`  ${variants.length} variantes encontradas`);
      console.log(variants.slice(0, 3));
    } else {
      const page = await context.newPage();
      await page.goto(caso.url, { waitUntil: "load", timeout: 30000 });
      const result = await extractSingleProduct(page, caso.url);
      console.log(result);
      await page.close();
    }
  }

  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
