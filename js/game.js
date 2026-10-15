/*
 * Quad Maze clone – Core game engine (canvas 2D).
 * - Vật lý gravity thấp, đa nhảy (multijump) khi chạm/tiện gần wall <= 0.5 ô.
 * - Saw trúng -> chết -> respawn tại checkpoint gần nhất.
 * - Timer đếm tiếp tục xuyên suốt (phong cách speedrun).
 */
(function (global) {
  'use strict';
  const R = global.QMRender;

  const PHYS = {
    speed: 10,       // tốc độ ngang (cell/giây)
    gravity: 60,     // trọng lực (cell/giây^2) – thấp để có cảm giác lơ lửng
    jumpV: 21,       // vận tốc nhảy (cell/giây) -> độ cao ~3.7 ô
    maxFall: 42,
    nearDist: 0.5,   // bán kính "gần wall" cho multijump = 1/2 bề rộng square
    deathTime: 0.35, // thời gian chết trước khi respawn
    spawnGrace: 0.3  // miễn nhiễm sau khi respawn
  };

  const STEP = 1 / 120; // fixed timestep

  function motionOffset(m, t) {
    if (!m || m.type === 'static' || !m.distance) return { x: 0, y: 0 };
    const w = Math.PI * 2 * (m.speed || 1); // speed = chu kỳ/giây
    const ph = Math.PI * 2 * (m.phase || 0); // phase = chu kỳ (0..1)
    if (m.type === 'horizontal') return { x: m.distance * Math.sin(w * t + ph), y: 0 };
    if (m.type === 'vertical') return { x: 0, y: m.distance * Math.sin(w * t + ph) };
    if (m.type === 'circle') {
      return { x: m.distance * Math.cos(w * t + ph), y: m.distance * Math.sin(w * t + ph) };
    }
    return { x: 0, y: 0 };
  }

  function overlap(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  }

  // Khoảng cách giữa 2 AABB (0 nếu đang chồng lấn/chạm).
  function gapDist(a, b) {
    const dx = Math.max(a.x - (b.x + b.w), b.x - (a.x + a.w), 0);
    const dy = Math.max(a.y - (b.y + b.h), b.y - (a.y + a.h), 0);
    return Math.hypot(dx, dy);
  }

  // Circle (saw) vs AABB (player): có va chạm không.
  function circleHitsRect(cx, cy, r, rect) {
    const nx = Math.max(rect.x, Math.min(cx, rect.x + rect.w));
    const ny = Math.max(rect.y, Math.min(cy, rect.y + rect.h));
    const dx = cx - nx, dy = cy - ny;
    return dx * dx + dy * dy <= r * r;
  }

  function fmtTime(t) { return t.toFixed(2); }

  function Game(canvas, opts) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.opts = opts || {};
    this.level = null;
    this.state = 'idle'; // idle | playing | paused | won
    this.time = 0;
    this.hazardT = 0;
    this.acc = 0;
    this.lastTs = 0;
    this.raf = 0;
    this.input = { left: false, right: false };
    this._jumpQueued = false;
    this.player = { x: 0, y: 0, w: 1, h: 1, vx: 0, vy: 0, grounded: false, dead: false, deadT: 0, grace: 0 };
    this.respawn = { x: 0, y: 0 };
    this.activeCheckpoint = -1;
    this._onKey = this._onKey.bind(this);
    this._loop = this._loop.bind(this);
    this._resize = this._resize.bind(this);
    window.addEventListener('keydown', this._onKey);
    window.addEventListener('keyup', this._onKey);
    window.addEventListener('resize', this._resize);
    this._resize();
  }

  Game.prototype.load = function (level) {
    this.level = level;
    this.time = 0;
    this.hazardT = 0;
    this.activeCheckpoint = -1;
    this.respawn = { x: level.spawn.x, y: level.spawn.y };
    this._resetPlayer(true);
    this.state = 'playing'; // luôn bắt đầu chơi khi load level mới (kể cả sau win/pause)
    this.acc = 0;
    if (!this.raf) { this.lastTs = performance.now(); this.raf = requestAnimationFrame(this._loop); }
  };

  Game.prototype._resetPlayer = function (hard) {
    const p = this.player;
    p.x = this.respawn.x;
    p.y = this.respawn.y;
    p.vx = 0;
    p.vy = 0;
    p.dead = false;
    p.deadT = 0;
    p.grace = PHYS.spawnGrace;
    if (hard) p.grounded = false;
  };

  Game.prototype.restart = function () {
    if (!this.level) return;
    this.time = 0;
    this.hazardT = 0;
    this.activeCheckpoint = -1;
    this.respawn = { x: this.level.spawn.x, y: this.level.spawn.y };
    this._resetPlayer(true);
    this.state = 'playing';
  };

  Game.prototype.pause = function () { if (this.state === 'playing') this.state = 'paused'; };
  Game.prototype.resume = function () { if (this.state === 'paused') this.state = 'playing'; };
  Game.prototype.togglePause = function () {
    if (this.state === 'playing') this.state = 'paused';
    else if (this.state === 'paused') this.state = 'playing';
  };

  Game.prototype.jump = function () { this._jumpQueued = true; };
  Game.prototype.setLeft = function (v) { this.input.left = v; };
  Game.prototype.setRight = function (v) { this.input.right = v; };

  Game.prototype._onKey = function (e) {
    if (!this.level) return;
    const down = e.type === 'keydown';
    if (down && e.repeat) { if (this._isGameKey(e)) e.preventDefault(); return; }
    switch (e.code) {
      case 'ArrowLeft': case 'KeyA': this.input.left = down; break;
      case 'ArrowRight': case 'KeyD': this.input.right = down; break;
      case 'Backspace': case 'Space': case 'ArrowUp': case 'KeyW':
        if (down) this.jump();
        break;
      case 'KeyR': if (down) this.restart(); break;
      case 'Escape': case 'KeyP': if (down) this.togglePause(); break;
      default: return;
    }
    if (this._isGameKey(e)) e.preventDefault();
  };

  Game.prototype._isGameKey = function (e) {
    return ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'KeyA', 'KeyD', 'KeyW',
      'Backspace', 'Space', 'KeyR', 'Escape', 'KeyP'].indexOf(e.code) !== -1;
  };

  Game.prototype._loop = function (ts) {
    this.raf = requestAnimationFrame(this._loop);
    let dt = (ts - this.lastTs) / 1000;
    this.lastTs = ts;
    if (dt > 0.25) dt = 0.25;
    if (this.state === 'playing') {
      this.acc += dt;
      while (this.acc >= STEP) { this._step(STEP); this.acc -= STEP; }
    } else {
      this.acc = 0;
    }
    this._render();
  };

  // ---- SAT collision: hỗ trợ wall xoay quanh tâm (OBB) ----
  function obbVerts(o) {
    const c = Math.cos(o.rot || 0), s = Math.sin(o.rot || 0);
    const pts = [[-o.hw, -o.hh], [o.hw, -o.hh], [o.hw, o.hh], [-o.hw, o.hh]];
    return pts.map(function (p) {
      return { x: o.cx + p[0] * c - p[1] * s, y: o.cy + p[0] * s + p[1] * c };
    });
  }

  function projectVerts(verts, ax) {
    let min = Infinity, max = -Infinity;
    for (let i = 0; i < verts.length; i++) {
      const d = verts[i].x * ax.x + verts[i].y * ax.y;
      if (d < min) min = d;
      if (d > max) max = d;
    }
    return [min, max];
  }

  // Trả về {x, y, depth}: vector nhỏ nhất đẩy A khỏi B, null nếu không chồng lấn.
  function satMTV(A, B) {
    const av = obbVerts(A), bv = obbVerts(B);
    const ar = A.rot || 0, br = B.rot || 0;
    const axes = [
      { x: Math.cos(ar), y: Math.sin(ar) },
      { x: -Math.sin(ar), y: Math.cos(ar) },
      { x: Math.cos(br), y: Math.sin(br) },
      { x: -Math.sin(br), y: Math.cos(br) }
    ];
    let best = Infinity, bax = null;
    for (let i = 0; i < 4; i++) {
      const ax = axes[i];
      const pa = projectVerts(av, ax), pb = projectVerts(bv, ax);
      const ov = Math.min(pa[1], pb[1]) - Math.max(pa[0], pb[0]);
      if (ov <= 0) return null;
      if (ov < best) { best = ov; bax = ax; }
    }
    const dx = A.cx - B.cx, dy = A.cy - B.cy;
    if (dx * bax.x + dy * bax.y < 0) bax = { x: -bax.x, y: -bax.y };
    return { x: bax.x * best, y: bax.y * best, depth: best };
  }

  // Khoảng cách tâm point tới OBB (0 nếu bên trong).
  function pointObbGap(px, py, o) {
    const c = Math.cos(-(o.rot || 0)), s = Math.sin(-(o.rot || 0));
    const dx = px - o.cx, dy = py - o.cy;
    const lx = dx * c - dy * s, ly = dx * s + dy * c;
    const qx = Math.max(Math.abs(lx) - o.hw, 0);
    const qy = Math.max(Math.abs(ly) - o.hh, 0);
    return Math.hypot(qx, qy);
  }

  // Danh sách shape rắn (OBB) = wall (kể cả di chuyển/xoay) + 4 tường sandbox vô hạn.
  Game.prototype._solidRects = function () {
    const lv = this.level;
    const t = this.time;
    const rects = [];
    const B = 60; // bề dày tường sandbox
    rects.push({ cx: lv.box.w / 2, cy: -B / 2, hw: lv.box.w / 2 + B, hh: B / 2, rot: 0 });           // trên
    rects.push({ cx: lv.box.w / 2, cy: lv.box.h + B / 2, hw: lv.box.w / 2 + B, hh: B / 2, rot: 0 });  // dưới
    rects.push({ cx: -B / 2, cy: lv.box.h / 2, hw: B / 2, hh: lv.box.h / 2, rot: 0 });                // trái
    rects.push({ cx: lv.box.w + B / 2, cy: lv.box.h / 2, hw: B / 2, hh: lv.box.h / 2, rot: 0 });      // phải
    for (let i = 0; i < lv.walls.length; i++) {
      const w = lv.walls[i];
      const off = motionOffset(w.motion, t);
      rects.push({
        cx: w.x + off.x + w.w / 2,
        cy: w.y + off.y + w.h / 2,
        hw: w.w / 2,
        hh: w.h / 2,
        rot: ((w.rot || 0) * Math.PI) / 180
      });
    }
    return rects;
  };

  // Player OBB (không xoay) cho SAT.
  function playerOBB(p) {
    return { cx: p.x + p.w / 2, cy: p.y + p.h / 2, hw: p.w / 2, hh: p.h / 2, rot: 0 };
  }

  // Một bước vật lý cố định (STEP giây).
  Game.prototype._step = function (dt) {
    const lv = this.level;
    const p = this.player;
    this.time += dt;
    this.hazardT += dt;

    if (p.dead) {
      p.deadT -= dt;
      if (p.deadT <= 0) this._resetPlayer(false);
      return;
    }
    if (p.grace > 0) p.grace -= dt;

    // Điều khiển ngang.
    const want = (this.input.right ? 1 : 0) - (this.input.left ? 1 : 0);
    p.vx = want * PHYS.speed;

    // Nhảy: chỉ khi dính wall / gần wall (<=1/2 ô) hoặc đang đứng trên sàn.
    if (this._jumpQueued) {
      this._jumpQueued = false;
      if (this._canJump(p)) {
        p.vy = -PHYS.jumpV;
        p.grounded = false;
      }
    }

    // Gravity (thấp).
    p.vy += PHYS.gravity * dt;
    if (p.vy > PHYS.maxFall) p.vy = PHYS.maxFall;

    const solids = this._solidRects();

    // Di chuyển trục X rồi tách bằng SAT (hỗ trợ wall xoay).
    p.x += p.vx * dt;
    let po = playerOBB(p);
    for (let i = 0; i < solids.length; i++) {
      const mtv = satMTV(po, solids[i]);
      if (mtv) {
        p.x += mtv.x;
        po.cx += mtv.x;
        // Chỉ khử thành phần vận tốc hướng vào wall.
        if (p.vx * mtv.x + p.vy * mtv.y < 0) p.vx = 0;
      }
    }

    // Trục Y.
    p.grounded = false;
    p.y += p.vy * dt;
    po = playerOBB(p);
    for (let i = 0; i < solids.length; i++) {
      const mtv = satMTV(po, solids[i]);
      if (mtv) {
        p.y += mtv.y;
        po.cy += mtv.y;
        if (mtv.y < -0.0001 && p.vy > 0) p.grounded = true; // đáy chạm sàn (y+ là xuống)
        if (p.vx * mtv.x + p.vy * mtv.y < 0) p.vy = 0;
      }
    }

    // Kiểm tra saw (chết).
    if (p.grace <= 0) {
      for (let i = 0; i < lv.saws.length; i++) {
        const s = lv.saws[i];
        const off = motionOffset(s.motion, this.time);
        const cx = s.x + off.x + s.size / 2;
        const cy = s.y + off.y + s.size / 2;
        // Bán kính chạm = nửa đường chéo vuông (8 khía gear = 2 vuông chồng nhau).
        const rr = s.size * Math.SQRT1_2 * 0.92;
        if (circleHitsRect(cx, cy, rr, p)) { this._die(); return; }
      }
    }

    // Checkpoint.
    for (let i = 0; i < lv.checkpoints.length; i++) {
      const c = lv.checkpoints[i];
      if (overlap(p, { x: c.x, y: c.y, w: 1, h: 1 })) {
        if (this.activeCheckpoint !== i) {
          this.activeCheckpoint = i;
          this.respawn = { x: c.x, y: c.y };
          if (this.opts.onCheckpoint) this.opts.onCheckpoint(i);
        }
        break;
      }
    }

    // Goal.
    const g = lv.goal;
    if (overlap(p, { x: g.x, y: g.y, w: 1, h: 1 })) {
      this.state = 'won';
      if (this.opts.onWin) this.opts.onWin(this.time);
    }
  };

  Game.prototype._canJump = function (p) {
    if (p.grounded) return true;
    const solids = this._solidRects();
    // Tâm player tới wall <= nearDist + half-size = 0.5 + 0.5 = 1.0 ô.
    const reach = PHYS.nearDist + Math.max(p.w, p.h) / 2;
    const cx = p.x + p.w / 2, cy = p.y + p.h / 2;
    for (let i = 0; i < solids.length; i++) {
      if (pointObbGap(cx, cy, solids[i]) <= reach) return true;
    }
    return false;
  };

  Game.prototype._die = function () {
    const p = this.player;
    p.dead = true;
    p.deadT = PHYS.deathTime;
    p.vx = 0;
    p.vy = 0;
    if (this.opts.onDeath) this.opts.onDeath();
  };

  Game.prototype._resize = function () {
    const c = this.canvas;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = c.clientWidth || window.innerWidth;
    const h = c.clientHeight || window.innerHeight;
    c.width = Math.round(w * dpr);
    c.height = Math.round(h * dpr);
    this._dpr = dpr;
  };

  Game.prototype._render = function () {
    const ctx = this.ctx;
    const lv = this.level;
    const dpr = this._dpr || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const W = this.canvas.width / dpr;
    const H = this.canvas.height / dpr;

    // Nền trắng (khu vực ngoài box – không viền).
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, W, H);
    if (!lv) return;

    // Fit toàn bộ box vào màn hình (letterbox).
    const pad = 8;
    const hudH = Math.max(44, H * 0.075);
    const vt = R.viewTransform(W - 2 * pad, H - hudH - pad, lv.box.w, lv.box.h);
    vt.ox += pad;
    vt.oy += hudH;
    this._vt = vt;
    const boxPx = { x: vt.ox, y: vt.oy, w: lv.box.w * vt.scale, h: lv.box.h * vt.scale };

    // Nền box: sọc đỏ chéo xen kẽ.
    R.drawStripes(ctx, boxPx.x, boxPx.y, boxPx.w, boxPx.h, vt.scale);

    // Walls trắng (trên nền đỏ).
    for (let i = 0; i < lv.walls.length; i++) {
      const w = lv.walls[i];
      const off = motionOffset(w.motion, this.time);
      R.drawWallRect(ctx, { x: w.x + off.x, y: w.y + off.y, w: w.w, h: w.h, rot: w.rot || 0 }, vt);
    }

    // Spawn / goal / checkpoints: khối vuông đen cùng cỡ player.
    const ms = vt.scale; // 1 ô
    R.drawMarker(ctx, vt.ox + lv.spawn.x * ms, vt.oy + lv.spawn.y * ms, ms);
    R.drawMarker(ctx, vt.ox + lv.goal.x * ms, vt.oy + lv.goal.y * ms, ms);
    for (let i = 0; i < lv.checkpoints.length; i++) {
      const c = lv.checkpoints[i];
      const cx = vt.ox + c.x * ms, cy = vt.oy + c.y * ms;
      if (i === this.activeCheckpoint) {
        // Checkpoint đã kích hoạt: viền trắng để phân biệt.
        ctx.fillStyle = R.COLORS.marker;
        ctx.fillRect(cx, cy, ms, ms);
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = Math.max(2, ms * 0.08);
        ctx.strokeRect(cx + ctx.lineWidth / 2, cy + ctx.lineWidth / 2, ms - ctx.lineWidth, ms - ctx.lineWidth);
      } else {
        R.drawMarker(ctx, cx, cy, ms);
      }
    }

    // Saws: gear đen 8 khía (2 vuông chồng nhau), luôn xoay.
    for (let i = 0; i < lv.saws.length; i++) {
      const s = lv.saws[i];
      const off = motionOffset(s.motion, this.time);
      const cx = vt.ox + (s.x + off.x + s.size / 2) * vt.scale;
      const cy = vt.oy + (s.y + off.y + s.size / 2) * vt.scale;
      const angle = (s.spin || 90) * Math.PI / 180 * this.hazardT;
      R.drawSaw(ctx, cx, cy, s.size * vt.scale, angle);
    }

    // Player.
    const p = this.player;
    if (!p.dead) {
      const blink = p.grace > 0 && Math.floor(this.hazardT * 20) % 2 === 0;
      ctx.fillStyle = blink ? '#dddddd' : R.COLORS.player;
      ctx.fillRect(vt.ox + p.x * vt.scale, vt.oy + p.y * vt.scale, p.w * vt.scale, p.h * vt.scale);
    }

    // HUD: TIME trái, LEVEL phải (khung trên, ngoài box).
    const fSize = hudH * 0.62;
    R.drawLabel(ctx, 'TIME: ' + fmtTime(this.time), pad * 2, hudH * 0.18, fSize, 'left', 'top');
    const name = lv.name || '';
    R.drawLabel(ctx, ('LEVEL ' + name).toUpperCase(), W - pad * 2, hudH * 0.18, fSize, 'right', 'top');

    // Thông báo nhỏ: paused / won.
    if (this.state === 'paused' || this.state === 'won') {
      const msg = this.state === 'paused' ? 'PAUSED' : 'LEVEL COMPLETE!';
      const sub = this.state === 'paused'
        ? 'P/ESC: resume - R: restart'
        : 'TIME: ' + fmtTime(this.time) + ' - Enter: next level';
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.fillRect(0, H * 0.32, W, H * 0.28);
      R.drawLabel(ctx, msg, W / 2, H * 0.37, Math.min(64, W * 0.06), 'center', 'top');
      R.drawLabel(ctx, sub, W / 2, H * 0.37 + Math.min(80, W * 0.08), Math.min(24, W * 0.028), 'center', 'top');
    }
  };

  Game.prototype.destroy = function () {
    window.removeEventListener('keydown', this._onKey);
    window.removeEventListener('keyup', this._onKey);
    window.removeEventListener('resize', this._resize);
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  };

  global.QuadGame = Game;
  global.QMPhysics = { motionOffset: motionOffset, PHYS: PHYS };
})(window);
