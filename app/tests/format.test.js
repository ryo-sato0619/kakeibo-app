import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  withCommas, formatYen, formatSignedYen, toDateString, currentMonth, addMonths, monthLabel,
  formatDateLabel, isValidDate, percentLabel, sharePercent,
} from '../src/lib/format.js';
import { parseHash } from '../src/lib/route.js';

describe('金額の整形', () => {
  it('3 桁区切りと符号', () => {
    assert.equal(withCommas(1234567), '1,234,567');
    assert.equal(withCommas(999), '999');
    assert.equal(formatYen(12345), '¥12,345');
    assert.equal(formatYen(-800), '-¥800');
    assert.equal(formatYen(0), '¥0');
    assert.equal(formatYen(undefined), '¥0');
    assert.equal(formatSignedYen(5000), '+¥5,000');
    assert.equal(formatSignedYen(-5000), '-¥5,000');
    assert.equal(formatSignedYen(0), '¥0');
  });

  it('進捗率と構成比', () => {
    assert.equal(percentLabel(0.256), '26%');
    assert.equal(percentLabel(1.5), '150%');
    assert.equal(percentLabel(null), '—');
    assert.equal(sharePercent(45000, 50000), 90);
    assert.equal(sharePercent(1, 3), 33.3);
    assert.equal(sharePercent(5, 0), 0);
  });
});

describe('日付の整形', () => {
  it('Date → YYYY-MM-DD / YYYY-MM（端末のローカル日付）', () => {
    assert.equal(toDateString(new Date(2026, 10, 8)), '2026-11-08');
    assert.equal(currentMonth(new Date(2026, 0, 31)), '2026-01');
  });

  it('月の加減算（年またぎ）', () => {
    assert.equal(addMonths('2026-11', 1), '2026-12');
    assert.equal(addMonths('2026-12', 1), '2027-01');
    assert.equal(addMonths('2026-01', -1), '2025-12');
    assert.equal(addMonths('2026-03', -15), '2024-12');
    assert.equal(addMonths('2026-05', 0), '2026-05');
  });

  it('表示用ラベル（曜日はタイムゾーンに左右されない）', () => {
    assert.equal(monthLabel('2026-11'), '2026年11月');
    assert.equal(formatDateLabel('2026-11-08'), '11月8日（日）');
    assert.equal(formatDateLabel('2026-11-09'), '11月9日（月）');
    assert.equal(formatDateLabel('2028-02-29'), '2月29日（火）');
  });

  it('実在する日付だけを有効とする', () => {
    assert.equal(isValidDate('2026-11-08'), true);
    assert.equal(isValidDate('2026-02-30'), false);
    assert.equal(isValidDate('2026/11/08'), false);
    assert.equal(isValidDate(''), false);
    assert.equal(isValidDate(undefined), false);
  });
});

describe('画面の切り替え（ハッシュ）', () => {
  it('既知の画面名だけを受け付け、それ以外はホーム', () => {
    assert.equal(parseHash('#/history'), 'history');
    assert.equal(parseHash('#/savings?x=1'), 'savings');
    assert.equal(parseHash('#settings'), 'settings');
    assert.equal(parseHash(''), 'home');
    assert.equal(parseHash('#/unknown'), 'home');
    assert.equal(parseHash(undefined), 'home');
  });
});
