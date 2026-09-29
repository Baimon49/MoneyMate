/* =========================================================
   MoneyMate - app.js
   Core application module shared by every page:
   - LocalStorage helpers & keys
   - Formatting / date / month-range utilities
   - Toast, Modal, Confirm-dialog UI helpers
   - Theme (light/dark) handling
   - Sidebar / bottom-nav active-link handling
   - Categories loading (from data/categories.json)
   - Salary ("เงินเดือน/เงินตั้งต้น") data layer
   - Month summary calculation (salary - expenses)
   Every other page script (transactions.js, budget.js,
   goals.js, charts.js) relies on the `MM` namespace defined
   here and waits for the "moneymate:ready" event before it
   touches the DOM or categories.
   ========================================================= */

(function (window) {
  'use strict';

  const STORAGE_KEYS = {
    salaries: 'mm_salaries',      // { "2026-01": { amount: 20000, date: "2026-01-05" }, ... }
    transactions: 'mm_transactions', // [{id, amount, categoryId, note, date, createdAt}]
    budgets: 'mm_budgets',        // { "2026-01": 5000, ... }
    goals: 'mm_goals',            // [{id, name, targetAmount, savedAmount, targetDate, createdAt}]
    incomes: 'mm_incomes',      // [{id, amount, source, date, createdAt}]
    sources: 'mm_sources',      // ["เงินเดือน", ...] custom income sources
    trash: 'mm_trash',          // [{type:'expense'|'income', item, deletedAt}]
    snapshots: 'mm_snapshots',  // saved summaries
    theme: 'mm_theme'             // "light" | "dark"
  };

  const THAI_MONTHS = [
    'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
    'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'
  ];

  const FALLBACK_CATEGORIES = [
    { id: 'food', label: 'อาหาร', icon: '🍜', color: '#2F8F5B' },
    { id: 'transport', label: 'เดินทาง', icon: '🚌', color: '#3C8FB0' },
    { id: 'shopping', label: 'ช้อปปิ้ง', icon: '🛍️', color: '#C77DBF' },
    { id: 'study', label: 'การเรียน', icon: '📚', color: '#C9A227' },
    { id: 'entertainment', label: 'ความบันเทิง', icon: '🎬', color: '#D97A5D' },
    { id: 'other', label: 'อื่น ๆ', icon: '📦', color: '#8A8F86' }
  ];

  /* ---------------- Storage helpers ---------------- */

  function readJSON(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (raw === null) return fallback;
      const parsed = JSON.parse(raw);
      return parsed === null || parsed === undefined ? fallback : parsed;
    } catch (err) {
      console.error('MM storage read error for', key, err);
      return fallback;
    }
  }

  function writeJSON(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (err) {
      console.error('MM storage write error for', key, err);
      return false;
    }
  }

  /* ---------------- Formatting utils ---------------- */

  function formatMoney(n) {
    const num = Number(n) || 0;
    return num.toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 2 }) + ' ฿';
  }

  function formatMoneyPlain(n) {
    const num = Number(n) || 0;
    return num.toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  }

  function pad2(n) { return String(n).padStart(2, '0'); }

  function toMonthKey(dateOrStr) {
    const d = (dateOrStr instanceof Date) ? dateOrStr : new Date(dateOrStr);
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
  }

  function todayISO() {
    const d = new Date();
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  }

  function currentMonthKey() { return toMonthKey(new Date()); }

  // "2026-03" -> "มีนาคม 2569" (Buddhist year)
  function monthLabel(monthKey) {
    const [y, m] = monthKey.split('-').map(Number);
    const beYear = y + 543;
    return `${THAI_MONTHS[m - 1]} ${beYear}`;
  }

  function monthLabelShort(monthKey) {
    const [y, m] = monthKey.split('-').map(Number);
    const beYear = String(y + 543).slice(-2);
    return `${THAI_MONTHS[m - 1].slice(0, 3)} ${beYear}`;
  }

  function formatDateThai(iso) {
    if (!iso) return '-';
    const [y, m, d] = iso.split('-').map(Number);
    const beYear = y + 543;
    return `${d} ${THAI_MONTHS[m - 1]} ${beYear}`;
  }

  function uid() {
    return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  }

  function daysInMonth(yearCE, month1to12) {
    return new Date(yearCE, month1to12, 0).getDate();
  }

  /* ---------------- Thai (day / month-name / พ.ศ. year) date picker helpers ----------------
     Every "date" field in the app (setting salary, adding/editing an expense) uses three
     <select> elements instead of a native <input type="date|month">, so the day is always
     visible and the year is always shown in the Buddhist Era the way Thai users expect. */

  // Fill the three selects with their static option lists and wire the day-count refresh.
  // Call this once per page, when the modal markup first exists.
  function populateThaiDateSelects(dayId, monthId, yearId, opts) {
    opts = opts || {};
    const daySel = document.getElementById(dayId);
    const monthSel = document.getElementById(monthId);
    const yearSel = document.getElementById(yearId);
    if (!daySel || !monthSel || !yearSel) return;

    monthSel.innerHTML = THAI_MONTHS.map((name, i) => `<option value="${i + 1}">${name}</option>`).join('');

    const nowCE = new Date().getFullYear();
    const back = opts.yearsBack != null ? opts.yearsBack : 6;
    const fwd = opts.yearsForward != null ? opts.yearsForward : 2;
    let yearOptions = '';
    for (let y = nowCE + fwd; y >= nowCE - back; y--) {
      yearOptions += `<option value="${y}">${y + 543}</option>`;
    }
    yearSel.innerHTML = yearOptions;

    function refreshDayOptions() {
      const y = Number(yearSel.value) || nowCE;
      const m = Number(monthSel.value) || 1;
      const max = daysInMonth(y, m);
      const prevDay = Number(daySel.value) || 0;
      let dayOptions = '';
      for (let d = 1; d <= max; d++) dayOptions += `<option value="${d}">${d}</option>`;
      daySel.innerHTML = dayOptions;
      daySel.value = String(Math.min(prevDay || 1, max));
    }

    monthSel.addEventListener('change', refreshDayOptions);
    yearSel.addEventListener('change', refreshDayOptions);
    refreshDayOptions();
  }

  // Set the three selects to reflect a given ISO date ("YYYY-MM-DD"), adding the year
  // option on the fly if it falls outside the pre-built range.
  function setThaiDateSelects(dayId, monthId, yearId, iso) {
    const daySel = document.getElementById(dayId);
    const monthSel = document.getElementById(monthId);
    const yearSel = document.getElementById(yearId);
    if (!daySel || !monthSel || !yearSel) return;

    const [y, m, d] = (iso || todayISO()).split('-').map(Number);

    if (!yearSel.querySelector(`option[value="${y}"]`)) {
      const opt = document.createElement('option');
      opt.value = String(y);
      opt.textContent = String(y + 543);
      yearSel.appendChild(opt);
    }
    yearSel.value = String(y);
    monthSel.value = String(m);

    const max = daysInMonth(y, m);
    let dayOptions = '';
    for (let dd = 1; dd <= max; dd++) dayOptions += `<option value="${dd}">${dd}</option>`;
    daySel.innerHTML = dayOptions;
    daySel.value = String(Math.min(d, max));
  }

  // Read the three selects back into an ISO date string, or null if incomplete.
  function getISOFromThaiDateSelects(dayId, monthId, yearId) {
    const daySel = document.getElementById(dayId);
    const monthSel = document.getElementById(monthId);
    const yearSel = document.getElementById(yearId);
    if (!daySel || !monthSel || !yearSel) return null;
    if (!daySel.value || !monthSel.value || !yearSel.value) return null;
    return `${Number(yearSel.value)}-${pad2(Number(monthSel.value))}-${pad2(Number(daySel.value))}`;
  }

  // Add `count` months to a monthKey, e.g. addMonths('2026-01', -5) => '2025-08'
  function addMonths(monthKey, count) {
    const [y, m] = monthKey.split('-').map(Number);
    const d = new Date(y, m - 1 + count, 1);
    return toMonthKey(d);
  }

  function compareMonthKeys(a, b) { return a < b ? -1 : (a > b ? 1 : 0); }

  /* ---------------- Categories ---------------- */

  let categoriesCache = null;

  async function loadCategories() {
    if (categoriesCache) return categoriesCache;
    try {
      const res = await fetch('data/categories.json');
      if (!res.ok) throw new Error('bad response');
      const json = await res.json();
      categoriesCache = Array.isArray(json.categories) && json.categories.length
        ? json.categories
        : FALLBACK_CATEGORIES;
    } catch (err) {
      // e.g. opened via file:// without a local server
      categoriesCache = FALLBACK_CATEGORIES;
    }
    return categoriesCache;
  }

  function getCategoryById(id) {
    const list = categoriesCache || FALLBACK_CATEGORIES;
    return list.find(c => c.id === id) || list[list.length - 1];
  }

  /* ---------------- Salary data layer ---------------- */

  function getSalaries() { return readJSON(STORAGE_KEYS.salaries, {}); }

  // Older saves stored a plain number per month (no exact date). Normalize on read so
  // every caller can rely on { amount, date } without caring which version wrote it.
  function normalizeSalaryEntry(entry, monthKey) {
    if (entry === null || entry === undefined) return null;
    if (typeof entry === 'number') return { amount: entry, date: `${monthKey}-01` };
    return entry;
  }

  /* ---------------- Income (รายรับ) data layer ----------------
     Many income entries per month, each with a user-defined source.
     getSalaryForMonth & co. are kept (as totals) so goals/budget/charts still work. */
  const DEFAULT_SOURCES = ['เงินเดือน', 'ค่าขนม', 'งานพิเศษ', 'อื่น ๆ'];

  function getIncomes() {
    let list = readJSON(STORAGE_KEYS.incomes, null);
    if (list === null) { // migrate old one-number-per-month salaries
      list = [];
      const old = getSalaries();
      Object.keys(old).forEach(mk => {
        const en = normalizeSalaryEntry(old[mk], mk);
        if (en) list.push({ id: uid(), amount: Number(en.amount) || 0, source: 'เงินเดือน', date: en.date, createdAt: Date.now() });
      });
      writeJSON(STORAGE_KEYS.incomes, list);
    }
    return list;
  }
  function saveIncomes(list) {
    writeJSON(STORAGE_KEYS.incomes, list);
    document.dispatchEvent(new CustomEvent('moneymate:data-changed', { detail: { type: 'income' } }));
  }
  function getIncomesForMonth(monthKey) { return getIncomes().filter(i => toMonthKey(i.date) === monthKey); }
  function getSources() {
    const saved = readJSON(STORAGE_KEYS.sources, DEFAULT_SOURCES);
    const set = new Set(saved);
    getIncomes().forEach(i => { if (i.source) set.add(i.source); });
    return Array.from(set);
  }
  function addSource(name) {
    name = (name || '').trim();
    if (!name) return '';
    const list = getSources();
    if (!list.includes(name)) { list.push(name); writeJSON(STORAGE_KEYS.sources, list); }
    return name;
  }

  function getSalaries() { return readJSON('mm_salaries', {}); }
  function normalizeSalaryEntry(entry, monthKey) {
    if (entry === null || entry === undefined) return null;
    if (typeof entry === 'number') return { amount: entry, date: `${monthKey}-01` };
    return entry;
  }
  function getIncomeForMonthBySource(monthKey, source) {
    return getIncomesForMonth(monthKey).filter(i => i.source === source).reduce((s, i) => s + (Number(i.amount) || 0), 0);
  }
  function getSalaryForMonth(monthKey) {
    return Math.max(0, getIncomesForMonth(monthKey).reduce((s, i) => s + (Number(i.amount) || 0), 0));
  }
  function getSalaryDateForMonth(monthKey) {
    const l = getIncomesForMonth(monthKey).map(i => i.date).sort();
    return l.length ? l[l.length - 1] : null;
  }
  function hasSalaryForMonth(monthKey) { return getIncomesForMonth(monthKey).length > 0; }
  function addIncome(amount, source, date) {
    const list = getIncomes();
    list.push({ id: uid(), amount: Number(amount) || 0, source: source || 'อื่น ๆ', date, createdAt: Date.now() });
    saveIncomes(list);
  }
  // used by goals.js when money moves between a savings goal and the money pool
  function adjustSalaryForMonth(monthKey, delta) {
    const list = getIncomes();
    list.push({ id: uid(), amount: Number(delta) || 0, source: 'เป้าหมายการออม', date: getSalaryDateForMonth(monthKey) || `${monthKey}-01`, createdAt: Date.now(), internal: true });
    saveIncomes(list);
  }

  /* ---------------- Trash (deleted items stay recoverable + visible in summaries) ---------------- */
  function getTrash() { return readJSON(STORAGE_KEYS.trash, []); }
  function saveTrash(list) { writeJSON(STORAGE_KEYS.trash, list); }
  function moveToTrash(type, items) {
    const t = getTrash(); const now = Date.now();
    items.forEach(item => t.push({ type, item, deletedAt: now }));
    saveTrash(t);
  }

  /* ---------------- Transactions (raw storage, CRUD lives in transactions.js) ---------------- */

  function getAllTransactions() { return readJSON(STORAGE_KEYS.transactions, []); }
  function saveAllTransactions(list) {
    writeJSON(STORAGE_KEYS.transactions, list);
    document.dispatchEvent(new CustomEvent('moneymate:data-changed', { detail: { type: 'transactions' } }));
  }

  function getTransactionsForMonth(monthKey) {
    return getAllTransactions().filter(t => toMonthKey(t.date) === monthKey);
  }

  function sumExpenses(list) {
    return list.reduce((sum, t) => sum + (Number(t.amount) || 0), 0);
  }

  /* ---------------- Month summary (core money rule) ---------------- */

  // remaining = salary/base - expenses ; never allowed to go negative in the data itself
  function getMonthSummary(monthKey) {
    const salary = getSalaryForMonth(monthKey);
    const expenses = sumExpenses(getTransactionsForMonth(monthKey));
    const remaining = Math.max(0, salary - expenses);
    return { monthKey, salary, expenses, remaining, over: expenses > salary };
  }

  // How much can still be spent this month, optionally excluding one transaction (for edits)
  function getAvailableToSpend(monthKey, excludeTxId, source) {
    const salary = getSalaryForMonth(monthKey);
    const txs = getTransactionsForMonth(monthKey).filter(t => t.id !== excludeTxId);
    const total = Math.max(0, salary - sumExpenses(txs));
    if (!source) return total;
    const bySrc = getIncomeForMonthBySource(monthKey, source) - sumExpenses(txs.filter(t => t.source === source));
    return Math.max(0, Math.min(total, bySrc));
  }

  /* ---------------- Date-range helpers (for dashboard summary) ---------------- */

  // Returns an ordered array of month keys (oldest -> newest) for a given range type
  function getMonthRange(rangeType, customStart, customEnd) {
    const now = currentMonthKey();
    let months = [];
    switch (rangeType) {
      case 'this-month':
        months = [now];
        break;
      case '3m':
        for (let i = 2; i >= 0; i--) months.push(addMonths(now, -i));
        break;
      case '6m':
        for (let i = 5; i >= 0; i--) months.push(addMonths(now, -i));
        break;
      case '1y':
        for (let i = 11; i >= 0; i--) months.push(addMonths(now, -i));
        break;
      case 'custom': {
        if (!customStart || !customEnd) { months = [now]; break; }
        let cursor = customStart;
        let guard = 0;
        while (compareMonthKeys(cursor, customEnd) <= 0 && guard < 240) {
          months.push(cursor);
          cursor = addMonths(cursor, 1);
          guard++;
        }
        break;
      }
      default:
        for (let i = 5; i >= 0; i--) months.push(addMonths(now, -i));
    }
    return months;
  }

  function rangeLabel(rangeType) {
    switch (rangeType) {
      case 'this-month': return 'เดือนนี้';
      case '3m': return '3 เดือนล่าสุด';
      case '6m': return '6 เดือนล่าสุด';
      case '1y': return '1 ปีล่าสุด';
      case 'custom': return 'ช่วงเวลาที่กำหนดเอง';
      default: return '';
    }
  }

  /* ---------------- Toast ---------------- */

  function ensureToastStack() {
    let stack = document.querySelector('.toast-stack');
    if (!stack) {
      stack = document.createElement('div');
      stack.className = 'toast-stack';
      document.body.appendChild(stack);
    }
    return stack;
  }

  function showToast(message, type) {
    const stack = ensureToastStack();
    const el = document.createElement('div');
    el.className = 'toast ' + (type || 'info');
    el.textContent = message;
    stack.appendChild(el);
    requestAnimationFrame(() => el.classList.add('show'));
    setTimeout(() => {
      el.classList.remove('show');
      setTimeout(() => el.remove(), 250);
    }, 2600);
  }

  /* ---------------- Modal helpers ---------------- */

  function openModal(id) {
    const el = document.getElementById(id);
    if (el) el.classList.add('open');
  }

  function closeModal(id) {
    const el = document.getElementById(id);
    if (el) el.classList.remove('open');
  }

  // Generic confirm dialog using the #confirmModal markup present on every page
  function confirmAction(message, onConfirm) {
    const modal = document.getElementById('confirmModal');
    if (!modal) { if (confirm(message)) onConfirm(); return; }
    const msgEl = document.getElementById('confirmMessage');
    if (msgEl) msgEl.textContent = message;
    openModal('confirmModal');

    const yesBtn = document.getElementById('confirmYesBtn');
    const noBtn = document.getElementById('confirmNoBtn');

    function cleanup() {
      yesBtn.removeEventListener('click', onYes);
      noBtn.removeEventListener('click', onNo);
    }
    function onYes() { cleanup(); closeModal('confirmModal'); onConfirm(); }
    function onNo() { cleanup(); closeModal('confirmModal'); }

    yesBtn.addEventListener('click', onYes);
    noBtn.addEventListener('click', onNo);
  }

  // Close modal when clicking the dark overlay itself
  document.addEventListener('click', function (e) {
    if (e.target.classList && e.target.classList.contains('modal-overlay')) {
      e.target.classList.remove('open');
    }
  });

  /* ---------------- Full data reset ("ล้างข้อมูลทั้งหมด") ----------------
     Wipes every piece of financial data the app stores - salaries/เงินเดือน,
     transactions/รายจ่าย, budgets/งบประมาณ and goals/เป้าหมาย - across every
     month, not just what's visible on the current page. Theme preference is
     left untouched since it's a display setting, not app data. */

  function resetAllData() {
    localStorage.removeItem(STORAGE_KEYS.salaries);
    ['incomes','sources','trash','snapshots'].forEach(k => localStorage.removeItem(STORAGE_KEYS[k]));
    localStorage.removeItem(STORAGE_KEYS.transactions);
    localStorage.removeItem(STORAGE_KEYS.budgets);
    localStorage.removeItem(STORAGE_KEYS.goals);
    document.dispatchEvent(new CustomEvent('moneymate:data-changed', { detail: { type: 'reset' } }));
  }

  // Wires every [data-reset-app] button on the page (sidebar + mobile topbar).
  function initResetButton() {
    document.querySelectorAll('[data-reset-app]').forEach(btn => {
      btn.addEventListener('click', () => {
        confirmAction(
          'ต้องการล้างข้อมูลทั้งหมดของแอปหรือไม่? เงินเดือน/เงินตั้งต้น รายจ่าย งบประมาณ และเป้าหมายทั้งหมด (ทุกเดือน) จะถูกลบออกจากเครื่องนี้ทันทีและไม่สามารถกู้คืนได้',
          () => {
            resetAllData();
            showToast('ล้างข้อมูลทั้งหมดเรียบร้อยแล้ว', 'success');
            setTimeout(() => window.location.reload(), 500);
          }
        );
      });
    });
  }

  /* ---------------- Theme ---------------- */

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    document.querySelectorAll('.theme-toggle [data-theme-btn]').forEach(btn => {
      btn.classList.toggle('active', btn.getAttribute('data-theme-btn') === theme);
    });
  }

  function initTheme() {
    const saved = readJSON(STORAGE_KEYS.theme, 'light');
    applyTheme(saved);
    document.querySelectorAll('.theme-toggle [data-theme-btn]').forEach(btn => {
      btn.addEventListener('click', () => {
        const t = btn.getAttribute('data-theme-btn');
        writeJSON(STORAGE_KEYS.theme, t);
        applyTheme(t);
        document.dispatchEvent(new CustomEvent('moneymate:theme-changed'));
      });
    });
  }

  /* ---------------- Nav active-link ---------------- */

  function initNav() {
    const page = document.body.getAttribute('data-page');
    document.querySelectorAll('[data-nav-link]').forEach(link => {
      if (link.getAttribute('data-nav-link') === page) link.classList.add('active');
    });
  }

  /* ---------------- Bootstrap ---------------- */

  document.addEventListener('DOMContentLoaded', async function () {
    initTheme();
    initNav();
    initResetButton();
    await loadCategories();
    document.dispatchEvent(new CustomEvent('moneymate:ready'));
  });

  /* ---------------- Public namespace ---------------- */

  window.MM = {
    KEYS: STORAGE_KEYS,
    readJSON, writeJSON,
    formatMoney, formatMoneyPlain,
    toMonthKey, todayISO, currentMonthKey,
    monthLabel, monthLabelShort, formatDateThai,
    addMonths, compareMonthKeys,
    uid, daysInMonth,
    populateThaiDateSelects, setThaiDateSelects, getISOFromThaiDateSelects,
    loadCategories, getCategoryById,
    getIncomes, saveIncomes, getIncomesForMonth, getSources, addSource, addIncome, getIncomeForMonthBySource, getTrash, saveTrash, moveToTrash,
    getSalaries, getSalaryForMonth, getSalaryDateForMonth, hasSalaryForMonth, setSalaryForMonth, adjustSalaryForMonth,
    getAllTransactions, saveAllTransactions, getTransactionsForMonth, sumExpenses,
    getMonthSummary, getAvailableToSpend,
    getMonthRange, rangeLabel,
    showToast, openModal, closeModal, confirmAction,
    resetAllData
  };

})(window);
