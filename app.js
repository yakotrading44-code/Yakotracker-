// Yako Trading profit & expense tracker
// Plain JavaScript, no build step. Data lives either in a Google Sheet (online)
// or in this browser's localStorage (device only).

const CATEGORIES = {
  expense: [
    "Goods purchase (supplier)",
    "Freight / shipping",
    "Customs duty & clearing",
    "Port & handling charges",
    "Local transport / delivery",
    "Warehouse / storage",
    "Agent commission",
    "Bank & transfer fees",
    "Salaries & wages",
    "Rent & utilities",
    "Marketing",
    "Other expense",
  ],
  income: [
    "Product sales",
    "Shipping charged to clients",
    "Other income",
  ],
};

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

const state = {
  transactions: [],
  shipments: [],
  user: null,
  charts: {},
};

// ---------- formatting ----------

const fmt = new Intl.NumberFormat("en-GH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const money = (n, cur = "GHS") => `${cur} ${fmt.format(Number(n) || 0)}`;
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const today = () => new Date().toISOString().slice(0, 10);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const fmtDate = (d) => (d ? new Date(d + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "");

function toast(text) {
  const el = $("#toast");
  el.textContent = text;
  el.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => (el.hidden = true), 2500);
}

// ---------- settings (per device) ----------

const Settings = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem("yako_setting_" + key);
      return v === null ? fallback : JSON.parse(v);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try { localStorage.setItem("yako_setting_" + key, JSON.stringify(value)); } catch {}
  },
};

function cloudConfig() {
  const saved = Settings.get("cloud", null);
  if (saved && saved.url) return saved;
  const url = (window.YAKO_CONFIG || {}).sheetUrl;
  return url ? { url } : null;
}

function rates() {
  return Settings.get("rates", { USD: 15, RMB: 2.1 });
}

// ---------- storage ----------

const LocalStore = {
  mode: "local",
  read(table) {
    try { return JSON.parse(localStorage.getItem("yako_" + table) || "[]"); } catch { return []; }
  },
  write(table, rows) {
    localStorage.setItem("yako_" + table, JSON.stringify(rows));
  },
  async listAll() {
    return { transactions: this.read("transactions"), shipments: this.read("shipments") };
  },
  async insert(table, row) {
    const rows = this.read(table);
    const rec = { ...row, id: crypto.randomUUID(), created_at: new Date().toISOString() };
    rows.push(rec);
    this.write(table, rows);
    return rec;
  },
  async update(table, id, patch) {
    const rows = this.read(table);
    const i = rows.findIndex((r) => r.id === id);
    if (i < 0) throw new Error("Record not found");
    rows[i] = { ...rows[i], ...patch };
    this.write(table, rows);
    return rows[i];
  },
  async remove(table, id) {
    this.write(table, this.read(table).filter((r) => r.id !== id));
    if (table === "shipments") {
      // mirror the database rule: unlink records from a deleted shipment
      this.write("transactions", this.read("transactions").map((t) => (t.shipment_id === id ? { ...t, shipment_id: null } : t)));
    }
  },
};

// Google Sheets via the Apps Script web app in apps-script/Code.gs
function makeSheetStore(url, passcode) {
  async function call(action, payload = {}) {
    let res;
    try {
      res = await fetch(url, {
        method: "POST",
        // text/plain avoids a CORS preflight, which Apps Script can't answer
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({ action, passcode, ...payload }),
      });
    } catch {
      throw new Error("Could not reach your Google Sheet. Check your internet connection.");
    }
    let data;
    try {
      data = await res.json();
    } catch {
      throw new Error("The Google Sheet link did not answer correctly. Check the Web app URL and that access is set to \"Anyone\".");
    }
    if (!data.ok) {
      const err = new Error(data.error || "Unknown error");
      err.code = data.code;
      throw err;
    }
    return data;
  }
  return {
    mode: "cloud",
    async listAll() {
      const d = await call("list");
      return { transactions: d.transactions, shipments: d.shipments };
    },
    async insert(table, row) {
      return (await call("insert", { table, row })).rows[0];
    },
    async insertMany(table, rows) {
      return (await call("insert", { table, rows })).rows;
    },
    async update(table, id, row) {
      return (await call("update", { table, id, row })).row;
    },
    async remove(table, id) {
      await call("remove", { table, id });
    },
  };
}

let Store = LocalStore;

// ---------- startup ----------

function start() {
  const cfg = cloudConfig();
  if (!cfg) return openApp();
  const passcode = Settings.get("passcode", "");
  if (!passcode) return showPasscode();
  Store = makeSheetStore(cfg.url, passcode);
  openApp();
}

function showPasscode(message = "") {
  $("#app-screen").hidden = true;
  $("#auth-screen").hidden = false;
  const msg = $("#auth-msg");
  msg.className = "msg";
  msg.textContent = message;
  $("#auth-form").onsubmit = (e) => {
    e.preventDefault();
    Settings.set("passcode", $("#auth-passcode").value.trim());
    $("#auth-screen").hidden = true;
    start();
  };
  $("#auth-local").onclick = () => {
    $("#auth-screen").hidden = true;
    Store = LocalStore;
    openApp();
  };
}

async function openApp() {
  $("#app-screen").hidden = false;
  $("#storage-badge").textContent = Store.mode === "cloud" ? "Google Sheet" : "This device only";
  try {
    await reload();
  } catch (e) {
    if (e.code === "auth") {
      Settings.set("passcode", "");
      return showPasscode("That passcode is not right. Please try again.");
    }
    alert("Could not load your records: " + e.message);
  }
  renderSettings();
}

async function reload() {
  const { transactions, shipments } = await Store.listAll();
  state.transactions = transactions.map((t) => ({ ...t, amount: Number(t.amount), rate: Number(t.rate) || 1, amount_ghs: Number(t.amount_ghs), date: String(t.date || "") }));
  state.shipments = shipments;
  renderAll();
}

// ---------- tabs ----------

function showTab(name) {
  $$(".tab").forEach((t) => (t.hidden = t.id !== "tab-" + name));
  $$(".tabbar button").forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
  if (name === "dashboard") renderDashboard();
  window.scrollTo(0, 0);
}
$$(".tabbar button").forEach((b) => (b.onclick = () => showTab(b.dataset.tab)));

function renderAll() {
  fillFilterOptions();
  renderDashboard();
  renderRecords();
  renderShipments();
}

// ---------- calculations ----------

function periodRange(key) {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const iso = (d) => d.toISOString().slice(0, 10);
  const first = (yy, mm) => new Date(Date.UTC(yy, mm, 1));
  switch (key) {
    case "this-month": return [iso(first(y, m)), iso(first(y, m + 1))];
    case "last-month": return [iso(first(y, m - 1)), iso(first(y, m))];
    case "last-3": return [iso(first(y, m - 2)), iso(first(y, m + 1))];
    case "this-year": return [iso(first(y, 0)), iso(first(y + 1, 0))];
    default: return [null, null];
  }
}

function totals(list) {
  let income = 0, expense = 0;
  for (const t of list) {
    if (t.type === "income") income += t.amount_ghs;
    else expense += t.amount_ghs;
  }
  return { income: round2(income), expense: round2(expense), profit: round2(income - expense) };
}

// ---------- dashboard ----------

function renderDashboard() {
  if ($("#tab-dashboard").hidden) return;
  const [from, to] = periodRange($("#period").value);
  const list = state.transactions.filter((t) => (!from || t.date >= from) && (!to || t.date < to));
  const k = totals(list);
  $("#k-income").textContent = money(k.income);
  $("#k-expense").textContent = money(k.expense);
  const p = $("#k-profit");
  p.textContent = money(k.profit);
  p.className = k.profit >= 0 ? "pos" : "neg";
  $("#k-margin").textContent = k.income ? Math.round((k.profit / k.income) * 100) + "%" : "—";

  if (!window.Chart) return renderShipmentProfit();
  const css = getComputedStyle(document.documentElement);
  const cIncome = css.getPropertyValue("--income").trim();
  const cExpense = css.getPropertyValue("--expense").trim();
  const cText = css.getPropertyValue("--muted").trim();
  Chart.defaults.color = cText;

  // monthly bars
  const byMonth = {};
  for (const t of list) {
    const key = t.date.slice(0, 7);
    byMonth[key] ??= { income: 0, expense: 0 };
    byMonth[key][t.type] += t.amount_ghs;
  }
  const months = Object.keys(byMonth).sort().slice(-12);
  const labels = months.map((m) => new Date(m + "-01T00:00:00").toLocaleDateString("en-GB", { month: "short", year: "2-digit" }));
  state.charts.monthly?.destroy();
  state.charts.monthly = new Chart($("#chart-monthly"), {
    type: "bar",
    data: {
      labels,
      datasets: [
        { label: "Money in", data: months.map((m) => round2(byMonth[m].income)), backgroundColor: cIncome, borderRadius: 4 },
        { label: "Expenses", data: months.map((m) => round2(byMonth[m].expense)), backgroundColor: cExpense, borderRadius: 4 },
      ],
    },
    options: {
      maintainAspectRatio: false,
      plugins: { tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${money(c.raw)}` } } },
      scales: { y: { beginAtZero: true, ticks: { callback: (v) => fmt.format(v).replace(/\.00$/, "") } } },
    },
  });

  // expense categories
  const byCat = {};
  for (const t of list) if (t.type === "expense") byCat[t.category] = (byCat[t.category] || 0) + t.amount_ghs;
  const cats = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
  const palette = ["#0f5132", "#d4a017", "#2b6cb0", "#c0392b", "#7b4fa3", "#1a9c9c", "#e67e22", "#5f6b65", "#8e44ad", "#16a085", "#a0522d", "#34495e"];
  state.charts.categories?.destroy();
  state.charts.categories = new Chart($("#chart-categories"), {
    type: "doughnut",
    data: { labels: cats.map((c) => c[0]), datasets: [{ data: cats.map((c) => round2(c[1])), backgroundColor: palette, borderWidth: 0 }] },
    options: {
      maintainAspectRatio: false,
      plugins: {
        legend: { position: innerWidth < 600 ? "bottom" : "right", labels: { boxWidth: 12, font: { size: 11 } } },
        tooltip: { callbacks: { label: (c) => `${c.label}: ${money(c.raw)}` } },
      },
    },
  });

  renderShipmentProfit();
}

function shipmentTotals(id) {
  return totals(state.transactions.filter((t) => t.shipment_id === id));
}

function renderShipmentProfit() {
  const box = $("#shipment-profit-list");
  if (!state.shipments.length) {
    box.innerHTML = `<p class="muted">No shipments yet. Add one in the Shipments tab, then link costs and sales to it.</p>`;
    return;
  }
  const rows = state.shipments
    .map((s) => ({ s, t: shipmentTotals(s.id) }))
    .sort((a, b) => (b.s.order_date || b.s.created_at || "").localeCompare(a.s.order_date || a.s.created_at || ""))
    .slice(0, 8);
  box.innerHTML = rows
    .map(({ s, t }) => `<div class="mini-row"><span>${esc(s.name)}</span><b class="${t.profit >= 0 ? "pos" : "neg"}">${money(t.profit)}</b></div>`)
    .join("");
}

$("#period").onchange = renderDashboard;

// ---------- records ----------

function fillFilterOptions() {
  const catSel = $("#f-category");
  const keep = catSel.value;
  catSel.innerHTML = `<option value="">All categories</option>` +
    [...CATEGORIES.expense, ...CATEGORIES.income].map((c) => `<option>${esc(c)}</option>`).join("");
  catSel.value = keep;

  const shipOpts = state.shipments.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join("");
  const fs = $("#f-shipment");
  const keepS = fs.value;
  fs.innerHTML = `<option value="">All shipments</option><option value="none">Not linked to a shipment</option>` + shipOpts;
  fs.value = keepS;

  const clients = [...new Set(state.transactions.map((t) => t.client).filter(Boolean))].sort();
  $("#client-list").innerHTML = clients.map((c) => `<option value="${esc(c)}">`).join("");
}

function filteredRecords() {
  const q = $("#f-search").value.trim().toLowerCase();
  const type = $("#f-type").value;
  const cat = $("#f-category").value;
  const ship = $("#f-shipment").value;
  const month = $("#f-month").value;
  return state.transactions
    .filter((t) =>
      (!type || t.type === type) &&
      (!cat || t.category === cat) &&
      (!ship || (ship === "none" ? !t.shipment_id : t.shipment_id === ship)) &&
      (!month || t.date.startsWith(month)) &&
      (!q || [t.description, t.client, t.category].some((v) => (v || "").toLowerCase().includes(q))))
    .sort((a, b) => b.date.localeCompare(a.date) || (b.created_at || "").localeCompare(a.created_at || ""));
}

// A sale is saved as two records (cost + amount paid) with the same date,
// description, customer and shipment. The table shows them on one row.
function groupRecords(list) {
  const groups = new Map();
  for (const t of list) {
    const key = t.description
      ? [t.date, t.description.trim().toLowerCase(), (t.client || "").trim().toLowerCase(), t.shipment_id || ""].join("|")
      : "single|" + t.id;
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { date: t.date, description: t.description, client: t.client, shipment_id: t.shipment_id, cost: 0, paid: 0, records: [] }));
    g.records.push(t);
    if (t.type === "income") g.paid += t.amount_ghs;
    else g.cost += t.amount_ghs;
  }
  return [...groups.values()].map((g) => ({ ...g, cost: round2(g.cost), paid: round2(g.paid), profit: round2(g.paid - g.cost) }));
}

const isSale = (g) => g.records.length === 2 && g.records.some((r) => r.type === "income") && g.records.some((r) => r.type === "expense");
const marginText = (g) => (g.paid && g.cost ? Math.round((g.profit / g.paid) * 100) + "%" : "—");

let recordsPage = 1;

function renderRecords() {
  const allRows = groupRecords(filteredRecords());
  const size = Number($("#page-size").value) || allRows.length || 1;
  const pages = Math.max(1, Math.ceil(allRows.length / size));
  recordsPage = Math.min(Math.max(1, recordsPage), pages);
  const start = (recordsPage - 1) * size;
  const rows = allRows.slice(start, start + size);
  $("#page-info").textContent = allRows.length
    ? `Showing ${start + 1}–${start + rows.length} of ${allRows.length}${pages > 1 ? ` · Page ${recordsPage} of ${pages}` : ""}`
    : "";
  $("#page-prev").disabled = recordsPage <= 1;
  $("#page-next").disabled = recordsPage >= pages;
  const k = totals(filteredRecords());
  $("#records-summary").innerHTML = `
    <div class="card"><span>Cost</span><b class="neg">${money(k.expense)}</b></div>
    <div class="card"><span>Paid</span><b class="pos">${money(k.income)}</b></div>
    <div class="card"><span>Profit</span><b class="${k.profit >= 0 ? "pos" : "neg"}">${money(k.profit)}</b></div>
    <div class="card"><span>Margin</span><b>${k.income ? Math.round((k.profit / k.income) * 100) + "%" : "—"}</b></div>`;
  const shipName = Object.fromEntries(state.shipments.map((s) => [s.id, s.name]));
  const body = $("#records-body");
  if (!state.transactions.length) {
    body.innerHTML = `<tr><td colspan="7" class="empty">No records yet. Tap <b>+ Add record</b> to log your first sale or expense.</td></tr>`;
    $("#records-foot").innerHTML = "";
    return;
  }
  const amt = (v) => (v ? fmt.format(v) : `<span class="dash">—</span>`);
  body.innerHTML = rows.map((g, i) => {
    const first = g.records[0];
    const label = isSale(g) || g.records.length > 1 || !g.description ? "" : first.category;
    const sub = [label, shipName[g.shipment_id]].filter(Boolean).map(esc).join(" · ");
    return `<tr data-i="${i}">
      <td class="date">${esc(fmtDate(g.date))}</td>
      <td class="col-item">${esc(g.description || first.category)}${sub ? `<small>${sub}</small>` : ""}</td>
      <td>${esc(g.client || "")}</td>
      <td class="num">${amt(g.cost)}</td>
      <td class="num">${amt(g.paid)}</td>
      <td class="num ${g.profit >= 0 ? "pos" : "neg"}">${fmt.format(g.profit)}</td>
      <td class="num">${marginText(g)}</td>
    </tr>`;
  }).join("") || `<tr><td colspan="7" class="empty">No records match these filters.</td></tr>`;
  $("#records-foot").innerHTML = rows.length
    ? `<tr><td colspan="3">Total (all ${allRows.length} row${allRows.length === 1 ? "" : "s"})</td>
        <td class="num">${fmt.format(k.expense)}</td><td class="num">${fmt.format(k.income)}</td>
        <td class="num ${k.profit >= 0 ? "pos" : "neg"}">${fmt.format(k.profit)}</td>
        <td class="num">${k.income ? Math.round((k.profit / k.income) * 100) + "%" : "—"}</td></tr>`
    : "";
  body.querySelectorAll("tr[data-i]").forEach((tr) => (tr.onclick = () => {
    const g = rows[tr.dataset.i];
    if (isSale(g)) openSale(g);
    else openRecord(g.records[0]);
  }));
}

["#f-search", "#f-type", "#f-category", "#f-shipment", "#f-month"].forEach((s) => ($(s).oninput = () => {
  recordsPage = 1;
  renderRecords();
}));

$("#page-size").value = String(Settings.get("pageSize", 10));
$("#page-size").onchange = () => {
  Settings.set("pageSize", Number($("#page-size").value));
  recordsPage = 1;
  renderRecords();
};
const goToPage = (delta) => {
  recordsPage += delta;
  renderRecords();
  $(".table-wrap").scrollIntoView({ block: "start", behavior: "smooth" });
};
$("#page-prev").onclick = () => goToPage(-1);
$("#page-next").onclick = () => goToPage(1);

$("#export-csv").onclick = () => {
  const shipName = Object.fromEntries(state.shipments.map((s) => [s.id, s.name]));
  const head = ["Date", "Item", "Customer", "Shipment", "Category", "Cost (GHS)", "Paid (GHS)", "Profit (GHS)", "Margin"];
  const rows = groupRecords(filteredRecords()).map((g) => [
    g.date, g.description || g.records[0].category, g.client, shipName[g.shipment_id] || "",
    isSale(g) ? "Sale" : g.records.map((r) => r.category).join(" / "), g.cost, g.paid, g.profit, marginText(g),
  ]);
  const csv = [head, ...rows].map((r) => r.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",")).join("\r\n");
  download(`yako-records-${today()}.csv`, "﻿" + csv, "text/csv");
};

function download(name, text, type) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---------- record dialog ----------

const recDialog = $("#record-dialog");
const recForm = $("#record-form");
let editingRecord = null;
let editingSale = null; // { income, expense } when editing a sale

function setCategoryOptions(type, selected) {
  const sel = recForm.category;
  if (type === "sale") return;
  sel.innerHTML = CATEGORIES[type].map((c) => `<option>${esc(c)}</option>`).join("");
  if (selected && !CATEGORIES[type].includes(selected)) sel.insertAdjacentHTML("beforeend", `<option>${esc(selected)}</option>`);
  if (selected) sel.value = selected;
}

const formType = () => recForm.querySelector("input[name=type]:checked").value;

function setType(type, category) {
  recForm.querySelector(`input[name=type][value=${type}]`).checked = true;
  const sale = type === "sale";
  $("#category-row").hidden = sale;
  $("#paid-row").hidden = !sale;
  $("#profit-preview").hidden = !sale;
  $("#amount-label").textContent = sale ? "Cost of the item(s)" : "Amount";
  recForm.description.required = sale;
  recForm.description.placeholder = sale ? "e.g. P-0034 · Smart Watch ×2" : "e.g. Freight for October container";
  setCategoryOptions(type, category);
  updateRatePreview();
}

function updateRatePreview() {
  const cur = recForm.currency.value;
  $("#rate-row").hidden = cur === "GHS";
  const amount = Number(recForm.amount.value) || 0;
  const rate = cur === "GHS" ? 1 : Number(recForm.rate.value) || 0;
  $("#ghs-preview").textContent = cur === "GHS" || !amount ? "" : `= ${money(amount * rate)}`;
  if (formType() === "sale") {
    const cost = amount * rate;
    const paid = Number(recForm.paid.value) || 0;
    const profit = paid - cost;
    $("#profit-preview").innerHTML = paid || cost
      ? `Profit: <b class="${profit >= 0 ? "pos" : "neg"}">${money(profit)}</b>${paid ? ` (${Math.round((profit / paid) * 100)}% margin)` : ""}`
      : "";
  }
}

function fillShipments(selected) {
  recForm.shipment_id.innerHTML = `<option value="">— None —</option>` +
    state.shipments.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join("");
  recForm.shipment_id.value = selected || "";
}

function openRecord(rec, defaults = {}) {
  editingRecord = rec || null;
  editingSale = null;
  recForm.reset();
  $("#record-msg").textContent = "";
  $("#record-title").textContent = rec ? "Edit record" : "Add record";
  $("#record-delete").hidden = !rec;
  const r = rec || { type: "sale", date: today(), currency: "GHS", ...defaults };
  recForm.date.value = r.date;
  recForm.description.value = r.description || "";
  recForm.amount.value = r.amount ?? "";
  recForm.currency.value = r.currency || "GHS";
  recForm.rate.value = r.currency && r.currency !== "GHS" ? r.rate : "";
  recForm.client.value = r.client || "";
  fillShipments(r.shipment_id);
  setType(r.type, r.category);
  recDialog.showModal();
}

function openSale(g) {
  const income = g.records.find((r) => r.type === "income");
  const expense = g.records.find((r) => r.type === "expense");
  openRecord(expense);
  editingRecord = null;
  editingSale = { income, expense };
  $("#record-title").textContent = "Edit sale";
  setType("sale");
  recForm.paid.value = income.amount_ghs;
  updateRatePreview();
}

recForm.querySelectorAll("input[name=type]").forEach((el) => (el.onchange = () => setType(el.value)));
recForm.currency.onchange = () => {
  const cur = recForm.currency.value;
  if (cur !== "GHS") recForm.rate.value = rates()[cur] || "";
  updateRatePreview();
};
recForm.amount.oninput = updateRatePreview;
recForm.rate.oninput = updateRatePreview;
recForm.paid.oninput = updateRatePreview;

recForm.onsubmit = async (e) => {
  e.preventDefault();
  const f = recForm;
  const type = formType();
  const currency = f.currency.value;
  const amount = round2(f.amount.value);
  const rate = currency === "GHS" ? 1 : Number(f.rate.value);
  if (currency !== "GHS" && !(rate > 0)) {
    $("#record-msg").textContent = "Please enter the exchange rate.";
    return;
  }
  const shared = {
    date: f.date.value,
    description: f.description.value.trim() || null,
    client: f.client.value.trim() || null,
    shipment_id: f.shipment_id.value || null,
  };
  const costRow = { ...shared, amount, currency, rate, amount_ghs: round2(amount * rate) };
  try {
    if (type === "sale") {
      const paid = round2(f.paid.value);
      const expenseRow = { ...costRow, type: "expense", category: editingSale?.expense.category || "Goods purchase (supplier)" };
      const incomeRow = { ...shared, type: "income", category: editingSale?.income.category || "Product sales", amount: paid, currency: "GHS", rate: 1, amount_ghs: paid };
      if (editingSale) {
        await Store.update("transactions", editingSale.expense.id, expenseRow);
        await Store.update("transactions", editingSale.income.id, incomeRow);
      } else {
        if (editingRecord) await Store.remove("transactions", editingRecord.id); // record turned into a sale
        await Store.insert("transactions", expenseRow);
        await Store.insert("transactions", incomeRow);
      }
    } else {
      const row = { ...costRow, type, category: f.category.value };
      if (editingSale) {
        // sale turned into a single record
        await Store.update("transactions", editingSale.expense.id, row);
        await Store.remove("transactions", editingSale.income.id);
      } else if (editingRecord) await Store.update("transactions", editingRecord.id, row);
      else await Store.insert("transactions", row);
    }
    recDialog.close();
    toast("Saved");
    await reload();
  } catch (err) {
    $("#record-msg").textContent = "Could not save: " + err.message;
  }
};

$("#record-delete").onclick = async () => {
  const ids = editingSale ? [editingSale.expense.id, editingSale.income.id] : editingRecord ? [editingRecord.id] : [];
  if (!ids.length || !confirm(editingSale ? "Delete this sale (its cost and payment)?" : "Delete this record?")) return;
  try {
    for (const id of ids) await Store.remove("transactions", id);
    recDialog.close();
    toast("Deleted");
    await reload();
  } catch (err) {
    $("#record-msg").textContent = "Could not delete: " + err.message;
  }
};

$("#add-record-top").onclick = () => openRecord(null);
$$("[data-close]").forEach((b) => (b.onclick = () => b.closest("dialog").close()));

// ---------- shipments ----------

function renderShipments() {
  const box = $("#shipments-list");
  if (!state.shipments.length) {
    box.innerHTML = `<div class="empty">No shipments yet.<br>Create one for each container or order from China.</div>`;
    return;
  }
  const sorted = [...state.shipments].sort((a, b) => (b.order_date || b.created_at || "").localeCompare(a.order_date || a.created_at || ""));
  box.innerHTML = sorted.map((s) => {
    const t = shipmentTotals(s.id);
    const margin = t.income ? Math.round((t.profit / t.income) * 100) + "%" : "—";
    const sub = [s.supplier, s.forwarder, s.order_date && "Ordered " + fmtDate(s.order_date), s.arrival_date && "Arrived " + fmtDate(s.arrival_date)].filter(Boolean).map(esc).join(" · ");
    return `<div class="item" data-id="${s.id}">
      <div class="main">
        <div class="title">${esc(s.name)}<span class="pill">${esc(s.status)}</span></div>
        <div class="sub">${sub}</div>
        <div class="ship-stats">
          <span>Cost <b>${money(t.expense)}</b></span>
          <span>Sales <b>${money(t.income)}</b></span>
          <span>Margin <b>${margin}</b></span>
        </div>
      </div>
      <div class="amt ${t.profit >= 0 ? "pos" : "neg"}">${money(t.profit)}<small>profit</small>
        <button class="btn small" data-add="${s.id}" style="margin-top:.4rem">+ Record</button>
      </div>
    </div>`;
  }).join("");
  box.querySelectorAll(".item").forEach((el) => (el.onclick = (e) => {
    const addId = e.target.dataset?.add;
    if (addId) return openRecord(null, { shipment_id: addId });
    openShipment(state.shipments.find((s) => s.id === el.dataset.id));
  }));
}

const shipDialog = $("#shipment-dialog");
const shipForm = $("#shipment-form");
let editingShipment = null;

function openShipment(s) {
  editingShipment = s || null;
  shipForm.reset();
  $("#shipment-msg").textContent = "";
  $("#shipment-title").textContent = s ? "Edit shipment" : "New shipment";
  $("#shipment-delete").hidden = !s;
  if (s) for (const k of ["name", "supplier", "forwarder", "order_date", "arrival_date", "status", "notes"]) shipForm[k].value = s[k] || (k === "status" ? "Ordered" : "");
  else shipForm.order_date.value = today();
  shipDialog.showModal();
}

$("#add-shipment").onclick = () => openShipment(null);

shipForm.onsubmit = async (e) => {
  e.preventDefault();
  const f = shipForm;
  const row = {
    name: f.name.value.trim(),
    supplier: f.supplier.value.trim() || null,
    forwarder: f.forwarder.value.trim() || null,
    order_date: f.order_date.value || null,
    arrival_date: f.arrival_date.value || null,
    status: f.status.value,
    notes: f.notes.value.trim() || null,
  };
  try {
    if (editingShipment) await Store.update("shipments", editingShipment.id, row);
    else await Store.insert("shipments", row);
    shipDialog.close();
    toast("Shipment saved");
    await reload();
  } catch (err) {
    $("#shipment-msg").textContent = "Could not save: " + err.message;
  }
};

$("#shipment-delete").onclick = async () => {
  if (!editingShipment) return;
  if (!confirm("Delete this shipment? Its records are kept but will no longer be linked to it.")) return;
  try {
    await Store.remove("shipments", editingShipment.id);
    shipDialog.close();
    toast("Shipment deleted");
    await reload();
  } catch (err) {
    $("#shipment-msg").textContent = "Could not delete: " + err.message;
  }
};

// ---------- settings ----------

function renderSettings() {
  const r = rates();
  $("#rate-usd").value = r.USD;
  $("#rate-rmb").value = r.RMB;
  const cfg = cloudConfig();
  $("#storage-info").textContent = Store.mode === "cloud"
    ? "Your records are saved in your Google Sheet. Open this app on any phone or computer with the same passcode to see them, or open the sheet itself in Google Drive."
    : "Your records are saved only in this browser on this device. Connect a Google Sheet below to keep them safe and use them on other devices.";
  const saved = Settings.get("cloud", null);
  $("#cloud-url").value = saved?.url || cfg?.url || "";
  $("#cloud-key").value = Settings.get("passcode", "");
  $("#account-panel").hidden = Store.mode !== "cloud";

  const localCount = LocalStore.read("transactions").length + LocalStore.read("shipments").length;
  $("#import-local-box").hidden = !(Store.mode === "cloud" && localCount);
  $("#local-count").textContent = localCount;
}

$("#rates-form").onsubmit = (e) => {
  e.preventDefault();
  Settings.set("rates", { USD: Number($("#rate-usd").value) || 0, RMB: Number($("#rate-rmb").value) || 0 });
  toast("Rates saved");
};

$("#cloud-form").onsubmit = (e) => {
  e.preventDefault();
  const url = $("#cloud-url").value.trim().replace(/\/+$/, "");
  const passcode = $("#cloud-key").value.trim();
  if (!url || !passcode) return toast("Enter both the Web app URL and the passcode");
  Settings.set("cloud", { url });
  Settings.set("passcode", passcode);
  location.reload();
};

$("#cloud-clear").onclick = () => {
  if (!confirm("Switch to keeping data on this device only? Your records stay safe in the Google Sheet.")) return;
  Settings.set("cloud", null);
  if (window.YAKO_CONFIG?.sheetUrl) Settings.set("forceLocal", true);
  location.reload();
};

$("#import-local").onclick = async () => {
  if (!confirm("Copy the records saved on this device into the Google Sheet?")) return;
  try {
    await importData({ shipments: LocalStore.read("shipments"), transactions: LocalStore.read("transactions") });
    LocalStore.write("shipments", []);
    LocalStore.write("transactions", []);
    toast("Copied to the Google Sheet");
    await reload();
    renderSettings();
  } catch (err) {
    alert("Copy failed: " + err.message);
  }
};

// Insert shipments + transactions, keeping the links between them.
async function importData({ shipments = [], transactions = [] }) {
  const insertMany = Store.insertMany
    ? (table, rows) => Store.insertMany(table, rows)
    : (table, rows) => Promise.all(rows.map((r) => Store.insert(table, r)));
  const strip = ({ id, user_id, created_at, shipment_name, ...rest }) => rest;
  const idMap = {};
  const newShips = await insertMany("shipments", shipments.map(strip));
  shipments.forEach((s, i) => (idMap[s.id] = newShips[i].id));
  await insertMany("transactions", transactions.map((t) => {
    const rest = strip(t);
    rest.shipment_id = rest.shipment_id ? idMap[rest.shipment_id] || null : null;
    return rest;
  }));
}

$("#backup-download").onclick = () => {
  const data = { app: "yako-tracker", exported_at: new Date().toISOString(), shipments: state.shipments, transactions: state.transactions };
  download(`yako-backup-${today()}.json`, JSON.stringify(data, null, 2), "application/json");
};

$("#backup-restore").onchange = async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (data.app !== "yako-tracker") throw new Error("This is not a Yako tracker backup file.");
    if (!confirm(`Add ${data.transactions.length} records and ${data.shipments.length} shipments from this backup? (Existing records are kept.)`)) return;
    await importData(data);
    toast("Backup restored");
    await reload();
  } catch (err) {
    alert("Restore failed: " + err.message);
  }
};

$("#sign-out").onclick = () => {
  Settings.set("passcode", "");
  location.reload();
};

// config.js values are ignored when the user chose "this device only"
if (Settings.get("forceLocal", false) && !Settings.get("cloud", null)) window.YAKO_CONFIG = {};
if (Settings.get("cloud", null)) Settings.set("forceLocal", false);

start();
