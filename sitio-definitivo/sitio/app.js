/* Mapa GECAL — lógica del sitio (sin dependencias salvo Leaflet). */
(function () {
  "use strict";

  const CFG = window.GECAL_CONFIG || {};
  const DATA = (window.ESTACIONES && window.ESTACIONES.estaciones) || [];
  const META = (window.ESTACIONES && window.ESTACIONES.metadata) || {};

  const COLORES = {
    "Calidad del aire": "var(--c-aire)",
    "Meteorológica": "var(--c-meteo)",
    "Calidad del aire y meteorología": "var(--c-ambas)"
  };
  const HEX = { "Calidad del aire": "#d9480f", "Meteorológica": "#1c7ed6", "Calidad del aire y meteorología": "#7048e8" };
  const PUBLICOS = ["Públicos, en tiempo real o casi real", "Públicos, solo históricos"];

  // ---------- utilidades
  const $ = (s, el) => (el || document).querySelector(s);
  const esc = (v) => String(v == null ? "" : v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const urlSegura = (u) => (/^https?:\/\/[^\s"'<>]+$/i.test(u || "") ? u : "");
  const norm = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const cmp = (a, b) => String(a).localeCompare(String(b), "es", { numeric: true, sensitivity: "base" });
  const fmt = (n) => Number(n).toLocaleString("es");

  // Enriquecer cada estación
  DATA.forEach((e, i) => {
    e._i = i;
    e.variables = [].concat(e.contaminantes || [], e.meteorologia || []);
    e.nvars = e.variables.length;
    e._texto = norm([e.nombre_estacion, e.localidad, e.division, e.pais, e.red, e.operador, e.codigo, e.id_gecal].join(" "));
  });

  // ---------- definición de filtros
  const ORDEN_VARS = ["MP10", "MP2.5", "MP1", "O3", "NO", "NO2", "NOx", "SO2", "CO", "CO2", "CH4", "H2S", "NH3", "COV / BTEX", "HCHO",
    "Carbono negro (BC)", "Metales en material particulado", "Temperatura", "Humedad relativa", "Presión", "Velocidad del viento",
    "Dirección del viento", "Precipitación", "Radiación solar"];
  const ORDEN_FREC = ["1 min o menos", "5 a 15 min", "1 hora", "24 horas", "Variable / otra", "No sé"];
  const FILTROS = [
    { k: "pais", t: "País", abierto: true },
    { k: "tipo_estacion", t: "Tipo de estación", abierto: true },
    { k: "variables", t: "Variable medida", lista: true, abierto: true, ordenVars: true },
    { k: "red", t: "Red" },
    { k: "operador", t: "Institución operadora" },
    { k: "instrumental", t: "Instrumental", lista: true },
    { k: "entorno", t: "Entorno" },
    { k: "frecuencia", t: "Frecuencia", orden: ORDEN_FREC },
    { k: "estado_operativo", t: "Operativa actualmente" },
    { k: "acceso_datos", t: "Acceso a los datos" },
    { k: "desde", t: "Midiendo desde (año o antes)", unico: true }
  ];
  const sel = {}; // k -> Set
  FILTROS.forEach((f) => (sel[f.k] = new Set()));
  let consulta = "";

  const valores = (e, k) => {
    if (k === "desde") return e.anio_inicio ? [String(e.anio_inicio)] : [];
    const v = e[k];
    if (Array.isArray(v)) return v.length ? v : [];
    return v ? [v] : [];
  };

  function pasa(e, excepto) {
    if (consulta && !e._texto.includes(consulta)) return false;
    for (const f of FILTROS) {
      if (f.k === excepto) continue;
      const s = sel[f.k];
      if (!s.size) continue;
      if (f.k === "desde") {
        const lim = Math.max(...[...s].map(Number));
        if (!e.anio_inicio || e.anio_inicio > lim) return false;
        continue;
      }
      const vs = valores(e, f.k);
      if (!vs.some((v) => s.has(v))) return false;
    }
    return true;
  }

  // ---------- construir panel de filtros
  const grupos = $("#grupos");
  function opcionesDe(f) {
    const set = new Set();
    DATA.forEach((e) => valores(e, f.k).forEach((v) => set.add(v)));
    let ops = [...set];
    if (f.ordenVars) ops.sort((a, b) => ((ORDEN_VARS.indexOf(a) + 1) || 999) - ((ORDEN_VARS.indexOf(b) + 1) || 999) || cmp(a, b));
    else if (f.orden) ops.sort((a, b) => (f.orden.indexOf(a) + 1 || 99) - (f.orden.indexOf(b) + 1 || 99));
    else if (f.k === "desde") ops.sort((a, b) => Number(b) - Number(a));
    else ops.sort(cmp);
    return ops;
  }
  FILTROS.forEach((f) => {
    const ops = opcionesDe(f);
    if (!ops.length) return;
    const d = document.createElement("details");
    d.className = "grupo";
    d.dataset.k = f.k;
    if (f.abierto) d.open = true;
    d.innerHTML = `<summary>${esc(f.t)}<span class="sel"></span></summary><div class="opciones">${ops
      .map((o) => `<label class="opcion"><input type="${f.unico ? "radio" : "checkbox"}" name="f-${f.k}" value="${esc(o)}"><span>${esc(
        f.k === "desde" ? "≤ " + o : o)}</span><span class="n"></span></label>`)
      .join("")}</div>`;
    d.addEventListener("change", (ev) => {
      const inp = ev.target;
      if (f.unico) { sel[f.k].clear(); if (inp.checked) sel[f.k].add(inp.value); }
      else inp.checked ? sel[f.k].add(inp.value) : sel[f.k].delete(inp.value);
      actualizar();
    });
    // permitir desmarcar el radio con un segundo clic
    if (f.unico) d.addEventListener("click", (ev) => {
      const inp = ev.target.closest("input");
      if (inp && sel[f.k].has(inp.value) && inp.dataset.was === "1") { inp.checked = false; sel[f.k].clear(); inp.dataset.was = "0"; actualizar(); }
      else if (inp) { d.querySelectorAll("input").forEach((x) => (x.dataset.was = "0")); inp.dataset.was = "1"; }
    });
    grupos.appendChild(d);
  });

  function refrescarConteos() {
    let activos = 0;
    grupos.querySelectorAll(".grupo").forEach((d) => {
      const k = d.dataset.k;
      const base = DATA.filter((e) => pasa(e, k));
      const cnt = {};
      base.forEach((e) => valores(e, k).forEach((v) => (cnt[v] = (cnt[v] || 0) + 1)));
      if (k === "desde") {
        // acumulado: estaciones que empezaron ese año o antes
        d.querySelectorAll(".opcion").forEach((lab) => {
          const v = Number($("input", lab).value);
          const n = base.filter((e) => e.anio_inicio && e.anio_inicio <= v).length;
          $(".n", lab).textContent = n; lab.classList.toggle("cero", !n);
        });
      } else {
        d.querySelectorAll(".opcion").forEach((lab) => {
          const n = cnt[$("input", lab).value] || 0;
          $(".n", lab).textContent = n; lab.classList.toggle("cero", !n);
        });
      }
      const s = sel[k].size;
      activos += s ? 1 : 0;
      $(".sel", d).textContent = s ? (k === "desde" ? "≤ " + [...sel[k]][0] : s + " sel.") : "";
    });
    if (consulta) activos++;
    $("#n-activos").textContent = activos + (activos === 1 ? " activo" : " activos");
  }

  // ---------- mapa
  const mapa = L.map("mapa", { zoomControl: true, worldCopyJump: true, preferCanvas: true });
  const bases = {
    "OpenStreetMap": L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 18, attribution: "© OpenStreetMap" }),
    "Satélite": L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
      maxZoom: 18, attribution: "Imágenes © Esri" }),
    "Claro": L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}", {
      maxZoom: 16, attribution: "Mapa base © Esri" }),
    "Sin fondo": L.layerGroup()
  };
  bases["Claro"].addTo(mapa);

  const paises = window.PAISES_GEOJSON ? L.geoJSON(window.PAISES_GEOJSON, {
    style: { color: "#5b7480", weight: 0.8, fillColor: "#ffffff", fillOpacity: 0.35 },
    interactive: false
  }).addTo(mapa) : null;
  const capaEst = L.layerGroup().addTo(mapa);
  L.control.layers(bases, paises ? { "Límites de países": paises } : {}, { collapsed: true }).addTo(mapa);
  L.control.scale({ imperial: false }).addTo(mapa);
  mapa.fitBounds([[-56, -118], [32, -34]]);

  const marcadores = new Map();
  DATA.forEach((e) => {
    const col = HEX[e.tipo_estacion] || "#495057";
    const activa = e.estado_operativo === "Sí";
    const m = L.circleMarker([e.latitud, e.longitud], {
      radius: 6.5, weight: activa ? 1.5 : 2.2, color: activa ? "#ffffff" : col,
      fillColor: activa ? col : "#ffffff", fillOpacity: 0.95
    });
    m.bindPopup(() => popup(e), { maxWidth: 340 });
    m.bindTooltip(esc(e.nombre_estacion), { direction: "top", offset: [0, -6] });
    marcadores.set(e._i, m);
  });

  function popup(e) {
    const url = urlSegura(e.url_datos);
    const tags = (arr, c) => (arr && arr.length ? `<div class="tags">${arr.map((v) => `<span class="tag ${c}">${esc(v)}</span>`).join("")}</div>` : "—");
    const fila = (t, v) => (v ? `<dt>${t}</dt><dd>${v}</dd>` : "");
    return `<div class="pop"><h3>${esc(e.nombre_estacion)}</h3>
      <div class="sub">${esc([e.localidad, e.division, e.pais].filter(Boolean).join(", "))}${e.codigo ? " · " + esc(e.codigo) : ""}</div>
      <dl>
        ${fila("Red", esc(e.red))}
        ${fila("Opera", esc(e.operador))}
        ${fila("Tipo", esc(e.tipo_estacion) + (e.entorno ? " · " + esc(e.entorno) : ""))}
        ${fila("Instrumental", esc((e.instrumental || []).join(", ")))}
        <dt>Contaminantes</dt><dd>${tags(e.contaminantes, "c")}</dd>
        <dt>Meteorología</dt><dd>${tags(e.meteorologia, "m")}</dd>
        ${fila("Frecuencia", esc(e.frecuencia))}
        ${fila("Desde", esc(e.anio_inicio || ""))}
        ${fila("Operativa", esc(e.estado_operativo))}
        ${fila("Datos", esc(e.acceso_datos))}
        ${fila("Altitud", e.altitud_m != null ? esc(e.altitud_m) + " m" : "")}
        ${fila("Coordenadas", esc(e.latitud.toFixed(4) + ", " + e.longitud.toFixed(4)))}
        ${url ? `<dt>Enlace</dt><dd><a href="${esc(url)}" target="_blank" rel="noopener noreferrer">Ver datos / red ↗</a></dd>` : ""}
      </dl>
      <div class="muted" style="margin-top:8px">${esc(e.id_gecal)}${e.fecha_carga ? " · cargada " + esc(e.fecha_carga) : ""}</div></div>`;
  }

  $("#leyenda").innerHTML = Object.keys(HEX).map((k) => `<span><i style="background:${HEX[k]}"></i>${esc(k)}</span>`).join("") +
    `<span><i class="hueco"></i>No operativa / sin dato</span>`;

  // ---------- tabla
  let orden = { k: "pais", dir: 1 };
  const thead = $("#tabla thead");
  thead.addEventListener("click", (ev) => {
    const th = ev.target.closest("th"); if (!th) return;
    orden = { k: th.dataset.k, dir: orden.k === th.dataset.k ? -orden.dir : 1 };
    actualizar();
  });

  function pintarTabla(lista) {
    thead.querySelectorAll("th").forEach((th) => th.setAttribute("aria-sort", th.dataset.k === orden.k ? (orden.dir > 0 ? "ascending" : "descending") : "none"));
    const ord = lista.slice().sort((a, b) => {
      const r = orden.k === "nvars" ? a.nvars - b.nvars : cmp(a[orden.k] || "", b[orden.k] || "");
      return r * orden.dir || cmp(a.nombre_estacion, b.nombre_estacion);
    });
    const tb = $("#tabla tbody");
    if (!ord.length) {
      const form = urlSegura(CFG.formUrl);
      tb.innerHTML = `<tr><td colspan="8" class="vacio">${DATA.length ? "Ninguna estación coincide con los filtros."
        : "Todavía no hay estaciones publicadas." + (form ? ` <a href="${esc(form)}" target="_blank" rel="noopener">¡Carga la primera!</a>` : "")}</td></tr>`;
      return;
    }
    tb.innerHTML = ord.map((e) => `<tr data-i="${e._i}">
      <td><span class="dot" style="background:${HEX[e.tipo_estacion] || "#495057"}"></span>${esc(e.nombre_estacion)}</td>
      <td>${esc(e.pais)}</td><td>${esc(e.localidad)}</td><td>${esc(e.red)}</td><td>${esc(e.tipo_estacion)}</td>
      <td title="${esc(e.variables.join(", "))}">${e.nvars ? esc(e.variables.slice(0, 4).join(", ")) + (e.nvars > 4 ? ` +${e.nvars - 4}` : "") : "—"}</td>
      <td>${esc(e.estado_operativo)}</td><td>${esc(e.acceso_datos)}</td></tr>`).join("");
  }
  $("#tabla tbody").addEventListener("click", (ev) => {
    const tr = ev.target.closest("tr[data-i]"); if (!tr) return;
    const m = marcadores.get(Number(tr.dataset.i));
    mapa.flyTo(m.getLatLng(), Math.max(mapa.getZoom(), 9), { duration: 0.6 });
    setTimeout(() => m.openPopup(), 650);
    $("#mapa").scrollIntoView({ behavior: "smooth", block: "center" });
  });

  // ---------- matriz de cobertura
  function pintarMatriz(lista) {
    const t = $("#matriz");
    const vars = [...new Set(lista.flatMap((e) => e.variables))];
    const pos = (v) => { const i = ORDEN_VARS.indexOf(v); return i < 0 ? 999 : i; };
    vars.sort((a, b) => pos(a) - pos(b) || cmp(a, b));
    const ps = [...new Set(lista.map((e) => e.pais))].sort(cmp);
    if (!lista.length || !vars.length) { t.innerHTML = `<tbody><tr><td class="vacio">Sin datos para la selección.</td></tr></tbody>`; return; }
    const cnt = {}; let max = 1;
    lista.forEach((e) => e.variables.forEach((v) => { const k = e.pais + "|" + v; cnt[k] = (cnt[k] || 0) + 1; max = Math.max(max, cnt[k]); }));
    t.innerHTML = `<thead><tr><th>País</th>${vars.map((v) => `<th>${esc(v)}</th>`).join("")}</tr></thead><tbody>${ps.map((p) =>
      `<tr><td>${esc(p)}</td>${vars.map((v) => { const n = cnt[p + "|" + v] || 0; const a = n ? 0.12 + 0.6 * (n / max) : 0;
        return `<td style="background:rgba(10,135,131,${a.toFixed(2)});color:${a > 0.45 ? "#fff" : "inherit"}">${n || "·"}</td>`; }).join("")}</tr>`).join("")}</tbody>`;
  }

  // ---------- actualizar todo
  let visibles = DATA;
  function actualizar() {
    visibles = DATA.filter((e) => pasa(e));
    capaEst.clearLayers();
    visibles.forEach((e) => capaEst.addLayer(marcadores.get(e._i)));
    $("#n-est").textContent = fmt(visibles.length);
    $("#n-pais").textContent = fmt(new Set(visibles.map((e) => e.pais)).size);
    $("#n-red").textContent = fmt(new Set(visibles.map((e) => e.red)).size);
    $("#n-pub").textContent = fmt(visibles.filter((e) => PUBLICOS.includes(e.acceso_datos)).length);
    $("#tabla-info").textContent = `${fmt(visibles.length)} de ${fmt(DATA.length)} estaciones`;
    refrescarConteos();
    pintarTabla(visibles);
    pintarMatriz(visibles);
  }

  let tq;
  $("#q").addEventListener("input", (ev) => { clearTimeout(tq); tq = setTimeout(() => { consulta = norm(ev.target.value.trim()); actualizar(); }, 150); });
  $("#btn-limpiar").addEventListener("click", () => {
    FILTROS.forEach((f) => sel[f.k].clear());
    grupos.querySelectorAll("input").forEach((i) => (i.checked = false));
    $("#q").value = ""; consulta = "";
    actualizar();
  });

  // ---------- CSV
  const COLS = ["id_gecal", "nombre_estacion", "codigo", "pais", "division", "localidad", "latitud", "longitud", "altitud_m", "red", "operador",
    "tipo_estacion", "entorno", "instrumental", "contaminantes", "meteorologia", "frecuencia", "anio_inicio", "estado_operativo", "acceso_datos", "url_datos", "fecha_carga"];
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
    if (window.self !== window.top) { // dentro de un visor que bloquea descargas: copiar
      try { await navigator.clipboard.writeText(texto); btn.textContent = "CSV copiado al portapapeles"; }
      catch (e) { btn.textContent = "No se pudo descargar aquí"; }
      setTimeout(() => (btn.textContent = orig), 2500);
    }
  });

  // ---------- botón formulario, aviso, pie
  const bf = $("#btn-form");
  if (urlSegura(CFG.formUrl)) bf.href = CFG.formUrl;
  else { bf.setAttribute("aria-disabled", "true"); bf.title = "Configurá formUrl en config.js"; }
  if (CFG.avisoDemo) $("#aviso-demo").hidden = false;
  $("#pie-meta").textContent = [
    META.generado ? "Catálogo actualizado: " + new Date(META.generado).toLocaleDateString("es", { day: "numeric", month: "long", year: "numeric" }) : "",
    CFG.contacto ? "Contacto: " + CFG.contacto : ""
  ].filter(Boolean).join(" · ");

  actualizar();
})();
