'use strict';
/**
 * 서버/랭킹 API 테스트 (Node 18 이상, 내장 fetch 사용)
 *   node test/test.js
 */
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

// 서버를 불러오기 전에 임시 폴더를 랭킹 저장 위치로 지정 (진짜 랭킹 파일을 건드리지 않음)
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ddong-test-'));
process.env.DATA_DIR = dataDir;
const { server } = require('../server');

let base;
const get = (p) => fetch(base + p);
const post = (body, raw) =>
  fetch(base + '/api/scores', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: raw ?? JSON.stringify(body),
  });

const results = [];
async function test(name, fn) {
  try {
    await fn();
    results.push(true);
    console.log(`  ✓ ${name}`);
  } catch (e) {
    results.push(false);
    console.log(`  ✗ ${name}\n      ${String(e.stack).split('\n').slice(0, 4).join('\n      ')}`);
  }
}

async function main() {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  console.log(`\n테스트 서버: ${base}\n`);

  await test('처음에는 랭킹이 비어 있다', async () => {
    const j = await (await get('/api/scores')).json();
    assert.deepEqual(j.scores, []);
  });

  await test('정상 점수 등록 → 1위', async () => {
    const r = await post({ name: '하늘', score: 12, duration: 10 });
    const j = await r.json();
    assert.equal(r.status, 200);
    assert.equal(j.ok, true);
    assert.equal(j.rank, 1);
    assert.deepEqual(j.scores, [{ name: '하늘', score: 12 }]);
  });

  await test('점수 순으로 정렬된다 (높은 점수가 위)', async () => {
    await post({ name: '바다', score: 30, duration: 20 });
    await post({ name: '구름', score: 20, duration: 20 });
    const j = await (await get('/api/scores')).json();
    assert.deepEqual(j.scores.map((s) => s.name), ['바다', '구름', '하늘']);
  });

  await test('같은 이름 연속 등록은 막는다 (429)', async () => {
    const r = await post({ name: '하늘', score: 15, duration: 10 });
    assert.equal(r.status, 429);
  });

  await test('시간에 비해 너무 높은 점수는 거절한다 (400)', async () => {
    const r = await post({ name: '핵쟁이', score: 500, duration: 5 });
    assert.equal(r.status, 400);
  });

  await test('잘못된 입력은 거절한다 (이름 없음, 점수 0, 문자열 점수, 깨진 JSON)', async () => {
    assert.equal((await post({ name: '  ', score: 5, duration: 10 })).status, 400);
    assert.equal((await post({ name: 'a1', score: 0, duration: 10 })).status, 400);
    assert.equal((await post({ name: 'a2', score: '9999', duration: 10 })).status, 400);
    assert.equal((await post({ name: 'a3', score: 1.5, duration: 10 })).status, 400);
    assert.equal((await post(null, '{깨진')).status, 400);
  });

  await test('이름의 위험한 문자는 지워진다 / 10글자로 잘린다', async () => {
    const r = await post({ name: '<img src=x onerror=alert(1)>', score: 5, duration: 10 });
    const j = await r.json();
    assert.equal(r.status, 200);
    for (const s of j.scores) assert.ok(!/[<>&"'`]/.test(s.name), s.name);
    const r2 = await post({ name: '가나다라마바사아자차카타파하', score: 6, duration: 10 });
    const j2 = await r2.json();
    assert.ok(j2.scores.some((s) => s.name === '가나다라마바사아자차'));
  });

  await test('너무 큰 요청은 거절한다 (413)', async () => {
    const r = await post({ name: 'x'.repeat(5000), score: 5, duration: 10 }).catch(() => ({ status: 413 }));
    assert.equal(r.status, 413);
  });

  await test('랭킹이 파일(scores.json)에 저장된다', async () => {
    const file = path.join(dataDir, 'scores.json');
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.ok(saved.length >= 4);
    assert.equal(saved[0].name, '바다');
  });

  await test('게임 화면과 정적 파일, 보안', async () => {
    const r = await get('/');
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type'), /text\/html/);
    assert.equal((await get('/game.js')).status, 200);
    assert.equal((await get('/healthz')).status, 200);
    assert.equal((await get('/없는파일.html')).status, 404);
    // 폴더 밖 파일 읽기 시도
    const raw = await new Promise((resolve) => {
      require('net')
        .connect(server.address().port, '127.0.0.1')
        .on('connect', function () {
          this.write('GET /../server.js HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n');
        })
        .on('data', (d) => resolve(String(d)));
    });
    assert.match(raw.split('\r\n')[0], / (403|404) /);
    assert.ok(!raw.includes("require('http')"), '서버 코드가 노출되면 안 됨');
  });

  const failed = results.filter((x) => !x).length;
  console.log(`\n${results.length - failed}/${results.length} 통과${failed ? `, ${failed}개 실패` : ''}\n`);
  server.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
