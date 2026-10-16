/*
 * Test chạy bằng Node (không cần browser): validate format parser,
 * built-in levels, roundtrip, và SAT collision của game engine.
 * Chạy: node test\run-tests.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

// Shim browser globals.
const sandbox = {
  window: null,
  console: console,
  performance: { now: () => Date.now() },
  requestAnimationFrame: () => 0,
  cancelAnimationFrame: () => {},
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => true,
  setTimeout: setTimeout,
  clearTimeout: clearTimeout,
  Math: Math,
  JSON: JSON,
  isFinite: isFinite,
  parseFloat: parseFloat,
  parseInt: parseInt,
  isNaN: isNaN,
  Array: Array,
  Object: Object,
  String: String,
  Number: Number,
  Infinity: Infinity,
  Error: Error,
  Date: Date
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

function load(file) {
  const code = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  vm.runInContext(code, sandbox, { filename: file });
}

let passed = 0, failed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log('  OK  ' + name);
  } catch (e) {
    failed++;
    console.log('FAIL  ' + name + ' -> ' + e.message);
  }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
function approx(a, b, eps) { return Math.abs(a - b) <= (eps || 1e-6); }

// Load đúng thứ tự như index.html.
load('js/render.js');
load('js/motion.js');
load('js/format.js');
load('js/levels.js');
load('js/game.js');

const QMFormat = sandbox.QMFormat;
const QMLevels = sandbox.QMLevels;

console.log('--- Format parser ---');

test('parse JSON hợp lệ', () => {
  const res = QMFormat.parse(JSON.stringify({
    name: 'T', box: { w: 20, h: 10 },
    spawn: { x: 1, y: 8 }, goal: { x: 18, y: 8 },
    walls: [{ x: 0, y: 9, w: 20, h: 1 }]
  }));
  assert(res.ok, 'expected ok: ' + res.errors.join(';'));
  assert(res.level.walls.length === 1);
  assert(res.level.box.w === 20);
});

test('parse JSON rác -> lỗi', () => {
  const res = QMFormat.parse('{not json');
  assert(!res.ok, 'expected failure');
  assert(res.errors.length > 0);
});

test('thiếu walls -> cảnh báo nhưng vẫn parse', () => {
  const res = QMFormat.parse(JSON.stringify({ spawn: { x: 0, y: 0 }, goal: { x: 1, y: 1 } }));
  assert(res.ok, 'should still parse');
  assert(res.errors.some(e => /wall/i.test(e)), 'expected wall warning');
});

test('motion type sai -> fallback static + cảnh báo', () => {
  const res = QMFormat.parse(JSON.stringify({
    walls: [{ x: 0, y: 0, w: 5, h: 1, motion: { type: 'flying', distance: 3 } }]
  }));
  assert(res.ok);
  assert(res.level.walls[0].motion.type === 'static');
  assert(res.errors.length > 0);
});

test('saw spin=0 -> forced 90 + cảnh báo', () => {
  const res = QMFormat.parse(JSON.stringify({
    walls: [{ x: 0, y: 9, w: 5, h: 1 }],
    saws: [{ x: 2, y: 2, size: 1, spin: 0 }]
  }));
  assert(res.level.saws[0].spin === 90);
  assert(res.errors.some(e => /spin/.test(e)));
});

test('roundtrip stringify -> parse giữ dữ liệu', () => {
  const lv = QMLevels.list[5]; // level 6-5 có wall rot
  const back = QMFormat.parse(QMFormat.stringify(lv));
  assert(back.ok);
  assert(back.level.name === lv.name);
  assert(back.level.walls.length === lv.walls.length);
  assert(back.level.saws.length === lv.saws.length);
  assert(back.level.checkpoints.length === lv.checkpoints.length);
  const a = lv.walls.find(w => w.rot), b = back.level.walls.find(w => w.rot);
  assert(a && b && approx(a.rot, b.rot), 'rot preserved');
});

test('parseAny nhận pack nhiều level', () => {
  const pack = QMFormat.stringifyPack(QMLevels.list.slice(0, 3), 'P');
  const res = QMFormat.parseAny(pack);
  assert(res.ok && res.levels.length === 3, 'expected 3 levels');
});

test('parseAny nhận level đơn', () => {
  const res = QMFormat.parseAny(QMFormat.stringify(QMLevels.list[0]));
  assert(res.ok && res.levels.length === 1);
});

console.log('--- Built-in levels ---');

test('có ít nhất 6 level', () => {
  assert(QMLevels.list.length >= 6, 'got ' + QMLevels.list.length);
});

test('mọi level parse sạch (0 lỗi)', () => {
  QMLevels.raw.forEach((lv, i) => {
    const res = QMFormat.parse(JSON.stringify(lv));
    assert(res.ok, 'level ' + i + ' failed');
    assert(res.errors.length === 0, 'level ' + i + ' warnings: ' + res.errors.join(';'));
  });
});

test('spawn/goal nằm trong box, không chồng wall', () => {
  QMLevels.list.forEach((lv, i) => {
    const inBox = (p) => p.x >= 0 && p.y >= 0 && p.x + 1 <= lv.box.w && p.y + 1 <= lv.box.h;
    assert(inBox(lv.spawn), 'level ' + i + ' spawn out of box');
    assert(inBox(lv.goal), 'level ' + i + ' goal out of box');
    // Không được chồng wall (cho phép 0 margin vì spawn đặt trên tường đằng sau).
    const p = lv.spawn;
    lv.walls.forEach((w, j) => {
      if (w.rot) return; // bỏ qua wall xoay trong test đơn giản
      const hit = p.x < w.x + w.w && p.x + 1 > w.x && p.y < w.y + w.h && p.y + 1 > w.y;
      assert(!hit, 'level ' + i + ' spawn overlaps wall ' + j);
    });
  });
});

// __APPEND__

console.log('--- Physics / SAT / gameplay ---');

// Canvas giả để tạo Game trong Node.
function fakeCanvas() {
  const noop = function () {};
  const ctx = new Proxy({}, {
    get: (t, k) => (k === 'canvas' ? fake : (t[k] !== undefined ? t[k] : noop)),
    set: (t, k, v) => { t[k] = v; return true; }
  });
  const fake = {
    width: 800, height: 600, clientWidth: 800, clientHeight: 600,
    getContext: () => ctx,
    addEventListener: noop,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 })
  };
  return fake;
}

const QuadGame = sandbox.QuadGame;
const QMPhysics = sandbox.QMPhysics;

test('motionOffset: static = 0', () => {
  const o = QMPhysics.motionOffset({ type: 'static', distance: 5, speed: 1, phase: 0 }, 1.5);
  assert(o.x === 0 && o.y === 0);
});

test('motionOffset: horizontal dao động trong [-d, d]', () => {
  const m = { type: 'horizontal', distance: 4, speed: 0.5, phase: 0 };
  for (let t = 0; t < 4; t += 0.1) {
    const o = QMPhysics.motionOffset(m, t);
    assert(o.y === 0, 'y must be 0');
    assert(o.x >= -4.0001 && o.x <= 4.0001, 'x out of range: ' + o.x);
  }
});

test('motionOffset: circle bán kính = distance', () => {
  const m = { type: 'circle', distance: 3, speed: 0.25, phase: 0 };
  for (let t = 0; t < 4; t += 0.2) {
    const o = QMPhysics.motionOffset(m, t);
    assert(approx(Math.hypot(o.x, o.y), 3, 1e-6), 'radius drift');
  }
});

function makeGame(levelJson) {
  const g = new QuadGame(fakeCanvas(), {});
  g.load(sandbox.QMFormat.parse(JSON.stringify(levelJson)).level);
  return g;
}

test('player rơi và đứng trên sàn (grounded)', () => {
  const g = makeGame({
    name: 'flat', box: { w: 20, h: 12 },
    spawn: { x: 5, y: 2 }, goal: { x: 18, y: 10 },
    walls: [{ x: 0, y: 11, w: 20, h: 1 }]
  });
  for (let i = 0; i < 600; i++) g._step(1 / 120); // 5 giây
  assert(g.player.grounded, 'not grounded');
  assert(approx(g.player.y, 10, 1e-6), 'y=' + g.player.y + ' expected 10');
  assert(g.player.vy === 0, 'vy should be 0 on ground, got ' + g.player.vy);
});

test('không rơi xuyên sàn (0.5 ô)', () => {
  const g = makeGame({
    name: 'thin', box: { w: 20, h: 12 },
    spawn: { x: 5, y: 0 }, goal: { x: 18, y: 9 },
    walls: [{ x: 0, y: 10, w: 20, h: 0.5 }]
  });
  for (let i = 0; i < 1200; i++) g._step(1 / 120);
  assert(g.player.y + g.player.h <= 10.0001, 'fell through: y=' + g.player.y);
});

test('nhảy được khi grounded, độ cao ~3.7 ô', () => {
  const g = makeGame({
    name: 'jump', box: { w: 20, h: 16 },
    spawn: { x: 5, y: 14 }, goal: { x: 18, y: 14 },
    walls: [{ x: 0, y: 15, w: 20, h: 1 }]
  });
  for (let i = 0; i < 600; i++) g._step(1 / 120);
  assert(g.player.grounded);
  const groundY = g.player.y;
  g.jump();
  let minY = groundY;
  for (let i = 0; i < 600; i++) {
    g._step(1 / 120);
    minY = Math.min(minY, g.player.y);
  }
  const height = groundY - minY;
  assert(height > 3 && height < 4.5, 'jump height=' + height.toFixed(2));
});

test('KHÔNG nhảy được ở giữa không trung (cách tường > 0.5 ô)', () => {
  const g = makeGame({
    name: 'air', box: { w: 30, h: 16 },
    spawn: { x: 5, y: 14 }, goal: { x: 28, y: 14 },
    walls: [
      { x: 0, y: 15, w: 30, h: 1 },
      { x: 24, y: 0, w: 1, h: 15 } // tường xa bên phải
    ]
  });
  for (let i = 0; i < 600; i++) g._step(1 / 120);
  assert(g.player.grounded);
  g.jump(); // nhảy lên từ sàn
  for (let i = 0; i < 42; i++) g._step(1 / 120); // 0.35s – đang lên cao
  assert(!g.player.grounded, 'should be airborne');
  assert(!g._canJump(g.player), 'must NOT be able to jump mid-air far from walls');
  const vyBefore = g.player.vy;
  g.jump();
  g._step(1 / 120);
  // Jump không có tác dụng: vy chỉ bị gravity đẩy tiếp (hoặc vẫn là -21 nếu ngay frame trước... nên so sánh kỹ).
  assert(g.player.vy > -21 + 0.5, 'jump must be ignored mid-air, vy=' + g.player.vy);
  assert(g.player.vy !== -21 || vyBefore === -21, 'unexpected jump');
});

test('multijump: nhảy được khi dính tường bên', () => {
  const g = makeGame({
    name: 'walljump', box: { w: 30, h: 16 },
    spawn: { x: 5, y: 14 }, goal: { x: 28, y: 14 },
    walls: [
      { x: 0, y: 15, w: 30, h: 1 },
      { x: 12, y: 0, w: 1, h: 15 } // tường dọc
    ]
  });
  for (let i = 0; i < 600; i++) g._step(1 / 120);
  g.input.right = true;
  for (let i = 0; i < 600 && g.player.x + g.player.w < 12 - 0.01; i++) g._step(1 / 120);
  g.input.right = false;
  assert(g.player.x + g.player.w >= 11.9, 'should touch wall, x=' + g.player.x);
  assert(g._canJump(g.player), 'can jump next to wall');
  // Nhảy nhiều lần liên tiếp khi còn dính tường.
  for (let k = 0; k < 3; k++) {
    g.jump();
    g._step(1 / 120);
    // Frame đầu: vy = -jumpV + gravity*dt (gravity áp dụng ngay trong cùng step).
    const expected = -QMPhysics.PHYS.jumpV + QMPhysics.PHYS.gravity / 120;
    assert(approx(g.player.vy, expected, 1e-9),
      'jump #' + k + ' impulse, vy=' + g.player.vy + ' expected ' + expected);
    assert(g.player.vy < -20, 'must be strong upward, vy=' + g.player.vy);
    for (let i = 0; i < 30; i++) g._step(1 / 120); // trôi 0.25s nhưng vẫn gần tường
    // Đẩy lại về tường.
    g.input.right = true;
    for (let i = 0; i < 15; i++) g._step(1 / 120);
    g.input.right = false;
  }
});

test('saw trúng -> chết -> respawn tại spawn', () => {
  const g = makeGame({
    name: 'sawtest', box: { w: 20, h: 12 },
    spawn: { x: 2, y: 10 }, goal: { x: 18, y: 10 },
    walls: [{ x: 0, y: 11, w: 20, h: 1 }],
    saws: [{ x: 6, y: 9.5, size: 2, spin: 90 }]
  });
  g.input.right = true;
  let died = false;
  for (let i = 0; i < 1200 && !died; i++) {
    g._step(1 / 120);
    if (g.player.dead) died = true;
  }
  assert(died, 'should die on saw');
  g.input.right = false; // ngừng di chuyển trước khi respawn để check chính xác
  for (let i = 0; i < 60; i++) g._step(1 / 120); // chờ respawn
  assert(!g.player.dead, 'should respawn');
  assert(approx(g.player.x, 2, 1e-9) && approx(g.player.y, 10, 1e-9),
    'respawn at spawn, got ' + g.player.x + ',' + g.player.y);
});

test('checkpoint: chết -> respawn tại checkpoint đã chạm', () => {
  const g = makeGame({
    name: 'cp', box: { w: 30, h: 12 },
    spawn: { x: 2, y: 10 }, goal: { x: 28, y: 10 },
    checkpoints: [{ x: 10, y: 10 }],
    walls: [{ x: 0, y: 11, w: 30, h: 1 }],
    saws: [{ x: 20, y: 9.5, size: 2, spin: 90 }]
  });
  g.input.right = true;
  for (let i = 0; i < 1800 && g.activeCheckpoint < 0; i++) g._step(1 / 120);
  assert(g.activeCheckpoint === 0, 'checkpoint activated, idx=' + g.activeCheckpoint);
  let died = false;
  for (let i = 0; i < 1800 && !died; i++) { g._step(1 / 120); if (g.player.dead) died = true; }
  assert(died, 'die at saw');
  g.input.right = false;
  for (let i = 0; i < 60; i++) g._step(1 / 120);
  assert(approx(g.player.x, 10, 1e-9),
    'respawn at checkpoint x=' + g.player.x);
});

test('goal -> state=won', () => {
  const g = makeGame({
    name: 'goal', box: { w: 12, h: 8 },
    spawn: { x: 1, y: 6 }, goal: { x: 9, y: 6 },
    walls: [{ x: 0, y: 7, w: 12, h: 1 }]
  });
  g.input.right = true;
  let won = false;
  for (let i = 0; i < 1800 && !won; i++) { g._step(1 / 120); if (g.state === 'won') won = true; }
  assert(won, 'should win');
});

test('SAT: wall xoay 45° chặn player, không xuyên', () => {
  const g = makeGame({
    name: 'rot', box: { w: 20, h: 20 },
    spawn: { x: 2, y: 16 }, goal: { x: 18, y: 2 },
    walls: [
      { x: 0, y: 18, w: 20, h: 1 },
      { x: 4, y: 6, w: 12, h: 1, rot: 45 }
    ]
  });
  g.input.right = true;
  for (let i = 0; i < 2400; i++) {
    g._step(1 / 120);
    const w = g.level.walls[1];
    const cx = w.x + w.w / 2, cy = w.y + w.h / 2;
    const dx = (g.player.x + 0.5) - cx, dy = (g.player.y + 0.5) - cy;
    const a = -Math.PI / 4;
    const lx = dx * Math.cos(a) - dy * Math.sin(a);
    const ly = dx * Math.sin(a) + dy * Math.cos(a);
    // Tâm player không bao giờ vào sâu trong OBB quá mức cho phép (half player = 0.5).
    const deep = Math.abs(lx) < w.w / 2 + 0.5 - 0.15 && Math.abs(ly) < w.h / 2 + 0.5 - 0.15;
    assert(!deep, 'tunnel through rotated wall at i=' + i);
  }
});

test('tất cả level built-in: không crash khi simulate 10s', () => {
  QMLevels.list.forEach((lv, idx) => {
    const g = new QuadGame(fakeCanvas(), {});
    g.load(lv);
    g.input.right = true;
    for (let i = 0; i < 1200; i++) {
      if (i % 60 === 0) g.jump();
      g._step(1 / 120);
      // Rơi ra ngoài box = fail.
      const p = g.player;
      if (p.y > lv.box.h + 5 || p.y < -5 || p.x < -5 || p.x > lv.box.w + 5) {
        throw new Error('level ' + idx + ' escaped box: ' + p.x + ',' + p.y);
      }
      if (!isFinite(p.x) || !isFinite(p.y)) throw new Error('level ' + idx + ' NaN position');
    }
  });
});

console.log('');
console.log(passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);



