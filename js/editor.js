/*
 * Quad Maze clone – Level Editor.
 * Công cụ: chọn/di chuyển, vẽ wall (kéo), đặt saw (kéo = to), spawn, goal,
 * checkpoint, xóa. Hỗ trợ snap lưới, Shift = tự do, undo, export/import JSON.
 */
(function () {
  'use strict';

  const $ = function (id) { return document.getElementById(id); };
  const R = window.QMRender; // renderer helpers (render.js load trước)
  const canvas = $('ed-canvas');
  const ctx = canvas.getContext('2d');

  // -------- State --------
  let level = QMFormat.makeDefaultLevel();
  let tool = 'select';
  let sel = null;          // {kind:'wall'|'saw'|'checkpoint', index:number}
  let undoStack = [];
  let hover = null;        // ô lưới đang trỏ chuột {x,y}
  let drag = null;         // phiên kéo hiện tại
  let propsDirty = false;  // đang gõ trong props -> không render lại props

  const SNAP = 1;          // snap 1 ô

  // -------- Undo --------
  function pushUndo() {
    undoStack.push(JSON.stringify(level));
    if (undoStack.length > 60) undoStack.shift();
  }
  function undo() {
    if (!undoStack.length) return;
    level = JSON.parse(undoStack.pop());
    sel = null;
    syncTopbar();
    renderProps();
    draw();
    msg('Đã undo');
  }

  function msg(text, isErr) {
    const el = $('ed-msg');
    el.textContent = text;
    el.className = 'hint ' + (isErr ? 'error' : 'ok');
    clearTimeout(msg._t);
    msg._t = setTimeout(function () { el.textContent = ''; }, 4000);
  }

  // -------- Tọa độ canvas -> cell --------
  let view = { scale: 24, ox: 8, oy: 8 };

  function computeView() {
    const wrap = $('ed-canvas-wrap');
    const W = wrap.clientWidth, H = wrap.clientHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const pad = 32;
    const scale = Math.min((W - pad * 2) / level.box.w, (H - pad * 2) / level.box.h);
    view = {
      scale: scale,
      ox: Math.round((W - level.box.w * scale) / 2),
      oy: Math.round((H - level.box.h * scale) / 2),
      W: W, H: H
    };
  }

  function cellToPx(x, y) { return { x: view.ox + x * view.scale, y: view.oy + y * view.scale }; }

  function pxToCell(px, py) {
    return { x: (px - view.ox) / view.scale, y: (py - view.oy) / view.scale };
  }

  function snap(v, free) { return free ? Math.round(v * 2) / 2 : Math.round(v); }

  // -------- Hit test --------
  function hitWall(c) {
    for (let i = level.walls.length - 1; i >= 0; i--) {
      const w = level.walls[i];
      // Transform điểm về không gian local của wall (hỗ trợ rot).
      const cx = w.x + w.w / 2, cy = w.y + w.h / 2;
      const dx = c.x - cx, dy = c.y - cy;
      const a = -(w.rot || 0) * Math.PI / 180;
      const lx = dx * Math.cos(a) - dy * Math.sin(a);
      const ly = dx * Math.sin(a) + dy * Math.cos(a);
      if (Math.abs(lx) <= w.w / 2 && Math.abs(ly) <= w.h / 2) return i;
    }
    return -1;
  }
  function hitSaw(c) {
    for (let i = level.saws.length - 1; i >= 0; i--) {
      const s = level.saws[i];
      const cx = s.x + s.size / 2, cy = s.y + s.size / 2;
      if (Math.hypot(c.x - cx, c.y - cy) <= s.size / 2) return i;
    }
    return -1;
  }
  function hitCheckpoint(c) {
    for (let i = level.checkpoints.length - 1; i >= 0; i--) {
      const p = level.checkpoints[i];
      if (c.x >= p.x && c.x <= p.x + 1 && c.y >= p.y && c.y <= p.y + 1) return i;
    }
    return -1;
  }
  function hitMarker(c, kind) {
    const m = kind === 'spawn' ? level.spawn : level.goal;
    if (c.x >= m.x && c.x <= m.x + 1 && c.y >= m.y && c.y <= m.y + 1) return true;
    return false;
  }
  // Truy xuất object theo hit descriptor.
  function objOf(hit) {
    if (hit.kind === 'wall') return level.walls[hit.index];
    if (hit.kind === 'saw') return level.saws[hit.index];
    if (hit.kind === 'checkpoint') return level.checkpoints[hit.index];
    if (hit.kind === 'spawn') return level.spawn;
    if (hit.kind === 'goal') return level.goal;
    return null;
  }
  function hitAny(c) {
    const s = hitSaw(c); if (s >= 0) return { kind: 'saw', index: s };
    const w = hitWall(c); if (w >= 0) return { kind: 'wall', index: w };
    const k = hitCheckpoint(c); if (k >= 0) return { kind: 'checkpoint', index: k };
    if (hitMarker(c, 'goal')) return { kind: 'goal' };      // goal trước spawn (nếu chồng nhau)
    if (hitMarker(c, 'spawn')) return { kind: 'spawn' };
    return null;
  }

  // -------- Vẽ --------
  function draw() {
    computeViewIfNeed();
    const W = view.W, H = view.H;
    ctx.fillStyle = '#3a3a40';
    ctx.fillRect(0, 0, W, H);

    const bx = view.ox, by = view.oy;
    const bw = level.box.w * view.scale, bh = level.box.h * view.scale;

    // Nền box: sọc đỏ chéo.
    R.drawStripes(ctx, bx, by, bw, bh, view.scale);
    // Lưới mờ.
    R.drawGrid(ctx, bx, by, level.box.w, level.box.h, view.scale);

    // Walls.
    for (let i = 0; i < level.walls.length; i++) {
      const w = level.walls[i];
      R.drawWallRect(ctx, w, view);
      if (sel && sel.kind === 'wall' && sel.index === i) outline(w.x, w.y, w.w, w.h, w.rot);
    }

    // Markers.
    drawMarkerSel(level.spawn, sel && sel.kind === 'spawn');
    drawMarkerSel(level.goal, sel && sel.kind === 'goal');
    for (let i = 0; i < level.checkpoints.length; i++) {
      const c = level.checkpoints[i];
      drawMarkerSel(c, sel && sel.kind === 'checkpoint' && sel.index === i);
    }

    // Saws (khung dây để thấy vùng nguy hiểm, không animate trong editor).
    for (let i = 0; i < level.saws.length; i++) {
      const s = level.saws[i];
      const p = cellToPx(s.x + s.size / 2, s.y + s.size / 2);
      R.drawSaw(ctx, p.x, p.y, s.size * view.scale, (s.spin >= 0 ? 1 : -1) * Math.PI / 8);
      if (sel && sel.kind === 'saw' && sel.index === i) {
        ctx.strokeStyle = R.COLORS.select;
        ctx.lineWidth = 2;
        ctx.strokeRect(p.x - s.size * view.scale / 2, p.y - s.size * view.scale / 2,
          s.size * view.scale, s.size * view.scale);
      }
    }

    // Preview kéo (wall/saw mới).
    if (drag && drag.mode === 'drawWall') {
      const r = normRect(drag.from, drag.to);
      ctx.globalAlpha = 0.6;
      R.drawWallRect(ctx, r, view);
      ctx.globalAlpha = 1;
    }
    if (drag && drag.mode === 'drawSaw') {
      const size = Math.max(0.5, drag.size || 1.5);
      // Trùng với vị trí thật: tâm = điểm bắt đầu kéo.
      const p = cellToPx(drag.from.x, drag.from.y);
      ctx.globalAlpha = 0.6;
      R.drawSaw(ctx, p.x, p.y, size * view.scale, Math.PI / 8);
      ctx.globalAlpha = 1;
    }

    // Hover lưới.
    if (hover && tool !== 'select') {
      const p = cellToPx(hover.x, hover.y);
      ctx.strokeStyle = 'rgba(255,255,255,0.5)';
      ctx.lineWidth = 1;
      ctx.strokeRect(p.x + 0.5, p.y + 0.5, view.scale, view.scale);
    }

    // Viền box (đỏ đậm hơn để thấy ranh giới).
    ctx.strokeStyle = '#26262a';
    ctx.lineWidth = 3;
    ctx.strokeRect(bx - 1.5, by - 1.5, bw + 3, bh + 3);
  }

  let _needCompute = true;
  function computeViewIfNeed() { if (_needCompute) { computeView(); _needCompute = false; } }

  function outline(x, y, w, h, rot) {
    const p = cellToPx(x + w / 2, y + h / 2);
    ctx.save();
    ctx.translate(p.x, p.y);
    if (rot) ctx.rotate(rot * Math.PI / 180);
    ctx.strokeStyle = R.COLORS.select;
    ctx.lineWidth = 2;
    ctx.strokeRect(-w * view.scale / 2 - 2, -h * view.scale / 2 - 2, w * view.scale + 4, h * view.scale + 4);
    ctx.restore();
  }

  function drawMarkerSel(m, selected) {
    const p = cellToPx(m.x, m.y);
    R.drawMarker(ctx, p.x, p.y, view.scale);
    if (selected) {
      ctx.strokeStyle = R.COLORS.select;
      ctx.lineWidth = 2;
      ctx.strokeRect(p.x - 2, p.y - 2, view.scale + 4, view.scale + 4);
    }
  }

  function normRect(a, b) {
    return {
      x: Math.min(a.x, b.x), y: Math.min(a.y, b.y),
      w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y),
      rot: drag && drag.rot ? drag.rot : 0
    };
  }

  // -------- Chuột --------
  function evCell(e) {
    const rect = canvas.getBoundingClientRect();
    return pxToCell(e.clientX - rect.left, e.clientY - rect.top);
  }

  canvas.addEventListener('pointerdown', function (e) {
    canvas.setPointerCapture(e.pointerId);
    const c = evCell(e);
    const free = e.shiftKey;

    if (tool === 'select') {
      const hit = hitAny(c);
      sel = hit;
      if (hit) {
        pushUndo();
        const obj = objOf(hit);
        drag = {
          mode: 'move', kind: hit.kind, index: hit.index,
          dx: c.x - obj.x, dy: c.y - obj.y
        };
      }
      renderProps();
      draw();
      return;
    }

    if (tool === 'wall') {
      pushUndo();
      drag = { mode: 'drawWall', from: { x: snap(c.x, free), y: snap(c.y, free) }, to: { x: snap(c.x, free), y: snap(c.y, free) }, rot: 0 };
      return;
    }

    if (tool === 'saw') {
      pushUndo();
      drag = { mode: 'drawSaw', from: { x: snap(c.x, free) - 0.75, y: snap(c.y, free) - 0.75 }, to: null, size: 1.5 };
      drag.from = { x: c.x, y: c.y };
      return;
    }

    if (tool === 'spawn' || tool === 'goal') {
      pushUndo();
      const p = { x: snap(c.x, free), y: snap(c.y, free) };
      if (tool === 'spawn') level.spawn = p; else level.goal = p;
      sel = { kind: tool };
      renderProps(); renderList(); draw();
      return;
    }

    if (tool === 'checkpoint') {
      pushUndo();
      level.checkpoints.push({ x: snap(c.x, free), y: snap(c.y, free) });
      sel = { kind: 'checkpoint', index: level.checkpoints.length - 1 };
      renderProps(); renderList(); draw();
      return;
    }

    if (tool === 'erase') {
      const hit = hitAny(c);
      // Spawn/goal là duy nhất – không cho xóa, chỉ kéo-di chuyển bằng tool Chọn.
      if (hit && hit.kind !== 'spawn' && hit.kind !== 'goal') {
        pushUndo();
        if (hit.kind === 'wall') level.walls.splice(hit.index, 1);
        else if (hit.kind === 'saw') level.saws.splice(hit.index, 1);
        else level.checkpoints.splice(hit.index, 1);
        if (sel && sel.kind === hit.kind && sel.index === hit.index) sel = null;
        renderProps(); renderList(); draw();
      } else if (hit) {
        msg('Không thể xóa ' + hit.kind + ' – hãy kéo nó đi chỗ khác', true);
      }
      return;
    }
  });

  canvas.addEventListener('pointermove', function (e) {
    const c = evCell(e);
    const free = e.shiftKey;
    hover = { x: snap(c.x, true), y: snap(c.y, true) };

    if (!drag) { draw(); return; }

    if (drag.mode === 'drawWall') {
      drag.to = { x: snap(c.x, free), y: snap(c.y, free) };
    } else if (drag.mode === 'drawSaw') {
      drag.size = Math.max(0.5, Math.hypot(c.x - drag.from.x, c.y - drag.from.y));
      drag.to = c;
    } else if (drag.mode === 'move') {
      const obj = objOf(drag);
      obj.x = snap(c.x - drag.dx, free);
      obj.y = snap(c.y - drag.dy, free);
      if (!propsDirty) renderProps();
    }
    draw();
  });

  canvas.addEventListener('pointerup', function (e) {
    if (!drag) return;
    if (drag.mode === 'drawWall') {
      const r = normRect(drag.from, drag.to || drag.from);
      if (r.w >= 0.5 && r.h >= 0.5) {
        r.motion = { type: 'static', distance: 0, speed: 2, phase: 0 };
        level.walls.push(r);
        sel = { kind: 'wall', index: level.walls.length - 1 };
        msg('Thêm wall ' + r.w + '×' + r.h + ' @(' + r.x + ',' + r.y + ')');
      } else {
        undoStack.pop(); // hủy nếu quá nhỏ
        msg('Wall quá nhỏ – bỏ qua', true);
      }
    } else if (drag.mode === 'drawSaw') {
      const size = Math.max(0.5, drag.size || 1.5);
      level.saws.push({
        x: drag.from.x - size / 2, y: drag.from.y - size / 2,
        size: Math.round(size * 4) / 4, spin: 90,
        motion: { type: 'static', distance: 0, speed: 2, phase: 0 }
      });
      sel = { kind: 'saw', index: level.saws.length - 1 };
      msg('Thêm saw size ' + Math.round(size * 4) / 4);
    }
    drag = null;
    renderProps(); renderList(); draw();
  });

  canvas.addEventListener('pointerleave', function () { hover = null; draw(); });

  // -------- Properties panel --------
  function renderProps() {
    propsDirty = false;
    const body = $('ed-props-body');
    if (!sel) {
      body.innerHTML = '<p class="hint">Chọn 1 thành phần để sửa.<br><br>' +
        'Tổng: ' + level.walls.length + ' wall, ' + level.saws.length + ' saw, ' +
        level.checkpoints.length + ' checkpoint.</p>';
      return;
    }
    let html = '';
    if (sel.kind === 'wall') {
      const w = level.walls[sel.index];
      if (!w) { sel = null; return renderProps(); }
      html =
        '<h4>WALL</h4>' +
        numRow('X', 'x', w.x) + numRow('Y', 'y', w.y) +
        numRow('Rộng', 'w', w.w, 0.5) + numRow('Cao', 'h', w.h, 0.5) +
        numRow('Xoay (độ)', 'rot', w.rot || 0, 15) +
        motionHtml(w.motion);
    } else if (sel.kind === 'saw') {
      const s = level.saws[sel.index];
      if (!s) { sel = null; return renderProps(); }
      html =
        '<h4>SAW</h4>' +
        numRow('X', 'x', s.x) + numRow('Y', 'y', s.y) +
        numRow('Kích cỡ', 'size', s.size, 0.25) +
        numRow('Tốc độ xoay (độ/giây)', 'spin', s.spin, 10) +
        motionHtml(s.motion);
    } else if (sel.kind === 'checkpoint') {
      const c = level.checkpoints[sel.index];
      if (!c) { sel = null; return renderProps(); }
      html = '<h4>CHECKPOINT</h4>' + numRow('X', 'x', c.x) + numRow('Y', 'y', c.y);
    } else if (sel.kind === 'spawn' || sel.kind === 'goal') {
      const m = sel.kind === 'spawn' ? level.spawn : level.goal;
      html = '<h4>' + sel.kind.toUpperCase() + '</h4>' + numRow('X', 'x', m.x) + numRow('Y', 'y', m.y);
    }
    html += '<button id="ed-del" class="danger">Xóa (Del)</button>';
    body.innerHTML = html;
    bindProps(sel.kind === 'spawn' || sel.kind === 'goal'
      ? (sel.kind === 'spawn' ? level.spawn : level.goal)
      : sel.kind === 'wall' ? level.walls[sel.index]
        : sel.kind === 'saw' ? level.saws[sel.index]
          : level.checkpoints[sel.index]);
    $('ed-del').addEventListener('click', deleteSelection);
  }

  function numRow(label, key, val, step) {
    return '<label class="prow">' + label +
      '<input type="number" data-k="' + key + '" value="' + val + '" step="' + (step || 1) + '"></label>';
  }

  function motionHtml(m) {
    const types = ['static', 'horizontal', 'vertical', 'circle'];
    let opts = '';
    types.forEach(function (t) {
      opts += '<option value="' + t + '"' + (m.type === t ? ' selected' : '') + '>' + t + '</option>';
    });
    return '<label class="prow">Chuyển động<select data-k="motion.type">' + opts + '</select></label>' +
      '<label class="prow">Quãng đường (ô)<input type="number" data-k="motion.distance" step="0.5" value="' + m.distance + '"></label>' +
      '<label class="prow">Tốc độ (chu kỳ/giây)<input type="number" data-k="motion.speed" step="0.1" value="' + m.speed + '"></label>' +
      '<label class="prow">Pha (0..1)<input type="number" data-k="motion.phase" step="0.1" value="' + m.phase + '"></label>';
  }

  function bindProps(obj) {
    if (!obj) return;
    const inputs = $('ed-props-body').querySelectorAll('input,select');
    let editing = false;
    inputs.forEach(function (inp) {
      inp.addEventListener('focus', function () {
        if (!editing) { pushUndo(); editing = true; }
        propsDirty = true;
      });
      inp.addEventListener('input', function () {
        const k = inp.dataset.k;
        if (k === 'motion.type') obj.motion.type = inp.value;
        else if (k.indexOf('motion.') === 0) obj.motion[k.slice(7)] = parseFloat(inp.value) || 0;
        else {
          let v = parseFloat(inp.value);
          if (isNaN(v)) return;
          if (k === 'w' || k === 'h') v = Math.max(0.5, v);
          if (k === 'size') v = Math.max(0.25, v);
          obj[k] = v;
        }
        draw(); renderList();
      });
      inp.addEventListener('blur', function () { editing = false; propsDirty = false; });
    });
  }

  function deleteSelection() {
    if (!sel) return;
    pushUndo();
    if (sel.kind === 'wall') level.walls.splice(sel.index, 1);
    else if (sel.kind === 'saw') level.saws.splice(sel.index, 1);
    else if (sel.kind === 'checkpoint') level.checkpoints.splice(sel.index, 1);
    else if (sel.kind === 'spawn') level.spawn = { x: 1, y: 1 };
    else if (sel.kind === 'goal') level.goal = { x: level.box.w - 2, y: level.box.h - 3 };
    sel = null;
    renderProps(); renderList(); draw();
    msg('Đã xóa');
  }

  // -------- Danh sách thành phần (bên trái) --------
  function renderList() {
    const ul = $('ed-list');
    ul.innerHTML = '';
    function item(label, kind, index) {
      const li = document.createElement('li');
      li.textContent = label;
      if (sel && sel.kind === kind && sel.index === index) li.className = 'active';
      li.addEventListener('click', function () {
        sel = { kind: kind, index: index };
        setTool('select');
        renderProps(); renderList(); draw();
      });
      ul.appendChild(li);
    }
    level.walls.forEach(function (w, i) {
      item('Wall ' + w.w + '×' + w.h + (w.rot ? ' ↻' + w.rot + '°' : ''), 'wall', i);
    });
    level.saws.forEach(function (s, i) {
      item('Saw ' + s.size + (s.motion.type !== 'static' ? ' ⇄' : ''), 'saw', i);
    });
    level.checkpoints.forEach(function (c, i) {
      item('Checkpoint @' + c.x + ',' + c.y, 'checkpoint', i);
    });
  }

  // -------- Toolbar --------
  function setTool(t) {
    tool = t;
    document.querySelectorAll('#ed-tools .tool').forEach(function (b) {
      b.classList.toggle('active', b.dataset.tool === t);
    });
    canvas.style.cursor = (t === 'select' || t === 'erase') ? 'default' : 'crosshair';
    draw();
  }

  document.querySelectorAll('#ed-tools .tool').forEach(function (b) {
    b.addEventListener('click', function () { setTool(b.dataset.tool); });
  });

  function syncTopbar() {
    $('ed-name').value = level.name;
    $('ed-bw').value = level.box.w;
    $('ed-bh').value = level.box.h;
  }

  $('ed-name').addEventListener('input', function () { level.name = this.value; });
  function applyBox() {
    pushUndo();
    level.box.w = Math.max(8, Math.min(300, parseInt($('ed-bw').value, 10) || 36));
    level.box.h = Math.max(6, Math.min(200, parseInt($('ed-bh').value, 10) || 20));
    _needCompute = true;
    draw();
  }
  $('ed-bw').addEventListener('change', applyBox);
  $('ed-bh').addEventListener('change', applyBox);

  $('ed-new').addEventListener('click', function () {
    if (!confirm('Tạo level mới? Mọi thay đổi chưa export sẽ mất.')) return;
    pushUndo();
    level = QMFormat.makeDefaultLevel();
    sel = null;
    syncTopbar(); renderProps(); renderList();
    _needCompute = true; draw();
    msg('Đã tạo level mới');
  });

  $('ed-undo').addEventListener('click', undo);

  $('ed-test').addEventListener('click', function () {
    // Gửi level sang trang game qua localStorage rồi mở tab mới.
    try { localStorage.setItem('quadmaze.test', QMFormat.stringify(level)); } catch (e) { /* */ }
    window.open('index.html?test=1', '_blank');
  });

  $('ed-play').addEventListener('click', function () { location.href = 'index.html'; });

  $('ed-export').addEventListener('click', function () {
    const data = QMFormat.stringify(level);
    const blob = new Blob([data], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (level.name || 'level').replace(/[^\w\-]+/g, '_') + '.quadmaze.json';
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
    msg('Đã export ' + a.download);
  });

  $('ed-import').addEventListener('click', function () { $('ed-file').click(); });
  $('ed-file').addEventListener('change', function (e) {
    const f = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!f) return;
    const reader = new FileReader();
    reader.onload = function () {
      const res = QMFormat.parse(String(reader.result));
      if (!res.ok) { msg('Lỗi: ' + res.errors.join('; '), true); return; }
      pushUndo();
      level = res.level;
      sel = null;
      syncTopbar(); renderProps(); renderList();
      _needCompute = true; draw();
      msg('Đã import "' + level.name + '"' +
        (res.errors.length ? ' (' + res.errors.length + ' cảnh báo)' : ''));
    };
    reader.readAsText(f);
  });

  // -------- Keyboard --------
  window.addEventListener('keydown', function (e) {
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'select' || tag === 'textarea') return;
    if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ') { e.preventDefault(); undo(); return; }
    if (e.code === 'Delete' || e.code === 'Backspace') { e.preventDefault(); deleteSelection(); return; }
    const map = {
      Digit1: 'select', Digit2: 'wall', Digit3: 'saw',
      Digit4: 'spawn', Digit5: 'goal', Digit6: 'checkpoint', Digit7: 'erase'
    };
    if (map[e.code]) setTool(map[e.code]);
  });

  window.addEventListener('resize', function () { _needCompute = true; draw(); });

  // -------- Init --------
  // Nhận level test từ editor (nếu có) – trang game cũng đọc mục này.
  syncTopbar();
  renderProps();
  renderList();
  setTool('select');
  _needCompute = true;
  draw();
})();
