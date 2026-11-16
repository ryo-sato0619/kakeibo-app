-- =====================================================================
-- 家計簿アプリ  db/seed.sql  初期カテゴリ
-- 何度実行しても重複登録されません（同一 type + name は追加しない）。
-- カテゴリはアプリの「設定」画面から自由に追加・変更・削除できます。
-- =====================================================================

INSERT INTO categories (type, name, sort_order)
SELECT v.type, v.name, v.sort_order
FROM (VALUES
  -- 出金
  (N'expense', N'食費',           10),
  (N'expense', N'日用品',         20),
  (N'expense', N'交通費',         30),
  (N'expense', N'住居費',         40),
  (N'expense', N'水道光熱費',     50),
  (N'expense', N'通信費',         60),
  (N'expense', N'サブスク',       70),
  (N'expense', N'医療費',         80),
  (N'expense', N'衣服・美容',     90),
  (N'expense', N'交際費',        100),
  (N'expense', N'趣味・娯楽',    110),
  (N'expense', N'教育・書籍',    120),
  (N'expense', N'その他',        999),
  -- 入金
  (N'income',  N'給与',           10),
  (N'income',  N'賞与',           20),
  (N'income',  N'副収入',         30),
  (N'income',  N'その他',        999)
) AS v(type, name, sort_order)
WHERE NOT EXISTS (
  SELECT 1 FROM categories c WHERE c.type = v.type AND c.name = v.name
);
GO
