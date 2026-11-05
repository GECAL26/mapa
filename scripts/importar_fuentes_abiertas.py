#!/usr/bin/env python3
"""Importa catálogos abiertos de estaciones de Latinoamérica al formato del Mapa GECAL.

Cada fuente es un paquete de software libre que mantiene, dentro de su repositorio, la
tabla de estaciones (nombre, código y coordenadas) de una red oficial. Se clonan los
repositorios y este script los convierte, sin pasos manuales:

  fuente          repositorio (licencia MIT)              red oficial
  -------------   -------------------------------------   ------------------------------------------
  sinaica         github.com/diegovalle/rsinaica          SINAICA (INECC, México)
  cetesb          github.com/ropensci/qualR               CETESB QUALAR (São Paulo, Brasil)
  monitorar       github.com/ropensci/qualR               MonitorAr (Prefeitura do Rio de Janeiro)
  senamhi         github.com/quishqa/limaair              SENAMHI (Lima, Perú): calidad del aire y EMA
  noaa_isd        github.com/ropensci/GSODR               NOAA NCEI Integrated Surface Database

Uso:
  pip install rdata            # lector de archivos .rda (Python puro)
  mkdir -p /tmp/fuentes && cd /tmp/fuentes
  for r in diegovalle/rsinaica ropensci/qualR quishqa/limaair ropensci/GSODR; do
      git clone --depth 1 https://github.com/$r.git; done
  python scripts/importar_fuentes_abiertas.py /tmp/fuentes
  python scripts/actualizar_catalogo.py --solo-importadas

Escribe sitio/data/importadas/<fuente>.csv (una fila por estación).

Criterios (documentados para que la conversión sea reproducible y auditable):
  * Estas tablas no dicen qué variables mide cada estación: `contaminantes` y
    `meteorologia` quedan vacíos (salvo NOAA ISD, ver abajo) y `estado_operativo` = «No sé»,
    salvo que la fuente lo indique.
  * NOAA ISD: solo estaciones de países de LAC cuya última observación (END) está dentro de
    los 90 días previos a la fecha más reciente del archivo (se consideran activas a esa
    fecha). Variables típicas de los reportes SYNOP/METAR que integra ISD (temperatura,
    humedad, presión y viento); no se verifican estación por estación.
  * Chile se excluye por ahora en todas las fuentes: se cargará completo desde MIRA Chile.
  * CORRECCIONES: errores evidentes de tipeo en la fuente se corrigen acá, uno por uno y
    con su justificación (ver CORRECCIONES).
"""
from __future__ import annotations

import csv
import sys
import warnings
from datetime import datetime, timedelta
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
DESTINO = RAIZ / "sitio" / "data" / "importadas"
EXCLUIR_PAISES = {"Chile"}  # se carga completo desde MIRA Chile

CAMPOS = ["id_gecal", "fecha_carga", "pais", "division", "localidad", "latitud", "longitud",
          "altitud_m", "nombre_estacion", "codigo", "red", "operador", "tipo_estacion", "entorno",
          "instrumental", "contaminantes", "meteorologia", "frecuencia", "anio_inicio",
          "estado_operativo", "acceso_datos", "url_datos", "fuente"]

# (fuente, código) -> {campo: valor corregido}, con la razón
CORRECCIONES = {
    # En qualR, «Americana-Vila Sta Maria» tiene lon -41.339550 y la estación «Americana»
    # (mismo municipio) -47.339549 con la misma latitud: -41 cae a ~600 km, en el litoral.
    ("CETESB", "105"): {"longitud": -47.339550},
    # Mismo error en «Paulínia-Sta Terezinha»: lon -41.113904 cae en el mar frente a Rio de
    # Janeiro; Paulínia (SP) está en -47.1. El validador lo detecta como «fuera del país».
    ("CETESB", "291"): {"longitud": -47.113904},
}

ESTADOS_MX = {1: "Aguascalientes", 2: "Baja California", 3: "Baja California Sur", 4: "Campeche",
              5: "Coahuila", 6: "Colima", 7: "Chiapas", 8: "Chihuahua", 9: "Ciudad de México",
              10: "Durango", 11: "Guanajuato", 12: "Guerrero", 13: "Hidalgo", 14: "Jalisco",
              15: "Estado de México", 16: "Michoacán", 17: "Morelos", 18: "Nayarit", 19: "Nuevo León",
              20: "Oaxaca", 21: "Puebla", 22: "Querétaro", 23: "Quintana Roo", 24: "San Luis Potosí",
              25: "Sinaloa", 26: "Sonora", 27: "Tabasco", 28: "Tamaulipas", 29: "Tlaxcala",
              30: "Veracruz", 31: "Yucatán", 32: "Zacatecas"}

PAISES_ISO2 = {"AG": "Antigua y Barbuda", "AR": "Argentina", "BS": "Bahamas", "BB": "Barbados",
               "BZ": "Belice", "BO": "Bolivia", "BR": "Brasil", "CL": "Chile", "CO": "Colombia",
               "CR": "Costa Rica", "CU": "Cuba", "DM": "Dominica", "DO": "República Dominicana",
               "EC": "Ecuador", "SV": "El Salvador", "GD": "Granada", "GF": "Guayana Francesa",
               "GT": "Guatemala", "GY": "Guyana", "HT": "Haití", "HN": "Honduras", "JM": "Jamaica",
               "MX": "México", "NI": "Nicaragua", "PA": "Panamá", "PY": "Paraguay", "PE": "Perú",
               "PR": "Puerto Rico", "KN": "San Cristóbal y Nieves", "VC": "San Vicente y las Granadinas",
               "LC": "Santa Lucía", "SR": "Surinam", "TT": "Trinidad y Tobago", "UY": "Uruguay",
               "VE": "Venezuela"}

# Estaciones que se omiten porque la fuente tiene coordenadas inconsistentes y no hay
# un valor correcto verificable (mejor sin punto que con un punto mal ubicado).
EXCLUSIONES = {
    # limaair: lon -77.776056 repite los decimales de la lat (-11.776056) y cae en el mar.
    ("SENAMHI", "472A218A"),
}

HOY = datetime.now().date().isoformat()


def leer_rda(ruta: Path):
    import rdata  # pip install rdata
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        return next(iter(rdata.read_rda(str(ruta)).values()))


def vacio(v) -> bool:
    return v is None or (isinstance(v, float) and v != v) or str(v).strip() in ("", "nan", "NA", "<NA>")


def txt(v) -> str:
    return "" if vacio(v) else str(v).strip()


def fila(**k) -> dict:
    base = {c: "" for c in CAMPOS}
    base.update({"fecha_carga": HOY, "estado_operativo": "No sé", "acceso_datos": "No sé"})
    base.update(k)
    corr = CORRECCIONES.get((k.get("fuente"), str(k.get("codigo"))))
    if corr:
        base.update(corr)
    base["latitud"] = round(float(base["latitud"]), 6)
    base["longitud"] = round(float(base["longitud"]), 6)
    return base


def nombre_propio(s: str) -> str:
    """'ESTACAO BANGU' -> 'Estacao Bangu' (solo si viene todo en mayúsculas)."""
    s = " ".join(txt(s).split())
    return s.title() if s.isupper() else s


# ------------------------------------------------------------------- fuentes
def sinaica(base: Path) -> list[dict]:
    d = leer_rda(base / "rsinaica/data/stations_sinaica.rda")
    salida = []
    for _, r in d.iterrows():
        estado = ESTADOS_MX.get(int(r.state_code)) if txt(r.state_code).isdigit() else ""
        red = txt(r.network_name)
        anio = txt(r.date_started)[:4] or txt(r.year_started)
        salida.append(fila(
            id_gecal=f"MX-SINAICA-{int(r.station_id)}", pais="México", division=estado or "",
            localidad=red.replace("Municipio de ", ""), latitud=r.lat, longitud=r.lon,
            altitud_m=txt(r.altitude), nombre_estacion=txt(r.station_name), codigo=txt(r.station_code),
            red=f"SINAICA — {red}", operador=red, tipo_estacion="Calidad del aire",
            anio_inicio=anio if anio.isdigit() else "",
            acceso_datos="Públicos, en tiempo real o casi real", url_datos="https://sinaica.inecc.gob.mx/",
            fuente="SINAICA"))
    return salida


def cetesb(base: Path) -> list[dict]:
    d = leer_rda(base / "qualR/data/cetesb_aqs.rda")
    salida = []
    for _, r in d.iterrows():
        cod = str(int(r.code))
        salida.append(fila(
            id_gecal=f"BR-CETESB-{cod}", pais="Brasil", division="São Paulo",
            localidad=txt(r["name"]).split("-")[0].strip(), latitud=r.lat, longitud=r.lon,
            nombre_estacion=txt(r["name"]), codigo=cod, red="CETESB QUALAR", operador="CETESB",
            tipo_estacion="Calidad del aire",
            acceso_datos="Públicos, en tiempo real o casi real",
            url_datos="https://qualar.cetesb.sp.gov.br/qualar/home.do", fuente="CETESB"))
    return salida


def monitorar(base: Path) -> list[dict]:
    d = leer_rda(base / "qualR/data/monitor_ar_aqs.rda")
    salida = []
    for _, r in d.iterrows():
        nom = nombre_propio(r["name"]).replace("Estacao ", "Estação ")
        salida.append(fila(
            id_gecal=f"BR-MONITORAR-{txt(r.code)}", pais="Brasil", division="Rio de Janeiro",
            localidad="Rio de Janeiro", latitud=r.lat, longitud=r.lon, nombre_estacion=nom,
            codigo=txt(r.code), red="MonitorAr-Rio", operador="Prefeitura do Rio de Janeiro (SMAC)",
            tipo_estacion="Calidad del aire y meteorología", entorno="Urbana",
            acceso_datos="Públicos, solo históricos",
            url_datos="https://www.data.rio/datasets/dados-horários-do-monitoramento-da-qualidade-do-ar-monitorar",
            fuente="MonitorAr-Rio"))
    return salida


def senamhi(base: Path) -> list[dict]:
    salida = []
    for archivo, tipo, red in (("senamhi_aqs.rda", "Calidad del aire", "SENAMHI — Calidad del aire Lima"),
                               ("senamhi_aws.rda", "Meteorológica", "SENAMHI — Estaciones meteorológicas automáticas")):
        d = leer_rda(base / "limaair/data" / archivo)
        for _, r in d.iterrows():
            cod = txt(r.code).replace(".0", "")
            salida.append(fila(
                id_gecal=f"PE-SENAMHI-{cod}", pais="Perú", division="Lima", localidad="Lima",
                latitud=r.lat, longitud=r.lon, nombre_estacion=txt(r.aqs), codigo=cod, red=red,
                operador="SENAMHI", tipo_estacion=tipo, entorno="Urbana",
                acceso_datos="Públicos, en tiempo real o casi real",
                url_datos="https://www.senamhi.gob.pe/?p=calidad-del-aire" if tipo == "Calidad del aire"
                else "https://www.senamhi.gob.pe/?p=estaciones", fuente="SENAMHI"))
    return salida


def noaa_isd(base: Path) -> list[dict]:
    d = leer_rda(base / "GSODR/inst/extdata/isd_history.rda")
    d = d[d.ISO2C.isin(PAISES_ISO2)]
    fin = d.END.astype(str)
    ultima = datetime.strptime(fin.max(), "%Y%m%d")
    corte = (ultima - timedelta(days=90)).strftime("%Y%m%d")
    d = d[fin >= corte]
    salida = []
    for _, r in d.iterrows():
        alt = r["ELEV(M)"]
        alt = "" if vacio(alt) or float(alt) < -400 else alt
        salida.append(fila(
            id_gecal=f"ISD-{r.STNID}", pais=PAISES_ISO2[r.ISO2C], localidad="",
            latitud=r.LAT, longitud=r.LON, altitud_m=alt, nombre_estacion=nombre_propio(r.NAME),
            codigo=r.STNID, red="Red sinóptica / aeronáutica (vía NOAA ISD)",
            operador="Servicio meteorológico nacional (compila NOAA NCEI)", tipo_estacion="Meteorológica",
            meteorologia="Temperatura; Humedad relativa; Presión; Velocidad del viento; Dirección del viento",
            frecuencia="Variable / otra", anio_inicio=str(r.BEGIN)[:4], estado_operativo="Sí",
            acceso_datos="Públicos, en tiempo real o casi real",
            url_datos="https://www.ncei.noaa.gov/products/land-based-station/integrated-surface-database",
            fecha_carga=ultima.date().isoformat(), fuente="NOAA ISD"))
    return salida


FUENTES = {"sinaica": sinaica, "cetesb": cetesb, "monitorar": monitorar, "senamhi": senamhi,
           "noaa_isd": noaa_isd}


def main(base: Path, elegidas: list[str]) -> None:
    DESTINO.mkdir(parents=True, exist_ok=True)
    for nombre in elegidas:
        try:
            filas = FUENTES[nombre](base)
        except FileNotFoundError as e:
            print(f"✖ {nombre}: no encuentro {e.filename}; ¿clonaste el repositorio?")
            continue
        filas = [f for f in filas if f["pais"] not in EXCLUIR_PAISES
                 and (f["fuente"], str(f["codigo"])) not in EXCLUSIONES]
        with (DESTINO / f"{nombre}.csv").open("w", newline="", encoding="utf-8") as fh:
            w = csv.DictWriter(fh, fieldnames=CAMPOS)
            w.writeheader()
            w.writerows(filas)
        print(f"✔ {nombre}: {len(filas)} estaciones → {(DESTINO / (nombre + '.csv')).relative_to(RAIZ)}")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    main(Path(sys.argv[1]), sys.argv[2:] or list(FUENTES))
