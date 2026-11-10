# Trazabilidad académica — versión 4 (documento final)

Fuente: *Documento final – proyecto integrador VeriCall* (Grupo 1). Esta matriz vincula cada sección con lo que el prototipo implementa y con lo que queda fuera de su alcance. Los pesos de los componentes son preliminares, igual que los umbrales del documento.

| Sección del documento final | Evidencia implementada | Qué falta para un piloto |
|---|---|---|
| 2. Decisión crítica: autorizar o bloquear hasta verificar por canal alterno | Recomendación en vivo durante la llamada (`live.py`) y en grabaciones; la persona confirma (`decision.resolve`) | Integración por API con Zoom/Teams/Meet y con el sistema de pagos. |
| 3. Criterios: bandas 0–30 / 31–70 / 71–100 | `decision.band`, versión `umbrales-v1.0-documento-final` en cada registro | Firma del CFO del cliente sobre los umbrales. |
| 3. Cuenta nueva o monto sobre el límite fuerza revisión | Reglas `new_beneficiary` y `over_limit`, con cualquier puntaje | Contrastar con ERP y banca reales. |
| 3. Cinco métricas con bandas aceptable/alerta/crítico | `governance.dashboard`: fraude detenido, fricción, oportunidad, trazabilidad; equidad «sin medir» | Ataques simulados mensuales representativos y pruebas con perfiles diversos. |
| 4. Cinco datos críticos | Señal del modelo; perfil enrolado y consentimiento (`config/directory.json`); historial (monto y horario habituales); cuenta (nueva, extranjera, lista de fraude); conexión (cámara virtual, IP/VPN, dispositivo) | Datos reales; hoy el perfil, el historial y la conexión son simulados o declarados. Ver [pasaporte del dato](pasaporte_datos.md). |
| 4. «Sin evidencia suficiente no se autoriza»; no enrolado va a revisión | Sin rostros suficientes, zona incierta, calidad deficiente, varios rostros, no enrolado, perfil vencido (> 1 año) o consentimiento revocado fuerzan revisión | Reconocimiento facial contra la referencia enrolada y análisis de voz. |
| 4. Trazabilidad: ID único, datos, versión de modelo y umbral, puntajes, acción y justificación | Registro encadenado por hashes con todo lo anterior; `/api/audit/verify`; exportación JSON por ID | Anclaje externo del último hash y conciliación diaria de pagos sin ID. |
| 4. No se aceptan cambios sin justificación escrita | Toda resolución exige justificación salvo confirmar un riesgo bajo | — |
| 4. Se conserva la huella del archivo y las señales, no el video | SHA-256 del video; cuadros y recortes se descartan en memoria | Cifrado y política de retención aprobada. |
| 5. Cinco componentes y tres razones principales | `decision.evaluate`: `components` y `top_reasons` | Calibrar pesos con costos y casos reales. |
| 5. La automatización solo frena; matriz por banda | Analista libera 0–70 (31–70 con canal alterno); 71–100 solo el CFO, u otro directivo si el solicitante es el CFO; segregación frente al analista y a la persona suplantada | Doble autenticación y permisos por rol (hoy los roles se declaran). |
| 6. Riesgos R1–R3 y secundarios | R1: falso negativo `fake_04` visible; confianza ciega: tasa de desacuerdo; saturación: cola acotada y pendientes en el tablero | R2 (referencia comprometida) y R3 (filtración) requieren controles de infraestructura. |
| 7. Disparadores y modo seguro | Métricas críticas, fraude simulado liberado y perfiles vencidos generan disparadores; modo seguro solo por Riesgo VeriCall, con motivo, en la bitácora; mientras está activo todo pago va a revisión | Notificación real al comité de riesgo y al CFO. |
| 7. Vallas permanentes | Nunca se autoriza un puntaje > 70 (verificación en código); cola llena rechaza en lugar de aprobar; versiones de reglas, umbrales y modelo en cada registro | Flujo formal de aprobación de cambios de modelo. |
| 8. RACI y derechos del titular | Matriz visible en el panel de gobierno; consentimiento revocado excluye la biometría y envía el pago al canal alterno | Contrato y matriz firmados; procedimiento de revocación. |
| 9. Condiciones de implementación | El tablero muestra qué condiciones se miden y cuáles no | Piloto en paralelo (recomienda pero no bloquea) con criterio de salida. |

Los resultados de seis ejemplos ilustran el mecanismo y sus límites. No validan el 98 % de fraude detenido ni las demás metas del documento final.
