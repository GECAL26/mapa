# Cómo sumar estaciones al Mapa GECAL

Hay tres caminos, según cuántas estaciones tengas y de dónde salgan los datos.

| Si tenés… | Usá | Por qué |
|---|---|---|
| 1 a 10 estaciones sueltas (una universidad, un sensor propio) | **El formulario** (botón «Sumar una estación» del mapa) | No hace falta saber nada técnico |
| Una red entera en una planilla | **La plantilla CSV** (`plantillas/plantilla_red.csv`) | Se carga toda de una vez y se valida con un script |
| Una red con catálogo público o API | **Un importador** (script en `scripts/`) | Reproducible: cualquiera puede regenerar los datos desde la fuente oficial |

En los tres casos los datos pasan por la misma validación antes de publicarse.

---

## 1. Formulario

Una respuesta = una estación. El equipo de GECAL la revisa y la aprueba.

## 2. Plantilla CSV (redes completas)

1. Descargá [`plantillas/plantilla_red.csv`](plantillas/plantilla_red.csv) y completala: **una fila por estación**.
   Mirá [`plantillas/ejemplo_red.csv`](plantillas/ejemplo_red.csv) como referencia.
   - Coordenadas en grados decimales WGS84, con punto decimal (`-31.4201`, `-64.1888`).
   - Listas (`contaminantes`, `meteorologia`, `instrumental`) separadas con `;`.
   - En `fuente` poné el nombre corto de la red o del catálogo (aparece como «Fuente» en el mapa).
2. Si tenés Python 3, validala vos misma/o (no modifica nada):
   ```bash
   python3 scripts/actualizar_catalogo.py --revisar mi_red.csv
   ```
   Te lista los errores fila por fila (coordenadas fuera de la región o del país, signo
   invertido, país o tipo no reconocido, códigos repetidos, variables desconocidas).
3. Mandala al equipo de GECAL o abrí un *pull request* agregándola en `sitio/data/importadas/`.
   Al correr `actualizar_catalogo.py`, todo lo que esté en esa carpeta se suma al mapa.

Para corregir algo después, se edita la planilla y se vuelve a subir: el archivo versionado en
GitHub es la referencia, y cada cambio queda registrado en el historial.

## 3. Importador (redes con catálogo o API públicos)

Es la opción más robusta: en lugar de copiar datos a mano, un script los convierte desde la
fuente original. Ejemplo: [`scripts/importar_mira_chile.py`](scripts/importar_mira_chile.py),
que toma el catálogo de [MIRA Chile](https://suraurora.github.io/mira-chile/).

Un importador nuevo tiene que:
- leer la fuente (archivo descargado o API) sin pasos manuales intermedios;
- escribir `sitio/data/importadas/<nombre>.csv` con las columnas de la plantilla;
- documentar en el encabezado de dónde salen los datos, cómo se descargan y qué criterios
  de conversión usa (por ejemplo, cómo se decide si una estación está operativa).

---

## Valores aceptados

El script entiende variantes comunes (sin tildes, en inglés o portugués, `PM2.5` = `MP2.5`,
`aire` = `Calidad del aire`, `Mexico` = `México`…) y las convierte al valor canónico.

- **pais**: nombre en español (Argentina, Brasil, Chile, México, Perú, …).
- **tipo_estacion** (obligatorio): `Calidad del aire` · `Meteorológica` · `Calidad del aire y meteorología`
- **contaminantes**: `MP10` `MP2.5` `MP1` `O3` `NO` `NO2` `NOx` `SO2` `CO` `CO2` `CH4` `H2S` `NH3`
  `COV / BTEX` `HCHO` `Carbono negro (BC)` `Metales en material particulado`
- **meteorologia**: `Temperatura` `Humedad relativa` `Presión` `Velocidad del viento`
  `Dirección del viento` `Ráfaga del viento` `Precipitación` `Radiación solar`
- **frecuencia**: `1 min o menos` · `5 a 15 min` · `30 min` · `1 hora` · `24 horas` · `Variable / otra` · `No sé`
- **estado_operativo**: `Sí` · `No (discontinuada)` · `Sin datos recientes` · `No sé`
- **acceso_datos**: `Públicos, en tiempo real o casi real` · `Públicos, solo históricos` ·
  `A pedido o con convenio` · `No disponibles` · `No sé`
- **instrumental**: `Equipos de referencia o equivalentes` · `Sensores de bajo costo` ·
  `Muestreadores manuales o pasivos` · `Sensores remotos / perfiladores` · `No sé`
- **entorno**: `Urbana` · `Suburbana` · `Rural` · `Industrial` · `De tráfico` · `Remota / de fondo` · `No sé`

Obligatorios: `nombre_estacion`, `pais`, `localidad`, `latitud`, `longitud`, `red`, `operador`, `tipo_estacion`.
