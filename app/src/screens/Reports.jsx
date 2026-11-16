import { useState } from 'react';
import { api } from '../lib/client.js';
import { addMonths, currentMonth, formatSignedYen, formatYen, monthLabel, sharePercent } from '../lib/format.js';
import { useResource } from '../state/useResource.js';
import Switcher from '../components/Switcher.jsx';
import { Card, Empty, ErrorBanner, Loading, Segmented, SectionTitle, cx } from '../components/ui.jsx';

function Totals({ income, expense, net }) {
  return (
    <Card className="mb-2 grid grid-cols-3 divide-x divide-slate-100 py-3 text-center">
      <div>
        <p className="text-xs text-slate-500">収入</p>
        <p className="font-semibold text-emerald-600">{formatYen(income)}</p>
      </div>
      <div>
        <p className="text-xs text-slate-500">支出</p>
        <p className="font-semibold text-rose-600">{formatYen(expense)}</p>
      </div>
      <div>
        <p className="text-xs text-slate-500">収支</p>
        <p className={cx('font-semibold', net < 0 ? 'text-rose-600' : 'text-slate-900')}>{formatSignedYen(net)}</p>
      </div>
    </Card>
  );
}

/** カテゴリ別の内訳（横棒グラフ） */
function Breakdown({ items, total, barClass }) {
  if (items.length === 0) return <Empty>データがありません。</Empty>;
  return (
    <Card className="divide-y divide-slate-100">
      {items.map((c) => {
        const share = sharePercent(c.amount, total);
        return (
          <div key={c.categoryId} className="px-4 py-3">
            <div className="mb-1.5 flex items-center justify-between text-sm">
              <span className="font-medium">{c.categoryName}</span>
              <span>
                <span className="font-semibold">{formatYen(c.amount)}</span> <span className="text-xs text-slate-400">{share}%</span>
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-slate-100">
              <div className={cx('h-full rounded-full', barClass)} style={{ width: `${share}%` }} />
            </div>
          </div>
        );
      })}
    </Card>
  );
}

function Monthly() {
  const [month, setMonth] = useState(currentMonth());
  const report = useResource(() => api.get('/api/reports/monthly', { month }), [month]);
  const r = report.data;
  return (
    <div>
      <Switcher label={monthLabel(month)} onPrev={() => setMonth(addMonths(month, -1))} onNext={() => setMonth(addMonths(month, 1))} prevLabel="前の月" nextLabel="次の月" />
      <ErrorBanner error={report.error} onRetry={report.reload} />
      {report.loading && !r ? (
        <Loading />
      ) : (
        r && (
          <>
            <Totals income={r.income} expense={r.expense} net={r.net} />
            <p className="mb-1 text-right text-xs text-slate-400">振替は含めません</p>
            <SectionTitle>支出のカテゴリ別</SectionTitle>
            <Breakdown items={r.expenseByCategory} total={r.expense} barClass="bg-rose-400" />
            <SectionTitle>収入のカテゴリ別</SectionTitle>
            <Breakdown items={r.incomeByCategory} total={r.income} barClass="bg-emerald-400" />
          </>
        )
      )}
    </div>
  );
}

function Yearly() {
  const [year, setYear] = useState(Number(currentMonth().slice(0, 4)));
  const report = useResource(() => api.get('/api/reports/yearly', { year }), [year]);
  const r = report.data;
  const max = r ? Math.max(1, ...r.months.map((m) => Math.max(m.income, m.expense))) : 1;
  return (
    <div>
      <Switcher label={`${year}年`} onPrev={() => setYear(year - 1)} onNext={() => setYear(year + 1)} prevLabel="前の年" nextLabel="次の年" />
      <ErrorBanner error={report.error} onRetry={report.reload} />
      {report.loading && !r ? (
        <Loading />
      ) : (
        r && (
          <>
            <Totals income={r.income} expense={r.expense} net={r.net} />
            <SectionTitle>月ごとの推移</SectionTitle>
            <Card className="divide-y divide-slate-100">
              {r.months.map((m) => (
                <div key={m.month} className="px-4 py-3">
                  <div className="mb-1.5 flex items-center justify-between text-sm">
                    <span className="font-medium">{Number(m.month.slice(5))}月</span>
                    <span className={cx('font-semibold', m.net < 0 ? 'text-rose-600' : 'text-slate-900')}>{formatSignedYen(m.net)}</span>
                  </div>
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <div className="h-2 rounded-full bg-emerald-400" style={{ width: `${(m.income / max) * 100}%` }} />
                      <span className="text-xs text-slate-500">{m.income > 0 ? formatYen(m.income) : ''}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="h-2 rounded-full bg-rose-400" style={{ width: `${(m.expense / max) * 100}%` }} />
                      <span className="text-xs text-slate-500">{m.expense > 0 ? formatYen(m.expense) : ''}</span>
                    </div>
                  </div>
                </div>
              ))}
            </Card>
            <p className="mt-2 text-xs text-slate-400">緑：収入　赤：支出（振替は含めません）</p>
          </>
        )
      )}
    </div>
  );
}

export default function Reports() {
  const [tab, setTab] = useState('monthly');
  return (
    <div>
      <div className="mb-4">
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: 'monthly', label: '月次' },
            { value: 'yearly', label: '年次' },
          ]}
        />
      </div>
      {tab === 'monthly' ? <Monthly /> : <Yearly />}
    </div>
  );
}
