'use strict';
/**
 * 똥 피하기 서버
 *  - public/ 폴더의 게임 화면을 보여주고
 *  - 랭킹 API(GET/POST /api/scores)를 제공합니다.
 *  - 외부 패키지 없이 Node.js 내장 모듈만 사용합니다.
 */
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

// ------------------------------------------------------------------ 설정
const PORT = Number(process.env.PORT) || 3003;
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const SCORE_FILE = path.join(DATA_DIR, 'scores.json');

const KEEP = 100; // 파일에 보관하는 최대 기록 수
const TOP = 10; // 화면에 보여주는 기록 수
const MAX_BODY = 1024; // 요청 본문 최대 바이트
const NAME_COOLDOWN_MS = 3000; // 같은 접속지+같은 이름의 연속 등록 간격
const GLOBAL_LIMIT_PER_MIN = 30; // 전체 등록 횟수 제한 (도배 방지)
const MAX_DODGE_PER_SEC = 5; // 게임이 만들어내는 최대 속도(초당 약 4.5개)보다 넉넉하게
const MAX_SCORE = 100000;
const MAX_DURATION = 3600;

// ------------------------------------------------------------------ 랭킹 저장소
function loadScores() {
  try {
    const arr = JSON.parse(fs.readFileSync(SCORE_FILE, 'utf8'));
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((s) => s && typeof s.name === 'string' && Number.isInteger(s.score) && s.score >= 0)
      .map((s) => ({ name: s.name, score: s.score, at: Number(s.at) || 0 }))
      .slice(0, KEEP);
  } catch {
    return [];
  }
}

let scores = loadScores();

function saveScores() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = SCORE_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(scores));
    fs.renameSync(tmp, SCORE_FILE); // 쓰는 도중 꺼져도 기존 파일이 깨지지 않게
  } catch (e) {
    console.error('[랭킹 저장 실패]', e.message);
  }
}

const top = () => scores.slice(0, TOP).map((s) => ({ name: s.name, score: s.score }));

function cleanName(raw) {
  let name = String(raw ?? '')
    .replace(/[\u0000-\u001f\u007f<>&"'`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  name = Array.from(name).slice(0, 10).join('');
  return name;
}

// ------------------------------------------------------------------ 등록 제한
const lastByKey = new Map();
let recent = []; // 최근 1분 안의 등록 시각

function allowPost(key, now) {
  recent = recent.filter((t) => now - t < 60 * 1000);
  if (recent.length >= GLOBAL_LIMIT_PER_MIN) return false;
  const last = lastByKey.get(key) || 0;
  if (now - last < NAME_COOLDOWN_MS) return false;
  lastByKey.set(key, now);
  recent.push(now);
  return true;
}

setInterval(() => {
  const now = Date.now();
  for (const [k, t] of lastByKey) if (now - t > 60 * 1000) lastByKey.delete(k);
}, 60 * 1000).unref();

// ------------------------------------------------------------------ HTTP
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(body);
}

function handlePost(req, res) {
  let size = 0;
  let tooBig = false;
  const chunks = [];

  req.on('data', (c) => {
    if (tooBig) return;
    size += c.length;
    if (size > MAX_BODY) {
      tooBig = true;
      sendJson(res, 413, { ok: false, msg: '요청이 너무 커요.' });
      req.destroy();
      return;
    }
    chunks.push(c);
  });

  req.on('end', () => {
    if (tooBig) return;
    let body;
    try {
      body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      return sendJson(res, 400, { ok: false, msg: '요청 형식이 올바르지 않아요.' });
    }
    if (!body || typeof body !== 'object') return sendJson(res, 400, { ok: false, msg: '요청 형식이 올바르지 않아요.' });

    const name = cleanName(body.name);
    const score = body.score;
    const duration = body.duration;

    if (!name) return sendJson(res, 400, { ok: false, msg: '이름을 입력해 주세요.' });
    if (!Number.isInteger(score) || score < 1 || score > MAX_SCORE)
      return sendJson(res, 400, { ok: false, msg: '점수는 1점 이상이어야 등록할 수 있어요.' });
    if (typeof duration !== 'number' || !Number.isFinite(duration) || duration < 1 || duration > MAX_DURATION)
      return sendJson(res, 400, { ok: false, msg: '플레이 시간이 올바르지 않아요.' });
    // 시간에 비해 말도 안 되게 높은 점수는 거절
    if (score > duration * MAX_DODGE_PER_SEC + 3)
      return sendJson(res, 400, { ok: false, msg: '점수가 플레이 시간에 비해 너무 높아서 등록할 수 없어요.' });

    const ip = req.socket.remoteAddress || '';
    if (!allowPost(`${ip}|${name}`, Date.now()))
      return sendJson(res, 429, { ok: false, msg: '잠시 후에 다시 등록해 주세요.' });

    const entry = { name, score, at: Date.now() };
    scores.push(entry);
    scores.sort((a, b) => b.score - a.score || a.at - b.at);
    scores = scores.slice(0, KEEP);
    saveScores();

    const idx = scores.indexOf(entry);
    sendJson(res, 200, { ok: true, rank: idx >= 0 ? idx + 1 : null, scores: top() });
  });
}

const server = http.createServer((req, res) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    res.writeHead(400);
    return res.end('Bad request');
  }

  if (pathname === '/api/scores') {
    if (req.method === 'GET') return sendJson(res, 200, { scores: top() });
    if (req.method === 'POST') return handlePost(req, res);
    res.setHeader('Allow', 'GET, POST');
    return sendJson(res, 405, { ok: false, msg: '지원하지 않는 요청이에요.' });
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405);
    return res.end();
  }
  if (pathname === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    return res.end('ok');
  }
  if (pathname === '/') pathname = '/index.html';

  const filePath = path.join(PUBLIC_DIR, pathname);
  if (!filePath.startsWith(PUBLIC_DIR + path.sep)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }
  fs.readFile(filePath, (e, data) => {
    if (e) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Not found');
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(req.method === 'HEAD' ? undefined : data);
  });
});

if (require.main === module) {
  server.listen(PORT, HOST, () => {
    console.log(`\n💩 똥 피하기 서버 실행 중 (포트 ${PORT})`);
    console.log(`   이 컴퓨터에서:  http://localhost:${PORT}`);
    for (const list of Object.values(os.networkInterfaces())) {
      for (const ni of list || []) {
        if (ni.family === 'IPv4' && !ni.internal) console.log(`   (WSL 내부 주소) http://${ni.address}:${PORT}`);
      }
    }
    console.log(`   랭킹 파일:      ${SCORE_FILE}`);
    console.log('   종료: Ctrl+C\n');
  });
  server.on('error', (e) => {
    if (e.code === 'EADDRINUSE') console.error(`\n포트 ${PORT} 는 이미 사용 중이에요. 다른 창에서 이 서버가 켜져 있는지 확인하세요.\n`);
    else console.error(e);
    process.exit(1);
  });
  process.on('SIGINT', () => process.exit(0));
  process.on('SIGTERM', () => process.exit(0));
}

module.exports = { server };
