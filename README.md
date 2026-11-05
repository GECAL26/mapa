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
| `CONTRIBUIR.md` | Guía para sumar estaciones: formulario, plantilla CSV para redes completas o importador |
| `plantillas/` | `plantilla_red.csv` (vacía) y `ejemplo_red.csv` (con errores típicos para probar `--revisar`) |
| `formulario/avisos.gs` | Apps Script opcional: mail al equipo revisor con cada carga nueva |
| `sitio/` | Sitio estático: `index.html`, `app.js`, `styles.css`, `config.js`, `img/` (logo y favicon de GECAL), `data/`, `vendor/leaflet/` |
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

## Redes completas (plantilla CSV)

Ver [CONTRIBUIR.md](CONTRIBUIR.md). Una planilla completada se valida con
`python3 scripts/actualizar_catalogo.py --revisar archivo.csv` y, si está bien, se copia a
`sitio/data/importadas/` para que se sume al mapa.

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

Inspirado en [MIRA Chile](https://suraurora.github.io/mira-chile/). Código propio de GECAL.
Contornos de países: Natural Earth (dominio público) vía `world-atlas`. Mapa: Leaflet (BSD-2).
