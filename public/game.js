(() => {
  'use strict';

  // ------------------------------------------------------------ 기본 설정 (여기 숫자만 고쳐도 난이도가 바뀌어요)
  const W = 360; // 게임 안의 가로 크기 (실제 화면 크기와 상관없이 고정된 좌표계)
  const H = 640;
  const SCALE = 2; // 선명하게 보이도록 2배 크기로 그림
  const GROUND = H - 36; // 캐릭터 발이 닿는 높이

  const PLAYER_SPEED = 330; // 키보드 이동 속도 (px/초)
  const SPAWN_START = 0.85; // 처음 똥이 나오는 간격 (초)
  const SPAWN_MIN = 0.22; // 가장 빠를 때의 간격 (초). 서버의 점수 검사와 맞춰져 있으니 너무 줄이지 마세요
  const SPAWN_SPEEDUP = 0.012; // 1초 지날 때마다 간격이 줄어드는 양
  const FALL_START = 150; // 똥이 처음 떨어지는 속도 (px/초)
  const FALL_MAX_BONUS = 300; // 시간이 지나며 더해지는 속도의 최대치
  const AIMED_CHANCE = 0.35; // 플레이어 근처로 떨어지는 똥의 비율

  const $ = (s) => document.querySelector(s);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const rand = (a, b) => a + Math.random() * (b - a);

  const store = {
    get(k) {
      try {
        return localStorage.getItem(k);
      } catch {
        return null;
      }
    },
    set(k, v) {
      try {
        localStorage.setItem(k, v);
      } catch {}
    },
  };

  const canvas = $('#game');
  const ctx = canvas.getContext('2d');
  canvas.width = W * SCALE;
  canvas.height = H * SCALE;

  // ------------------------------------------------------------ 상태
  const G = {
    mode: 'ready', // ready(시작 화면) | playing | over
    t: 0, // 버틴 시간
    dodged: 0, // 피한 똥 개수
    px: W / 2,
    targetX: null, // 터치/마우스로 가리킨 위치
    dir: 0,
    walk: 0,
    keys: { left: false, right: false },
    poops: [],
    parts: [],
    spawn: 0.4,
    hit: null, // 맞은 똥 (캐릭터 머리 위에 그대로 남김)
    overT: 0,
    overShown: false,
    overShownAt: 0,
    submitted: false,
    muted: store.get('ddong-muted') === '1',
    best: Number(store.get('ddong-best')) || 0,
    clouds: [
      { x: 40, y: 96, s: 1 },
      { x: 230, y: 170, s: 0.75 },
      { x: 310, y: 56, s: 0.55 },
    ],
  };

  // ------------------------------------------------------------ 소리 (파일 없이 브라우저가 직접 만들어요)
  let actx = null;
  function audio() {
    if (!actx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) actx = new AC();
    }
    if (actx && actx.state === 'suspended') actx.resume();
    return actx;
  }
  function tone(freq, dur, { type = 'sine', vol = 0.12, at = 0, slide } = {}) {
    if (G.muted) return;
    const a = audio();
    if (!a) return;
    const t = a.currentTime + at;
    const o = a.createOscillator();
    const g = a.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(a.destination);
    o.start(t);
    o.stop(t + dur + 0.03);
  }
  const sfx = {
    start: () => {
      tone(520, 0.1, { type: 'triangle', vol: 0.1 });
      tone(780, 0.14, { type: 'triangle', vol: 0.1, at: 0.09 });
    },
    hit: () => {
      tone(200, 0.35, { type: 'sawtooth', vol: 0.14, slide: 55 });
      tone(90, 0.3, { type: 'square', vol: 0.08, at: 0.02, slide: 40 });
    },
    good: () => [523, 659, 784].forEach((f, i) => tone(f, 0.18, { type: 'triangle', vol: 0.1, at: i * 0.09 })),
  };

  // ------------------------------------------------------------ 그리기 도구
  function ellipse(x, y, rx, ry) {
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  }
  function roundRectPath(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawPoop(x, y, s, rot) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    const k = s / 40;
    ctx.scale(k, k);
    ctx.lineJoin = 'round';
    ctx.lineWidth = 2.4;
    ctx.strokeStyle = '#4a2a0e';
    const g = ctx.createLinearGradient(0, -26, 0, 24);
    g.addColorStop(0, '#a56e37');
    g.addColorStop(1, '#6b3f17');
    ctx.fillStyle = g;
    ellipse(0, 13, 21, 10);
    ctx.fill();
    ctx.stroke();
    ellipse(0, 1, 16, 9);
    ctx.fill();
    ctx.stroke();
    ellipse(0, -9, 10.5, 7.5);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-6, -14);
    ctx.quadraticCurveTo(0, -33, 7, -17);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    for (const ex of [-5.5, 5.5]) {
      ctx.fillStyle = '#fff';
      ellipse(ex, 0, 3.6, 4.2);
      ctx.fill();
      ctx.fillStyle = '#222';
      ellipse(ex + 0.6, 0.7, 1.7, 2.1);
      ctx.fill();
    }
    ctx.strokeStyle = '#3a1f08';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.arc(0, 5, 3.2, 0.15 * Math.PI, 0.85 * Math.PI);
    ctx.stroke();
    ctx.restore();
  }

  function drawPlayer(time) {
    const dead = G.mode === 'over';
    ctx.save();
    ctx.translate(G.px, GROUND);
    const moving = G.mode === 'playing' && G.dir !== 0;
    const swing = moving ? Math.sin(G.walk) * 5 : 0;
    const bob = dead ? 0 : moving ? Math.abs(Math.sin(G.walk)) * 2 : Math.sin(time * 3) * 1;

    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ellipse(0, 1, 17, 4);
    ctx.fill();

    // 다리
    ctx.fillStyle = '#2b3a67';
    roundRectPath(-9 + swing * 0.4, -16, 7, 16, 3);
    ctx.fill();
    roundRectPath(2 - swing * 0.4, -16, 7, 16, 3);
    ctx.fill();

    // 몸
    ctx.translate(0, -bob);
    ctx.fillStyle = '#3a86ff';
    roundRectPath(-12, -36, 24, 24, 8);
    ctx.fill();
    // 팔
    ctx.fillStyle = '#ffd9b3';
    ellipse(-14, dead ? -20 : -22 + swing * 0.3, 3.4, 4);
    ctx.fill();
    ellipse(14, dead ? -20 : -22 - swing * 0.3, 3.4, 4);
    ctx.fill();

    // 머리
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#7a5a3a';
    ctx.fillStyle = '#ffd9b3';
    ellipse(0, -48, 14, 14);
    ctx.fill();
    ctx.stroke();
    // 머리카락
    ctx.fillStyle = '#3b2a1a';
    ctx.beginPath();
    ctx.arc(0, -50, 14.5, Math.PI * 1.05, Math.PI * 1.95);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = '#2b2118';
    ctx.fillStyle = '#2b2118';
    ctx.lineWidth = 2;
    if (dead) {
      for (const ex of [-5, 5]) {
        ctx.beginPath();
        ctx.moveTo(ex - 2.4, -49 - 2.4);
        ctx.lineTo(ex + 2.4, -49 + 2.4);
        ctx.moveTo(ex + 2.4, -49 - 2.4);
        ctx.lineTo(ex - 2.4, -49 + 2.4);
        ctx.stroke();
      }
      ellipse(0, -42, 2.6, 3);
      ctx.fill();
    } else {
      ellipse(-5, -48, 1.8, 2.4);
      ctx.fill();
      ellipse(5, -48, 1.8, 2.4);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(0, -44.5, 3.4, 0.15 * Math.PI, 0.85 * Math.PI);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawCloud(c) {
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    const s = c.s;
    ellipse(c.x, c.y, 34 * s, 13 * s);
    ctx.fill();
    ellipse(c.x - 18 * s, c.y + 3 * s, 20 * s, 11 * s);
    ctx.fill();
    ellipse(c.x + 20 * s, c.y + 4 * s, 22 * s, 10 * s);
    ctx.fill();
  }

  let sky = null;
  const tufts = Array.from({ length: 16 }, (_, i) => ({ x: 12 + i * 22 + rand(-5, 5), h: rand(5, 9) }));

  function render(time) {
    ctx.setTransform(SCALE, 0, 0, SCALE, 0, 0);

    if (!sky) {
      sky = ctx.createLinearGradient(0, 0, 0, GROUND);
      sky.addColorStop(0, '#7cc8f5');
      sky.addColorStop(1, '#e3f5ff');
    }
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, GROUND);

    // 해
    ctx.fillStyle = 'rgba(255, 233, 130, 0.9)';
    ellipse(W - 52, 118, 24, 24);
    ctx.fill();

    G.clouds.forEach(drawCloud);

    // 땅
    ctx.fillStyle = '#59ad4f';
    ctx.fillRect(0, GROUND, W, H - GROUND);
    ctx.fillStyle = '#3f8a3a';
    ctx.fillRect(0, GROUND, W, 5);
    ctx.fillStyle = '#4a9c43';
    for (const t of tufts) {
      ctx.beginPath();
      ctx.moveTo(t.x - 4, GROUND + 5);
      ctx.lineTo(t.x, GROUND + 5 - t.h);
      ctx.lineTo(t.x + 4, GROUND + 5);
      ctx.fill();
    }

    for (const p of G.poops) drawPoop(p.x, p.y, p.s, p.rot);
    drawPlayer(time);
    if (G.hit) drawPoop(G.hit.x, G.hit.y, G.hit.s, G.hit.rot);

    for (const q of G.parts) {
      ctx.globalAlpha = clamp(q.life * 2, 0, 1);
      ctx.fillStyle = q.color;
      ellipse(q.x, q.y, q.r, q.r);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // ------------------------------------------------------------ 게임 규칙
  function resetRun() {
    G.t = 0;
    G.dodged = 0;
    G.px = W / 2;
    G.targetX = null;
    G.dir = 0;
    G.poops = [];
    G.parts = [];
    G.spawn = 0.4;
    G.hit = null;
    G.overT = 0;
    G.overShown = false;
    G.submitted = false;
  }

  function spawnPoop(aimed, slow) {
    const s = rand(26, 44);
    let x = aimed ? G.px + rand(-40, 40) : rand(s / 2, W - s / 2);
    x = clamp(x, s / 2, W - s / 2);
    const v = slow ? rand(110, 200) : FALL_START + Math.min(G.t * 6, FALL_MAX_BONUS) + rand(0, 70);
    G.poops.push({ x, y: -s, s, v, rot: rand(-0.3, 0.3), vr: rand(-0.7, 0.7) });
  }

  function burst(x, y, n, speed) {
    for (let i = 0; i < n; i++) {
      const a = rand(Math.PI, Math.PI * 2);
      const v = rand(speed * 0.4, speed);
      G.parts.push({
        x,
        y,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v,
        r: rand(1.8, 4.2),
        life: rand(0.5, 0.9),
        color: Math.random() < 0.7 ? '#7a4a1f' : '#a56e37',
      });
    }
  }

  // 캐릭터 몸(세로로 긴 사각형)과 똥(원)이 닿았는지. 살짝 너그럽게 판정해요.
  function touchesPlayer(p) {
    const left = G.px - 11;
    const right = G.px + 11;
    const top = GROUND - 56;
    const bottom = GROUND;
    const r = p.s * 0.36;
    const cx = clamp(p.x, left, right);
    const cy = clamp(p.y, top, bottom);
    const dx = p.x - cx;
    const dy = p.y - cy;
    return dx * dx + dy * dy < r * r;
  }

  function gameOver(p) {
    G.mode = 'over';
    G.hit = { x: p.x, y: p.y, s: p.s, rot: p.rot };
    G.poops = G.poops.filter((q) => q !== p);
    burst(p.x, p.y, 20, 220);
    G.overT = 0;
    G.keys.left = G.keys.right = false;
    G.targetX = null;
    sfx.hit();
  }

  function update(dt) {
    for (const c of G.clouds) {
      c.x += 9 * dt;
      if (c.x > W + 70) c.x = -80;
    }

    if (G.mode === 'playing') {
      G.t += dt;

      // 이동
      const vx = (G.keys.right ? 1 : 0) - (G.keys.left ? 1 : 0);
      if (vx !== 0) {
        G.targetX = null;
        G.px += vx * PLAYER_SPEED * dt;
        G.dir = vx;
      } else if (G.targetX != null) {
        const d = G.targetX - G.px;
        const step = PLAYER_SPEED * 1.5 * dt;
        if (Math.abs(d) <= step) {
          G.px = G.targetX;
          G.dir = 0;
        } else {
          G.px += Math.sign(d) * step;
          G.dir = Math.sign(d);
        }
      } else {
        G.dir = 0;
      }
      G.px = clamp(G.px, 16, W - 16);
      G.walk += Math.abs(G.dir) * dt * 14;

      // 똥 만들기
      G.spawn -= dt;
      if (G.spawn <= 0) {
        spawnPoop(Math.random() < AIMED_CHANCE, false);
        G.spawn += Math.max(SPAWN_MIN, SPAWN_START - G.t * SPAWN_SPEEDUP);
      }
    } else if (G.mode === 'ready') {
      // 시작 화면 뒤에서 구경용 똥이 천천히 떨어져요
      G.spawn -= dt;
      if (G.spawn <= 0) {
        spawnPoop(false, true);
        G.spawn += 0.55;
      }
    } else if (G.mode === 'over') {
      G.overT += dt;
    }

    // 똥 움직이기
    for (let i = G.poops.length - 1; i >= 0; i--) {
      const p = G.poops[i];
      p.y += p.v * dt;
      p.rot += p.vr * dt;

      if (G.mode === 'playing' && touchesPlayer(p)) {
        gameOver(p);
        continue;
      }
      if (p.y + p.s * 0.42 >= GROUND) {
        burst(p.x, GROUND, 4, 90);
        G.poops.splice(i, 1);
        if (G.mode === 'playing') G.dodged++;
      }
    }

    // 알갱이
    for (let i = G.parts.length - 1; i >= 0; i--) {
      const q = G.parts[i];
      q.vy += 700 * dt;
      q.x += q.vx * dt;
      q.y += q.vy * dt;
      q.life -= dt;
      if (q.life <= 0 || q.y > H) G.parts.splice(i, 1);
    }

    if (G.mode === 'over' && !G.overShown && G.overT > 0.8) showOver();
    updateHud();
  }

  // ------------------------------------------------------------ 점수판 / 화면 전환
  let lastScore = -1;
  let lastTime = '';
  function updateHud() {
    if (G.dodged !== lastScore) {
      lastScore = G.dodged;
      $('#hud-score').textContent = String(G.dodged);
    }
    const t = G.t.toFixed(1);
    if (t !== lastTime) {
      lastTime = t;
      $('#hud-time').textContent = t;
    }
  }

  function start() {
    if (G.mode === 'playing') return;
    audio();
    resetRun();
    G.mode = 'playing';
    $('#screen-start').classList.add('hidden');
    $('#screen-over').classList.add('hidden');
    sfx.start();
  }

  function showOver() {
    G.overShown = true;
    G.overShownAt = performance.now();

    const isBest = G.dodged > G.best;
    if (isBest) {
      G.best = G.dodged;
      store.set('ddong-best', String(G.best));
    }
    $('#over-score').textContent = String(G.dodged);
    $('#over-time').textContent = G.t.toFixed(1);
    $('#over-best').textContent =
      isBest && G.dodged > 0 ? '내 최고 기록을 새로 세웠어요!' : G.best > 0 ? `내 최고 기록 ${G.best}개` : '';
    if (isBest && G.dodged > 0) sfx.good();

    const form = $('#form-submit');
    const msg = $('#submit-msg');
    msg.className = 'msg';
    if (G.dodged < 1) {
      form.classList.add('hidden');
      msg.textContent = '한 개 이상 피해야 랭킹에 등록할 수 있어요.';
    } else {
      form.classList.remove('hidden');
      msg.textContent = '';
      $('#btn-submit').disabled = false;
      const saved = store.get('ddong-name');
      if (saved && !$('#name').value) $('#name').value = saved;
    }

    $('#screen-over').classList.remove('hidden');
    loadScores();
  }

  // ------------------------------------------------------------ 랭킹
  function renderRank(list, scores, limit) {
    list.textContent = '';
    if (!scores.length) {
      const li = document.createElement('li');
      li.className = 'empty';
      li.textContent = '아직 기록이 없어요. 첫 번째 기록을 남겨 보세요.';
      list.appendChild(li);
      return;
    }
    scores.slice(0, limit).forEach((s, i) => {
      const li = document.createElement('li');
      const no = document.createElement('span');
      no.className = 'no';
      no.textContent = String(i + 1);
      const nm = document.createElement('span');
      nm.className = 'nm';
      nm.textContent = s.name; // textContent 라서 이름에 이상한 글자가 있어도 안전해요
      const sc = document.createElement('span');
      sc.textContent = `${s.score}개`;
      li.append(no, nm, sc);
      list.appendChild(li);
    });
  }

  function showRanks(scores) {
    renderRank($('#rank-start'), scores, 10);
    renderRank($('#rank-over'), scores, 10);
  }

  async function loadScores() {
    try {
      const r = await fetch('/api/scores', { cache: 'no-store' });
      const j = await r.json();
      showRanks(j.scores || []);
    } catch {
      for (const id of ['#rank-start', '#rank-over']) {
        const el = $(id);
        el.textContent = '';
        const li = document.createElement('li');
        li.className = 'empty';
        li.textContent = '랭킹을 불러오지 못했어요.';
        el.appendChild(li);
      }
    }
  }

  async function submitScore(e) {
    e.preventDefault();
    if (G.submitted) return;
    const msg = $('#submit-msg');
    const btn = $('#btn-submit');
    const name = $('#name').value.trim();
    msg.className = 'msg';
    if (!name) {
      msg.textContent = '이름을 입력해 주세요.';
      msg.classList.add('err');
      return;
    }
    btn.disabled = true;
    try {
      const r = await fetch('/api/scores', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, score: G.dodged, duration: Math.round(G.t * 10) / 10 }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) throw new Error(j.msg || '등록하지 못했어요. 잠시 후 다시 시도해 주세요.');
      G.submitted = true;
      store.set('ddong-name', name);
      msg.textContent = j.rank && j.rank <= 10 ? `랭킹 ${j.rank}위로 등록했어요!` : `등록했어요. (${j.rank ?? '100위 밖'}위)`;
      msg.classList.add('ok');
      showRanks(j.scores || []);
    } catch (err) {
      msg.textContent = err.message || '등록하지 못했어요. 서버에 연결할 수 없어요.';
      msg.classList.add('err');
      btn.disabled = false;
    }
  }

  // ------------------------------------------------------------ 입력
  function pointToX(e) {
    const rect = canvas.getBoundingClientRect();
    return clamp(((e.clientX - rect.left) / rect.width) * W, 16, W - 16);
  }
  const stage = $('#stage');
  let pointerDown = false;
  stage.addEventListener('pointerdown', (e) => {
    audio();
    if (G.mode !== 'playing' || e.target.closest('button')) return;
    pointerDown = true;
    G.targetX = pointToX(e);
    try {
      stage.setPointerCapture(e.pointerId);
    } catch {}
  });
  stage.addEventListener('pointermove', (e) => {
    if (G.mode === 'playing' && pointerDown) G.targetX = pointToX(e);
  });
  const release = () => {
    pointerDown = false;
    if (G.mode === 'playing') G.targetX = null;
  };
  stage.addEventListener('pointerup', release);
  stage.addEventListener('pointercancel', release);

  const isTyping = (el) => /^(INPUT|TEXTAREA)$/.test(el.tagName);
  window.addEventListener('keydown', (e) => {
    if (isTyping(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key;
    if (k === 'ArrowLeft' || k === 'a' || k === 'A') {
      G.keys.left = true;
      e.preventDefault();
    } else if (k === 'ArrowRight' || k === 'd' || k === 'D') {
      G.keys.right = true;
      e.preventDefault();
    } else if ((k === ' ' || k === 'Enter') && !e.repeat) {
      if (G.mode === 'ready') {
        e.preventDefault();
        start();
      } else if (G.mode === 'over' && G.overShown && performance.now() - G.overShownAt > 700) {
        e.preventDefault();
        start();
      }
    }
  });
  window.addEventListener('keyup', (e) => {
    const k = e.key;
    if (k === 'ArrowLeft' || k === 'a' || k === 'A') G.keys.left = false;
    if (k === 'ArrowRight' || k === 'd' || k === 'D') G.keys.right = false;
  });
  window.addEventListener('blur', () => {
    G.keys.left = G.keys.right = false;
  });

  $('#btn-start').addEventListener('click', (e) => {
    e.currentTarget.blur();
    start();
  });
  $('#btn-retry').addEventListener('click', (e) => {
    e.currentTarget.blur();
    start();
  });
  $('#form-submit').addEventListener('submit', submitScore);

  function updateSoundBtn() {
    const b = $('#btn-sound');
    b.textContent = G.muted ? '소리 끔' : '소리 켬';
    b.setAttribute('aria-pressed', String(!G.muted));
  }
  $('#btn-sound').addEventListener('click', (e) => {
    G.muted = !G.muted;
    store.set('ddong-muted', G.muted ? '1' : '0');
    updateSoundBtn();
    e.currentTarget.blur();
    if (!G.muted) sfx.start();
  });

  // ------------------------------------------------------------ 시작
  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000); // 탭을 오래 떠났다 와도 한 번에 튀지 않게
    last = now;
    update(dt);
    render(now / 1000);
    requestAnimationFrame(frame);
  }

  updateSoundBtn();
  loadScores();
  requestAnimationFrame(frame);
})();
