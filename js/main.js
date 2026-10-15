/*
 * Quad Maze clone – Trang game chính: menu, chọn level, import/export, luồng chơi.
 */
(function () {
  'use strict';

  const $ = function (id) { return document.getElementById(id); };
  const canvas = $('game-canvas');

  // -------- Quản lý level --------
  const store = {
    builtIn: QMLevels.list.slice(),
    custom: [],
    test: null, // level đang test từ editor (chỉ trong phiên, không lưu)
    all: function () {
      return this.test ? [this.test].concat(this.builtIn, this.custom)
        : this.builtIn.concat(this.custom);
    }
  };

  function loadCustom() {
    try {
      const raw = localStorage.getItem('quadmaze.custom');
      if (raw) {
        const res = QMFormat.parseAny(raw);
        if (res.ok) store.custom = res.levels;
      }
    } catch (e) { /* bỏ qua */ }
  }
  function saveCustom() {
    try {
      localStorage.setItem('quadmaze.custom', QMFormat.stringifyPack(store.custom, 'Custom', false));
    } catch (e) { /* bỏ qua */ }
  }

  loadCustom();

  // -------- Game --------
  let game = null;
  let currentIndex = 0;
  let bestTimes = {};
  try { bestTimes = JSON.parse(localStorage.getItem('quadmaze.best') || '{}'); } catch (e) { bestTimes = {}; }

  function ensureGame() {
    if (!game) {
      game = new QuadGame(canvas, {
        onWin: onWin,
        onCheckpoint: function () { /* TODO: sfx */ }
      });
    }
    return game;
  }

  function startLevel(index) {
    const all = store.all();
    if (!all.length) return;
    currentIndex = Math.max(0, Math.min(index, all.length - 1));
    hide('menu'); hide('level-select'); hide('win-overlay');
    ensureGame().load(all[currentIndex]);
  }

  function onWin(time) {
    const lv = store.all()[currentIndex];
    const key = lv.name || String(currentIndex);
    if (!bestTimes[key] || time < bestTimes[key]) {
      bestTimes[key] = time;
      try { localStorage.setItem('quadmaze.best', JSON.stringify(bestTimes)); } catch (e) { /* */ }
    }
    $('win-time').textContent = 'TIME: ' + time.toFixed(2) +
      '  (best: ' + bestTimes[key].toFixed(2) + ')';
    $('btn-next').style.display = (currentIndex + 1 < store.all().length) ? '' : 'none';
    show('win-overlay');
  }

  // -------- Overlay helpers --------
  function show(id) { $(id).classList.remove('hidden'); }
  function hide(id) { $(id).classList.add('hidden'); }

  function renderLevelGrid() {
    const grid = $('level-grid');
    grid.innerHTML = '';
    const all = store.all();
    // Xác định nguồn mỗi level: test (nếu có) -> built-in -> custom.
    const kinds = [];
    if (store.test) kinds.push('test');
    for (let i = 0; i < store.builtIn.length; i++) kinds.push('built-in');
    for (let i = 0; i < store.custom.length; i++) kinds.push('custom');
    all.forEach(function (lv, i) {
      const kind = kinds[i] || 'custom';
      const btn = document.createElement('button');
      const best = bestTimes[lv.name || String(i)];
      btn.className = 'level-btn' + (kind === 'custom' ? ' custom' : '');
      btn.innerHTML = '<strong>' + escapeHtml(lv.name || '#' + (i + 1)) + '</strong>' +
        (best ? '<br><small>' + best.toFixed(2) + 's</small>' : '') +
        (kind === 'test' ? '<br><small>test</small>' : '');
      btn.title = kind;
      btn.addEventListener('click', function () { startLevel(i); });
      grid.appendChild(btn);
    });
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // -------- Import / Export --------
  function handleFile(file) {
    const reader = new FileReader();
    reader.onload = function () {
      const res = QMFormat.parseAny(String(reader.result));
      const msg = $('import-msg');
      if (!res.ok) {
        msg.textContent = 'Lỗi import: ' + res.errors.join('; ');
        msg.className = 'hint error';
        return;
      }
      store.custom = store.custom.concat(res.levels);
      saveCustom();
      renderLevelGrid();
      msg.textContent = 'Đã import ' + res.levels.length + ' level: ' +
        res.levels.map(function (l) { return l.name; }).join(', ') +
        (res.errors.length ? ' (cảnh báo: ' + res.errors.length + ')' : '');
      msg.className = 'hint ok';
      show('level-select'); hide('menu');
    };
    reader.readAsText(file);
  }

  function exportPack() {
    const data = QMFormat.stringifyPack(store.all(), 'Quad Maze Pack');
    const blob = new Blob([data], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'quadmaze-levels.json';
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
  }

  // -------- Gắn sự kiện --------
  $('btn-play').addEventListener('click', function () { startLevel(0); });
  $('btn-levels').addEventListener('click', function () { renderLevelGrid(); show('level-select'); hide('menu'); });
  $('btn-editor').addEventListener('click', function () { location.href = 'editor.html'; });
  $('btn-back-menu').addEventListener('click', function () { hide('level-select'); show('menu'); });
  $('btn-export-all').addEventListener('click', exportPack);
  $('btn-import').addEventListener('click', function () { $('file-input').click(); });
  $('btn-import2').addEventListener('click', function () { $('file-input').click(); });
  $('file-input').addEventListener('change', function (e) {
    if (e.target.files && e.target.files[0]) handleFile(e.target.files[0]);
    e.target.value = '';
  });
  $('btn-next').addEventListener('click', function () { startLevel(currentIndex + 1); });
  $('btn-retry').addEventListener('click', function () { startLevel(currentIndex); });
  $('btn-win-menu').addEventListener('click', function () {
    hide('win-overlay'); show('menu');
    if (game) game.state = 'paused';
  });

  // Click chuột trên canvas = nhảy (khi đang chơi).
  canvas.addEventListener('pointerdown', function () {
    if (game && game.state === 'playing') game.jump();
  });

  // Enter -> tiếp tục / bắt đầu.
  window.addEventListener('keydown', function (e) {
    if (e.code === 'Enter') {
      if (!$('win-overlay').classList.contains('hidden')) startLevel(currentIndex + 1);
      else if (!$('menu').classList.contains('hidden')) startLevel(0);
    }
  });

  // Kéo-thả file JSON vào trang để import.
  window.addEventListener('dragover', function (e) { e.preventDefault(); });
  window.addEventListener('drop', function (e) {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
  });

  renderLevelGrid();

  // -------- Test từ editor: index.html?test=1 --------
  (function maybeTestLevel() {
    if (!/[?&]test=1/.test(location.search)) return;
    let raw = null;
    try { raw = localStorage.getItem('quadmaze.test'); } catch (e) { /* */ }
    if (!raw) return;
    const res = QMFormat.parse(raw);
    if (!res.ok) {
      $('import-msg').textContent = 'Level test lỗi: ' + res.errors.join('; ');
      $('import-msg').className = 'hint error';
      return;
    }
    // Level test đứng đầu danh sách, không ghi vào custom (không persist).
    store.test = res.level;
    renderLevelGrid();
    startLevel(0);
  })();
})();
