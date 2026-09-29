/* =========================================================
   MoneyMate - summary.js  (history page)
   - Summary by day / month / year (optionally incl. deleted items)
   - Save snapshots (kept even after data is deleted)
   - Export summary as PNG image or PDF (no external libs)
   - Trash: view / restore / permanently delete
   ========================================================= */
(function () {
  'use strict';
  let current = null; // summary data currently shown
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const money = n => MM.formatMoney(n);

  function periodKey(type) {
    if (type === 'day') return $('sumDay').value || MM.todayISO();
    if (type === 'month') return $('sumMonth').value || MM.currentMonthKey();
    return $('sumYear').value || String(new Date().getFullYear());
  }
  function periodTitle(type, key) {
    if (type === 'day') return 'สรุปรายวัน ' + MM.formatDateThai(key);
    if (type === 'month') return 'สรุปรายเดือน ' + MM.monthLabel(key);
    return 'สรุปรายปี พ.ศ. ' + (Number(key) + 543);
  }

  function compute(type, key, includeDeleted) {
    const cats = MM.getCategoryById;
    const inP = d => d && d.startsWith(key);
    const items = [];
    MM.getIncomes().filter(i => inP(i.date) && !i.internal).forEach(i => items.push({ kind: 'income', date: i.date, label: i.source, amount: i.amount, deleted: false }));
    MM.getAllTransactions().filter(t => inP(t.date)).forEach(t => items.push({ kind: 'expense', date: t.date, label: cats(t.categoryId).label + (t.note ? ' · ' + t.note : ''), cat: cats(t.categoryId).label, source: t.source || '', amount: t.amount, deleted: false }));
    if (includeDeleted) {
      MM.getTrash().forEach(z => {
        const it = z.item; if (!inP(it.date)) return;
        if (z.type === 'income') items.push({ kind: 'income', date: it.date, label: it.source, amount: it.amount, deleted: true });
        else items.push({ kind: 'expense', date: it.date, label: cats(it.categoryId).label + (it.note ? ' · ' + it.note : ''), cat: cats(it.categoryId).label, source: it.source || '', amount: it.amount, deleted: true });
      });
    }
    items.sort((a, b) => b.date.localeCompare(a.date));
    const sum = arr => arr.reduce((s, x) => s + (Number(x.amount) || 0), 0);
    const inc = items.filter(i => i.kind === 'income'), exp = items.filter(i => i.kind === 'expense');
    const group = (arr, f) => { const m = {}; arr.forEach(x => { const k = f(x) || 'ไม่ระบุ'; m[k] = (m[k] || 0) + x.amount; }); return Object.entries(m).sort((a, b) => b[1] - a[1]); };
    return {
      type, key, title: periodTitle(type, key), includeDeleted, createdAt: Date.now(),
      income: sum(inc), expense: sum(exp), balance: sum(inc) - sum(exp),
      bySource: group(inc, x => x.label), byCat: group(exp, x => x.cat), items
    };
  }

  function summaryHTML(d) {
    const list = (rows) => rows.length ? rows.map(r => `<div class="tx-row" style="padding:6px 0"><div class="tx-info"><div class="t1">${esc(r[0])}</div></div><div class="tx-amount">${money(r[1])}</div></div>`).join('') : '<div class="muted">-</div>';
    return `<h3 style="margin:0 0 10px">${esc(d.title)}${d.includeDeleted ? ' <small class="muted">(รวมที่ลบแล้ว)</small>' : ''}</h3>
      <div class="stat-row">
        <div class="card"><div class="card-title">รายรับ</div><div class="amount">${money(d.income)}</div></div>
        <div class="card"><div class="card-title">รายจ่าย</div><div class="amount negative">${money(d.expense)}</div></div>
        <div class="card"><div class="card-title">คงเหลือ</div><div class="amount">${money(d.balance)}</div></div>
      </div>
      <div class="charts-grid">
        <div class="card"><div class="card-title">รายรับตามแหล่งที่มา</div>${list(d.bySource)}</div>
        <div class="card"><div class="card-title">รายจ่ายตามหมวดหมู่</div>${list(d.byCat)}</div>
      </div>
      <div class="card"><div class="card-title">รายการทั้งหมด (${d.items.length})</div>
        ${d.items.length ? d.items.map(i => `<div class="tx-row" style="padding:6px 0;${i.deleted ? 'opacity:.55' : ''}"><div class="tx-info"><div class="t1">${esc(i.label)}${i.deleted ? ' 🗑️ลบแล้ว' : ''}</div><div class="t2">${MM.formatDateThai(i.date)}${i.source ? ' · จาก ' + esc(i.source) : ''}</div></div><div class="tx-amount" style="${i.kind === 'income' ? 'color:#2F8F5B' : ''}">${i.kind === 'income' ? '+' : '-'}${money(i.amount)}</div></div>`).join('') : '<div class="muted">ไม่มีรายการในช่วงนี้</div>'}
      </div>`;
  }

  function show(d) {
    current = d;
    $('summaryBody').innerHTML = summaryHTML(d);
    $('summaryActions').style.display = 'flex';
  }
  function refresh() {
    const type = $('sumType').value;
    $('sumDay').style.display = type === 'day' ? '' : 'none';
    $('sumMonth').style.display = type === 'month' ? '' : 'none';
    $('sumYear').style.display = type === 'year' ? '' : 'none';
    show(compute(type, periodKey(type), $('sumDeleted').checked));
  }

  /* ---------- Export: canvas -> PNG / PDF ---------- */
  function drawCanvas(d) {
    const W = 900, P = 40, rowH = 30;
    const rows = d.items.slice(0, 200);
    const H = 330 + Math.max(d.bySource.length, d.byCat.length) * rowH + 60 + rows.length * rowH + 60;
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const x = c.getContext('2d');
    const F = '"Sarabun","Noto Sans Thai","Tahoma",sans-serif';
    x.fillStyle = '#fff'; x.fillRect(0, 0, W, H);
    x.fillStyle = '#2F8F5B'; x.fillRect(0, 0, W, 90);
    x.fillStyle = '#fff'; x.font = `bold 30px ${F}`; x.fillText('MoneyMate  ' + d.title, P, 56);
    x.fillStyle = '#222'; let y = 140;
    [['รายรับ', d.income, '#2F8F5B'], ['รายจ่าย', d.expense, '#C0392B'], ['คงเหลือ', d.balance, '#222']].forEach((s, i) => {
      x.font = `20px ${F}`; x.fillStyle = '#666'; x.fillText(s[0], P + i * 280, y);
      x.font = `bold 30px ${F}`; x.fillStyle = s[2]; x.fillText(MM.formatMoney(s[1]), P + i * 280, y + 40);
    });
    y = 240;
    const block = (title, arr, x0) => {
      x.fillStyle = '#222'; x.font = `bold 22px ${F}`; x.fillText(title, x0, y);
      arr.forEach((r, i) => { x.font = `20px ${F}`; x.fillStyle = '#444'; x.textAlign = 'left'; x.fillText(r[0], x0, y + 34 + i * rowH); x.textAlign = 'right'; x.fillText(MM.formatMoney(r[1]), x0 + 380, y + 34 + i * rowH); x.textAlign = 'left'; });
    };
    block('รายรับตามแหล่งที่มา', d.bySource, P); block('รายจ่ายตามหมวดหมู่', d.byCat, P + 440);
    y += 60 + Math.max(d.bySource.length, d.byCat.length) * rowH + 20;
    x.fillStyle = '#222'; x.font = `bold 22px ${F}`; x.fillText(`รายการทั้งหมด (${d.items.length})`, P, y);
    rows.forEach((r, i) => {
      const yy = y + 36 + i * rowH; x.font = `19px ${F}`; x.fillStyle = r.deleted ? '#999' : '#333';
      x.fillText(MM.formatDateThai(r.date), P, yy);
      x.fillText((r.label + (r.source ? ' [' + r.source + ']' : '') + (r.deleted ? ' (ลบแล้ว)' : '')).slice(0, 44), P + 220, yy);
      x.textAlign = 'right'; x.fillStyle = r.kind === 'income' ? '#2F8F5B' : '#C0392B';
      x.fillText((r.kind === 'income' ? '+' : '-') + MM.formatMoney(r.amount), W - P, yy); x.textAlign = 'left';
    });
    return c;
  }
  function download(blobOrUrl, name) {
    const a = document.createElement('a');
    a.href = typeof blobOrUrl === 'string' ? blobOrUrl : URL.createObjectURL(blobOrUrl);
    a.download = name; document.body.appendChild(a); a.click(); a.remove();
  }
  function fname(d, ext) { return `MoneyMate_${d.type}_${d.key}.${ext}`; }
  function exportPNG(d) { drawCanvas(d).toBlob(b => download(b, fname(d, 'png')), 'image/png'); }
  function exportPDF(d) {
    const c = drawCanvas(d);
    const jpg = atob(c.toDataURL('image/jpeg', 0.92).split(',')[1]);
    const img = new Uint8Array(jpg.length); for (let i = 0; i < jpg.length; i++) img[i] = jpg.charCodeAt(i);
    const pw = 595, ph = Math.round(c.height * pw / c.width);
    const enc = new TextEncoder(), parts = [], offs = []; let len = 0;
    const push = b => { const u = typeof b === 'string' ? enc.encode(b) : b; parts.push(u); len += u.length; };
    const obj = (n, s) => { offs[n] = len; push(`${n} 0 obj\n${s}\nendobj\n`); };
    push('%PDF-1.4\n');
    obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
    obj(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
    obj(3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pw} ${ph}] /Resources << /XObject << /Im0 5 0 R >> >> /Contents 4 0 R >>`);
    const cs = `q ${pw} 0 0 ${ph} 0 0 cm /Im0 Do Q`;
    obj(4, `<< /Length ${cs.length} >>\nstream\n${cs}\nendstream`);
    offs[5] = len; push(`5 0 obj\n<< /Type /XObject /Subtype /Image /Width ${c.width} /Height ${c.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${img.length} >>\nstream\n`); push(img); push('\nendstream\nendobj\n');
    const xr = len; push('xref\n0 6\n0000000000 65535 f \n');
    for (let i = 1; i <= 5; i++) push(String(offs[i]).padStart(10, '0') + ' 00000 n \n');
    push(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xr}\n%%EOF`);
    download(new Blob(parts, { type: 'application/pdf' }), fname(d, 'pdf'));
  }

  /* ---------- Snapshots ---------- */
  function renderSnapshots() {
    const list = MM.readJSON(MM.KEYS.snapshots, []);
    const box = $('snapshotList'); box.innerHTML = '';
    if (!list.length) { box.innerHTML = '<div class="muted">ยังไม่มีสรุปที่บันทึกไว้</div>'; return; }
    list.slice().reverse().forEach(s => {
      const row = document.createElement('div'); row.className = 'tx-row';
      row.innerHTML = `<div class="tx-info"><div class="t1">${esc(s.title)}</div><div class="t2">บันทึกเมื่อ ${new Date(s.createdAt).toLocaleString('th-TH')} · รายรับ ${money(s.income)} · รายจ่าย ${money(s.expense)}</div></div>
        <div class="tx-actions"><button class="btn btn-sm btn-secondary" data-a="view">👁️ ดู</button><button class="btn btn-sm btn-secondary" data-a="png">🖼️</button><button class="btn btn-sm btn-secondary" data-a="pdf">📄</button><button class="btn btn-icon btn-sm" data-a="del">🗑️</button></div>`;
      row.querySelector('[data-a=view]').onclick = () => { show(s); $('summaryBody').scrollIntoView({ behavior: 'smooth' }); };
      row.querySelector('[data-a=png]').onclick = () => exportPNG(s);
      row.querySelector('[data-a=pdf]').onclick = () => exportPDF(s);
      row.querySelector('[data-a=del]').onclick = () => MM.confirmAction('ลบสรุปที่บันทึกไว้นี้ใช่หรือไม่?', () => { MM.writeJSON(MM.KEYS.snapshots, MM.readJSON(MM.KEYS.snapshots, []).filter(z => z.createdAt !== s.createdAt)); renderSnapshots(); });
      box.appendChild(row);
    });
  }

  /* ---------- Trash ---------- */
  function renderTrash() {
    const list = MM.getTrash(); const box = $('trashList'); box.innerHTML = '';
    if (!list.length) { box.innerHTML = '<div class="muted">ถังขยะว่างเปล่า</div>'; return; }
    list.slice().reverse().forEach(z => {
      const it = z.item, isInc = z.type === 'income';
      const label = isInc ? '💰 ' + it.source : MM.getCategoryById(it.categoryId).label + (it.note ? ' · ' + it.note : '');
      const row = document.createElement('div'); row.className = 'tx-row';
      row.innerHTML = `<div class="tx-info"><div class="t1">${esc(label)}</div><div class="t2">${MM.formatDateThai(it.date)} · ลบเมื่อ ${new Date(z.deletedAt).toLocaleDateString('th-TH')}</div></div>
        <div class="tx-amount">${isInc ? '+' : '-'}${money(it.amount)}</div>
        <div class="tx-actions"><button class="btn btn-sm btn-secondary" data-a="res">♻️ กู้คืน</button><button class="btn btn-icon btn-sm" data-a="del">✖</button></div>`;
      const drop = () => MM.saveTrash(MM.getTrash().filter(x => !(x.deletedAt === z.deletedAt && x.item.id === it.id)));
      row.querySelector('[data-a=res]').onclick = () => { drop(); if (isInc) MM.saveIncomes(MM.getIncomes().concat([it])); else MM.saveAllTransactions(MM.getAllTransactions().concat([it])); MM.showToast('กู้คืนเรียบร้อย', 'success'); };
      row.querySelector('[data-a=del]').onclick = () => MM.confirmAction('ลบถาวร? จะไม่ปรากฏในสรุปแบบ "รวมที่ลบแล้ว" อีก', () => { drop(); renderTrash(); refresh(); });
      box.appendChild(row);
    });
  }

  function init() {
    const now = new Date(), yr = now.getFullYear();
    $('sumDay').value = MM.todayISO(); $('sumMonth').value = MM.currentMonthKey();
    $('sumYear').innerHTML = Array.from({ length: 10 }, (_, i) => yr - i).map(y => `<option value="${y}">${y + 543}</option>`).join('');
    ['sumType', 'sumDay', 'sumMonth', 'sumYear', 'sumDeleted'].forEach(id => $(id).addEventListener('change', refresh));
    $('sumPng').onclick = () => current && exportPNG(current);
    $('sumPdf').onclick = () => current && exportPDF(current);
    $('sumSave').onclick = () => {
      if (!current) return;
      const l = MM.readJSON(MM.KEYS.snapshots, []); l.push(Object.assign({}, current, { createdAt: Date.now() }));
      MM.writeJSON(MM.KEYS.snapshots, l); renderSnapshots(); MM.showToast('บันทึกสรุปไว้แล้ว (ลบข้อมูลแล้วก็ยังดูได้)', 'success');
    };
    refresh(); renderSnapshots(); renderTrash();
    document.addEventListener('moneymate:data-changed', () => { refresh(); renderTrash(); });
  }
  document.addEventListener('moneymate:ready', () => { if (document.body.dataset.page === 'history') init(); });
})();
