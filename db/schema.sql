-- スプレッド定点のスキーマ。
--
-- 生の観測値(ticks)は14日で捨て、それより古いものは10分足(buckets)と日次(daily)だけ残す。
-- 画面が読む行数を小さく保つことがそのままD1の無料枠の余裕になるため、
-- 集計はリクエスト時ではなくCron側で先に済ませる。

CREATE TABLE IF NOT EXISTS ticks (
  ts    INTEGER NOT NULL,        -- 観測時刻（UNIX秒）
  venue TEXT    NOT NULL,        -- 取引所ID
  bid   REAL    NOT NULL,        -- 最良買い気配
  ask   REAL    NOT NULL,        -- 最良売り気配
  PRIMARY KEY (venue, ts)
);

CREATE INDEX IF NOT EXISTS idx_ticks_ts ON ticks (ts);

-- 10分足。24時間ぶんのグラフはここから読む（144点 × 取引所数）。
CREATE TABLE IF NOT EXISTS buckets (
  bucket  INTEGER NOT NULL,      -- UNIX秒を600で切り捨てた値
  venue   TEXT    NOT NULL,
  avg_bps REAL    NOT NULL,
  max_bps REAL    NOT NULL,
  min_bps REAL    NOT NULL,
  samples INTEGER NOT NULL,
  PRIMARY KEY (bucket, venue)
);

CREATE INDEX IF NOT EXISTS idx_buckets_bucket ON buckets (bucket);

-- 日次集計。長期の比較と「この日はどこが荒れたか」を出すために残す。
CREATE TABLE IF NOT EXISTS daily (
  day     TEXT    NOT NULL,      -- JSTのYYYY-MM-DD
  venue   TEXT    NOT NULL,
  avg_bps REAL    NOT NULL,
  min_bps REAL    NOT NULL,
  max_bps REAL    NOT NULL,
  samples INTEGER NOT NULL,
  PRIMARY KEY (day, venue)
);

-- 取得できなかった記録。欠測を隠すとデータの信頼性がなくなるため必ず残す。
CREATE TABLE IF NOT EXISTS fetch_errors (
  ts      INTEGER NOT NULL,
  venue   TEXT    NOT NULL,
  message TEXT    NOT NULL,
  PRIMARY KEY (venue, ts)
);

CREATE INDEX IF NOT EXISTS idx_fetch_errors_ts ON fetch_errors (ts);
