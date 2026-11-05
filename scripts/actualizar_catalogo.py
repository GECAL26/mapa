#!/usr/bin/env python3
"""Valida las estaciones aprobadas y genera los datos del mapa GECAL.

Además suma los catálogos importados de otras iniciativas que estén en
sitio/data/importadas/*.csv (mismo esquema, p. ej. mira_chile.csv), marcando su fuente.

Entrada del formulario (una de las dos):
  * la pestaña "publicadas" de la hoja de revisión (encabezados = claves internas), o
  * la pestaña "Respuestas" completa exportada como CSV (encabezados = texto de las
    preguntas). En ese caso se filtran solas las filas con estado_revision = Aprobado
    y se descartan los datos personales.

Puede ser un archivo local o una URL "Publicar en la web > CSV" de Google Sheets.

Salida:
  sitio/data/estaciones.csv   catálogo tabular (para descargar / versionar)
  sitio/data/estaciones.js    lo mismo como window.ESTACIONES (lo lee el sitio)
  reporte en pantalla con errores (filas descartadas) y advertencias (filas publicadas
  pero que conviene mirar). Sale con código 1 si hubo errores y se usó --estricto.

Uso:
  python scripts/actualizar_catalogo.py publicadas.csv
  python scripts/actualizar_catalogo.py "https://docs.google.com/spreadsheets/d/e/.../pub?gid=...&output=csv"
  python scripts/actualizar_catalogo.py --solo-importadas      # sin formulario, solo catálogos importados

Solo usa la biblioteca estándar de Python (3.8+).
"""
from __future__ import annotations

import argparse
import csv
import io
import json
import math
import re
import sys
import unicodedata
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
DATA = RAIZ / "sitio" / "data"
IMPORTADAS = DATA / "importadas"
FUENTE_FORM = "Formulario GECAL"

# Texto de las preguntas del formulario -> clave interna (mismo mapeo que crear_formulario.gs)
PREGUNTAS = {
    "País": "pais",
    "Provincia / Estado / Departamento": "division",
    "Ciudad o localidad": "localidad",
    "Latitud (grados decimales)": "latitud",
    "Longitud (grados decimales)": "longitud",
    "Altitud (m s.n.m.)": "altitud_m",
    "Nombre de la estación": "nombre_estacion",
    "Código o ID en la red (si existe)": "codigo",
    "Red o programa de monitoreo": "red",
    "Institución que opera la estación": "operador",
    "Tipo de estación": "tipo_estacion",
    "Entorno": "entorno",
    "Tipo de instrumental": "instrumental",
    "Contaminantes medidos": "contaminantes",
    "Variables meteorológicas medidas": "meteorologia",
    "Frecuencia de registro": "frecuencia",
    "Año de inicio de las mediciones": "anio_inicio",
    "¿La estación está operativa actualmente?": "estado_operativo",
    "¿Los datos están disponibles?": "acceso_datos",
    "Enlace a los datos o a la red": "url_datos",
    "Marca temporal": "fecha_carga",
    "Timestamp": "fecha_carga",
}

PUBLICAS = [
    "id_gecal", "fecha_carga", "pais", "division", "localidad", "latitud", "longitud",
    "altitud_m", "nombre_estacion", "codigo", "red", "operador", "tipo_estacion", "entorno",
    "instrumental", "contaminantes", "meteorologia", "frecuencia", "anio_inicio",
    "estado_operativo", "acceso_datos", "url_datos", "fuente",
]
OBLIGATORIAS = ["pais", "localidad", "latitud", "longitud", "nombre_estacion", "red",
                "operador", "tipo_estacion"]
LISTAS = ["instrumental", "contaminantes", "meteorologia"]  # respuestas de casillas

# ---------------------------------------------------------- vocabulario controlado
# Valor canónico -> sinónimos aceptados (se comparan sin tildes, mayúsculas ni signos)
VOCAB = {
    "tipo_estacion": {
        "Calidad del aire": ["calidad aire", "aire", "air quality", "qualidade do ar", "cal aire"],
        "Meteorológica": ["meteorologica", "meteo", "meteorologia", "weather", "meteorological"],
        "Calidad del aire y meteorología": ["ambas", "mixta", "calidad del aire y meteorologica", "aire y meteo"],
    },
    "variables": {
        "MP10": ["pm10"], "MP2.5": ["pm2.5", "pm25", "mp25", "pm 2.5", "mp 2.5"], "MP1": ["pm1"],
        "O3": ["ozono", "ozone"], "NO": ["monoxido de nitrogeno"], "NO2": ["dioxido de nitrogeno"],
        "NOx": ["nox"], "SO2": ["dioxido de azufre"], "CO": ["monoxido de carbono"],
        "CO2": ["dioxido de carbono"], "CH4": ["metano"], "H2S": [], "NH3": ["amoniaco"],
        "COV / BTEX": ["cov", "btex", "voc", "covs"], "HCHO": ["formaldehido"],
        "Carbono negro (BC)": ["bc", "black carbon", "carbono negro"],
        "Metales en material particulado": ["metales"],
        "Temperatura": ["temp", "temperatura del aire"], "Humedad relativa": ["humedad", "hr", "rh"],
        "Presión": ["presion atmosferica", "pressure"],
        "Velocidad del viento": ["intensidad del viento", "viento velocidad", "wind speed", "vv"],
        "Dirección del viento": ["viento direccion", "wind direction", "dv"],
        "Ráfaga del viento": ["rafaga"], "Precipitación": ["lluvia", "pp", "precipitation"],
        "Radiación solar": ["radiacion", "solar radiation", "rad solar"],
    },
    "frecuencia": {
        "1 min o menos": ["1 min", "1min", "minutal"], "5 a 15 min": ["5 min", "10 min", "15 min"],
        "30 min": ["30min"], "1 hora": ["60 min", "horaria", "hora", "1h"],
        "24 horas": ["diaria", "1440 min", "24 h"], "Variable / otra": ["variable", "otra"], "No sé": ["no se", "ns"],
    },
    "estado_operativo": {
        "Sí": ["si", "activa", "operativa", "yes"], "No (discontinuada)": ["no", "discontinuada", "inactiva"],
        "Sin datos recientes": [], "No sé": ["no se", "desconocido"],
    },
    "acceso_datos": {
        "Públicos, en tiempo real o casi real": ["tiempo real", "publicos tiempo real", "real time"],
        "Públicos, solo históricos": ["historicos", "publicos historicos"],
        "A pedido o con convenio": ["a pedido", "convenio", "bajo solicitud"],
        "No disponibles": ["no", "privados"], "No sé": ["no se", "desconocido"],
    },
}
PAISES_EXTRA = ["Guayana Francesa", "Otro"]


def _indice(opciones: dict) -> dict:
    idx = {}
    for canon, sin in opciones.items():
        for v in [canon] + sin:
            idx[norm(v)] = canon
    return idx


def canonizar(campo: str, valor: str) -> tuple[str, bool]:
    """Devuelve (valor canónico, reconocido)."""
    if not valor:
        return "", True
    c = _indice(VOCAB[campo]).get(norm(valor))
    return (c, True) if c else (valor, False)


# Opciones del formulario que contienen comas (para no partirlas al separar)
OPCIONES_CON_COMA: list[str] = []

# Rango geográfico admitido (Latinoamérica y el Caribe, con margen)
LAT_MIN, LAT_MAX = -60.0, 33.0
LON_MIN, LON_MAX = -120.0, -25.0
DIST_DUPLICADO_M = 100.0


# ---------------------------------------------------------------- utilidades
def norm(texto: str) -> str:
    t = unicodedata.normalize("NFKD", str(texto)).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", " ", t.lower()).strip()


def leer_csv(origen: str) -> list[dict]:
    if re.match(r"^https?://", origen):
        with urllib.request.urlopen(origen, timeout=60) as r:  # noqa: S310 (URL dada por quien administra)
            texto = r.read().decode("utf-8-sig")
    else:
        texto = Path(origen).read_text(encoding="utf-8-sig")
    return list(csv.DictReader(io.StringIO(texto)))


def numero(valor: str) -> float | None:
    v = str(valor).strip().replace(" ", "")
    if not v:
        return None
    # admitir coma decimal ("-31,42") pero no separadores de miles ambiguos
    if v.count(",") == 1 and "." not in v:
        v = v.replace(",", ".")
    try:
        x = float(v)
    except ValueError:
        return None
    return x if math.isfinite(x) else None


def separar_lista(valor: str) -> list[str]:
    v = str(valor).strip()
    if not v:
        return []
    protegidas = {}
    for i, op in enumerate(OPCIONES_CON_COMA):
        if op in v:
            marca = f"§{i}§"
            protegidas[marca] = op
            v = v.replace(op, marca)
    partes = [p.strip() for p in re.split(r"[;,]", v) if p.strip()]
    salida = []
    for p in partes:
        for marca, op in protegidas.items():
            p = p.replace(marca, op)
        if p not in salida:
            salida.append(p)
    return salida


def haversine_m(lat1, lon1, lat2, lon2) -> float:
    r = 6371000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


# ------------------------------------------------------ chequeo país/polígono
PAISES_NOMBRES: list[str] = []


def cargar_paises() -> dict[str, list]:
    """Lee sitio/data/paises.js (GeoJSON) y devuelve {pais_normalizado: [anillos]}."""
    ruta = DATA / "paises.js"
    if not ruta.exists():
        return {}
    texto = ruta.read_text(encoding="utf-8")
    gj = json.loads(texto[texto.index("{"): texto.rindex("}") + 1])
    salida: dict[str, list] = {}
    for f in gj["features"]:
        geom = f["geometry"]
        polys = [geom["coordinates"]] if geom["type"] == "Polygon" else geom["coordinates"]
        salida[norm(f["properties"]["pais"])] = polys
        if f["properties"]["pais"] not in PAISES_NOMBRES:
            PAISES_NOMBRES.append(f["properties"]["pais"])
    return salida


def punto_en_poligonos(lon: float, lat: float, polys: list) -> bool:
    def en_anillo(anillo):
        dentro = False
        j = len(anillo) - 1
        for i in range(len(anillo)):
            xi, yi = anillo[i]
            xj, yj = anillo[j]
            if (yi > lat) != (yj > lat) and lon < (xj - xi) * (lat - yi) / ((yj - yi) or 1e-12) + xi:
                dentro = not dentro
            j = i
        return dentro

    for poly in polys:
        if en_anillo(poly[0]) and not any(en_anillo(h) for h in poly[1:]):
            return True
    return False


def cerca_de_poligonos(lon: float, lat: float, polys: list, margen: float = 0.15) -> bool:
    """Tolerancia para estaciones costeras o en islas pequeñas que el contorno simplificado no cubre."""
    for dx in (-margen, 0, margen):
        for dy in (-margen, 0, margen):
            if punto_en_poligonos(lon + dx, lat + dy, polys):
                return True
    return False


# ------------------------------------------------------------------ proceso
def a_claves(fila: dict) -> dict:
    """Convierte una fila (encabezados = preguntas o claves) a claves internas."""
    salida = {}
    for k, v in fila.items():
        if k is None:
            continue
        k2 = k.strip()
        clave = PREGUNTAS.get(k2, k2)
        salida[clave] = (v or "").strip()
    return salida


def procesar(filas: list[dict], fuente_defecto: str = FUENTE_FORM, vistas: list[dict] | None = None,
             etiqueta_origen: str = "") -> tuple[list[dict], list[str], list[str]]:
    errores: list[str] = []
    avisos: list[str] = []
    paises = cargar_paises()
    nombres_pais = {norm(x): x for x in list(PAISES_NOMBRES) + PAISES_EXTRA}
    vistas = [] if vistas is None else vistas
    nuevas: list[dict] = []

    tiene_revision = bool(filas) and "estado_revision" in {k.strip() for k in filas[0] if k}

    for n, cruda in enumerate(filas, start=2):  # n = número de fila en la hoja
        f = a_claves(cruda)
        if tiene_revision and norm(f.get("estado_revision", "")) != "aprobado":
            continue
        etiqueta = f"{etiqueta_origen}fila {n} «{f.get('nombre_estacion') or 'sin nombre'}»"
        fuente = f.get("fuente") or fuente_defecto

        # En catálogos importados la localidad puede faltar (p. ej. estaciones sinópticas)
        req = OBLIGATORIAS if fuente == FUENTE_FORM else [c for c in OBLIGATORIAS if c != "localidad"]
        faltan = [c for c in req if not f.get(c)]
        if faltan:
            errores.append(f"{etiqueta}: faltan campos obligatorios: {', '.join(faltan)}")
            continue

        pais = nombres_pais.get(norm(f["pais"]))
        if not pais:
            errores.append(f"{etiqueta}: país no reconocido ({f['pais']!r})")
            continue
        f["pais"] = pais
        tipo, ok = canonizar("tipo_estacion", f["tipo_estacion"])
        if not ok:
            errores.append(f"{etiqueta}: tipo_estacion no válido ({f['tipo_estacion']!r}); usar: "
                           + " / ".join(VOCAB["tipo_estacion"]))
            continue
        f["tipo_estacion"] = tipo
        for campo in ("frecuencia", "estado_operativo", "acceso_datos"):
            val, ok = canonizar(campo, f.get(campo, ""))
            if not ok:
                avisos.append(f"{etiqueta}: {campo} no reconocido ({val!r}); se publica tal cual")
            f[campo] = val

        lat, lon = numero(f["latitud"]), numero(f["longitud"])
        if lat is None or lon is None:
            errores.append(f"{etiqueta}: latitud/longitud no son números ({f['latitud']!r}, {f['longitud']!r})")
            continue
        if not (LAT_MIN <= lat <= LAT_MAX and LON_MIN <= lon <= LON_MAX):
            pista = ""
            if LON_MIN <= -lon <= LON_MAX:
                pista = " — ¿falta el signo negativo en la longitud?"
            elif LAT_MIN <= lon <= LAT_MAX and LON_MIN <= lat <= LON_MAX:
                pista = " — ¿latitud y longitud invertidas?"
            errores.append(f"{etiqueta}: coordenadas fuera de Latinoamérica ({lat}, {lon}){pista}")
            continue

        polys = paises.get(norm(f["pais"]))
        if polys and not cerca_de_poligonos(lon, lat, polys):
            avisos.append(f"{etiqueta}: el punto ({lat}, {lon}) no cae dentro de {f['pais']}; revisar coordenadas o país")

        alt = numero(f.get("altitud_m", ""))
        anio = numero(f.get("anio_inicio", ""))
        if anio is not None and not (1850 <= anio <= datetime.now().year + 1):
            avisos.append(f"{etiqueta}: año de inicio raro ({f['anio_inicio']}); se deja vacío")
            anio = None

        url = f.get("url_datos", "")
        if url and not re.match(r"^https?://[^\s]+$", url):
            avisos.append(f"{etiqueta}: el enlace no es una URL http(s) válida; se descarta")
            url = ""

        listas = {}
        for campo in ("contaminantes", "meteorologia"):
            salida = []
            for v in separar_lista(f.get(campo, "")):
                c, ok = canonizar("variables", v)
                if not ok:
                    avisos.append(f"{etiqueta}: variable no reconocida ({v!r}); se publica tal cual")
                if c not in salida:
                    salida.append(c)
            listas[campo] = salida
        vars_ = listas["contaminantes"] + listas["meteorologia"]
        if not vars_ and fuente == FUENTE_FORM:
            avisos.append(f"{etiqueta}: no indica ninguna variable medida")

        codigo = f.get("codigo", "")
        for previa in vistas + nuevas:
            if previa["fuente"] == fuente != FUENTE_FORM:
                # dentro de un mismo catálogo solo se marca el código repetido en la misma red
                if codigo and previa["codigo"] == codigo and previa["red"] == f["red"]:
                    avisos.append(f"{etiqueta}: código {codigo!r} repetido en la red {f['red']!r} ({previa['id_gecal']})")
                    break
                continue
            d = haversine_m(lat, lon, previa["latitud"], previa["longitud"])
            mismo_nombre = norm(previa["nombre_estacion"]) == norm(f["nombre_estacion"])
            if d < DIST_DUPLICADO_M or (mismo_nombre and norm(previa["pais"]) == norm(f["pais"]) and d < 2000):
                avisos.append(f"{etiqueta}: posible duplicado de {previa['id_gecal']} «{previa['nombre_estacion']}» ({d:.0f} m)")
                break

        fecha = f.get("fecha_carga", "")
        m = re.match(r"(\d{1,2})/(\d{1,2})/(\d{4})", fecha)  # formato de Google Forms dd/mm/aaaa
        if m:
            fecha = f"{m.group(3)}-{int(m.group(2)):02d}-{int(m.group(1)):02d}"
        else:
            fecha = fecha.split(" ")[0]

        est = {
            "id_gecal": f.get("id_gecal") or (f"G{n:04d}" if fuente == FUENTE_FORM
                                               else f"{re.sub(r'[^A-Z0-9]+', '', norm(fuente).upper())[:8]}-{n - 1:04d}"),
            "fecha_carga": fecha,
            "pais": f["pais"],
            "division": f.get("division", ""),
            "localidad": f.get("localidad", ""),
            "latitud": round(lat, 6),
            "longitud": round(lon, 6),
            "altitud_m": round(alt, 1) if alt is not None else None,
            "nombre_estacion": f["nombre_estacion"],
            "codigo": f.get("codigo", ""),
            "red": f["red"],
            "operador": f["operador"],
            "tipo_estacion": f["tipo_estacion"],
            "entorno": f.get("entorno", ""),
            "instrumental": separar_lista(f.get("instrumental", "")),
            "contaminantes": listas["contaminantes"],
            "meteorologia": listas["meteorologia"],
            "frecuencia": f.get("frecuencia", ""),
            "anio_inicio": int(anio) if anio is not None else None,
            "estado_operativo": f.get("estado_operativo", "") or "No sé",
            "acceso_datos": f.get("acceso_datos", "") or "No sé",
            "url_datos": url,
            "fuente": fuente,
        }
        nuevas.append(est)

    return nuevas, errores, avisos


def escribir(estaciones: list[dict], destino: Path) -> None:
    destino.mkdir(parents=True, exist_ok=True)
    with (destino / "estaciones.csv").open("w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=PUBLICAS)
        w.writeheader()
        for e in estaciones:
            fila = {k: ("; ".join(e[k]) if isinstance(e[k], list) else ("" if e[k] is None else e[k]))
                    for k in PUBLICAS}
            w.writerow(fila)
    meta = {
        "generado": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "n_estaciones": len(estaciones),
        "n_paises": len({e["pais"] for e in estaciones}),
        "n_redes": len({e["red"] for e in estaciones}),
        "fuentes": sorted({e["fuente"] for e in estaciones}),
    }
    payload = json.dumps({"metadata": meta, "estaciones": estaciones}, ensure_ascii=False, separators=(",", ":"))
    # </script> no puede aparecer dentro del JS embebido
    payload = payload.replace("</", "<\\/")
    (destino / "estaciones.js").write_text(f"window.ESTACIONES = {payload};\n", encoding="utf-8")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("origen", nargs="?", help="CSV local o URL CSV publicada de Google Sheets")
    ap.add_argument("--solo-importadas", action="store_true", help="no leer el formulario, solo sitio/data/importadas")
    ap.add_argument("--revisar", metavar="CSV", help="validar una planilla de red (plantillas/) sin modificar el sitio")
    ap.add_argument("--destino", default=str(DATA), help="carpeta de salida (por defecto sitio/data)")
    ap.add_argument("--estricto", action="store_true", help="salir con error si alguna fila fue descartada")
    a = ap.parse_args()

    if a.revisar:
        est, errores, avisos = procesar(leer_csv(a.revisar), fuente_defecto=Path(a.revisar).stem)
        print(f"✔ {len(est)} estaciones válidas en {a.revisar}")
        for titulo, lista in ((f"⚠ {len(avisos)} advertencias", avisos), (f"✖ {len(errores)} filas con errores", errores)):
            if lista:
                print(f"\n{titulo}:")
                for x in lista:
                    print("  -", x)
        return 1 if errores else 0

    if not a.origen and not a.solo_importadas:
        ap.error("indicá el CSV de la hoja o usá --solo-importadas")

    estaciones: list[dict] = []
    errores: list[str] = []
    avisos: list[str] = []
    resumen = []
    for ruta in sorted(IMPORTADAS.glob("*.csv")):
        nuevas, e, w = procesar(leer_csv(str(ruta)), fuente_defecto=ruta.stem, vistas=estaciones,
                                etiqueta_origen=f"{ruta.name} ")
        estaciones += nuevas; errores += e; avisos += w
        resumen.append(f"{len(nuevas)} de {ruta.name}")
    if a.origen:
        nuevas, e, w = procesar(leer_csv(a.origen), vistas=estaciones)
        estaciones += nuevas; errores += e; avisos += w
        resumen.append(f"{len(nuevas)} del formulario")

    estaciones.sort(key=lambda x: (norm(x["pais"]), norm(x["localidad"]), norm(x["nombre_estacion"])))
    escribir(estaciones, Path(a.destino))

    print(f"✔ {len(estaciones)} estaciones publicadas en {a.destino} ({', '.join(resumen)})")
    if avisos:
        print(f"\n⚠ {len(avisos)} advertencias (se publicaron igual):")
        for x in avisos:
            print("  -", x)
    if errores:
        print(f"\n✖ {len(errores)} filas descartadas:")
        for x in errores:
            print("  -", x)
    return 1 if (errores and a.estricto) else 0


if __name__ == "__main__":
    sys.exit(main())
