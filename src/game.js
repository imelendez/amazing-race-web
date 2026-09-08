/* The Amazing Race — 2D browser port.
 * Original: a 2016 Panda3D college project (third-person 3D maze shooter).
 * The maze, spawn points, enemy patrol axes, orb colors, timer and win
 * conditions are all lifted from the original source; see README.md for the
 * handful of places where 2D needed different numbers than 3D did.
 */
(function () {
  "use strict";

  const M = window.MAZE;
  const { CELL, GW, GH, ORIGIN_X, TOP_Y } = M;
  const GRID = M.decodeGrid();
  const WORLD_W = GW * CELL;
  const WORLD_H = GH * CELL;

  // ---------------------------------------------------------------- tuning
  const T = {
    playerR: 3.2,
    playerSpeed: 58,          // original ralphSpeed was 60
    turnRate: 3.3,            // rad/s for the original's arrow-key turning
    shotSpeed: 120,           // 3D used 25 u/s; unplayably slow top-down
    shotR: 1.0,
    shotLife: 2.4,
    fireCooldown: 0.17,

    enemyR: 3.6,
    enemyHP: 5,               // original was 7 hits; 5 paces better with mouse aim
    enemySpeed: 7,            // straight from the original
    enemyPatrol: 5,           // ±5 units on a fixed axis — from the original
    enemyShotSpeed: 62,
    enemyShotR: 1.4,
    enemyFireCd: 1.15,
    enemySightRange: 155,
    enemyDamage: 5,           // -5 HP per hit, from the original

    orbR: 5,
    donutR: 5,
    donutHeal: 15,            // from the original
    portalR: 9,

    startHP: 100,
    timeLimit: 240,           // 4:00, from the original
    needOrbs: 3,
    needKills: 4
  };

  const ENEMY_COLOR = { cheken: "#ffe08a", chris: "#8fdc72", fetus: "#ff9ec4", rose: "#d98cff" };
  const ORB_COLOR   = { red: "#ff4d5e", white: "#eaf4ff", yellow: "#ffd24d", blue: "#4db8ff" };

  // ------------------------------------------------------------------ grid
  const gi = (x) => Math.floor((x - ORIGIN_X) / CELL);
  const gj = (y) => Math.floor((TOP_Y - y) / CELL);
  const isWallCell = (i, j) => (i < 0 || i >= GW || j < 0 || j >= GH) ? true : !!GRID[j * GW + i];

  function hitsWall(x, y, r) {
    const i0 = gi(x - r), i1 = gi(x + r);
    const j0 = gj(y + r), j1 = gj(y - r);
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        if (i < 0 || i >= GW || j < 0 || j >= GH) return true;
        if (!GRID[j * GW + i]) continue;
        const rx0 = ORIGIN_X + i * CELL, rx1 = rx0 + CELL;
        const ry1 = TOP_Y - j * CELL, ry0 = ry1 - CELL;
        const cx = x < rx0 ? rx0 : (x > rx1 ? rx1 : x);
        const cy = y < ry0 ? ry0 : (y > ry1 ? ry1 : y);
        const dx = x - cx, dy = y - cy;
        if (dx * dx + dy * dy < r * r) return true;
      }
    }
    return false;
  }

  function slideMove(e, dx, dy, r) {
    if (dx && !hitsWall(e.x + dx, e.y, r)) e.x += dx;
    if (dy && !hitsWall(e.x, e.y + dy, r)) e.y += dy;
  }

  /** Coarse line-of-sight: sample the segment for wall cells. */
  function canSee(ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay;
    const dist = Math.hypot(dx, dy);
    const steps = Math.ceil(dist / (CELL * 0.7));
    for (let s = 1; s < steps; s++) {
      const t = s / steps;
      if (isWallCell(gi(ax + dx * t), gj(ay + dy * t))) return false;
    }
    return true;
  }

  // Precompute geometry once: horizontal runs of open floor, and the wall
  // edges that border open floor. Both get filtered by viewport each frame.
  const FLOOR_RUNS = [];
  const EDGES = [];
  (function buildGeometry() {
    for (let j = 0; j < GH; j++) {
      let run = -1;
      for (let i = 0; i <= GW; i++) {
        const open = i < GW && !GRID[j * GW + i];
        if (open && run < 0) run = i;
        if (!open && run >= 0) {
          FLOOR_RUNS.push({
            x: ORIGIN_X + run * CELL, y: TOP_Y - (j + 1) * CELL,
            w: (i - run) * CELL, h: CELL
          });
          run = -1;
        }
      }
    }
    for (let j = 0; j < GH; j++) {
      for (let i = 0; i < GW; i++) {
        if (GRID[j * GW + i]) continue;
        const x0 = ORIGIN_X + i * CELL, x1 = x0 + CELL;
        const y1 = TOP_Y - j * CELL, y0 = y1 - CELL;
        if (isWallCell(i, j - 1)) EDGES.push([x0, y1, x1, y1]);
        if (isWallCell(i, j + 1)) EDGES.push([x0, y0, x1, y0]);
        if (isWallCell(i - 1, j)) EDGES.push([x0, y0, x0, y1]);
        if (isWallCell(i + 1, j)) EDGES.push([x1, y0, x1, y1]);
      }
    }
  })();

  // ----------------------------------------------------------------- audio
  const Sound = (function () {
    let ctx = null, master = null, muted = false;
    function ensure() {
      if (ctx) return;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.5;
      master.connect(ctx.destination);
    }
    function tone(type, f0, f1, dur, gain) {
      if (muted || !ctx) return;
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = type;
      const t = ctx.currentTime;
      o.frequency.setValueAtTime(f0, t);
      if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
      g.gain.setValueAtTime(gain, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(master);
      o.start(t); o.stop(t + dur + 0.02);
    }
    function noise(dur, gain, freq) {
      if (muted || !ctx) return;
      const n = Math.floor(ctx.sampleRate * dur);
      const buf = ctx.createBuffer(1, n, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
      const src = ctx.createBufferSource(); src.buffer = buf;
      const bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = freq;
      const g = ctx.createGain(); g.gain.value = gain;
      src.connect(bp); bp.connect(g); g.connect(master);
      src.start();
    }
    return {
      unlock() { ensure(); if (ctx && ctx.state === "suspended") ctx.resume(); },
      toggle() { muted = !muted; return muted; },
      isMuted() { return muted; },
      shoot()       { tone("square", 720, 300, 0.07, 0.045); },
      enemyShoot()  { tone("sawtooth", 260, 190, 0.09, 0.022); },
      hit()         { noise(0.06, 0.13, 1400); },
      kill()        { tone("square", 300, 70, 0.3, 0.075); noise(0.2, 0.16, 700); },
      orb()         { tone("sine", 620, 1180, 0.18, 0.09); },
      donut()       { tone("sine", 380, 720, 0.16, 0.075); },
      damage()      { tone("sawtooth", 190, 70, 0.22, 0.09); },
      denied()      { tone("square", 150, 110, 0.22, 0.055); },
      win()         { [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => tone("triangle", f, f, 0.26, 0.09), i * 110)); },
      lose()        { [392, 330, 262, 196].forEach((f, i) => setTimeout(() => tone("sawtooth", f, f * 0.85, 0.34, 0.075), i * 150)); }
    };
  })();

  // ----------------------------------------------------------------- input
  const keys = Object.create(null);
  const AIM_KEYS = new Set(["w", "a", "s", "d", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]);
  const input = { mx: 0, my: 0, mouseActive: false, firing: false, aim: 0 };
  const touch = { move: null, aimStick: null };

  addEventListener("keydown", (e) => {
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    keys[k] = true;
    if (AIM_KEYS.has(k)) input.mouseActive = false;   // last input source wins
    if (k === " " || k.startsWith("Arrow")) e.preventDefault();
    if (k === "m") toggleMute();
    if (k === "Escape" && G.state === "play") endGame(false, "Abandoned.");
  });
  addEventListener("keyup", (e) => { keys[e.key.length === 1 ? e.key.toLowerCase() : e.key] = false; });
  addEventListener("blur", () => { for (const k in keys) keys[k] = false; input.firing = false; });

  // ------------------------------------------------------------------ DOM
  const cv = document.getElementById("game");
  const ctx = cv.getContext("2d");
  const mini = document.getElementById("minimap");
  const mctx = mini.getContext("2d");
  const $ = (id) => document.getElementById(id);
  const hud = $("hud"), scrTitle = $("scrTitle"), scrEnd = $("scrEnd");

  let VW = 0, VH = 0, DPR = 1, zoom = 5;
  function resize() {
    DPR = Math.min(devicePixelRatio || 1, 2);
    VW = cv.clientWidth; VH = cv.clientHeight;
    cv.width = Math.round(VW * DPR); cv.height = Math.round(VH * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    zoom = Math.max(3.0, Math.min(6.4, VH / 158));
  }
  addEventListener("resize", resize);

  // ------------------------------------------------------------------ state
  const G = {
    state: "title",
    t: 0, timeLeft: T.timeLimit,
    player: null, enemies: [], orbs: [], donuts: [],
    shots: [], eshots: [], parts: [],
    kills: 0, orbsHeld: 0,
    shake: 0, toastT: 0, hurtFlash: 0,
    portalSpin: 0
  };

  function reset() {
    G.t = 0; G.timeLeft = T.timeLimit;
    G.kills = 0; G.orbsHeld = 0;
    G.shots = []; G.eshots = []; G.parts = [];
    G.shake = 0; G.hurtFlash = 0; G.portalSpin = 0; G.portalTouch = false;
    G.player = { x: M.SPAWN.x, y: M.SPAWN.y, hp: T.startHP, cd: 0, aim: 0 };
    G.enemies = M.ENEMIES.map((e) => ({
      type: e.t, x: e.x, y: e.y, hx: e.x, hy: e.y,
      axis: e.axis === "X" ? "x" : "y", dir: 1,
      hp: T.enemyHP, alive: true, cd: Math.random() * T.enemyFireCd, flash: 0
    }));
    G.orbs = M.ORBS.map((o) => ({ x: o.x, y: o.y, c: ORB_COLOR[o.c] || "#fff", got: false }));
    G.donuts = M.DONUTS.map((d) => ({ x: d.x, y: d.y, got: false }));
    input.firing = false;
    showToast("");
  }

  // ----------------------------------------------------------------- helpers
  function spawnParts(x, y, color, n, speed) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = speed * (0.35 + Math.random() * 0.85);
      G.parts.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.45 + Math.random() * 0.4, t: 0, c: color });
    }
  }

  let toastTimer = null;
  function showToast(msg, ms) {
    const el = $("toast");
    el.innerHTML = msg || "";
    el.classList.toggle("show", !!msg);
    clearTimeout(toastTimer);
    if (msg) toastTimer = setTimeout(() => el.classList.remove("show"), ms || 2000);
  }

  // ------------------------------------------------------------------ update
  function update(dt) {
    G.t += dt;
    G.portalSpin += dt * 0.9;
    if (G.shake > 0) G.shake = Math.max(0, G.shake - dt * 26);
    if (G.hurtFlash > 0) G.hurtFlash = Math.max(0, G.hurtFlash - dt * 2.6);

    if (G.state !== "play") return;

    G.timeLeft -= dt;
    if (G.timeLeft <= 0) { G.timeLeft = 0; return endGame(false, "Time ran out."); }

    const p = G.player;

    // --- turning (the original's arrow-key tank controls)
    let turn = 0;
    if (keys.ArrowLeft)  turn += 1;
    if (keys.ArrowRight) turn -= 1;
    if (turn) p.aim += turn * T.turnRate * dt;

    // --- movement: WASD strafes, Up/Down drive along the facing like the original
    let dx = 0, dy = 0;
    if (keys.a) dx -= 1;
    if (keys.d) dx += 1;
    if (keys.w) dy += 1;
    if (keys.s) dy -= 1;
    if (keys.ArrowUp)   { dx += Math.cos(p.aim); dy += Math.sin(p.aim); }
    if (keys.ArrowDown) { dx -= Math.cos(p.aim); dy -= Math.sin(p.aim); }
    if (touch.move) { dx += touch.move.x; dy += touch.move.y; }

    const len = Math.hypot(dx, dy);
    if (len > 0) {
      dx /= len; dy /= len;
      slideMove(p, dx * T.playerSpeed * dt, dy * T.playerSpeed * dt, T.playerR);
    }

    // --- aim. Last input source wins, so a resting mouse never locks the aim.
    const tankAiming = turn || keys.ArrowUp || keys.ArrowDown;
    if (touch.aimStick) {
      p.aim = Math.atan2(touch.aimStick.y, touch.aimStick.x);
    } else if (input.mouseActive) {
      const w = screenToWorld(input.mx, input.my);
      p.aim = Math.atan2(w.y - p.y, w.x - p.x);
    } else if (len > 0 && !tankAiming) {
      p.aim = Math.atan2(dy, dx);       // WASD-only players aim where they walk
    }

    // --- firing
    p.cd -= dt;
    const wantFire = input.firing || keys[" "] || keys.Enter || !!touch.aimStick;
    if (wantFire && p.cd <= 0) {
      p.cd = T.fireCooldown;
      G.shots.push({
        x: p.x + Math.cos(p.aim) * (T.playerR + 1), y: p.y + Math.sin(p.aim) * (T.playerR + 1),
        vx: Math.cos(p.aim) * T.shotSpeed, vy: Math.sin(p.aim) * T.shotSpeed, life: T.shotLife
      });
      Sound.shoot();
    }

    // --- player shots
    for (let i = G.shots.length - 1; i >= 0; i--) {
      const s = G.shots[i];
      s.x += s.vx * dt; s.y += s.vy * dt; s.life -= dt;
      if (s.life <= 0 || hitsWall(s.x, s.y, T.shotR)) {
        if (s.life > 0) spawnParts(s.x, s.y, "#7fe9ff", 3, 22);
        G.shots.splice(i, 1);
        continue;
      }
      for (const e of G.enemies) {
        if (!e.alive) continue;
        if (Math.hypot(e.x - s.x, e.y - s.y) < T.enemyR + T.shotR) {
          e.hp--; e.flash = 0.14;
          spawnParts(s.x, s.y, ENEMY_COLOR[e.type], 5, 26);
          G.shots.splice(i, 1);
          if (e.hp <= 0) {
            e.alive = false; G.kills++;
            spawnParts(e.x, e.y, ENEMY_COLOR[e.type], 22, 46);
            Sound.kill();
            if (G.kills === T.needKills) showToast("Kill quota met.", 1600);
          } else Sound.hit();
          break;
        }
      }
    }

    // --- enemies
    for (const e of G.enemies) {
      if (!e.alive) continue;
      if (e.flash > 0) e.flash -= dt;

      const home = e.axis === "x" ? e.hx : e.hy;
      const cur = e.axis === "x" ? e.x : e.y;
      if (cur - home > T.enemyPatrol) e.dir = -1;
      else if (cur - home < -T.enemyPatrol) e.dir = 1;

      const step = e.dir * T.enemySpeed * dt;
      const nx = e.axis === "x" ? e.x + step : e.x;
      const ny = e.axis === "y" ? e.y + step : e.y;
      if (hitsWall(nx, ny, T.enemyR)) e.dir *= -1;
      else { e.x = nx; e.y = ny; }

      e.cd -= dt;
      const d = Math.hypot(p.x - e.x, p.y - e.y);
      if (e.cd <= 0 && d < T.enemySightRange && canSee(e.x, e.y, p.x, p.y)) {
        e.cd = T.enemyFireCd;
        const a = Math.atan2(p.y - e.y, p.x - e.x);
        G.eshots.push({
          x: e.x + Math.cos(a) * (T.enemyR + 1), y: e.y + Math.sin(a) * (T.enemyR + 1),
          vx: Math.cos(a) * T.enemyShotSpeed, vy: Math.sin(a) * T.enemyShotSpeed, life: 4
        });
        if (d < 120) Sound.enemyShoot();
      }
    }

    // --- enemy shots
    for (let i = G.eshots.length - 1; i >= 0; i--) {
      const s = G.eshots[i];
      s.x += s.vx * dt; s.y += s.vy * dt; s.life -= dt;
      if (s.life <= 0 || hitsWall(s.x, s.y, T.enemyShotR)) { G.eshots.splice(i, 1); continue; }
      if (Math.hypot(p.x - s.x, p.y - s.y) < T.playerR + T.enemyShotR) {
        G.eshots.splice(i, 1);
        p.hp -= T.enemyDamage;
        G.shake = 7; G.hurtFlash = 1;
        spawnParts(p.x, p.y, "#ff6a78", 8, 30);
        Sound.damage();
        if (p.hp <= 0) { p.hp = 0; syncHud(); return endGame(false, "You ran out of health."); }
      }
    }

    // --- pickups
    for (const o of G.orbs) {
      if (o.got) continue;
      if (Math.hypot(p.x - o.x, p.y - o.y) < T.playerR + T.orbR) {
        o.got = true; G.orbsHeld++;
        spawnParts(o.x, o.y, o.c, 16, 34);
        Sound.orb();
        if (G.orbsHeld === T.needOrbs) showToast("Orb quota met.", 1600);
      }
    }
    for (const d of G.donuts) {
      if (d.got) continue;
      if (Math.hypot(p.x - d.x, p.y - d.y) < T.playerR + T.donutR) {
        // The original always eats the donut and caps at 100. Skipping the pickup at
        // full health to avoid "wasting" it is unfaithful, and it reads as a broken
        // pickup: you walk over a donut and nothing happens at all.
        const before = p.hp;
        d.got = true;
        p.hp = Math.min(T.startHP, p.hp + T.donutHeal);
        spawnParts(d.x, d.y, "#ffb35c", 14, 30);
        Sound.donut();
        showToast(p.hp > before ? "+" + (p.hp - before) + " health" : "Health already full", 1100);
      }
    }

    // --- portal
    const dp = Math.hypot(p.x - M.PORTAL.x, p.y - M.PORTAL.y);
    if (dp < T.playerR + T.portalR) {
      // Re-check the gate every frame, so finishing the quota while standing on
      // the portal wins immediately. Only the refusal message is edge-triggered.
      const needO = G.orbsHeld < T.needOrbs, needK = G.kills < T.needKills;
      if (!needO && !needK) return endGame(true, "");
      if (!G.portalTouch) {
        G.portalTouch = true;
        if (needO && needK) showToast("Not enough orbs.<br>Not enough kills.");
        else if (needO)     showToast("Not enough orbs.");
        else                showToast("Not enough kills.");
        Sound.denied();
      }
    } else G.portalTouch = false;

    // --- particles
    for (let i = G.parts.length - 1; i >= 0; i--) {
      const q = G.parts[i];
      q.t += dt;
      if (q.t >= q.life) { G.parts.splice(i, 1); continue; }
      q.x += q.vx * dt; q.y += q.vy * dt;
      q.vx *= 0.93; q.vy *= 0.93;
    }

    syncHud();
  }

  // ------------------------------------------------------------------ camera
  const cam = { x: 0, y: 0 };
  function updateCamera() {
    const p = G.player;
    const halfW = VW / (2 * zoom), halfH = VH / (2 * zoom);
    const minX = ORIGIN_X + halfW, maxX = ORIGIN_X + WORLD_W - halfW;
    const maxY = TOP_Y - halfH, minY = TOP_Y - WORLD_H + halfH;
    cam.x = WORLD_W < halfW * 2 ? ORIGIN_X + WORLD_W / 2 : Math.max(minX, Math.min(maxX, p.x));
    cam.y = WORLD_H < halfH * 2 ? TOP_Y - WORLD_H / 2 : Math.max(minY, Math.min(maxY, p.y));
  }
  const sx = (wx) => (wx - cam.x) * zoom + VW / 2;
  const sy = (wy) => (cam.y - wy) * zoom + VH / 2;
  function screenToWorld(px, py) {
    return { x: cam.x + (px - VW / 2) / zoom, y: cam.y - (py - VH / 2) / zoom };
  }

  // ------------------------------------------------------------------ render
  function glowDot(x, y, r, color, alpha) {
    ctx.globalAlpha = (alpha == null ? 0.18 : alpha);
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(x, y, r * 1.75, 0, 6.2832); ctx.fill();
    ctx.globalAlpha = 1;
    ctx.beginPath(); ctx.arc(x, y, r, 0, 6.2832); ctx.fill();
  }

  function render() {
    updateCamera();
    ctx.save();
    if (G.shake > 0) ctx.translate((Math.random() - 0.5) * G.shake, (Math.random() - 0.5) * G.shake);

    ctx.fillStyle = "#05070b";
    ctx.fillRect(-20, -20, VW + 40, VH + 40);

    // viewport in world coords (padded)
    const halfW = VW / (2 * zoom) + CELL * 2, halfH = VH / (2 * zoom) + CELL * 2;
    const vx0 = cam.x - halfW, vx1 = cam.x + halfW;
    const vy0 = cam.y - halfH, vy1 = cam.y + halfH;

    // floor
    ctx.fillStyle = "#171f2c";
    ctx.beginPath();
    for (const r of FLOOR_RUNS) {
      if (r.x > vx1 || r.x + r.w < vx0 || r.y > vy1 || r.y + r.h < vy0) continue;
      ctx.rect(sx(r.x), sy(r.y + r.h), r.w * zoom + 0.6, r.h * zoom + 0.6);
    }
    ctx.fill();

    // wall edges
    ctx.strokeStyle = "rgba(46,230,246,.5)";
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    for (const e of EDGES) {
      if (Math.max(e[0], e[2]) < vx0 || Math.min(e[0], e[2]) > vx1) continue;
      if (Math.max(e[1], e[3]) < vy0 || Math.min(e[1], e[3]) > vy1) continue;
      ctx.moveTo(sx(e[0]), sy(e[1]));
      ctx.lineTo(sx(e[2]), sy(e[3]));
    }
    ctx.stroke();

    drawPortal();

    // pickups
    for (const o of G.orbs) {
      if (o.got) continue;
      const pulse = 1 + Math.sin(G.t * 3.4 + o.x) * 0.13;
      ctx.fillStyle = o.c;
      glowDot(sx(o.x), sy(o.y), T.orbR * zoom * 0.55 * pulse, o.c, 0.26);
    }
    for (const d of G.donuts) {
      if (d.got) continue;
      const r = T.donutR * zoom * 0.6;
      ctx.strokeStyle = "#ffb35c"; ctx.lineWidth = Math.max(2, r * 0.42);
      ctx.globalAlpha = 0.28;
      ctx.beginPath(); ctx.arc(sx(d.x), sy(d.y), r * 1.5, 0, 6.2832); ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.beginPath(); ctx.arc(sx(d.x), sy(d.y), r, 0, 6.2832); ctx.stroke();
    }

    // enemies
    for (const e of G.enemies) {
      if (!e.alive) continue;
      const ex = sx(e.x), ey = sy(e.y), r = T.enemyR * zoom;
      const col = e.flash > 0 ? "#ffffff" : ENEMY_COLOR[e.type];
      ctx.fillStyle = col;
      glowDot(ex, ey, r, col, 0.17);
      // beak pointing at the player, like the original's permanent lookAt
      const a = Math.atan2(G.player.y - e.y, G.player.x - e.x);
      ctx.fillStyle = "#0a0f16";
      ctx.beginPath();
      ctx.moveTo(ex + Math.cos(a) * r * 1.55, ey - Math.sin(a) * r * 1.55);
      ctx.lineTo(ex + Math.cos(a + 2.5) * r * 0.75, ey - Math.sin(a + 2.5) * r * 0.75);
      ctx.lineTo(ex + Math.cos(a - 2.5) * r * 0.75, ey - Math.sin(a - 2.5) * r * 0.75);
      ctx.closePath(); ctx.fill();
      // health arc
      if (e.hp < T.enemyHP) {
        ctx.strokeStyle = "rgba(255,77,94,.9)"; ctx.lineWidth = 2.4;
        ctx.beginPath();
        ctx.arc(ex, ey, r * 1.75, -Math.PI * 0.85, -Math.PI * 0.85 + (Math.PI * 1.7) * (e.hp / T.enemyHP));
        ctx.stroke();
      }
    }

    // shots
    for (const s of G.eshots) { ctx.fillStyle = "#ff8a5c"; glowDot(sx(s.x), sy(s.y), T.enemyShotR * zoom, "#ff8a5c", 0.3); }
    for (const s of G.shots)  { ctx.fillStyle = "#9ff4ff"; glowDot(sx(s.x), sy(s.y), T.shotR * zoom, "#9ff4ff", 0.34); }

    // particles
    for (const q of G.parts) {
      ctx.globalAlpha = 1 - q.t / q.life;
      ctx.fillStyle = q.c;
      const s = Math.max(1.4, zoom * 0.42);
      ctx.fillRect(sx(q.x) - s / 2, sy(q.y) - s / 2, s, s);
    }
    ctx.globalAlpha = 1;

    drawPlayer();

    ctx.restore();

    if (G.hurtFlash > 0) {
      ctx.fillStyle = "rgba(255,40,60," + (G.hurtFlash * 0.24).toFixed(3) + ")";
      ctx.fillRect(0, 0, VW, VH);
    }
    drawMinimap();
  }

  function drawPlayer() {
    const p = G.player, px = sx(p.x), py = sy(p.y), r = T.playerR * zoom;
    ctx.fillStyle = "#2ee6f6";
    glowDot(px, py, r, "#2ee6f6", 0.2);
    ctx.strokeStyle = "#eafcff";
    ctx.lineWidth = Math.max(2.4, r * 0.38);
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(px + Math.cos(p.aim) * r * 0.5, py - Math.sin(p.aim) * r * 0.5);
    ctx.lineTo(px + Math.cos(p.aim) * r * 1.75, py - Math.sin(p.aim) * r * 1.75);
    ctx.stroke();
  }

  /** The portal is the original's giant rotating eye. */
  function drawPortal() {
    const px = sx(M.PORTAL.x), py = sy(M.PORTAL.y), r = T.portalR * zoom;
    const ready = G.orbsHeld >= T.needOrbs && G.kills >= T.needKills;
    const tint = ready ? "#7ee08a" : "#5b6b7e";

    ctx.globalAlpha = 0.16 + (ready ? 0.14 : 0) + Math.sin(G.t * 2) * 0.05;
    ctx.fillStyle = tint;
    ctx.beginPath(); ctx.arc(px, py, r * 2.1, 0, 6.2832); ctx.fill();
    ctx.globalAlpha = 1;

    ctx.fillStyle = ready ? "#e8fff0" : "#c3cdd8";
    ctx.beginPath(); ctx.ellipse(px, py, r, r * 0.72, 0, 0, 6.2832); ctx.fill();

    const ix = px + Math.cos(G.portalSpin) * r * 0.26;
    const iy = py + Math.sin(G.portalSpin * 0.8) * r * 0.14;
    ctx.fillStyle = ready ? "#2fa96a" : "#4b6a86";
    ctx.beginPath(); ctx.arc(ix, iy, r * 0.46, 0, 6.2832); ctx.fill();
    ctx.fillStyle = "#06090d";
    ctx.beginPath(); ctx.arc(ix, iy, r * 0.22, 0, 6.2832); ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,.75)";
    ctx.beginPath(); ctx.arc(ix - r * 0.14, iy - r * 0.14, r * 0.08, 0, 6.2832); ctx.fill();

    ctx.strokeStyle = ready ? "rgba(126,224,138,.85)" : "rgba(91,107,126,.6)";
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.ellipse(px, py, r, r * 0.72, 0, 0, 6.2832); ctx.stroke();
  }

  // minimap: the whole maze, pre-rendered once
  let miniBase = null;
  function buildMinimap() {
    miniBase = document.createElement("canvas");
    miniBase.width = GW; miniBase.height = GH;
    const c = miniBase.getContext("2d");
    const img = c.createImageData(GW, GH);
    for (let k = 0; k < GW * GH; k++) {
      const wall = GRID[k];
      const o = k * 4;
      img.data[o]     = wall ? 8  : 30;
      img.data[o + 1] = wall ? 12 : 48;
      img.data[o + 2] = wall ? 18 : 64;
      img.data[o + 3] = wall ? 120 : 255;
    }
    c.putImageData(img, 0, 0);
  }
  function drawMinimap() {
    const w = mini.width, h = mini.height;
    mctx.clearRect(0, 0, w, h);
    mctx.drawImage(miniBase, 0, 0, w, h);
    const mx = (wx) => (wx - ORIGIN_X) / WORLD_W * w;
    const my = (wy) => (TOP_Y - wy) / WORLD_H * h;
    for (const o of G.orbs) {
      if (o.got) continue;
      mctx.fillStyle = o.c;
      mctx.fillRect(mx(o.x) - 1.5, my(o.y) - 1.5, 3, 3);
    }
    for (const e of G.enemies) {
      if (!e.alive) continue;
      mctx.fillStyle = "rgba(255,120,120,.9)";
      mctx.fillRect(mx(e.x) - 1, my(e.y) - 1, 2, 2);
    }
    const ready = G.orbsHeld >= T.needOrbs && G.kills >= T.needKills;
    mctx.fillStyle = ready ? "#7ee08a" : "#63788c";
    mctx.beginPath(); mctx.arc(mx(M.PORTAL.x), my(M.PORTAL.y), 3.2, 0, 6.2832); mctx.fill();
    mctx.fillStyle = "#2ee6f6";
    mctx.beginPath(); mctx.arc(mx(G.player.x), my(G.player.y), 2.6, 0, 6.2832); mctx.fill();
  }

  // -------------------------------------------------------------------- HUD
  let lastHud = "";
  function syncHud() {
    const p = G.player;
    const key = p.hp + "|" + G.orbsHeld + "|" + G.kills + "|" + Math.ceil(G.timeLeft);
    if (key === lastHud) return;
    lastHud = key;

    $("hpfill").style.transform = "scaleX(" + (p.hp / T.startHP) + ")";
    $("hplabel").textContent = p.hp;
    $("hpwrap").classList.toggle("low", p.hp <= 30);

    $("vOrbs").textContent = G.orbsHeld + "/" + T.needOrbs;
    $("vKills").textContent = G.kills + "/" + T.needKills;
    $("chipOrbs").classList.toggle("done", G.orbsHeld >= T.needOrbs);
    $("chipKills").classList.toggle("done", G.kills >= T.needKills);

    const s = Math.max(0, Math.ceil(G.timeLeft));
    const el = $("timer");
    el.textContent = Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
    el.classList.toggle("warn", s <= 60 && s > 20);
    el.classList.toggle("crit", s <= 20);
  }

  // ------------------------------------------------------------------ flow
  function startGame() {
    Sound.unlock();
    reset();
    lastHud = "";
    G.state = "play";
    scrTitle.classList.remove("show");
    scrEnd.classList.remove("show");
    hud.classList.remove("hidden");
    syncHud();
  }

  function endGame(won, reason) {
    G.state = "over";
    hud.classList.add("hidden");
    $("verdict").textContent = won ? "You Win" : "Game Over";
    $("verdict").className = "verdict " + (won ? "win" : "lose");
    $("reason").textContent = won
      ? "Escaped with " + fmt(G.timeLeft) + " left on the clock."
      : reason;
    $("tally").innerHTML =
      "<div><b>" + G.kills + "</b>KILLS</div>" +
      "<div><b>" + G.orbsHeld + "</b>ORBS</div>" +
      "<div><b>" + fmt(G.timeLeft) + "</b>LEFT</div>";
    scrEnd.classList.add("show");
    won ? Sound.win() : Sound.lose();
  }
  const fmt = (s) => Math.floor(Math.max(0, s) / 60) + ":" + String(Math.max(0, Math.ceil(s)) % 60).padStart(2, "0");

  function toggleMute() {
    const m = Sound.toggle();
    $("mute").textContent = m ? "SOUND OFF" : "SOUND ON";
  }

  // --------------------------------------------------------------- pointers
  cv.addEventListener("mousemove", (e) => {
    const r = cv.getBoundingClientRect();
    input.mx = e.clientX - r.left; input.my = e.clientY - r.top;
    input.mouseActive = true;
  });
  cv.addEventListener("mousedown", (e) => { if (e.button === 0) { input.firing = true; Sound.unlock(); } });
  addEventListener("mouseup", (e) => { if (e.button === 0) input.firing = false; });
  cv.addEventListener("contextmenu", (e) => e.preventDefault());

  // touch: left half drives movement, right half aims and auto-fires
  const stickL = $("stickL"), stickR = $("stickR");
  const active = new Map();
  const STICK_MAX = 46;

  function placeStick(el, cx, cy, dx, dy) {
    el.style.left = (cx - 59) + "px"; el.style.top = (cy - 59) + "px";
    el.style.right = "auto"; el.style.bottom = "auto";
    el.firstElementChild.style.transform = "translate(" + dx + "px," + dy + "px)";
  }

  cv.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse") return;
    Sound.unlock();
    cv.setPointerCapture(e.pointerId);
    const left = e.clientX < VW / 2;
    active.set(e.pointerId, { left, ox: e.clientX, oy: e.clientY });
    placeStick(left ? stickL : stickR, e.clientX, e.clientY, 0, 0);
  });
  cv.addEventListener("pointermove", (e) => {
    const a = active.get(e.pointerId);
    if (!a) return;
    let dx = e.clientX - a.ox, dy = e.clientY - a.oy;
    const d = Math.hypot(dx, dy) || 1;
    const cl = Math.min(d, STICK_MAX);
    const nx = (dx / d) * cl, ny = (dy / d) * cl;
    placeStick(a.left ? stickL : stickR, a.ox, a.oy, nx, ny);
    const vec = { x: dx / d, y: -dy / d };           // screen y-down -> world y-up
    if (d < 8) { if (a.left) touch.move = null; return; }
    if (a.left) touch.move = vec; else touch.aimStick = vec;
  });
  function endPointer(e) {
    const a = active.get(e.pointerId);
    if (!a) return;
    active.delete(e.pointerId);
    if (a.left) { touch.move = null; stickL.style.cssText = ""; }
    else { touch.aimStick = null; stickR.style.cssText = ""; }
  }
  cv.addEventListener("pointerup", endPointer);
  cv.addEventListener("pointercancel", endPointer);

  if (matchMedia("(pointer: coarse)").matches) $("touch").classList.add("on");

  // ------------------------------------------------------------------ boot
  $("btnStart").addEventListener("click", startGame);
  $("btnAgain").addEventListener("click", startGame);
  $("btnMenu").addEventListener("click", () => {
    G.state = "title";
    scrEnd.classList.remove("show");
    scrTitle.classList.add("show");
    hud.classList.add("hidden");
  });
  $("mute").addEventListener("click", toggleMute);

  resize();
  buildMinimap();
  reset();

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    update(dt);
    render();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // Debug / automated-test hook. `step` advances the simulation deterministically,
  // which lets tests run without depending on requestAnimationFrame.
  window.__GAME = {
    G, T, M, startGame, endGame, hitsWall, canSee, keys,
    step(dt, n) {
      for (let i = 0; i < (n || 1); i++) update(dt);
    }
  };
})();
