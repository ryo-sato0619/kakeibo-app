import { useMemo, useState } from 'react';
import { useApp } from '../state/AppContext.jsx';
import { api } from '../lib/client.js';
import { formatYen, toDateString } from '../lib/format.js';
import { buildTransactionPayload, parseAmountInput, validateTransactionForm } from '../lib/validate.js';
import { Button, ErrorBanner, Field, Input, Modal, Segmented, Select } from './ui.jsx';

const TYPES = [
  { value: 'expense', label: '出金', activeClass: 'bg-rose-600 text-white shadow-sm' },
  { value: 'income', label: '入金', activeClass: 'bg-emerald-600 text-white shadow-sm' },
  { value: 'transfer', label: '振替', activeClass: 'bg-slate-700 text-white shadow-sm' },
];

/** 入金・出金・振替の登録／編集フォーム。transaction を渡すと編集モード。 */
export default function TransactionForm({ transaction, defaults, onClose }) {
  const { masters, notify, bump } = useApp();
  const isEdit = Boolean(transaction);
  // 「この貯金で支払う」で登録した取引は、金額と種別を変えられない
  const locked = Boolean(transaction && transaction.savingsGoalId);

  const [v, setV] = useState(() => ({
    type: transaction?.type ?? defaults?.type ?? 'expense',
    date: transaction?.date ?? defaults?.date ?? toDateString(),
    amount: transaction ? String(transaction.amount) : '',
    accountId: transaction ? String(transaction.accountId) : String(masters.accounts[0]?.id ?? ''),
    toAccountId: transaction?.toAccountId ? String(transaction.toAccountId) : '',
    categoryId: transaction?.categoryId ? String(transaction.categoryId) : '',
    memo: transaction?.memo ?? '',
  }));
  const [errors, setErrors] = useState({});
  const [apiError, setApiError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const set = (key) => (e) => setV((prev) => ({ ...prev, [key]: e.target.value }));
  const setType = (type) => setV((prev) => ({ ...prev, type, categoryId: type === prev.type ? prev.categoryId : '' }));

  // 編集中の取引が使っているアーカイブ済みの口座・カテゴリも、選択肢に残す
  const accountOptions = useMemo(() => {
    const list = masters.accounts.map((a) => ({ id: a.id, name: a.name }));
    const keep = (id, name) => {
      if (id && !list.some((a) => a.id === id)) list.push({ id, name: `${name}（アーカイブ済み）` });
    };
    if (transaction) {
      keep(transaction.accountId, transaction.accountName);
      keep(transaction.toAccountId, transaction.toAccountName);
    }
    return list;
  }, [masters.accounts, transaction]);

  const categoryOptions = useMemo(() => {
    const list = masters.categories.filter((c) => c.type === v.type).map((c) => ({ id: c.id, name: c.name }));
    if (transaction?.categoryId && transaction.type === v.type && !list.some((c) => c.id === transaction.categoryId)) {
      list.push({ id: transaction.categoryId, name: `${transaction.categoryName}（削除済み）` });
    }
    return list;
  }, [masters.categories, transaction, v.type]);

  const amountNumber = parseAmountInput(v.amount);

  async function submit(e) {
    e.preventDefault();
    const found = validateTransactionForm(v);
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    setSubmitting(true);
    setApiError(null);
    try {
      const payload = buildTransactionPayload(v);
      if (isEdit) await api.put(`/api/transactions/${transaction.id}`, payload);
      else await api.post('/api/transactions', payload);
      notify(isEdit ? '更新しました' : '登録しました');
      bump();
      onClose();
    } catch (error) {
      setApiError(error);
      setSubmitting(false);
    }
  }

  async function remove() {
    const note = locked ? '\n（この貯金で支払った取引です。割当解除も取り消され、貯金の割当額が元に戻ります）' : '';
    if (!window.confirm(`この取引を削除しますか？${note}`)) return;
    setSubmitting(true);
    setApiError(null);
    try {
      await api.del(`/api/transactions/${transaction.id}`);
      notify('削除しました');
      bump();
      onClose();
    } catch (error) {
      setApiError(error);
      setSubmitting(false);
    }
  }

  return (
    <Modal title={isEdit ? '取引を編集' : '取引を入力'} onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <div className="mb-4">
          <Segmented options={TYPES} value={v.type} onChange={setType} disabled={locked} />
          {locked && <p className="mt-1 text-xs text-slate-500">貯金から支払った取引は、種別と金額を変更できません。</p>}
          {errors.type && <p className="mt-1 text-xs text-rose-600">{errors.type}</p>}
        </div>

        <Field label="日付" htmlFor="tx-date" error={errors.date}>
          <Input id="tx-date" type="date" value={v.date} onChange={set('date')} invalid={Boolean(errors.date)} />
        </Field>

        <Field
          label="金額（円）"
          htmlFor="tx-amount"
          error={errors.amount}
          hint={amountNumber !== null && amountNumber > 0 ? formatYen(amountNumber) : undefined}
        >
          <Input
            id="tx-amount"
            inputMode="numeric"
            autoComplete="off"
            placeholder="0"
            value={v.amount}
            onChange={set('amount')}
            disabled={locked}
            invalid={Boolean(errors.amount)}
            autoFocus={!isEdit}
          />
        </Field>

        <Field label={v.type === 'transfer' ? '振替元の口座' : '口座'} htmlFor="tx-account" error={errors.accountId}>
          <Select id="tx-account" value={v.accountId} onChange={set('accountId')} invalid={Boolean(errors.accountId)}>
            <option value="">選択してください</option>
            {accountOptions.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </Select>
        </Field>

        {v.type === 'transfer' ? (
          <Field label="振替先の口座" htmlFor="tx-to-account" error={errors.toAccountId}>
            <Select id="tx-to-account" value={v.toAccountId} onChange={set('toAccountId')} invalid={Boolean(errors.toAccountId)}>
              <option value="">選択してください</option>
              {accountOptions
                .filter((a) => String(a.id) !== v.accountId)
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
            </Select>
          </Field>
        ) : (
          <Field label="カテゴリ" htmlFor="tx-category" error={errors.categoryId}>
            <Select id="tx-category" value={v.categoryId} onChange={set('categoryId')} invalid={Boolean(errors.categoryId)}>
              <option value="">選択してください</option>
              {categoryOptions.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
        )}

        <Field label="メモ（任意）" htmlFor="tx-memo" error={errors.memo}>
          <Input id="tx-memo" value={v.memo} onChange={set('memo')} maxLength={200} invalid={Boolean(errors.memo)} />
        </Field>

        <ErrorBanner error={apiError} />

        <div className="flex gap-3">
          {isEdit && (
            <Button variant="dangerOutline" size="lg" onClick={remove} disabled={submitting}>
              削除
            </Button>
          )}
          <Button type="submit" size="lg" className="flex-1" disabled={submitting}>
            {submitting ? '保存中…' : isEdit ? '更新する' : '登録する'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
