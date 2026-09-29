/* =========================================================
   MoneyMate - charts.js
   Renders the two dashboard charts with the native Canvas 2D
   API only - no external charting library / CDN dependency.
   This keeps the charts working fully offline (as a proper
   installed PWA should) and removes the single point of
   failure that previously made the dashboard show no graphs
   at all whenever the Chart.js CDN script hadn't loaded yet.
   ========================================================= */

(function () {
  'use strict';

  // Cache the last data used to draw each chart so we can redraw on
  // window resize or when the light/dark theme changes (colors change).
  let lastRows = null;
  let lastMonths = null;

  function getCssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  function toggleEmpty(canvasId, emptyId, isEmpty) {
    const canvas = document.getElementById(canvasId);
    const empty = document.getElementById(emptyId);
    if (canvas) canvas.style.display = isEmpty ? 'none' : 'block';
    if (empty) empty.style.display = isEmpty ? 'block' : 'none';
  }

  // Prepares a canvas for crisp drawing on high-DPI screens and returns a ready-to-use
  // 2D context plus the CSS (unscaled) width/height to use for all further drawing math.
  function setupCanvas(canvas) {
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    return { ctx, width, height };
  }

  // Rounds a max value up to a "nice" number (1/2/5 x 10^n) so axis gridlines read cleanly.
  function niceCeil(value) {
    if (!isFinite(value) || value <= 0) return 100;
    const exp = Math.floor(Math.log10(value));
    const base = Math.pow(10, exp);
    const norm = value / base;
    let niceNorm;
    if (norm <= 1) niceNorm = 1;
    else if (norm <= 2) niceNorm = 2;
    else if (norm <= 5) niceNorm = 5;
    else niceNorm = 10;
    return niceNorm * base;
  }

  function drawRoundedBar(ctx, x, y, w, h, color) {
    if (h <= 0.5 || w <= 0) return;
    const r = Math.max(0, Math.min(5, w / 2, h));
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x, y + h);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
    ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h);
    ctx.closePath();
    ctx.fill();
  }

  function drawLegendRow(ctx, canvasWidth, items, textColor) {
    ctx.font = '600 11.5px "Noto Sans Thai", system-ui, sans-serif';
    const gap = 16;
    const boxSize = 9;
    const widths = items.map(it => boxSize + 6 + ctx.measureText(it.label).width);
    const totalW = widths.reduce((a, b) => a + b, 0) + gap * (items.length - 1);
    let x = Math.max(4, (canvasWidth - totalW) / 2);
    const y = 6;
    items.forEach((it, i) => {
      ctx.fillStyle = it.color;
      ctx.fillRect(x, y, boxSize, boxSize);
      ctx.fillStyle = textColor;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(it.label, x + boxSize + 6, y - 1);
      x += widths[i] + gap;
    });
  }

  function truncateText(ctx, text, maxWidth) {
    if (ctx.measureText(text).width <= maxWidth) return text;
    let t = text;
    while (t.length > 1 && ctx.measureText(t + '…').width > maxWidth) t = t.slice(0, -1);
    return t + '…';
  }

  /* ---------------- Chart 1: รายรับ vs รายจ่าย (grouped bar) ---------------- */

  function renderSalaryExpenseChart(rows) {
    lastRows = rows;
    const canvas = document.getElementById('salaryExpenseChart');
    if (!canvas) return;

    const hasData = rows.some(r => r.salary > 0 || r.expenses > 0);
    toggleEmpty('salaryExpenseChart', 'salaryExpenseEmpty', !hasData);
    if (!hasData) return;

    const { ctx, width, height } = setupCanvas(canvas);
    if (width < 20 || height < 20) return;

    const primary = getCssVar('--color-primary') || '#2F8F5B';
    const danger = getCssVar('--color-danger') || '#C6483D';
    const textColor = getCssVar('--color-text-muted') || '#6C776D';
    const strongText = getCssVar('--color-text') || '#1F2B24';
    const gridColor = getCssVar('--color-border') || '#E4E0D2';

    const labels = rows.map(r => MM.monthLabelShort(r.monthKey));
    const salaryData = rows.map(r => r.salary);
    const expenseData = rows.map(r => r.expenses);
    const maxVal = niceCeil(Math.max(1, ...salaryData, ...expenseData));

    ctx.font = '11px "Noto Sans Thai", system-ui, sans-serif';
    const yLabelSamples = [0, maxVal / 2, maxVal].map(v => MM.formatMoneyPlain(v));
    const yAxisW = Math.max(...yLabelSamples.map(s => ctx.measureText(s).width)) + 14;

    const padding = { top: 30, right: 10, bottom: 26, left: yAxisW };
    const chartW = width - padding.left - padding.right;
    const chartH = height - padding.top - padding.bottom;
    if (chartW <= 0 || chartH <= 0) return;

    // Gridlines + y-axis labels
    const steps = 4;
    ctx.strokeStyle = gridColor;
    ctx.lineWidth = 1;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let i = 0; i <= steps; i++) {
      const v = (maxVal / steps) * i;
      const y = padding.top + chartH - (v / maxVal) * chartH;
      ctx.beginPath();
      ctx.moveTo(padding.left, Math.round(y) + 0.5);
      ctx.lineTo(padding.left + chartW, Math.round(y) + 0.5);
      ctx.stroke();
      ctx.fillStyle = textColor;
      ctx.fillText(MM.formatMoneyPlain(v), padding.left - 8, y);
    }

    // Bars (grouped per month)
    const n = rows.length;
    const groupW = chartW / n;
    const barW = Math.max(4, Math.min(26, groupW * 0.32));
    const gap = barW * 0.25;
    const baseY = padding.top + chartH;

    ctx.font = '11px "Noto Sans Thai", system-ui, sans-serif';
    labels.forEach((label, i) => {
      const groupX = padding.left + groupW * i + groupW / 2;
      const sV = salaryData[i], eV = expenseData[i];
      const sH = (sV / maxVal) * chartH;
      const eH = (eV / maxVal) * chartH;
      const sX = groupX - gap / 2 - barW;
      const eX = groupX + gap / 2;

      drawRoundedBar(ctx, sX, baseY - sH, barW, sH, primary);
      drawRoundedBar(ctx, eX, baseY - eH, barW, eH, danger);

      ctx.fillStyle = textColor;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(label, groupX, baseY + 8);
    });

    drawLegendRow(ctx, width, [
      { color: primary, label: 'รายรับ' },
      { color: danger, label: 'รายจ่าย' }
    ], strongText);
  }

  /* ---------------- Chart 2: ค่าใช้จ่ายตามหมวดหมู่ (donut) ---------------- */

  async function renderCategoryChart(months) {
    lastMonths = months;
    const canvas = document.getElementById('categoryChart');
    if (!canvas) return;

    const categories = await MM.loadCategories();
    const totals = {};
    categories.forEach(c => { totals[c.id] = 0; });

    months.forEach(mk => {
      MM.getTransactionsForMonth(mk).forEach(tx => {
        totals[tx.categoryId] = (totals[tx.categoryId] || 0) + (Number(tx.amount) || 0);
      });
    });

    const usedCategories = categories.filter(c => totals[c.id] > 0);
    const hasData = usedCategories.length > 0;
    toggleEmpty('categoryChart', 'categoryEmpty', !hasData);
    if (!hasData) return;

    const { ctx, width, height } = setupCanvas(canvas);
    if (width < 20 || height < 20) return;

    const surface = getCssVar('--color-surface') || '#FFFFFF';
    const textColor = getCssVar('--color-text-muted') || '#6C776D';
    const strongText = getCssVar('--color-text') || '#1F2B24';

    const total = usedCategories.reduce((s, c) => s + totals[c.id], 0);

    const legendRows = Math.ceil(usedCategories.length / 2);
    const rowH = 18;
    const legendH = legendRows * rowH + 10;
    const donutAreaH = Math.max(80, height - legendH);

    const cx = width / 2;
    const cy = donutAreaH / 2;
    const outerR = Math.max(10, Math.min(cx - 4, cy - 4) * 0.92);
    const innerR = outerR * 0.6;

    let startAngle = -Math.PI / 2;
    usedCategories.forEach(c => {
      const value = totals[c.id];
      const angle = (value / total) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, outerR, startAngle, startAngle + angle);
      ctx.closePath();
      ctx.fillStyle = c.color;
      ctx.fill();
      startAngle += angle;
    });

    // Donut hole, matching the card background so it reads as a ring
    ctx.beginPath();
    ctx.arc(cx, cy, innerR, 0, Math.PI * 2);
    ctx.fillStyle = surface;
    ctx.fill();

    // Center label: total spend across the used categories
    ctx.fillStyle = strongText;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '700 14px "Kanit", system-ui, sans-serif';
    ctx.fillText(truncateText(ctx, MM.formatMoneyPlain(total), innerR * 1.7), cx, cy - 7);
    ctx.font = '10.5px "Noto Sans Thai", system-ui, sans-serif';
    ctx.fillStyle = textColor;
    ctx.fillText('รวมรายจ่าย', cx, cy + 10);

    // Legend, two columns below the donut
    ctx.font = '11.5px "Noto Sans Thai", system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const colW = width / 2;
    const legendTop = donutAreaH + 6;
    usedCategories.forEach((c, i) => {
      const col = i % 2;
      const row = Math.floor(i / 2);
      const x = 4 + col * colW;
      const y = legendTop + row * rowH + rowH / 2;
      ctx.fillStyle = c.color;
      ctx.fillRect(x, y - 5, 10, 10);
      const pct = Math.round((totals[c.id] / total) * 100);
      ctx.fillStyle = strongText;
      const label = `${c.icon} ${c.label} · ${pct}%`;
      ctx.fillText(truncateText(ctx, label, colW - 20), x + 16, y);
    });
  }

  /* ---------------- Redraw on resize / theme change ---------------- */

  function redrawAll() {
    if (lastRows) renderSalaryExpenseChart(lastRows);
    if (lastMonths) renderCategoryChart(lastMonths);
  }

  let resizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(redrawAll, 150);
  });
  document.addEventListener('moneymate:theme-changed', redrawAll);

  window.MMCharts = { renderSalaryExpenseChart, renderCategoryChart };

})();
