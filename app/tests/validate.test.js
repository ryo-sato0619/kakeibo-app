import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseAmountInput, validateAmount, validateName, validateMemo, validateTransactionForm, buildTransactionPayload,
} from '../src/lib/validate.js';

const valid = { type: 'expense', date: '2026-11-08', amount: '1,200', accountId: '1', toAccountId: '', categoryId: '3', memo: '' };

describe('金額の入力', () => {
  it('カンマ・空白・円記号・全角数字を受け付ける', () => {
    assert.equal(parseAmountInput('1,200'), 1200);
    assert.equal(parseAmountInput(' ¥3500円 '), 3500);
    assert.equal(parseAmountInput('１２３４'), 1234);
    assert.equal(parseAmountInput('１，２００'), 1200);
  });

  it('小数・文字・空は null', () => {
    assert.equal(parseAmountInput('12.5'), null);
    assert.equal(parseAmountInput('abc'), null);
    assert.equal(parseAmountInput(''), null);
    assert.equal(parseAmountInput('-100'), null);
    assert.equal(parseAmountInput(undefined), null);
  });

  it('マイナスを許可する入力（初期残高）', () => {
    assert.equal(parseAmountInput('-3000', { allowNegative: true }), -3000);
    assert.equal(parseAmountInput('－3,000', { allowNegative: true }), -3000);
  });

  it('範囲チェック：1〜99,999,999', () => {
    assert.equal(validateAmount('1'), null);
    assert.equal(validateAmount('99999999'), null);
    assert.match(validateAmount('0'), /1〜99,999,999/);
    assert.match(validateAmount('100000000'), /1〜99,999,999/);
    assert.match(validateAmount('x'), /整数/);
    assert.equal(validateAmount('-5000', { allowNegative: true }), null);
    assert.match(validateAmount('-100000000', { allowNegative: true }), /99,999,999/);
  });
});

describe('名称・メモ', () => {
  it('名称は 1〜50 文字', () => {
    assert.equal(validateName('食費'), null);
    assert.match(validateName('  '), /入力してください/);
    assert.match(validateName('あ'.repeat(51)), /50 文字以内/);
    assert.equal(validateName('あ'.repeat(50)), null);
  });
  it('メモは 200 文字まで', () => {
    assert.equal(validateMemo(''), null);
    assert.equal(validateMemo('あ'.repeat(200)), null);
    assert.match(validateMemo('あ'.repeat(201)), /200 文字以内/);
  });
});

describe('取引フォームの検証', () => {
  it('正しい出金は OK', () => {
    assert.deepEqual(validateTransactionForm(valid), {});
  });

  it('必須項目の不足を項目ごとに返す', () => {
    const e = validateTransactionForm({ ...valid, amount: '', accountId: '', categoryId: '', date: '' });
    assert.deepEqual(Object.keys(e).sort(), ['accountId', 'amount', 'categoryId', 'date']);
  });

  it('振替：振替先が必須で、振替元と同じ口座は不可。カテゴリは不要', () => {
    const t = { ...valid, type: 'transfer', categoryId: '' };
    assert.deepEqual(validateTransactionForm({ ...t, toAccountId: '2' }), {});
    assert.ok(validateTransactionForm({ ...t, toAccountId: '' }).toAccountId);
    assert.match(validateTransactionForm({ ...t, toAccountId: '1' }).toAccountId, /別の口座/);
  });

  it('種別が不正・日付が存在しない・メモが長いとエラー', () => {
    assert.ok(validateTransactionForm({ ...valid, type: 'refund' }).type);
    assert.ok(validateTransactionForm({ ...valid, date: '2026-02-30' }).date);
    assert.ok(validateTransactionForm({ ...valid, memo: 'あ'.repeat(201) }).memo);
  });

  it('API に送る JSON：種別ごとに必要な項目だけ、数値に変換、空メモは null', () => {
    assert.deepEqual(buildTransactionPayload(valid), {
      type: 'expense', date: '2026-11-08', amount: 1200, accountId: 1, categoryId: 3, memo: null,
    });
    assert.deepEqual(
      buildTransactionPayload({ ...valid, type: 'transfer', toAccountId: '2', categoryId: '', memo: ' 引き出し ' }),
      { type: 'transfer', date: '2026-11-08', amount: 1200, accountId: 1, toAccountId: 2, memo: '引き出し' },
    );
  });
});
