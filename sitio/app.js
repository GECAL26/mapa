/* Mapa GECAL — lógica del sitio (sin dependencias salvo Leaflet). */
(function () {
  "use strict";

  const CFG = window.GECAL_CONFIG || {};
  const DATA = (window.ESTACIONES && window.ESTACIONES.estaciones) || [];
  const META = (window.ESTACIONES && window.ESTACIONES.metadata) || {};

  const TIPOS = {
    "Calidad del aire": "#e8590c",
    "Meteorológica": "#1c8fd6",
    "Calidad del aire y meteorología": "#0a8783"
  };
  const PUBLICOS = ["Públicos, en tiempo real o casi real", "Públicos, solo históricos"];
  const ORDEN_VARS = ["MP10", "MP2.5", "MP1", "O3", "NO", "NO2", "NOx", "SO2", "CO", "CO2", "CH4", "H2S", "NH3", "COV / BTEX", "HCHO",
    "Carbono negro (BC)", "Metales en material particulado", "Temperatura", "Humedad relativa", "Presión", "Velocidad del viento",
    "Dirección del viento", "Ráfaga del viento", "Precipitación", "Radiación solar"];
  const ORDEN_FREC = ["1 min o menos", "5 a 15 min", "30 min", "1 hora", "24 horas", "Variable / otra", "No sé"];
  // Catálogos externos: nombre de la fuente -> enlace
  const FUENTES = {
    "MIRA Chile": "https://suraurora.github.io/mira-chile/",
    "SINAICA": "https://sinaica.inecc.gob.mx/",
    "CETESB": "https://qualar.cetesb.sp.gov.br/qualar/home.do",
    "MonitorAr-Rio": "https://www.data.rio/",
    "SENAMHI": "https://www.senamhi.gob.pe/",
    "NOAA ISD": "https://www.ncei.noaa.gov/products/land-based-station/integrated-surface-database"
  };

  // ---------- utilidades
  const $ = (s, el) => (el || document).querySelector(s);
  const esc = (v) => String(v == null ? "" : v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const urlSegura = (u) => (/^https?:\/\/[^\s"'<>]+$/i.test(u || "") ? u : "");
  const norm = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const cmp = (a, b) => String(a).localeCompare(String(b), "es", { numeric: true, sensitivity: "base" });
  const fmt = (n) => Number(n).toLocaleString("es");
  const colorDe = (e) => TIPOS[e.tipo_estacion] || "#66748c";
  const posEn = (orden) => (v) => { const i = orden.indexOf(v); return i < 0 ? 999 : i; };

  DATA.forEach((e, i) => {
    e._i = i;
    e.variables = [].concat(e.contaminantes || [], e.meteorologia || []);
    e._texto = norm([e.nombre_estacion, e.localidad, e.division, e.pais, e.red, e.operador, e.codigo, e.id_gecal].join(" "));
  });

  // ---------- filtros
  const FILTROS = [
    { k: "tipo_estacion", t: "Qué mide", puntos: true },
    { k: "variables", t: "Variable", orden: posEn(ORDEN_VARS), max: 12 },
    { k: "pais", t: "País", max: 10 },
    { k: "estado_operativo", t: "Operativa" },
    { k: "acceso_datos", t: "Acceso a los datos" },
    { k: "red", t: "Red", max: 8 },
    { k: "instrumental", t: "Instrumental" },
    { k: "frecuencia", t: "Frecuencia de registro", orden: posEn(ORDEN_FREC) },
    { k: "entorno", t: "Entorno" },
    { k: "fuente", t: "Fuente del registro" }
  ];
  const sel = {};
  FILTROS.forEach((f) => (sel[f.k] = new Set()));
  let consulta = "";

  const valores = (e, k) => { const v = e[k]; return Array.isArray(v) ? v : v ? [v] : []; };
  function pasa(e, excepto) {
    if (consulta && !e._texto.includes(consulta)) return false;
    for (const f of FILTROS) {
      if (f.k === excepto || !sel[f.k].size) continue;
      if (!valores(e, f.k).some((v) => sel[f.k].has(v))) return false;
    }
    return true;
  }

  const grupos = $("#grupos");
  const expandidos = new Set();
  function pintarFiltros() {
    let activos = consulta ? 1 : 0;
    grupos.innerHTML = "";
    FILTROS.forEach((f) => {
      const base = DATA.filter((e) => pasa(e, f.k));
      const cnt = new Map();
      DATA.forEach((e) => valores(e, f.k).forEach((v) => cnt.has(v) || cnt.set(v, 0)));
      base.forEach((e) => valores(e, f.k).forEach((v) => cnt.set(v, cnt.get(v) + 1)));
      if (!cnt.size) return;
      let ops = [...cnt.keys()];
      ops.sort(f.orden ? (a, b) => f.orden(a) - f.orden(b) || cmp(a, b) : (a, b) => (cnt.get(b) - cnt.get(a)) || cmp(a, b));
      // seleccionadas siempre visibles
      const max = f.max && !expandidos.has(f.k) ? f.max : Infinity;
      const visibles = ops.filter((o, i) => i < max || sel[f.k].has(o));
      if (sel[f.k].size) activos++;

      const g = document.createElement("div");
      g.className = "grupo";
      g.innerHTML = `<h2>${esc(f.t)}${sel[f.k].size ? `<button class="quitar" data-quitar="${f.k}" type="button">Quitar</button>` : ""}</h2>
        <div class="fichas">${visibles.map((o) => {
          const n = cnt.get(o);
          return `<button type="button" class="chip${n ? "" : " cero"}" aria-pressed="${sel[f.k].has(o)}" data-k="${f.k}" data-v="${esc(o)}">${
            f.puntos ? `<span class="punto" style="background:${TIPOS[o] || "#66748c"}"></span>` : ""}${esc(o)}<span class="n">${fmt(n)}</span></button>`;
        }).join("")}${ops.length > visibles.length ? `<button type="button" class="ver-mas" data-mas="${f.k}">Ver ${ops.length - visibles.length} más</button>` : ""}</div>`;
      grupos.appendChild(g);
    });
    $("#btn-limpiar").hidden = !activos;
  }
  grupos.addEventListener("click", (ev) => {
    const b = ev.target.closest("button");
    if (!b) return;
    if (b.dataset.mas) { expandidos.add(b.dataset.mas); pintarFiltros(); return; }
    if (b.dataset.quitar) { sel[b.dataset.quitar].clear(); actualizar(); return; }
    const s = sel[b.dataset.k];
    s.has(b.dataset.v) ? s.delete(b.dataset.v) : s.add(b.dataset.v);
    actualizar();
    const mismo = grupos.querySelector(`button[data-k="${b.dataset.k}"][data-v="${CSS.escape(b.dataset.v)}"]`);
    if (mismo) mismo.focus();
  });

  // ---------- pestañas
  const tabs = ["filtrar", "paises", "lista"];
  function abrirTab(nombre) {
    tabs.forEach((t) => {
      $("#tab-" + t).setAttribute("aria-selected", t === nombre);
      $("#vista-" + t).hidden = t !== nombre;
    });
  }
  tabs.forEach((t) => $("#tab-" + t).addEventListener("click", () => abrirTab(t)));
  $(".pestanas").addEventListener("keydown", (ev) => {
    const i = tabs.findIndex((t) => $("#tab-" + t).getAttribute("aria-selected") === "true");
    const d = ev.key === "ArrowRight" ? 1 : ev.key === "ArrowLeft" ? -1 : 0;
    if (!d) return;
    const n = tabs[(i + d + tabs.length) % tabs.length];
    abrirTab(n); $("#tab-" + n).focus();
  });

  // ---------- mapa
  const mapa = L.map("mapa", { zoomControl: false, worldCopyJump: true, preferCanvas: true });
  L.control.zoom({ position: "topleft" }).addTo(mapa);
  const bases = {
    "Claro": L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}", {
      maxZoom: 16, attribution: "Mapa base © Esri" }),
    "Satélite": L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
      maxZoom: 18, attribution: "Imágenes © Esri" }),
    "OpenStreetMap": L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 18, attribution: "© OpenStreetMap" }),
    "Sin fondo": L.layerGroup()
  };
  bases["Claro"].addTo(mapa);
  const capaPaises = window.PAISES_GEOJSON ? L.geoJSON(window.PAISES_GEOJSON, {
    style: { color: "#7d8fa3", weight: 0.8, fillColor: "#ffffff", fillOpacity: 0.45 }, interactive: false
  }).addTo(mapa) : null;
  const capaEst = L.layerGroup().addTo(mapa);
  L.control.layers(bases, capaPaises ? { "Límites de países": capaPaises } : {}, { position: "topleft" }).addTo(mapa);
  L.control.scale({ imperial: false, position: "bottomright" }).addTo(mapa);
  const leyenda = L.control({ position: "bottomleft" });
  leyenda.onAdd = () => {
    const d = L.DomUtil.create("div", "leyenda");
    d.innerHTML = Object.keys(TIPOS).map((k) => `<div><i style="background:${TIPOS[k]}"></i>${esc(k)}</div>`).join("") +
      `<div><i class="hueco"></i>Sin confirmar que esté operativa</div>`;
    return d;
  };
  leyenda.addTo(mapa);
  mapa.fitBounds([[-55, -117], [32, -34]]);

  const marcadores = new Map();
  let elegida = null;
  const anillo = L.circleMarker([0, 0], { radius: 13, color: "#042050", weight: 2.5, fill: false, interactive: false });
  DATA.forEach((e) => {
    const col = colorDe(e);
    const activa = e.estado_operativo === "Sí";
    const m = L.circleMarker([e.latitud, e.longitud], {
      radius: 6, weight: activa ? 1.4 : 2, color: activa ? "#ffffff" : col, fillColor: activa ? col : "#ffffff", fillOpacity: 0.95
    });
    m.bindTooltip(esc(e.nombre_estacion), { direction: "top", offset: [0, -6] });
    m.on("click", () => abrirFicha(e));
    marcadores.set(e._i, m);
  });

  // ---------- ficha
  const ficha = $("#ficha");
  function abrirFicha(e, centrar) {
    elegida = e;
    const url = urlSegura(e.url_datos);
    const fuenteUrl = FUENTES[e.fuente];
    const fila = (t, v) => (v ? `<dt>${t}</dt><dd>${v}</dd>` : "");
    const vars = (arr, c) => (arr && arr.length ? `<div class="vars">${arr.map((v) => `<span class="var ${c}">${esc(v)}</span>`).join("")}</div>` : "");
    const hayVars = (e.contaminantes || []).length || (e.meteorologia || []).length;
    $("#ficha-contenido").innerHTML = `
      <div class="tipo"><i style="background:${colorDe(e)}"></i>${esc(e.tipo_estacion)}</div>
      <h2 id="ficha-nombre">${esc(e.nombre_estacion)}</h2>
      <p class="lugar">${esc([e.localidad, e.division, e.pais].filter(Boolean).join(", "))}</p>
      <h3>Qué mide</h3>
      ${hayVars ? vars(e.contaminantes, "c") + (e.contaminantes.length && e.meteorologia.length ? "<div style='height:6px'></div>" : "") + vars(e.meteorologia, "m")
        : `<p class="sin-dato">La fuente no detalla las variables. Si las conoces, súmalas con el formulario.</p>`}
      <h3>Datos de la estación</h3>
      <dl>
        ${fila("Red", esc(e.red))}
        ${fila("Opera", esc(e.operador))}
        ${fila("Código", esc(e.codigo))}
        ${fila("Entorno", esc(e.entorno))}
        ${fila("Instrumental", esc((e.instrumental || []).join(", ")))}
        ${fila("Frecuencia", esc(e.frecuencia))}
        ${fila("Mide desde", esc(e.anio_inicio || ""))}
        ${fila("Operativa", esc(e.estado_operativo))}
        ${fila("Datos", esc(e.acceso_datos))}
        ${fila("Altitud", e.altitud_m != null ? esc(fmt(e.altitud_m)) + " m" : "")}
        ${fila("Coordenadas", esc(e.latitud.toFixed(4) + ", " + e.longitud.toFixed(4)))}
      </dl>
      ${url ? `<a class="boton acceso" href="${esc(url)}" target="_blank" rel="noopener noreferrer">Ir a los datos</a>` : ""}
      <p class="pie-ficha">Registro ${esc(e.id_gecal)}${e.fuente ? ", fuente: " + (fuenteUrl
        ? `<a href="${esc(fuenteUrl)}" target="_blank" rel="noopener noreferrer">${esc(e.fuente)}</a>` : esc(e.fuente)) : ""}${
        e.fecha_carga ? ", actualizado el " + esc(e.fecha_carga) : ""}.</p>`;
    const estabaOculta = ficha.hidden;
    ficha.hidden = false;
    if (estabaOculta) { ficha.classList.remove("entra"); void ficha.offsetWidth; ficha.classList.add("entra"); }
    anillo.setLatLng([e.latitud, e.longitud]).addTo(mapa);
    if (centrar) mapa.flyTo([e.latitud, e.longitud], Math.max(mapa.getZoom(), 10), { duration: 0.7 });
    $("#ficha-cerrar").focus({ preventScroll: true });
  }
  function cerrarFicha() { ficha.hidden = true; elegida = null; anillo.remove(); }
  $("#ficha-cerrar").addEventListener("click", cerrarFicha);
  document.addEventListener("keydown", (ev) => { if (ev.key === "Escape" && !ficha.hidden) cerrarFicha(); });

  // ---------- países
  function pintarPaises(lista) {
    const porPais = new Map();
    DATA.filter((e) => pasa(e, "pais")).forEach((e) => {
      if (!porPais.has(e.pais)) porPais.set(e.pais, { total: 0, tipos: {} });
      const p = porPais.get(e.pais); p.total++; p.tipos[e.tipo_estacion] = (p.tipos[e.tipo_estacion] || 0) + 1;
    });
    const filas = [...porPais.entries()].sort((a, b) => b[1].total - a[1].total || cmp(a[0], b[0]));
    const max = filas.length ? filas[0][1].total : 1;
    $("#paises").innerHTML = filas.length ? filas.map(([p, d]) => `<li><button type="button" data-pais="${esc(p)}" aria-pressed="${sel.pais.has(p)}">
      <span class="nombre">${esc(p)}</span><span class="total">${fmt(d.total)}</span>
      <span class="barra-pais" style="width:${Math.max(4, 100 * d.total / max)}%">${Object.keys(TIPOS).map((t) =>
        d.tipos[t] ? `<span style="width:${100 * d.tipos[t] / d.total}%;background:${TIPOS[t]}" title="${esc(t)}: ${d.tipos[t]}"></span>` : "").join("")}</span>
      </button></li>`).join("") : `<li class="vacio">Ningún país coincide con los filtros.</li>`;
  }
  $("#paises").addEventListener("click", (ev) => {
    const b = ev.target.closest("button[data-pais]"); if (!b) return;
    const p = b.dataset.pais;
    if (sel.pais.has(p) && sel.pais.size === 1) { sel.pais.clear(); actualizar(); return; }
    sel.pais.clear(); sel.pais.add(p);
    actualizar();
    const pts = visibles.map((e) => [e.latitud, e.longitud]);
    if (pts.length) mapa.flyToBounds(L.latLngBounds(pts).pad(0.15), { duration: 0.7, maxZoom: 9 });
  });

  // ---------- lista
  const PASO = 150;
  let mostrar = PASO;
  function pintarLista(lista) {
    const ord = lista.slice().sort((a, b) => cmp(a.pais, b.pais) || cmp(a.nombre_estacion, b.nombre_estacion));
    $("#lista").innerHTML = ord.length ? ord.slice(0, mostrar).map((e) => `<li><button type="button" data-i="${e._i}">
      <span class="punto" style="background:${colorDe(e)}"></span><span class="nombre">${esc(e.nombre_estacion)}</span>
      <span class="lugar">${esc([e.localidad, e.pais].filter(Boolean).join(", "))}${e.red ? " — " + esc(e.red) : ""}</span></button></li>`).join("")
      : `<li class="vacio">${DATA.length ? "Ninguna estación coincide con los filtros." : "Todavía no hay estaciones publicadas."}</li>`;
    const resto = ord.length - mostrar;
    $("#btn-mas").hidden = resto <= 0;
    $("#btn-mas").textContent = `Mostrar ${fmt(Math.min(PASO, resto))} más de ${fmt(resto)}`;
  }
  $("#lista").addEventListener("click", (ev) => {
    const b = ev.target.closest("button[data-i]"); if (!b) return;
    abrirFicha(DATA[Number(b.dataset.i)], true);
  });
  $("#btn-mas").addEventListener("click", () => { mostrar += PASO; pintarLista(visibles); });

  // ---------- actualizar todo
  let visibles = DATA;
  function actualizar() {
    visibles = DATA.filter((e) => pasa(e));
    capaEst.clearLayers();
    visibles.forEach((e) => capaEst.addLayer(marcadores.get(e._i)));
    const nP = new Set(visibles.map((e) => e.pais)).size;
    const nR = new Set(visibles.map((e) => e.red)).size;
    $("#resumen").innerHTML = DATA.length
      ? `<strong>${fmt(visibles.length)}</strong> ${visibles.length === 1 ? "estación" : "estaciones"} en ${fmt(nP)} ${nP === 1 ? "país" : "países"} y ${fmt(nR)} ${nR === 1 ? "red" : "redes"}`
      : "Todavía no hay estaciones publicadas";
    mostrar = PASO;
    pintarFiltros();
    pintarPaises(visibles);
    pintarLista(visibles);
    if (elegida && !visibles.includes(elegida)) cerrarFicha();
  }

  let tq;
  $("#q").addEventListener("input", (ev) => { clearTimeout(tq); tq = setTimeout(() => { consulta = norm(ev.target.value.trim()); actualizar(); }, 150); });
  $("#btn-limpiar").addEventListener("click", () => {
    FILTROS.forEach((f) => sel[f.k].clear());
    $("#q").value = ""; consulta = "";
    actualizar();
  });

  // ---------- CSV
  const COLS = ["id_gecal", "nombre_estacion", "codigo", "pais", "division", "localidad", "latitud", "longitud", "altitud_m", "red", "operador",
    "tipo_estacion", "entorno", "instrumental", "contaminantes", "meteorologia", "frecuencia", "anio_inicio", "estado_operativo", "acceso_datos",
    "url_datos", "fuente", "fecha_carga"];
  function csv(lista) {
    const c = (v) => { v = Array.isArray(v) ? v.join("; ") : v == null ? "" : String(v); return /[",\n;]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    return "﻿" + COLS.join(",") + "\n" + lista.map((e) => COLS.map((k) => c(e[k])).join(",")).join("\n") + "\n";
  }
  $("#btn-csv").addEventListener("click", async (ev) => {
    const texto = csv(visibles);
    const btn = ev.currentTarget; const orig = btn.textContent;
    try {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([texto], { type: "text/csv;charset=utf-8" }));
      a.download = "estaciones_gecal.csv"; document.body.appendChild(a); a.click(); a.remove();
    } catch (e) { /* descarga bloqueada */ }
    if (window.self !== window.top) {
      try { await navigator.clipboard.writeText(texto); btn.textContent = "Copiado al portapapeles"; }
      catch (e) { btn.textContent = "No se pudo descargar aquí"; }
      setTimeout(() => (btn.textContent = orig), 2500);
    }
  });

  // ---------- encabezado y pie
  const bf = $("#btn-form");
  if (urlSegura(CFG.formUrl)) bf.href = CFG.formUrl;
  else { bf.setAttribute("aria-disabled", "true"); bf.title = "Falta configurar formUrl en config.js"; }
  if (urlSegura(CFG.contribuirUrl)) { const lr = $("#link-red"); lr.href = CFG.contribuirUrl; lr.hidden = false; }
  if (CFG.avisoDemo) $("#aviso-demo").hidden = false;
  const externas = (META.fuentes || []).filter((f) => FUENTES[f]);
  $("#pie-meta").innerHTML = [
    META.generado ? "Actualizado el " + esc(new Date(META.generado).toLocaleDateString("es", { day: "numeric", month: "long", year: "numeric" })) + "." : "",
    externas.length ? "Incluye registros de " + externas.map((f) => `<a href="${esc(FUENTES[f])}" target="_blank" rel="noopener noreferrer">${esc(f)}</a>`).join(", ") + "." : "",
    CFG.contacto ? "Contacto: " + esc(CFG.contacto) + "." : ""
  ].filter(Boolean).join(" ");

  actualizar();
})();
