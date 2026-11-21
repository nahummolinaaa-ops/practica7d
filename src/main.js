import "./style.css";

(function () {
  var state = { items: [], q: "", ready: false };
  var backend = null;
  var amounts = {};
  var busy = {};
  var confirming = {};
  var localSeq = 0;

  function $(s) { return document.querySelector(s); }
  function h(tag, attrs) {
    var el = document.createElement(tag);
    if (attrs) for (var k in attrs) {
      if (k === "class") el.className = attrs[k];
      else if (k === "text") el.textContent = attrs[k];
      else if (k.slice(0, 2) === "on") el.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] === true) el.setAttribute(k, "");
      else if (attrs[k] !== false && attrs[k] != null) el.setAttribute(k, attrs[k]);
    }
    for (var i = 2; i < arguments.length; i++) {
      var c = arguments[i];
      if (c == null || c === false) continue;
      el.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    }
    return el;
  }
  function setNote(t) { var n = $("#note"); n.textContent = t || ""; n.hidden = !t; }
  function setMsg(t) { $("#msg").textContent = t || ""; }
  function errText(e) {
    var c = e && e.code;
    if (c === "quota_exceeded") return "El almacén llegó a su límite de registros. Elimina productos que ya no uses.";
    if (c === "invalid_argument") return "No tienes permiso para modificar este inventario.";
    if (c === "revoked") return "Se perdió el acceso a este inventario.";
    return "No se pudo guardar el cambio. Inténtalo de nuevo.";
  }
  function fmt(n) { return Number(n).toLocaleString("es"); }

  function render() {
    var units = 0;
    state.items.forEach(function (i) { units += i.qty; });
    $("#t-products").textContent = fmt(state.items.length);
    $("#t-units").textContent = fmt(units);

    var list = $("#list");
    list.replaceChildren();
    if (!state.ready) {
      list.appendChild(h("li", { class: "empty", text: "Cargando inventario…" }));
      return;
    }
    var q = state.q.trim().toLowerCase();
    var shown = state.items.filter(function (i) { return i.name.toLowerCase().indexOf(q) !== -1; })
      .sort(function (a, b) { return a.name.localeCompare(b.name, "es"); });
    if (!state.items.length) {
      list.appendChild(h("li", { class: "empty" }, h("strong", { text: "El almacén está vacío" }), "Agrega tu primer producto con el formulario de arriba."));
      return;
    }
    if (!shown.length) {
      list.appendChild(h("li", { class: "empty", text: "Ningún producto coincide con la búsqueda." }));
      return;
    }
    shown.forEach(function (it) { list.appendChild(rowEl(it)); });
  }

  function rowEl(it) {
    var amt = amounts[it.id] != null ? amounts[it.id] : 1;
    var isBusy = !!busy[it.id];
    var input = h("input", {
      type: "number", inputmode: "numeric", min: "1", step: "1", value: String(amt),
      "aria-label": "Cantidad a mover de " + it.name,
      oninput: function (e) { amounts[it.id] = e.target.value; }
    });
    function amount() {
      var n = parseInt(input.value, 10);
      return n > 0 ? n : 0;
    }
    var addBtn = h("button", {
      type: "button", class: "add-btn", disabled: isBusy, text: "Agregar",
      onclick: function () { var n = amount(); if (!n) return setMsg("Escribe una cantidad mayor que cero."); adjust(it, n); }
    });
    var remBtn = h("button", {
      type: "button", class: "rem-btn", disabled: isBusy, text: "Quitar",
      onclick: function () {
        var n = amount();
        if (!n) return setMsg("Escribe una cantidad mayor que cero.");
        if (n > it.qty) return setMsg("Solo quedan " + fmt(it.qty) + " " + it.unit + " de " + it.name + ".");
        adjust(it, -n);
      }
    });
    var isConfirm = !!confirming[it.id];
    var delBtn = h("button", {
      type: "button", class: "del-btn" + (isConfirm ? " confirm" : ""), disabled: isBusy,
      "aria-label": "Eliminar " + it.name + " del inventario",
      text: isConfirm ? "¿Seguro?" : "Eliminar",
      onclick: function () {
        if (!confirming[it.id]) {
          confirming[it.id] = setTimeout(function () { delete confirming[it.id]; render(); }, 4000);
          render();
          return;
        }
        clearTimeout(confirming[it.id]);
        delete confirming[it.id];
        removeProduct(it);
      }
    });
    return h("li", { class: "row" },
      h("div", { class: "info" }, h("span", { class: "name", text: it.name }), h("span", { class: "unit", text: it.unit })),
      h("div", { class: "qty" + (it.qty === 0 ? " out" : "") },
        h("span", { class: "num", text: fmt(it.qty) }),
        it.qty === 0 ? h("span", { class: "pill", text: "Agotado" }) : null),
      h("div", { class: "controls" }, input, addBtn, remBtn, delBtn)
    );
  }

  async function guarded(id, fn) {
    if (busy[id]) return;
    busy[id] = true;
    setMsg("");
    render();
    try { await fn(); } catch (e) { setMsg(errText(e)); }
    delete busy[id];
    render();
  }
  function adjust(it, delta) {
    return guarded(it.id, function () { return backend.update(it.id, { qty: it.qty + delta }); });
  }
  function removeProduct(it) {
    return guarded(it.id, function () { return backend.remove(it.id); });
  }

  $("#add-form").addEventListener("submit", async function (e) {
    e.preventDefault();
    if (!backend) return;
    var name = $("#f-name").value.trim().replace(/\s+/g, " ");
    var qty = parseInt($("#f-qty").value, 10);
    var unit = $("#f-unit").value;
    if (!name) return setMsg("Escribe el nombre del producto.");
    if (!(qty > 0)) return setMsg("La cantidad debe ser mayor que cero.");
    var existing = state.items.filter(function (i) { return i.name.toLowerCase() === name.toLowerCase(); })[0];
    var btn = $("#f-submit");
    btn.disabled = true;
    setMsg("");
    try {
      if (existing) {
        await backend.update(existing.id, { qty: existing.qty + qty });
        setMsg("");
      } else {
        await backend.add({ name: name, qty: qty, unit: unit, createdAt: Date.now() });
      }
      $("#f-name").value = "";
      $("#f-qty").value = "1";
      $("#f-name").focus();
    } catch (err) { setMsg(errText(err)); }
    btn.disabled = false;
  });

  $("#f-search").addEventListener("input", function (e) { state.q = e.target.value; render(); });

  function clean(id, d) {
    return { id: id, name: String(d.name || "Sin nombre"), qty: Math.max(0, Math.floor(Number(d.qty) || 0)), unit: String(d.unit || "unidades") };
  }

  var KEY = "almacen-items";
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state.items)); }
    catch (e) { setNote("No se pudo guardar en este navegador."); }
  }
  function load() {
    try {
      var raw = JSON.parse(localStorage.getItem(KEY) || "[]");
      return raw.map(function (d) { return clean(String(d.id), d); });
    } catch (e) { return []; }
  }
  function init() {
    state.items = load();
    backend = {
      add: async function (d) { state.items.push(clean("p" + Date.now() + "-" + (++localSeq), d)); save(); render(); },
      update: async function (id, d) { state.items.forEach(function (i) { if (i.id === id) i.qty = d.qty; }); save(); render(); },
      remove: async function (id) { state.items = state.items.filter(function (i) { return i.id !== id; }); save(); render(); }
    };
    state.ready = true;
    render();
  }
  init();
})();
