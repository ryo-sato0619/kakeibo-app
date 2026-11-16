# API 仕様（Step 2）

Azure Static Web Apps のマネージド Functions（Node.js / `@azure/functions` v4）。すべて `/api/*` 配下で、JSON を入出力します。

## 共通ルール

| 項目 | 内容 |
| --- | --- |
| 認証 | SWA の認証済みで **`owner` ロール**を持つ要求だけ受け付けます。ヘッダー `x-ms-client-principal` が無ければ 401、`owner` が無ければ 403。 |
| JSON のキー | camelCase（`accountId`、`toAccountId`、`categoryId` など） |
| 日付・月・年 | `YYYY-MM-DD` / `YYYY-MM` / `YYYY`。取引日付は文字列で返すので、タイムゾーンのずれは起きません。 |
| 金額 | 円単位の整数。取引・割当は 1〜99,999,999（割当の解除はマイナス）、口座の初期残高はマイナス可。 |
| 文字数 | 名称 50 文字以内、メモ 200 文字以内（前後の空白は除去、メモの空文字は null） |
| 一覧の形 | 配列をそのまま返します（`[...]`） |
| キャッシュ | すべてのレスポンスに `cache-control: no-store` |

### エラー形式

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "amount は 1 〜 99,999,999 の整数で指定してください" } }
```

| status | code | 意味 |
| --- | --- | --- |
| 400 | `VALIDATION_ERROR` | 入力が不正（形式・範囲・存在しない/アーカイブ済みの口座やカテゴリの指定など） |
| 401 | `UNAUTHORIZED` | 認証情報なし |
| 403 | `FORBIDDEN` | `owner` ロールなし |
| 404 | `NOT_FOUND` | 対象なし（アーカイブ済みへの DELETE も 404） |
| 409 | `CONFLICT` | 業務ルール違反（残高のある口座のアーカイブ、割当額不足など） |
| 405 | `METHOD_NOT_ALLOWED` | 未対応のメソッド |
| 503 | `DB_UNAVAILABLE` | DB 起動中（一時停止からの復帰）。最大 5 回（待ち時間を含めて約 38 秒まで）リトライしても接続できなかった。**画面側で数秒おいて再試行する**（SWA のマネージド Functions は 1 リクエスト最大 45 秒のため、超えた場合は SWA が 504 を返す。この場合も再試行すればつながる） |
| 500 | `INTERNAL_ERROR` | 想定外のエラー（詳細はログのみ） |

## エンドポイント

### サマリー
| メソッド | パス | 説明 |
| --- | --- | --- |
| GET | `/api/summary` | `{ totalAssets, savingsAllocated, available, isOverAllocated, accounts: [{ id, name, kind, balance, ... }] }`。`available = totalAssets − savingsAllocated`。マイナスのとき `isOverAllocated: true`（警告表示用）。 |

### 口座
| メソッド | パス | 説明 |
| --- | --- | --- |
| GET | `/api/accounts` | 残高付き一覧。`?includeArchived=1` でアーカイブ済みも |
| POST | `/api/accounts` | `{ name, kind, openingBalance?, sortOrder? }` → 201。`kind`: `bank` / `cash` / `emoney` / `credit` |
| PUT | `/api/accounts/{id}` | 指定した項目だけ更新（`name`, `kind`, `openingBalance`, `sortOrder`） |
| DELETE | `/api/accounts/{id}` | アーカイブ → 204。**残高が 0 でなければ 409** |

口座オブジェクト: `{ id, name, kind, openingBalance, sortOrder, isArchived, balance }`

### カテゴリ
| メソッド | パス | 説明 |
| --- | --- | --- |
| GET | `/api/categories` | `?type=income\|expense`、`?includeArchived=1` |
| POST | `/api/categories` | `{ type, name, sortOrder? }` → 201。同名が有効なら 409。**同名のアーカイブ済みがあれば新規作成せず復活** |
| PUT | `/api/categories/{id}` | `name`, `sortOrder`（種別は変更不可） |
| DELETE | `/api/categories/{id}` | 論理削除 → 204 |

カテゴリ: `{ id, type, name, sortOrder, isArchived }`

### 取引
| メソッド | パス | 説明 |
| --- | --- | --- |
| GET | `/api/transactions?month=YYYY-MM` | 月別履歴（新しい順）。`month` 必須 |
| POST | `/api/transactions` | → 201 |
| PUT | `/api/transactions/{id}` | 全項目を送って置き換える（POST と同じ形） |
| DELETE | `/api/transactions/{id}` | → 204。貯金で支払った取引なら、対応する割当解除も一緒に消える |

リクエスト（`type` ごと）:

| type | 必須 | 指定不可 |
| --- | --- | --- |
| `income` / `expense` | `date`, `amount`, `accountId`, `categoryId` | `toAccountId` |
| `transfer` | `date`, `amount`, `accountId`（振替元）, `toAccountId`（振替先・別の口座） | `categoryId` |

`memo` は任意。カテゴリの種別は取引の種別と一致が必要。新規の取引にアーカイブ済みの口座・カテゴリは指定できません（編集時は、元の取引が使っているものをそのまま残せます）。

取引オブジェクト: `{ id, date, type, accountId, accountName, toAccountId, toAccountName, categoryId, categoryName, amount, memo, createdAt, updatedAt, savingsGoalId }`
`savingsGoalId` は「この貯金で支払う」で登録された取引のときだけ値が入ります。この取引は**金額・種別を変更できません（409）**。日付・口座・カテゴリ・メモは変更できます。

### 貯金
| メソッド | パス | 説明 |
| --- | --- | --- |
| GET | `/api/savings` | 目的一覧（`allocatedAmount`、`progressRate` 付き）。`?includeArchived=1` |
| POST | `/api/savings` | `{ name, targetAmount?, sortOrder? }` → 201 |
| PUT | `/api/savings/{id}` | `name`, `targetAmount`, `sortOrder` |
| DELETE | `/api/savings/{id}` | アーカイブ → 204。残っている割当額は、マイナスの割当を自動登録して解除 |
| GET | `/api/savings/{id}/allocations` | 割当履歴（新しい順） |
| POST | `/api/savings/{id}/allocations` | `{ amount, date?, memo? }` → 201。`amount` の正が割当、負が解除。**解除は現在の割当額まで（超えると 409）**。`date` 省略時は今日（JST） |
| POST | `/api/savings/{id}/spend` | `{ date, accountId, categoryId, amount, memo? }` → 201 `{ transaction, allocation, goal }`。出金登録と同額の割当解除を**同一トランザクション**で実行。**割当額が足りなければ 409** |

貯金目的: `{ id, name, targetAmount, sortOrder, isArchived, allocatedAmount, progressRate }`
`progressRate` は `allocatedAmount ÷ targetAmount`（0.5 = 50%、100% を超えることもある）。目標が 0 のときは `null`。

割当: `{ id, goalId, date, amount, transactionId, memo, createdAt }`

### レポート・エクスポート
| メソッド | パス | 説明 |
| --- | --- | --- |
| GET | `/api/reports/monthly?month=YYYY-MM` | `{ month, income, expense, net, incomeByCategory: [{ categoryId, categoryName, amount }], expenseByCategory: [...] }`（振替は含めない） |
| GET | `/api/reports/yearly?year=YYYY` | `{ year, income, expense, net, months: [{ month: "2026-01", income, expense, net } × 12] }`（取引のない月も 0） |
| GET | `/api/export/transactions?from=&to=` | CSV（UTF-8 BOM 付き、CRLF）。`from` / `to` は省略可・両端を含む。ファイル名は `transactions_YYYYMMDD.csv` |

CSV の列: `ID, 日付, 種別（入金/出金/振替）, 口座, 振替先口座, カテゴリ, 金額, メモ, 登録日時(JST), 更新日時(JST)`。
Excel で数式として実行されないよう、口座・カテゴリ・メモの先頭が `=` `+` `-` `@` のときは `'` を前置します。

---

## ローカルでの確認

```bash
cd api
npm install
npm test            # 単体テスト（DB 不要）
```

結合テスト（実際の Azure SQL に接続。**必ず ROLLBACK するのでデータは残りません**）:

1. `api/local.settings.json.example` を `api/local.settings.json` にコピーし、`SQL_CONNECTION_STRING` を自分の値にする（`<サーバー名>` と `<パスワード>` を置き換える）。
2. 手元 PC の IP が SQL サーバーのファイアウォールで許可されていること。
3. `npm run test:db`

DB が一時停止中だと最初の接続に最大 1 分ほどかかり、その間はリトライされます。
