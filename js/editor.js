/*
 * Quad Maze clone – Level Editor (v2).
 *
 * Tính năng chính:
 * 1. Viewport: mô hình toạ độ view = {cx, cy, scale, W, H}. Zoom bằng wheel quanh chuột,
 *    pan bằng Space+kéo, chuột giữa/phải hoặc kéo nền. Mở quanh spawn ở scale 24.
 * 2. Bộ máy snap đa năng (snapPoint, snapMove): ưu tiên điểm vật thể (góc, trung điểm, tâm),
 *    đường gióng thẳng hàng, lưới nguyên ô. Alt tạm tắt snap. Phím G bật/tắt.
 * 3. Kích thước nguyên ô cho Wall và Saw. Di chuyển mượt theo độ dịch không giật.
 * 4. Công cụ Path (phím 8): vẽ polyline pingpong / loop. Thả wall/saw gần path tự nhích vào.
 * 5. Path đi theo wall đang spin qua toạ độ local (worldToWallLocal) và attach.
 * 6. Undo/Redo (Ctrl+Z, Ctrl+Shift+Z / Ctrl+Y), nút Redo, và Autosave vào localStorage.
 * 7. Phím R / Shift+R xoay vật được chọn 15° theo / ngược chiều kim đồng hồ.
 * 8. Sửa triệt để lỗi ghost preview lệch toạ độ (drawWallRect nhận toạ độ ô).
 */
(function () {
  'use strict';

  const $ = function (id) { return document.getElementById(id); };
  const R = window.QMRender;
  const M = window.QMMotion;
  const canvas = $('ed-canvas');
  const ctx = canvas.getContext('2d');

  // -------- State --------
  let level = QMFormat.makeDefaultLevel();
  let tool = 'select';
  let sel = null;          // { kind: 'wall'|'saw'|'checkpoint'|'spawn'|'goal'|'path', index: number }
  let hover = null;        // { x, y }
  let drag = null;         // phiên kéo chuột
  let propsDirty = false;
  let anim = false;        // xem trước chuyển động
  let animT0 = 0;
  let isSpaceDown = false; // giữ phím Space để pan

  // Undo / Redo
  const undoStack = [];
  const redoStack = [];

  // Snap engine
  const SNAP_PX = 10;
  const snapOpts = { objects: true, guides: true, grid: true };
  let activeSnap = null;   // { x, y, kind, gx, gy } dùng để vẽ chỉ dẫn

  // Path tool draft
  let draftPath = null;    // { points: [[x,y],...] }

  // Viewport model: tâm nhìn (cx, cy) theo đơn vị cell, px/cell scale
  const view = { cx: 2, cy: 10, scale: 24, W: 0, H: 0 };

  function worldToScreen(x, y) {
    return {
      x: (x - view.cx) * view.scale + view.W / 2,
      y: (y - view.cy) * view.scale + view.H / 2
    };
  }

  function screenToWorld(px, py) {
    return {
      x: (px - view.W / 2) / view.scale + view.cx,
      y: (py - view.H / 2) / view.scale + view.cy
    };
  }

  function getVT() {
    return {
      scale: view.scale,
      ox: view.W / 2 - view.cx * view.scale,
      oy: view.H / 2 - view.cy * view.scale
    };
  }

  // Aliases tương thích
  function cellToPx(x, y) { return worldToScreen(x, y); }
  function pxToCell(px, py) { return screenToWorld(px, py); }

  function drawTime() { return anim ? (performance.now() - animT0) / 1000 : 0; }
  function curMats() { return M.resolve(level, drawTime()); }

  function msg(text, isErr) {
    const el = $('ed-msg');
    if (!el) return;
    el.textContent = text;
    el.className = 'hint ' + (isErr ? 'error' : 'ok');
    clearTimeout(msg._t);
    msg._t = setTimeout(function () { el.textContent = ''; }, 4000);
  }

  // -------- Autosave & Undo / Redo --------
  let saveT;
  function autosave() {
    clearTimeout(saveT);
    saveT = setTimeout(function () {
      try {
        localStorage.setItem('quadmaze.editor.draft', JSON.stringify(level));
      } catch (e) {}
    }, 400);
  }

  function pushUndo() {
    undoStack.push(JSON.stringify(level));
    if (undoStack.length > 100) undoStack.shift();
    redoStack.length = 0;
  }

  function afterRestore() {
    if (sel && sel.index !== undefined) {
      const arr = sel.kind === 'wall' ? level.walls
        : sel.kind === 'saw' ? level.saws
        : sel.kind === 'checkpoint' ? level.checkpoints
        : sel.kind === 'path' ? level.paths : null;
      if (!arr || sel.index >= arr.length) sel = null;
    }
    syncTopbar();
    renderProps();
    renderList();
    autosave();
    draw();
  }

  function undo() {
    if (!undoStack.length) { msg('Không còn bước nào để Undo', true); return; }
    redoStack.push(JSON.stringify(level));
    level = JSON.parse(undoStack.pop());
    afterRestore();
    msg('Đã Undo');
  }

  function redo() {
    if (!redoStack.length) { msg('Không còn bước nào để Redo', true); return; }
    undoStack.push(JSON.stringify(level));
    level = JSON.parse(redoStack.pop());
    afterRestore();
    msg('Đã Redo');
  }

  // -------- Snap Engine --------
  function collectTargets(exclude) {
    exclude = exclude || new Set();
    const mats = curMats();
    const pts = [], xs = [], ys = [];
    const add = function (x, y) { pts.push({ x: x, y: y }); xs.push(x); ys.push(y); };

    level.walls.forEach(function (w, i) {
      if (exclude.has('wall:' + i)) return;
      const cx = w.x + w.w / 2, cy = w.y + w.h / 2;
      [
        [w.x, w.y], [w.x + w.w, w.y], [w.x + w.w, w.y + w.h], [w.x, w.y + w.h],
        [cx, w.y], [w.x + w.w, cy], [cx, w.y + w.h], [w.x, cy], [cx, cy]
      ].forEach(function (p) {
        const q = M.apply(mats.walls[i], p[0], p[1]);
        add(q.x, q.y);
      });
    });

    level.saws.forEach(function (s, i) {
      if (exclude.has('saw:' + i)) return;
      const c = M.apply(mats.saws[i], s.x + s.size / 2, s.y + s.size / 2);
      add(c.x, c.y);
      [
        [s.x, s.y], [s.x + s.size, s.y], [s.x + s.size, s.y + s.size], [s.x, s.y + s.size]
      ].forEach(function (p) {
        const q = M.apply(mats.saws[i], p[0], p[1]);
        add(q.x, q.y);
      });
    });

    const markers = [level.spawn, level.goal].concat(level.checkpoints || []);
    markers.forEach(function (m) {
      if (!m) return;
      add(m.x, m.y);
      add(m.x + 1, m.y);
      add(m.x + 1, m.y + 1);
      add(m.x, m.y + 1);
      add(m.x + 0.5, m.y + 0.5);
    });

    // Path points
    (level.paths || []).forEach(function (pth, pi) {
      if (exclude.has('path:' + pi)) return;
      const pm = (pth.attach != null && mats.walls[pth.attach]) ? mats.walls[pth.attach] : null;
      (pth.points || []).forEach(function (pt) {
        const q = pm ? M.apply(pm, pt[0], pt[1]) : { x: pt[0], y: pt[1] };
        add(q.x, q.y);
      });
    });

    return { pts: pts, xs: xs, ys: ys };
  }

  function snapPoint(raw, targets, bypassSnap) {
    if (bypassSnap || (!snapOpts.objects && !snapOpts.guides && !snapOpts.grid)) {
      return { x: raw.x, y: raw.y, kind: 'free', gx: null, gy: null };
    }
    const tol = SNAP_PX / view.scale; // pixel -> cell
    const out = { x: raw.x, y: raw.y, kind: 'free', gx: null, gy: null };

    // 1) Bám điểm của vật khác (corner, midpoint, center)
    if (snapOpts.objects && targets && targets.pts) {
      let best = null, bd = tol;
      for (let i = 0; i < targets.pts.length; i++) {
        const t = targets.pts[i];
        const d = Math.hypot(t.x - raw.x, t.y - raw.y);
        if (d < bd) { bd = d; best = t; }
      }
      if (best) return { x: best.x, y: best.y, kind: 'point', gx: best.x, gy: best.y };
    }

    // 2) Đường gióng thẳng hàng
    if (snapOpts.guides && targets && targets.xs && targets.ys) {
      let dx = tol, dy = tol;
      for (let i = 0; i < targets.xs.length; i++) {
        const x = targets.xs[i];
        const diff = Math.abs(x - raw.x);
        if (diff < dx) { dx = diff; out.x = x; out.gx = x; }
      }
      for (let i = 0; i < targets.ys.length; i++) {
        const y = targets.ys[i];
        const diff = Math.abs(y - raw.y);
        if (diff < dy) { dy = diff; out.y = y; out.gy = y; }
      }
    }

    // 3) Lưới nguyên ô – phương án cuối
    if (snapOpts.grid) {
      if (out.gx === null) out.x = Math.round(out.x);
      if (out.gy === null) out.y = Math.round(out.y);
    }

    out.kind = (out.gx !== null || out.gy !== null) ? 'guide' : (snapOpts.grid ? 'grid' : 'free');
    return out;
  }

  function getObjectAnchors(obj, kind) {
    if (!obj) return [{ x: 0, y: 0 }];
    if (kind === 'wall') {
      const cx = obj.x + obj.w / 2, cy = obj.y + obj.h / 2;
      return [
        { x: obj.x, y: obj.y }, { x: obj.x + obj.w, y: obj.y },
        { x: obj.x + obj.w, y: obj.y + obj.h }, { x: obj.x, y: obj.y + obj.h },
        { x: cx, y: obj.y }, { x: obj.x + obj.w, y: cy },
        { x: cx, y: obj.y + obj.h }, { x: obj.x, y: cy },
        { x: cx, y: cy }
      ];
    }
    if (kind === 'saw') {
      const s = obj.size;
      return [
        { x: obj.x, y: obj.y }, { x: obj.x + s, y: obj.y },
        { x: obj.x + s, y: obj.y + s }, { x: obj.x, y: obj.y + s },
        { x: obj.x + s / 2, y: obj.y + s / 2 }
      ];
    }
    return [
      { x: obj.x, y: obj.y }, { x: obj.x + 1, y: obj.y },
      { x: obj.x + 1, y: obj.y + 1 }, { x: obj.x, y: obj.y + 1 },
      { x: obj.x + 0.5, y: obj.y + 0.5 }
    ];
  }

  function snapMove(anchors, delta, targets, bypassSnap) {
    if (bypassSnap) {
      return {
        d: 0,
        dx: delta.x,
        dy: delta.y,
        s: { x: delta.x, y: delta.y, kind: 'free', gx: null, gy: null }
      };
    }
    let best = null;
    for (let i = 0; i < anchors.length; i++) {
      const a = anchors[i];
      const s = snapPoint({ x: a.x + delta.x, y: a.y + delta.y }, targets, false);
      const d = Math.hypot(s.x - (a.x + delta.x), s.y - (a.y + delta.y));
      if (!best || d < best.d) best = { d: d, dx: s.x - a.x, dy: s.y - a.y, s: s };
    }
    return best;
  }

  // -------- Path Utilities --------
  function nearestOnPath(path, pt) {
    const P = path.points, loop = path.mode === 'loop';
    const n = P.length, segs = loop ? n : n - 1;
    let best = { d: Infinity, x: pt.x, y: pt.y, s: 0, total: 0 };
    let acc = 0;
    for (let i = 0; i < segs; i++) {
      const a = P[i], b = P[(i + 1) % n];
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const len2 = dx * dx + dy * dy;
      const t = len2 > 0 ? Math.max(0, Math.min(1, ((pt.x - a[0]) * dx + (pt.y - a[1]) * dy) / len2)) : 0;
      const x = a[0] + dx * t, y = a[1] + dy * t;
      const d = Math.hypot(pt.x - x, pt.y - y);
      const segLen = Math.sqrt(len2);
      if (d < best.d) best = { d: d, x: x, y: y, s: acc + segLen * t };
      acc += segLen;
    }
    best.total = acc;
    return best;
  }

  function worldToWallLocal(wallIdx, pts) {
    const mats = M.resolve(level, 0);
    const parentMat = mats.walls[wallIdx];
    if (!parentMat) return pts.map(function (p) { return [p[0], p[1]]; });
    const inv = M.inv(parentMat);
    return pts.map(function (p) {
      const q = M.apply(inv, p[0], p[1]);
      return [Math.round(q.x * 100) / 100, Math.round(q.y * 100) / 100];
    });
  }

  function wallLocalToWorld(wallIdx, pts) {
    const mats = M.resolve(level, 0);
    const parentMat = mats.walls[wallIdx];
    if (!parentMat) return pts.map(function (p) { return [p[0], p[1]]; });
    return pts.map(function (p) {
      const q = M.apply(parentMat, p[0], p[1]);
      return [Math.round(q.x * 100) / 100, Math.round(q.y * 100) / 100];
    });
  }

  function getCenter(obj, kind) {
    if (kind === 'wall') return { x: obj.x + obj.w / 2, y: obj.y + obj.h / 2 };
    if (kind === 'saw') return { x: obj.x + obj.size / 2, y: obj.y + obj.size / 2 };
    return { x: obj.x + 0.5, y: obj.y + 0.5 };
  }

  function trySnapToPath(obj, kind) {
    if (!level.paths || !level.paths.length) return false;
    const c = getCenter(obj, kind);
    const mats = curMats();

    for (let pi = 0; pi < level.paths.length; pi++) {
      const path = level.paths[pi];
      // Nếu path có attach, đổi c sang frame local của path
      let testPt = c;
      if (path.attach != null && mats.walls[path.attach]) {
        const inv = M.inv(mats.walls[path.attach]);
        testPt = M.apply(inv, c.x, c.y);
      }
      const h = nearestOnPath(path, testPt);
      if (h.d * view.scale > 20) continue; // bán kính 20px

      // Dịch tâm vào path
      if (path.attach != null && mats.walls[path.attach]) {
        const worldTarget = M.apply(mats.walls[path.attach], h.x, h.y);
        obj.x = Math.round(obj.x + (worldTarget.x - c.x));
        obj.y = Math.round(obj.y + (worldTarget.y - c.y));
        obj.attach = path.attach;
      } else {
        obj.x = Math.round(obj.x + (h.x - c.x));
        obj.y = Math.round(obj.y + (h.y - c.y));
        obj.attach = null;
      }

      const cycle = path.mode === 'loop' ? h.total : h.total * 2;
      obj.motion = {
        type: 'path',
        pathId: path.id,
        mode: path.mode,
        points: path.points.map(function (p) { return p.slice(); }),
        speed: (obj.motion && obj.motion.speed) || 4,
        phase: cycle > 0 ? h.s / cycle : 0,
        pivot: null
      };
      msg('Đã gắn vật thể vào Path "' + path.id + '"!');
      return true;
    }
    return false;
  }

  function finishPath(mode) {
    if (draftPath && draftPath.points.length >= 2) {
      pushUndo();
      level.paths = level.paths || [];
      const id = 'p' + Date.now().toString(36);
      const newPath = {
        id: id,
        points: draftPath.points.map(function (p) { return [Math.round(p[0]), Math.round(p[1])]; }),
        mode: mode || 'pingpong',
        attach: null
      };
      level.paths.push(newPath);
      sel = { kind: 'path', index: level.paths.length - 1 };
      msg('Đã tạo Path (' + newPath.mode + ') với ' + newPath.points.length + ' điểm');
      autosave();
    }
    draftPath = null;
    renderProps();
    renderList();
    draw();
  }

  // -------- Hit Testing --------
  function hitWall(c) {
    const mats = curMats().walls;
    for (let i = level.walls.length - 1; i >= 0; i--) {
      const w = level.walls[i];
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
    const arr = level.checkpoints || [];
    for (let i = arr.length - 1; i >= 0; i--) {
      const p = arr[i];
      if (c.x >= p.x && c.x <= p.x + 1 && c.y >= p.y && c.y <= p.y + 1) return i;
    }
    return -1;
  }

  function hitMarker(c, kind) {
    const m = kind === 'spawn' ? level.spawn : level.goal;
    if (!m) return false;
    return c.x >= m.x && c.x <= m.x + 1 && c.y >= m.y && c.y <= m.y + 1;
  }

  function hitPath(c) {
    const paths = level.paths || [];
    const mats = curMats();
    for (let i = paths.length - 1; i >= 0; i--) {
      const p = paths[i];
      let testPt = c;
      if (p.attach != null && mats.walls[p.attach]) {
        const inv = M.inv(mats.walls[p.attach]);
        testPt = M.apply(inv, c.x, c.y);
      }
      const h = nearestOnPath(p, testPt);
      if (h.d * view.scale <= 10) return i;
    }
    return -1;
  }

  function hitAny(c) {
    const s = hitSaw(c); if (s >= 0) return { kind: 'saw', index: s };
    const w = hitWall(c); if (w >= 0) return { kind: 'wall', index: w };
    const k = hitCheckpoint(c); if (k >= 0) return { kind: 'checkpoint', index: k };
    if (hitMarker(c, 'goal')) return { kind: 'goal' };
    if (hitMarker(c, 'spawn')) return { kind: 'spawn' };
    const p = hitPath(c); if (p >= 0) return { kind: 'path', index: p };
    return null;
  }

  function objOf(hit) {
    if (!hit) return null;
    if (hit.kind === 'wall') return level.walls[hit.index];
    if (hit.kind === 'saw') return level.saws[hit.index];
    if (hit.kind === 'checkpoint') return level.checkpoints[hit.index];
    if (hit.kind === 'spawn') return level.spawn;
    if (hit.kind === 'goal') return level.goal;
    if (hit.kind === 'path') return level.paths[hit.index];
    return null;
  }

  // -------- Xoay vật thể (Phím R / Shift+R) --------
  function rotateSelection(direction) {
    if (!sel) return;
    const obj = objOf(sel);
    if (!obj || sel.kind === 'spawn' || sel.kind === 'goal' || sel.kind === 'checkpoint' || sel.kind === 'path') {
      msg('Chỉ xoay được Wall hoặc Saw', true);
      return;
    }
    pushUndo();
    const delta = direction * 15;
    let r = Math.round((obj.rot || 0) + delta);
    r = ((r % 360) + 360) % 360;
    if (r > 180) r -= 360;
    obj.rot = r;
    renderProps();
    renderList();
    autosave();
    draw();
    msg('Đã xoay ' + (direction > 0 ? '↻' : '↺') + ' 15° → ' + obj.rot + '°');
  }

  // -------- Resize Canvas & Viewport --------
  function resizeCanvas() {
    const wrap = $('ed-canvas-wrap');
    if (!wrap) return;
    const W = wrap.clientWidth, H = wrap.clientHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    view.W = W;
    view.H = H;
  }

  function centerOn(x, y, targetScale) {
    view.cx = x;
    view.cy = y;
    if (targetScale) view.scale = targetScale;
    draw();
  }

  function resetView() {
    if (level.spawn) {
      centerOn(level.spawn.x + 0.5, level.spawn.y + 0.5, 24);
    } else {
      centerOn(level.box.w / 2, level.box.h / 2, 24);
    }
    msg('Đã đặt lại góc nhìn quanh Spawn');
  }

  // -------- Vẽ Canvas --------
  function draw() {
    if (!view.W || !view.H) resizeCanvas();
    const W = view.W, H = view.H;
    const vt = getVT();

    ctx.fillStyle = '#2b2b30';
    ctx.fillRect(0, 0, W, H);

    // Box bounds
    const boxOrigin = worldToScreen(0, 0);
    const boxSize = { w: level.box.w * view.scale, h: level.box.h * view.scale };

    // Nền đỏ chéo của box
    R.drawStripes(ctx, boxOrigin.x, boxOrigin.y, boxSize.w, boxSize.h, view.scale);
    // Lưới
    R.drawGrid(ctx, boxOrigin.x, boxOrigin.y, level.box.w, level.box.h, view.scale);

    const mats = curMats();

    // 1. Vẽ các đường Path độc lập (level.paths)
    drawLevelPaths(mats);

    // 2. Vẽ Walls + Motion overlays
    for (let i = 0; i < level.walls.length; i++) {
      const w = level.walls[i];
      const m = mats.walls[i];
      const ctr = M.apply(m, w.x + w.w / 2, w.y + w.h / 2);
      drawMotionOverlays(w, mats);
      R.drawWallXf(ctx, ctr.x, ctr.y, w.w, w.h, M.angleOf(m), vt);
      if (sel && sel.kind === 'wall' && sel.index === i) {
        outlineAt(ctr.x, ctr.y, w.w, w.h, M.angleOf(m) * 180 / Math.PI);
      }
    }

    // 3. Markers: Spawn, Goal, Checkpoints
    drawMarkerSel(level.spawn, sel && sel.kind === 'spawn');
    drawMarkerSel(level.goal, sel && sel.kind === 'goal');
    for (let i = 0; i < (level.checkpoints || []).length; i++) {
      const c = level.checkpoints[i];
      drawMarkerSel(c, sel && sel.kind === 'checkpoint' && sel.index === i);
    }

    // 4. Saws
    for (let i = 0; i < level.saws.length; i++) {
      const s = level.saws[i];
      const m = mats.saws[i];
      const ctr = M.apply(m, s.x + s.size / 2, s.y + s.size / 2);
      const p = worldToScreen(ctr.x, ctr.y);
      drawMotionOverlays(s, mats);
      const gear = anim
        ? (s.spin || 90) * Math.PI / 180 * drawTime()
        : (s.spin >= 0 ? 1 : -1) * Math.PI / 8;
      R.drawSaw(ctx, p.x, p.y, s.size * view.scale, gear);
      if (sel && sel.kind === 'saw' && sel.index === i) {
        ctx.strokeStyle = R.COLORS.select;
        ctx.lineWidth = 2;
        ctx.strokeRect(p.x - s.size * view.scale / 2 - 2, p.y - s.size * view.scale / 2 - 2,
          s.size * view.scale + 4, s.size * view.scale + 4);
      }
    }

    // 5. Ghost Preview khi kéo chuột
    if (drag && drag.mode === 'drawWall') {
      const r = getDrawWallRect(drag.from, drag.to);
      ctx.globalAlpha = 0.65;
      R.drawWallRect(ctx, r, vt);
      ctx.globalAlpha = 1;
    } else if (drag && drag.mode === 'drawSaw') {
      const s = getDrawSawRect(drag.from, drag.to);
      const p = worldToScreen(s.x + s.size / 2, s.y + s.size / 2);
      ctx.globalAlpha = 0.65;
      R.drawSaw(ctx, p.x, p.y, s.size * view.scale, Math.PI / 8);
      ctx.globalAlpha = 1;
    }

    // 6. Draft Path đang vẽ
    if (draftPath && draftPath.points && draftPath.points.length > 0) {
      drawDraftPath();
    }

    // 7. Visual Snap Cues (Dấu hiệu bám dính)
    drawSnapCues();

    // 8. Hover ô lưới khi không kéo
    if (hover && tool !== 'select' && !drag) {
      const hp = worldToScreen(hover.x, hover.y);
      ctx.strokeStyle = 'rgba(255,255,255,0.4)';
      ctx.lineWidth = 1;
      ctx.strokeRect(hp.x + 0.5, hp.y + 0.5, view.scale, view.scale);
    }

    // 9. Viền sandbox giới hạn
    ctx.strokeStyle = '#1e1e22';
    ctx.lineWidth = 3;
    ctx.strokeRect(boxOrigin.x - 1.5, boxOrigin.y - 1.5, boxSize.w + 3, boxSize.h + 3);
  }

  function getDrawWallRect(from, to) {
    const x = Math.min(from.x, to.x);
    const y = Math.min(from.y, to.y);
    const w = Math.max(1, Math.round(Math.abs(to.x - from.x)));
    const h = Math.max(1, Math.round(Math.abs(to.y - from.y)));
    return { x: x, y: y, w: w, h: h, rot: 0 };
  }

  function getDrawSawRect(from, to) {
    const size = Math.max(1, Math.round(Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y))));
    const x = to.x >= from.x ? from.x : from.x - size;
    const y = to.y >= from.y ? from.y : from.y - size;
    return { x: x, y: y, size: size };
  }

  function outlineAt(cx, cy, w, h, rot) {
    const p = worldToScreen(cx, cy);
    ctx.save();
    ctx.translate(p.x, p.y);
    if (rot) ctx.rotate(rot * Math.PI / 180);
    ctx.strokeStyle = R.COLORS.select;
    ctx.lineWidth = 2;
    ctx.strokeRect(-w * view.scale / 2 - 2, -h * view.scale / 2 - 2,
      w * view.scale + 4, h * view.scale + 4);
    ctx.restore();
  }

  function drawMarkerSel(m, selected) {
    if (!m) return;
    const p = worldToScreen(m.x, m.y);
    R.drawMarker(ctx, p.x, p.y, view.scale);
    if (selected) {
      ctx.strokeStyle = R.COLORS.select;
      ctx.lineWidth = 2;
      ctx.strokeRect(p.x - 2, p.y - 2, view.scale + 4, view.scale + 4);
    }
  }

  function drawLevelPaths(mats) {
    const paths = level.paths || [];
    for (let i = 0; i < paths.length; i++) {
      const pth = paths[i];
      if (!pth.points || pth.points.length < 2) continue;
      const isSelected = sel && sel.kind === 'path' && sel.index === i;
      const parent = (pth.attach != null && mats.walls[pth.attach]) ? mats.walls[pth.attach] : null;

      ctx.save();
      ctx.strokeStyle = isSelected ? R.COLORS.select : 'rgba(70, 200, 255, 0.85)';
      ctx.fillStyle = isSelected ? R.COLORS.select : 'rgba(70, 200, 255, 0.95)';
      ctx.lineWidth = isSelected ? 2.5 : 1.5;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();

      for (let j = 0; j < pth.points.length; j++) {
        const pt = pth.points[j];
        const q = parent ? M.apply(parent, pt[0], pt[1]) : { x: pt[0], y: pt[1] };
        const sp = worldToScreen(q.x, q.y);
        if (j === 0) ctx.moveTo(sp.x, sp.y); else ctx.lineTo(sp.x, sp.y);
      }
      if (pth.mode === 'loop') ctx.closePath();
      ctx.stroke();
      ctx.setLineDash([]);

      // Điểm mút
      for (let j = 0; j < pth.points.length; j++) {
        const pt = pth.points[j];
        const q = parent ? M.apply(parent, pt[0], pt[1]) : { x: pt[0], y: pt[1] };
        const sp = worldToScreen(q.x, q.y);
        ctx.fillRect(sp.x - 3.5, sp.y - 3.5, 7, 7);
      }
      ctx.restore();
    }
  }

  function drawDraftPath() {
    if (!draftPath || !draftPath.points) return;
    const pts = draftPath.points;
    ctx.save();
    ctx.strokeStyle = '#ffd54a';
    ctx.fillStyle = '#ffd54a';
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    for (let i = 0; i < pts.length; i++) {
      const sp = worldToScreen(pts[i][0], pts[i][1]);
      if (i === 0) ctx.moveTo(sp.x, sp.y); else ctx.lineTo(sp.x, sp.y);
    }
    if (hover) {
      const sp = worldToScreen(hover.x, hover.y);
      ctx.lineTo(sp.x, sp.y);
    }
    ctx.stroke();
    ctx.setLineDash([]);
    pts.forEach(function (p) {
      const sp = worldToScreen(p[0], p[1]);
      ctx.fillRect(sp.x - 4, sp.y - 4, 8, 8);
    });
    ctx.restore();
  }

  function drawSnapCues() {
    if (!activeSnap || activeSnap.kind === 'free') return;
    ctx.save();
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = 'rgba(0, 240, 255, 0.75)';

    // Đường gióng thẳng đứng
    if (activeSnap.gx !== null) {
      const sx = worldToScreen(activeSnap.gx, 0).x;
      ctx.beginPath();
      ctx.moveTo(sx, 0);
      ctx.lineTo(sx, view.H);
      ctx.stroke();
    }
    // Đường gióng nằm ngang
    if (activeSnap.gy !== null) {
      const sy = worldToScreen(0, activeSnap.gy).y;
      ctx.beginPath();
      ctx.moveTo(0, sy);
      ctx.lineTo(view.W, sy);
      ctx.stroke();
    }

    // Ô vuông nhỏ tại điểm bắt dính
    if (activeSnap.kind === 'point') {
      const sp = worldToScreen(activeSnap.x, activeSnap.y);
      ctx.setLineDash([]);
      ctx.fillStyle = '#00f0ff';
      ctx.fillRect(sp.x - 4, sp.y - 4, 8, 8);
      ctx.strokeStyle = '#ffffff';
      ctx.strokeRect(sp.x - 4, sp.y - 4, 8, 8);
    }
    ctx.restore();
  }

  function drawMotionOverlays(obj, mats) {
    const m = obj.motion || { type: 'static' };
    const parent = (obj.attach != null && mats.walls[obj.attach])
      ? mats.walls[obj.attach] : M.identity();

    if (m.type === 'path' && m.points && m.points.length >= 2) {
      ctx.save();
      ctx.strokeStyle = 'rgba(120, 170, 255, 0.75)';
      ctx.fillStyle = 'rgba(120, 170, 255, 0.85)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      for (let i = 0; i < m.points.length; i++) {
        const q = M.apply(parent, m.points[i][0], m.points[i][1]);
        const sp = worldToScreen(q.x, q.y);
        if (i === 0) ctx.moveTo(sp.x, sp.y); else ctx.lineTo(sp.x, sp.y);
      }
      if (m.mode === 'loop') ctx.closePath();
      ctx.stroke();
      ctx.setLineDash([]);
      [m.points[0], m.points[m.points.length - 1]].forEach(function (pt) {
        const q = M.apply(parent, pt[0], pt[1]);
        const sp = worldToScreen(q.x, q.y);
        ctx.fillRect(sp.x - 3, sp.y - 3, 6, 6);
      });
      ctx.restore();
    }

    if (m.type === 'spin') {
      const cx0 = obj.x + (obj.w !== undefined ? obj.w / 2 : obj.size / 2);
      const cy0 = obj.y + (obj.h !== undefined ? obj.h / 2 : obj.size / 2);
      const pv = m.pivot || [cx0, cy0];
      const q = M.apply(parent, pv[0], pv[1]);
      const sp = worldToScreen(q.x, q.y);
      ctx.save();
      ctx.strokeStyle = 'rgba(200, 120, 255, 0.95)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(sp.x - 7, sp.y); ctx.lineTo(sp.x + 7, sp.y);
      ctx.moveTo(sp.x, sp.y - 7); ctx.lineTo(sp.x, sp.y + 7);
      ctx.stroke();
      ctx.strokeRect(sp.x - 3.5, sp.y - 3.5, 7, 7);
      ctx.restore();
    }
  }

  // -------- Chuột & Con trỏ --------
  function evCell(e) {
    const rect = canvas.getBoundingClientRect();
    return screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
  }

  canvas.addEventListener('contextmenu', function (e) {
    e.preventDefault();
  });

  canvas.addEventListener('pointerdown', function (e) {
    canvas.setPointerCapture(e.pointerId);
    const raw = evCell(e);
    const bypassSnap = e.altKey;

    // Pan: Space + chuột trái, hoặc chuột giữa (1), hoặc chuột phải (2)
    if (isSpaceDown || e.button === 1 || e.button === 2) {
      drag = { mode: 'pan', sx: e.clientX, sy: e.clientY, cx: view.cx, cy: view.cy };
      return;
    }

    if (tool === 'select') {
      const hit = hitAny(raw);
      sel = hit;
      if (hit) {
        pushUndo();
        const obj = objOf(hit);
        drag = {
          mode: 'move',
          kind: hit.kind,
          index: hit.index,
          start: raw,
          orig: { x: obj.x, y: obj.y },
          anchors: getObjectAnchors(obj, hit.kind),
          exclude: new Set([hit.kind + ':' + hit.index])
        };
      } else {
        // Kéo nền trống = Pan viewport
        drag = { mode: 'pan', sx: e.clientX, sy: e.clientY, cx: view.cx, cy: view.cy };
      }
      renderProps();
      draw();
      return;
    }

    if (tool === 'wall') {
      pushUndo();
      const s = snapPoint(raw, collectTargets(), bypassSnap);
      drag = { mode: 'drawWall', from: s, to: s };
      activeSnap = s;
      draw();
      return;
    }

    if (tool === 'saw') {
      pushUndo();
      const s = snapPoint(raw, collectTargets(), bypassSnap);
      drag = { mode: 'drawSaw', from: s, to: s };
      activeSnap = s;
      draw();
      return;
    }

    if (tool === 'spawn' || tool === 'goal') {
      pushUndo();
      const s = snapPoint(raw, collectTargets(), bypassSnap);
      const p = { x: Math.round(s.x), y: Math.round(s.y) };
      if (tool === 'spawn') level.spawn = p; else level.goal = p;
      sel = { kind: tool };
      activeSnap = s;
      renderProps(); renderList(); autosave(); draw();
      return;
    }

    if (tool === 'checkpoint') {
      pushUndo();
      const s = snapPoint(raw, collectTargets(), bypassSnap);
      level.checkpoints = level.checkpoints || [];
      level.checkpoints.push({ x: Math.round(s.x), y: Math.round(s.y) });
      sel = { kind: 'checkpoint', index: level.checkpoints.length - 1 };
      activeSnap = s;
      renderProps(); renderList(); autosave(); draw();
      return;
    }

    if (tool === 'path') {
      const targets = collectTargets();
      const p = snapPoint(raw, targets, bypassSnap);
      activeSnap = p;
      if (!draftPath) {
        draftPath = { points: [[p.x, p.y]] };
      } else {
        // Nếu click gần điểm đầu tiên (>= 3 điểm) -> kết thúc vòng kín (loop)
        const first = draftPath.points[0];
        const distPx = Math.hypot(p.x - first[0], p.y - first[1]) * view.scale;
        if (draftPath.points.length >= 3 && distPx <= 16) {
          finishPath('loop');
          return;
        }
        draftPath.points.push([p.x, p.y]);
      }
      draw();
      return;
    }

    if (tool === 'erase') {
      const hit = hitAny(raw);
      if (hit && hit.kind !== 'spawn' && hit.kind !== 'goal') {
        pushUndo();
        if (hit.kind === 'wall') {
          level.walls.splice(hit.index, 1);
          remapAttach(hit.index);
        } else if (hit.kind === 'saw') {
          level.saws.splice(hit.index, 1);
        } else if (hit.kind === 'checkpoint') {
          level.checkpoints.splice(hit.index, 1);
        } else if (hit.kind === 'path') {
          level.paths.splice(hit.index, 1);
        }
        if (sel && sel.kind === hit.kind && sel.index === hit.index) sel = null;
        renderProps(); renderList(); autosave(); draw();
        msg('Đã xóa ' + hit.kind);
      } else if (hit) {
        msg('Không thể xóa Spawn hoặc Goal', true);
      }
    }
  });

  canvas.addEventListener('dblclick', function (e) {
    if (tool === 'path' && draftPath) {
      finishPath('pingpong');
    }
  });

  canvas.addEventListener('pointermove', function (e) {
    const raw = evCell(e);
    const bypassSnap = e.altKey;

    if (!drag) {
      const targets = collectTargets();
      const s = snapPoint(raw, targets, bypassSnap);
      hover = s;
      activeSnap = s;
      draw();
      return;
    }

    if (drag.mode === 'pan') {
      view.cx = drag.cx - (e.clientX - drag.sx) / view.scale;
      view.cy = drag.cy - (e.clientY - drag.sy) / view.scale;
      draw();
      return;
    }

    if (drag.mode === 'move') {
      const obj = objOf(drag);
      if (!obj) return;
      const targets = collectTargets(drag.exclude);
      const delta = { x: raw.x - drag.start.x, y: raw.y - drag.start.y };
      const res = snapMove(drag.anchors, delta, targets, bypassSnap);
      obj.x = Math.round(drag.orig.x + res.dx);
      obj.y = Math.round(drag.orig.y + res.dy);
      activeSnap = res.s;
      if (!propsDirty) renderProps();
      draw();
      return;
    }

    if (drag.mode === 'drawWall') {
      const targets = collectTargets();
      const s = snapPoint(raw, targets, bypassSnap);
      drag.to = s;
      activeSnap = s;
      draw();
      return;
    }

    if (drag.mode === 'drawSaw') {
      const targets = collectTargets();
      const s = snapPoint(raw, targets, bypassSnap);
      drag.to = s;
      activeSnap = s;
      draw();
    }
  });

  canvas.addEventListener('pointerup', function (e) {
    if (!drag) return;

    if (drag.mode === 'drawWall') {
      const r = getDrawWallRect(drag.from, drag.to || drag.from);
      if (r.w >= 1 && r.h >= 1) {
        r.motion = QMFormat.staticMotion();
        r.attach = null;
        level.walls.push(r);
        sel = { kind: 'wall', index: level.walls.length - 1 };
        trySnapToPath(r, 'wall');
        autosave();
        msg('Thêm Wall ' + r.w + '×' + r.h + ' @(' + r.x + ',' + r.y + ')');
      } else {
        undoStack.pop();
        msg('Wall quá nhỏ – bỏ qua', true);
      }
    } else if (drag.mode === 'drawSaw') {
      const s = getDrawSawRect(drag.from, drag.to || drag.from);
      const sawObj = {
        x: s.x,
        y: s.y,
        size: s.size,
        spin: 90,
        motion: QMFormat.staticMotion(),
        attach: null
      };
      level.saws.push(sawObj);
      sel = { kind: 'saw', index: level.saws.length - 1 };
      trySnapToPath(sawObj, 'saw');
      autosave();
      msg('Thêm Saw size ' + s.size + ' @(' + s.x + ',' + s.y + ')');
    } else if (drag.mode === 'move') {
      const obj = objOf(drag);
      if (obj && (drag.kind === 'wall' || drag.kind === 'saw')) {
        trySnapToPath(obj, drag.kind);
      }
      autosave();
    }

    drag = null;
    activeSnap = null;
    renderProps();
    renderList();
    draw();
  });

  canvas.addEventListener('pointerleave', function () {
    hover = null;
    activeSnap = null;
    draw();
  });

  // Wheel = Zoom quanh con trỏ chuột
  canvas.addEventListener('wheel', function (e) {
    e.preventDefault();
    const r = canvas.getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    const before = screenToWorld(mx, my);
    view.scale = Math.min(128, Math.max(2,
      view.scale * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015))));
    const after = screenToWorld(mx, my);
    view.cx += before.x - after.x;
    view.cy += before.y - after.y;
    draw();
  }, { passive: false });

  // -------- Keyboard --------
  window.addEventListener('keydown', function (e) {
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'select' || tag === 'textarea') return;

    if (e.code === 'Space') {
      if (!isSpaceDown) {
        isSpaceDown = true;
        canvas.style.cursor = 'grab';
      }
      e.preventDefault();
      return;
    }

    if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ') {
      e.preventDefault();
      if (e.shiftKey) redo(); else undo();
      return;
    }

    if ((e.ctrlKey || e.metaKey) && e.code === 'KeyY') {
      e.preventDefault();
      redo();
      return;
    }

    if (e.code === 'KeyR') {
      e.preventDefault();
      rotateSelection(e.shiftKey ? -1 : 1);
      return;
    }

    if (e.code === 'KeyG') {
      toggleSnap();
      return;
    }

    if (e.code === 'Enter') {
      if (tool === 'path' && draftPath) {
        e.preventDefault();
        finishPath('pingpong');
        return;
      }
    }

    if (e.code === 'Escape') {
      if (draftPath) {
        draftPath = null;
        msg('Đã hủy vẽ Path');
        draw();
        return;
      }
    }

    if (e.code === 'Backspace') {
      if (tool === 'path' && draftPath && draftPath.points && draftPath.points.length) {
        e.preventDefault();
        draftPath.points.pop();
        if (!draftPath.points.length) draftPath = null;
        draw();
        return;
      }
    }

    if (e.code === 'Delete' || e.code === 'Backspace') {
      e.preventDefault();
      deleteSelection();
      return;
    }

    const map = {
      Digit1: 'select', Digit2: 'wall', Digit3: 'saw',
      Digit4: 'spawn', Digit5: 'goal', Digit6: 'checkpoint',
      Digit7: 'erase', Digit8: 'path'
    };
    if (map[e.code]) setTool(map[e.code]);
    if (e.code === 'Digit0') resetView();
  });

  window.addEventListener('keyup', function (e) {
    if (e.code === 'Space') {
      isSpaceDown = false;
      canvas.style.cursor = (tool === 'select' || tool === 'erase') ? 'default' : 'crosshair';
    }
  });

  // -------- Snap Button --------
  function toggleSnap() {
    const newState = !snapOpts.grid;
    snapOpts.objects = newState;
    snapOpts.guides = newState;
    snapOpts.grid = newState;
    const btn = $('ed-snap-btn');
    if (btn) {
      btn.textContent = newState ? 'Snap: BẬT' : 'Snap: TẮT';
      btn.classList.toggle('active', newState);
    }
    msg('Snap: ' + (newState ? 'BẬT' : 'TẮT (giữ Alt để tạm tắt)'));
  }

  const snapBtn = $('ed-snap-btn');
  if (snapBtn) snapBtn.addEventListener('click', toggleSnap);

  // -------- Properties Panel --------
  function renderProps() {
    propsDirty = false;
    const body = $('ed-props-body');
    if (!sel) {
      body.innerHTML = '<p class="hint">Chọn 1 thành phần để sửa.<br><br>' +
        'Tổng: ' + level.walls.length + ' wall, ' + level.saws.length + ' saw, ' +
        (level.checkpoints ? level.checkpoints.length : 0) + ' checkpoint, ' +
        (level.paths ? level.paths.length : 0) + ' path.</p>';
      return;
    }

    let html = '';
    if (sel.kind === 'wall') {
      const w = level.walls[sel.index];
      if (!w) { sel = null; return renderProps(); }
      html = '<h4>WALL</h4>' +
        numRow('X', 'x', w.x) + numRow('Y', 'y', w.y) +
        numRow('Rộng', 'w', w.w, 1) + numRow('Cao', 'h', w.h, 1) +
        numRow('Xoay (độ)', 'rot', w.rot || 0, 15) +
        motionHtml(w, 'wall', sel.index);
    } else if (sel.kind === 'saw') {
      const s = level.saws[sel.index];
      if (!s) { sel = null; return renderProps(); }
      html = '<h4>SAW</h4>' +
        numRow('X', 'x', s.x) + numRow('Y', 'y', s.y) +
        numRow('Kích cỡ', 'size', s.size, 1) +
        numRow('Tốc độ xoay răng (độ/giây)', 'spin', s.spin, 15) +
        motionHtml(s, 'saw', sel.index);
    } else if (sel.kind === 'checkpoint') {
      const c = level.checkpoints[sel.index];
      if (!c) { sel = null; return renderProps(); }
      html = '<h4>CHECKPOINT</h4>' + numRow('X', 'x', c.x) + numRow('Y', 'y', c.y);
    } else if (sel.kind === 'spawn' || sel.kind === 'goal') {
      const m = sel.kind === 'spawn' ? level.spawn : level.goal;
      html = '<h4>' + sel.kind.toUpperCase() + '</h4>' + numRow('X', 'x', m.x) + numRow('Y', 'y', m.y);
    } else if (sel.kind === 'path') {
      const p = level.paths[sel.index];
      if (!p) { sel = null; return renderProps(); }
      html = pathPropsHtml(p, sel.index);
    }

    html += '<button id="ed-del" class="danger">Xóa (Del)</button>';
    body.innerHTML = html;
    bindProps(objOf(sel));
    const delBtn = $('ed-del');
    if (delBtn) delBtn.addEventListener('click', deleteSelection);
  }

  function numRow(label, key, val, step) {
    return '<label class="prow">' + label +
      '<input type="number" data-k="' + key + '" value="' + val + '" step="' + (step || 1) + '"></label>';
  }

  function pathPropsHtml(p, index) {
    const pts = (p.points || []).map(function (pt) { return pt[0] + ',' + pt[1]; }).join(' ');
    const modes = [['pingpong', 'Đảo ngay 2 đầu'], ['loop', 'Khép vòng (loop)']];
    let mopts = '';
    modes.forEach(function (t) {
      mopts += '<option value="' + t[0] + '"' + (p.mode === t[0] ? ' selected' : '') + '>' + t[1] + '</option>';
    });

    let aopts = '<option value="">— Không (Tọa độ tự do) —</option>';
    for (let i = 0; i < level.walls.length; i++) {
      const w = level.walls[i];
      aopts += '<option value="' + i + '"' + (p.attach === i ? ' selected' : '') +
        '>Wall ' + i + ' (' + w.w + '×' + w.h + ')</option>';
    }

    return '<h4>ĐƯỜNG PATH (' + p.id + ')</h4>' +
      '<label class="prow">Chế độ<select data-k="path.mode">' + mopts + '</select></label>' +
      '<label class="prow">Các điểm (x,y ...)<input type="text" data-k="path.points" value="' + pts + '"></label>' +
      '<label class="prow">Gắn vào Wall cha<select data-k="path.attach">' + aopts + '</select></label>' +
      '<p class="hint">Khi gắn vào Wall cha, Path sẽ chuyển sang hệ toạ độ của Wall đó và đi theo khi Wall xoay/di chuyển.</p>';
  }

  function motionHtml(obj, kind, index) {
    const m = obj.motion || { type: 'static' };
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

      // Danh sách Path dùng chung
      let popts = '<option value="">— Tùy biến —</option>';
      (level.paths || []).forEach(function (pth) {
        popts += '<option value="' + pth.id + '"' + (m.pathId === pth.id ? ' selected' : '') +
          '>Path ' + pth.id + ' (' + pth.points.length + ' điểm)</option>';
      });

      html += '<label class="prow">Dùng Path chung<select data-k="motion.pathId">' + popts + '</select></label>' +
        '<label class="prow">Đường (x,y ...)<input type="text" data-k="motion.points" value="' + pts + '"></label>' +
        '<label class="prow">Chế độ<select data-k="motion.mode">' + mopts + '</select></label>' +
        '<label class="prow">Tốc độ (ô/giây)<input type="number" data-k="motion.speed" step="0.5" value="' + (m.speed || 4) + '"></label>' +
        '<label class="prow">Pha (0..1)<input type="number" data-k="motion.phase" step="0.05" value="' + (m.phase || 0) + '"></label>';
    } else if (m.type === 'spin') {
      html += '<label class="prow">Tốc độ (độ/giây)<input type="number" data-k="motion.speed" step="15" value="' + (m.speed || 90) + '"></label>' +
        '<label class="prow">Pha ban đầu (độ)<input type="number" data-k="motion.phase" step="15" value="' + (m.phase || 0) + '"></label>' +
        '<label class="prow">Pivot X<input type="number" data-k="motion.pivotX" step="1" placeholder="tâm rect" value="' + (m.pivot ? m.pivot[0] : '') + '"></label>' +
        '<label class="prow">Pivot Y<input type="number" data-k="motion.pivotY" step="1" placeholder="tâm rect" value="' + (m.pivot ? m.pivot[1] : '') + '"></label>';
    }

    let aopts = '<option value="">— Không —</option>';
    for (let i = 0; i < level.walls.length; i++) {
      if (kind === 'wall' && i >= index) continue;
      const w = level.walls[i];
      aopts += '<option value="' + i + '"' + (obj.attach === i ? ' selected' : '') +
        '>Wall ' + i + ' (' + w.w + '×' + w.h + ')</option>';
    }
    html += '<label class="prow">Gắn vào (attach)<select data-k="attach">' + aopts + '</select></label>';
    html += '<p class="hint">Phím R / Shift+R để xoay 15° quanh tâm. Kéo thả gần Path để tự gắn.</p>';
    return html;
  }

  function changeMotionType(obj, type) {
    pushUndo();
    const m = obj.motion || { type: 'static' };
    const cx = obj.x + (obj.w !== undefined ? obj.w / 2 : obj.size / 2);
    const cy = obj.y + (obj.h !== undefined ? obj.h / 2 : obj.size / 2);
    if (type === 'path' && (!m.points || m.points.length < 2)) {
      m.points = [[cx - 2, cy], [cx + 2, cy]];
      if (!m.speed) m.speed = 4;
      if (!m.mode) m.mode = 'pingpong';
    }
    m.type = type;
    obj.motion = m;
  }

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
    if (sel && sel.kind === 'path') {
      obj.points = pts;
    } else {
      obj.motion.points = pts;
    }
  }

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
        if (k === 'motion.type') {
          changeMotionType(obj, inp.value);
          renderProps();
        } else if (k === 'motion.mode') {
          obj.motion.mode = inp.value;
        } else if (k === 'motion.pathId') {
          const pid = inp.value;
          obj.motion.pathId = pid || null;
          if (pid) {
            const found = (level.paths || []).find(function (p) { return p.id === pid; });
            if (found) {
              obj.motion.points = found.points.map(function (p) { return p.slice(); });
              obj.motion.mode = found.mode;
              if (found.attach != null) obj.attach = found.attach;
            }
          }
          renderProps();
        } else if (k === 'motion.points' || k === 'path.points') {
          applyPoints(obj, inp.value);
        } else if (k === 'path.mode') {
          obj.mode = inp.value;
        } else if (k === 'path.attach') {
          const oldAttach = obj.attach;
          const newAttach = inp.value === '' ? null : parseInt(inp.value, 10);
          if (oldAttach !== newAttach) {
            // Chuyển đổi toạ độ points khi đổi attach
            if (oldAttach != null && newAttach == null) {
              obj.points = wallLocalToWorld(oldAttach, obj.points);
            } else if (oldAttach == null && newAttach != null) {
              obj.points = worldToWallLocal(newAttach, obj.points);
            } else if (oldAttach != null && newAttach != null) {
              const worldPts = wallLocalToWorld(oldAttach, obj.points);
              obj.points = worldToWallLocal(newAttach, worldPts);
            }
            obj.attach = newAttach;
            renderProps();
          }
        } else if (k === 'motion.pivotX' || k === 'motion.pivotY') {
          applyPivot(obj, k, inp.value);
        } else if (k === 'attach') {
          obj.attach = inp.value === '' ? null : parseInt(inp.value, 10);
        } else if (k.indexOf('motion.') === 0) {
          obj.motion[k.slice(7)] = parseFloat(inp.value) || 0;
        } else {
          let v = parseFloat(inp.value);
          if (isNaN(v)) return;
          if (k === 'w' || k === 'h') v = Math.max(1, Math.round(v));
          if (k === 'size') v = Math.max(1, Math.round(v));
          if (k === 'x' || k === 'y') v = Math.round(v);
          obj[k] = v;
        }
        autosave();
        draw();
        renderList();
      });

      inp.addEventListener('blur', function () {
        editing = false;
        propsDirty = false;
      });
    });
  }

  function motionGlyph(o) {
    let g = '';
    if (o.motion && o.motion.type === 'path') g += ' →';
    if (o.motion && o.motion.type === 'spin') g += ' ⟳';
    if (o.attach != null) g += ' ⧉';
    return g;
  }

  function remapAttach(deletedIndex) {
    level.walls.concat(level.saws).forEach(function (o) {
      if (o.attach == null) return;
      if (o.attach === deletedIndex) o.attach = null;
      else if (o.attach > deletedIndex) o.attach--;
    });
    (level.paths || []).forEach(function (p) {
      if (p.attach == null) return;
      if (p.attach === deletedIndex) p.attach = null;
      else if (p.attach > deletedIndex) p.attach--;
    });
  }

  function deleteSelection() {
    if (!sel) return;
    pushUndo();
    if (sel.kind === 'wall') {
      level.walls.splice(sel.index, 1);
      remapAttach(sel.index);
    } else if (sel.kind === 'saw') {
      level.saws.splice(sel.index, 1);
    } else if (sel.kind === 'checkpoint') {
      level.checkpoints.splice(sel.index, 1);
    } else if (sel.kind === 'path') {
      const p = level.paths[sel.index];
      const pid = p ? p.id : null;
      level.paths.splice(sel.index, 1);
      if (pid) {
        level.walls.concat(level.saws).forEach(function (o) {
          if (o.motion && o.motion.pathId === pid) o.motion = QMFormat.staticMotion();
        });
      }
    } else if (sel.kind === 'spawn') {
      level.spawn = { x: 2, y: level.box.h - 3 };
    } else if (sel.kind === 'goal') {
      level.goal = { x: level.box.w - 3, y: level.box.h - 3 };
    }
    sel = null;
    autosave();
    renderProps();
    renderList();
    draw();
    msg('Đã xóa thành phần');
  }

  // -------- Danh Sách Thành Phần (bên trái) --------
  function renderList() {
    const ul = $('ed-list');
    if (!ul) return;
    ul.innerHTML = '';

    function item(label, kind, index) {
      const li = document.createElement('li');
      li.textContent = label;
      if (sel && sel.kind === kind && sel.index === index) li.className = 'active';
      li.addEventListener('click', function () {
        sel = { kind: kind, index: index };
        setTool('select');
        renderProps();
        renderList();
        draw();
      });
      ul.appendChild(li);
    }

    level.walls.forEach(function (w, i) {
      item('Wall ' + w.w + '×' + w.h + (w.rot ? ' ↻' + w.rot + '°' : '') + motionGlyph(w), 'wall', i);
    });
    level.saws.forEach(function (s, i) {
      item('Saw ' + s.size + motionGlyph(s), 'saw', i);
    });
    (level.checkpoints || []).forEach(function (c, i) {
      item('Checkpoint @' + c.x + ',' + c.y, 'checkpoint', i);
    });
    (level.paths || []).forEach(function (p, i) {
      item('Path ' + p.id + ' (' + p.points.length + 'p)' + (p.attach != null ? ' ⧉' : ''), 'path', i);
    });
  }

  // -------- Toolbar & Topbar --------
  function setTool(t) {
    tool = t;
    document.querySelectorAll('#ed-tools .tool').forEach(function (b) {
      b.classList.toggle('active', b.dataset.tool === t);
    });
    canvas.style.cursor = (t === 'select' || t === 'erase') ? 'default' : 'crosshair';
    if (t !== 'path') draftPath = null;
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

  $('ed-name').addEventListener('input', function () {
    level.name = this.value;
    autosave();
  });

  function applyBox() {
    pushUndo();
    level.box.w = Math.max(8, Math.min(600, parseInt($('ed-bw').value, 10) || 64));
    level.box.h = Math.max(6, Math.min(400, parseInt($('ed-bh').value, 10) || 36));
    autosave();
    draw();
  }
  $('ed-bw').addEventListener('change', applyBox);
  $('ed-bh').addEventListener('change', applyBox);

  $('ed-new').addEventListener('click', function () {
    if (!confirm('Tạo level mới? Mọi thay đổi chưa export sẽ mất.')) return;
    pushUndo();
    level = QMFormat.makeDefaultLevel();
    sel = null;
    draftPath = null;
    syncTopbar();
    renderProps();
    renderList();
    resetView();
    autosave();
    msg('Đã tạo level mới');
  });

  $('ed-undo').addEventListener('click', undo);
  const redoBtn = $('ed-redo');
  if (redoBtn) redoBtn.addEventListener('click', redo);

  $('ed-test').addEventListener('click', function () {
    try { localStorage.setItem('quadmaze.test', QMFormat.stringify(level)); } catch (e) {}
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
      draftPath = null;
      syncTopbar();
      renderProps();
      renderList();
      resetView();
      autosave();
      msg('Đã import "' + level.name + '"' +
        (res.errors.length ? ' (' + res.errors.length + ' cảnh báo)' : ''));
    };
    reader.readAsText(f);
  });

  // Xem trước chuyển động (anim)
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

  window.addEventListener('resize', function () {
    resizeCanvas();
    draw();
  });

  // -------- Khởi tạo Editor --------
  function init() {
    resizeCanvas();
    // Khôi phục bản thảo đã lưu từ localStorage nếu có
    try {
      const draft = localStorage.getItem('quadmaze.editor.draft');
      if (draft) {
        const parsed = QMFormat.parse(draft);
        if (parsed.ok && parsed.level) {
          level = parsed.level;
          msg('Đã khôi phục bản thảo tự động lưu');
        }
      }
    } catch (e) {}

    syncTopbar();
    renderProps();
    renderList();
    setTool('select');
    resetView();
  }

  init();
})();
