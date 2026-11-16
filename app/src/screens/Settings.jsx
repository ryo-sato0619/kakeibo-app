import { useMemo, useState } from 'react';
import { api, isDemo, saveBlob } from '../lib/client.js';
import { validateName } from '../lib/validate.js';
import { useApp } from '../state/AppContext.jsx';
import { Button, Card, Empty, ErrorBanner, Field, Input, SectionTitle, Segmented } from '../components/ui.jsx';

function Categories() {
  const { masters, notify, bump } = useApp();
  const [type, setType] = useState('expense');
  const [newName, setNewName] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const list = useMemo(
    () => masters.categories.filter((c) => c.type === type).sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id),
    [masters.categories, type],
  );

  async function run(task, message) {
    setBusy(true);
    setError(null);
    try {
      await task();
      if (message) notify(message);
      bump();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  function add(e) {
    e.preventDefault();
    const nameError = validateName(newName, 'カテゴリ名');
    if (nameError) {
      setError({ message: nameError });
      return;
    }
    run(async () => {
      await api.post('/api/categories', { type, name: newName.trim() });
      setNewName('');
    }, 'カテゴリを追加しました');
  }

  function rename(c) {
    const input = window.prompt('新しいカテゴリ名', c.name);
    if (input === null || input.trim() === c.name) return;
    const nameError = validateName(input, 'カテゴリ名');
    if (nameError) {
      setError({ message: nameError });
      return;
    }
    run(() => api.put(`/api/categories/${c.id}`, { name: input.trim() }), '名前を変更しました');
  }

  function remove(c) {
    if (!window.confirm(`「${c.name}」を削除しますか？\n（過去の取引・集計には引き続き表示されます）`)) return;
    run(() => api.del(`/api/categories/${c.id}`), '削除しました');
  }

  /** 隣のカテゴリと表示順を入れ替える */
  function move(index, direction) {
    const a = list[index];
    const b = list[index + direction];
    if (!b) return;
    run(async () => {
      if (a.sortOrder === b.sortOrder) {
        await api.put(`/api/categories/${a.id}`, { sortOrder: b.sortOrder + direction });
      } else {
        await Promise.all([
          api.put(`/api/categories/${a.id}`, { sortOrder: b.sortOrder }),
          api.put(`/api/categories/${b.id}`, { sortOrder: a.sortOrder }),
        ]);
      }
    });
  }

  return (
    <>
      <div className="mb-3">
        <Segmented
          value={type}
          onChange={setType}
          options={[
            { value: 'expense', label: '出金のカテゴリ', activeClass: 'bg-rose-600 text-white shadow-sm' },
            { value: 'income', label: '入金のカテゴリ', activeClass: 'bg-emerald-600 text-white shadow-sm' },
          ]}
        />
      </div>
      <ErrorBanner error={error} />
      {list.length === 0 ? (
        <Empty>カテゴリがありません。</Empty>
      ) : (
        <Card className="divide-y divide-slate-100">
          {list.map((c, i) => (
            <div key={c.id} className="flex items-center justify-between gap-2 px-4 py-2.5">
              <span className="min-w-0 truncate font-medium">{c.name}</span>
              <div className="flex shrink-0 items-center gap-1 text-sm">
                <Button size="sm" variant="ghost" onClick={() => move(i, -1)} disabled={busy || i === 0} aria-label={`${c.name}を上へ`}>
                  ↑
                </Button>
                <Button size="sm" variant="ghost" onClick={() => move(i, 1)} disabled={busy || i === list.length - 1} aria-label={`${c.name}を下へ`}>
                  ↓
                </Button>
                <Button size="sm" variant="ghost" onClick={() => rename(c)} disabled={busy}>
                  名前変更
                </Button>
                <Button size="sm" variant="ghost" className="text-rose-600" onClick={() => remove(c)} disabled={busy}>
                  削除
                </Button>
              </div>
            </div>
          ))}
        </Card>
      )}
      <form onSubmit={add} className="mt-3 flex gap-2" noValidate>
        <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="新しいカテゴリ名" maxLength={50} aria-label="新しいカテゴリ名" />
        <Button type="submit" disabled={busy} className="shrink-0">
          追加
        </Button>
      </form>
    </>
  );
}

function Export() {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function download() {
    setBusy(true);
    setError(null);
    try {
      const { blob, filename } = await api.download('/api/export/transactions', { from, to });
      saveBlob(blob, filename);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="p-4">
      <p className="mb-3 text-sm text-slate-600">取引を CSV ファイルでダウンロードします（Excel でそのまま開けます）。期間を空にすると全期間です。</p>
      <div className="grid grid-cols-2 gap-3">
        <Field label="開始日" htmlFor="exp-from">
          <Input id="exp-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field label="終了日" htmlFor="exp-to">
          <Input id="exp-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </Field>
      </div>
      <ErrorBanner error={error} />
      <Button variant="secondary" onClick={download} disabled={busy}>
        {busy ? '準備中…' : 'CSV をダウンロード'}
      </Button>
    </Card>
  );
}

export default function Settings() {
  return (
    <div>
      <SectionTitle>カテゴリ</SectionTitle>
      <Categories />

      <SectionTitle>データのエクスポート</SectionTitle>
      <Export />

      <SectionTitle>アカウント</SectionTitle>
      <Card className="p-4">
        {isDemo ? (
          <p className="text-sm text-slate-600">デモモードで動作中です。入力したデータは保存されず、ページを再読み込みすると元に戻ります。</p>
        ) : (
          <a className="text-sm font-medium text-indigo-600 hover:underline" href="/.auth/logout?post_logout_redirect_uri=/">
            ログアウト
          </a>
        )}
      </Card>
    </div>
  );
}
