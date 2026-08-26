-- スプレッド定点のスキーマ。
--
-- 生の観測値(ticks)は14日で捨て、それより古いものは10分足(buckets)と日次(daily)だけ残す。
-- 画面が読む行数を小さく保つことがそのままD1の無料枠の余裕になるため、
-- 集計はリクエスト時ではなくCron側で先に済ませる。
--
-- すべての表の先頭に pair を置いてあるのは、主キーの左端から絞れるようにするため。
-- 銘柄ページも日次ページも「ある銘柄の」という条件が必ず先に来る。

CREATE TABLE IF NOT EXISTS ticks (
  pair  TEXT    NOT NULL,        -- 通貨ペア（btc / eth / xrp）
  ts    INTEGER NOT NULL,        -- 観測時刻（UNIX秒）
  venue TEXT    NOT NULL,        -- 取引所ID
  bid   REAL    NOT NULL,        -- 最良買い気配
  ask   REAL    NOT NULL,        -- 最良売り気配
  PRIMARY KEY (pair, venue, ts)
);

CREATE INDEX IF NOT EXISTS idx_ticks_ts ON ticks (ts);

-- 10分足。24時間ぶんのグラフはここから読む（144点 × 取引所数）。
CREATE TABLE IF NOT EXISTS buckets (
  pair    TEXT    NOT NULL,
  bucket  INTEGER NOT NULL,      -- UNIX秒を600で切り捨てた値
  venue   TEXT    NOT NULL,
  avg_bps REAL    NOT NULL,
  max_bps REAL    NOT NULL,
  min_bps REAL    NOT NULL,
  samples INTEGER NOT NULL,
  PRIMARY KEY (pair, bucket, venue)
);

-- 日次集計。日付ページの中身であり、ページが自動で増えていく源でもある。
CREATE TABLE IF NOT EXISTS daily (
  pair    TEXT    NOT NULL,
  day     TEXT    NOT NULL,      -- JSTのYYYY-MM-DD
  venue   TEXT    NOT NULL,
  avg_bps REAL    NOT NULL,
  min_bps REAL    NOT NULL,
  max_bps REAL    NOT NULL,
  samples INTEGER NOT NULL,
  PRIMARY KEY (pair, day, venue)
);

-- サイトマップと日付の前後リンクは、日付の一覧を何度も引く。
-- 日付だけを取り出せるようにしておく。
CREATE INDEX IF NOT EXISTS idx_daily_day ON daily (day);

-- 取得できなかった記録。欠測を隠すとデータの信頼性がなくなるため必ず残す。
CREATE TABLE IF NOT EXISTS fetch_errors (
  pair    TEXT    NOT NULL,
  ts      INTEGER NOT NULL,
  venue   TEXT    NOT NULL,
  message TEXT    NOT NULL,
  PRIMARY KEY (pair, venue, ts)
);

CREATE INDEX IF NOT EXISTS idx_fetch_errors_ts ON fetch_errors (ts);
-- 板を食ったときの実効コストを保存する。
--
-- 板そのものは数十KBあるので保存しない。金額のはしごごとに計算した結果だけを
-- JSONで1行に持つ。1銘柄あたり4行（取引所の数）しか増えない。
--
--   npx wrangler d1 execute spread_teiten --remote --file=./db/migrations/0002_add_depth.sql

CREATE TABLE IF NOT EXISTS depth (
  pair  TEXT    NOT NULL,
  ts    INTEGER NOT NULL,      -- 観測時刻（UNIX秒）
  venue TEXT    NOT NULL,
  costs TEXT    NOT NULL,      -- {"100000": 5.2, "300000": 18.4, ...}。取れない段はnull
  PRIMARY KEY (pair, venue, ts)
);

CREATE INDEX IF NOT EXISTS idx_depth_ts ON depth (ts);
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
