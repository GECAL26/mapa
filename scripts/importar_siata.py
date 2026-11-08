"""
Importa a siata.csv las estaciones de SIATA (calidad del aire y meteorología)

__author__: "Duvan Nieves"
__copyright__: "Universidad Nacional"
__version__: "0.0.1"
__maintaner__: "Duvan Nieves Ruiz"
__email__: "dnieves.sci@gmail.com"
__status__: "Developer"
__changues__:
    - [2026-11-08][Duvan]: Primera versión del código.
"""
from re import search
from json import loads
from time import sleep
from io import StringIO
from pathlib import Path
from datetime import date
from csv import DictReader, DictWriter
from urllib.request import Request, urlopen

#%% CONFIGURACIÓN
url_base     = 'https://datos.siata.gov.co/api'
doi_aire     = 'doi:10.83041/XTI3FH'
ruta_meta    = '/datasets/:persistentId/versions/:latest?excludeFiles=true&persistentId='
ruta_files   = '/datasets/:persistentId/versions/:latest/files?limit=1000&persistentId='
url_aire     = 'https://datos.siata.gov.co/dataverse/RedCalidadAire'
cabecera     = {'User-Agent': 'GECAL-mapa/1.0 (+https://github.com/GECAL26/mapa)'}
intentos     = 5
espera       = 25
pausa        = 0.2
tolerancia   = 0.05
meses_activa = 3
hoy          = date.today().isoformat()
ruta_salida  = Path(__file__).resolve().parent.parent / 'sitio' / 'data' / 'importadas' / 'siata.csv'

#%% COLECCIONES Y VARIABLES
colecciones = {'Meteorológica': ('MET', []),
               'Pluviométrica': ('PLU', ['Precipitación']),
               'Disdrómetro':   ('DIS', ['Precipitación']),
               'Piranómetro':   ('PIR', ['Radiación solar'])}
vars_aire   = {'PM2.5': 'MP2.5', 'PM10': 'MP10', 'O3': 'O3', 'SO2': 'SO2', 'CO': 'CO', 'NOx': 'NOx'}
campos      = ['id_gecal', 'fecha_carga', 'pais', 'division', 'localidad', 'latitud', 'longitud', 'altitud_m',
               'nombre_estacion', 'codigo', 'red', 'operador', 'tipo_estacion', 'entorno', 'instrumental',
               'contaminantes', 'meteorologia', 'frecuencia', 'anio_inicio', 'estado_operativo', 'acceso_datos',
               'url_datos', 'fuente']

#%% DESCARGA
cola   = [('busqueda', f'{url_base}/search?q=*&type=dataset&per_page=1000'),
          ('aire_lista', f'{url_base}{ruta_files}{doi_aire}')]
cuerpo = {}
fallos = []
for clave, url in cola:
    for intento in range(intentos):
        try:
            with urlopen(Request(url, headers=cabecera), timeout=espera) as r:
                cuerpo[clave] = r.read()
            break
        except OSError:
            sleep(2 * (intento + 1))
    else:
        fallos.append(clave)
        continue
    if clave == 'busqueda':
        cola += [(f'{k}|{i["global_id"]}', f'{url_base}{ruta}{i["global_id"]}')
            for i in loads(cuerpo[clave])['data']['items'] if i['name_of_dataverse'] in colecciones
            for k, ruta in (('meta', ruta_meta), ('files', ruta_files))]
    if clave == 'aire_lista':
        ids = {f['label']: f['dataFile']['id'] for f in loads(cuerpo[clave])['data']}
        cola += [(k, f'{url_base}/access/datafile/{ids[a]}?format=original')
            for k, a in (('aire_estaciones', 'Estaciones_calidad_aire.tab'),
                ('aire_fechas', 'Fechas_monitoreo_calidad_aire.tab'))]
    sleep(pausa)

if {'busqueda', 'aire_lista', 'aire_estaciones', 'aire_fechas'} - cuerpo.keys() or len(fallos) > tolerancia * len(cola):
    raise SystemExit(f'Descarga incompleta: {len(fallos)} de {len(cola)} consultas fallaron: {fallos[:10]}')

#%% ESTACIONES DE CALIDAD DEL AIRE
est_aire = list(DictReader(StringIO(cuerpo['aire_estaciones'].decode('utf-8-sig'))))
fechas   = {f['Nombre_Corto_Estacion']: f for f in DictReader(StringIO(cuerpo['aire_fechas'].decode('utf-8-sig')))}
filas    = []
sin_dato = []
for e in est_aire:
    f       = fechas[e['Nombre_Corto_Estacion']]
    medidas = [v for v in vars_aire if f[f'{v}_Activacion'].strip()]
    activas = [v for v in medidas if not f[f'{v}_Suspension'].strip()]
    if not medidas:
        sin_dato.append(e['Nombre_Corto_Estacion'])
        continue
    # SIATA da la fecha de suspensión por variable: sin ninguna variable activa se considera discontinuada
    filas.append({'id_gecal': f'SIATA-AQ-{e["Código"]}', 'pais': 'Colombia', 'division': 'Antioquia',
        'localidad': e['Municipio'], 'latitud': e['Latitud'], 'longitud': e['Longitud'],
        'nombre_estacion': e['Nombre_Completo_Estacion'], 'codigo': e['Nombre_Corto_Estacion'],
        'tipo_estacion': 'Calidad del aire', 'contaminantes': '; '.join(vars_aire[v] for v in (activas or medidas)),
        'anio_inicio': min(int(f[f'{v}_Activacion'][:4]) for v in medidas),
        'estado_operativo': 'Sí' if activas else 'No (discontinuada)', 'url_datos': url_aire})

#%% ESTACIONES METEOROLÓGICAS
items    = [i for i in loads(cuerpo['busqueda'])['data']['items'] if i['name_of_dataverse'] in colecciones]
sin_ubic = []
for i in items:
    pid = i['global_id']
    if f'meta|{pid}' not in cuerpo or f'files|{pid}' not in cuerpo:
        continue
    bloques = loads(cuerpo[f'meta|{pid}'])['data']['metadataBlocks']
    geo     = {f['typeName']: f['value'] for f in bloques.get('geospatial', {'fields': []})['fields']}
    meses   = sorted(m.groups() for m in (search(r'_(\d{4})_(\d{2})\.tab$', f['label'])
        for f in loads(cuerpo[f'files|{pid}'])['data']) if m)
    if 'geographicBoundingBox' not in geo or not meses:
        sin_ubic.append(i['name'])
        continue
    # la caja de SIATA mide ~0.0002° de lado: es un punto, se toma su centro
    caja            = {k: float(v['value']) for k, v in geo['geographicBoundingBox'][0].items()}
    lugar           = geo.get('geographicCoverage', [{}])[0]
    codigo, nombre  = i['name'].split(' - ', 1)
    prefijo, meteo  = colecciones[i['name_of_dataverse']]
    atras           = (int(hoy[:4]) - int(meses[-1][0])) * 12 + int(hoy[5:7]) - int(meses[-1][1])
    filas.append({'id_gecal': f'SIATA-{prefijo}-{codigo}', 'pais': 'Colombia',
        'division': lugar.get('state', {}).get('value', ''), 'localidad': lugar.get('city', {}).get('value', ''),
        'latitud': round((caja['northLatitude'] + caja['southLatitude']) / 2, 6),
        'longitud': round((caja['eastLongitude'] + caja['westLongitude']) / 2, 6),
        'nombre_estacion': nombre, 'codigo': codigo, 'tipo_estacion': 'Meteorológica',
        'meteorologia': '; '.join(meteo), 'anio_inicio': int(meses[0][0]), 'url_datos': i['url'],
        'estado_operativo': 'Sí' if atras <= meses_activa else 'Sin datos recientes'})

#%% ESCRITURA
anteriores = ({r['id_gecal'] for r in DictReader(StringIO(ruta_salida.read_text(encoding='utf-8')))}
    if ruta_salida.exists() else set())
fijos      = {'fecha_carga': hoy, 'red': 'SIATA', 'operador': 'SIATA (Área Metropolitana del Valle de Aburrá)',
              'acceso_datos': 'Públicos, solo históricos', 'fuente': 'SIATA'}
filas      = sorted(({c: '' for c in campos} | fijos | f for f in filas), key=lambda f: f['id_gecal'])
with open(ruta_salida, 'w', encoding='utf-8', newline='') as a:
    w = DictWriter(a, fieldnames=campos)
    w.writeheader()
    w.writerows(filas)

ids = {f['id_gecal'] for f in filas}
print(f'SIATA: {len(filas)} estaciones ({len(ids - anteriores)} nuevas, {len(anteriores - ids)} retiradas)',
    f'- Calidad del aire: {sum(f["tipo_estacion"] == "Calidad del aire" for f in filas)}',
    f'- Meteorología: {sum(f["tipo_estacion"] == "Meteorológica" for f in filas)}',
    f'- Sin ubicación o sin archivos, omitidas: {len(sin_ubic)}', f'- Sin variables, omitidas: {len(sin_dato)}',
    f'- Consultas que fallaron y se omitieron: {len(fallos)}', sep='\n')
