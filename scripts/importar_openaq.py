#!/usr/bin/env python3
"""Importa estaciones de calidad del aire de Latinoamérica desde OpenAQ (API v3).

OpenAQ reúne datos abiertos de redes oficiales de muchos países (Argentina, Colombia,
Ecuador, Perú, Bolivia, Costa Rica, Guatemala, etc.). Su API es gratuita pero pide una clave:
  1. Crear cuenta en https://explore.openaq.org/register
  2. Copiar la API key desde el perfil (https://explore.openaq.org/account)

Uso:
  export OPENAQ_API_KEY="tu-clave"            # no la subas al repositorio
  python scripts/importar_openaq.py            # solo estaciones de referencia (redes oficiales)
  python scripts/importar_openaq.py --incluir-sensores   # suma sensores de bajo costo
  python scripts/actualizar_catalogo.py --solo-importadas

Escribe sitio/data/importadas/openaq.csv. Criterios:
  * Solo ubicaciones fijas (no móviles) en países de LAC; Chile excluido por ahora (MIRA Chile).
  * Por defecto solo `isMonitor = true` (equipos de referencia de redes oficiales).
  * Los duplicados con otras fuentes (SINAICA, CETESB, MIRA, etc.) no se resuelven acá sino en
    actualizar_catalogo.py, según el orden de PRIORIDAD.
  * Operativa = «Sí» si su último dato tiene menos de 30 días; si no, «Sin datos recientes».
  * Variables: los sensores declarados en OpenAQ, traducidos al vocabulario GECAL.
"""
from __future__ import annotations

import argparse
import csv
import json
import math
import os
import sys
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from importar_fuentes_abiertas import CAMPOS, DESTINO, EXCLUIR_PAISES, PAISES_ISO2  # noqa: E402

API = "https://api.openaq.org/v3/locations"
CACHE = Path(__file__).resolve().parent.parent / ".cache" / "openaq_locations.json"
BBOX = "-118,-56,-34,33"  # Latinoamérica y el Caribe
DIST_DUP_M = 200          # misma ubicación aunque cambie el nombre
DIST_DUP_NOMBRE_M = 3000  # mismo nombre: las fuentes a veces difieren en las coordenadas

PARAMETROS = {
    "pm10": ("c", "MP10"), "pm25": ("c", "MP2.5"), "pm1": ("c", "MP1"), "o3": ("c", "O3"),
    "no": ("c", "NO"), "no2": ("c", "NO2"), "nox": ("c", "NOx"), "so2": ("c", "SO2"),
    "co": ("c", "CO"), "co2": ("c", "CO2"), "ch4": ("c", "CH4"), "bc": ("c", "Carbono negro (BC)"),
    "nh3": ("c", "NH3"), "h2s": ("c", "H2S"),
    "temperature": ("m", "Temperatura"), "relativehumidity": ("m", "Humedad relativa"),
    "pressure": ("m", "Presión"), "wind_speed": ("m", "Velocidad del viento"),
    "wind_direction": ("m", "Dirección del viento"),
}


def pedir(params: dict, clave: str) -> dict:
    url = API + "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"X-API-Key": clave, "Accept": "application/json",
                                               "User-Agent": "mapa-gecal-importador"})
    ultimo = ""
    for intento in range(6):
        try:
            with urllib.request.urlopen(req, timeout=90) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            if e.code in (401, 403):
                sys.exit("✖ OpenAQ rechazó la clave (OPENAQ_API_KEY). Revisala en https://explore.openaq.org/account")
            if e.code == 429 or e.code >= 500:  # límite de pedidos o falla del servidor: esperar y reintentar
                ultimo = f"HTTP {e.code}"
            else:
                raise
        except (urllib.error.URLError, TimeoutError) as e:
            ultimo = str(e)
        espera = 10 * (intento + 1)
        print(f"  OpenAQ respondió con error ({ultimo}); reintento en {espera} s…")
        time.sleep(espera)
    sys.exit(f"✖ OpenAQ sigue fallando ({ultimo}). Es un problema de su servidor: probá de nuevo más tarde. "
             "El openaq.csv anterior no se modificó.")


def descargar(clave: str) -> list[dict]:
    todas, pagina = [], 1
    while True:
        datos = pedir({"bbox": BBOX, "limit": 1000, "page": pagina}, clave)
        res = datos.get("results", [])
        todas += res
        print(f"  página {pagina}: {len(res)} ubicaciones")
        if len(res) < 1000:
            return todas
        pagina += 1
        time.sleep(1)


def distancia_m(a, b) -> float:
    la1, lo1, la2, lo2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 2 * 6371000 * math.asin(math.sqrt(h))


def norm(t: str) -> str:
    t = unicodedata.normalize("NFKD", str(t)).encode("ascii", "ignore").decode().lower()
    return " ".join("".join(c if c.isalnum() else " " for c in t).split())


def ya_cargadas() -> list[tuple[float, float, str]]:
    pts = []
    for ruta in DESTINO.glob("*.csv"):
        if ruta.stem == "openaq":
            continue
        with ruta.open(encoding="utf-8") as fh:
            for f in csv.DictReader(fh):
                try:
                    pts.append((float(f["latitud"]), float(f["longitud"]), norm(f.get("nombre_estacion", ""))))
                except (KeyError, ValueError):
                    pass
    return pts


def convertir(ubicaciones: list[dict], incluir_sensores: bool) -> tuple[list[dict], dict]:
    ahora = datetime.now(timezone.utc)
    filas, omitidas = [], {"fuera de LAC o Chile": 0, "móvil": 0, "sensor de bajo costo": 0, "duplicada": 0, "sin coordenadas": 0}
    for u in ubicaciones:
        pais = PAISES_ISO2.get(((u.get("country") or {}).get("code") or "").upper())
        if not pais or pais in EXCLUIR_PAISES:
            omitidas["fuera de LAC o Chile"] += 1; continue
        if u.get("isMobile"):
            omitidas["móvil"] += 1; continue
        monitor = bool(u.get("isMonitor"))
        if not monitor and not incluir_sensores:
            omitidas["sensor de bajo costo"] += 1; continue
        c = u.get("coordinates") or {}
        if c.get("latitude") is None or c.get("longitude") is None:
            omitidas["sin coordenadas"] += 1; continue
        punto = (float(c["latitude"]), float(c["longitude"]))

        cont, met = [], []
        for s in u.get("sensors") or []:
            nombre = ((s.get("parameter") or {}).get("name") or "").lower()
            if nombre in PARAMETROS:
                lista, valor = PARAMETROS[nombre]
                destino = cont if lista == "c" else met
                if valor not in destino:
                    destino.append(valor)
        tipo = ("Calidad del aire y meteorología" if cont and met else
                "Calidad del aire" if cont else "Meteorológica" if met else "Calidad del aire")

        def fecha(campo):
            v = (u.get(campo) or {}).get("utc")
            try:
                return datetime.fromisoformat(v.replace("Z", "+00:00")) if v else None
            except ValueError:
                return None
        primera, ultima = fecha("datetimeFirst"), fecha("datetimeLast")
        reciente = ultima and (ahora - ultima).days <= 30
        proveedor = (u.get("provider") or {}).get("name") or ""
        dueno = (u.get("owner") or {}).get("name") or proveedor or "No informado en OpenAQ"

        filas.append({**{k: "" for k in CAMPOS},
            "id_gecal": f"OAQ-{u['id']}", "fecha_carga": ahora.date().isoformat(), "pais": pais,
            "localidad": u.get("locality") or "", "latitud": round(punto[0], 6), "longitud": round(punto[1], 6),
            "nombre_estacion": u.get("name") or f"OpenAQ {u['id']}", "codigo": str(u["id"]),
            "red": proveedor or "OpenAQ", "operador": dueno, "tipo_estacion": tipo,
            "instrumental": "Equipos de referencia o equivalentes" if monitor else "Sensores de bajo costo",
            "contaminantes": "; ".join(cont), "meteorologia": "; ".join(met),
            "anio_inicio": primera.year if primera else "",
            "estado_operativo": "Sí" if reciente else "Sin datos recientes",
            "acceso_datos": "Públicos, en tiempo real o casi real" if reciente else "Públicos, solo históricos",
            "url_datos": f"https://explore.openaq.org/locations/{u['id']}", "fuente": "OpenAQ"})
    return filas, omitidas


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--incluir-sensores", action="store_true", help="sumar sensores de bajo costo (isMonitor = false)")
    ap.add_argument("--desde-json", help="usar una respuesta guardada en vez de llamar a la API (pruebas)")
    ap.add_argument("--usar-cache", action="store_true",
                    help="reusar la última descarga guardada en .cache/ en vez de llamar a la API")
    a = ap.parse_args()
    if a.desde_json or a.usar_cache:
        ruta = Path(a.desde_json) if a.desde_json else CACHE
        if not ruta.exists():
            sys.exit(f"✖ No existe {ruta}; corré primero sin --usar-cache.")
        ubicaciones = json.loads(ruta.read_text(encoding="utf-8"))["results"]
    else:
        clave = os.environ.get("OPENAQ_API_KEY")
        if not clave:
            sys.exit("✖ Falta la variable OPENAQ_API_KEY (ver instrucciones al inicio del script).")
        print("Descargando ubicaciones de OpenAQ…")
        ubicaciones = descargar(clave)
        CACHE.parent.mkdir(exist_ok=True)
        CACHE.write_text(json.dumps({"descargado": datetime.now(timezone.utc).isoformat(), "results": ubicaciones}),
                         encoding="utf-8")
    filas, omitidas = convertir(ubicaciones, a.incluir_sensores)
    DESTINO.mkdir(parents=True, exist_ok=True)
    with (DESTINO / "openaq.csv").open("w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=CAMPOS); w.writeheader(); w.writerows(filas)
    print(f"✔ {len(filas)} estaciones → sitio/data/importadas/openaq.csv")
    print("  omitidas: " + ", ".join(f"{k}: {v}" for k, v in omitidas.items() if v))


if __name__ == "__main__":
    main()
