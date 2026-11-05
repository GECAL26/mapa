#!/usr/bin/env python3
"""Importa el inventario nacional de estaciones meteorológicas de Chile desde VISMET (CR2).

VISMET (https://vismet.cr2.cl/), del Centro de Ciencia del Clima y la Resiliencia (CR2),
redistribuye en un mismo visor las estaciones de varias redes chilenas: DGA, DMC, AGROMET,
CEAZA, REDMETEO, UFRO y estaciones andinas del CR2. Su API pública devuelve, para cada
variable, el agregado de la última semana de TODAS las estaciones del inventario; con eso se
arma el catálogo nacional sin descargar series completas.

Criterios (inspirados en MIRA Chile, https://suraurora.github.io/mira-chile/):
  * Una fila por estación de VISMET; `red` = la red de origen que atribuye VISMET.
  * Variables: Precipitación y/o Temperatura cuando la estación tuvo un valor válido en las
    últimas 168 h (el máximo que permite la API). Son las dos variables que publica VISMET.
  * Operativa = «Sí» si tuvo algún valor en esa semana; si no, «Sin datos recientes».
  * No se verifican series históricas ni fecha de inicio (MIRA sí lo hace para su zona, y
    por eso tiene prioridad sobre esta fuente donde se superponen).
  * Se omiten las bases antárticas (latitud < -60) y dos estaciones con coordenadas
    imposibles; una con latitud y longitud invertidas se corrige (ver CORRECCIONES).
  * La API pide un encabezado `ckey` que el cliente web público calcula a partir de la ruta
    (hash tipo «hashCode» de Java en hexadecimal); no es una credencial personal.

Uso:
  python scripts/importar_vismet.py              # consulta la API y guarda la respuesta en .cache/
  python scripts/importar_vismet.py --usar-cache # reprocesa la última descarga
  python scripts/actualizar_catalogo.py --solo-importadas
"""
from __future__ import annotations

import argparse
import csv
import json
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from importar_fuentes_abiertas import CAMPOS, DESTINO  # noqa: E402

BASE = "https://vismet.cr2.cl/"
CACHE = Path(__file__).resolve().parent.parent / ".cache" / "vismet_inventario.json"
VARIABLES = {1: ("Precipitación", "sum"), 2: ("Temperatura", "mean")}
REDES = {
    "dga": ("DGA", "Dirección General de Aguas (MOP)"),
    "dmc": ("DMC", "Dirección Meteorológica de Chile"),
    "agromet": ("AGROMET", "Red Agroclimática Nacional (AGROMET)"),
    "ceaza": ("CEAZA", "Centro de Estudios Avanzados en Zonas Áridas"),
    "redmeteo": ("REDMETEO", "REDMETEO"),
    "ufro": ("UFRO", "Universidad de La Frontera"),
    "estaciones_andinas_cr2": ("CR2 andinas", "Centro de Ciencia del Clima y la Resiliencia (CR2)"),
}


# Correcciones a errores evidentes de la fuente (id VISMET -> (lat, lon)), con su motivo
CORRECCIONES = {
    1308: (-47.5425, -73.673333),  # «Río Huemules en Glaciar Steffen»: lat y lon invertidas
}
# Estaciones omitidas por coordenadas inconsistentes sin corrección verificable
OMITIR = {
    121,  # «Río Maipo en Queltehues»: (-3.59, -7.03), fuera de Chile
    687,  # «Siegel»: latitud positiva (34.5)
}
LAT_MIN = -60  # las bases antárticas quedan fuera del alcance del mapa


def arreglar_texto(t: str) -> str:
    """Repara nombres con doble codificación (p. ej. «PeÃ±Ã³n» -> «Peñón»)."""
    if "Ã" in t:
        try:
            return t.encode("latin-1").decode("utf-8")
        except (UnicodeEncodeError, UnicodeDecodeError):
            return t
    return t


def ckey(ruta: str) -> str:
    h = 0
    for c in ruta:
        h = (31 * h + ord(c)) & 0xFFFFFFFF
    return format(h, "x")


def pedir(ruta: str):
    req = urllib.request.Request(BASE + ruta, headers={"ckey": ckey(ruta), "Referer": BASE,
                                                      "User-Agent": "mapa-gecal-importador"})
    for intento in range(5):
        try:
            with urllib.request.urlopen(req, timeout=180) as r:
                return json.load(r)
        except (urllib.error.URLError, TimeoutError) as e:
            espera = 10 * (intento + 1)
            print(f"  VISMET respondió con error ({e}); reintento en {espera} s…")
            time.sleep(espera)
    sys.exit("✖ VISMET no responde; probá más tarde o usá --usar-cache.")


def descargar() -> dict:
    fin = int(time.time()) // 3600 * 3600
    datos = {"consultado_utc": datetime.now(timezone.utc).isoformat(), "fin_unix": fin, "variables": {}}
    for vid, (nombre, estadistico) in VARIABLES.items():
        ruta = f"api/measure/by-measure-type/{vid}/by-timestamp/{fin}/by-interval/168/{estadistico}"
        filas = pedir(ruta)
        datos["variables"][str(vid)] = filas
        print(f"  {nombre}: {len(filas)} estaciones en el inventario")
        time.sleep(1)
    return datos


def convertir(datos: dict) -> list[dict]:
    estaciones: dict[int, dict] = {}
    medidas: dict[int, set] = {}
    for vid, filas in datos["variables"].items():
        nombre = VARIABLES[int(vid)][0]
        for f in filas:
            s = f["station"]
            estaciones[s["id"]] = s
            if f.get("aggregatedValue") is not None:
                medidas.setdefault(s["id"], set()).add(nombre)
    fecha = datos["consultado_utc"][:10]
    salida = []
    for sid, s in sorted(estaciones.items()):
        if sid in OMITIR:
            continue
        if sid in CORRECCIONES:
            s = {**s, "latitude": CORRECCIONES[sid][0], "longitude": CORRECCIONES[sid][1]}
        if not isinstance(s.get("latitude"), (int, float)) or not isinstance(s.get("longitude"), (int, float)):
            continue
        if s["latitude"] < LAT_MIN:
            continue
        org = (s.get("organization") or {}).get("name", "")
        red, operador = REDES.get(org, (org.upper() or "VISMET", org or "No informado"))
        if "(SERVIMET)" in (s.get("name") or "").upper():
            red, operador = "SERVIMET", "Servicio Meteorológico de la Armada (SERVIMET)"
        vars_ = [v for v in ("Temperatura", "Precipitación") if v in medidas.get(sid, set())]
        activa = bool(vars_)
        alt = s.get("altitude")
        salida.append({**{k: "" for k in CAMPOS},
            "id_gecal": f"CL-VISMET-{sid}", "fecha_carga": fecha, "pais": "Chile",
            "latitud": round(s["latitude"], 6), "longitud": round(s["longitude"], 6),
            "altitud_m": "" if alt in (None, "") else round(float(alt), 1),
            "nombre_estacion": arreglar_texto((s.get("name") or "").strip()), "codigo": s.get("nationalCode") or str(sid),
            "red": red, "operador": operador, "tipo_estacion": "Meteorológica",
            "meteorologia": "; ".join(vars_), "frecuencia": "1 hora",
            "estado_operativo": "Sí" if activa else "Sin datos recientes",
            "acceso_datos": "Públicos, en tiempo real o casi real" if activa else "Públicos, solo históricos",
            "url_datos": BASE, "fuente": "VISMET / CR2"})
    return salida


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--usar-cache", action="store_true", help="reprocesar la última descarga guardada")
    a = ap.parse_args()
    if a.usar_cache:
        if not CACHE.exists():
            sys.exit(f"✖ No existe {CACHE}; corré primero sin --usar-cache.")
        datos = json.loads(CACHE.read_text(encoding="utf-8"))
    else:
        print("Descargando inventario de VISMET…")
        datos = descargar()
        CACHE.parent.mkdir(exist_ok=True)
        CACHE.write_text(json.dumps(datos), encoding="utf-8")
    filas = convertir(datos)
    DESTINO.mkdir(parents=True, exist_ok=True)
    with (DESTINO / "vismet.csv").open("w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=CAMPOS)
        w.writeheader()
        w.writerows(filas)
    activas = sum(1 for f in filas if f["estado_operativo"] == "Sí")
    print(f"✔ {len(filas)} estaciones ({activas} con datos en la última semana) → sitio/data/importadas/vismet.csv")


if __name__ == "__main__":
    main()
