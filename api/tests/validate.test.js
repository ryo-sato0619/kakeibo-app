'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const v = require('../src/lib/validate');
const { isValidDateString, todayJst, formatJstDateTime } = require('../src/lib/dates');

const rejects = (fn) => assert.throws(fn, (e) => e.status === 400 && e.code === 'VALIDATION_ERROR');

describe('金額の検証', () => {
  it('1 〜 99,999,999 の整数だけを受け付ける', () => {
    assert.equal(v.parseAmount(1), 1);
    assert.equal(v.parseAmount(99999999), 99999999);
    rejects(() => v.parseAmount(0));
    rejects(() => v.parseAmount(100000000));
    rejects(() => v.parseAmount(-5));
    rejects(() => v.parseAmount(1.5));
    rejects(() => v.parseAmount('100'));
    rejects(() => v.parseAmount(undefined));
  });

  it('割当・解除の金額は 0 以外の整数（正負どちらも可）', () => {
    assert.equal(v.parseSignedAmount(500), 500);
    assert.equal(v.parseSignedAmount(-500), -500);
    rejects(() => v.parseSignedAmount(0));
    rejects(() => v.parseSignedAmount(100000000));
    rejects(() => v.parseSignedAmount(-100000000));
  });

  it('初期残高はマイナスも可、目標金額は 0 以上', () => {
    assert.equal(v.parseOpeningBalance(-30000), -30000);
    rejects(() => v.parseOpeningBalance(1.2));
    assert.equal(v.parseTargetAmount(0), 0);
    rejects(() => v.parseTargetAmount(-1));
  });
});

describe('日付・月・年の検証', () => {
  it('実在する YYYY-MM-DD だけを受け付ける', () => {
    assert.equal(v.parseDate('2026-11-08'), '2026-11-08');
    assert.equal(v.parseDate('2028-02-29'), '2028-02-29'); // うるう年
    rejects(() => v.parseDate('2026-02-30'));
    rejects(() => v.parseDate('2027-02-29'));
    rejects(() => v.parseDate('2026/11/08'));
    rejects(() => v.parseDate('2026-1-8'));
    rejects(() => v.parseDate(20261108));
    assert.equal(isValidDateString('2026-13-01'), false);
  });

  it('月は YYYY-MM。範囲は翌月 1 日まで（年またぎ含む）', () => {
    assert.deepEqual(v.parseMonth('2026-11'), { month: '2026-11', start: '2026-11-01', end: '2026-12-01' });
    assert.deepEqual(v.parseMonth('2026-12'), { month: '2026-12', start: '2026-12-01', end: '2027-01-01' });
    rejects(() => v.parseMonth('2026-13'));
    rejects(() => v.parseMonth('2026-00'));
    rejects(() => v.parseMonth('2026-1'));
    rejects(() => v.parseMonth(undefined));
  });

  it('年は 4 桁', () => {
    assert.equal(v.parseYear('2026'), 2026);
    rejects(() => v.parseYear('26'));
    rejects(() => v.parseYear('1800'));
  });

  it('今日（JST）は UTC から 9 時間進める', () => {
    // 2026-11-08 20:00 UTC は日本ではすでに 11/09
    assert.equal(todayJst(Date.UTC(2026, 10, 8, 20, 0, 0)), '2026-11-09');
    assert.equal(todayJst(Date.UTC(2026, 10, 8, 14, 59, 59)), '2026-11-08');
    assert.equal(formatJstDateTime(new Date(Date.UTC(2026, 10, 8, 15, 30, 5))), '2026-11-09 00:30:05');
    assert.equal(formatJstDateTime(null), '');
  });
});

describe('名称・メモ・ID の検証', () => {
  it('名称は前後の空白を除いて 1 〜 50 文字', () => {
    assert.equal(v.parseName('  食費 '), '食費');
    assert.equal(v.parseName('あ'.repeat(50)).length, 50);
    rejects(() => v.parseName('あ'.repeat(51)));
    rejects(() => v.parseName('   '));
    rejects(() => v.parseName(123));
  });

  it('メモは省略・空文字なら null、200 文字まで', () => {
    assert.equal(v.parseMemo(undefined), null);
    assert.equal(v.parseMemo(null), null);
    assert.equal(v.parseMemo('  '), null);
    assert.equal(v.parseMemo(' コンビニ '), 'コンビニ');
    assert.equal(v.parseMemo('あ'.repeat(200)).length, 200);
    rejects(() => v.parseMemo('あ'.repeat(201)));
    rejects(() => v.parseMemo(5));
  });

  it('ID は正の整数（数字文字列も可）', () => {
    assert.equal(v.parseId('12'), 12);
    assert.equal(v.parseId(7), 7);
    rejects(() => v.parseId('0'));
    rejects(() => v.parseId('-1'));
    rejects(() => v.parseId('abc'));
    rejects(() => v.parseId('1; DROP TABLE accounts'));
    rejects(() => v.parseId(1.5));
    rejects(() => v.parseId(undefined));
  });

  it('列挙値とオブジェクトの検証', () => {
    assert.equal(v.parseEnum('bank', ['bank', 'cash'], 'kind'), 'bank');
    rejects(() => v.parseEnum('wallet', ['bank', 'cash'], 'kind'));
    rejects(() => v.requireObject(null));
    rejects(() => v.requireObject([]));
    rejects(() => v.requireObject('x'));
    assert.deepEqual(v.requireObject({ a: 1 }), { a: 1 });
  });
});
