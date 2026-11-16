-- =====================================================================
-- 家計簿アプリ  db/schema.sql
-- 対象: Azure SQL Database / SQL Server（T-SQL）
-- 設計書 第1.1版 2.3 章・3 章 5 に準拠
--   ・残高は保存せず、v_account_balances ビューで計算する
--   ・貯金の現在額も保存せず、savings_allocations の合計で求める
--   ・金額は円単位の INT
--   ・マスタは is_archived による論理削除
-- 注意: 初回セットアップ用です（再実行すると「既に存在します」エラーになります）。
-- =====================================================================

CREATE TABLE accounts (
  id              INT IDENTITY PRIMARY KEY,
  name            NVARCHAR(50) NOT NULL,
  kind            NVARCHAR(20) NOT NULL
                  CHECK (kind IN ('bank','cash','emoney','credit')),
  opening_balance INT NOT NULL DEFAULT 0,
  sort_order      INT NOT NULL DEFAULT 0,
  is_archived     BIT NOT NULL DEFAULT 0,
  created_at      DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);

CREATE TABLE categories (
  id          INT IDENTITY PRIMARY KEY,
  type        NVARCHAR(10) NOT NULL CHECK (type IN ('income','expense')),
  name        NVARCHAR(50) NOT NULL,
  sort_order  INT NOT NULL DEFAULT 0,
  is_archived BIT NOT NULL DEFAULT 0,
  CONSTRAINT uq_category UNIQUE (type, name)
);

CREATE TABLE transactions (
  id            INT IDENTITY PRIMARY KEY,
  date          DATE NOT NULL,
  type          NVARCHAR(10) NOT NULL
                CHECK (type IN ('income','expense','transfer')),
  account_id    INT NOT NULL REFERENCES accounts(id),
  to_account_id INT NULL REFERENCES accounts(id),
  category_id   INT NULL REFERENCES categories(id),
  amount        INT NOT NULL CHECK (amount > 0),
  memo          NVARCHAR(200) NULL,
  created_at    DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  updated_at    DATETIME2 NULL,
  CONSTRAINT ck_tx_shape CHECK (
    (type = 'transfer' AND to_account_id IS NOT NULL
       AND category_id IS NULL AND to_account_id <> account_id)
    OR
    (type <> 'transfer' AND to_account_id IS NULL
       AND category_id IS NOT NULL))
);
CREATE INDEX ix_tx_date ON transactions(date);

CREATE TABLE savings_goals (
  id            INT IDENTITY PRIMARY KEY,
  name          NVARCHAR(50) NOT NULL,
  target_amount INT NOT NULL DEFAULT 0,
  sort_order    INT NOT NULL DEFAULT 0,
  is_archived   BIT NOT NULL DEFAULT 0,
  created_at    DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);

CREATE TABLE savings_allocations (
  id             INT IDENTITY PRIMARY KEY,
  goal_id        INT NOT NULL REFERENCES savings_goals(id),
  date           DATE NOT NULL,
  amount         INT NOT NULL CHECK (amount <> 0), -- +割当 / -解除
  transaction_id INT NULL REFERENCES transactions(id)
                 ON DELETE CASCADE,
  memo           NVARCHAR(200) NULL,
  created_at     DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);
GO

CREATE VIEW v_account_balances AS
SELECT a.id, a.name, a.kind, a.sort_order, a.is_archived,
       a.opening_balance + COALESCE(SUM(
         CASE
           WHEN t.type = 'income'   AND t.account_id    = a.id THEN  t.amount
           WHEN t.type = 'expense'  AND t.account_id    = a.id THEN -t.amount
           WHEN t.type = 'transfer' AND t.account_id    = a.id THEN -t.amount
           WHEN t.type = 'transfer' AND t.to_account_id = a.id THEN  t.amount
         END), 0) AS balance
FROM accounts a
LEFT JOIN transactions t
  ON t.account_id = a.id OR t.to_account_id = a.id
GROUP BY a.id, a.name, a.kind, a.sort_order, a.is_archived,
         a.opening_balance;
GO
