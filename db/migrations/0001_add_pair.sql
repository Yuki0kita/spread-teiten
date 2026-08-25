-- 銘柄を増やすため、全テーブルに pair を足す。
--
-- ここまでに貯まっているのはBTCの観測値だけなので、既存行は 'btc' として引き継ぐ。
-- SQLiteは主キーの変更ができないため、作り直して入れ替える。
--
--   npx wrangler d1 execute spread_teiten --remote --file=./db/migrations/0001_add_pair.sql

DROP TABLE IF EXISTS ticks_new;
CREATE TABLE ticks_new (
  pair  TEXT    NOT NULL,
  ts    INTEGER NOT NULL,
  venue TEXT    NOT NULL,
  bid   REAL    NOT NULL,
  ask   REAL    NOT NULL,
  PRIMARY KEY (pair, venue, ts)
);
INSERT INTO ticks_new (pair, ts, venue, bid, ask) SELECT 'btc', ts, venue, bid, ask FROM ticks;
DROP TABLE ticks;
ALTER TABLE ticks_new RENAME TO ticks;
CREATE INDEX IF NOT EXISTS idx_ticks_ts ON ticks (ts);

DROP TABLE IF EXISTS buckets_new;
CREATE TABLE buckets_new (
  pair    TEXT    NOT NULL,
  bucket  INTEGER NOT NULL,
  venue   TEXT    NOT NULL,
  avg_bps REAL    NOT NULL,
  max_bps REAL    NOT NULL,
  min_bps REAL    NOT NULL,
  samples INTEGER NOT NULL,
  PRIMARY KEY (pair, bucket, venue)
);
INSERT INTO buckets_new SELECT 'btc', bucket, venue, avg_bps, max_bps, min_bps, samples FROM buckets;
DROP TABLE buckets;
ALTER TABLE buckets_new RENAME TO buckets;

DROP TABLE IF EXISTS daily_new;
CREATE TABLE daily_new (
  pair    TEXT    NOT NULL,
  day     TEXT    NOT NULL,
  venue   TEXT    NOT NULL,
  avg_bps REAL    NOT NULL,
  min_bps REAL    NOT NULL,
  max_bps REAL    NOT NULL,
  samples INTEGER NOT NULL,
  PRIMARY KEY (pair, day, venue)
);
INSERT INTO daily_new SELECT 'btc', day, venue, avg_bps, min_bps, max_bps, samples FROM daily;
DROP TABLE daily;
ALTER TABLE daily_new RENAME TO daily;
CREATE INDEX IF NOT EXISTS idx_daily_day ON daily (day);

DROP TABLE IF EXISTS fetch_errors_new;
CREATE TABLE fetch_errors_new (
  pair    TEXT    NOT NULL,
  ts      INTEGER NOT NULL,
  venue   TEXT    NOT NULL,
  message TEXT    NOT NULL,
  PRIMARY KEY (pair, venue, ts)
);
INSERT INTO fetch_errors_new SELECT 'btc', ts, venue, message FROM fetch_errors;
DROP TABLE fetch_errors;
ALTER TABLE fetch_errors_new RENAME TO fetch_errors;
CREATE INDEX IF NOT EXISTS idx_fetch_errors_ts ON fetch_errors (ts);
