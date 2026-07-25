# Bitácora de auditoría — 2026-07-24 (sesión nocturna autónoma)

Registro de avance para poder retomar si la sesión se interrumpe.
Pedido del operador: auditoría completa del sistema, corregir fallas de diseño,
eliminar falsas alertas, agregar pruebas, validar con corrida real.

## Diagnóstico (con evidencia)

- **CRÍTICO — Falsas alertas de "ya no aparece"/"nuevo":** el conteo por corrida
  oscila entre 891 y 950 productos porque siempre hay 10-30 páginas con timeout.
  Todo producto cuya página falló se reportaba como "eliminado", y al volver a
  cargar bien, como "nuevo". Medido en `history.jsonl`: **77 episodios de
  parpadeo en 19 corridas (~150 avisos falsos en 4 días)**.
- **ALTO — Sin regla de confirmación:** un producto se daba por desaparecido con
  UNA sola ausencia, sin verificar que su página cargó bien ni que la corrida
  completa fue sana.
- **ALTO — Sin registro de ejecuciones:** no quedaba rastro de cuántas páginas
  fallaron por corrida ni si una corrida fue completa o parcial.
- **MEDIO — Stock frágil:** `disponible` se deduce buscando "agotado" en el
  texto de TODA la página (puede venir de productos relacionados) → alertas de
  stock falsas. Sin confirmación de 2 observaciones.
- **MEDIO — history.jsonl crece sin control:** ~900 líneas por corrida × 7
  corridas/día ≈ 2.5 MB/día en un repo git público. El snapshot completo ya
  queda en el historial git de latest.json — duplicado innecesario.
- **MEDIO — Duplicados familia/seed:** un modelo capturado por su página propia
  y por una página familia descubierta quedaba con categoría
  "Familia (auto-descubierta)", rompiendo el ícono y el filtro de accesorios.
- **BAJO — Sin reintentos:** una página con timeout se daba por perdida sin
  segundo intento.
- **BAJO — Conflictos de push:** si un push de código coincide con la corrida,
  el rebase de datos puede chocar (pasó 2 veces en la práctica).

## Plan

1. [x] Bitácora inicial (este archivo)
2. [x] `src/comparar.mjs`: lógica pura de comparación (testeable) con:
       presencia (activo/ausente/desaparecido/error_verificacion), confirmación
       de desaparición (≥2 corridas confiables), confirmación de stock (2
       observaciones), arrastre de datos cuando la página falló, categoría
       específica gana sobre "Familia".
3. [x] `src/run.mjs`: reintento único por página fallida, detección de corrida
       no confiable (muchos errores o caída >20% de productos), registro en
       `data/ejecuciones.jsonl`, history.jsonl pasa a registrar EVENTOS de
       cambio (no snapshots completos).
4. [x] `src/discord.mjs`: tipos nuevos (recuperado, desaparecido confirmado),
       diferencia en pesos + % en cambios de precio, alerta técnica cuando la
       corrida es sospechosa.
5. [x] Pruebas automatizadas (node:test): extracción, comparación, formato
       Discord. `npm test` + paso de test en el workflow.
6. [x] Workflow: `git add data/` completo, rebase `-X theirs`, npm test previo.
7. [x] Smoke test local con carpeta de datos temporal (sin tocar producción).
8. [x] Documentación: README + docs/auditoria-2026-07-24.md.
9. [x] Corrida real de validación disparada y verificada end-to-end.

## Estado: AUDITORÍA COMPLETA — los 9 pasos terminados (2026-07-25 05:20 UTC)

Resultado de la corrida real de validación (run 30141264929, commit 2841a05):
- success de punta a punta, 130 min, 1168 páginas, solo 13 errores finales
  (el reintento recuperó el resto — antes eran 10-30 por corrida).
- 944 productos capturados; catálogo final 951 con `presencia`/`estadoStock`
  en todos y 0 precios inválidos.
- 6 productos ausentes quedaron en observación SIN alerta falsa (con el
  sistema anterior habrían sido 12 avisos falsos: 6 "eliminado" + 6 "nuevo").
- 1 página fallida conservó su último dato bueno (presencia error_verificacion).
- Cambios reales detectados y notificados: 17 bajas de precio legítimas
  (ej. Galaxy Tab S10 con ~10% de descuento) + 1 producto nuevo.
- Corrida marcada confiable:true; pruebas 26/26 también en CI.
