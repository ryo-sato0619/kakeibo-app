import { api } from '../lib/client.js';
import { currentMonth, formatSignedYen, formatYen, monthLabel, percentLabel } from '../lib/format.js';
import { KIND_LABEL } from '../lib/labels.js';
import { hrefFor } from '../lib/route.js';
import { useResource } from '../state/useResource.js';
import { Card, Empty, ErrorBanner, Loading, ProgressBar, SectionTitle, amountTone, cx } from '../components/ui.jsx';

export default function Home() {
  const month = currentMonth();
  const summary = useResource(() => api.get('/api/summary'));
  const goals = useResource(() => api.get('/api/savings'));
  const report = useResource(() => api.get('/api/reports/monthly', { month }), [month]);
  const s = summary.data;
  const error = summary.error || goals.error || report.error;
  const retry = () => {
    summary.reload();
    goals.reload();
    report.reload();
  };

  return (
    <div>
      <ErrorBanner error={error} onRetry={retry} />
      {!s ? (
        !error && <Loading />
      ) : (
        <>
          <Card className="p-5">
            <p className="text-sm text-slate-500">使えるお金</p>
            <p className={cx('mt-1 text-3xl font-bold tracking-tight', s.available < 0 ? 'text-rose-600' : 'text-slate-900')}>{formatYen(s.available)}</p>
            <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-slate-100 pt-4 text-sm">
              <div>
                <dt className="text-slate-500">総資産</dt>
                <dd className="font-semibold">{formatYen(s.totalAssets)}</dd>
              </div>
              <div>
                <dt className="text-slate-500">貯金の割当合計</dt>
                <dd className="font-semibold">{formatYen(s.savingsAllocated)}</dd>
              </div>
            </dl>
          </Card>

          {s.isOverAllocated && (
            <div role="alert" className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              貯金の割当が総資産を超えています。{' '}
              <a className="font-medium underline" href={hrefFor('savings')}>
                貯金の割当を見直してください
              </a>
            </div>
          )}

          <SectionTitle
            action={
              <a href={hrefFor('reports')} className="text-sm text-indigo-600">
                レポートを見る
              </a>
            }
          >
            {monthLabel(month)}の収支
          </SectionTitle>
          <Card className="grid grid-cols-3 divide-x divide-slate-100 py-3 text-center">
            <div>
              <p className="text-xs text-slate-500">収入</p>
              <p className="font-semibold text-emerald-600">{formatYen(report.data ? report.data.income : 0)}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500">支出</p>
              <p className="font-semibold text-rose-600">{formatYen(report.data ? report.data.expense : 0)}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500">収支</p>
              <p className={cx('font-semibold', report.data && report.data.net < 0 ? 'text-rose-600' : 'text-slate-900')}>
                {formatSignedYen(report.data ? report.data.net : 0)}
              </p>
            </div>
          </Card>

          <SectionTitle
            action={
              <a href={hrefFor('accounts')} className="text-sm text-indigo-600">
                口座を管理
              </a>
            }
          >
            口座
          </SectionTitle>
          {s.accounts.length === 0 ? (
            <Empty>口座がまだありません。「口座」から追加してください。</Empty>
          ) : (
            <Card className="divide-y divide-slate-100">
              {s.accounts.map((a) => (
                <div key={a.id} className="flex items-center justify-between px-4 py-3">
                  <div>
                    <p className="font-medium">{a.name}</p>
                    <p className="text-xs text-slate-500">{KIND_LABEL[a.kind]}</p>
                  </div>
                  <p className={cx('font-semibold', amountTone(a.balance))}>{formatYen(a.balance)}</p>
                </div>
              ))}
            </Card>
          )}

          {goals.data && goals.data.length > 0 && (
            <>
              <SectionTitle
                action={
                  <a href={hrefFor('savings')} className="text-sm text-indigo-600">
                    貯金を管理
                  </a>
                }
              >
                貯金
              </SectionTitle>
              <Card className="divide-y divide-slate-100">
                {goals.data.map((g) => (
                  <div key={g.id} className="px-4 py-3">
                    <div className="mb-1.5 flex items-center justify-between">
                      <p className="font-medium">{g.name}</p>
                      <p className="text-sm text-slate-600">
                        {formatYen(g.allocatedAmount)}
                        {g.targetAmount > 0 && <span className="text-slate-400"> / {formatYen(g.targetAmount)}</span>}
                      </p>
                    </div>
                    <ProgressBar rate={g.progressRate} />
                    {g.progressRate !== null && <p className="mt-1 text-right text-xs text-slate-500">{percentLabel(g.progressRate)}</p>}
                  </div>
                ))}
              </Card>
            </>
          )}
        </>
      )}
    </div>
  );
}
