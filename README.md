# Mapa GECAL — Estaciones de monitoreo atmosférico en Latinoamérica y el Caribe

Catálogo abierto y colaborativo de estaciones de calidad del aire y meteorología.
Cualquier persona carga una estación con un Google Form, el equipo de GECAL la revisa
y, una vez aprobada, aparece en el mapa.

```
Google Form ──► Hoja "Respuestas" ──(revisión)──► pestaña "publicadas" ──► script de validación ──► sitio (GitHub Pages)
   (público)      (privada: tiene correos)         (solo datos de estación)    scripts/actualizar_catalogo.py
```

## Estructura

| Carpeta / archivo | Qué es |
|---|---|
| `formulario/crear_formulario.gs` | Apps Script que crea el formulario, la hoja de respuestas y las columnas de revisión |
| `formulario/ejemplo_respuestas.csv` | Respuestas ficticias para probar el script (incluye errores a propósito) |
| `scripts/actualizar_catalogo.py` | Valida las estaciones aprobadas, les suma los catálogos importados y genera `sitio/data/estaciones.{csv,js}` (solo biblioteca estándar) |
| `scripts/importar_mira_chile.py` | Convierte el catálogo de MIRA Chile a `sitio/data/importadas/mira_chile.csv` |
| `scripts/importar_vismet.py` | Inventario nacional de estaciones meteorológicas de Chile desde VISMET / CR2 (DGA, DMC, AGROMET, CEAZA, REDMETEO…) |
| `scripts/importar_siata.py` | Estaciones de calidad del aire y meteorología de SIATA (Valle de Aburrá, Antioquia) desde su repositorio de datos: ubicación, variables y fechas, sin los datos medidos |
| `scripts/importar_openaq.py` | Importa estaciones de referencia de LAC desde OpenAQ (requiere API key gratuita) |
| `sitio/data/importadas/relevamiento_gecal.csv` | Estaciones cargadas a mano por GECAL; cada una con su fuente en `relevamiento_gecal.FUENTES.md` |
| `scripts/importar_fuentes_abiertas.py` | Convierte catálogos abiertos (SINAICA, SINCA, CETESB, MonitorAr, SENAMHI, NOAA ISD) a `sitio/data/importadas/` |
| `CONTRIBUIR.md` | Guía para sumar estaciones: formulario, plantilla CSV para redes completas o importador |
| `plantillas/` | `plantilla_red.csv` (vacía) y `ejemplo_red.csv` (con errores típicos para probar `--revisar`) |
| `formulario/avisos.gs` | Apps Script opcional: mail al equipo revisor con cada carga nueva |
| `sitio/` | Sitio estático: `index.html`, `app.js`, `styles.css`, `config.js`, `i18n.js` y `shell.js` (idiomas y tema), `css/` (tokens y fuentes del sistema de diseño de GECAL), `fonts/`, `img/` (logo y favicon de GECAL), `data/`, `vendor/leaflet/` |
| `.github/workflows/actualizar-importadas.yml` | Cada mes baja SIATA, regenera el catálogo y abre un pull request (ver «SIATA y actualización automática») |
| `.github/workflows/deploy-pages.yml` | Publica `sitio/` en GitHub Pages en cada push a `main` |
| `.github/workflows/actualizar-datos.yml` | Opcional: baja la pestaña "publicadas" todos los días, valida y publica |

## 1. Crear el formulario (una vez)

1. Entrar a <https://script.google.com> → **Nuevo proyecto** → pegar `formulario/crear_formulario.gs`.
2. Ejecutar `crearFormulario` y autorizar.
3. En el registro quedan tres enlaces: el formulario para compartir, el editor y la hoja de revisión.
4. Copiar el enlace del formulario en `sitio/config.js` (`formUrl`).

Conviene que la cuenta sea institucional/compartida de GECAL (o compartir el formulario y la
hoja con todo el equipo revisor como editores).

## 2. Revisar

En la pestaña **Respuestas** de la hoja, cada fila es una estación. Completar:

- `estado_revision`: Pendiente / Aprobado / Rechazado / Requiere corrección
- `revisor` y `notas_revision`

Criterios sugeridos: coordenadas plausibles (abrirlas en un mapa), red e institución
identificables, variables coherentes con el tipo de instrumental, que no esté duplicada.

Después, en el proyecto de Apps Script, ejecutar `exportarAprobadas` (o una vez
`instalarActualizacionDiaria` para que corra sola). Copia las aprobadas, **sin nombre ni correo
del aportante**, a la pestaña **publicadas**.

## 3. Pasar los datos al sitio

**Opción manual** — descargar "publicadas" como CSV (Archivo → Descargar → CSV) y correr:

```bash
python3 scripts/actualizar_catalogo.py publicadas.csv
```

El script imprime advertencias (punto fuera del país declarado, posibles duplicados a < 100 m
o con el mismo nombre, enlaces no válidos) y descarta las filas con errores (faltan campos,
coordenadas fuera de la región, con pistas como «¿falta el signo negativo?»). Luego `git commit` + `git push`.

**Opción automática** — en la hoja: Archivo → Compartir → Publicar en la web → pestaña
"publicadas" → CSV. Guardar esa URL como secreto `SHEET_CSV_URL` del repositorio. El workflow
`actualizar-datos.yml` se encarga todos los días. Ojo: esa URL es pública, por eso solo se
publica la pestaña sin datos personales.

## Catálogos importados (MIRA Chile)

Las estaciones de otras iniciativas viven en `sitio/data/importadas/*.csv`, con el mismo
esquema y una columna `fuente`. `actualizar_catalogo.py` las suma siempre a las del formulario
y avisa si una estación cargada en el formulario parece duplicar una importada.

Para refrescar MIRA Chile cuando publiquen una versión nueva:

```bash
git clone --depth 1 https://github.com/suraurora/mira-chile.git /tmp/mira-chile
python3 scripts/importar_mira_chile.py /tmp/mira-chile
python3 scripts/actualizar_catalogo.py publicadas.csv      # o --solo-importadas
```

Criterios de conversión: una fila por estación; variables agrupadas en contaminantes y
meteorología; frecuencia = la más fina disponible; año de inicio = el más antiguo de sus series;
«Sí» operativa si alguna serie tiene datos actuales, «Sin datos recientes» si ninguna;
enlace = guía de descarga de la red en el repositorio de MIRA Chile.

## Catálogos abiertos ya incorporados

| Fuente | País | Estaciones | Tipo | Tabla de origen (licencia MIT) |
|---|---|---|---|---|
| SINAICA (INECC) | México | 200 | Calidad del aire | `diegovalle/rsinaica` |
| CETESB QUALAR | Brasil (São Paulo) | 75 | Calidad del aire | `ropensci/qualR` |
| MonitorAr-Rio | Brasil (Rio de Janeiro) | 8 | Calidad del aire y meteorología | `ropensci/qualR` |
| SENAMHI | Perú (Lima) | 18 | Calidad del aire y meteorológicas automáticas | `quishqa/limaair` |
| SIATA | Colombia (Valle de Aburrá y Antioquia) | 303 | 43 de calidad del aire (con variables y fechas) y 260 meteorológicas (lluvia, radiación solar, estaciones completas) | Repositorio de Datos SIATA (`importar_siata.py`) |
| MIRA Chile | Chile (Arica a Atacama) | 862 | Meteorológicas y de calidad del aire, con variables y estado | `suraurora/mira-chile` (`importar_mira_chile.py`) |
| VISMET / CR2 | Chile (todo el país) | 1555 (+345 ya en MIRA) | Meteorológicas de DGA, DMC, AGROMET, CEAZA, REDMETEO, SERVIMET, UFRO y CR2 | API pública de VISMET (`importar_vismet.py`) |
| SINCA (MMA) | Chile | 51 que no están en OpenAQ ni MIRA | Calidad del aire (tabla histórica, sin variables ni estado) | `franciscoxaxo/AtmChile` (GPL-3) |
| NOAA ISD | 27 países | 1013 | Meteorológicas sinópticas/aeronáuticas activas | `ropensci/GSODR` |
| OpenAQ | 20 países, incluido Chile (SINCA) | 321 | Calidad del aire (equipos de referencia), con variables y estado | API de OpenAQ (`importar_openaq.py`) |

Chile se carga desde MIRA Chile (norte, con más detalle y series verificadas), VISMET / CR2
(inventario meteorológico nacional, con actividad de la última semana), SINCA y NOAA ISD.
VISMET se actualiza con `python3 scripts/importar_vismet.py` (no requiere clave). En la tabla de SINCA hay tres pares de
estaciones con códigos distintos en el mismo punto exacto (RII/217 y RII/210, RII/205 y RII/202,
RIV/420 y RIV/414): se dejan como vienen hasta confirmarlo con la red.
Las tablas de calidad del aire no dicen qué contaminantes mide cada estación; eso se completa con el
formulario o con información de cada red. Para regenerar todo:

```bash
pip install rdata
mkdir -p /tmp/fuentes && cd /tmp/fuentes
for r in diegovalle/rsinaica ropensci/qualR quishqa/limaair ropensci/GSODR franciscoxaxo/AtmChile; do
    git clone --depth 1 https://github.com/$r.git; done
cd - && python3 scripts/importar_fuentes_abiertas.py /tmp/fuentes
python3 scripts/actualizar_catalogo.py --solo-importadas
```

**OpenAQ** suma redes oficiales de muchos otros países (y opcionalmente sensores de bajo costo).
Necesita una clave gratuita de https://explore.openaq.org: `export OPENAQ_API_KEY=...` y
`python3 scripts/importar_openaq.py`. Los duplicados con otras fuentes se resuelven por prioridad en `actualizar_catalogo.py`.

Las correcciones a errores de las fuentes y las estaciones omitidas están listadas, con su
motivo, al principio de `importar_fuentes_abiertas.py`.

### SIATA y actualización automática

`scripts/importar_siata.py` usa la API pública del [Repositorio de Datos SIATA](https://datos.siata.gov.co/)
(Dataverse, sin clave) y solo toma **ubicación, variables y fechas**, nunca los datos medidos:

- **Calidad del aire (43):** tablas «Estaciones_calidad_aire» y «Fechas_monitoreo_calidad_aire» del dataset
  «Información de la Red de Calidad del Aire». Variables: PM2.5, PM10, O3, SO2, CO y NOx (esas tablas no traen NO ni NO2).
  Operativa = alguna variable sin fecha de suspensión; si no, «No (discontinuada)».
- **Meteorología (260):** las colecciones Meteorológica, Pluviométrica (precipitación), Disdrómetro (precipitación) y
  Piranómetro (radiación solar). Cada una trae su tabla de estaciones («Información de la Red…»): de ahí salen la ubicación,
  el municipio y el año de instalación. Los datasets mensuales de cada estación dan el último mes publicado: «Sí» solo si
  tiene menos de 3 meses; si es más viejo, «sin datos recientes» (los datos publicados de la mayoría terminan meses atrás y
  el mapa las muestra como «sin confirmar que esté operativa»); sin dataset, «No sé». Las estaciones meteorológicas
  completas no declaran sus variables, así que quedan sin ellas. Los datasets de estaciones nuevas que todavía no figuran
  en la tabla de su red (hoy 7 pluviómetros) se omiten y entran solos cuando SIATA la actualice.
- Se omiten Nivel y Velocidad Superficial Cauces (hidrología).
- Crédito: SIATA / Área Metropolitana del Valle de Aburrá, con enlace al repositorio en cada ficha.
  Los términos de uso del repositorio están en borrador (V1) y piden citar la fuente; la licencia aún figura como «XXXX».

**Cada mes** (día 1, 09:17 UTC) el workflow `actualizar-importadas.yml` corre el importador y `actualizar_catalogo.py --solo-importadas`,
sube la rama `bot/actualizar-importadas` y abre (o actualiza) **un pull request**; nunca sube directo a `main`.
Al fusionarlo, `deploy-pages.yml` publica el sitio. Es mensual y no semestral porque GitHub apaga los workflows programados de
un repositorio público tras 60 días sin actividad. Si falla, abre un *issue* y menciona a quien mantiene el repo.
Requisitos únicos: Settings → Actions → General → **Allow GitHub Actions to create and approve pull requests**.
El workflow se detiene si `estaciones.csv` trae estaciones del formulario, porque regenera solo desde `importadas/` y las borraría.
Para correrlo a mano: pestaña Actions → «Actualizar catálogos importados» → Run workflow, o `python3 scripts/importar_siata.py`
(el servidor de SIATA a veces tarda o se cuelga: el script reintenta cada consulta y tarda unos 25 minutos).

### Prioridad entre fuentes

Varias fuentes describen la misma estación (por ejemplo, una estación del SINCA aparece en MIRA
Chile y en la tabla del SINCA). `actualizar_catalogo.py` procesa los catálogos en el orden de
`PRIORIDAD` (MIRA Chile, VISMET, SINAICA, CETESB, MonitorAr, SENAMHI, SIATA, OpenAQ, SINCA, NOAA ISD)
y descarta una estación si ya la cargó una fuente anterior. Se considera la misma
estación cuando:

- tienen el mismo nombre y están a menos de 200 m;
- miden lo mismo (o la anterior mide más) y están a menos de 200 m, o a menos de 3 km con el mismo nombre;
- las dos son solo meteorológicas, están a menos de 1,5 km y comparten alguna variable (el mismo aeropuerto en NOAA ISD y en otra red). Sin variables en común, o si una fuente no las declara, vale el criterio de 200 m: así un pluviómetro de SIATA a 700 m del aeropuerto Olaya Herrera no hace desaparecer la estación del aeropuerto.

El script informa cuántas descartó de cada fuente. Las estaciones del formulario nunca se descartan
solas: si parecen duplicadas, se avisa para revisarlas.

## Redes completas (plantilla CSV)

Ver [CONTRIBUIR.md](CONTRIBUIR.md). Una planilla completada se valida con
`python3 scripts/actualizar_catalogo.py --revisar archivo.csv` y, si está bien, se copia a
`sitio/data/importadas/` para que se sume al mapa.

## En el mapa

- Las estaciones que comparten ubicación exacta (por ejemplo, la misma estación publicada por su
  red y por VISMET) se muestran como un solo punto con el número de registros; la ficha permite
  elegir cada registro.
- La leyenda permite colorear los puntos por tipo de estación o por red (las 11 redes con más
  estaciones visibles tienen color propio; el resto, gris).

## Diseño, idiomas y tema

- **Diseño:** el sitio usa el sistema de diseño de GECAL, igual que <https://gecal26.github.io/>.
  `sitio/css/tokens.css` y `sitio/css/fonts.css` son una copia de `static/css/` de
  [GECAL26/gecal26.github.io](https://github.com/GECAL26/gecal26.github.io) (se generan allí desde
  `design/tokens.json`); los woff2 de `sitio/fonts/` (Montserrat y Source Sans 3, licencia OFL) también.
  **No se editan aquí**: si cambia el diseño, se vuelven a copiar. Los únicos colores propios son los tres
  de tipo de estación (`--m-aire`, `--m-meteo`, `--m-ambas` en `styles.css`), ajustados para tener al
  menos 3:1 sobre el mapa gris de Esri en el tema claro y en el oscuro.
- **Idiomas:** español, portugués, francés e inglés, en ese orden. Se elige con el menú **ES / PT / FR / EN**
  o con `?lang=pt`; si no, se usa el idioma guardado o el del navegador, y si no coincide, español.
  Los textos están en `sitio/i18n.js`. Los datos de estaciones **siguen en español**
  (son también las claves de filtros y colores): `i18n.js` solo traduce lo que se muestra
  (`cat`: tipos, variables, frecuencias…; `pais`: nombres de países). Nombres de estaciones, localidades,
  redes y operadores no se traducen. Si aparece un valor nuevo en los datos (otra variable, otro entorno),
  se muestra en español hasta agregarlo a `cat` en los tres idiomas. El CSV descargado usa los valores originales.
- **Tema:** Sistema / Claro / Oscuro. El mapa gris cambia a la versión oscura de Esri.
- Idioma y tema se guardan con las mismas claves (`gecal-lang`, `gecal-theme`) que la web principal. Como
  ambas viven en `gecal26.github.io`, quien ya eligió una opción allí la encuentra aquí.
- Pendiente: el formulario de carga (Google Form) y `CONTRIBUIR.md` siguen en español.

## 4. Ver el sitio localmente

```bash
cd sitio && python3 -m http.server 8000   # abrir http://127.0.0.1:8000
```

(También abre con doble clic en `index.html`, porque los datos se cargan como `.js`.)

## Publicar en GitHub Pages

1. Crear el repositorio (p. ej. `gecal/mapa-estaciones`) y subir esta carpeta.
2. Settings → Pages → Source: **GitHub Actions**.
3. Cada push a `main` publica el sitio en `https://<usuario>.github.io/<repo>/`.

Cuando el catálogo ya tenga estaciones reales, borrar las de ejemplo y poner `avisoDemo: false`
en `sitio/config.js`.

## Campos publicados

`id_gecal, fecha_carga, pais, division, localidad, latitud, longitud, altitud_m, nombre_estacion,
codigo, red, operador, tipo_estacion, entorno, instrumental, contaminantes, meteorologia,
frecuencia, anio_inicio, estado_operativo, acceso_datos, url_datos`

Los campos de lista (`instrumental`, `contaminantes`, `meteorologia`) van separados por `; ` en el CSV.
Si se cambia el texto de una pregunta del formulario, actualizar `PREGUNTAS` en el `.gs` y en el `.py`.

## Créditos

Código propio de GECAL. Datos de las redes citadas arriba y de quienes aportan por el formulario.
Contornos de países: Natural Earth (dominio público) vía `world-atlas`. Mapa: Leaflet (BSD-2).
