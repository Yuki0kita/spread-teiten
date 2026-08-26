/**
 * D1への読み書き。
 *
 * 無料枠を壊すのは、たいてい「1リクエストで何行読むか」なので、
 * 画面が読む行数が常に小さくなるようにクエリを組んである。
 * 生の観測値をなめる集計はCron側だけで行う。
 *
 * すべてのクエリが pair で絞る。主キーの左端が pair なので索引がそのまま効く。
 */
import { BUCKET_SECONDS, bucketOf, jstDay, spreadBps, TICK_RETENTION_DAYS } from './spread.ts';
import type { Quote } from './spread.ts';
import type { PairId } from './pairs.ts';

export type DepthRow = { venue: string; ts: number; costs: string };

export type Tick = Quote & { ts: number };

export type BucketRow = {
  bucket: number;
  venue: string;
  avg_bps: number;
  max_bps: number;
  min_bps: number;
  samples: number;
};

export type DailyRow = {
  day: string;
  venue: string;
  avg_bps: number;
  min_bps: number;
  max_bps: number;
  samples: number;
};

/**
 * 取引所ごとの最新の観測値。
 *
 * 「直近10分だけを見る」という書き方をすると、収集が10分以上止まった瞬間に
 * 画面が「観測データがありません」になる。実際には値を持っているのに、
 * 空のサイトに見えてしまうのがいちばん困る。
 *
 * そこで期間で絞らず、取引所ごとに最新の1行を引く。
 * PRIMARY KEY (pair, venue, ts) の逆順先頭を取るだけなので、読むのは取引所の数だけで済む。
 * 古い値かどうかは画面側（isStale）で判定して必ず名乗る。
 */
export async function latestTicks(
  db: D1Database,
  pair: PairId,
  venues: readonly string[],
): Promise<Tick[]> {
  if (venues.length === 0) return [];

  const statement = db.prepare(
    'SELECT ts, venue, bid, ask FROM ticks WHERE pair = ?1 AND venue = ?2 ORDER BY ts DESC LIMIT 1',
  );
  const responses = await db.batch<Tick>(venues.map((venue) => statement.bind(pair, venue)));
  return responses.flatMap((response) => response.results ?? []);
}

/** グラフ用の10分足。24時間なら144点 × 取引所数しか読まない。 */
export async function bucketsSince(
  db: D1Database,
  pair: PairId,
  since: number,
): Promise<BucketRow[]> {
  const { results } = await db
    .prepare(
      `SELECT bucket, venue, avg_bps, max_bps, min_bps, samples FROM buckets
       WHERE pair = ?1 AND bucket >= ?2 ORDER BY bucket ASC`,
    )
    .bind(pair, bucketOf(since))
    .all<BucketRow>();
  return results;
}

/**
 * 監視画面のための、取引所ごとの10分足。
 *
 * 平常時の基準（中央値）とスパークラインを同じ1回の読み取りでまかなう。
 * 別々に引くと読み取り量が倍になる。
 */
export async function bucketSeries(
  db: D1Database,
  pair: PairId,
  since: number,
): Promise<{ venue: string; bucket: number; avg_bps: number }[]> {
  const { results } = await db
    .prepare(
      `SELECT venue, bucket, avg_bps FROM buckets
       WHERE pair = ?1 AND bucket >= ?2 ORDER BY bucket ASC`,
    )
    .bind(pair, bucketOf(since))
    .all<{ venue: string; bucket: number; avg_bps: number }>();
  return results;
}

/** 日次ページの中身。1日ぶんなので取引所の数だけしか読まない。 */
export async function dailyFor(
  db: D1Database,
  pair: PairId,
  day: string,
): Promise<DailyRow[]> {
  const { results } = await db
    .prepare(
      `SELECT day, venue, avg_bps, min_bps, max_bps, samples FROM daily
       WHERE pair = ?1 AND day = ?2`,
    )
    .bind(pair, day)
    .all<DailyRow>();
  return results;
}

/** 日付の一覧。前後リンクとサイトマップに使う。 */
export async function daysWithData(
  db: D1Database,
  pair: PairId,
  limit = 400,
): Promise<string[]> {
  const { results } = await db
    .prepare('SELECT DISTINCT day FROM daily WHERE pair = ?1 ORDER BY day DESC LIMIT ?2')
    .bind(pair, limit)
    .all<{ day: string }>();
  return results.map((row) => row.day);
}

export async function recentDaily(
  db: D1Database,
  pair: PairId,
  days: number,
): Promise<DailyRow[]> {
  const { results } = await db
    .prepare(
      `SELECT day, venue, avg_bps, min_bps, max_bps, samples FROM daily
       WHERE pair = ?1 ORDER BY day DESC LIMIT ?2`,
    )
    .bind(pair, days * 8)
    .all<DailyRow>();
  return results;
}

export async function recentErrors(
  db: D1Database,
  since: number,
): Promise<{ pair: string; ts: number; venue: string; message: string }[]> {
  const { results } = await db
    .prepare(
      'SELECT pair, ts, venue, message FROM fetch_errors WHERE ts >= ?1 ORDER BY ts DESC LIMIT 30',
    )
    .bind(since)
    .all<{ pair: string; ts: number; venue: string; message: string }>();
  return results;
}

export async function insertTicks(
  db: D1Database,
  pair: PairId,
  ts: number,
  quotes: Quote[],
): Promise<void> {
  if (quotes.length === 0) return;
  const statement = db.prepare(
    'INSERT OR REPLACE INTO ticks (pair, ts, venue, bid, ask) VALUES (?1, ?2, ?3, ?4, ?5)',
  );
  await db.batch(quotes.map((q) => statement.bind(pair, ts, q.venue, q.bid, q.ask)));
}

export async function insertErrors(
  db: D1Database,
  pair: PairId,
  ts: number,
  errors: { venue: string; message: string }[],
): Promise<void> {
  if (errors.length === 0) return;
  const statement = db.prepare(
    'INSERT OR REPLACE INTO fetch_errors (pair, ts, venue, message) VALUES (?1, ?2, ?3, ?4)',
  );
  await db.batch(errors.map((e) => statement.bind(pair, ts, e.venue, e.message.slice(0, 200))));
}

/** 実効コストを保存する。同じ分に二度呼ばれても行は増えない。 */
export async function insertDepth(
  db: D1Database,
  pair: PairId,
  ts: number,
  rows: { venue: string; costs: string }[],
): Promise<void> {
  if (rows.length === 0) return;
  const statement = db.prepare(
    'INSERT OR REPLACE INTO depth (pair, ts, venue, costs) VALUES (?1, ?2, ?3, ?4)',
  );
  await db.batch(rows.map((r) => statement.bind(pair, ts, r.venue, r.costs)));
}

/**
 * 取引所ごとの最新の実効コスト。
 *
 * 板は銘柄を回しながら取っているので、最新の時刻は取引所ごとに揃っている
 * （同じ回で4社ぶんまとめて入る）。最新の1行ずつを引けばよい。
 */
export async function latestDepth(
  db: D1Database,
  pair: PairId,
  venues: readonly string[],
): Promise<DepthRow[]> {
  if (venues.length === 0) return [];
  const statement = db.prepare(
    'SELECT venue, ts, costs FROM depth WHERE pair = ?1 AND venue = ?2 ORDER BY ts DESC LIMIT 1',
  );
  const responses = await db.batch<DepthRow>(venues.map((venue) => statement.bind(pair, venue)));
  return responses.flatMap((response) => response.results ?? []);
}

/** その分ぶんが既に記録されているか。無駄な取得を止めるために使う。 */
export async function hasTicksAt(db: D1Database, pair: PairId, ts: number): Promise<boolean> {
  const row = await db
    .prepare('SELECT COUNT(*) AS c FROM ticks WHERE pair = ?1 AND ts = ?2')
    .bind(pair, ts)
    .first<{ c: number }>();
  return (row?.c ?? 0) > 0;
}

/**
 * いま入った観測値が属する10分足を作り直す。
 *
 * 差分更新ではなく毎回その足だけを引き直す。読むのは最大でも40行程度で、
 * 差分計算のズレを永久に抱えるより、そのつど正しい値にするほうが安い。
 */
export async function refreshBucket(db: D1Database, pair: PairId, ts: number): Promise<void> {
  const start = bucketOf(ts);
  const { results } = await db
    .prepare('SELECT venue, bid, ask FROM ticks WHERE pair = ?1 AND ts >= ?2 AND ts < ?3')
    .bind(pair, start, start + BUCKET_SECONDS)
    .all<{ venue: string; bid: number; ask: number }>();

  const summaries = summarize(results);
  if (summaries.size === 0) return;

  const statement = db.prepare(
    `INSERT INTO buckets (pair, bucket, venue, avg_bps, max_bps, min_bps, samples)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
     ON CONFLICT(pair, bucket, venue) DO UPDATE SET
       avg_bps = excluded.avg_bps, max_bps = excluded.max_bps,
       min_bps = excluded.min_bps, samples = excluded.samples`,
  );
  await db.batch(
    [...summaries].map(([venue, s]) =>
      statement.bind(pair, start, venue, s.avg, s.max, s.min, s.samples),
    ),
  );
}

/**
 * 日次集計を作り直す。生の観測値ではなく10分足から積む。
 *
 * 1日ぶんの生データは行数が多いため、毎回なめると読み取り量が跳ね上がる。
 * 10分足なら最大144点で済み、samplesで重み付けすれば平均も正しく出る。
 */
export async function refreshDaily(db: D1Database, pair: PairId, ts: number): Promise<void> {
  const day = jstDay(ts);
  const dayStart = Math.floor((ts + 9 * 3600) / 86_400) * 86_400 - 9 * 3600;

  const { results } = await db
    .prepare(
      `SELECT venue, avg_bps, max_bps, min_bps, samples FROM buckets
       WHERE pair = ?1 AND bucket >= ?2 AND bucket < ?3`,
    )
    .bind(pair, dayStart, dayStart + 86_400)
    .all<{ venue: string; avg_bps: number; max_bps: number; min_bps: number; samples: number }>();

  const byVenue = new Map<
    string,
    { weighted: number; samples: number; min: number; max: number }
  >();
  for (const row of results) {
    const current = byVenue.get(row.venue) ?? {
      weighted: 0,
      samples: 0,
      min: Infinity,
      max: -Infinity,
    };
    current.weighted += row.avg_bps * row.samples;
    current.samples += row.samples;
    current.min = Math.min(current.min, row.min_bps);
    current.max = Math.max(current.max, row.max_bps);
    byVenue.set(row.venue, current);
  }
  if (byVenue.size === 0) return;

  const statement = db.prepare(
    `INSERT INTO daily (pair, day, venue, avg_bps, min_bps, max_bps, samples)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
     ON CONFLICT(pair, day, venue) DO UPDATE SET
       avg_bps = excluded.avg_bps, min_bps = excluded.min_bps,
       max_bps = excluded.max_bps, samples = excluded.samples`,
  );
  await db.batch(
    [...byVenue].map(([venue, s]) =>
      statement.bind(pair, day, venue, s.weighted / s.samples, s.min, s.max, s.samples),
    ),
  );
}

/** 古い生データを捨てる。10分足と日次は残るので、長期の比較はできる。 */
export async function pruneTicks(db: D1Database, now: number): Promise<void> {
  const cutoff = now - TICK_RETENTION_DAYS * 86_400;
  await db.batch([
    db.prepare('DELETE FROM ticks WHERE ts < ?1').bind(cutoff),
    db.prepare('DELETE FROM fetch_errors WHERE ts < ?1').bind(cutoff),
    db.prepare('DELETE FROM depth WHERE ts < ?1').bind(cutoff),
  ]);
}

function summarize(
  rows: { venue: string; bid: number; ask: number }[],
): Map<string, { avg: number; min: number; max: number; samples: number }> {
  const byVenue = new Map<string, number[]>();
  for (const row of rows) {
    const list = byVenue.get(row.venue) ?? [];
    list.push(spreadBps(row.bid, row.ask));
    byVenue.set(row.venue, list);
  }

  const out = new Map<string, { avg: number; min: number; max: number; samples: number }>();
  for (const [venue, values] of byVenue) {
    out.set(venue, {
      avg: values.reduce((a, b) => a + b, 0) / values.length,
      min: Math.min(...values),
      max: Math.max(...values),
      samples: values.length,
    });
  }
  return out;
}
