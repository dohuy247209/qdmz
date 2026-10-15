/*
 * Quad Maze clone – Level Editor.
 * Công cụ: chọn/di chuyển, vẽ wall (kéo), đặt saw (kéo = to), spawn, goal,
 * checkpoint, xóa. Hỗ trợ snap lưới, Shift = tự do, undo, export/import JSON.
 */
(function () {
  'use strict';

  const $ = function (id) { return document.getElementById(id); };
  const R = window.QMRender; // renderer helpers (render.js load trước)
  const M = window.QMMotion; // cơ học dùng chung với game (motion.js)
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
  let anim = false;        // xem trước chuyển động (path/spin) thật trong editor
  let animT0 = 0;          // mốc thời gian khi bật anim

  const SNAP = 1;          // snap 1 ô

  // Thời gian draw hiện tại (giây): anim bật -> chạy thật; không -> pose t=0.
  function drawTime() { return anim ? (performance.now() - animT0) / 1000 : 0; }
  // Ma trận world của mọi wall/saw (motion + attach) – dùng cho vẽ & hit-test.
  function curMats() { return M.resolve(level, drawTime()); }

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

  // Zoom & pan: viewport là "cửa sổ" vào sandbox lớn (wheel = pan, Ctrl+wheel
  // = zoom quanh chuột, kéo vùng trống bằng tool Chọn = pan, phím 0 = fit).
  let zoom = 1;            // hệ số zoom so với fit (0.5..8)
  let pan = { x: null, y: null }; // offset px đã chọn (null = căn giữa)

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
    const fit = Math.min((W - pad * 2) / level.box.w, (H - pad * 2) / level.box.h);
    // Cho phép FIT sandbox rất rộng (vd 512x288) xuống màn hình (scale < 4).
    const scale = Math.max(0.5, fit * zoom);
    const bw = level.box.w * scale, bh = level.box.h * scale;
    let ox = pan.x == null ? (W - bw) / 2 : pan.x;
    let oy = pan.y == null ? (H - bh) / 2 : pan.y;
    // Box rộng hơn màn hình -> clamp cho phủ kín; không thì căn giữa.
    ox = bw > W ? Math.min(0, Math.max(W - bw, ox)) : (W - bw) / 2;
    oy = bh > H ? Math.min(0, Math.max(H - bh, oy)) : (H - bh) / 2;
    pan.x = ox;
    pan.y = oy;
    view = {
      scale: scale,
      ox: Math.round(ox),
      oy: Math.round(oy),
      W: W, H: H
    };
  }

  function cellToPx(x, y) { return { x: view.ox + x * view.scale, y: view.oy + y * view.scale }; }

  function pxToCell(px, py) {
    return { x: (px - view.ox) / view.scale, y: (py - view.oy) / view.scale };
  }

  function snap(v, free) { return free ? Math.round(v * 2) / 2 : Math.round(v); }

  // -------- Hit test (theo transform world: motion + attach) --------
  function hitWall(c) {
    const mats = curMats().walls;
    for (let i = level.walls.length - 1; i >= 0; i--) {
      const w = level.walls[i];
      // Nghịch đảo world -> toạ độ REST (nơi có x,y,w,h gốc của wall).
      const l = M.apply(M.inv(mats[i]), c.x, c.y);
      if (l.x >= w.x && l.x <= w.x + w.w && l.y >= w.y && l.y <= w.y + w.h) return i;
    }
    return -1;
  }
  function hitSaw(c) {
    const mats = curMats().saws;
    for (let i = level.saws.length - 1; i >= 0; i--) {
      const s = level.saws[i];
      const ctr = M.apply(mats[i], s.x + s.size / 2, s.y + s.size / 2);
      if (Math.hypot(c.x - ctr.x, c.y - ctr.y) <= s.size / 2) return i;
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

    // Ma trận world tại thời điểm draw (pose t=0, hoặc anim đang chạy).
    const mats = curMats();

    // Walls (transform bởi motion/spin/attach) + overlay path/pivot.
    for (let i = 0; i < level.walls.length; i++) {
      const w = level.walls[i];
      const m = mats.walls[i];
      const ctr = M.apply(m, w.x + w.w / 2, w.y + w.h / 2);
      drawMotionOverlays(w, mats, i);
      R.drawWallXf(ctx, ctr.x, ctr.y, w.w, w.h, M.angleOf(m), view);
      if (sel && sel.kind === 'wall' && sel.index === i) {
        outlineAt(ctr.x, ctr.y, w.w, w.h, M.angleOf(m) * 180 / Math.PI);
      }
    }

    // Markers.
    drawMarkerSel(level.spawn, sel && sel.kind === 'spawn');
    drawMarkerSel(level.goal, sel && sel.kind === 'goal');
    for (let i = 0; i < level.checkpoints.length; i++) {
      const c = level.checkpoints[i];
      drawMarkerSel(c, sel && sel.kind === 'checkpoint' && sel.index === i);
    }

    // Saws: tâm theo transform (path/spin/attach); overlay path/pivot;
    // răng cưa xoay thật khi bật anim.
    for (let i = 0; i < level.saws.length; i++) {
      const s = level.saws[i];
      const m = mats.saws[i];
      const ctr = M.apply(m, s.x + s.size / 2, s.y + s.size / 2);
      const p = cellToPx(ctr.x, ctr.y);
      drawMotionOverlays(s, mats, i);
      const gear = anim
        ? (s.spin || 90) * Math.PI / 180 * drawTime()
        : (s.spin >= 0 ? 1 : -1) * Math.PI / 8;
      R.drawSaw(ctx, p.x, p.y, s.size * view.scale, gear);
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

  // Viền chọn quanh tâm (cx,cy) đơn vị cell + góc rot (độ).
  function outlineAt(cx, cy, w, h, rot) {
    const p = cellToPx(cx, cy);
    ctx.save();
    ctx.translate(p.x, p.y);
    if (rot) ctx.rotate(rot * Math.PI / 180);
    ctx.strokeStyle = R.COLORS.select;
    ctx.lineWidth = 2;
    ctx.strokeRect(-w * view.scale / 2 - 2, -h * view.scale / 2 - 2, w * view.scale + 4, h * view.scale + 4);
    ctx.restore();
  }

  // Overlay chuyển động của object: polyline path (xanh) trong frame của wall
  // cha + crosshair pivot (tím) – vẽ cả khi chưa chọn để thấy cơ chế.
  function drawMotionOverlays(obj, mats, index) {
    const m = obj.motion || { type: 'static' };
    const parent = (obj.attach != null && mats.walls[obj.attach])
      ? mats.walls[obj.attach] : M.identity();
    if (m.type === 'path' && m.points && m.points.length >= 2) {
      ctx.save();
      ctx.strokeStyle = 'rgba(120,170,255,0.9)';
      ctx.fillStyle = 'rgba(120,170,255,0.95)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      for (let i = 0; i < m.points.length; i++) {
        const q = M.apply(parent, m.points[i][0], m.points[i][1]);
        const px = view.ox + q.x * view.scale, py = view.oy + q.y * view.scale;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      if (m.mode === 'loop') ctx.closePath();
      ctx.stroke();
      ctx.setLineDash([]);
      // Đầu mút đường đi.
      [m.points[0], m.points[m.points.length - 1]].forEach(function (pt) {
        const q = M.apply(parent, pt[0], pt[1]);
        const px = view.ox + q.x * view.scale, py = view.oy + q.y * view.scale;
        ctx.fillRect(px - 3, py - 3, 6, 6);
      });
      ctx.restore();
    }
    if (m.type === 'spin') {
      const cx0 = obj.x + (obj.w !== undefined ? obj.w / 2 : obj.size / 2);
      const cy0 = obj.y + (obj.h !== undefined ? obj.h / 2 : obj.size / 2);
      const pv = m.pivot || [cx0, cy0]; // null = tâm rect
      const q = M.apply(parent, pv[0], pv[1]);
      const px = view.ox + q.x * view.scale, py = view.oy + q.y * view.scale;
      ctx.save();
      ctx.strokeStyle = 'rgba(200,120,255,0.95)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(px - 7, py); ctx.lineTo(px + 7, py);
      ctx.moveTo(px, py - 7); ctx.lineTo(px, py + 7);
      ctx.stroke();
      ctx.strokeRect(px - 3.5, py - 3.5, 7, 7);
      ctx.restore();
    }
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
      } else {
        // Kéo vùng trống = PAN viewport (sandbox lớn hơn màn hình).
        drag = { mode: 'pan', sx: e.clientX, sy: e.clientY, ox: view.ox, oy: view.oy };
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
        if (hit.kind === 'wall') { level.walls.splice(hit.index, 1); remapAttach(hit.index); }
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
    } else if (drag.mode === 'pan') {
      pan.x = drag.ox + (e.clientX - drag.sx);
      pan.y = drag.oy + (e.clientY - drag.sy);
      _needCompute = true; // computeView sẽ clamp pan theo kích thước box
    }
    draw();
  });

  canvas.addEventListener('pointerup', function (e) {
    if (!drag) return;
    if (drag.mode === 'drawWall') {
      const r = normRect(drag.from, drag.to || drag.from);
      if (r.w >= 0.5 && r.h >= 0.5) {
        r.motion = QMFormat.staticMotion();
        r.attach = null;
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
        motion: QMFormat.staticMotion(),
        attach: null
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
        motionHtml(w, 'wall', sel.index);
    } else if (sel.kind === 'saw') {
      const s = level.saws[sel.index];
      if (!s) { sel = null; return renderProps(); }
      html =
        '<h4>SAW</h4>' +
        numRow('X', 'x', s.x) + numRow('Y', 'y', s.y) +
        numRow('Kích cỡ', 'size', s.size, 0.25) +
        numRow('Tốc độ xoay (độ/giây)', 'spin', s.spin, 10) +
        motionHtml(s, 'saw', sel.index);
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

  // UI motion v2: static | path (tốc độ ô/giây, không đổi, đảo ngay) |
  // spin (pivot + tốc độ độ/giây) + attach (gắn frame wall cha).
  function motionHtml(obj, kind, index) {
    const m = obj.motion;
    let html = '<div class="grp">CHUYỂN ĐỘNG</div>';
    const types = [['static', 'Không (static)'], ['path', 'Path (đi đường)'], ['spin', 'Spin (quay)']];
    let opts = '';
    types.forEach(function (t) {
      opts += '<option value="' + t[0] + '"' + (m.type === t[0] ? ' selected' : '') + '>' + t[1] + '</option>';
    });
    html += '<label class="prow">Loại<select data-k="motion.type">' + opts + '</select></label>';
    if (m.type === 'path') {
      const pts = (m.points || []).map(function (p) { return p[0] + ',' + p[1]; }).join(' ');
      const modes = [['pingpong', 'Đảo ngay 2 đầu'], ['loop', 'Khép vòng']];
      let mopts = '';
      modes.forEach(function (t) {
        mopts += '<option value="' + t[0] + '"' + (m.mode === t[0] ? ' selected' : '') + '>' + t[1] + '</option>';
      });
      html += '<label class="prow">Đường (x,y ...)<input type="text" data-k="motion.points" value="' + pts + '"></label>' +
        '<label class="prow">Chế độ<select data-k="motion.mode">' + mopts + '</select></label>' +
        '<label class="prow">Tốc độ (ô/giây)<input type="number" data-k="motion.speed" step="0.5" value="' + m.speed + '"></label>' +
        '<label class="prow">Pha (0..1)<input type="number" data-k="motion.phase" step="0.05" value="' + m.phase + '"></label>';
    } else if (m.type === 'spin') {
      html += '<label class="prow">Tốc độ (độ/giây)<input type="number" data-k="motion.speed" step="15" value="' + m.speed + '"></label>' +
        '<label class="prow">Pha ban đầu (độ)<input type="number" data-k="motion.phase" step="15" value="' + m.phase + '"></label>' +
        '<label class="prow">Pivot X<input type="number" data-k="motion.pivotX" step="0.5" placeholder="tâm rect" value="' + (m.pivot ? m.pivot[0] : '') + '"></label>' +
        '<label class="prow">Pivot Y<input type="number" data-k="motion.pivotY" step="0.5" placeholder="tâm rect" value="' + (m.pivot ? m.pivot[1] : '') + '"></label>';
    }
    // Attach: chọn wall cha. Wall chỉ được gắn wall index đứng TRƯỚC (chống vòng).
    let aopts = '<option value="">— Không —</option>';
    for (let i = 0; i < level.walls.length; i++) {
      if (kind === 'wall' && i >= index) continue;
      const w = level.walls[i];
      aopts += '<option value="' + i + '"' + (obj.attach === i ? ' selected' : '') +
        '>Wall ' + i + ' (' + w.w + '×' + w.h + ')</option>';
    }
    html += '<label class="prow">Gắn vào (attach)<select data-k="attach">' + aopts + '</select></label>';
    html += '<p class="hint">Path/spin: tốc độ KHÔNG đổi, đổi hướng tức thì (không gia tốc). ' +
      'Attach: saw/path đi theo frame wall cha (vd saw chạy trên cạnh wall đang quay). ' +
      'Pivot để trống = tâm rect.</p>';
    return html;
  }

  // Đổi loại motion, giữ/giá trị tối thiểu hợp lý để level luôn chạy được.
  function changeMotionType(obj, type) {
    pushUndo();
    const m = obj.motion;
    const cx = obj.x + (obj.w !== undefined ? obj.w / 2 : obj.size / 2);
    const cy = obj.y + (obj.h !== undefined ? obj.h / 2 : obj.size / 2);
    if (type === 'path' && (!m.points || m.points.length < 2)) {
      m.points = [[cx - 2, cy], [cx + 2, cy]];
      if (!m.speed) m.speed = 4;
      if (!m.mode) m.mode = 'pingpong';
    }
    m.type = type;
  }

  // Parse textarea "x,y x,y ..." -> points (bỏ qua khi đang gõ dở).
  function applyPoints(obj, text) {
    const toks = String(text).split(/[\s;]+/).filter(Boolean);
    const pts = [];
    for (let i = 0; i < toks.length; i++) {
      const parts = toks[i].split(',');
      if (parts.length !== 2) return;
      const x = parseFloat(parts[0]), y = parseFloat(parts[1]);
      if (isNaN(x) || isNaN(y)) return;
      pts.push([x, y]);
    }
    if (pts.length < 2) return;
    obj.motion.points = pts;
  }

  // Pivot X/Y rỗng -> lấy tâm rect (null = tâm trong format).
  function applyPivot(obj, k, val) {
    const m = obj.motion;
    let px = m.pivot ? m.pivot[0] : '';
    let py = m.pivot ? m.pivot[1] : '';
    if (k === 'motion.pivotX') px = val; else py = val;
    if (px === '' && py === '') { m.pivot = null; return; }
    const cx = obj.x + (obj.w !== undefined ? obj.w / 2 : obj.size / 2);
    const cy = obj.y + (obj.h !== undefined ? obj.h / 2 : obj.size / 2);
    const x = px === '' ? cx : parseFloat(px);
    const y = py === '' ? cy : parseFloat(py);
    if (isNaN(x) || isNaN(y)) { m.pivot = null; return; }
    m.pivot = [x, y];
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
        if (k === 'motion.type') { changeMotionType(obj, inp.value); renderProps(); }
        else if (k === 'motion.mode') obj.motion.mode = inp.value;
        else if (k === 'motion.points') applyPoints(obj, inp.value);
        else if (k === 'motion.pivotX' || k === 'motion.pivotY') applyPivot(obj, k, inp.value);
        else if (k === 'attach') obj.attach = inp.value === '' ? null : parseInt(inp.value, 10);
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

  // Ký hiệu motion/attach trong danh sách bên trái.
  function motionGlyph(o) {
    let g = '';
    if (o.motion && o.motion.type === 'path') g += ' →';
    if (o.motion && o.motion.type === 'spin') g += ' ⟳';
    if (o.attach != null) g += ' ⧉';
    return g;
  }

  // Xóa wall -> giữ attach của wall/saw khác không trỏ nhầm sau khi dồn index.
  function remapAttach(deletedIndex) {
    level.walls.concat(level.saws).forEach(function (o) {
      if (o.attach == null) return;
      if (o.attach === deletedIndex) o.attach = null;
      else if (o.attach > deletedIndex) o.attach--;
    });
  }

  function deleteSelection() {
    if (!sel) return;
    pushUndo();
    if (sel.kind === 'wall') { level.walls.splice(sel.index, 1); remapAttach(sel.index); }
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
      item('Wall ' + w.w + '×' + w.h + (w.rot ? ' ↻' + w.rot + '°' : '') + motionGlyph(w), 'wall', i);
    });
    level.saws.forEach(function (s, i) {
      item('Saw ' + s.size + motionGlyph(s), 'saw', i);
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
    level.box.w = Math.max(8, Math.min(600, parseInt($('ed-bw').value, 10) || 64));
    level.box.h = Math.max(6, Math.min(400, parseInt($('ed-bh').value, 10) || 36));
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
    if (e.code === 'Digit0') { resetView(); msg('Đã fit toàn bộ box'); }
  });

  // -------- Pan / zoom viewport (sandbox lớn hơn màn hình) --------
  function resetView() {
    zoom = 1;
    pan = { x: null, y: null };
    _needCompute = true;
    draw();
  }

  canvas.addEventListener('wheel', function (e) {
    e.preventDefault();
    computeViewIfNeed();
    if (e.ctrlKey || e.metaKey) {
      // Zoom quanh con trỏ chuột (giữ ô dưới chuột tại chỗ).
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left, my = e.clientY - rect.top;
      const cell = pxToCell(mx, my);
      zoom = Math.max(0.5, Math.min(8, zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
      _needCompute = true;
      computeViewIfNeed();
      pan.x = mx - cell.x * view.scale;
      pan.y = my - cell.y * view.scale;
      _needCompute = true;
      computeViewIfNeed();
    } else {
      // Wheel = pan dọc, Shift+wheel = pan ngang.
      pan.x = view.ox - (e.shiftKey ? e.deltaY : e.deltaX);
      pan.y = view.oy - (e.shiftKey ? 0 : e.deltaY);
      _needCompute = true;
      computeViewIfNeed();
    }
    draw();
  }, { passive: false });

  // -------- Xem trước chuyển động (checkbox trên topbar) --------
  function tickAnim() {
    if (!anim) return;
    draw();
    requestAnimationFrame(tickAnim);
  }
  const animEl = $('ed-anim');
  if (animEl) {
    animEl.addEventListener('change', function () {
      anim = animEl.checked;
      animT0 = performance.now();
      if (anim) { tickAnim(); msg('Đang xem trước chuyển động'); }
      else { draw(); msg('Đã dừng xem trước'); }
    });
  }

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
