import { useEffect } from 'react';

export const cx = (...parts) => parts.filter(Boolean).join(' ');

const BUTTON_BASE =
  'inline-flex items-center justify-center rounded-lg font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50';
const BUTTON_VARIANTS = {
  primary: 'bg-indigo-600 text-white hover:bg-indigo-700',
  secondary: 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50',
  danger: 'bg-rose-600 text-white hover:bg-rose-700',
  dangerOutline: 'border border-rose-300 bg-white text-rose-600 hover:bg-rose-50',
  ghost: 'text-slate-600 hover:bg-slate-100',
};
const BUTTON_SIZES = { sm: 'px-3 py-1.5 text-sm', md: 'px-4 py-2.5 text-sm', lg: 'px-5 py-3 text-base' };

export function Button({ variant = 'primary', size = 'md', className, ...props }) {
  return <button type="button" className={cx(BUTTON_BASE, BUTTON_VARIANTS[variant], BUTTON_SIZES[size], className)} {...props} />;
}

export function Card({ className, children, ...props }) {
  return (
    <div className={cx('rounded-xl border border-slate-200 bg-white shadow-sm', className)} {...props}>
      {children}
    </div>
  );
}

export function SectionTitle({ children, action }) {
  return (
    <div className="mb-2 mt-6 flex items-end justify-between first:mt-0">
      <h2 className="text-sm font-semibold text-slate-500">{children}</h2>
      {action}
    </div>
  );
}

export function Field({ label, error, hint, htmlFor, children }) {
  return (
    <div className="mb-4">
      <label htmlFor={htmlFor} className="mb-1 block text-sm font-medium text-slate-700">
        {label}
      </label>
      {children}
      {hint && !error && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
      {error && <p className="mt-1 text-xs text-rose-600">{error}</p>}
    </div>
  );
}

const INPUT =
  'w-full rounded-lg border bg-white px-3 py-2.5 text-base placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200 disabled:bg-slate-100 disabled:text-slate-500 sm:text-sm';

export function Input({ className, invalid, ...props }) {
  return <input className={cx(INPUT, invalid ? 'border-rose-400' : 'border-slate-300', className)} {...props} />;
}

export function Select({ className, invalid, children, ...props }) {
  return (
    <select className={cx(INPUT, invalid ? 'border-rose-400' : 'border-slate-300', className)} {...props}>
      {children}
    </select>
  );
}

/** 2〜3 択の切り替え。options: [{ value, label, activeClass }] */
export function Segmented({ options, value, onChange, disabled }) {
  return (
    <div className="flex rounded-lg bg-slate-100 p-1" role="group">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          disabled={disabled}
          onClick={() => onChange(o.value)}
          aria-pressed={value === o.value}
          className={cx(
            'flex-1 rounded-md px-3 py-2 text-sm font-medium transition disabled:cursor-not-allowed',
            value === o.value ? o.activeClass || 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** スマホでは下から出るシート、PC では中央のダイアログ */
export function Modal({ title, onClose, children }) {
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center sm:items-center" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 bg-slate-900/40" onClick={onClose} />
      <div className="relative max-h-[92vh] w-full overflow-y-auto rounded-t-2xl bg-white shadow-xl sm:max-w-lg sm:rounded-2xl">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-100 bg-white px-5 py-3">
          <h2 className="text-base font-semibold">{title}</h2>
          <button type="button" onClick={onClose} aria-label="閉じる" className="rounded-full p-1.5 text-slate-500 hover:bg-slate-100">
            ✕
          </button>
        </div>
        <div className="safe-bottom px-5 pb-5 pt-4">{children}</div>
      </div>
    </div>
  );
}

export function ErrorBanner({ error, onRetry }) {
  if (!error) return null;
  const unauthorized = error.status === 401;
  const forbidden = error.status === 403;
  return (
    <div role="alert" className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
      <p>{unauthorized ? 'ログインが必要です。' : forbidden ? 'このアカウントには利用権限がありません。' : error.message}</p>
      <div className="mt-1 flex gap-4">
        {unauthorized && (
          <a className="underline" href="/.auth/login/github">
            ログインする
          </a>
        )}
        {forbidden && (
          <a className="underline" href="/.auth/logout">
            ログアウトする
          </a>
        )}
        {onRetry && !unauthorized && !forbidden && (
          <button type="button" className="underline" onClick={onRetry}>
            もう一度試す
          </button>
        )}
      </div>
    </div>
  );
}

export function Loading({ label = '読み込み中…' }) {
  return <p className="py-10 text-center text-sm text-slate-400">{label}</p>;
}

export function Empty({ children }) {
  return <p className="rounded-xl border border-dashed border-slate-300 py-10 text-center text-sm text-slate-400">{children}</p>;
}

export function Badge({ tone = 'slate', children }) {
  const tones = {
    slate: 'bg-slate-100 text-slate-600',
    indigo: 'bg-indigo-50 text-indigo-700',
    amber: 'bg-amber-50 text-amber-700',
  };
  return <span className={cx('inline-block rounded px-1.5 py-0.5 text-xs font-medium', tones[tone])}>{children}</span>;
}

/** 進捗バー。rate は 0.5 = 50%（100% を超えても幅は 100% まで） */
export function ProgressBar({ rate }) {
  const width = rate === null || rate === undefined ? 0 : Math.max(0, Math.min(100, rate * 100));
  const done = rate !== null && rate !== undefined && rate >= 1;
  return (
    <div className="h-2 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(width)}>
      <div className={cx('h-full rounded-full', done ? 'bg-emerald-500' : 'bg-indigo-500')} style={{ width: `${width}%` }} />
    </div>
  );
}

/** 金額の色分け（プラス：緑、マイナス：赤） */
export const amountTone = (n) => (n < 0 ? 'text-rose-600' : 'text-slate-900');
