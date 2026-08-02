// El precio de samsung.com/cl NO viene en el HTML: la pagina se lo pide a
// api.shop.samsung.com y hasta que responde, digitalData.model_price vale el
// relleno "0,0". Medido en vivo el 2026-08-01: load a los 739 ms, precio a los
// 827 ms. Leerlo sin esperar daba el producto por inexistente y a las 2 corridas
// se anunciaba "desaparecido" (48 avisos falsos, el ciclo del Galaxy Book3).
import { test } from "node:test";
import assert from "node:assert/strict";
import { extractSingleProduct } from "../src/extract.mjs";
import { comparar } from "../src/comparar.mjs";

// Doble de una pagina de Playwright: el precio "llega" tras N llamadas.
function paginaFalsa({ precios, model_code = "NP750QFG-KB2CL", displayName = "Galaxy Book3 360" }) {
  let i = 0;
  const estado = () => ({ model_price: precios[Math.min(i, precios.length - 1)], model_code, displayName });
  return {
    evaluaciones: 0,
    async waitForFunction(fn, { timeout }) {
      // emula el sondeo del navegador: avanza el reloj falso hasta que el precio
      // sea valido, o se agota el tiempo
      for (let intento = 0; intento < precios.length; intento++) {
        const n = Number(String(estado().model_price ?? "").replace(",", "."));
        if (Number.isFinite(n) && n > 0) return;
        i++;
      }
      throw new Error(`timeout ${timeout}`);
    },
    async evaluate(fn) {
      this.evaluaciones++;
      const salida = fn.length === 0 ? fn() : fn(undefined);
      // el modulo llama a evaluate para digitalData, para el texto del body y
      // para las especificaciones; solo nos importa el primero
      return salida === undefined ? { ...estado() } : salida;
    },
  };
}

// version minima: devuelve digitalData en el primer evaluate, "" en el resto
function paginaConPrecio(precios, extra = {}) {
  let i = 0;
  let llamadas = 0;
  const actual = () => precios[Math.min(i, precios.length - 1)];
  return {
    async waitForFunction(_fn, { timeout }) {
      for (let k = 0; k < precios.length; k++) {
        const n = Number(String(actual() ?? "").replace(",", "."));
        if (Number.isFinite(n) && n > 0) return;
        i++;
      }
      const n = Number(String(actual() ?? "").replace(",", "."));
      if (!(Number.isFinite(n) && n > 0)) throw new Error(`timeout ${timeout}`);
    },
    async evaluate() {
      llamadas++;
      if (llamadas === 1) return { model_price: actual(), model_code: "SKU-1", displayName: "Producto", ...extra };
      if (llamadas === 2) return "texto de la pagina";
      return {};
    },
  };
}

test("espera a que el precio llegue en vez de leer el relleno '0,0'", async () => {
  // la pagina devuelve "0,0" dos veces y despues el precio real
  const page = paginaConPrecio(["0,0", "0,0", "1399990"]);
  const r = await extractSingleProduct(page, "https://x/p");
  assert.equal(r.precio, 1399990, "debe leer el precio que llega tarde, no el relleno");
});

test("acepta el precio con coma decimal", async () => {
  const page = paginaConPrecio(["1399990,0"]);
  const r = await extractSingleProduct(page, "https://x/p");
  assert.equal(r.precio, 1399990);
});

test("si el precio sigue en el relleno '0,0' (cargando), LANZA para proteger al producto", async () => {
  const page = paginaConPrecio(["0,0"]);
  await assert.rejects(
    () => extractSingleProduct(page, "https://x/p"),
    /precio no disponible/,
    "debe lanzar para que la pagina cuente como fallida y el producto quede protegido",
  );
});

test("una pagina que NUNCA publica precio devuelve null rapido, sin lanzar ni reintentar", async () => {
  // valores reales medidos el 2026-08-02: el filtro de purificador publica "NaN"
  // y el kit receptor "0", de forma permanente. Son ~150 paginas por corrida:
  // hacerlas esperar y reintentar pasaba la corrida de las 4 h y GitHub la
  // mataba sin dejar datos ni avisos.
  for (const valor of ["NaN", "0", "", null]) {
    const page = paginaConPrecio([valor]);
    const r = await extractSingleProduct(page, "https://x/p");
    assert.equal(r, null, `con model_price=${JSON.stringify(valor)} debe devolver null sin lanzar`);
  }
});

test("una pagina sin producto identificable sigue devolviendo null (baja real)", async () => {
  // los monitores dados de baja redirigen a la categoria: no hay model_code
  const page = paginaConPrecio([""], { model_code: null });
  const sinCodigo = {
    async waitForFunction() {
      throw new Error("timeout");
    },
    async evaluate() {
      return { model_price: "", model_code: null, displayName: null };
    },
  };
  assert.equal(await extractSingleProduct(sinCodigo, "https://x/p"), null);
  void page;
});

test("el producto protegido conserva su ultimo dato bueno y NO se declara desaparecido", () => {
  // simula el flujo completo: la pagina fallo (precio tardio), asi que entra en
  // paginasFallidas y comparar() debe protegerlo
  const previo = {
    "SKU-1": {
      modelo: "SKU-1", nombre: "Galaxy Book3 360", precio: 1399990, disponible: true,
      url: "https://x/p", paginaOrigen: "https://x/p", categoria: "Computadores",
      estadoStock: "disponible", presencia: "activo", ausencias: 0,
    },
  };
  const paso1 = comparar({ previo, observado: {}, paginasFallidas: new Set(["https://x/p"]), corridaConfiable: true, timestamp: "T1" });
  assert.equal(paso1.cambios.length, 0, "no puede avisar nada");
  assert.equal(paso1.catalogo["SKU-1"].ausencias, 0, "la ausencia NO se cuenta");
  assert.equal(paso1.catalogo["SKU-1"].precio, 1399990, "conserva el precio bueno");

  // y aunque falle muchas corridas seguidas, jamas se declara desaparecido
  let estado = paso1.catalogo;
  for (let i = 0; i < 10; i++) {
    estado = comparar({ previo: estado, observado: {}, paginasFallidas: new Set(["https://x/p"]), corridaConfiable: true, timestamp: `T${i + 2}` }).catalogo;
  }
  assert.notEqual(estado["SKU-1"].presencia, "desaparecido");
});
