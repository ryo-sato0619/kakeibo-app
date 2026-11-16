import { useState } from 'react';
import { api } from '../lib/client.js';
import { formatYen } from '../lib/format.js';
import { KIND_LABEL, KIND_OPTIONS } from '../lib/labels.js';
import { parseAmountInput, validateAmount, validateName } from '../lib/validate.js';
import { useApp } from '../state/AppContext.jsx';
import { useResource } from '../state/useResource.js';
import { Button, Card, Empty, ErrorBanner, Field, Input, Loading, Modal, Select, amountTone, cx } from '../components/ui.jsx';

function AccountModal({ account, onClose }) {
  const { notify, bump } = useApp();
  const isEdit = Boolean(account);
  const [name, setName] = useState(account ? account.name : '');
  const [kind, setKind] = useState(account ? account.kind : 'bank');
  const [opening, setOpening] = useState(account ? String(account.openingBalance) : '0');
  const [errors, setErrors] = useState({});
  const [apiError, setApiError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    const found = {};
    const nameError = validateName(name, '口座名');
    if (nameError) found.name = nameError;
    const openingError = validateAmount(opening === '' ? '0' : opening, { allowNegative: true });
    if (openingError) found.opening = openingError;
    setErrors(found);
    if (Object.keys(found).length) return;
    setBusy(true);
    setApiError(null);
    try {
      const body = { name: name.trim(), kind, openingBalance: parseAmountInput(opening === '' ? '0' : opening, { allowNegative: true }) };
      if (isEdit) await api.put(`/api/accounts/${account.id}`, body);
      else await api.post('/api/accounts', body);
      notify(isEdit ? '口座を更新しました' : '口座を追加しました');
      bump();
      onClose();
    } catch (error) {
      setApiError(error);
      setBusy(false);
    }
  }

  return (
    <Modal title={isEdit ? '口座を編集' : '口座を追加'} onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <Field label="口座名" htmlFor="acc-name" error={errors.name}>
          <Input id="acc-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={50} autoFocus invalid={Boolean(errors.name)} />
        </Field>
        <Field label="種類" htmlFor="acc-kind">
          <Select id="acc-kind" value={kind} onChange={(e) => setKind(e.target.value)}>
            {KIND_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label="初期残高（円）"
          htmlFor="acc-opening"
          error={errors.opening}
          hint={isEdit ? '変更すると、現在の残高も同じ額だけ変わります。' : '登録時点の残高です。クレジットカードの未払いはマイナスで入力します。'}
        >
          <Input id="acc-opening" inputMode="numeric" value={opening} onChange={(e) => setOpening(e.target.value)} invalid={Boolean(errors.opening)} />
        </Field>
        <ErrorBanner error={apiError} />
        <Button type="submit" size="lg" className="w-full" disabled={busy}>
          {busy ? '保存中…' : isEdit ? '更新する' : '追加する'}
        </Button>
      </form>
    </Modal>
  );
}

export default function Accounts() {
  const { notify, bump } = useApp();
  const list = useResource(() => api.get('/api/accounts'));
  const [modal, setModal] = useState(null); // { account? }
  const [archiveError, setArchiveError] = useState(null);

  async function archive(account) {
    setArchiveError(null);
    if (!window.confirm(`「${account.name}」をアーカイブしますか？\n（過去の取引は残ります。残高が 0 の口座だけアーカイブできます）`)) return;
    try {
      await api.del(`/api/accounts/${account.id}`);
      notify('アーカイブしました');
      bump();
    } catch (error) {
      setArchiveError(error);
    }
  }

  return (
    <div>
      <div className="mb-4 flex justify-end">
        <Button onClick={() => setModal({})}>＋ 口座を追加</Button>
      </div>
      <ErrorBanner error={list.error || archiveError} onRetry={archiveError ? undefined : list.reload} />
      {list.loading && !list.data ? (
        <Loading />
      ) : list.data && list.data.length === 0 ? (
        <Empty>口座がまだありません。「口座を追加」から登録してください。</Empty>
      ) : (
        list.data && (
          <Card className="divide-y divide-slate-100">
            {list.data.map((a) => (
              <div key={a.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate font-medium">{a.name}</p>
                  <p className="text-xs text-slate-500">
                    {KIND_LABEL[a.kind]} ・ 初期残高 {formatYen(a.openingBalance)}
                  </p>
                </div>
                <div className="text-right">
                  <p className={cx('font-semibold', amountTone(a.balance))}>{formatYen(a.balance)}</p>
                  <div className="mt-1 flex justify-end gap-3 text-xs">
                    <button type="button" className="text-indigo-600 hover:underline" onClick={() => setModal({ account: a })}>
                      編集
                    </button>
                    <button type="button" className="text-rose-600 hover:underline" onClick={() => archive(a)}>
                      アーカイブ
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </Card>
        )
      )}
      {modal && <AccountModal account={modal.account} onClose={() => setModal(null)} />}
    </div>
  );
}
