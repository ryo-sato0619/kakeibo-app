import { useMemo, useState } from 'react';
import { api } from '../lib/client.js';
import { addMonths, currentMonth, formatDateLabel, formatYen, monthLabel } from '../lib/format.js';
import { useApp } from '../state/AppContext.jsx';
import { useResource } from '../state/useResource.js';
import Switcher from '../components/Switcher.jsx';
import { Badge, Card, Empty, ErrorBanner, Loading } from '../components/ui.jsx';

const sum = (list) => list.reduce((total, t) => total + t.amount, 0);

function TxRow({ t, onClick }) {
  const isTransfer = t.type === 'transfer';
  const title = isTransfer ? `${t.accountName} → ${t.toAccountName}` : t.categoryName;
  const sign = t.type === 'income' ? '+' : t.type === 'expense' ? '-' : '';
  const tone = t.type === 'income' ? 'text-emerald-600' : t.type === 'expense' ? 'text-rose-600' : 'text-slate-500';
  return (
    <button type="button" onClick={onClick} className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-slate-50">
      <div className="min-w-0">
        <p className="truncate font-medium">
          {title} {t.savingsGoalId ? <Badge tone="indigo">貯金から</Badge> : null}
        </p>
        <p className="truncate text-xs text-slate-500">
          {isTransfer ? '振替' : t.accountName}
          {t.memo ? ` ・ ${t.memo}` : ''}
        </p>
      </div>
      <p className={`shrink-0 font-semibold ${tone}`}>
        {sign}
        {formatYen(t.amount)}
      </p>
    </button>
  );
}

export default function History() {
  const { openTxForm } = useApp();
  const [month, setMonth] = useState(currentMonth());
  const list = useResource(() => api.get('/api/transactions', { month }), [month]);
  const rows = useMemo(() => list.data || [], [list.data]);

  const income = useMemo(() => sum(rows.filter((t) => t.type === 'income')), [rows]);
  const expense = useMemo(() => sum(rows.filter((t) => t.type === 'expense')), [rows]);
  const groups = useMemo(() => {
    const map = new Map();
    for (const t of rows) {
      if (!map.has(t.date)) map.set(t.date, []);
      map.get(t.date).push(t);
    }
    return [...map.entries()];
  }, [rows]);

  return (
    <div>
      <Switcher label={monthLabel(month)} onPrev={() => setMonth(addMonths(month, -1))} onNext={() => setMonth(addMonths(month, 1))} prevLabel="前の月" nextLabel="次の月" />
      <ErrorBanner error={list.error} onRetry={list.reload} />

      {list.loading && !list.data ? (
        <Loading />
      ) : (
        list.data && (
          <>
            <Card className="mb-4 grid grid-cols-2 divide-x divide-slate-100 py-3 text-center">
              <div>
                <p className="text-xs text-slate-500">収入</p>
                <p className="font-semibold text-emerald-600">{formatYen(income)}</p>
              </div>
              <div>
                <p className="text-xs text-slate-500">支出</p>
                <p className="font-semibold text-rose-600">{formatYen(expense)}</p>
              </div>
            </Card>

            {groups.length === 0 ? (
              <Empty>この月の取引はありません。</Empty>
            ) : (
              groups.map(([date, items]) => (
                <section key={date} className="mb-4">
                  <h2 className="mb-1 px-1 text-xs font-semibold text-slate-500">{formatDateLabel(date)}</h2>
                  <Card className="divide-y divide-slate-100 overflow-hidden">
                    {items.map((t) => (
                      <TxRow key={t.id} t={t} onClick={() => openTxForm({ transaction: t })} />
                    ))}
                  </Card>
                </section>
              ))
            )}
            {groups.length > 0 && <p className="text-center text-xs text-slate-400">行をタップすると編集・削除できます（振替は収支に含めません）</p>}
          </>
        )
      )}
    </div>
  );
}
