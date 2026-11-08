/* Mapa GECAL — lógica del sitio (sin dependencias salvo Leaflet). */
(function () {
  "use strict";

  const CFG = window.GECAL_CONFIG || {};
  const DATA = (window.ESTACIONES && window.ESTACIONES.estaciones) || [];
  const META = (window.ESTACIONES && window.ESTACIONES.metadata) || {};

  const GT = window.GT;
  const { t, plural, cat, pais: tpais, paisTodos } = GT;
  // Los colores salen de los tokens (claves = valor en español de los datos); se releen al cambiar de tema.
  const TIPOS = { "Calidad del aire": "", "Meteorológica": "", "Calidad del aire y meteorología": "" };
  const VAR_TIPO = { "Calidad del aire": "--m-aire", "Meteorológica": "--m-meteo", "Calidad del aire y meteorología": "--m-ambas" };
  const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  const PUBLICOS = ["Públicos, en tiempo real o casi real", "Públicos, solo históricos"];
  const ORDEN_VARS = ["MP10", "MP2.5", "MP1", "O3", "NO", "NO2", "NOx", "SO2", "CO", "CO2", "CH4", "H2S", "NH3", "COV / BTEX", "HCHO",
    "Carbono negro (BC)", "Metales en material particulado", "Temperatura", "Humedad relativa", "Presión", "Velocidad del viento",
    "Dirección del viento", "Ráfaga del viento", "Precipitación", "Radiación solar"];
  const ORDEN_FREC = ["1 min o menos", "5 a 15 min", "30 min", "1 hora", "24 horas", "Variable / otra", "No sé"];
  // Catálogos externos: nombre de la fuente -> enlace
  const FUENTES = {
    "MIRA Chile": "https://suraurora.github.io/mira-chile/",
    "SINAICA": "https://sinaica.inecc.gob.mx/",
    "SINCA Chile": "https://sinca.mma.gob.cl/",
    "CETESB": "https://qualar.cetesb.sp.gov.br/qualar/home.do",
    "MonitorAr-Rio": "https://www.data.rio/",
    "SENAMHI": "https://www.senamhi.gob.pe/",
    "SIATA": "https://datos.siata.gov.co/",
    "NOAA ISD": "https://www.ncei.noaa.gov/products/land-based-station/integrated-surface-database",
    "OpenAQ": "https://openaq.org/"
  };

  // ---------- utilidades
  const $ = (s, el) => (el || document).querySelector(s);
  const esc = (v) => String(v == null ? "" : v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const urlSegura = (u) => (/^https?:\/\/[^\s"'<>]+$/i.test(u || "") ? u : "");
  const norm = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const cmp = (a, b) => String(a).localeCompare(String(b), GT.lang, { numeric: true, sensitivity: "base" });
  const fmt = (n) => Number(n).toLocaleString(GT.lang);
  const subst = (s, o) => s.replace(/\{(\w+)\}/g, (m, k) => (o[k] != null ? o[k] : m));
  // Color de los puntos: por tipo de estación o por red
  let modoColor = "tipo";
  let coloresRed = {};
  // Dos paletas de 11 colores, una por tema, con contraste ≥ 3:1 sobre el mapa gris claro / oscuro.
  const PALETAS_REDES = {
    light: ["#0775b7", "#b35400", "#0d7a7a", "#6741d9", "#c2255c", "#237a35", "#8f6200", "#1864ab", "#862e9c", "#4d7c0f", "#c92a2a"],
    dark: ["#5db9e8", "#f9a10c", "#58c5bd", "#b197fc", "#f783ac", "#8ce99a", "#ffd43b", "#74c0fc", "#e599f7", "#c0eb75", "#ff8787"]
  };
  let PALETA_REDES = PALETAS_REDES.light;
  let COLOR_OTRAS = "#7b8794";
  function refrescarColores() {
    Object.keys(VAR_TIPO).forEach((k) => (TIPOS[k] = css(VAR_TIPO[k])));
    PALETA_REDES = PALETAS_REDES[GT.oscuro ? "dark" : "light"];
    COLOR_OTRAS = GT.oscuro ? "#9aa8bd" : "#5d7090";
  }
  refrescarColores();
  const colorDe = (e) => (modoColor === "red" ? coloresRed[e.red] || COLOR_OTRAS : TIPOS[e.tipo_estacion] || COLOR_OTRAS);
  // Etiqueta que se muestra de cada valor (el valor en español sigue siendo la clave del filtro).
  const etiqueta = (k, v) => (k === "pais" ? tpais(v) : k === "red" || k === "fuente" ? v : cat(v));
  const fechaCorta = (iso) => {
    const d = new Date(iso + "T12:00:00");
    return isNaN(d) ? iso : d.toLocaleDateString(GT.lang, { day: "numeric", month: "long", year: "numeric" });
  };
  const claveLugar = (e) => e.latitud.toFixed(4) + "," + e.longitud.toFixed(4);
  const posEn = (orden) => (v) => { const i = orden.indexOf(v); return i < 0 ? 999 : i; };

  DATA.forEach((e, i) => {
    e._i = i;
    e.variables = [].concat(e.contaminantes || [], e.meteorologia || []);
    e._texto = norm([e.nombre_estacion, e.localidad, e.division, paisTodos(e.pais).join(" "), e.red, e.operador, e.codigo, e.id_gecal].join(" "));
  });

  // ---------- filtros
  const FILTROS = [
    { k: "tipo_estacion", puntos: true },
    { k: "variables", orden: posEn(ORDEN_VARS), max: 12 },
    { k: "pais", max: 10 },
    { k: "estado_operativo" },
    { k: "acceso_datos" },
    { k: "red", max: 8 },
    { k: "instrumental" },
    { k: "frecuencia", orden: posEn(ORDEN_FREC) },
    { k: "entorno" },
    { k: "fuente" }
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
      ops.sort(f.orden ? (a, b) => f.orden(a) - f.orden(b) || cmp(etiqueta(f.k, a), etiqueta(f.k, b)) : (a, b) => (cnt.get(b) - cnt.get(a)) || cmp(etiqueta(f.k, a), etiqueta(f.k, b)));
      // seleccionadas siempre visibles
      const max = f.max && !expandidos.has(f.k) ? f.max : Infinity;
      const visibles = ops.filter((o, i) => i < max || sel[f.k].has(o));
      if (sel[f.k].size) activos++;

      const g = document.createElement("div");
      g.className = "grupo";
      g.innerHTML = `<h2>${esc(t("f." + f.k))}${sel[f.k].size ? `<button class="quitar" data-quitar="${f.k}" type="button">${esc(t("filters.remove"))}</button>` : ""}</h2>
        <div class="fichas">${visibles.map((o) => {
          const n = cnt.get(o);
          return `<button type="button" class="chip${n ? "" : " cero"}" aria-pressed="${sel[f.k].has(o)}" data-k="${f.k}" data-v="${esc(o)}">${
            f.puntos ? `<span class="punto" style="background:${TIPOS[o] || COLOR_OTRAS}"></span>` : ""}${esc(etiqueta(f.k, o))}<span class="n">${fmt(n)}</span></button>`;
        }).join("")}${ops.length > visibles.length ? `<button type="button" class="ver-mas" data-mas="${f.k}">${esc(t("filters.more", { n: ops.length - visibles.length }))}</button>` : ""}</div>`;
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
  const ESRI = "https://server.arcgisonline.com/ArcGIS/rest/services/";
  // El mapa gris sigue al tema: Esri publica una versión clara y una oscura.
  const urlGris = () => ESRI + (GT.oscuro ? "Canvas/World_Dark_Gray_Base" : "Canvas/World_Light_Gray_Base") + "/MapServer/tile/{z}/{y}/{x}";
  const capaGris = L.tileLayer(urlGris(), { maxZoom: 16, attribution: "© Esri" });
  const capaSat = L.tileLayer(ESRI + "World_Imagery/MapServer/tile/{z}/{y}/{x}", { maxZoom: 18, attribution: "© Esri" });
  const capaOsm = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 18, attribution: "© OpenStreetMap" });
  const capaNada = L.layerGroup();
  capaGris.addTo(mapa);
  const estiloPaises = () => ({ color: css("--border-control"), weight: 0.8, fillColor: css("--surface-100"), fillOpacity: 0.4 });
  const capaPaises = window.PAISES_GEOJSON ? L.geoJSON(window.PAISES_GEOJSON, { style: estiloPaises, interactive: false }).addTo(mapa) : null;
  const capaEst = L.layerGroup().addTo(mapa);
  // El selector de capas escribe sus nombres al crearse: se rehace al cambiar de idioma.
  let controlCapas = null;
  function construirControlCapas() {
    if (controlCapas) controlCapas.remove();
    controlCapas = L.control.layers({
      [t("base.neutral")]: capaGris, [t("base.satellite")]: capaSat, [t("base.osm")]: capaOsm, [t("base.none")]: capaNada
    }, capaPaises ? { [t("overlay.borders")]: capaPaises } : {}, { position: "topleft" }).addTo(mapa);
  }
  construirControlCapas();
  L.control.scale({ imperial: false, position: "bottomright" }).addTo(mapa);
  const leyenda = L.control({ position: "bottomleft" });
  leyenda.onAdd = () => {
    const d = L.DomUtil.create("div", "leyenda");
    L.DomEvent.disableClickPropagation(d);
    L.DomEvent.disableScrollPropagation(d);
    d.addEventListener("click", (ev) => {
      const b = ev.target.closest("button[data-modo]");
      if (!b || b.dataset.modo === modoColor) return;
      modoColor = b.dataset.modo;
      repintarColores();
    });
    return d;
  };
  leyenda.addTo(mapa);
  mapa.fitBounds([[-55, -117], [32, -34]]);

  function calcularColoresRed(lista) {
    const cnt = new Map();
    lista.forEach((e) => cnt.set(e.red, (cnt.get(e.red) || 0) + 1));
    const top = [...cnt.entries()].sort((a, b) => b[1] - a[1] || cmp(a[0], b[0])).slice(0, PALETA_REDES.length);
    coloresRed = {};
    top.forEach(([red], i) => (coloresRed[red] = PALETA_REDES[i]));
    return cnt.size > top.length;
  }

  function pintarLeyenda(hayOtras) {
    const d = leyenda.getContainer();
    const items = modoColor === "red"
      ? Object.entries(coloresRed).map(([red, c]) => `<div><i style="background:${c}"></i>${esc(red)}</div>`).join("") +
        (hayOtras ? `<div><i style="background:${COLOR_OTRAS}"></i>${esc(t("legend.other_networks"))}</div>` : "")
      : Object.keys(TIPOS).map((k) => `<div><i style="background:${TIPOS[k]}"></i>${esc(cat(k))}</div>`).join("");
    d.innerHTML = `<div class="modo" role="group" aria-label="${esc(t("a11y.color_by"))}">
        <span>${esc(t("legend.color_by"))}</span>
        <button type="button" data-modo="tipo" aria-pressed="${modoColor === "tipo"}">${esc(t("legend.type"))}</button>
        <button type="button" data-modo="red" aria-pressed="${modoColor === "red"}">${esc(t("legend.network"))}</button>
      </div>
      <div class="items">${items}
        <div><i class="hueco"></i>${esc(t("legend.unconfirmed"))}</div>
        <div><i class="cuenta">3</i>${esc(t("legend.shared"))}</div>
      </div>`;
  }

  let elegida = null;
  const anillo = L.circleMarker([0, 0], { radius: 13, color: css("--ink"), weight: 2.5, fill: false, interactive: false });

  function pintarMarcadores() {
    capaEst.clearLayers();
    const grupos = new Map();
    visibles.forEach((e) => {
      const k = claveLugar(e);
      if (!grupos.has(k)) grupos.set(k, []);
      grupos.get(k).push(e);
    });
    grupos.forEach((g) => {
      const e = g[0];
      const col = colorDe(e);
      const activa = g.some((x) => x.estado_operativo === "Sí");
      let m;
      if (g.length === 1) {
        m = L.circleMarker([e.latitud, e.longitud], {
          radius: 6, weight: activa ? 1.4 : 2, color: activa ? css("--surface-100") : col, fillColor: activa ? col : css("--surface-100"), fillOpacity: 0.95
        });
        m.bindTooltip(esc(e.nombre_estacion), { direction: "top", offset: [0, -6] });
      } else {
        m = L.marker([e.latitud, e.longitud], {
          icon: L.divIcon({ className: "punto-grupo", iconSize: [22, 22],
            html: `<span style="background:${activa ? col : "var(--surface-100)"};color:${activa ? "var(--surface-100)" : col};border-color:${activa ? "var(--surface-100)" : col}">${g.length}</span>` }),
          keyboard: false
        });
        m.bindTooltip(esc(t("tip.shared", { name: e.nombre_estacion, n: g.length })), { direction: "top", offset: [0, -10] });
      }
      m.on("click", () => abrirFicha(e, false, g));
      capaEst.addLayer(m);
    });
  }

  function repintarColores() {
    const hayOtras = calcularColoresRed(visibles);
    pintarLeyenda(hayOtras);
    pintarMarcadores();
    pintarLista(visibles);
    if (elegida) abrirFicha(elegida, false, null, true);
  }

  // ---------- ficha
  const ficha = $("#ficha");
  function abrirFicha(e, centrar, grupo, sinFoco) {
    elegida = e;
    grupo = grupo || visibles.filter((x) => claveLugar(x) === claveLugar(e));
    const otros = grupo.length > 1 ? `<div class="mismo-punto">
        <p>${esc(t("ficha.same_point", { n: grupo.length }))}</p>
        <div class="fichas">${grupo.map((x) => `<button type="button" class="chip" data-i="${x._i}" aria-pressed="${x === e}">${
          esc(x.red)}${x.nombre_estacion !== e.nombre_estacion ? " — " + esc(x.nombre_estacion) : ""}</button>`).join("")}</div>
      </div>` : "";
    const url = urlSegura(e.url_datos);
    const fuenteUrl = FUENTES[e.fuente];
    const fila = (k, v) => (v ? `<dt>${esc(t("ficha." + k))}</dt><dd>${v}</dd>` : "");
    const vars = (arr, c) => (arr && arr.length ? `<div class="vars">${arr.map((v) => `<span class="var ${c}">${esc(cat(v))}</span>`).join("")}</div>` : "");
    const hayVars = (e.contaminantes || []).length || (e.meteorologia || []).length;
    $("#ficha-contenido").innerHTML = `${otros}
      <div class="tipo"><i style="background:${colorDe(e)}"></i>${esc(cat(e.tipo_estacion))}</div>
      <h2 id="ficha-nombre">${esc(e.nombre_estacion)}</h2>
      <p class="lugar">${esc([e.localidad, e.division, tpais(e.pais)].filter(Boolean).join(", "))}</p>
      <h3>${esc(t("ficha.measures"))}</h3>
      ${hayVars ? vars(e.contaminantes, "c") + (e.contaminantes.length && e.meteorologia.length ? "<div style='height:6px'></div>" : "") + vars(e.meteorologia, "m")
        : `<p class="sin-dato">${esc(t("ficha.no_vars"))}</p>`}
      <h3>${esc(t("ficha.data"))}</h3>
      <dl>
        ${fila("network", esc(e.red))}
        ${fila("operator", esc(e.operador))}
        ${fila("code", esc(e.codigo))}
        ${fila("environment", esc(cat(e.entorno)))}
        ${fila("instrument", esc((e.instrumental || []).map(cat).join(", ")))}
        ${fila("frequency", esc(cat(e.frecuencia)))}
        ${fila("since", esc(e.anio_inicio || ""))}
        ${fila("operating", esc(cat(e.estado_operativo)))}
        ${fila("access", esc(cat(e.acceso_datos)))}
        ${fila("altitude", e.altitud_m != null ? esc(fmt(e.altitud_m)) + " m" : "")}
        ${fila("coords", esc(e.latitud.toFixed(4) + ", " + e.longitud.toFixed(4)))}
      </dl>
      ${url ? `<a class="gecal-btn gecal-btn--primary gecal-btn--sm acceso" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(t("ficha.go"))}</a>` : ""}
      <p class="pie-ficha">${esc(t("ficha.record", { id: e.id_gecal }))}${e.fuente ? subst(esc(t("ficha.source")), { src: fuenteUrl
        ? `<a href="${esc(fuenteUrl)}" target="_blank" rel="noopener noreferrer">${esc(e.fuente)}</a>` : esc(e.fuente) }) : ""}${
        e.fecha_carga ? esc(t("ficha.updated", { date: fechaCorta(e.fecha_carga) })) : ""}.</p>`;
    const estabaOculta = ficha.hidden;
    ficha.hidden = false;
    if (estabaOculta) { ficha.classList.remove("entra"); void ficha.offsetWidth; ficha.classList.add("entra"); }
    anillo.setLatLng([e.latitud, e.longitud]).addTo(mapa);
    if (centrar) mapa.flyTo([e.latitud, e.longitud], Math.max(mapa.getZoom(), 10), { duration: 0.7 });
    if (!sinFoco) $("#ficha-cerrar").focus({ preventScroll: true });
    fichaGrupo = grupo;
  }
  let fichaGrupo = null;
  $("#ficha-contenido").addEventListener("click", (ev) => {
    const b = ev.target.closest(".mismo-punto button[data-i]");
    if (b) abrirFicha(DATA[Number(b.dataset.i)], false, fichaGrupo, true);
  });
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
    const filas = [...porPais.entries()].sort((a, b) => b[1].total - a[1].total || cmp(tpais(a[0]), tpais(b[0])));
    const max = filas.length ? filas[0][1].total : 1;
    $("#paises").innerHTML = filas.length ? filas.map(([p, d]) => `<li><button type="button" data-pais="${esc(p)}" aria-pressed="${sel.pais.has(p)}">
      <span class="nombre">${esc(tpais(p))}</span><span class="total">${fmt(d.total)}</span>
      <span class="barra-pais" style="width:${Math.max(4, 100 * d.total / max)}%">${Object.keys(TIPOS).map((tt) =>
        d.tipos[tt] ? `<span style="width:${100 * d.tipos[tt] / d.total}%;background:${TIPOS[tt]}" title="${esc(cat(tt))}: ${d.tipos[tt]}"></span>` : "").join("")}</span>
      </button></li>`).join("") : `<li class="vacio">${esc(t("countries.none"))}</li>`;
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
    const ord = lista.slice().sort((a, b) => cmp(tpais(a.pais), tpais(b.pais)) || cmp(a.nombre_estacion, b.nombre_estacion));
    $("#lista").innerHTML = ord.length ? ord.slice(0, mostrar).map((e) => `<li><button type="button" data-i="${e._i}">
      <span class="punto" style="background:${colorDe(e)}"></span><span class="nombre">${esc(e.nombre_estacion)}</span>
      <span class="lugar">${esc([e.localidad, tpais(e.pais)].filter(Boolean).join(", "))}${e.red ? " — " + esc(e.red) : ""}</span></button></li>`).join("")
      : `<li class="vacio">${esc(t(DATA.length ? "list.empty_filters" : "list.empty_data"))}</li>`;
    const resto = ord.length - mostrar;
    $("#btn-mas").hidden = resto <= 0;
    $("#btn-mas").textContent = t("list.more", { a: fmt(Math.min(PASO, resto)), b: fmt(resto) });
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
    const hayOtras = calcularColoresRed(visibles);
    pintarLeyenda(hayOtras);
    pintarMarcadores();
    const nP = new Set(visibles.map((e) => e.pais)).size;
    const nR = new Set(visibles.map((e) => e.red)).size;
    $("#resumen").innerHTML = DATA.length
      ? esc(t("summary.pattern")).replace("{st}", `<strong>${fmt(visibles.length)}</strong> ${esc(plural("n.station", visibles.length))}`)
          .replace("{co}", `${fmt(nP)} ${esc(plural("n.country", nP))}`).replace("{ne}", `${fmt(nR)} ${esc(plural("n.network", nR))}`)
      : esc(t("summary.none"));
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
    const btn = ev.currentTarget; const orig = t("list.csv");
    try {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([texto], { type: "text/csv;charset=utf-8" }));
      a.download = "estaciones_gecal.csv"; document.body.appendChild(a); a.click(); a.remove();
    } catch (e) { /* descarga bloqueada */ }
    if (window.self !== window.top) {
      try { await navigator.clipboard.writeText(texto); btn.textContent = t("csv.copied"); }
      catch (e) { btn.textContent = t("csv.failed"); }
      setTimeout(() => (btn.textContent = orig), 2500);
    }
  });

  // ---------- encabezado y pie
  const bf = $("#btn-form");
  if (urlSegura(CFG.formUrl)) bf.href = CFG.formUrl;
  else bf.setAttribute("aria-disabled", "true");
  if (urlSegura(CFG.contribuirUrl)) { const lr = $("#link-red"); lr.href = CFG.contribuirUrl; lr.hidden = false; }
  if (CFG.avisoDemo) $("#aviso-demo").hidden = false;
  const externas = (META.fuentes || []).filter((f) => FUENTES[f]);
  function pintarPie() {
    if (!urlSegura(CFG.formUrl)) bf.title = t("add_station.missing");
    $("#pie-meta").innerHTML = [
      META.generado ? esc(t("foot.updated", { date: new Date(META.generado).toLocaleDateString(GT.lang, { day: "numeric", month: "long", year: "numeric" }) })) : "",
      externas.length ? esc(t("foot.includes", { list: "\u0001" })).replace("\u0001",
        externas.map((f) => `<a href="${esc(FUENTES[f])}" target="_blank" rel="noopener noreferrer">${esc(f)}</a>`).join(", ")) : "",
      CFG.contacto ? esc(t("foot.contact", { c: CFG.contacto })) : ""
    ].filter(Boolean).join(" ");
  }

  // ---------- idioma y tema: se vuelve a pintar todo lo que genera este archivo
  GT.alIdioma(() => {
    construirControlCapas();
    pintarPie();
    actualizar();
    if (elegida) abrirFicha(elegida, false, fichaGrupo, true);
  });
  GT.alTema(() => {
    refrescarColores();
    capaGris.setUrl(urlGris());
    if (capaPaises) capaPaises.setStyle(estiloPaises());
    anillo.setStyle({ color: css("--ink") });
    repintarColores();
  });

  pintarPie();
  actualizar();
})();
