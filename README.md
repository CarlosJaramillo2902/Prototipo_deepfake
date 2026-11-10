# VeriCall · verificación de deepfakes durante la videollamada

Prueba de concepto local, alineada con el **documento final del proyecto integrador**: VeriCall **monitorea en vivo** el rostro de quien llama y, cuando pide una transferencia, combina **cinco componentes** en un puntaje de 0 a 100 con sus **tres razones principales**, y recomienda autorizarla, verificarla por canal alterno o bloquearla. Después, una persona con autoridad toma la decisión final según la matriz del documento (analista, CFO u otro directivo), y todo queda en una bitácora encadenada por hashes. Un panel de **Gobierno y monitoreo** muestra las cinco métricas, los disparadores y el **modo seguro**. Principio rector: *sin evidencia suficiente no se autoriza*. YuNet localiza los rostros y un Vision Transformer entrenado los clasifica, en CPU (~40–60 ms por cuadro).

Hay dos modos:

- **Llamada en vivo** (pantalla inicial): tres fuentes posibles. **Simulación**: llamada entrante que reproduce un video público, original o deepfake, o **un video propio**. Este se reproduce solo en el navegador y no se sube; la bitácora guarda su SHA-256. **Cámara**: tu webcam como interlocutor real. **Zoom / Meet**: compartes la ventana de la videollamada real y VeriCall analiza a quien aparece en ella. **Cámara + deepfake**: haces de atacante. VeriCall cambia en vivo tu rostro por el de un actor del DeepFake Detection Dataset, o por la foto de alguien que lo autorizó, y analiza ese video como si fuera la llamada entrante (ver más abajo). El navegador envía ~2 cuadros por segundo; el servidor los analiza y los descarta, y solo conserva puntajes y posiciones de los rostros.
- **Analizar grabación**: el flujo anterior sobre un video completo (24 instantes).

## Abrir en este equipo

El entorno, los pesos y los seis videos ya están instalados en esta carpeta:

```bash
source .venv/bin/activate
python -m vericall.app
```

Abre **http://127.0.0.1:5000** (en Chrome; la cámara y la pantalla compartida exigen `127.0.0.1` o `localhost`).

### Guion sugerido para la sustentación (≈ 5 min)

La app tiene cuatro secciones: **Llamada · Grabación · Gobierno · Bitácora**. En *Llamada* hay seis **escenarios guiados** que precargan el video, el solicitante y el pago, y explican qué enseña cada uno (editables en `config/scenarios.json`). La pestaña *Configurar* permite elegir la fuente a mano: video de ejemplo, video propio, cámara, cámara con deepfake o Zoom/Meet.

1. **Ataque con deepfake.** Elige el escenario, marca la autorización y pulsa **Iniciar llamada** → **Contestar**. En segundos aparece el recuadro sobre el rostro, el medidor sube a rojo y salta la alerta «Posible deepfake».
2. **Solicitud de pago.** Pulsa **El interlocutor pide un pago** → **Evaluar solicitud**. El diálogo muestra *Bloquear y escalar*, el puntaje, las tres razones y, en *Cómo se calculó*, los cinco componentes.
3. **Control humano.** En *Decisión final* intenta liberar como *Analista*: el sistema lo impide, porque solo el **CFO** libera un bloqueo crítico. Frena el pago como *Seguridad TI* con una justificación escrita. La solicitud queda en la lista de la llamada y en la bitácora.
4. **Interlocutor real.** Finaliza, pulsa **Nueva llamada** y elige *Interlocutor real*: suele recomendar *Autorizar* y el analista confirma.
5. **Las reglas se imponen al puntaje.** *Deepfake que engaña al modelo*: el detector no lo ve, pero la cuenta nueva obliga a verificar. *Suplantación del CFO*: solo otro directivo puede liberar. *Falsa alarma*: el costo de un falso positivo.
6. **Haz tú de atacante.** Tu cámara se convierte en otra persona en vivo; muestra si el detector lo atrapa o no.
7. **Gobierno.** Tarjetas con las cinco métricas y su estado, disparadores y **modo seguro** (solo Riesgo de VeriCall). Actívalo con un motivo y muestra que todo pago nuevo pasa a verificación.
8. **Auditoría.** En *Bitácora*, «Bitácora íntegra» recalcula la cadena de hashes; cada fila abre su decisión (y permite resolver las pendientes) y se exporta en JSON.

Resultados medidos en vivo, con 2 cuadros por segundo sobre cada clip completo:

Videos de actores DFD, con fondo y encuadre de videollamada (análisis de 24 instantes; en vivo la señal varía según el momento):

| Llamada simulada | Señal | Uso sugerido |
|---|---:|---|
| Actor DFD 05 · Versión manipulada | 84 | Ataque que se bloquea |
| Actor DFD 03 · Versión manipulada | 80 | Ataque que se bloquea |
| Actor DFD 07 · Original | 11 | Interlocutor real que se autoriza |
| Actor DFD 07 · Versión manipulada | 53 | Ataque que va a verificación |
| Actor DFD 03 · Original | 50 | Original que va a revisión (falsa alarma leve) |
| Actor DFD 05 · Original | 69 | **Falso positivo**: un original casi bloqueado |

Avatares generativos de TalkingHeadBench (una foto fija animada con IA, el tipo de ataque de HeyGen u OmniHuman). De 12 clips evaluados (dos por generador, elegidos antes de mirar resultados), **ninguno superó 75** y cuatro quedaron bajo 25. El detector, entrenado con cambios de rostro, no generaliza a este tipo de deepfake:

| Llamada simulada | Señal | Uso sugerido |
|---|---:|---|
| Avatar · Hallo2 | 72 | Va a verificación |
| Avatar · LivePortrait | 72 | Va a verificación |
| Avatar · Hallo | 20 | **Pasa como real** |
| Avatar · AniPortrait | 12 | **Pasa como real** (escenario «Avatar generativo que pasa como real») |

Videos Unidata:

| Llamada simulada | Señal usada | Recomendación |
|---|---:|---|
| Persona 04 / 05 · Original | 19 | Autorizar: el analista confirma |
| Persona 01 · Original | 35 | Verificar por otro canal |
| Persona 01 · Manipulada | 70 (≥ 75 durante la alerta) | Verificar / Bloquear |
| Persona 05 · Manipulada | 60 | Verificar por otro canal |
| Persona 04 · Manipulada | 22 | **Autorizar: falso negativo** |

**Videos propios del grupo (recomendado).** Graben a un compañero hablando a cámara, como si pidiera la transferencia (video real), y hagan un cambio de rostro consentido con otro compañero (deepfake). En *Simulación → O usa un video propio* se cargan como llamada entrante. Para deepfakes famosos públicos, ábrelos en otra pestaña y usa *Zoom / Meet* para compartirla. Pruébalos antes de clase: el modelo puede no detectarlos.

Caso honesto para las preguntas: *Persona 04 · Versión manipulada* es el falso negativo conocido del modelo y en vivo **recibe recomendación de autorizar**. Muestra por qué la confirmación humana y el canal alterno son controles necesarios, no opcionales, y por qué el entregable 2 incluye la regla de montos y cuentas nuevas, que fuerza revisión sin importar el puntaje.

En **Analizar grabación**, selecciona una persona y su original o versión manipulada, declara autorización y pulsa **Analizar video**. También puedes subir MP4, MOV, AVI o WebM de hasta 100 MB y 2 minutos. El reproductor depende de los códecs del navegador; la decodificación para inferencia se hace con OpenCV.

### Cámara + deepfake (haz tú de atacante)

En *Llamada en vivo → Cámara + deepfake* elige un rostro de origen: los actores DFD 03, 05 o 07, que consintieron su uso en investigación, o la foto de alguien que lo autorizó, marcando la casilla. Pulsa **Iniciar monitoreo**. El navegador envía tu cámara al motor (~10–15 cuadros/s), recibe el cuadro con el rostro cambiado y ese lienzo pasa a ser la llamada: el detector analiza exactamente lo que transmitiría un atacante con una cámara virtual. La llamada muestra «DEEPFAKE SIMULADO»; la bitácora registra el rostro de origen (actor o SHA-256 de la foto) y la cuenta como ataque simulado en el tablero de gobierno. Las imágenes viven solo en memoria.

**Motor clásico** (`vericall/faceswap.py`, OpenCV): YuNet da 5 puntos del rostro, una transformación de similitud alinea el origen, se iguala el color en LAB y se funde con una máscara difuminada. Sigue la posición y el giro de tu cabeza, pero la boca del rostro de origen no se mueve. **El detector no siempre lo atrapa**: en pruebas, el rostro del actor 05 sobre el actor 03 dio 74, y el del actor 07, solo 8 (análisis sin conexión) y 37 en vivo. Es un buen ejemplo de por qué la regla «sin evidencia suficiente no se autoriza» y el canal alterno son necesarios. Un intercambio neuronal, como InsightFace *inswapper*, sería más realista; no está incluido porque requiere descargar pesos de terceros con licencia no comercial.

## Instalar en otro equipo

Python 3.11 o posterior, con ruedas de PyTorch/OpenCV disponibles para el sistema. Verificado en macOS Apple Silicon con Python 3.13.9 y CPU. No se requieren cuentas, claves ni APIs de pago.

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
python scripts/download_assets.py
python -m vericall.app
```

En Windows activa con `.venv\Scripts\activate`. La descarga inicial contiene unos 343 MB de pesos, 0,23 MB del localizador de rostros y 20 MB de videos. El script reutiliza archivos íntegros y verifica SHA-256. El análisis posterior funciona sin Internet. Los binarios descargados están excluidos de Git; el manifiesto permite reconstruirlos.

## Qué hace el detector

1. Valida el video y decodifica 24 instantes distribuidos uniformemente.
2. Localiza hasta cuatro rostros por instante y clasifica sus recortes con pesos Safetensors locales.
3. Toma el máximo por rostro en cada instante y calcula la media temporal. Conserva los resultados individuales para inspección.
4. La clasificación binaria usa 0,5. Además, la zona 0,25–0,75 se trata como incierta para la decisión. Menos de cuatro instantes con rostros o cobertura inferior al 50 % produce evidencia insuficiente.
5. Combina los cinco componentes del documento final y guarda el resultado antes de mostrarlo. Bandas: 0–30 aceptar (el analista confirma); 31–70 revisar por canal alterno; 71–100 rechazar (bloqueo y escalamiento a seguridad).

| Componente | Señales en el prototipo | Puntos |
|---|---|---|
| Autenticidad de rostro y voz | Señal del ViT (0–100); video congelado u oscuro +10; varios rostros, zona incierta o sin evidencia fuerzan revisión. **La voz no se analiza.** | 0–100 |
| Coincidencia con el perfil enrolado | No enrolado +20 y revisión; perfil con más de un año +10 y revisión; consentimiento revocado: no se usa biometría y revisión | 0–20 |
| Anomalía frente al historial | Monto sobre el límite del cliente +25 y revisión; mayor que el habitual del directivo +15; fuera de su horario +10 | 0–50 |
| Riesgo de la cuenta | Cuenta nueva +25 y revisión; extranjera +10; en listas de fraude +50 y revisión | 0–85 |
| Riesgo de la conexión | Cámara virtual +30 y revisión; IP/ubicación/VPN inusual +15; dispositivo nuevo +10 | 0–55 |

El total se limita a 100. El directorio de directivos (`config/directory.json`) simula el enrolamiento, el número registrado y el historial del ERP; el contexto de cuenta y conexión lo declara el analista. Los pesos son preliminares y están versionados (`risk-v4.0`, `umbrales-v1.0-documento-final`).

En vivo, la señal se recalcula con cada cuadro sobre una ventana de los últimos 16 cuadros (~8 s). Al evaluar una transferencia se usa **la evidencia más desfavorable** entre toda la llamada y esa ventana. Así, un ataque que empieza a mitad de la llamada no queda diluido por los minutos anteriores.

### Decisión humana final y bitácora

| Recomendación | Quién puede liberar el pago | Requisito |
|---|---|---|
| Autorizar (0–30) | Analista de tesorería (o CFO) | Confirmación del analista |
| Verificar por otro canal (31–70 o regla obligatoria) | Analista de tesorería (o CFO) | Verificación alterna exitosa al número registrado, nunca a uno dado en la llamada |
| Bloquear y escalar (71–100) | Solo el CFO; si el solicitante es el CFO, otro directivo autorizado | Verificación alterna, persona distinta del analista que pidió la evaluación y de la persona suplantada |

Cualquier rol (incluida Seguridad TI) puede frenar un pago. Toda resolución exige justificación escrita, salvo confirmar un riesgo bajo; apartarse de la recomendación cuenta en la *tasa de desacuerdo*. El **modo seguro** solo lo activa o levanta el rol *Riesgo de VeriCall*, con motivo, y queda en la misma cadena de hashes. Cada decisión admite una sola resolución inmutable, que registra el tiempo transcurrido frente al objetivo de 15 minutos. Cada registro guarda el hash del anterior: `GET /api/audit/verify` recalcula la cadena y señala el primer registro alterado. Los roles se declaran sin autenticación; es una limitación del prototipo.

El puntaje visual **no es una probabilidad calibrada de fraude**. La clasificación «original» no verifica identidad. Un video sin rostros tampoco se considera auténtico. El modelo trabaja sobre imágenes: no analiza audio, voz ni sincronía labial y puede omitir deepfakes nuevos o bien elaborados.

## Resultados reales de la demostración

Se eligieron los IDs 1, 4 y 5 del dataset por tamaño de descarga antes de observar las predicciones. Se evaluaron los seis archivos, sin ocultar el caso fallado:

| Muestra | Referencia del editor | Señal de manipulación | Clasificación del modelo |
|---|---|---:|---|
| `real_01` | Original | 33,6/100 | Original, zona incierta |
| `fake_01` | Deepfake | 70,4/100 | Deepfake, zona incierta |
| `real_04` | Original | 19,4/100 | Original |
| `fake_04` | Deepfake | 21,7/100 | **Original: falso negativo** |
| `real_05` | Original | 20,9/100 | Original |
| `fake_05` | Deepfake | 57,4/100 | Deepfake, zona incierta |

Coinciden cinco clasificaciones de seis; detecta dos de tres deepfakes. Este resultado es una demostración pequeña de desarrollo, **no una estimación válida del desempeño real**. La interfaz muestra la discrepancia en `fake_04`. El [informe completo](reports/sample_evaluation.json) conserva las salidas por instante, hashes, modelo y revisión.

## Pruebas y reevaluación

```bash
python -m pytest -q                 # Controles, errores, cola y bitácora
python -m pytest -q --run-model     # También inferencia real, sin red
python scripts/evaluate_samples.py # Reevalúa los seis videos e incluye todos los errores
```

Prueba opcional de navegador:

```bash
python -m pip install -r requirements-dev.txt
python -m playwright install chromium
python scripts/browser_smoke.py
```

Si ya tienes Chrome en macOS, puedes evitar descargar Chromium:

```bash
python scripts/browser_smoke.py --chrome '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
```

## Estructura

```text
vericall/
  app.py              API y servidor local
  detector.py         YuNet y ViT; verificación y carga local de pesos
  pipeline.py         Muestreo, rostros, inferencia y agregación
  live.py             Sesiones de llamada en vivo, ventana reciente y evidencia
  faceswap.py         Deepfake de demostración sobre la cámara propia (motor clásico, en memoria)
  decision.py         Cinco componentes, reglas, matriz de autoridad y modo seguro
  governance.py       Tablero: cinco métricas, disparadores, monitoreo y versiones
  jobs.py             Cola acotada y progreso
  audit.py            SQLite de solo inserción encadenado por hashes
  static/             Interfaz, reproductor y gráfico de resultados
config/assets.json    URLs exactas, revisiones, hashes y etiquetas de referencia
config/directory.json Directorio simulado de directivos enrolados (perfil, consentimiento, historial)
sample_data/public/   Seis videos descargados, sin modificar (fuera de Git)
sample_data/videos/   Figuras sintéticas para pruebas de ausencia de rostros
models/               Pesos locales descargados (fuera de Git)
scripts/              Descarga, evaluación y prueba de navegador
tests/                Pruebas automáticas
reports/              Evaluación reproducible de las seis muestras
docs/                 Fuentes académicas, alcance y matriz de trazabilidad
instance/             Bitácora local, fuera de Git
```

## Fuentes, privacidad y operación

- Avatares: [TalkingHeadBench](https://huggingface.co/datasets/luchaoqi/TalkingHeadBench) (arXiv 2505.24866), licencia MIT. Los rostros de origen provienen de FFHQ y la animación de CelebV-HQ, cuyas licencias limitan el uso a investigación no comercial. Son fotos de Flickr animadas: no son personas que consintieron participar, así que se usan solo para la demostración académica, con atribución.
- Para deepfakes con **voz clonada (ElevenLabs)** y personas que consintieron frente a su webcam, el conjunto ideal es [DeepSpeak v2](https://huggingface.co/datasets/faridlab/deepspeak_v2) (Barrington, Farid et al.; arXiv 2408.05366). Es gratuito para instituciones académicas, pero requiere llenar el [formulario de acceso](https://forms.gle/4bQCRJdpVQPmgEY2A) y esperar aprobación.
- Videos DFD: [DeepFake Detection Dataset de Google/Jigsaw](https://research.google/blog/contributing-data-to-deepfake-detection-research/), actores pagados con consentimiento. Se usan seis clips (actores 03, 05 y 07, escena *talking_against_wall*) desde la copia `angads24/deepfake-video` de Hugging Face, **no oficial**. El original se distribuye bajo los [términos de FaceForensics++](https://github.com/ondyari/FaceForensics), solo para investigación no comercial; para un uso más allá de la sustentación, pide el acceso oficial. Selección: se evaluó el primer deepfake de los actores 01, 02, 03, 05, 06 y 07 y se eligieron estos tres pares para la demostración. Es una selección declarada, no una medida de desempeño.
- Videos: [Unidata / ud-biometrics](https://huggingface.co/datasets/ud-biometrics/deepfake-dataset), licencia publicada CC BY-NC-ND 4.0. Se conservan bytes originales para esta demostración académica. Detalles en [sample_data/README.md](sample_data/README.md).
- Clasificador: [prithivMLmods/Deep-Fake-Detector-v2-Model](https://huggingface.co/prithivMLmods/Deep-Fake-Detector-v2-Model), Apache-2.0.
- Localizador: [OpenCV YuNet](https://github.com/opencv/opencv_zoo/tree/main/models/face_detection_yunet), licencia MIT del directorio del modelo.
- Los videos subidos se eliminan al terminar el trabajo, incluso al fallar. No se guardan recortes, miniaturas ni video en SQLite. Los seis ejemplos públicos permanecen como archivos de prueba. La bitácora sí conserva monto, declaraciones, métricas, hashes y resultados.
- La cola permite tres trabajos pendientes y una inferencia simultánea. Los estados temporales expiran a los 30 minutos; los informes permanecen en la bitácora.
- En vivo, los cuadros se procesan en memoria y se descartan. Las sesiones expiran tras 10 minutos sin actividad; hay como máximo tres llamadas simultáneas.
- La aplicación es local, sin autenticación multiusuario. La verificación alterna es una declaración de quien resuelve, no una comunicación comprobada. La integración con Zoom/Meet es por pantalla compartida, no por la API de la plataforma. No hay integración bancaria ni análisis de audio.
- La cadena de hashes detecta ediciones o borrados intermedios, pero no el borrado de los últimos registros ni la reescritura completa de la base. Para eso haría falta anclar el último hash fuera del equipo.

La base de datos está en `instance/vericall.sqlite3`. Las opciones de [.env.example](.env.example) se establecen con variables de entorno; el archivo no se carga automáticamente. Si el puerto 5000 está ocupado, ejecuta `VERICALL_PORT=5001 python -m vericall.app`. Si faltan o fallan hashes de archivos, repite `python scripts/download_assets.py`. Si una descarga falla, el script elimina el archivo parcial y reintenta; conserva las descargas correctas. La primera inferencia carga el modelo en memoria.

El JSONL de la versión anterior, si existe, permanece intacto; la interfaz nueva usa SQLite y no importa automáticamente ese historial.

## Relación con el proyecto final

La [revisión de fuentes y alcance](docs/proyecto_y_alcance.md) identifica lo ya definido en los dos entregables y los trabajos restantes. La [matriz de trazabilidad](docs/trazabilidad.md) vincula esta implementación con sesiones 3 y 4, escrito final y sustentación. El [diseño del detector](docs/modelo_y_validacion.md) distingue sus capacidades, supuestos y límites. Faltan validación independiente representativa, evaluación de sesgos, audio/identidad e integración y gobierno aprobados antes de un piloto organizacional.
