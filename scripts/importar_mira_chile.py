#!/usr/bin/env python3
"""Convierte el catálogo de MIRA Chile al formato del Mapa GECAL.

Fuente: https://github.com/suraurora/mira-chile  (https://suraurora.github.io/mira-chile/)
  - catalogo_estaciones.csv            una fila por serie (estación × variable)
  - dashboard/dist/data/catalog.js     una fila por estación (red, región, comuna)

Salida: sitio/data/importadas/mira_chile.csv  (mismo esquema que el catálogo GECAL,
una fila por estación). actualizar_catalogo.py la suma al mapa junto con las
estaciones del formulario.

Uso:
  git clone --depth 1 https://github.com/suraurora/mira-chile.git /tmp/mira-chile
  python scripts/importar_mira_chile.py /tmp/mira-chile
  python scripts/actualizar_catalogo.py --solo-importadas      # o con el CSV de la hoja
"""
from __future__ import annotations

import csv
import json
import re
import sys
from collections import defaultdict
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
SALIDA = RAIZ / "sitio" / "data" / "importadas" / "mira_chile.csv"
REPO_URL = "https://github.com/suraurora/mira-chile/blob/main/"

CONTAMINANTES = {"CO": "CO", "MP10": "MP10", "MP2.5": "MP2.5", "NO": "NO", "NO2": "NO2",
                 "NOX": "NOx", "O3": "O3", "SO2": "SO2"}
METEO = {"Temperatura": "Temperatura", "Humedad": "Humedad relativa", "Presión": "Presión",
         "Intensidad del viento": "Velocidad del viento", "Dirección del viento": "Dirección del viento",
         "Ráfaga del viento": "Ráfaga del viento", "Precipitación": "Precipitación",
         "Radiación solar": "Radiación solar"}
ORDEN = list(CONTAMINANTES.values()) + list(METEO.values())


def frecuencia(minutos: list[str]) -> str:
    """Categoría GECAL según la frecuencia más fina disponible en la estación."""
    nums = [int(m.split()[0]) for m in minutos if re.match(r"^\d+ min$", m)]
    if not nums:
        return "Variable / otra" if minutos else ""
    m = min(nums)
    if m <= 1:
        return "1 min o menos"
    if m <= 15:
        return "5 a 15 min"
    if m == 30:
        return "30 min"
    if m == 60:
        return "1 hora"
    if m == 1440:
        return "24 horas"
    return "Variable / otra"


def main(repo: Path) -> None:
    texto = (repo / "dashboard/dist/data/catalog.js").read_text(encoding="utf-8")
    cat = json.loads(texto[texto.index("{"): texto.rindex("}") + 1])
    # Clave estación↔serie: id + nombre + institución + coordenadas redondeadas
    # (hay estaciones con mismo id/nombre en dos redes y pequeñas diferencias de redondeo)
    def clave_de(i, nombre, inst, lat, lon):
        return (i, nombre, inst, round(float(lat), 5), round(float(lon), 5))

    estaciones = {clave_de(s["id"], s["nombre_estacion"], s["fuente_institucion"], s["latitud"], s["longitud"]): s
                  for s in cat["stations"]}

    series = defaultdict(list)
    with (repo / "catalogo_estaciones.csv").open(encoding="utf-8") as fh:
        for r in csv.DictReader(fh):
            clave = clave_de(r["id"], r["nombre_estacion"], r["fuente_institucion"], r["latitud"], r["longitud"])
            series[clave].append(r)

    campos = ["id_gecal", "fecha_carga", "pais", "division", "localidad", "latitud", "longitud",
              "altitud_m", "nombre_estacion", "codigo", "red", "operador", "tipo_estacion", "entorno",
              "instrumental", "contaminantes", "meteorologia", "frecuencia", "anio_inicio",
              "estado_operativo", "acceso_datos", "url_datos", "fuente"]
    filas, sin_series = [], 0
    for clave, s in estaciones.items():
        rs = series.get(clave, [])
        if not rs:
            sin_series += 1
            continue
        vars_ = {r["variable"] for r in rs}
        cont = [CONTAMINANTES[v] for v in CONTAMINANTES if v in vars_]
        met = [METEO[v] for v in METEO if v in vars_]
        otros = sorted(v for v in vars_ if v not in CONTAMINANTES and v not in METEO)
        met += otros
        tipo = ("Calidad del aire y meteorología" if cont and met else
                "Calidad del aire" if cont else "Meteorológica")
        anios = [int(r["primera_fecha_disponible"][:4]) for r in rs
                 if re.match(r"^\d{4}", r["primera_fecha_disponible"] or "")]
        actuales = {r["datos_disponibles_actualmente"] for r in rs}
        if "Sí" in actuales:
            estado, acceso = "Sí", "Públicos, en tiempo real o casi real"
        elif actuales == {"No"}:
            estado, acceso = "Sin datos recientes", "Públicos, solo históricos"
        else:
            estado, acceso = "No sé", "Públicos, solo históricos"
        readme = sorted({r["readme_descarga"] for r in rs if r["readme_descarga"]})
        alt = s.get("altitud_snm_m")
        filas.append({
            "id_gecal": "CL-" + s["station_key"].split("-")[0].upper(),
            "fecha_carga": cat["metadata"]["generated_at"][:10],
            "pais": "Chile",
            "division": s.get("region") or "",
            "localidad": s.get("comuna") or "",
            "latitud": round(s["latitud"], 6),
            "longitud": round(s["longitud"], 6),
            "altitud_m": "" if alt is None else round(float(alt), 1),
            "nombre_estacion": s["nombre_estacion"],
            "codigo": s["id"],
            "red": s["red"],
            "operador": s.get("fuente_institucion") or s["red"],
            "tipo_estacion": tipo,
            "entorno": "",
            "instrumental": "",
            "contaminantes": "; ".join(cont),
            "meteorologia": "; ".join(met),
            "frecuencia": frecuencia(sorted({r["frecuencia_muestreo"] for r in rs})),
            "anio_inicio": min(anios) if anios else "",
            "estado_operativo": estado,
            "acceso_datos": acceso,
            "url_datos": REPO_URL + readme[0] if readme else "",
            "fuente": "MIRA Chile",
        })

    SALIDA.parent.mkdir(parents=True, exist_ok=True)
    with SALIDA.open("w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=campos)
        w.writeheader()
        w.writerows(filas)
    print(f"✔ {len(filas)} estaciones de MIRA Chile → {SALIDA.relative_to(RAIZ)}"
          + (f" ({sin_series} sin series, omitidas)" if sin_series else ""))


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(Path(sys.argv[1]))
