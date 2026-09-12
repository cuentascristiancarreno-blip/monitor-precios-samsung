// El precio que se vigila tiene que ser el que el cliente VE en la ficha.
// Caso real reportado por el operador el 2026-08-03: el pack
// "Watch Ultra (2025) Blue + Galaxy Buds4 Pro" (F-SMR640SML70) publicaba
// model_price=555980, un numero que NO aparece en ninguna parte de la pagina,
// mientras el cliente veia $974.980 (= list_price). El monitor avisaba bajadas
// de un precio inexistente.
import { test } from "node:test";
import assert from "node:assert/strict";
import { precioDelBloqueCompra, precioVisiblePreferido } from "../src/extract.mjs";

// texto real de la ficha del pack: solo aparecen la cuota y el precio de venta
const TEXTO_PACK = "Watch Ultra (2025) Blue + Galaxy Buds4 Pro\nDesde $ 81.248 en 12 cuotas sin intereses* o $974.980\nAvísame";
// producto normal: el precio de venta y el tachado, ambos visibles
const TEXTO_NORMAL = "Galaxy S26 Ultra\n$1.199.990\nAntes $1.549.990\nComprar";

test("el caso del pack: gana el precio que el cliente ve, no el interno", () => {
  assert.equal(precioVisiblePreferido(555980, 974980, TEXTO_PACK), 974980);
});

test("producto normal con descuento: se respeta el precio de venta, no el tachado", () => {
  assert.equal(precioVisiblePreferido(1199990, 1549990, TEXTO_NORMAL), 1199990);
});

test("sin list_price valido no se toca nada", () => {
  for (const lp of [undefined, null, NaN, 0, -1, ""]) {
    assert.equal(precioVisiblePreferido(555980, Number(lp), TEXTO_PACK), 555980);
  }
});

test("si la pagina no muestra NINGUNO de los dos, no se inventa un precio", () => {
  // pagina a medio renderizar: se conserva el model_price de siempre
  assert.equal(precioVisiblePreferido(555980, 974980, "cargando..."), 555980);
  assert.equal(precioVisiblePreferido(555980, 974980, ""), 555980);
  assert.equal(precioVisiblePreferido(555980, 974980, null), 555980);
});

test("el monto se busca con formato chileno y tolera los espacios de la pagina", () => {
  assert.equal(precioVisiblePreferido(999, 974980, "precio $ 974.980 hoy"), 974980, "acepta espacio despues del $");
  assert.equal(precioVisiblePreferido(999, 974980, "precio $974.980"), 974980, "acepta sin espacio");
  assert.equal(precioVisiblePreferido(999, 974980, "precio 974980 sin puntos"), 999, "no confunde un numero sin formato");
});

test("no se cambia el precio cuando ambos montos son iguales", () => {
  // packs de aire acondicionado medidos: model_price == list_price
  assert.equal(precioVisiblePreferido(1395980, 1395980, "valor $1.395.980"), 1395980);
});

// --- el precio que el cliente PAGA, leido del bloque (medido 2026-09-12) -----

test("del bloque de compra sale el precio cobrado, no la cuota ni el tachado", () => {
  // textos LITERALES de fichas reales
  assert.equal(
    precioDelBloqueCompra("Desde $ 48.333 en 12 cuotas sin intereses* o $579.990 Precio original: $839.990 Ahorra $ 260.000 *Aplican condiciones Comprar"),
    579990,
  );
  assert.equal(
    precioDelBloqueCompra("Desde $ 39.999 en 12 cuotas sin intereses* o $479.990 Precio original: $649.990 Ahorra $ 170.000 *Aplican condiciones Comprar ahora"),
    479990,
  );
  assert.equal(
    precioDelBloqueCompra("Desde $ 41.249 en 12 cuotas sin intereses* o $494.990 Precio original: $549.989 Ahorra $ 54.999 *Aplican condiciones Comprar ahora"),
    494990,
  );
  // sin descuento, y con espacio despues del signo
  assert.equal(precioDelBloqueCompra("Desde $ 19.166 en 12 cuotas sin intereses* o $ 229.990 *Aplican condiciones Agregar al carro"), 229990);
  // millones
  assert.equal(precioDelBloqueCompra("Desde $ 370.635 en 12 cuotas sin intereses* o $4.447.625 *Aplican condiciones Avísame"), 4447625);
});

test("si el bloque no trae la frase, no inventa un precio", () => {
  for (const t of [null, undefined, "", "Comprar ahora", "Dónde comprar", "Ahorra $ 260.000", "Buying Tool Galaxy Tab S11 Desde $ 1.169.990"]) {
    assert.equal(precioDelBloqueCompra(t), null, JSON.stringify(t));
  }
});

test("un bloque con saltos de linea se lee igual (es el innerText real)", () => {
  // innerText literal, con sus saltos: se usa una plantilla para no escribirlos escapados
  const innerText = `Desde $ 46.666 en 12 cuotas sin intereses* o $ 559.990
Precio original:
$ 839.990
Ahorra $ 280.000
*Aplican condiciones
Agregar al carro`;
  assert.equal(precioDelBloqueCompra(innerText), 559990);
});
