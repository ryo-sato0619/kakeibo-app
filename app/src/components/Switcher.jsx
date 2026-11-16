import { Button } from './ui.jsx';

/** ◀ 2026年11月 ▶ のような期間の切り替え */
export default function Switcher({ label, onPrev, onNext, prevLabel = '前へ', nextLabel = '次へ' }) {
  return (
    <div className="mb-4 flex items-center justify-between rounded-xl border border-slate-200 bg-white px-2 py-1.5">
      <Button variant="ghost" size="sm" onClick={onPrev} aria-label={prevLabel}>
        ◀
      </Button>
      <span className="text-base font-semibold">{label}</span>
      <Button variant="ghost" size="sm" onClick={onNext} aria-label={nextLabel}>
        ▶
      </Button>
    </div>
  );
}
