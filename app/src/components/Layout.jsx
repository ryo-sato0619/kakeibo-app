import { useApp } from '../state/AppContext.jsx';
import { isDemo } from '../lib/client.js';
import { hrefFor } from '../lib/route.js';
import TransactionForm from './TransactionForm.jsx';
import { Button, cx } from './ui.jsx';

const NAV = [
  { name: 'home', label: 'ホーム', icon: '🏠' },
  { name: 'history', label: '履歴', icon: '🧾' },
  { name: 'accounts', label: '口座', icon: '🏦' },
  { name: 'savings', label: '貯金', icon: '🐷' },
  { name: 'reports', label: 'レポート', icon: '📊' },
  { name: 'settings', label: '設定', icon: '⚙️' },
];

export default function Layout({ route, children }) {
  const { waking, toast, txForm, openTxForm, closeTxForm } = useApp();
  const current = NAV.find((n) => n.name === route) || NAV[0];

  return (
    <div className="min-h-screen">
      {/* PC：左のサイドバー */}
      <aside className="hidden border-r border-slate-200 bg-white p-4 md:fixed md:inset-y-0 md:left-0 md:block md:w-56">
        <p className="mb-4 px-2 text-lg font-bold text-indigo-700">家計簿</p>
        <Button className="mb-4 w-full" onClick={() => openTxForm()}>
          ＋ 取引を入力
        </Button>
        <nav className="space-y-1">
          {NAV.map((n) => (
            <a
              key={n.name}
              href={hrefFor(n.name)}
              aria-current={route === n.name ? 'page' : undefined}
              className={cx(
                'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium',
                route === n.name ? 'bg-indigo-50 text-indigo-700' : 'text-slate-600 hover:bg-slate-100',
              )}
            >
              <span aria-hidden="true">{n.icon}</span>
              {n.label}
            </a>
          ))}
        </nav>
      </aside>

      <div className="pb-28 md:pb-10 md:pl-56">
        <header className="sticky top-0 z-20 flex items-center justify-between border-b border-slate-200 bg-white/90 px-4 py-3 backdrop-blur">
          <h1 className="text-lg font-bold">{current.label}</h1>
          {isDemo && <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">デモ（保存されません）</span>}
        </header>
        {waking && (
          <div role="status" className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-center text-sm text-amber-800">
            データベースを起動しています。初回は最大 1 分ほどかかります…
          </div>
        )}
        <main className="mx-auto max-w-3xl px-4 py-4">{children}</main>
      </div>

      {/* スマホ：下のタブと、入力ボタン */}
      <button
        type="button"
        onClick={() => openTxForm()}
        aria-label="取引を入力"
        className="fixed bottom-20 right-4 z-30 flex h-14 w-14 items-center justify-center rounded-full bg-indigo-600 text-3xl text-white shadow-lg hover:bg-indigo-700 md:hidden"
      >
        ＋
      </button>
      <nav className="safe-bottom fixed inset-x-0 bottom-0 z-30 grid grid-cols-6 border-t border-slate-200 bg-white md:hidden">
        {NAV.map((n) => (
          <a
            key={n.name}
            href={hrefFor(n.name)}
            aria-current={route === n.name ? 'page' : undefined}
            className={cx('flex flex-col items-center gap-0.5 py-2 text-[10px] font-medium', route === n.name ? 'text-indigo-700' : 'text-slate-500')}
          >
            <span className="text-lg leading-none" aria-hidden="true">
              {n.icon}
            </span>
            {n.label}
          </a>
        ))}
      </nav>

      {txForm && (
        <TransactionForm key={txForm.transaction ? txForm.transaction.id : 'new'} transaction={txForm.transaction} defaults={txForm.defaults} onClose={closeTxForm} />
      )}

      {toast && (
        <div
          role="status"
          className={cx(
            'fixed bottom-36 left-1/2 z-50 -translate-x-1/2 rounded-full px-5 py-2.5 text-sm font-medium text-white shadow-lg md:bottom-8',
            toast.kind === 'error' ? 'bg-rose-600' : 'bg-slate-800',
          )}
        >
          {toast.message}
        </div>
      )}
    </div>
  );
}
