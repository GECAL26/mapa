// Idioma y tema del sitio. Comparte las claves "gecal-lang" y "gecal-theme" con gecal26.github.io
// (mismo origen), así que quien ya eligió idioma o tema en la web principal los encuentra aquí.
// Se carga antes de los datos para traducir el texto fijo sin esperar a los 2,6 MB de estaciones.
(function () {
  "use strict";

  const I = window.I18N;
  const root = document.documentElement;
  const leer = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const guardar = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* modo privado: se ignora */ } };

  // ---------- idioma
  function detectar() {
    const q = new URLSearchParams(location.search).get("lang");
    if (I.langs.includes(q)) return q;
    const g = leer("gecal-lang");
    if (I.langs.includes(g)) return g;
    for (const l of navigator.languages || [navigator.language || ""]) {
      const p = String(l).slice(0, 2).toLowerCase();
      if (I.langs.includes(p)) return p;
    }
    return "es";
  }
  let lang = detectar();
  const alIdioma = [];
  const alTema = [];

  function t(clave, vars) {
    let s = (I.ui[lang] && I.ui[lang][clave]) || I.ui.es[clave] || clave;
    if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? vars[k] : m));
    return s;
  }
  const plural = (base, n) => t(base + (new Intl.PluralRules(lang).select(n) === "one" ? "_one" : "_other"));
  const cat = (v) => (I.cat[lang] && I.cat[lang][v]) || v;
  const pais = (v) => (I.pais[lang] && I.pais[lang][v]) || v;
  // Todas las grafías de un país (para que la búsqueda lo encuentre en cualquier idioma).
  const paisTodos = (v) => [v].concat(["pt", "fr", "en"].map((l) => (I.pais[l] && I.pais[l][v]) || v));

  function textoFijo() {
    root.lang = lang;
    document.title = t("doc.title");
    const d = document.querySelector('meta[name="description"]');
    if (d) d.content = t("doc.description");
    document.querySelectorAll("[data-i18n]").forEach((el) => { el.textContent = t(el.dataset.i18n); });
    document.querySelectorAll("[data-i18n-ph]").forEach((el) => { el.placeholder = t(el.dataset.i18nPh); });
    document.querySelectorAll("[data-i18n-aria]").forEach((el) => { el.setAttribute("aria-label", t(el.dataset.i18nAria)); });
    document.querySelectorAll("[data-i18n-title]").forEach((el) => { el.title = t(el.dataset.i18nTitle); });
    document.querySelectorAll("[data-i18n-alt]").forEach((el) => { el.alt = t(el.dataset.i18nAlt); });
    const marca = document.getElementById("marca");
    if (marca) marca.href = "https://gecal26.github.io/" + lang + "/";
    const cur = document.getElementById("idioma-actual");
    if (cur) cur.textContent = lang.toUpperCase();
    document.querySelectorAll("[data-lang-set]").forEach((b) => {
      b.setAttribute("aria-current", String(b.dataset.langSet === lang));
    });
  }

  function cambiarIdioma(l) {
    if (!I.langs.includes(l) || l === lang) return;
    lang = l;
    guardar("gecal-lang", l);
    try {
      const u = new URL(location.href);
      u.searchParams.set("lang", l);
      history.replaceState(null, "", u);
    } catch (e) { /* sin history: se ignora */ }
    textoFijo();
    alIdioma.forEach((f) => f());
  }

  // ---------- tema (sistema / claro / oscuro)
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  function aplicarTema(pref) {
    const oscuro = pref === "dark" || (pref === "system" && mq.matches);
    root.dataset.theme = oscuro ? "dark" : "light";
    root.dataset.themePref = pref;
    document.querySelectorAll("[data-theme-set]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.themeSet === pref)));
    alTema.forEach((f) => f(oscuro ? "dark" : "light"));
  }

  document.addEventListener("click", (ev) => {
    const tb = ev.target.closest("[data-theme-set]");
    if (tb) { guardar("gecal-theme", tb.dataset.themeSet); aplicarTema(tb.dataset.themeSet); return; }
    const lb = ev.target.closest("[data-lang-set]");
    if (lb) {
      cambiarIdioma(lb.dataset.langSet);
      const m = lb.closest("details");
      if (m) { m.open = false; m.querySelector("summary").focus(); }
    }
  });
  (mq.addEventListener ? mq.addEventListener.bind(mq, "change") : mq.addListener.bind(mq))(() => {
    if (root.dataset.themePref === "system") aplicarTema("system");
  });

  // Menú de idiomas: se llena con los nombres propios de cada idioma.
  const lista = document.getElementById("lista-idiomas");
  if (lista) {
    lista.innerHTML = I.langs.map((l) => `<li><button type="button" data-lang-set="${l}" lang="${l}">${I.nombres[l]}</button></li>`).join("");
  }

  // El menú de idiomas se cierra con Escape o al hacer clic fuera.
  document.addEventListener("click", (ev) => {
    document.querySelectorAll("details.menu[open]").forEach((m) => { if (!m.contains(ev.target)) m.open = false; });
  });
  document.addEventListener("keydown", (ev) => {
    if (ev.key !== "Escape") return;
    document.querySelectorAll("details.menu[open]").forEach((m) => { m.open = false; m.querySelector("summary").focus(); });
  });

  textoFijo();
  aplicarTema(root.dataset.themePref || "system");

  window.GT = {
    t, plural, cat, pais, paisTodos,
    get lang() { return lang; },
    get oscuro() { return root.dataset.theme === "dark"; },
    alIdioma: (f) => alIdioma.push(f),
    alTema: (f) => alTema.push(f)
  };
})();
