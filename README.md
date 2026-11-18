# 家計簿（個人用 Web アプリ）

口座・入出金・振替・目的別貯金・月次/年次レポートを管理する、本人専用の家計簿です。
Azure Static Web Apps（無料）+ マネージド Functions + Azure SQL Database（無料オファー）で、月額 0 円を目指す構成です。

```
app/   画面（React + Vite + Tailwind CSS）と staticwebapp.config.json（認証・ルーティング）
api/   API（Azure Functions v4 / Node.js / mssql）
db/    schema.sql（テーブル・ビュー）/ seed.sql（初期カテゴリ）
docs/  手順書・仕様書
.github/workflows/test.yml   テストと画面ビルドの確認（デプロイ用は SWA 作成時に Azure が追加）
```

## ドキュメント

| 目的 | ファイル |
| --- | --- |
| **デプロイ（ローカル確認 → GitHub → Azure）** | [docs/deploy.md](docs/deploy.md) |
| Azure SQL Database の作成とスキーマ適用 | [docs/azure-sql-setup.md](docs/azure-sql-setup.md) |
| API の仕様 | [docs/api.md](docs/api.md) |
| 画面の使い方・デモモード | [docs/app.md](docs/app.md) |
