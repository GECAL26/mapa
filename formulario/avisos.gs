/**
 * Mapa GECAL — Aviso por mail de cada carga nueva
 * ---------------------------------------------------------------------------
 * Va en el MISMO proyecto de Apps Script donde se ejecutó crearFormulario
 * (usa PREGUNTAS y el SHEET_ID que guardó ese script).
 *
 * Instalación (una sola vez):
 *   1. En el proyecto, botón "+" junto a "Archivos" > "Secuencia de comandos",
 *      nombrarlo "avisos" y pegar este archivo.
 *   2. Completar DESTINATARIOS con los correos del equipo revisor.
 *   3. Elegir la función `instalarAvisoPorMail` y apretar "Ejecutar" (autorizar
 *      el permiso para enviar correos).
 *   4. Opcional: ejecutar `probarAviso` para recibir un mail de prueba con la
 *      última respuesta cargada.
 *
 * Para cambiar destinatarios después, editar DESTINATARIOS y guardar: no hace
 * falta reinstalar.
 */

// Correos que reciben el aviso, separados por coma.
const DESTINATARIOS = 'anahi.bianco@ig.edu.ar';

function instalarAvisoPorMail() {
  const ss = abrirHoja_();
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'avisarNuevaCarga') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('avisarNuevaCarga').forSpreadsheet(ss).onFormSubmit().create();
  Logger.log('Listo: cada respuesta nueva envía un aviso a ' + DESTINATARIOS);
}

/** Se ejecuta sola con cada envío del formulario. */
function avisarNuevaCarga(e) {
  const hoja = e.range.getSheet();
  const fila = e.range.getRow();
  const enc = hoja.getRange(1, 1, 1, hoja.getLastColumn()).getDisplayValues()[0].map(String);
  const valores = hoja.getRange(fila, 1, 1, enc.length).getDisplayValues()[0];

  // Marcar la fila como pendiente de revisión
  const iEstado = enc.indexOf('estado_revision');
  if (iEstado >= 0 && !valores[iEstado]) hoja.getRange(fila, iEstado + 1).setValue('Pendiente');

  enviarAviso_(enc, valores, fila, hoja.getParent().getUrl() + '#gid=' + hoja.getSheetId() + '&range=A' + fila);
}

/** Manda un aviso de prueba con la última fila cargada. */
function probarAviso() {
  const ss = abrirHoja_();
  const hoja = ss.getSheetByName('Respuestas') || ss.getSheets()[0];
  const fila = hoja.getLastRow();
  if (fila < 2) throw new Error('Todavía no hay respuestas para probar.');
  const enc = hoja.getRange(1, 1, 1, hoja.getLastColumn()).getDisplayValues()[0].map(String);
  const valores = hoja.getRange(fila, 1, 1, enc.length).getDisplayValues()[0];
  enviarAviso_(enc, valores, fila, ss.getUrl() + '#gid=' + hoja.getSheetId() + '&range=A' + fila);
  Logger.log('Aviso de prueba enviado a ' + DESTINATARIOS);
}

function enviarAviso_(enc, valores, fila, urlFila) {
  const v = function (clave) {
    const i = enc.indexOf(PREGUNTAS[clave]);
    return i >= 0 ? String(valores[i] || '').trim() : '';
  };
  const esc = function (s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };

  const nombre = v('nombre_estacion') || '(sin nombre)';
  const lugar = [v('localidad'), v('division'), v('pais')].filter(String).join(', ');
  const lat = v('latitud').replace(',', '.'), lon = v('longitud').replace(',', '.');
  const urlMapa = 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(lat + ',' + lon);
  const variables = [v('contaminantes'), v('meteorologia')].filter(String).join(', ');

  const filas = [
    ['Estación', nombre + (v('codigo') ? ' (' + v('codigo') + ')' : '')],
    ['Ubicación', lugar],
    ['Coordenadas', lat + ', ' + lon],
    ['Red', v('red')],
    ['Opera', v('operador')],
    ['Tipo', v('tipo_estacion')],
    ['Variables', variables || '—'],
    ['Operativa', v('estado_operativo')],
    ['Datos', v('acceso_datos') + (v('url_datos') ? ' — ' + v('url_datos') : '')],
    ['Cargó', v('aportante_nombre') + ' <' + v('aportante_correo') + '>' +
      (v('aportante_institucion') ? ' — ' + v('aportante_institucion') : '') +
      (v('aportante_relacion') ? ' (' + v('aportante_relacion') + ')' : '')],
    ['Comentarios', v('comentarios') || '—']
  ];

  const html =
    '<div style="font-family:Arial,sans-serif;font-size:14px;color:#042050">' +
    '<p>Hay una estación nueva para revisar en el <b>Mapa GECAL</b>:</p>' +
    '<table cellpadding="5" style="border-collapse:collapse">' +
    filas.map(function (r) {
      return '<tr><td style="color:#6a768c;vertical-align:top;white-space:nowrap">' + esc(r[0]) +
        '</td><td>' + esc(r[1]) + '</td></tr>';
    }).join('') +
    '</table>' +
    '<p><a href="' + esc(urlFila) + '">Abrir la fila ' + fila + ' en la hoja de revisión</a> · ' +
    '<a href="' + esc(urlMapa) + '">Ver el punto en el mapa</a></p>' +
    '<p style="color:#6a768c;font-size:12px">Para publicarla: poner «Aprobado» en estado_revision y ' +
    'ejecutar exportarAprobadas (o esperar la exportación diaria).</p></div>';

  const texto = filas.map(function (r) { return r[0] + ': ' + r[1]; }).join('\n') +
    '\n\nHoja de revisión (fila ' + fila + '): ' + urlFila + '\nMapa: ' + urlMapa;

  const opciones = {
    to: DESTINATARIOS,
    subject: '[Mapa GECAL] Nueva estación para revisar: ' + nombre + (v('pais') ? ' (' + v('pais') + ')' : ''),
    body: texto,
    htmlBody: html,
    name: 'Mapa GECAL'
  };
  // "Responder" le escribe directo a quien cargó la estación
  if (/^[^@\s]+@[^@\s]+$/.test(v('aportante_correo'))) opciones.replyTo = v('aportante_correo');
  MailApp.sendEmail(opciones);
}

function abrirHoja_() {
  const id = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  if (!id) throw new Error('No encuentro SHEET_ID: este archivo tiene que estar en el mismo proyecto donde se ejecutó crearFormulario.');
  return SpreadsheetApp.openById(id);
}
