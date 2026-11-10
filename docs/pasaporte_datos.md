# Pasaporte del dato — cinco datos críticos

Ficha por dato crítico, según el documento final: significado, origen, transformaciones, responsable y controles. Se indica qué es real y qué es simulado en el prototipo.

| Dato crítico | Significado | Origen (piloto → prototipo) | Transformaciones | Responsable | Controles en el prototipo |
|---|---|---|---|---|---|
| Puntaje de autenticidad de rostro y voz | Señal de manipulación del interlocutor; señal principal | Integración con la videollamada → cuadros del navegador (~2/s) o video | YuNet localiza rostros; ViT puntúa cada recorte; máximo por cuadro; media de la llamada y de los últimos 16 cuadros; se usa la más desfavorable | Analítica VeriCall | Mínimo 4 cuadros con rostro y 50 % de cobertura; zona incierta 25–75; calidad (oscuro/congelado); modelo con hash fijado. **Voz no analizada.** |
| Perfil biométrico enrolado | Referencia de cada directivo autorizado | Enrolamiento presencial con consentimiento → `config/directory.json` (simulado) | Estado del perfil: enrolado, antigüedad en días, consentimiento | Seguridad TI del cliente | No enrolado, perfil > 365 días o consentimiento revocado fuerzan revisión; los perfiles vencidos aparecen como disparador. No hay cotejo facial con la referencia. |
| Historial de pagos del directivo | Montos y horarios habituales | ERP, sincronización diaria → monto habitual máximo y horario en el directorio (simulado) | Comparación con el monto y la hora de Bogotá de la solicitud | Tesorería del cliente | Monto sobre el límite: revisión obligatoria; atípico en monto u horario suma puntos. |
| Cuenta beneficiaria | Si la cuenta es nueva, extranjera o está en listas de fraude | Banca empresarial y listas → declaración del analista | Banderas booleanas | Tesorería del cliente | Cuenta nueva o en lista de fraude: revisión obligatoria. |
| Contexto de la conexión | Dispositivo, IP, ubicación, cámara virtual | Metadatos de la plataforma → declaración del analista | Banderas booleanas | VeriCall | Cámara virtual: revisión obligatoria; IP/VPN o dispositivo nuevo suman puntos. |

**Contrato de datos con el ERP (propuesto):** formato JSON por directivo (`id`, `name`, `title`, `is_cfo`, `enrolled_on`, `consent`, `registered_phone`, `habitual_max_amount`, `usual_hours`), sincronización diaria, responsable Tesorería del cliente, versión del archivo (`version`) registrada.

**Ante datos no confiables:** se aplica «sin evidencia suficiente no se autoriza» y la solicitud pasa a verificación por canal alterno al número registrado.
