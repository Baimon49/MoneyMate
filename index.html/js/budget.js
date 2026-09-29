/* =========================================================
   MoneyMate - budget.js
   Monthly spending-budget feature. A budget is a *soft* cap
   the student sets for themselves to control spending; it
   never overrides the hard "cannot spend more than the
   salary/base amount" rule enforced in transactions.js.
   ========================================================= */

(function () {
  'use strict';

  function getBudgets() { return MM.readJSON(MM.KEYS.budgets, {}); }
  function saveBudgets(obj) {
    MM.writeJSON(MM.KEYS.budgets, obj);
    document.dispatchEvent(new CustomEvent('moneymate:data-changed', { detail: { type: 'budgets' } }));
  }
  function getBudgetForMonth(monthKey) {
    const all = getBudgets();
    return typeof all[monthKey] === 'number' ? all[monthKey] : null;
  }

  let selectedMonth;

  function renderBudgetView() {
    const monthKey = selectedMonth || MM.currentMonthKey();
    document.getElementById('budgetMonthPicker').value = monthKey;
    document.getElementById('budgetCaption').textContent = MM.monthLabel(monthKey);

    const budget = getBudgetForMonth(monthKey);
    const spent = MM.sumExpenses(MM.getTransactionsForMonth(monthKey));

    const emptyEl = document.getElementById('budgetEmptyState');
    const detailEl = document.getElementById('budgetDetail');

    if (budget === null) {
      emptyEl.style.display = 'block';
      detailEl.style.display = 'none';
      renderBudgetHistory();
      return;
    }
    emptyEl.style.display = 'none';
    detailEl.style.display = 'block';

    const remaining = budget - spent;
    const pct = budget > 0 ? Math.round((spent / budget) * 100) : 0;

    document.getElementById('budgetTotalAmount').textContent = MM.formatMoney(budget);
    document.getElementById('budgetSpentAmount').textContent = MM.formatMoney(spent);
    document.getElementById('budgetRemainingAmount').textContent =
      remaining >= 0 ? MM.formatMoney(remaining) : `เกินงบ ${MM.formatMoney(Math.abs(remaining))}`;
    document.getElementById('budgetRemainingAmount').className = 'amount ' + (remaining >= 0 ? 'positive' : 'negative');
    document.getElementById('budgetPercentText').textContent = pct + '%';

    const fill = document.getElementById('budgetProgressFill');
    fill.style.width = Math.min(100, pct) + '%';
    fill.classList.remove('warn', 'danger');

    const pill = document.getElementById('budgetStatusPill');
    if (pct >= 100) {
      fill.classList.add('danger');
      pill.textContent = 'เกินงบประมาณแล้ว';
      pill.className = 'pill danger';
    } else if (pct >= 80) {
      fill.classList.add('warn');
      pill.textContent = 'ใกล้เกินงบแล้ว ระวังการใช้จ่าย';
      pill.className = 'pill warn';
    } else {
      pill.textContent = 'อยู่ในงบประมาณ';
      pill.className = 'pill ok';
    }

    renderBudgetHistory();
  }

  function renderBudgetHistory() {
    const budgets = getBudgets();
    const months = Object.keys(budgets).sort((a, b) => b.localeCompare(a));
    const list = document.getElementById('budgetHistoryList');
    const empty = document.getElementById('budgetHistoryEmpty');
    list.innerHTML = '';

    if (!months.length) {
      empty.style.display = 'block';
      list.style.display = 'none';
      return;
    }
    empty.style.display = 'none';
    list.style.display = 'flex';

    months.forEach(mk => {
      const amount = budgets[mk];
      const spent = MM.sumExpenses(MM.getTransactionsForMonth(mk));
      const pct = amount > 0 ? Math.round((spent / amount) * 100) : 0;
      const row = document.createElement('div');
      row.className = 'tx-row';
      row.innerHTML = `
        <div class="tx-icon">🎯</div>
        <div class="tx-info">
          <div class="t1">${MM.monthLabel(mk)}</div>
          <div class="t2">ใช้ไป ${MM.formatMoney(spent)} จากงบ ${MM.formatMoney(amount)} (${pct}%)</div>
        </div>
        <div class="tx-actions">
          <button class="btn btn-icon btn-sm" title="แก้ไข" data-edit-budget="${mk}">✏️</button>
          <button class="btn btn-icon btn-sm" title="ลบ" data-del-budget="${mk}">🗑️</button>
        </div>
      `;
      row.querySelector('[data-edit-budget]').addEventListener('click', () => openBudgetModal(mk));
      row.querySelector('[data-del-budget]').addEventListener('click', () => {
        MM.confirmAction(`ต้องการลบงบประมาณของ${MM.monthLabel(mk)}หรือไม่?`, () => {
          const all = getBudgets();
          delete all[mk];
          saveBudgets(all);
          MM.showToast('ลบงบประมาณเรียบร้อย', 'success');
          renderBudgetView();
        });
      });
      list.appendChild(row);
    });
  }

  function openBudgetModal(monthKey) {
    const mk = monthKey || selectedMonth || MM.currentMonthKey();
    document.getElementById('budgetModalMonthInput').value = mk;
    const existing = getBudgetForMonth(mk);
    document.getElementById('budgetModalAmountInput').value = existing !== null ? existing : '';
    document.getElementById('budgetModalError').classList.remove('show');
    MM.openModal('budgetModal');
  }

  function saveBudgetFromModal() {
    const monthInput = document.getElementById('budgetModalMonthInput');
    const amountInput = document.getElementById('budgetModalAmountInput');
    const errorEl = document.getElementById('budgetModalError');
    const monthKey = monthInput.value;
    const amount = parseFloat(amountInput.value);

    if (!monthKey) {
      errorEl.textContent = 'กรุณาเลือกเดือน';
      errorEl.classList.add('show');
      return;
    }
    if (isNaN(amount) || amount <= 0) {
      errorEl.textContent = 'กรุณากรอกจำนวนงบประมาณให้ถูกต้อง';
      errorEl.classList.add('show');
      return;
    }
    const all = getBudgets();
    all[monthKey] = amount;
    saveBudgets(all);
    MM.showToast(`ตั้งงบประมาณ${MM.monthLabel(monthKey)}เรียบร้อย`, 'success');
    MM.closeModal('budgetModal');
    selectedMonth = monthKey;
    renderBudgetView();
  }

  function initBudgetPage() {
    selectedMonth = MM.currentMonthKey();
    const monthPicker = document.getElementById('budgetMonthPicker');
    monthPicker.value = selectedMonth;
    monthPicker.addEventListener('change', () => {
      selectedMonth = monthPicker.value;
      renderBudgetView();
    });

    document.getElementById('setBudgetBtn').addEventListener('click', () => openBudgetModal(selectedMonth));
    document.getElementById('setBudgetBtnEmpty').addEventListener('click', () => openBudgetModal(selectedMonth));
    document.getElementById('budgetModalSaveBtn').addEventListener('click', saveBudgetFromModal);
    document.getElementById('budgetModalCancelBtn').addEventListener('click', () => MM.closeModal('budgetModal'));

    renderBudgetView();
  }

  document.addEventListener('moneymate:ready', function () {
    if (document.body.getAttribute('data-page') === 'budget') initBudgetPage();
  });
  document.addEventListener('moneymate:data-changed', function () {
    if (document.body.getAttribute('data-page') === 'budget') renderBudgetView();
  });

})();
