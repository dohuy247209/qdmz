/*
 * Quad Maze – Built-in levels (QMLevels).
 * Toạ độ và kích thước chuẩn nguyên ô lưới (integers).
 */
(function (global) {
  'use strict';

  function S() {
    return { type: 'static', points: null, mode: 'pingpong', speed: 0, phase: 0, pivot: null };
  }
  function path(pts, speed, phase, mode) {
    return { type: 'path', points: pts, mode: mode || 'pingpong', speed: speed || 4, phase: phase || 0, pivot: null };
  }
  function spin(speed, phase, pivot) {
    return { type: 'spin', points: null, mode: 'pingpong', speed: speed || 90, phase: phase || 0, pivot: pivot || null };
  }

  var levels = [
    // ================= LEVEL 1: TEST GROUND =================
    {
      format: 'quadmaze-level',
      version: 2,
      name: 'Test Ground',
      box: { w: 200, h: 120 },
      spawn: { x: 3,   y: 112 },
      goal:  { x: 193, y: 112 },
      checkpoints: [
        { x: 55,  y: 84 },
        { x: 105, y: 60 },
        { x: 155, y: 84 }
      ],
      paths: [],
      walls: [
        { x: 0,   y: 116, w: 200, h: 4, rot: 0, motion: S(), attach: null },
        { x: 18,  y: 106, w: 16, h: 3, rot: 0, motion: S(), attach: null },
        { x: 34,  y: 96,  w: 16, h: 3, rot: 0, motion: S(), attach: null },
        { x: 50,  y: 88,  w: 20, h: 3, rot: -10, motion: S(), attach: null },
        { x: 60,  y: 90,  w: 18, h: 3, rot: 0, motion: path([[69, 92], [100, 92]], 12, 0), attach: null },
        { x: 78,  y: 70,  w: 16, h: 3, rot: 0, motion: path([[86, 72], [86, 88]], 10, 0.5), attach: null },
        { x: 96,  y: 62,  w: 20, h: 3, rot: 12, motion: S(), attach: null },
        { x: 97,  y: 52,  w: 22, h: 3, rot: 0, motion: spin(40, 0, null), attach: null },
        { x: 100, y: 44,  w: 14, h: 3, rot: 0, motion: S(), attach: null },
        { x: 118, y: 96,  w: 14, h: 3, rot: 0, motion: S(), attach: null },
        { x: 133, y: 88,  w: 14, h: 3, rot: 0, motion: S(), attach: null },
        { x: 144, y: 78,  w: 20, h: 3, rot: 0, motion: S(), attach: null },
        { x: 148, y: 62,  w: 16, h: 3, rot: 0, motion: path([[156, 64], [170, 64]], 8, 0.3), attach: null },
        { x: 164, y: 72,  w: 16, h: 3, rot: 0, motion: S(), attach: null },
        { x: 172, y: 84,  w: 16, h: 3, rot: 0, motion: S(), attach: null },
        { x: 178, y: 96,  w: 16, h: 3, rot: 0, motion: S(), attach: null },
        { x: 180, y: 80,  w: 3,  h: 40, rot: 0, motion: S(), attach: null },
        { x: 182, y: 106, w: 14, h: 3, rot: 0, motion: spin(35, 0, [183, 108]), attach: null }
      ],
      saws: [
        { x: 24,  y: 111, size: 4, spin: 90,  motion: path([[26, 113], [45, 113]], 10, 0), attach: null },
        { x: 65,  y: 100, size: 3, spin: -120, motion: path([[67, 102], [78, 102]], 8, 0.4), attach: null },
        { x: 99,  y: 56,  size: 3, spin: 180, motion: path([[100, 57], [117, 57]], 14, 0), attach: null },
        { x: 149, y: 68,  size: 3, spin: -90, motion: path([[151, 70], [151, 91]], 12, 0.6), attach: null },
        { x: 188, y: 108, size: 4, spin: 150, motion: S(), attach: null }
      ]
    },

    // ================= LEVEL 2: TOWER RUSH =================
    {
      format: 'quadmaze-level',
      version: 2,
      name: 'Tower Rush',
      box: { w: 200, h: 120 },
      spawn: { x: 3,   y: 112 },
      goal:  { x: 180, y: 4   },
      checkpoints: [
        { x: 50,  y: 80 },
        { x: 120, y: 44 },
        { x: 170, y: 16 }
      ],
      paths: [],
      walls: [
        { x: 0,   y: 116, w: 200, h: 4, rot: 0, motion: S(), attach: null },
        { x: 0,   y: 0,   w: 200, h: 3, rot: 0, motion: S(), attach: null },
        { x: 20,  y: 104, w: 20, h: 3, rot: 0, motion: S(), attach: null },
        { x: 46,  y: 96,  w: 22, h: 3, rot: 0, motion: path([[57, 98], [80, 98]], 14, 0), attach: null },
        { x: 80,  y: 90,  w: 20, h: 3, rot: 0, motion: S(), attach: null },
        { x: 30,  y: 80,  w: 18, h: 3, rot: 0, motion: S(), attach: null },
        { x: 50,  y: 72,  w: 22, h: 4, rot: 0, motion: spin(45, 0, [61, 74]), attach: null },
        { x: 82,  y: 70,  w: 20, h: 3, rot: -8, motion: S(), attach: null },
        { x: 108, y: 60,  w: 20, h: 3, rot: 0, motion: path([[118, 62], [140, 62]], 16, 0.5), attach: null },
        { x: 40,  y: 52,  w: 18, h: 3, rot: 0, motion: S(), attach: null },
        { x: 64,  y: 44,  w: 24, h: 3, rot: 0, motion: path([[76, 46], [110, 46]], 18, 0), attach: null },
        { x: 118, y: 42,  w: 18, h: 3, rot: 8, motion: S(), attach: null },
        { x: 138, y: 36,  w: 20, h: 3, rot: 0, motion: spin(55, 0, null), attach: null },
        { x: 60,  y: 28,  w: 18, h: 3, rot: 0, motion: S(), attach: null },
        { x: 88,  y: 20,  w: 18, h: 3, rot: 0, motion: S(), attach: null },
        { x: 110, y: 14,  w: 22, h: 3, rot: 0, motion: path([[121, 16], [155, 16]], 20, 0), attach: null },
        { x: 160, y: 8,   w: 36, h: 3, rot: 0, motion: S(), attach: null }
      ],
      saws: [
        { x: 84,  y: 111, size: 4, spin: 90,  motion: path([[86, 113], [110, 113]], 12, 0), attach: null },
        { x: 31,  y: 74,  size: 3, spin: -120, motion: S(), attach: null },
        { x: 106, y: 84,  size: 4, spin: 100, motion: path([[108, 86], [140, 86]], 14, 0.6), attach: null },
        { x: 42,  y: 44,  size: 3, spin: -90, motion: path([[44, 46], [58, 46]], 10, 0), attach: null },
        { x: 120, y: 28,  size: 4, spin: 160, motion: path([[122, 30], [148, 30]], 16, 0.4), attach: null },
        { x: 64,  y: 12,  size: 3, spin: 200, motion: path([[66, 14], [84, 14]], 18, 0.2), attach: null },
        { x: 173, y: 0,   size: 5, spin: 120, motion: S(), attach: null }
      ]
    },

    // ================= LEVEL 3: SPINNING CAVERNS =================
    {
      format: 'quadmaze-level',
      version: 2,
      name: 'Spinning Caverns',
      box: { w: 160, h: 100 },
      spawn: { x: 4,   y: 92 },
      goal:  { x: 152, y: 92 },
      checkpoints: [
        { x: 50,  y: 70 },
        { x: 100, y: 50 }
      ],
      paths: [],
      walls: [
        { x: 0,   y: 96,  w: 160, h: 4, rot: 0, motion: S(), attach: null },
        { x: 20,  y: 84,  w: 16,  h: 3, rot: 0, motion: S(), attach: null },
        { x: 45,  y: 74,  w: 20,  h: 3, rot: 0, motion: spin(60, 0, null), attach: null },
        { x: 75,  y: 64,  w: 22,  h: 3, rot: 0, motion: path([[86, 65], [110, 65]], 10, 0), attach: null },
        { x: 115, y: 54,  w: 20,  h: 3, rot: 0, motion: spin(-50, 0, null), attach: null },
        { x: 140, y: 70,  w: 16,  h: 3, rot: 0, motion: S(), attach: null }
      ],
      saws: [
        { x: 30,  y: 91,  size: 4, spin: 90,  motion: path([[32, 93], [60, 93]], 10, 0), attach: null },
        { x: 80,  y: 58,  size: 3, spin: -90, motion: S(), attach: null },
        { x: 130, y: 88,  size: 4, spin: 120, motion: S(), attach: null }
      ]
    },

    // ================= LEVEL 4: PATH RUNNER =================
    {
      format: 'quadmaze-level',
      version: 2,
      name: 'Path Runner',
      box: { w: 180, h: 90 },
      spawn: { x: 4,   y: 82 },
      goal:  { x: 172, y: 82 },
      checkpoints: [
        { x: 60,  y: 60 },
        { x: 120, y: 60 }
      ],
      paths: [],
      walls: [
        { x: 0,   y: 86,  w: 180, h: 4, rot: 0, motion: S(), attach: null },
        { x: 25,  y: 72,  w: 18,  h: 3, rot: 0, motion: path([[34, 73], [54, 73]], 8, 0), attach: null },
        { x: 65,  y: 64,  w: 22,  h: 3, rot: 0, motion: path([[76, 65], [100, 65]], 12, 0.5), attach: null },
        { x: 110, y: 56,  w: 20,  h: 3, rot: 0, motion: path([[120, 57], [145, 57]], 14, 0), attach: null },
        { x: 150, y: 72,  w: 24,  h: 3, rot: 0, motion: S(), attach: null }
      ],
      saws: [
        { x: 40,  y: 81,  size: 4, spin: 90,  motion: path([[42, 83], [80, 83]], 12, 0), attach: null },
        { x: 95,  y: 50,  size: 3, spin: -90, motion: path([[96, 51], [116, 51]], 8, 0.2), attach: null },
        { x: 135, y: 81,  size: 4, spin: 150, motion: S(), attach: null }
      ]
    },

    // ================= LEVEL 5: PRECISION JUMP =================
    {
      format: 'quadmaze-level',
      version: 2,
      name: 'Precision Jump',
      box: { w: 150, h: 100 },
      spawn: { x: 4,   y: 92 },
      goal:  { x: 142, y: 20 },
      checkpoints: [
        { x: 40,  y: 65 },
        { x: 90,  y: 40 }
      ],
      paths: [],
      walls: [
        { x: 0,   y: 96,  w: 150, h: 4, rot: 0, motion: S(), attach: null },
        { x: 15,  y: 85,  w: 14,  h: 3, rot: 0, motion: S(), attach: null },
        { x: 35,  y: 72,  w: 16,  h: 3, rot: 0, motion: S(), attach: null },
        { x: 60,  y: 58,  w: 18,  h: 3, rot: 0, motion: spin(40, 0, null), attach: null },
        { x: 85,  y: 46,  w: 16,  h: 3, rot: 0, motion: S(), attach: null },
        { x: 110, y: 32,  w: 16,  h: 3, rot: 0, motion: path([[118, 33], [130, 33]], 6, 0), attach: null },
        { x: 135, y: 24,  w: 14,  h: 3, rot: 0, motion: S(), attach: null }
      ],
      saws: [
        { x: 25,  y: 91,  size: 4, spin: 90,  motion: S(), attach: null },
        { x: 70,  y: 70,  size: 3, spin: -90, motion: S(), attach: null },
        { x: 120, y: 40,  size: 3, spin: 120, motion: S(), attach: null }
      ]
    },

    // ================= LEVEL 6: THE GREAT MAZE =================
    {
      format: 'quadmaze-level',
      version: 2,
      name: 'The Great Maze',
      box: { w: 200, h: 120 },
      spawn: { x: 4,   y: 112 },
      goal:  { x: 192, y: 112 },
      checkpoints: [
        { x: 60,  y: 90 },
        { x: 120, y: 70 },
        { x: 160, y: 90 }
      ],
      paths: [],
      walls: [
        { x: 0,   y: 116, w: 200, h: 4, rot: 0, motion: S(), attach: null },
        { x: 20,  y: 104, w: 18,  h: 3, rot: 0, motion: S(), attach: null },
        { x: 45,  y: 94,  w: 20,  h: 3, rot: 45, motion: S(), attach: null }, // rot = 45 cho test roundtrip
        { x: 70,  y: 84,  w: 22,  h: 3, rot: 0, motion: spin(50, 0, null), attach: null },
        { x: 100, y: 76,  w: 20,  h: 3, rot: -20, motion: S(), attach: null },
        { x: 130, y: 88,  w: 24,  h: 3, rot: 0, motion: path([[142, 89], [165, 89]], 10, 0), attach: null },
        { x: 170, y: 102, w: 22,  h: 3, rot: 0, motion: S(), attach: null }
      ],
      saws: [
        { x: 30,  y: 111, size: 4, spin: 90,  motion: path([[32, 113], [60, 113]], 10, 0), attach: null },
        { x: 80,  y: 90,  size: 3, spin: -90, motion: S(), attach: null },
        { x: 140, y: 72,  size: 4, spin: 100, motion: S(), attach: null },
        { x: 185, y: 111, size: 4, spin: 120, motion: S(), attach: null }
      ]
    }
  ];

  global.QMLevels = {
    list: levels,
    raw: levels
  };
})(window);
