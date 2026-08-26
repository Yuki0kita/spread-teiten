-- アクセスの集計。外部の解析サービスを使わず自分で数える。
--
-- 記録するのは日付・パス・リファラのホスト名・国だけ。
-- IPもCookieもUser-Agentも保存しない。個人を追いかけるためのものではない。
--
--   npx wrangler d1 execute spread_teiten --remote --file=./db/migrations/0003_add_visits.sql

CREATE TABLE IF NOT EXISTS visits (
  day      TEXT    NOT NULL,      -- JSTのYYYY-MM-DD
  path     TEXT    NOT NULL,
  referrer TEXT    NOT NULL,      -- ホスト名 / direct / self
  country  TEXT    NOT NULL,
  count    INTEGER NOT NULL,
  PRIMARY KEY (day, path, referrer, country)
);

CREATE INDEX IF NOT EXISTS idx_visits_day ON visits (day);
