"use strict";

/* ---------- finance helpers ---------- */

// Monthly EMI that amortizes `principal` over `n` months at monthly rate `r`.
function emi(principal, r, n) {
  if (principal <= 0 || n <= 0) return 0;
  if (r === 0) return principal / n;
  const f = Math.pow(1 + r, n);
  return (principal * r * f) / (f - 1);
}

// Number of months to clear `principal` at monthly rate `r` paying `pay` per month.
// Returns Infinity if the payment never covers the interest.
function monthsToClear(principal, r, pay) {
  if (principal <= 0) return 0;
  if (r === 0) return Math.ceil(principal / pay);
  if (pay <= principal * r) return Infinity; // payment doesn't even cover interest
  const n = Math.log(pay / (pay - principal * r)) / Math.log(1 + r);
  return Math.ceil(n);
}

function toMonths(value, unit) {
  return unit === "years" ? value * 12 : value;
}

/* ---------- formatting ---------- */

const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});
const money = (v) => (isFinite(v) ? inr.format(Math.round(v)) : "—");

// Compact ₹ label for chart axes: ₹1.2 Cr, ₹45 L, ₹12k.
function moneyShort(v) {
  if (!isFinite(v)) return "—";
  const s = v < 0 ? "-" : "";
  v = Math.abs(v);
  if (v >= 1e7) return `${s}₹${(v / 1e7).toFixed(v >= 1e8 ? 0 : 1)} Cr`;
  if (v >= 1e5) return `${s}₹${(v / 1e5).toFixed(v >= 1e6 ? 0 : 1)} L`;
  if (v >= 1e3) return `${s}₹${Math.round(v / 1e3)}k`;
  return `${s}₹${Math.round(v)}`;
}

function monthsLabel(m) {
  if (!isFinite(m)) return "never";
  m = Math.round(m);
  const y = Math.floor(m / 12);
  const mm = m % 12;
  if (y && mm) return `${y}y ${mm}m`;
  if (y) return `${y}y`;
  return `${mm}m`;
}

/* ---------- state ---------- */

const LS_KEY = "finplan.v2";
let strategy = "emi"; // "emi" (lower EMI) | "tenure" (shorter tenure)
let gran = "month"; // depletion table granularity: "month" | "year"
let drawMode = "proportional"; // asset drawdown: "proportional" | "priority" (list order)
let loans = [];
let assets = [];
let liabilities = [];
// loan = { id, name, principal, roi, term, termUnit, outstanding, outTenure,
//          outTenureUnit, options: [amount…], active: index }
// asset = { id, name, balance, growth (annual %), contribution (monthly) }
// liability = { id, name, amount, payment (monthly, optional) }

function blankLoan() {
  return {
    id: crypto.randomUUID(),
    name: "",
    principal: "",
    roi: "",
    term: "",
    termUnit: "years",
    outstanding: "",
    outTenure: "",
    outTenureUnit: "months",
    options: ["", "", ""],
    active: 0,
  };
}

function blankAsset() {
  return { id: crypto.randomUUID(), name: "", balance: "", growth: "", contribution: "" };
}

function blankLiability() {
  return { id: crypto.randomUUID(), name: "", amount: "", payment: "" };
}

function save() {
  localStorage.setItem(LS_KEY, JSON.stringify({ strategy, gran, drawMode, loans, assets, liabilities }));
}

function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(LS_KEY) || "null");
    if (raw && Array.isArray(raw.loans)) {
      loans = raw.loans.map((l) => ({
        options: ["", "", ""],
        active: 0,
        ...l,
        options: Array.isArray(l.options) && l.options.length ? l.options : ["", "", ""],
      }));
      strategy = raw.strategy === "tenure" ? "tenure" : "emi";
      gran = raw.gran === "year" ? "year" : "month";
      drawMode = raw.drawMode === "priority" ? "priority" : "proportional";
      if (Array.isArray(raw.assets)) assets = raw.assets;
      if (Array.isArray(raw.liabilities)) liabilities = raw.liabilities;
    }
  } catch (_) {}
  if (!loans.length) loans = [blankLoan()];
}

/* ---------- named plans + backup ---------- */

const PLANS_KEY = "finplan.plans.v1";
let plans = {}; // { name: stateSnapshot }
let currentPlan = null;

// A deep copy of the current working state.
function snapshot() {
  return JSON.parse(JSON.stringify({ strategy, gran, drawMode, loans, assets, liabilities }));
}

// Normalise + load a state object into the working copy and re-render everything.
function applyState(st) {
  strategy = st.strategy === "tenure" ? "tenure" : "emi";
  gran = st.gran === "year" ? "year" : "month";
  drawMode = st.drawMode === "priority" ? "priority" : "proportional";
  loans = (Array.isArray(st.loans) && st.loans.length ? st.loans : [blankLoan()]).map((l) => ({
    options: ["", "", ""],
    active: 0,
    ...l,
    options: Array.isArray(l.options) && l.options.length ? l.options : ["", "", ""],
  }));
  assets = Array.isArray(st.assets) ? st.assets : [];
  liabilities = Array.isArray(st.liabilities) ? st.liabilities : [];
  syncToggles();
  renderAssets();
  renderLiabilities();
  renderAll();
  save();
}

function syncToggles() {
  document
    .querySelectorAll("#granularity .seg")
    .forEach((x) => x.classList.toggle("active", x.dataset.gran === gran));
  document
    .querySelectorAll("#drawmode .seg")
    .forEach((x) => x.classList.toggle("active", x.dataset.draw === drawMode));
  // strategy segments are synced inside renderAll()
}

function loadPlans() {
  try {
    const raw = JSON.parse(localStorage.getItem(PLANS_KEY) || "null");
    if (raw && raw.plans && typeof raw.plans === "object") {
      plans = raw.plans;
      currentPlan = raw.current && plans[raw.current] ? raw.current : null;
    }
  } catch (_) {}
}

function savePlans() {
  localStorage.setItem(PLANS_KEY, JSON.stringify({ plans, current: currentPlan }));
}

function refreshPlanSelect() {
  const sel = document.getElementById("planSelect");
  const names = Object.keys(plans).sort((a, b) => a.localeCompare(b));
  let opts = `<option value="__working__">— working copy —</option>`;
  names.forEach((n) => {
    opts += `<option value="${esc(n)}"${n === currentPlan ? " selected" : ""}>${esc(n)}</option>`;
  });
  sel.innerHTML = opts;
  sel.value = currentPlan || "__working__";
  document.getElementById("planDelete").disabled = !currentPlan;
}

let toastEl = null, toastTimer = null;
function flash(msg) {
  if (!toastEl) {
    toastEl = document.createElement("div");
    toastEl.className = "toast";
    document.body.appendChild(toastEl);
  }
  toastEl.textContent = msg;
  toastEl.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove("show"), 2200);
}

/* ---------- computation ---------- */

// Base numbers for a loan, or null if the minimum inputs are missing.
function computeBase(l) {
  const roi = parseFloat(l.roi);
  const outstanding = parseFloat(l.outstanding);
  const outTenureM = toMonths(parseFloat(l.outTenure), l.outTenureUnit);
  if (
    !isFinite(roi) ||
    !isFinite(outstanding) || outstanding <= 0 ||
    !isFinite(outTenureM) || outTenureM <= 0
  ) {
    return null;
  }
  const r = roi / 100 / 12;
  const currentEMI = emi(outstanding, r, outTenureM);
  const currentFutureInterest = currentEMI * outTenureM - outstanding;

  const principal = parseFloat(l.principal);
  const termM = toMonths(parseFloat(l.term), l.termUnit);
  const originalEMI =
    isFinite(principal) && principal > 0 && isFinite(termM) && termM > 0
      ? emi(principal, r, termM)
      : null;

  return { r, outstanding, outTenureM, currentEMI, currentFutureInterest, originalEMI };
}

// Effect of prepaying `prepay` on top of `base`, under the active strategy.
function computeScenario(base, prepay) {
  const newOutstanding = Math.max(0, base.outstanding - prepay);
  const s = { prepay, newOutstanding };

  if (strategy === "emi") {
    const newEMI = emi(newOutstanding, base.r, base.outTenureM);
    s.newEMI = newEMI;
    s.newTenureM = base.outTenureM;
    s.monthlySaving = base.currentEMI - newEMI;
    s.interestSaved = base.currentFutureInterest - (newEMI * base.outTenureM - newOutstanding);
  } else {
    const newTenureM = monthsToClear(newOutstanding, base.r, base.currentEMI);
    s.newEMI = base.currentEMI;
    s.newTenureM = newTenureM;
    s.monthsSaved = isFinite(newTenureM) ? base.outTenureM - newTenureM : 0;
    const newFutureInterest = isFinite(newTenureM)
      ? base.currentEMI * newTenureM - newOutstanding
      : Infinity;
    s.interestSaved = isFinite(newFutureInterest)
      ? base.currentFutureInterest - newFutureInterest
      : 0;
  }
  return s;
}

// Parsed, positive prepayment amounts with their option index.
function loanOptions(l) {
  return l.options
    .map((v, i) => ({ i, amount: parseFloat(v) }))
    .filter((o) => isFinite(o.amount) && o.amount > 0);
}

function activeScenario(l, base) {
  const opts = loanOptions(l);
  if (!opts.length) return null;
  const chosen = opts.find((o) => o.i === l.active) || opts[0];
  return computeScenario(base, chosen.amount);
}

/* ---------- rendering ---------- */

const loansEl = document.getElementById("loans");
const tpl = document.getElementById("loanTemplate");

function statBlock(k, v, cls = "") {
  return `<div class="stat ${cls}"><div class="k">${k}</div><div class="v">${v}</div></div>`;
}

/* per-loan comparison table across all prepayment options */
function loanTable(l, base) {
  const opts = loanOptions(l);
  if (!opts.length) return "";

  const emiMode = strategy === "emi";
  const head = emiMode
    ? `<tr><th>Scenario</th><th>Prepayment</th><th>New EMI</th><th>Monthly saving</th><th>Interest saved</th></tr>`
    : `<tr><th>Scenario</th><th>Prepayment</th><th>New tenure</th><th>Months saved</th><th>Interest saved</th></tr>`;

  // baseline row (no prepayment)
  let rows = emiMode
    ? `<tr class="base"><td>No prepayment</td><td>—</td><td>${money(base.currentEMI)}</td><td>—</td><td>—</td></tr>`
    : `<tr class="base"><td>No prepayment</td><td>—</td><td>${monthsLabel(base.outTenureM)}</td><td>—</td><td>—</td></tr>`;

  opts.forEach((o) => {
    const s = computeScenario(base, o.amount);
    const active = o.i === l.active ? " active-row" : "";
    if (emiMode) {
      rows += `<tr class="opt-row${active}"><td>Option ${o.i + 1}</td><td>${money(o.amount)}</td><td>${money(s.newEMI)}</td><td class="good">${money(s.monthlySaving)}</td><td class="good">${money(s.interestSaved)}</td></tr>`;
    } else {
      rows += `<tr class="opt-row${active}"><td>Option ${o.i + 1}</td><td>${money(o.amount)}</td><td class="good">${monthsLabel(s.newTenureM)}</td><td class="good">${monthsLabel(s.monthsSaved)}</td><td class="good">${money(s.interestSaved)}</td></tr>`;
    }
  });

  return `<div class="tbl-title">Compare options — ${emiMode ? "lower EMI" : "shorter tenure"}</div><div class="table-wrap"><table class="calc"><thead>${head}</thead><tbody>${rows}</tbody></table></div>`;
}

function renderResults(node, l) {
  const box = node.querySelector(".loan-results");
  const base = computeBase(l);
  if (!base) {
    box.innerHTML = `<div class="res-note">Enter <b>outstanding principal</b>, <b>ROI</b> and <b>outstanding tenure</b> to see results.</div>`;
    return;
  }

  const s = activeScenario(l, base);
  let grid = statBlock("Current EMI", money(base.currentEMI));

  if (!s) {
    grid += statBlock("Outstanding", money(base.outstanding));
    grid += statBlock("Tenure left", monthsLabel(base.outTenureM));
    grid += statBlock("Future interest", money(base.currentFutureInterest), "hi");
  } else if (strategy === "emi") {
    grid += statBlock("New EMI (active)", money(s.newEMI), "good");
    grid += statBlock("Monthly saving", money(s.monthlySaving), "good");
    grid += statBlock("Interest saved", money(s.interestSaved), "good");
  } else {
    grid += statBlock("EMI (unchanged)", money(s.newEMI));
    grid += statBlock("New tenure (active)", monthsLabel(s.newTenureM), "good");
    grid += statBlock("Interest saved", money(s.interestSaved), "good");
  }

  const note = s
    ? `Radio-select which option is your <b>active</b> plan — it feeds the portfolio totals below.`
    : (base.originalEMI
        ? `Original EMI on ${money(parseFloat(l.principal))} was <b>${money(base.originalEMI)}</b>. Add a prepayment option to model savings.`
        : `Add a <b>prepayment option</b> to model savings.`);

  box.innerHTML =
    `<div class="res-grid">${grid}</div>` +
    `<div class="res-note">${note}</div>` +
    loanTable(l, base);
}

function renderOptions(node, l) {
  const wrap = node.querySelector(".prepay-options");
  wrap.innerHTML = "";
  l.options.forEach((val, i) => {
    const opt = document.createElement("div");
    opt.className = "opt" + (i === l.active ? " active" : "");
    opt.innerHTML =
      `<input type="radio" name="active-${l.id}" title="Set as active plan" ${i === l.active ? "checked" : ""} />` +
      `<span class="opt-label">Opt ${i + 1}</span>` +
      `<input type="number" min="0" step="1000" inputmode="decimal" placeholder="amount" />` +
      (l.options.length > 1 ? `<button class="opt-remove" title="Remove option">✕</button>` : "");

    opt.querySelector('input[type="radio"]').addEventListener("change", () => {
      l.active = i;
      rerenderLoan(node, l);
      renderSummary();
      save();
    });
    const num = opt.querySelector('input[type="number"]');
    num.value = val ?? "";
    num.addEventListener("input", () => {
      l.options[i] = num.value;
      renderResults(node, l);
      renderSummary();
      save();
    });
    const rm = opt.querySelector(".opt-remove");
    if (rm) {
      rm.addEventListener("click", () => {
        l.options.splice(i, 1);
        if (l.active >= l.options.length) l.active = 0;
        rerenderLoan(node, l);
        renderSummary();
        save();
      });
    }
    wrap.appendChild(opt);
  });
}

// re-render the mutable parts of an existing loan node (options + results)
function rerenderLoan(node, l) {
  renderOptions(node, l);
  renderResults(node, l);
}

function renderLoan(l) {
  const node = tpl.content.firstElementChild.cloneNode(true);
  node.dataset.id = l.id;

  const bind = (sel, key) => {
    const el = node.querySelector(sel);
    el.value = l[key] ?? "";
    el.addEventListener("input", () => {
      l[key] = el.value;
      renderResults(node, l);
      renderSummary();
      save();
    });
  };

  bind(".loan-name", "name");
  bind(".f-principal", "principal");
  bind(".f-roi", "roi");
  bind(".f-term", "term");
  bind(".f-term-unit", "termUnit");
  bind(".f-outstanding", "outstanding");
  bind(".f-outtenure", "outTenure");
  bind(".f-outtenure-unit", "outTenureUnit");

  node.querySelector(".add-option").addEventListener("click", () => {
    l.options.push("");
    rerenderLoan(node, l);
    save();
  });

  node.querySelector(".remove").addEventListener("click", () => {
    loans = loans.filter((x) => x.id !== l.id);
    if (!loans.length) loans = [blankLoan()];
    renderAll();
    save();
  });

  renderOptions(node, l);
  renderResults(node, l);
  return node;
}

function renderAll() {
  loansEl.innerHTML = "";
  loans.forEach((l) => loansEl.appendChild(renderLoan(l)));
  document.querySelectorAll(".seg[data-strategy]").forEach((b) =>
    b.classList.toggle("active", b.dataset.strategy === strategy)
  );
  renderSummary();
}

function renderSummary() {
  const grid = document.getElementById("summaryGrid");
  const tableWrap = document.getElementById("portfolioTable");

  const rows = loans
    .map((l) => {
      const base = computeBase(l);
      if (!base) return null;
      return { l, base, s: activeScenario(l, base) };
    })
    .filter(Boolean);

  if (!rows.length) {
    grid.innerHTML = `<div class="empty">Fill in at least one loan to see your portfolio totals.</div>`;
    tableWrap.innerHTML = "";
    renderDepletion();
    return;
  }

  let totalOutstanding = 0,
    totalCurrentEMI = 0,
    totalPrepay = 0,
    totalNewEMI = 0,
    totalMonthlySaving = 0,
    totalInterestSaved = 0;

  rows.forEach(({ base, s }) => {
    totalOutstanding += base.outstanding;
    totalCurrentEMI += base.currentEMI;
    totalPrepay += s ? s.prepay : 0;
    totalNewEMI += s ? s.newEMI : base.currentEMI;
    if (s && strategy === "emi") totalMonthlySaving += s.monthlySaving;
    totalInterestSaved += s ? s.interestSaved : 0;
  });

  let cells = "";
  cells += statBlock("Loans", String(rows.length));
  cells += statBlock("Total outstanding", money(totalOutstanding));
  cells += statBlock("Total current EMI", money(totalCurrentEMI));
  cells += statBlock("Total prepayment", money(totalPrepay), "good");
  if (strategy === "emi") {
    cells += statBlock("New combined EMI", money(totalNewEMI), "good");
    cells += statBlock("Monthly saving", money(totalMonthlySaving), "good");
  } else {
    cells += statBlock("Combined EMI", money(totalNewEMI));
    cells += statBlock("Strategy", "Shorter tenure");
  }
  cells += statBlock("Total interest saved", money(totalInterestSaved), "good");
  grid.innerHTML = cells;

  // per-loan portfolio table (active option for each loan)
  const emiMode = strategy === "emi";
  const head = emiMode
    ? `<tr><th>Loan</th><th>Outstanding</th><th>Current EMI</th><th>Prepay (active)</th><th>New EMI</th><th>Monthly saving</th><th>Interest saved</th></tr>`
    : `<tr><th>Loan</th><th>Outstanding</th><th>Current EMI</th><th>Prepay (active)</th><th>New tenure</th><th>Months saved</th><th>Interest saved</th></tr>`;

  let body = "";
  rows.forEach(({ l, base, s }, idx) => {
    const name = (l.name && l.name.trim()) || `Loan ${idx + 1}`;
    if (emiMode) {
      body += `<tr><td>${name}</td><td>${money(base.outstanding)}</td><td>${money(base.currentEMI)}</td><td>${s ? money(s.prepay) : "—"}</td><td>${s ? money(s.newEMI) : "—"}</td><td class="good">${s ? money(s.monthlySaving) : "—"}</td><td class="good">${s ? money(s.interestSaved) : "—"}</td></tr>`;
    } else {
      body += `<tr><td>${name}</td><td>${money(base.outstanding)}</td><td>${money(base.currentEMI)}</td><td>${s ? money(s.prepay) : "—"}</td><td class="good">${s ? monthsLabel(s.newTenureM) : "—"}</td><td class="good">${s ? monthsLabel(s.monthsSaved) : "—"}</td><td class="good">${s ? money(s.interestSaved) : "—"}</td></tr>`;
    }
  });

  const foot = emiMode
    ? `<tr><td>Total</td><td>${money(totalOutstanding)}</td><td>${money(totalCurrentEMI)}</td><td>${money(totalPrepay)}</td><td>${money(totalNewEMI)}</td><td>${money(totalMonthlySaving)}</td><td>${money(totalInterestSaved)}</td></tr>`
    : `<tr><td>Total</td><td>${money(totalOutstanding)}</td><td>${money(totalCurrentEMI)}</td><td>${money(totalPrepay)}</td><td>—</td><td>—</td><td>${money(totalInterestSaved)}</td></tr>`;

  tableWrap.innerHTML =
    `<div class="tbl-title">Per-loan breakdown (active option)</div>` +
    `<table class="calc"><thead>${head}</thead><tbody>${body}</tbody><tfoot>${foot}</tfoot></table>`;

  renderDepletion();
}

/* ---------- assets & depletion ---------- */

const assetsListEl = document.getElementById("assetsList");

function renderAssets() {
  assetsListEl.className = "assets-list" + (drawMode === "priority" ? " priority-on" : "");
  assetsListEl.innerHTML = "";
  if (!assets.length) {
    assetsListEl.innerHTML = `<div class="empty">No assets yet. Click “+ asset” to project how a savings pool depletes against your EMIs.</div>`;
    return;
  }
  assets.forEach((a, idx) => {
    const card = document.createElement("div");
    card.className = "asset";
    card.innerHTML =
      `<div class="asset-top">` +
        `<span class="asset-rank" title="Drawdown priority">#${idx + 1}</span>` +
        `<div class="asset-order">` +
          `<button class="a-up" title="Move up" aria-label="Move up" ${idx === 0 ? "disabled" : ""}>▲</button>` +
          `<button class="a-down" title="Move down" aria-label="Move down" ${idx === assets.length - 1 ? "disabled" : ""}>▼</button>` +
        `</div>` +
        `<input class="asset-name" type="text" placeholder="Asset (e.g. Savings, FD, MF)" />` +
        `<button class="asset-remove" title="Remove asset" aria-label="Remove asset">✕</button>` +
      `</div>` +
      `<div class="asset-fields">` +
        `<label>Current balance<input class="a-balance" type="number" min="0" step="1000" inputmode="decimal" /></label>` +
        `<label>Annual growth (%)<input class="a-growth" type="number" step="0.1" inputmode="decimal" placeholder="0" /></label>` +
        `<label>Monthly addition<input class="a-contrib" type="number" min="0" step="500" inputmode="decimal" placeholder="0" /></label>` +
      `</div>`;

    const nameEl = card.querySelector(".asset-name");
    nameEl.value = a.name ?? "";
    const bind = (sel, key) => {
      const el = card.querySelector(sel);
      el.value = a[key] ?? "";
      el.addEventListener("input", () => {
        a[key] = el.value;
        renderDepletion();
        save();
      });
    };
    nameEl.addEventListener("input", () => {
      a.name = nameEl.value;
      renderDepletion();
      save();
    });
    bind(".a-balance", "balance");
    bind(".a-growth", "growth");
    bind(".a-contrib", "contribution");

    card.querySelector(".asset-remove").addEventListener("click", () => {
      assets = assets.filter((x) => x.id !== a.id);
      renderAssets();
      renderDepletion();
      save();
    });

    const move = (delta) => {
      const j = idx + delta;
      if (j < 0 || j >= assets.length) return;
      [assets[idx], assets[j]] = [assets[j], assets[idx]];
      renderAssets();
      renderDepletion();
      save();
    };
    card.querySelector(".a-up").addEventListener("click", () => move(-1));
    card.querySelector(".a-down").addEventListener("click", () => move(1));

    assetsListEl.appendChild(card);
  });
}

const liabilitiesListEl = document.getElementById("liabilitiesList");

function renderLiabilities() {
  liabilitiesListEl.innerHTML = "";
  if (!liabilities.length) {
    liabilitiesListEl.innerHTML = `<div class="empty">No liabilities. Click “+ liability” to track dues outside your loans.</div>`;
  }
  liabilities.forEach((li) => {
    const card = document.createElement("div");
    card.className = "asset";
    card.innerHTML =
      `<div class="asset-top">` +
        `<input class="asset-name" type="text" placeholder="Liability (e.g. Credit card, Personal loan)" />` +
        `<button class="asset-remove" title="Remove liability" aria-label="Remove liability">✕</button>` +
      `</div>` +
      `<div class="asset-fields">` +
        `<label>Amount due<input class="l-amount" type="number" min="0" step="1000" inputmode="decimal" /></label>` +
        `<label>Monthly payment (optional)<input class="l-payment" type="number" min="0" step="500" inputmode="decimal" placeholder="blank = due now" /></label>` +
      `</div>` +
      `<div class="asset-note muted"></div>`;

    const nameEl = card.querySelector(".asset-name");
    nameEl.value = li.name ?? "";
    nameEl.addEventListener("input", () => {
      li.name = nameEl.value;
      save();
    });
    const bind = (sel, key) => {
      const el = card.querySelector(sel);
      el.value = li[key] ?? "";
      el.addEventListener("input", () => {
        li[key] = el.value;
        updateLiabNote(card, li);
        renderLiabSummary();
        renderDepletion();
        save();
      });
    };
    bind(".l-amount", "amount");
    bind(".l-payment", "payment");

    card.querySelector(".asset-remove").addEventListener("click", () => {
      liabilities = liabilities.filter((x) => x.id !== li.id);
      renderLiabilities();
      renderLiabSummary();
      renderDepletion();
      save();
    });

    updateLiabNote(card, li);
    liabilitiesListEl.appendChild(card);
  });
  renderLiabSummary();
}

function updateLiabNote(card, li) {
  const note = card.querySelector(".asset-note");
  const amt = parseFloat(li.amount) || 0;
  const pay = parseFloat(li.payment) || 0;
  if (amt > 0 && pay > 0) {
    note.textContent = `Cleared in ${monthsLabel(Math.ceil(amt / pay))} at ${money(pay)}/mo.`;
  } else if (amt > 0) {
    note.textContent = `Treated as due now (one-time).`;
  } else {
    note.textContent = "";
  }
}

function renderLiabSummary() {
  const el = document.getElementById("liabilitiesSummary");
  const active = liabilities.filter((li) => (parseFloat(li.amount) || 0) > 0);
  if (!active.length) {
    el.innerHTML = "";
    return;
  }
  let totalDue = 0, totalMonthly = 0, dueNow = 0;
  active.forEach((li) => {
    const amt = parseFloat(li.amount) || 0;
    const pay = parseFloat(li.payment) || 0;
    totalDue += amt;
    if (pay > 0) totalMonthly += pay;
    else dueNow += amt;
  });
  let cells = "";
  cells += statBlock("Liabilities", String(active.length));
  cells += statBlock("Total due", money(totalDue), "hi");
  cells += statBlock("Monthly payments", money(totalMonthly));
  cells += statBlock("Due now (lump)", dueNow > 0 ? money(dueNow) : "—", dueNow > 0 ? "hi" : "");
  el.innerHTML = cells;
}

// Split liabilities into recurring monthly streams and one-time lump dues.
function liabilityStreams() {
  const streams = [];
  let lump = 0;
  liabilities.forEach((li) => {
    const amt = Math.max(0, parseFloat(li.amount) || 0);
    if (amt <= 0) return;
    const pay = Math.max(0, parseFloat(li.payment) || 0);
    if (pay > 0) streams.push({ pay, months: Math.ceil(amt / pay) });
    else lump += amt;
  });
  return { streams, lump };
}

// Simulate assets drawing down month by month against every loan's active plan.
function buildSchedule() {
  const streams = [];
  loans.forEach((l) => {
    const base = computeBase(l);
    if (!base) return;
    const s = activeScenario(l, base);
    if (s) {
      streams.push({
        emi: s.newEMI,
        months: Math.round(strategy === "emi" ? base.outTenureM : s.newTenureM),
        prepay: s.prepay,
      });
    } else {
      streams.push({ emi: base.currentEMI, months: Math.round(base.outTenureM), prepay: 0 });
    }
  });
  const { streams: liabStreams, lump: liabLump } = liabilityStreams();
  if (!streams.length && !liabStreams.length && liabLump <= 0) return null;

  const finiteMonths = streams
    .map((s) => (isFinite(s.months) ? s.months : 0))
    .concat(liabStreams.map((s) => s.months));
  const maxMonths = Math.min(600, Math.max(1, ...finiteMonths));
  const prepayTotal = streams.reduce((a, s) => a + (s.prepay || 0), 0);
  const upfrontTotal = prepayTotal + liabLump;

  const bal = assets.map((a) => ({
    b: Math.max(0, parseFloat(a.balance) || 0),
    g: (parseFloat(a.growth) || 0) / 100 / 12,
    c: Math.max(0, parseFloat(a.contribution) || 0),
  }));
  const hasAssets = bal.some((x) => x.b > 0 || x.c > 0);

  const sum = () => bal.reduce((t, x) => t + x.b, 0);
  const startBalance = sum();

  // Draw `amt` from assets; return the unmet shortfall.
  const outflowProportional = (amt) => {
    if (amt <= 0) return 0;
    const t = sum();
    if (t <= 0) return amt;
    if (amt >= t) {
      bal.forEach((x) => (x.b = 0));
      return amt - t;
    }
    const f = (t - amt) / t;
    bal.forEach((x) => (x.b *= f));
    return 0;
  };
  // Drain assets in list order (top-ranked first), then the next, and so on.
  const outflowPriority = (amt) => {
    let need = amt;
    for (const x of bal) {
      if (need <= 0) break;
      const take = Math.min(x.b, need);
      x.b -= take;
      need -= take;
    }
    return Math.max(0, need);
  };
  const outflow = drawMode === "priority" ? outflowPriority : outflowProportional;

  let depletedMonth = null;
  const rows = [];

  // Month 0 — upfront amounts (loan prepayments + one-time dues) leave the pool now.
  const short0 = outflow(upfrontTotal);
  if (hasAssets && upfrontTotal > 0) {
    if (short0 > 0) depletedMonth = 0;
    rows.push({ m: 0, upfront: upfrontTotal, payment: 0, inflow: 0, remaining: sum(), depleted: short0 > 0 });
  }

  for (let m = 1; m <= maxMonths; m++) {
    const before = sum();
    bal.forEach((x) => (x.b = x.b * (1 + x.g) + x.c));
    const inflow = sum() - before;

    const payment =
      streams.reduce((t, s) => t + (m <= s.months ? s.emi : 0), 0) +
      liabStreams.reduce((t, s) => t + (m <= s.months ? s.pay : 0), 0);
    const short = outflow(payment);
    if (short > 0 && depletedMonth === null) depletedMonth = m;

    rows.push({ m, upfront: 0, payment, inflow, remaining: sum(), depleted: short > 0 });
  }

  return { rows, maxMonths, prepayTotal, upfrontTotal, hasAssets, depletedMonth, startBalance, finalRemaining: sum() };
}

// Inline SVG line chart of the assets balance over the schedule.
function buildChartSVG(sched, theme) {
  const t = Object.assign(
    { grid: "#2a374f", text: "#93a1bd", line: "#34d399", fillA: 0.3, fillB: 0.02, id: "fpFill" },
    theme || {}
  );
  const W = 720, H = 260, padL = 66, padR = 16, padT = 16, padB = 30;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  // points: start balance at x=0, then each simulated row's remaining
  const pts = [{ x: 0, y: sched.startBalance }];
  sched.rows.forEach((r) => pts.push({ x: r.m, y: Math.max(0, r.remaining) }));

  const maxX = Math.max(1, sched.maxMonths);
  const maxY = Math.max(1, sched.startBalance, ...pts.map((p) => p.y));
  const sx = (x) => padL + (x / maxX) * plotW;
  const sy = (y) => padT + (1 - y / maxY) * plotH;

  const line = pts.map((p, i) => `${i ? "L" : "M"}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join(" ");
  const area = `${line} L${sx(maxX).toFixed(1)},${sy(0).toFixed(1)} L${sx(0).toFixed(1)},${sy(0).toFixed(1)} Z`;

  // y gridlines / labels
  let grid = "";
  for (let i = 0; i <= 4; i++) {
    const val = (maxY * i) / 4;
    const y = sy(val);
    grid += `<line x1="${padL}" y1="${y.toFixed(1)}" x2="${W - padR}" y2="${y.toFixed(1)}" stroke="${t.grid}" stroke-width="1"/>`;
    grid += `<text x="${padL - 8}" y="${(y + 4).toFixed(1)}" text-anchor="end" font-size="11" fill="${t.text}">${moneyShort(val)}</text>`;
  }
  // x labels (in years if long)
  let xlabels = "";
  const stepM = maxX > 60 ? 24 : maxX > 24 ? 12 : maxX > 12 ? 6 : 3;
  for (let m = 0; m <= maxX; m += stepM) {
    const x = sx(m);
    const label = maxX > 24 ? `${Math.round(m / 12)}y` : `${m}m`;
    xlabels += `<text x="${x.toFixed(1)}" y="${H - 8}" text-anchor="middle" font-size="11" fill="${t.text}">${label}</text>`;
  }

  // depletion marker
  let marker = "";
  if (sched.depletedMonth !== null && isFinite(sched.depletedMonth)) {
    const x = sx(sched.depletedMonth);
    marker =
      `<line x1="${x.toFixed(1)}" y1="${padT}" x2="${x.toFixed(1)}" y2="${H - padB}" stroke="#f87171" stroke-width="1.5" stroke-dasharray="4 3"/>` +
      `<text x="${x.toFixed(1)}" y="${padT + 12}" text-anchor="middle" font-size="11" fill="#f87171">runs dry</text>`;
  }

  return (
    `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Assets balance over time">` +
    `<defs><linearGradient id="${t.id}" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0%" stop-color="${t.line}" stop-opacity="${t.fillA}"/>` +
    `<stop offset="100%" stop-color="${t.line}" stop-opacity="${t.fillB}"/>` +
    `</linearGradient></defs>` +
    grid + xlabels +
    `<path d="${area}" fill="url(#${t.id})" stroke="none"/>` +
    `<path d="${line}" fill="none" stroke="${t.line}" stroke-width="2.5" stroke-linejoin="round"/>` +
    marker +
    `</svg>`
  );
}

// Overall position across loans, assets, and liabilities.
function computeTotals() {
  let ta = 0, tl = 0, tli = 0;
  assets.forEach((a) => (ta += Math.max(0, parseFloat(a.balance) || 0)));
  loans.forEach((l) => {
    const o = parseFloat(l.outstanding);
    if (isFinite(o) && o > 0) tl += o;
  });
  liabilities.forEach((li) => {
    const a = parseFloat(li.amount);
    if (isFinite(a) && a > 0) tli += a;
  });
  return { assets: ta, loans: tl, liabilities: tli, net: ta - tl - tli };
}

function renderNetPosition() {
  const bar = document.getElementById("netPositionBar");
  const grid = document.getElementById("netPositionGrid");
  const t = computeTotals();
  if (t.assets === 0 && t.loans === 0 && t.liabilities === 0) {
    bar.style.display = "none";
    return;
  }
  bar.style.display = "";
  grid.innerHTML =
    statBlock("Assets", money(t.assets), "good") +
    statBlock("Loans outstanding", money(t.loans), "hi") +
    statBlock("Liabilities", money(t.liabilities), "hi") +
    `<div class="stat netpos ${t.net >= 0 ? "good" : "bad"}"><div class="k">Net position</div><div class="v">${money(t.net)}</div></div>`;
}

function renderDepletion() {
  renderNetPosition();
  const headEl = document.getElementById("depletionHeadline");
  const tableEl = document.getElementById("depletionTable");
  const chartEl = document.getElementById("depletionChart");
  const sched = buildSchedule();

  if (!sched) {
    headEl.className = "depletion-headline";
    headEl.innerHTML = `Add a loan or liability above to project an outflow/depletion schedule.`;
    tableEl.innerHTML = "";
    chartEl.innerHTML = "";
    return;
  }

  chartEl.innerHTML = sched.hasAssets
    ? buildChartSVG(sched)
    : `<div class="chart-empty">Add an asset with a balance to see the balance curve.</div>`;

  // Headline
  if (!sched.hasAssets) {
    headEl.className = "depletion-headline";
    headEl.innerHTML = `Showing the pure <b>payment schedule</b>. Add an asset (balance/growth) to see it deplete.`;
  } else if (sched.depletedMonth !== null) {
    headEl.className = "depletion-headline warn";
    headEl.innerHTML =
      sched.depletedMonth === 0
        ? `⚠ The upfront amount due now (<b>${money(sched.upfrontTotal)}</b>, prepayments + one-time dues) exceeds your assets.`
        : `⚠ Assets run dry in <b>${monthsLabel(sched.depletedMonth)}</b> (month ${sched.depletedMonth}).`;
  } else {
    headEl.className = "depletion-headline ok";
    headEl.innerHTML = `Assets outlast the schedule — <b>${money(sched.finalRemaining)}</b> left after ${monthsLabel(sched.maxMonths)}.`;
  }

  const showAssets = sched.hasAssets;
  let head, body;

  if (gran === "year") {
    // aggregate monthly rows into calendar-ish years (12-month buckets)
    const years = new Map();
    sched.rows.forEach((r) => {
      if (r.m === 0) return; // fold prepayment into year 1 below
      const y = Math.ceil(r.m / 12);
      const acc = years.get(y) || { payment: 0, inflow: 0, remaining: r.remaining, depleted: false };
      acc.payment += r.payment;
      acc.inflow += r.inflow;
      acc.remaining = r.remaining; // end-of-year balance
      acc.depleted = acc.depleted || r.depleted;
      years.set(y, acc);
    });
    head = showAssets
      ? `<tr><th>Year</th><th>Outflow</th><th>Assets in</th><th>Assets left</th></tr>`
      : `<tr><th>Year</th><th>Outflow</th></tr>`;
    body = "";
    if (sched.upfrontTotal > 0 && showAssets) {
      body += `<tr class="prepay-row"><td>Now</td><td>${money(sched.upfrontTotal)} upfront</td><td>—</td><td>${money(Math.max(0, sched.rows[0]?.remaining ?? 0))}</td></tr>`;
    }
    years.forEach((acc, y) => {
      const cls = acc.depleted ? " class=\"depleted\"" : "";
      body += showAssets
        ? `<tr${cls}><td>Year ${y}</td><td>${money(acc.payment)}</td><td>${money(acc.inflow)}</td><td>${money(Math.max(0, acc.remaining))}</td></tr>`
        : `<tr><td>Year ${y}</td><td>${money(acc.payment)}</td></tr>`;
    });
  } else {
    head = showAssets
      ? `<tr><th>Month</th><th>Outflow</th><th>Assets in</th><th>Assets left</th></tr>`
      : `<tr><th>Month</th><th>Outflow</th></tr>`;
    body = "";
    sched.rows.forEach((r) => {
      if (r.m === 0) {
        if (showAssets)
          body += `<tr class="prepay-row"><td>Now</td><td>${money(r.upfront)} upfront</td><td>—</td><td>${money(Math.max(0, r.remaining))}</td></tr>`;
        return;
      }
      const cls = r.depleted ? " class=\"depleted\"" : "";
      body += showAssets
        ? `<tr${cls}><td>${r.m}</td><td>${money(r.payment)}</td><td>${money(r.inflow)}</td><td>${money(Math.max(0, r.remaining))}</td></tr>`
        : `<tr><td>${r.m}</td><td>${money(r.payment)}</td></tr>`;
    });
  }

  tableEl.innerHTML = `<table class="calc"><thead>${head}</thead><tbody>${body}</tbody></table>`;
}

/* ---------- export / print report ---------- */

function esc(s) {
  return String(s == null ? "" : s).replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

function buildReportHTML() {
  const emiMode = strategy === "emi";
  const now = new Date();
  const dateStr = now.toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });
  const stratLabel = emiMode ? "Prepay → lower EMI (tenure fixed)" : "Prepay → shorter tenure (EMI fixed)";

  const rows = loans
    .map((l, i) => {
      const base = computeBase(l);
      if (!base) return null;
      return { l, i, base, s: activeScenario(l, base) };
    })
    .filter(Boolean);

  // ----- per-loan sections -----
  let loanSections = "";
  rows.forEach(({ l, i, base }) => {
    const name = (l.name && l.name.trim()) || `Loan ${i + 1}`;
    const facts = [
      ["Outstanding", money(base.outstanding)],
      ["ROI", `${esc(l.roi)}%`],
      ["Tenure left", monthsLabel(base.outTenureM)],
      ["Current EMI", money(base.currentEMI)],
    ];
    if (base.originalEMI) facts.push(["Original EMI", money(base.originalEMI)]);

    const opts = loanOptions(l);
    let optRows = emiMode
      ? `<tr class="base"><td>No prepayment</td><td>—</td><td>${money(base.currentEMI)}</td><td>—</td><td>—</td></tr>`
      : `<tr class="base"><td>No prepayment</td><td>—</td><td>${monthsLabel(base.outTenureM)}</td><td>—</td><td>—</td></tr>`;
    opts.forEach((o) => {
      const s = computeScenario(base, o.amount);
      const active = o.i === l.active ? ' class="active"' : "";
      optRows += emiMode
        ? `<tr${active}><td>Option ${o.i + 1}${o.i === l.active ? " ★" : ""}</td><td>${money(o.amount)}</td><td>${money(s.newEMI)}</td><td>${money(s.monthlySaving)}</td><td>${money(s.interestSaved)}</td></tr>`
        : `<tr${active}><td>Option ${o.i + 1}${o.i === l.active ? " ★" : ""}</td><td>${money(o.amount)}</td><td>${monthsLabel(s.newTenureM)}</td><td>${monthsLabel(s.monthsSaved)}</td><td>${money(s.interestSaved)}</td></tr>`;
    });
    const optHead = emiMode
      ? `<tr><th>Scenario</th><th>Prepayment</th><th>New EMI</th><th>Monthly saving</th><th>Interest saved</th></tr>`
      : `<tr><th>Scenario</th><th>Prepayment</th><th>New tenure</th><th>Months saved</th><th>Interest saved</th></tr>`;

    loanSections +=
      `<div class="loan-block">` +
      `<h3>${esc(name)}</h3>` +
      `<div class="facts">${facts.map((f) => `<span><b>${f[1]}</b>${f[0]}</span>`).join("")}</div>` +
      (opts.length
        ? `<table class="rpt"><thead>${optHead}</thead><tbody>${optRows}</tbody></table>`
        : `<p class="muted">No prepayment options entered.</p>`) +
      `</div>`;
  });

  // ----- portfolio totals -----
  let tOut = 0, tCur = 0, tPre = 0, tNew = 0, tSave = 0, tInt = 0;
  rows.forEach(({ base, s }) => {
    tOut += base.outstanding;
    tCur += base.currentEMI;
    tPre += s ? s.prepay : 0;
    tNew += s ? s.newEMI : base.currentEMI;
    if (s && emiMode) tSave += s.monthlySaving;
    tInt += s ? s.interestSaved : 0;
  });

  const pHead = emiMode
    ? `<tr><th>Loan</th><th>Outstanding</th><th>Current EMI</th><th>Prepay</th><th>New EMI</th><th>Monthly saving</th><th>Interest saved</th></tr>`
    : `<tr><th>Loan</th><th>Outstanding</th><th>Current EMI</th><th>Prepay</th><th>New tenure</th><th>Months saved</th><th>Interest saved</th></tr>`;
  let pBody = "";
  rows.forEach(({ l, i, base, s }) => {
    const name = (l.name && l.name.trim()) || `Loan ${i + 1}`;
    pBody += emiMode
      ? `<tr><td>${esc(name)}</td><td>${money(base.outstanding)}</td><td>${money(base.currentEMI)}</td><td>${s ? money(s.prepay) : "—"}</td><td>${s ? money(s.newEMI) : "—"}</td><td>${s ? money(s.monthlySaving) : "—"}</td><td>${s ? money(s.interestSaved) : "—"}</td></tr>`
      : `<tr><td>${esc(name)}</td><td>${money(base.outstanding)}</td><td>${money(base.currentEMI)}</td><td>${s ? money(s.prepay) : "—"}</td><td>${s ? monthsLabel(s.newTenureM) : "—"}</td><td>${s ? monthsLabel(s.monthsSaved) : "—"}</td><td>${s ? money(s.interestSaved) : "—"}</td></tr>`;
  });
  const pFoot = emiMode
    ? `<tr><td>Total</td><td>${money(tOut)}</td><td>${money(tCur)}</td><td>${money(tPre)}</td><td>${money(tNew)}</td><td>${money(tSave)}</td><td>${money(tInt)}</td></tr>`
    : `<tr><td>Total</td><td>${money(tOut)}</td><td>${money(tCur)}</td><td>${money(tPre)}</td><td>—</td><td>—</td><td>${money(tInt)}</td></tr>`;

  const portfolioSection = rows.length
    ? `<h2>Portfolio</h2><table class="rpt"><thead>${pHead}</thead><tbody>${pBody}</tbody><tfoot>${pFoot}</tfoot></table>`
    : `<h2>Portfolio</h2><p class="muted">No complete loans to summarise.</p>`;

  // ----- assets & depletion -----
  let assetsSection = "";
  const sched = buildSchedule();
  if (assets.length) {
    const alist = assets
      .map(
        (a, idx) =>
          `<tr><td>${drawMode === "priority" ? "#" + (idx + 1) + " " : ""}${esc(a.name || "Asset " + (idx + 1))}</td><td>${money(parseFloat(a.balance) || 0)}</td><td>${esc(a.growth || 0)}%</td><td>${money(parseFloat(a.contribution) || 0)}</td></tr>`
      )
      .join("");
    assetsSection += `<h2>Assets</h2><p class="muted">Drawdown: ${drawMode === "priority" ? "priority order" : "proportional"}.</p>` +
      `<table class="rpt"><thead><tr><th>Asset</th><th>Balance</th><th>Growth p.a.</th><th>Monthly add</th></tr></thead><tbody>${alist}</tbody></table>`;
  }

  // ----- pending liabilities -----
  const liabActive = liabilities.filter((li) => (parseFloat(li.amount) || 0) > 0);
  if (liabActive.length) {
    let lTotal = 0, lMonthly = 0;
    const lrows = liabActive
      .map((li) => {
        const amt = parseFloat(li.amount) || 0;
        const pay = parseFloat(li.payment) || 0;
        lTotal += amt;
        if (pay > 0) lMonthly += pay;
        const plan = pay > 0 ? `${money(pay)}/mo · ${monthsLabel(Math.ceil(amt / pay))}` : "due now";
        return `<tr><td>${esc(li.name || "Liability")}</td><td>${money(amt)}</td><td>${plan}</td></tr>`;
      })
      .join("");
    assetsSection +=
      `<h2>Pending liabilities</h2>` +
      `<table class="rpt"><thead><tr><th>Liability</th><th>Amount due</th><th>Repayment</th></tr></thead><tbody>${lrows}</tbody>` +
      `<tfoot><tr><td>Total</td><td>${money(lTotal)}</td><td>${money(lMonthly)}/mo</td></tr></tfoot></table>`;
  }

  if (sched && sched.hasAssets) {
    const chart = buildChartSVG(sched, {
      grid: "#e2e6ee", text: "#667085", line: "#0a7d54", fillA: 0.22, fillB: 0.02, id: "rptFill",
    });
    // yearly aggregation
    const years = new Map();
    sched.rows.forEach((r) => {
      if (r.m === 0) return;
      const y = Math.ceil(r.m / 12);
      const acc = years.get(y) || { payment: 0, inflow: 0, remaining: r.remaining, depleted: false };
      acc.payment += r.payment;
      acc.inflow += r.inflow;
      acc.remaining = r.remaining;
      acc.depleted = acc.depleted || r.depleted;
      years.set(y, acc);
    });
    let yBody = "";
    if (sched.upfrontTotal > 0) {
      yBody += `<tr class="warn"><td>Now</td><td>${money(sched.upfrontTotal)} upfront</td><td>—</td><td>${money(Math.max(0, sched.rows[0]?.remaining ?? 0))}</td></tr>`;
    }
    years.forEach((acc, y) => {
      yBody += `<tr${acc.depleted ? ' class="warn"' : ""}><td>Year ${y}</td><td>${money(acc.payment)}</td><td>${money(acc.inflow)}</td><td>${money(Math.max(0, acc.remaining))}</td></tr>`;
    });
    const verdict =
      sched.depletedMonth !== null
        ? `<p class="verdict warn">Assets run dry in ${monthsLabel(sched.depletedMonth)} (month ${sched.depletedMonth}).</p>`
        : `<p class="verdict ok">Assets outlast the schedule — ${money(sched.finalRemaining)} left after ${monthsLabel(sched.maxMonths)}.</p>`;
    assetsSection +=
      `<h2>Asset depletion</h2>${verdict}` +
      `<div class="chart">${chart}</div>` +
      `<table class="rpt"><thead><tr><th>Year</th><th>Outflow</th><th>Assets in</th><th>Assets left</th></tr></thead><tbody>${yBody}</tbody></table>` +
      `<p class="muted">Yearly summary; the chart shows the month-by-month balance.</p>`;
  }

  const styles = `
    :root { color-scheme: light; }
    * { box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif; color: #1a2233; background: #fff; margin: 0; padding: 32px 40px; }
    .toolbar { position: sticky; top: 0; background: #fff; padding-bottom: 12px; margin-bottom: 8px; display: flex; gap: 10px; }
    .toolbar button { border: 1px solid #cbd3e1; background: #f5f7fb; border-radius: 8px; padding: 8px 16px; font-size: 14px; font-weight: 600; cursor: pointer; }
    .toolbar button.primary { background: #2563eb; border-color: #2563eb; color: #fff; }
    h1 { font-size: 24px; margin: 6px 0 2px; }
    .sub { color: #667085; font-size: 13px; margin: 0 0 20px; }
    h2 { font-size: 17px; margin: 26px 0 10px; padding-bottom: 6px; border-bottom: 2px solid #eef1f6; }
    h3 { font-size: 15px; margin: 0 0 8px; }
    .loan-block { border: 1px solid #e6eaf1; border-radius: 10px; padding: 14px 16px; margin-bottom: 14px; page-break-inside: avoid; }
    .facts { display: flex; flex-wrap: wrap; gap: 16px; margin-bottom: 10px; }
    .facts span { font-size: 12px; color: #667085; display: flex; flex-direction: column; }
    .facts b { font-size: 15px; color: #1a2233; }
    table.rpt { width: 100%; border-collapse: collapse; font-size: 12.5px; margin: 4px 0; page-break-inside: avoid; }
    table.rpt th, table.rpt td { text-align: right; padding: 7px 10px; border-bottom: 1px solid #eef1f6; white-space: nowrap; }
    table.rpt th:first-child, table.rpt td:first-child { text-align: left; }
    table.rpt thead th { color: #667085; font-size: 11px; text-transform: uppercase; letter-spacing: .3px; }
    table.rpt tbody tr.base td { color: #98a2b3; }
    table.rpt tbody tr.active td { background: #eafaf1; font-weight: 600; }
    table.rpt tbody tr.warn td { color: #b45309; }
    table.rpt tfoot td { font-weight: 700; border-top: 2px solid #d5dbe6; }
    .muted { color: #98a2b3; font-size: 12px; }
    .verdict { font-size: 14px; font-weight: 600; }
    .verdict.warn { color: #b45309; }
    .verdict.ok { color: #0a7d54; }
    .chart { margin: 6px 0 12px; }
    .chart svg { width: 100%; height: auto; }
    .foot { margin-top: 28px; color: #98a2b3; font-size: 11px; border-top: 1px solid #eef1f6; padding-top: 12px; }
    @media print { .toolbar { display: none; } body { padding: 0; } h2 { page-break-after: avoid; } }
  `;

  return (
    `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/>` +
    `<meta name="viewport" content="width=device-width, initial-scale=1"/>` +
    `<title>finPlan report — ${dateStr}</title><style>${styles}</style></head><body>` +
    `<div class="toolbar"><button class="primary" onclick="window.print()">🖨 Print / Save as PDF</button>` +
    `<button onclick="window.close()">Close</button></div>` +
    `<h1>finPlan — Loan &amp; Asset Plan</h1>` +
    `<p class="sub">Generated ${dateStr} · Strategy: ${stratLabel}</p>` +
    (() => {
      const T = computeTotals();
      if (!T.assets && !T.loans && !T.liabilities) return "";
      return `<p class="sub">Net position: <b style="color:${T.net >= 0 ? "#0a7d54" : "#c0392b"}">${money(T.net)}</b> &nbsp;=&nbsp; Assets ${money(T.assets)} − Loans ${money(T.loans)} − Liabilities ${money(T.liabilities)}</p>`;
    })() +
    `<h2>Loans</h2>${loanSections || '<p class="muted">No loans entered.</p>'}` +
    portfolioSection +
    assetsSection +
    `<p class="foot">Figures assume monthly compounding at ROI/12. Prepayment amounts marked ★ are the active option feeding portfolio totals. This is a planning estimate, not financial advice.</p>` +
    `</body></html>`
  );
}

function exportReport() {
  const html = buildReportHTML();
  const w = window.open("", "_blank");
  if (w) {
    w.document.open();
    w.document.write(html);
    w.document.close();
    return;
  }
  // popup blocked → download an .html file instead
  const blob = new Blob([html], { type: "text/html" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `finplan-report-${new Date().toISOString().slice(0, 10)}.html`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/* ---------- events ---------- */

document.getElementById("addLoan").addEventListener("click", () => {
  const l = blankLoan();
  loans.push(l);
  loansEl.appendChild(renderLoan(l));
  renderSummary();
  save();
});

document.getElementById("exportReport").addEventListener("click", exportReport);

/* named plans */
const planSelect = document.getElementById("planSelect");
planSelect.addEventListener("change", () => {
  const v = planSelect.value;
  if (v === "__working__") {
    currentPlan = null;
    savePlans();
    refreshPlanSelect();
    return;
  }
  if (plans[v]) {
    currentPlan = v;
    applyState(plans[v]);
    savePlans();
    refreshPlanSelect();
    flash(`Loaded “${v}”.`);
  }
});

function planSaveAs() {
  const name = (prompt("Name this plan:", currentPlan || "") || "").trim();
  if (!name) return;
  if (plans[name] && !confirm(`Overwrite existing plan “${name}”?`)) return;
  plans[name] = snapshot();
  currentPlan = name;
  savePlans();
  refreshPlanSelect();
  flash(`Saved “${name}”.`);
}

document.getElementById("planSave").addEventListener("click", () => {
  if (!currentPlan) return planSaveAs();
  plans[currentPlan] = snapshot();
  savePlans();
  flash(`Saved “${currentPlan}”.`);
});

document.getElementById("planSaveAs").addEventListener("click", planSaveAs);

document.getElementById("planDelete").addEventListener("click", () => {
  if (!currentPlan) return;
  if (!confirm(`Delete plan “${currentPlan}”? (Your working copy stays.)`)) return;
  delete plans[currentPlan];
  currentPlan = null;
  savePlans();
  refreshPlanSelect();
});

/* backup / restore file */
document.getElementById("exportJson").addEventListener("click", () => {
  const data = snapshot();
  data._app = "finPlan";
  data._version = 2;
  data._exported = new Date().toISOString();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  const base = (currentPlan || "finplan").replace(/[^\w.-]+/g, "_");
  a.download = `${base}-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
});

const importFile = document.getElementById("importFile");
document.getElementById("importJson").addEventListener("click", () => importFile.click());
importFile.addEventListener("change", () => {
  const file = importFile.files && importFile.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const st = JSON.parse(reader.result);
      if (!st || !Array.isArray(st.loans)) throw new Error("not a finPlan backup");
      currentPlan = null;
      applyState(st);
      savePlans();
      refreshPlanSelect();
      flash("Imported backup into working copy.");
    } catch (e) {
      alert("Could not import this file: " + e.message);
    }
    importFile.value = "";
  };
  reader.readAsText(file);
});

document.getElementById("resetAll").addEventListener("click", () => {
  if (!confirm("Clear all loans and start over?")) return;
  loans = [blankLoan()];
  renderAll();
  save();
});

document.querySelectorAll(".segmented .seg[data-strategy]").forEach((b) =>
  b.addEventListener("click", () => {
    strategy = b.dataset.strategy;
    renderAll();
    save();
  })
);

document.getElementById("addAsset").addEventListener("click", () => {
  assets.push(blankAsset());
  renderAssets();
  renderDepletion();
  save();
});

document.getElementById("addLiability").addEventListener("click", () => {
  liabilities.push(blankLiability());
  renderLiabilities();
  renderDepletion();
  save();
});

document.querySelectorAll("#granularity .seg[data-gran]").forEach((b) =>
  b.addEventListener("click", () => {
    gran = b.dataset.gran;
    document
      .querySelectorAll("#granularity .seg")
      .forEach((x) => x.classList.toggle("active", x.dataset.gran === gran));
    renderDepletion();
    save();
  })
);

document.querySelectorAll("#drawmode .seg[data-draw]").forEach((b) =>
  b.addEventListener("click", () => {
    drawMode = b.dataset.draw;
    document
      .querySelectorAll("#drawmode .seg")
      .forEach((x) => x.classList.toggle("active", x.dataset.draw === drawMode));
    renderAssets();
    renderDepletion();
    save();
  })
);

/* ---------- boot ---------- */

load();
document
  .querySelectorAll("#granularity .seg")
  .forEach((x) => x.classList.toggle("active", x.dataset.gran === gran));
document
  .querySelectorAll("#drawmode .seg")
  .forEach((x) => x.classList.toggle("active", x.dataset.draw === drawMode));
loadPlans();
refreshPlanSelect();
renderAssets();
renderLiabilities();
renderAll();
