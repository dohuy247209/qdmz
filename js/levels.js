/*
 * Quad Maze – Built-in levels (QMLevels).
 * Sandbox: 200x120 o (compact, nhieu thanh phan test hon).
 * Khong co invulnerable – co che vat ly chuan (gravity tu do + double jump).
 */
(function (global) {
  'use strict';

  // Helper tao static motion
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

    // ======================================================
    // LEVEL 1 – "TEST GROUND"
    // Sandbox 200x120; nhiều loại platform, saw di chuyển, wall spin.
    // Spawn trai, goal phai; 3 checkpoint doc duong.
    // ======================================================
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
      walls: [
        // ---- San chinh ----
        { x: 0,   y: 116, w: 200, h: 4, rot: 0, motion: S(), attach: null },

        // ---- Khu 1: bat dau (x 0..55) ----
        // Bac thang len trai
        { x: 18,  y: 106, w: 16, h: 3, rot: 0, motion: S(), attach: null },
        { x: 34,  y: 96,  w: 16, h: 3, rot: 0, motion: S(), attach: null },
        // Platform nghieng
        { x: 50,  y: 88,  w: 20, h: 3, rot: -10, motion: S(), attach: null },

        // ---- Khu 2: platform di chuyen (x 55..105) ----
        // Platform ngang pingpong
        {
          x: 60, y: 90, w: 18, h: 3, rot: 0,
          motion: path([[69, 92], [100, 92]], 12, 0),
          attach: null
        },
        // Platform doc di chuyen
        {
          x: 78, y: 70, w: 16, h: 3, rot: 0,
          motion: path([[86, 72], [86, 88]], 10, 0.5),
          attach: null
        },
        // Wall nghieng co dinh
        { x: 96,  y: 62, w: 20, h: 3, rot: 12, motion: S(), attach: null },

        // ---- Khu 3: spin + gap (x 85..115) ----
        // Trụ spin quanh tam
        {
          x: 97, y: 52, w: 22, h: 3, rot: 0,
          motion: spin(40, 0, null),
          attach: null
        },
        // Platform gop lai phia tren
        { x: 100, y: 44, w: 14, h: 3, rot: 0, motion: S(), attach: null },

        // ---- Khu 4: "loi di hep" (x 115..155) ----
        // Trang thai binh thuong
        { x: 118, y: 96, w: 14, h: 3, rot: 0, motion: S(), attach: null },
        { x: 133, y: 88, w: 14, h: 3, rot: 0, motion: S(), attach: null },
        // Platform rong co saw tren do
        { x: 144, y: 78, w: 20, h: 3, rot: 0, motion: S(), attach: null },
        // Platform doi chieu
        {
          x: 148, y: 62, w: 16, h: 3, rot: 0,
          motion: path([[156, 64], [170, 64]], 8, 0.3),
          attach: null
        },

        // ---- Khu 5: cuoi (x 155..200) ----
        // Bac thang xuong
        { x: 164, y: 72,  w: 16, h: 3, rot: 0,  motion: S(), attach: null },
        { x: 172, y: 84,  w: 16, h: 3, rot: 0,  motion: S(), attach: null },
        { x: 178, y: 96,  w: 16, h: 3, rot: 0,  motion: S(), attach: null },
        // Tuong cuoi (tru dung)
        { x: 180, y: 80,  w: 3,  h: 40, rot: 0, motion: S(), attach: null },
        // Wall spin bao ve goal
        {
          x: 182, y: 106, w: 14, h: 3, rot: 0,
          motion: spin(35, 0, [183, 108]),
          attach: null
        }
      ],
      saws: [
        // Khu 1: saw tren san
        {
          x: 24, y: 111, size: 3.5, spin: 90,
          motion: path([[25.75, 112.75], [45, 112.75]], 10, 0),
          attach: null
        },
        // Khu 2: saw treo giua khong
        {
          x: 65, y: 100, size: 3, spin: -120,
          motion: path([[66.5, 101.5], [78, 101.5]], 8, 0.4),
          attach: null
        },
        // Khu 3: saw gan spin wall (attach wall index 7 = spin trụ)
        {
          x: 99, y: 56, size: 2.5, spin: 180,
          motion: path([[100.25, 57.25], [117, 57.25]], 14, 0),
          attach: null
        },
        // Khu 4: saw doc
        {
          x: 149, y: 68, size: 3, spin: -90,
          motion: path([[150.5, 69.5], [150.5, 91]], 12, 0.6),
          attach: null
        },
        // Khu 5: saw bao ve goal
        {
          x: 188, y: 108, size: 4, spin: 150,
          motion: S(),
          attach: null
        }
      ]
    },

    // ======================================================
    // LEVEL 2 – "TOWER RUSH"
    // Sandbox 200x120; leo doc tu duoi len goal o dinh.
    // Nhieu spin wall + saw gan platform.
    // ======================================================
    {
      format: 'quadmaze-level',
      version: 2,
      name: 'Tower Rush',
      box: { w: 200, h: 120 },
      spawn: { x: 3,   y: 112 },
      goal:  { x: 180, y: 4   },
      checkpoints: [
        { x: 50, y: 80 },
        { x: 120, y: 44 },
        { x: 170, y: 16 }
      ],
      walls: [
        // San
        { x: 0,   y: 116, w: 200, h: 4, rot: 0, motion: S(), attach: null },
        // Tran
        { x: 0,   y: 0,   w: 200, h: 3, rot: 0, motion: S(), attach: null },

        // Tang 1 (day)
        { x: 20,  y: 104, w: 20, h: 3, rot: 0,  motion: S(), attach: null },
        {
          x: 46,  y: 96,  w: 22, h: 3, rot: 0,
          motion: path([[57, 98], [80, 98]], 14, 0),
          attach: null
        },
        { x: 80,  y: 90,  w: 20, h: 3, rot: 0,  motion: S(), attach: null },

        // Tang 2
        { x: 30,  y: 80,  w: 18, h: 3, rot: 0,  motion: S(), attach: null },
        {
          x: 50,  y: 72,  w: 22, h: 4, rot: 0,
          motion: spin(45, 0, [61, 74]),
          attach: null
        },
        { x: 82,  y: 70,  w: 20, h: 3, rot: -8, motion: S(), attach: null },
        {
          x: 108, y: 60,  w: 20, h: 3, rot: 0,
          motion: path([[118, 62], [140, 62]], 16, 0.5),
          attach: null
        },

        // Tang 3
        { x: 40,  y: 52,  w: 18, h: 3, rot: 0,  motion: S(), attach: null },
        {
          x: 64,  y: 44,  w: 24, h: 3, rot: 0,
          motion: path([[76, 46], [110, 46]], 18, 0),
          attach: null
        },
        { x: 118, y: 42,  w: 18, h: 3, rot: 8,  motion: S(), attach: null },
        {
          x: 138, y: 36,  w: 20, h: 3, rot: 0,
          motion: spin(55, 0, null),
          attach: null
        },

        // Tang 4
        { x: 60,  y: 28,  w: 18, h: 3, rot: 0,  motion: S(), attach: null },
        { x: 88,  y: 20,  w: 18, h: 3, rot: 0,  motion: S(), attach: null },
        {
          x: 110, y: 14,  w: 22, h: 3, rot: 0,
          motion: path([[121, 16], [155, 16]], 20, 0),
          attach: null
        },

        // Platform goal
        { x: 160, y: 8,   w: 36, h: 3, rot: 0,  motion: S(), attach: null }
      ],
      saws: [
        // Tang 1
        {
          x: 84, y: 111, size: 4, spin: 90,
          motion: path([[86, 113], [110, 113]], 12, 0),
          attach: null
        },
        // Tang 2
        {
          x: 31, y: 74, size: 3, spin: -120,
          motion: S(),
          attach: null
        },
        {
          x: 106, y: 84, size: 3.5, spin: 100,
          motion: path([[107.75, 85.75], [140, 85.75]], 14, 0.6),
          attach: null
        },
        // Tang 3
        {
          x: 42, y: 44, size: 3, spin: -90,
          motion: path([[43.5, 45.5], [58, 45.5]], 10, 0),
          attach: null
        },
        {
          x: 120, y: 28, size: 3.5, spin: 160,
          motion: path([[121.75, 29.75], [148, 29.75]], 16, 0.4),
          attach: null
        },
        // Tang 4
        {
          x: 64, y: 12, size: 3, spin: 200,
          motion: path([[65.5, 13.5], [84, 13.5]], 18, 0.2),
          attach: null
        },
        // Bao ve goal
        {
          x: 173, y: 0, size: 5, spin: 120,
          motion: S(),
          attach: null
        }
      ]
    }
  ];

  global.QMLevels = { list: levels };
})(window);
