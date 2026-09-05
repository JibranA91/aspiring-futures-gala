/* Celebrations — full-screen confetti, fireworks and balloons for the audience
   screen. A single <canvas> overlay is pinned to document.body (outside the
   DCX root, so the reconciler never touches it) and one requestAnimationFrame
   loop drives every active particle. The loop stops itself when nothing is left
   on screen, so it costs nothing while idle.

   Public API:
     Celebrations.play('confetti' | 'fireworks' | 'balloons' | 'all')
     Celebrations.clear()
*/
(function () {
  const TAU = Math.PI * 2;
  const CAP = 2200; // hard ceiling on live particles, in case the button is spammed

  const CONFETTI = ['#f2a93b', '#f5b856', '#f8ce84', '#9563dc', '#ae83e8', '#c9a9f1', '#ffffff', '#ff6b9d', '#4bd6c4', '#ffd34e', '#5ad1f0'];
  const FIRE = ['#ffd34e', '#ff8f3b', '#ff5d73', '#8f6bff', '#4bd6c4', '#ffffff', '#ffe08a'];
  const BALLOON = ['#f2a93b', '#9563dc', '#ff6b9d', '#4bd6c4', '#ffd34e', '#ae83e8', '#f76d6d'];
  const pick = (a) => a[(Math.random() * a.length) | 0];

  let canvas = null, ctx = null, W = 0, H = 0, DPR = 1;
  let particles = [];
  let raf = 0, last = 0;

  function resize() {
    if (!canvas) return;
    W = window.innerWidth; H = window.innerHeight;
    DPR = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.floor(W * DPR);
    canvas.height = Math.floor(H * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  }

  function ensureCanvas() {
    if (canvas) return;
    canvas = document.createElement('canvas');
    canvas.setAttribute('aria-hidden', 'true');
    const st = canvas.style;
    st.position = 'fixed'; st.left = '0'; st.top = '0';
    st.width = '100%'; st.height = '100%';
    st.pointerEvents = 'none'; st.zIndex = '2147483000';
    document.body.appendChild(canvas);
    ctx = canvas.getContext('2d');
    resize();
    window.addEventListener('resize', resize);
  }

  function start() {
    ensureCanvas();
    if (!raf) { last = performance.now(); raf = requestAnimationFrame(tick); }
  }

  function tick(t) {
    let dt = (t - last) / 1000;
    if (!(dt > 0) || dt > 0.05) dt = 0.05; // clamp first frame / tab-switch gaps
    last = t;
    ctx.clearRect(0, 0, W, H);
    if (particles.length > CAP) particles.splice(0, particles.length - CAP);
    const next = [];
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      if (p.step(dt)) { p.draw(ctx); next.push(p); }
    }
    particles = next;
    if (particles.length) { raf = requestAnimationFrame(tick); }
    else { raf = 0; last = 0; ctx.clearRect(0, 0, W, H); }
  }

  // ── Confetti ──────────────────────────────────────────────────────────────
  // Two corner cannons fire a fan of paper up and inward; gravity and a little
  // flutter carry it back down.
  function Confetto(x, y, vx, vy) {
    this.x = x; this.y = y; this.vx = vx; this.vy = vy;
    this.color = pick(CONFETTI);
    this.w = 6 + Math.random() * 6;
    this.h = 8 + Math.random() * 9;
    this.rot = Math.random() * TAU;
    this.vr = (Math.random() - 0.5) * 11;
    this.tilt = Math.random() * TAU;
    this.flutter = 6 + Math.random() * 7;
    this.life = 0;
    this.max = 2.7 + Math.random() * 1.6;
  }
  Confetto.prototype.step = function (dt) {
    this.life += dt;
    this.vy += 360 * dt;          // gravity
    this.vx *= (1 - 0.7 * dt);    // horizontal drag
    this.tilt += this.flutter * dt;
    this.x += (this.vx + Math.sin(this.tilt) * 26) * dt;
    this.y += this.vy * dt;
    this.rot += this.vr * dt;
    return this.life < this.max && this.y < H + 60;
  };
  Confetto.prototype.draw = function (ctx) {
    const fade = this.max - this.life;
    ctx.save();
    ctx.globalAlpha = fade < 0.7 ? Math.max(0, fade / 0.7) : 1;
    ctx.translate(this.x, this.y);
    ctx.rotate(this.rot);
    ctx.scale(1, Math.cos(this.tilt)); // wink edge-on for a shimmer
    ctx.fillStyle = this.color;
    ctx.fillRect(-this.w / 2, -this.h / 2, this.w, this.h);
    ctx.restore();
  };
  function confetti(per) {
    ensureCanvas();
    per = per || 100;
    const cannons = [{ x: 12, base: 0.32 }, { x: W - 12, base: -0.32 }];
    for (const c of cannons) {
      for (let i = 0; i < per; i++) {
        const ang = -Math.PI / 2 + c.base + (Math.random() - 0.5) * 0.5;
        const sp = 640 + Math.random() * 560;
        particles.push(new Confetto(c.x, H - 8, Math.cos(ang) * sp, Math.sin(ang) * sp));
      }
    }
    start();
  }

  // ── Fireworks ─────────────────────────────────────────────────────────────
  function Spark(x, y, vx, vy, color) {
    this.x = x; this.y = y; this.vx = vx; this.vy = vy; this.color = color;
    this.life = 0; this.max = 1.1 + Math.random() * 0.7;
    this.size = 2 + Math.random() * 2;
  }
  Spark.prototype.step = function (dt) {
    this.life += dt;
    this.vy += 190 * dt;
    this.vx *= (1 - 0.9 * dt);
    this.vy *= (1 - 0.9 * dt);
    this.x += this.vx * dt; this.y += this.vy * dt;
    return this.life < this.max;
  };
  Spark.prototype.draw = function (ctx) {
    ctx.save();
    ctx.globalAlpha = Math.max(0, 1 - this.life / this.max);
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = this.color;
    ctx.shadowColor = this.color; ctx.shadowBlur = 8;
    ctx.beginPath(); ctx.arc(this.x, this.y, this.size, 0, TAU); ctx.fill();
    ctx.restore();
  };
  function Flash(x, y, color) {
    this.x = x; this.y = y; this.color = color; this.life = 0; this.max = 0.42;
  }
  Flash.prototype.step = function (dt) { this.life += dt; return this.life < this.max; };
  Flash.prototype.draw = function (ctx) {
    const a = Math.max(0, 1 - this.life / this.max) * 0.5;
    const r = 60 + this.life * 280;
    ctx.save();
    ctx.globalAlpha = a; ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createRadialGradient(this.x, this.y, 0, this.x, this.y, r);
    g.addColorStop(0, this.color); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(this.x, this.y, r, 0, TAU); ctx.fill();
    ctx.restore();
  };
  function burst(x, y, color) {
    const n = 46 + ((Math.random() * 28) | 0);
    particles.push(new Flash(x, y, color));
    for (let i = 0; i < n; i++) {
      const ang = (i / n) * TAU + Math.random() * 0.12;
      const sp = 120 + Math.random() * 230;
      particles.push(new Spark(x, y, Math.cos(ang) * sp, Math.sin(ang) * sp, Math.random() < 0.18 ? '#ffffff' : color));
    }
  }
  function Rocket(x, ty, color) {
    this.x = x; this.y = H + 10; this.ty = ty; this.color = color;
    this.vy = -(700 + Math.random() * 260);
    this.vx = (Math.random() - 0.5) * 46;
    this.trail = [];
  }
  Rocket.prototype.step = function (dt) {
    this.trail.push(this.x, this.y);
    if (this.trail.length > 12) this.trail.splice(0, 2);
    this.vy += 260 * dt; // gravity bleeds off the climb
    this.x += this.vx * dt; this.y += this.vy * dt;
    if (this.y <= this.ty || this.vy >= -40) { burst(this.x, this.y, this.color); return false; }
    return true;
  };
  Rocket.prototype.draw = function (ctx) {
    const t = this.trail;
    ctx.save();
    ctx.globalAlpha = 0.9; ctx.strokeStyle = this.color;
    ctx.lineWidth = 3; ctx.lineCap = 'round';
    ctx.beginPath();
    if (t.length) {
      ctx.moveTo(t[0], t[1]);
      for (let i = 2; i < t.length; i += 2) ctx.lineTo(t[i], t[i + 1]);
      ctx.lineTo(this.x, this.y);
    }
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(this.x, this.y, 2.6, 0, TAU); ctx.fill();
    ctx.restore();
  };
  function Launcher(count, gap) { this.count = count; this.gap = gap; this.t = 0; this.fired = 0; }
  Launcher.prototype.step = function (dt) {
    this.t += dt;
    while (this.fired < this.count && this.t >= this.fired * this.gap) {
      const x = W * (0.14 + Math.random() * 0.72);
      const ty = H * (0.12 + Math.random() * 0.3);
      particles.push(new Rocket(x, ty, pick(FIRE)));
      this.fired++;
    }
    return this.fired < this.count;
  };
  Launcher.prototype.draw = function () {};
  function fireworks(count) {
    ensureCanvas();
    particles.push(new Launcher(count || 6, 0.28));
    start();
  }

  // ── Balloons ──────────────────────────────────────────────────────────────
  function Balloon(x, color) {
    this.baseX = x; this.x = x; this.y = H + 30 + Math.random() * H * 0.5;
    this.r = 26 + Math.random() * 20;
    this.color = color;
    this.vy = -(120 + Math.random() * 70);
    this.sway = 18 + Math.random() * 26;
    this.sp = 0.6 + Math.random() * 0.7;
    this.phase = Math.random() * TAU;
    this.t = 0;
  }
  Balloon.prototype.step = function (dt) {
    this.t += dt;
    this.y += this.vy * dt;
    this.x = this.baseX + Math.sin(this.phase + this.t * this.sp) * this.sway;
    return this.y > -this.r * 3;
  };
  Balloon.prototype.draw = function (ctx) {
    const x = this.x, y = this.y, r = this.r;
    ctx.save();
    // string
    ctx.strokeStyle = 'rgba(255,255,255,0.32)'; ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x, y + r * 1.14);
    ctx.quadraticCurveTo(x + Math.sin(this.t * 2) * 8, y + r * 2, x, y + r * 2.8);
    ctx.stroke();
    // body + knot
    ctx.fillStyle = this.color;
    ctx.beginPath(); ctx.ellipse(x, y, r * 0.86, r, 0, 0, TAU); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(x - 4, y + r); ctx.lineTo(x + 4, y + r); ctx.lineTo(x, y + r * 1.16);
    ctx.closePath(); ctx.fill();
    // highlight
    ctx.globalAlpha = 0.32; ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.ellipse(x - r * 0.3, y - r * 0.34, r * 0.16, r * 0.26, -0.4, 0, TAU); ctx.fill();
    ctx.restore();
  };
  function balloons(n) {
    ensureCanvas();
    n = n || 15;
    for (let i = 0; i < n; i++) {
      const x = W * ((i + 0.5) / n) + (Math.random() - 0.5) * 40;
      particles.push(new Balloon(x, pick(BALLOON)));
    }
    start();
  }

  window.Celebrations = {
    play: function (type) {
      try {
        if (type === 'confetti') confetti();
        else if (type === 'fireworks') fireworks();
        else if (type === 'balloons') balloons();
        else if (type === 'all') { confetti(90); fireworks(7); balloons(12); }
      } catch (e) { /* never let a celebration break the board */ }
    },
    clear: function () {
      particles = [];
      if (ctx) ctx.clearRect(0, 0, W, H);
    }
  };
})();
