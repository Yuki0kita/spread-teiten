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
