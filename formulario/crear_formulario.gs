/**
 * Mapa GECAL — Formulario colaborativo de estaciones de monitoreo atmosférico
 * ---------------------------------------------------------------------------
 * Cómo usarlo (una sola vez):
 *   1. Entrar a https://script.google.com con la cuenta que va a administrar el formulario.
 *   2. "Nuevo proyecto", borrar el contenido y pegar este archivo completo.
 *   3. Elegir la función `crearFormulario` en el menú superior y apretar "Ejecutar".
 *      Google pide autorizar permisos (Formularios y Hojas de cálculo): aceptar.
 *   4. En "Registro de ejecución" aparecen los enlaces al formulario (para compartir),
 *      al editor del formulario y a la hoja de respuestas.
 *
 * Revisión:
 *   - En la hoja de respuestas, pestaña "Respuestas", completar las columnas
 *     `estado_revision` (Pendiente / Aprobado / Rechazado / Requiere corrección),
 *     `revisor` y `notas_revision`.
 *   - Desde este mismo proyecto de Apps Script, ejecutar `exportarAprobadas`: copia
 *     las filas aprobadas, SIN datos personales, a la pestaña "publicadas". Esa
 *     pestaña es la que alimenta el mapa.
 *   - Opcional: ejecutar una vez `instalarActualizacionDiaria` para que la
 *     exportación corra sola todos los días.
 *
 * Los encabezados de "publicadas" coinciden con las claves que espera
 * scripts/actualizar_catalogo.py. Si cambiás el texto de una pregunta, actualizá
 * también PREGUNTAS (abajo) para que el mapeo siga funcionando.
 */

const TITULO_FORM = 'Mapa GECAL — Estaciones de monitoreo atmosférico en Latinoamérica y el Caribe';

const PAISES = [
  'Antigua y Barbuda', 'Argentina', 'Bahamas', 'Barbados', 'Belice', 'Bolivia', 'Brasil', 'Chile',
  'Colombia', 'Costa Rica', 'Cuba', 'Dominica', 'Ecuador', 'El Salvador', 'Granada', 'Guatemala',
  'Guayana Francesa', 'Guyana', 'Haití', 'Honduras', 'Jamaica', 'México', 'Nicaragua', 'Panamá',
  'Paraguay', 'Perú', 'Puerto Rico', 'República Dominicana', 'San Cristóbal y Nieves',
  'San Vicente y las Granadinas', 'Santa Lucía', 'Surinam', 'Trinidad y Tobago', 'Uruguay', 'Venezuela',
  'Otro'
];

const CONTAMINANTES = ['MP10', 'MP2.5', 'MP1', 'O3', 'NO', 'NO2', 'NOx', 'SO2', 'CO', 'CO2', 'CH4',
  'H2S', 'NH3', 'COV / BTEX', 'HCHO', 'Carbono negro (BC)', 'Metales en material particulado'];

const METEO = ['Temperatura', 'Humedad relativa', 'Presión', 'Velocidad del viento',
  'Dirección del viento', 'Precipitación', 'Radiación solar'];

/** clave interna -> texto exacto de la pregunta */
const PREGUNTAS = {
  aportante_nombre: 'Nombre y apellido',
  aportante_correo: 'Correo electrónico',
  aportante_institucion: 'Institución de pertenencia',
  aportante_relacion: 'Relación con la estación',
  pais: 'País',
  division: 'Provincia / Estado / Departamento',
  localidad: 'Ciudad o localidad',
  latitud: 'Latitud (grados decimales)',
  longitud: 'Longitud (grados decimales)',
  altitud_m: 'Altitud (m s.n.m.)',
  nombre_estacion: 'Nombre de la estación',
  codigo: 'Código o ID en la red (si existe)',
  red: 'Red o programa de monitoreo',
  operador: 'Institución que opera la estación',
  tipo_estacion: 'Tipo de estación',
  entorno: 'Entorno',
  instrumental: 'Tipo de instrumental',
  contaminantes: 'Contaminantes medidos',
  meteorologia: 'Variables meteorológicas medidas',
  frecuencia: 'Frecuencia de registro',
  anio_inicio: 'Año de inicio de las mediciones',
  estado_operativo: '¿La estación está operativa actualmente?',
  acceso_datos: '¿Los datos están disponibles?',
  url_datos: 'Enlace a los datos o a la red',
  comentarios: 'Comentarios',
  consentimiento: 'Autorización de publicación'
};

/** Columnas que se publican en el mapa (nunca datos personales del aportante). */
const PUBLICAS = ['pais', 'division', 'localidad', 'latitud', 'longitud', 'altitud_m',
  'nombre_estacion', 'codigo', 'red', 'operador', 'tipo_estacion', 'entorno', 'instrumental',
  'contaminantes', 'meteorologia', 'frecuencia', 'anio_inicio', 'estado_operativo',
  'acceso_datos', 'url_datos'];

const COLS_REVISION = ['estado_revision', 'revisor', 'notas_revision'];
const ESTADOS_REVISION = ['Pendiente', 'Aprobado', 'Rechazado', 'Requiere corrección'];

function crearFormulario() {
  const form = FormApp.create(TITULO_FORM);
  form.setDescription(
    'GECAL (Grupo de Estudios de Calidad de Aire en Latinoamérica) arma un mapa abierto de las ' +
    'estaciones que miden calidad del aire y meteorología en la región. Si conocés una estación, ' +
    'cargala acá: cada envío lo revisa el equipo antes de publicarse.\n\n' +
    'Una respuesta = una estación. Si conocés varias, enviá el formulario una vez por cada una ' +
    '(al final aparece el enlace para cargar otra).\n\n' +
    'Tu nombre y correo NO se publican; los usamos solo para consultarte si hay dudas.');
  form.setCollectEmail(false);
  form.setProgressBar(true);
  form.setConfirmationMessage('¡Gracias! El equipo de GECAL va a revisar la estación antes de sumarla al mapa.');
  form.setShowLinkToRespondAgain(true);

  // --- 1. Quién carga ---------------------------------------------------
  form.addSectionHeaderItem().setTitle('1. Quién carga la información');
  form.addTextItem().setTitle(PREGUNTAS.aportante_nombre).setRequired(true);
  form.addTextItem().setTitle(PREGUNTAS.aportante_correo).setRequired(true)
    .setValidation(FormApp.createTextValidation().requireTextIsEmail()
      .setHelpText('Ingresá un correo válido.').build());
  form.addTextItem().setTitle(PREGUNTAS.aportante_institucion);
  form.addMultipleChoiceItem().setTitle(PREGUNTAS.aportante_relacion).setRequired(true)
    .setChoiceValues(['Opero o administro la estación', 'Uso sus datos',
      'La conozco por información pública']).showOtherOption(true);

  // --- 2. Ubicación -----------------------------------------------------
  form.addPageBreakItem().setTitle('2. Ubicación')
    .setHelpText('Coordenadas en grados decimales, WGS84. En Latinoamérica la longitud es negativa ' +
      '(oeste) y la latitud es negativa al sur del ecuador. Ej.: Córdoba, Argentina = -31.42, -64.19.');
  form.addListItem().setTitle(PREGUNTAS.pais).setRequired(true).setChoiceValues(PAISES);
  form.addTextItem().setTitle(PREGUNTAS.division);
  form.addTextItem().setTitle(PREGUNTAS.localidad).setRequired(true);
  form.addTextItem().setTitle(PREGUNTAS.latitud).setRequired(true)
    .setHelpText('Ej.: -31.4201').setValidation(FormApp.createTextValidation()
      .requireNumberBetween(-60, 33).setHelpText('Número entre -60 y 33 (usá punto decimal).').build());
  form.addTextItem().setTitle(PREGUNTAS.longitud).setRequired(true)
    .setHelpText('Ej.: -64.1888').setValidation(FormApp.createTextValidation()
      .requireNumberBetween(-120, -25).setHelpText('Número entre -120 y -25 (negativo = oeste).').build());
  form.addTextItem().setTitle(PREGUNTAS.altitud_m)
    .setValidation(FormApp.createTextValidation().requireNumberBetween(-100, 7000)
      .setHelpText('Metros sobre el nivel del mar.').build());

  // --- 3. La estación ---------------------------------------------------
  form.addPageBreakItem().setTitle('3. La estación');
  form.addTextItem().setTitle(PREGUNTAS.nombre_estacion).setRequired(true);
  form.addTextItem().setTitle(PREGUNTAS.codigo);
  form.addTextItem().setTitle(PREGUNTAS.red).setRequired(true)
    .setHelpText('Ej.: SINCA, RAMA, red municipal, PurpleAir, red propia de una universidad...');
  form.addTextItem().setTitle(PREGUNTAS.operador).setRequired(true);
  form.addMultipleChoiceItem().setTitle(PREGUNTAS.tipo_estacion).setRequired(true)
    .setChoiceValues(['Calidad del aire', 'Meteorológica', 'Calidad del aire y meteorología']);
  form.addMultipleChoiceItem().setTitle(PREGUNTAS.entorno)
    .setChoiceValues(['Urbana', 'Suburbana', 'Rural', 'Industrial', 'De tráfico',
      'Remota / de fondo', 'No sé']);
  form.addCheckboxItem().setTitle(PREGUNTAS.instrumental).setRequired(true)
    .setChoiceValues(['Equipos de referencia o equivalentes', 'Sensores de bajo costo',
      'Muestreadores manuales o pasivos', 'Sensores remotos / perfiladores', 'No sé']);

  // --- 4. Mediciones ----------------------------------------------------
  form.addPageBreakItem().setTitle('4. Qué mide');
  form.addCheckboxItem().setTitle(PREGUNTAS.contaminantes).setChoiceValues(CONTAMINANTES)
    .showOtherOption(true);
  form.addCheckboxItem().setTitle(PREGUNTAS.meteorologia).setChoiceValues(METEO)
    .showOtherOption(true);
  form.addMultipleChoiceItem().setTitle(PREGUNTAS.frecuencia)
    .setChoiceValues(['1 min o menos', '5 a 15 min', '1 hora', '24 horas', 'Variable / otra', 'No sé']);
  form.addTextItem().setTitle(PREGUNTAS.anio_inicio)
    .setValidation(FormApp.createTextValidation().requireNumberBetween(1950, 2030)
      .setHelpText('Año con 4 dígitos.').build());
  form.addMultipleChoiceItem().setTitle(PREGUNTAS.estado_operativo).setRequired(true)
    .setChoiceValues(['Sí', 'No (discontinuada)', 'No sé']);

  // --- 5. Acceso a datos ------------------------------------------------
  form.addPageBreakItem().setTitle('5. Acceso a los datos');
  form.addMultipleChoiceItem().setTitle(PREGUNTAS.acceso_datos).setRequired(true)
    .setChoiceValues(['Públicos, en tiempo real o casi real', 'Públicos, solo históricos',
      'A pedido o con convenio', 'No disponibles', 'No sé']);
  form.addTextItem().setTitle(PREGUNTAS.url_datos)
    .setValidation(FormApp.createTextValidation().requireTextIsUrl()
      .setHelpText('Pegá un enlace completo (https://...).').build());
  form.addParagraphTextItem().setTitle(PREGUNTAS.comentarios)
    .setHelpText('Lo que quieras agregar: períodos sin datos, cambios de ubicación, contactos, etc.');
  form.addCheckboxItem().setTitle(PREGUNTAS.consentimiento).setRequired(true)
    .setHelpText('Se publican solo los datos de la estación; nunca tu nombre ni tu correo.')
    .setChoiceValues(['Autorizo que los datos de la estación se publiquen en el mapa abierto de GECAL']);

  // --- Hoja de respuestas + columnas de revisión ------------------------
  const ss = SpreadsheetApp.create('Mapa GECAL — respuestas y revisión');
  form.setDestination(FormApp.DestinationType.SPREADSHEET, ss.getId());
  SpreadsheetApp.flush();
  Utilities.sleep(3000);

  const hoja = obtenerHojaRespuestas_(ss);
  hoja.setName('Respuestas');
  const ultimaCol = hoja.getLastColumn();
  hoja.getRange(1, ultimaCol + 1, 1, COLS_REVISION.length).setValues([COLS_REVISION])
    .setBackground('#fde68a').setFontWeight('bold');
  const regla = SpreadsheetApp.newDataValidation().requireValueInList(ESTADOS_REVISION, true).build();
  hoja.getRange(2, ultimaCol + 1, 999, 1).setDataValidation(regla);
  hoja.setFrozenRows(1);

  // Pestaña pública
  const pub = ss.insertSheet('publicadas');
  pub.getRange(1, 1, 1, PUBLICAS.length + 2).setValues([['id_gecal', 'fecha_carga'].concat(PUBLICAS)]);

  // Guardar ids para el menú
  PropertiesService.getScriptProperties().setProperties({ FORM_ID: form.getId(), SHEET_ID: ss.getId() });

  Logger.log('Formulario para compartir: ' + form.getPublishedUrl());
  Logger.log('Editor del formulario:     ' + form.getEditUrl());
  Logger.log('Hoja de revisión:          ' + ss.getUrl());
  Logger.log('Después de revisar, ejecutá exportarAprobadas() desde este mismo proyecto.');
}

function obtenerHojaRespuestas_(ss) {
  const hojas = ss.getSheets();
  for (let i = 0; i < hojas.length; i++) {
    if (hojas[i].getFormUrl()) return hojas[i];
  }
  return hojas[0];
}

/** Copia las filas con estado_revision = "Aprobado" a la pestaña "publicadas" (sin datos personales). */
function exportarAprobadas() {
  const id = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  const ss = id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
  const hoja = ss.getSheetByName('Respuestas') || obtenerHojaRespuestas_(ss);
  const valores = hoja.getDataRange().getDisplayValues();
  const enc = valores[0].map(function (h) { return String(h).trim(); });

  const idx = {};
  Object.keys(PREGUNTAS).forEach(function (k) { idx[k] = enc.indexOf(PREGUNTAS[k]); });
  COLS_REVISION.forEach(function (k) { idx[k] = enc.indexOf(k); });
  const iFecha = enc.indexOf('Marca temporal') >= 0 ? enc.indexOf('Marca temporal') : enc.indexOf('Timestamp');
  if (idx.estado_revision < 0) throw new Error('No encuentro la columna estado_revision en "Respuestas".');

  const salida = [['id_gecal', 'fecha_carga'].concat(PUBLICAS)];
  for (let r = 1; r < valores.length; r++) {
    const fila = valores[r];
    if (String(fila[idx.estado_revision]).trim().toLowerCase() !== 'aprobado') continue;
    const idGecal = 'G' + ('0000' + (r + 1)).slice(-4); // fila de la hoja: estable mientras no se borren filas
    const fecha = iFecha >= 0 ? String(fila[iFecha]).split(' ')[0] : '';
    salida.push([idGecal, fecha].concat(PUBLICAS.map(function (k) {
      return idx[k] >= 0 ? fila[idx[k]] : '';
    })));
  }
  let pub = ss.getSheetByName('publicadas');
  if (!pub) pub = ss.insertSheet('publicadas');
  pub.clearContents();
  pub.getRange(1, 1, salida.length, salida[0].length).setValues(salida);
  Logger.log('Estaciones aprobadas exportadas: ' + (salida.length - 1));
}

function instalarActualizacionDiaria() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'exportarAprobadas') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('exportarAprobadas').timeBased().everyDays(1).atHour(6).create();
  Logger.log('Listo: "publicadas" se actualiza todos los días a las 6 h.');
}
