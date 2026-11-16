import { useMemo, useState } from 'react';
import { api } from '../lib/client.js';
import { formatDateLabel, formatSignedYen, formatYen, percentLabel, toDateString } from '../lib/format.js';
import {
  MAX_AMOUNT,
  buildTransactionPayload,
  parseAmountInput,
  validateAmount,
  validateMemo,
  validateName,
  validateTransactionForm,
} from '../lib/validate.js';
import { useApp } from '../state/AppContext.jsx';
import { useResource } from '../state/useResource.js';
import { Badge, Button, Card, Empty, ErrorBanner, Field, Input, Loading, Modal, ProgressBar, Segmented, Select, cx } from '../components/ui.jsx';

/** 保存・削除などの共通処理：二重送信の防止、エラー表示、完了後の再取得 */
function useAction(onClose) {
  const { notify, bump } = useApp();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  async function run(task, message) {
    setBusy(true);
    setError(null);
    try {
      await task();
      notify(message);
      bump();
      onClose();
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  }
  return { busy, error, run };
}

function GoalModal({ goal, onClose }) {
  const isEdit = Boolean(goal);
  const [name, setName] = useState(goal ? goal.name : '');
  const [target, setTarget] = useState(goal ? String(goal.targetAmount) : '0');
  const [errors, setErrors] = useState({});
  const { busy, error, run } = useAction(onClose);

  function submit(e) {
    e.preventDefault();
    const found = {};
    const nameError = validateName(name, '貯金の名前');
    if (nameError) found.name = nameError;
    const targetNumber = parseAmountInput(target === '' ? '0' : target);
    if (targetNumber === null || targetNumber > MAX_AMOUNT) found.target = '目標金額は 0〜99,999,999 の整数で入力してください（0 は目標なし）';
    setErrors(found);
    if (Object.keys(found).length) return;
    const body = { name: name.trim(), targetAmount: targetNumber };
    run(() => (isEdit ? api.put(`/api/savings/${goal.id}`, body) : api.post('/api/savings', body)), isEdit ? '更新しました' : '貯金を追加しました');
  }

  return (
    <Modal title={isEdit ? '貯金を編集' : '貯金を追加'} onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <Field label="貯金の名前" htmlFor="goal-name" error={errors.name}>
          <Input id="goal-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={50} autoFocus invalid={Boolean(errors.name)} placeholder="例：旅行、緊急資金" />
        </Field>
        <Field label="目標金額（円）" htmlFor="goal-target" error={errors.target} hint="0 のままだと目標なし（進捗率は表示されません）">
          <Input id="goal-target" inputMode="numeric" value={target} onChange={(e) => setTarget(e.target.value)} invalid={Boolean(errors.target)} />
        </Field>
        <ErrorBanner error={error} />
        <Button type="submit" size="lg" className="w-full" disabled={busy}>
          {busy ? '保存中…' : isEdit ? '更新する' : '追加する'}
        </Button>
      </form>
    </Modal>
  );
}

function AllocateModal({ goal, onClose }) {
  const [mode, setMode] = useState('allocate');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(toDateString());
  const [memo, setMemo] = useState('');
  const [errors, setErrors] = useState({});
  const { busy, error, run } = useAction(onClose);

  function submit(e) {
    e.preventDefault();
    const found = {};
    const amountError = validateAmount(amount);
    if (amountError) found.amount = amountError;
    else if (mode === 'release' && parseAmountInput(amount) > goal.allocatedAmount) {
      found.amount = `解除できるのは現在の割当額（${formatYen(goal.allocatedAmount)}）までです`;
    }
    const memoError = validateMemo(memo);
    if (memoError) found.memo = memoError;
    if (!date) found.date = '日付を入力してください';
    setErrors(found);
    if (Object.keys(found).length) return;
    const n = parseAmountInput(amount);
    run(
      () => api.post(`/api/savings/${goal.id}/allocations`, { amount: mode === 'release' ? -n : n, date, memo: memo.trim() || null }),
      mode === 'release' ? '解除しました' : '割り当てました',
    );
  }

  return (
    <Modal title={`${goal.name}：割当・解除`} onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <p className="mb-3 text-sm text-slate-600">
          現在の割当額 <span className="font-semibold">{formatYen(goal.allocatedAmount)}</span>
        </p>
        <div className="mb-4">
          <Segmented
            value={mode}
            onChange={setMode}
            options={[
              { value: 'allocate', label: '割り当てる', activeClass: 'bg-indigo-600 text-white shadow-sm' },
              { value: 'release', label: '解除する', activeClass: 'bg-slate-700 text-white shadow-sm' },
            ]}
          />
          <p className="mt-1 text-xs text-slate-500">{mode === 'allocate' ? '使えるお金から、この貯金に取り分けます。' : 'この貯金から、使えるお金に戻します。'}</p>
        </div>
        <Field label="金額（円）" htmlFor="alloc-amount" error={errors.amount}>
          <Input id="alloc-amount" inputMode="numeric" autoComplete="off" placeholder="0" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus invalid={Boolean(errors.amount)} />
        </Field>
        <Field label="日付" htmlFor="alloc-date" error={errors.date}>
          <Input id="alloc-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="メモ（任意）" htmlFor="alloc-memo" error={errors.memo}>
          <Input id="alloc-memo" value={memo} onChange={(e) => setMemo(e.target.value)} maxLength={200} />
        </Field>
        <ErrorBanner error={error} />
        <Button type="submit" size="lg" className="w-full" disabled={busy}>
          {busy ? '保存中…' : mode === 'release' ? '解除する' : '割り当てる'}
        </Button>
      </form>
    </Modal>
  );
}

function SpendModal({ goal, onClose }) {
  const { masters } = useApp();
  const [v, setV] = useState({
    type: 'expense',
    date: toDateString(),
    amount: '',
    accountId: String(masters.accounts[0] ? masters.accounts[0].id : ''),
    toAccountId: '',
    categoryId: '',
    memo: '',
  });
  const [errors, setErrors] = useState({});
  const { busy, error, run } = useAction(onClose);
  const set = (key) => (e) => setV((prev) => ({ ...prev, [key]: e.target.value }));
  const categories = useMemo(() => masters.categories.filter((c) => c.type === 'expense'), [masters.categories]);

  function submit(e) {
    e.preventDefault();
    const found = validateTransactionForm(v);
    if (!found.amount && parseAmountInput(v.amount) > goal.allocatedAmount) {
      found.amount = `この貯金の割当額（${formatYen(goal.allocatedAmount)}）を超えています`;
    }
    setErrors(found);
    if (Object.keys(found).length) return;
    run(() => api.post(`/api/savings/${goal.id}/spend`, buildTransactionPayload(v)), '貯金から支払いました');
  }

  return (
    <Modal title={`${goal.name}で支払う`} onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <p className="mb-3 text-sm text-slate-600">
          出金として登録し、同じ金額をこの貯金の割当から外します（現在 <span className="font-semibold">{formatYen(goal.allocatedAmount)}</span>）。
        </p>
        <Field label="金額（円）" htmlFor="spend-amount" error={errors.amount}>
          <Input id="spend-amount" inputMode="numeric" autoComplete="off" placeholder="0" value={v.amount} onChange={set('amount')} autoFocus invalid={Boolean(errors.amount)} />
        </Field>
        <Field label="日付" htmlFor="spend-date" error={errors.date}>
          <Input id="spend-date" type="date" value={v.date} onChange={set('date')} invalid={Boolean(errors.date)} />
        </Field>
        <Field label="支払った口座" htmlFor="spend-account" error={errors.accountId}>
          <Select id="spend-account" value={v.accountId} onChange={set('accountId')} invalid={Boolean(errors.accountId)}>
            <option value="">選択してください</option>
            {masters.accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="カテゴリ" htmlFor="spend-category" error={errors.categoryId}>
          <Select id="spend-category" value={v.categoryId} onChange={set('categoryId')} invalid={Boolean(errors.categoryId)}>
            <option value="">選択してください</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="メモ（任意）" htmlFor="spend-memo" error={errors.memo}>
          <Input id="spend-memo" value={v.memo} onChange={set('memo')} maxLength={200} />
        </Field>
        <ErrorBanner error={error} />
        <Button type="submit" size="lg" className="w-full" disabled={busy}>
          {busy ? '登録中…' : 'この貯金で支払う'}
        </Button>
      </form>
    </Modal>
  );
}

function HistoryModal({ goal, onClose }) {
  const list = useResource(() => api.get(`/api/savings/${goal.id}/allocations`), [goal.id]);
  return (
    <Modal title={`${goal.name}：割当の履歴`} onClose={onClose}>
      <ErrorBanner error={list.error} onRetry={list.reload} />
      {list.loading && !list.data ? (
        <Loading />
      ) : list.data && list.data.length === 0 ? (
        <Empty>履歴はありません。</Empty>
      ) : (
        list.data && (
          <ul className="divide-y divide-slate-100">
            {list.data.map((x) => (
              <li key={x.id} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <p className="text-sm">
                    {formatDateLabel(x.date)} {x.transactionId ? <Badge tone="indigo">支払い</Badge> : null}
                  </p>
                  {x.memo && <p className="truncate text-xs text-slate-500">{x.memo}</p>}
                </div>
                <p className={cx('shrink-0 font-semibold', x.amount < 0 ? 'text-slate-500' : 'text-indigo-600')}>{formatSignedYen(x.amount)}</p>
              </li>
            ))}
          </ul>
        )
      )}
    </Modal>
  );
}

export default function Savings() {
  const { notify, bump } = useApp();
  const list = useResource(() => api.get('/api/savings'));
  const [modal, setModal] = useState(null); // { kind: 'goal' | 'allocate' | 'spend' | 'history', goal? }
  const [actionError, setActionError] = useState(null);
  const close = () => setModal(null);

  async function archive(goal) {
    setActionError(null);
    const rest = goal.allocatedAmount > 0 ? `\n残っている割当額 ${formatYen(goal.allocatedAmount)} は、使えるお金に戻ります。` : '';
    if (!window.confirm(`「${goal.name}」をアーカイブしますか？${rest}`)) return;
    try {
      await api.del(`/api/savings/${goal.id}`);
      notify('アーカイブしました');
      bump();
    } catch (error) {
      setActionError(error);
    }
  }

  return (
    <div>
      <div className="mb-4 flex justify-end">
        <Button onClick={() => setModal({ kind: 'goal' })}>＋ 貯金を追加</Button>
      </div>
      <ErrorBanner error={list.error || actionError} onRetry={actionError ? undefined : list.reload} />
      {list.loading && !list.data ? (
        <Loading />
      ) : list.data && list.data.length === 0 ? (
        <Empty>貯金の目的がまだありません。「貯金を追加」から作成してください。</Empty>
      ) : (
        list.data &&
        list.data.map((g) => (
          <Card key={g.id} className="mb-3 p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate font-semibold">{g.name}</p>
                <p className="mt-0.5 text-sm text-slate-600">
                  <span className="text-lg font-bold text-slate-900">{formatYen(g.allocatedAmount)}</span>
                  {g.targetAmount > 0 && <span className="text-slate-400"> / {formatYen(g.targetAmount)}</span>}
                </p>
              </div>
              {g.progressRate !== null && <p className="text-lg font-bold text-indigo-600">{percentLabel(g.progressRate)}</p>}
            </div>
            <div className="mt-2">
              <ProgressBar rate={g.progressRate} />
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button size="sm" onClick={() => setModal({ kind: 'allocate', goal: g })}>
                割当・解除
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setModal({ kind: 'spend', goal: g })} disabled={g.allocatedAmount <= 0}>
                この貯金で支払う
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setModal({ kind: 'history', goal: g })}>
                履歴
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setModal({ kind: 'goal', goal: g })}>
                編集
              </Button>
              <Button size="sm" variant="ghost" className="text-rose-600" onClick={() => archive(g)}>
                アーカイブ
              </Button>
            </div>
          </Card>
        ))
      )}
      {modal && modal.kind === 'goal' && <GoalModal goal={modal.goal} onClose={close} />}
      {modal && modal.kind === 'allocate' && <AllocateModal goal={modal.goal} onClose={close} />}
      {modal && modal.kind === 'spend' && <SpendModal goal={modal.goal} onClose={close} />}
      {modal && modal.kind === 'history' && <HistoryModal goal={modal.goal} onClose={close} />}
    </div>
  );
}
