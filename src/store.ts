/**
 * D1への読み書き。
 *
 * 無料枠を壊すのは、たいてい「1リクエストで何行読むか」なので、
 * 画面が読む行数が常に小さくなるようにクエリを組んである。
 * 生の観測値をなめる集計はCron側だけで行う。
 */
import { BUCKET_SECONDS, bucketOf, jstDay, spreadBps, TICK_RETENTION_DAYS } from './spread.ts';
import type { Quote } from './spread.ts';

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
 * 「直近10分だけを見る」という書き方をすると、Cronが10分以上止まった瞬間に
 * 画面が「観測データがありません」になる。実際には値を持っているのに、
 * 空のサイトに見えてしまうのがいちばん困る。
 *
 * そこで期間で絞らず、取引所ごとに最新の1行を引く。
 * PRIMARY KEY (venue, ts) の逆順先頭を取るだけなので、読むのは取引所の数だけで済み、
 * 期間で絞るより安い。古い値かどうかは画面側（isStale）で判定して必ず名乗る。
 */
export async function latestTicks(db: D1Database, venues: readonly string[]): Promise<Tick[]> {
  if (venues.length === 0) return [];

  const statement = db.prepare(
    'SELECT ts, venue, bid, ask FROM ticks WHERE venue = ?1 ORDER BY ts DESC LIMIT 1',
  );
  const responses = await db.batch<Tick>(venues.map((venue) => statement.bind(venue)));

  return responses.flatMap((response) => response.results ?? []);
}

/** グラフ用の10分足。24時間なら144点 × 取引所数しか読まない。 */
export async function bucketsSince(db: D1Database, since: number): Promise<BucketRow[]> {
  const { results } = await db
    .prepare(
      'SELECT bucket, venue, avg_bps, max_bps, min_bps, samples FROM buckets WHERE bucket >= ?1 ORDER BY bucket ASC',
    )
    .bind(bucketOf(since))
    .all<BucketRow>();
  return results;
}

export async function recentDaily(db: D1Database, days: number): Promise<DailyRow[]> {
  const { results } = await db
    .prepare(
      'SELECT day, venue, avg_bps, min_bps, max_bps, samples FROM daily ORDER BY day DESC LIMIT ?1',
    )
    .bind(days * 8)
    .all<DailyRow>();
  return results;
}

export async function recentErrors(
  db: D1Database,
  since: number,
): Promise<{ ts: number; venue: string; message: string }[]> {
  const { results } = await db
    .prepare('SELECT ts, venue, message FROM fetch_errors WHERE ts >= ?1 ORDER BY ts DESC LIMIT 20')
    .bind(since)
    .all<{ ts: number; venue: string; message: string }>();
  return results;
}

export async function insertTicks(db: D1Database, ts: number, quotes: Quote[]): Promise<void> {
  if (quotes.length === 0) return;
  const statement = db.prepare(
    'INSERT OR REPLACE INTO ticks (ts, venue, bid, ask) VALUES (?1, ?2, ?3, ?4)',
  );
  await db.batch(quotes.map((q) => statement.bind(ts, q.venue, q.bid, q.ask)));
}

export async function insertErrors(
  db: D1Database,
  ts: number,
  errors: { venue: string; message: string }[],
): Promise<void> {
  if (errors.length === 0) return;
  const statement = db.prepare(
    'INSERT OR REPLACE INTO fetch_errors (ts, venue, message) VALUES (?1, ?2, ?3)',
  );
  await db.batch(errors.map((e) => statement.bind(ts, e.venue, e.message.slice(0, 200))));
}

/**
 * いま入った観測値が属する10分足を作り直す。
 *
 * 差分更新ではなく毎回その足だけを引き直す。読むのは最大でも40行程度で、
 * 差分計算のズレを永久に抱えるより、そのつど正しい値にするほうが安い。
 */
export async function refreshBucket(db: D1Database, ts: number): Promise<void> {
  const start = bucketOf(ts);
  const { results } = await db
    .prepare('SELECT venue, bid, ask FROM ticks WHERE ts >= ?1 AND ts < ?2')
    .bind(start, start + BUCKET_SECONDS)
    .all<{ venue: string; bid: number; ask: number }>();

  const summaries = summarize(results, (row) => row.venue);
  if (summaries.size === 0) return;

  const statement = db.prepare(
    `INSERT INTO buckets (bucket, venue, avg_bps, max_bps, min_bps, samples)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6)
     ON CONFLICT(bucket, venue) DO UPDATE SET
       avg_bps = excluded.avg_bps, max_bps = excluded.max_bps,
       min_bps = excluded.min_bps, samples = excluded.samples`,
  );
  await db.batch(
    [...summaries].map(([venue, s]) =>
      statement.bind(start, venue, s.avg, s.max, s.min, s.samples),
    ),
  );
}

/**
 * 日次集計を作り直す。生の観測値ではなく10分足から積む。
 *
 * 1日ぶんの生データは5,000行を超えるため、毎分なめると読み取り量が跳ね上がる。
 * 10分足なら144点で済み、samplesで重み付けすれば平均も正しく出る。
 */
export async function refreshDaily(db: D1Database, ts: number): Promise<void> {
  const day = jstDay(ts);
  const dayStart = Math.floor((ts + 9 * 3600) / 86_400) * 86_400 - 9 * 3600;

  const { results } = await db
    .prepare(
      'SELECT venue, avg_bps, max_bps, min_bps, samples FROM buckets WHERE bucket >= ?1 AND bucket < ?2',
    )
    .bind(dayStart, dayStart + 86_400)
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
    `INSERT INTO daily (day, venue, avg_bps, min_bps, max_bps, samples)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6)
     ON CONFLICT(day, venue) DO UPDATE SET
       avg_bps = excluded.avg_bps, min_bps = excluded.min_bps,
       max_bps = excluded.max_bps, samples = excluded.samples`,
  );
  await db.batch(
    [...byVenue].map(([venue, s]) =>
      statement.bind(day, venue, s.weighted / s.samples, s.min, s.max, s.samples),
    ),
  );
}

/** 古い生データを捨てる。10分足と日次は残るので、長期の比較はできる。 */
export async function pruneTicks(db: D1Database, now: number): Promise<void> {
  const cutoff = now - TICK_RETENTION_DAYS * 86_400;
  await db.batch([
    db.prepare('DELETE FROM ticks WHERE ts < ?1').bind(cutoff),
    db.prepare('DELETE FROM fetch_errors WHERE ts < ?1').bind(cutoff),
  ]);
}

function summarize<T extends { bid: number; ask: number }>(
  rows: T[],
  keyOf: (row: T) => string,
): Map<string, { avg: number; min: number; max: number; samples: number }> {
  const byKey = new Map<string, number[]>();
  for (const row of rows) {
    const key = keyOf(row);
    const list = byKey.get(key) ?? [];
    list.push(spreadBps(row.bid, row.ask));
    byKey.set(key, list);
  }

  const out = new Map<string, { avg: number; min: number; max: number; samples: number }>();
  for (const [key, values] of byKey) {
    out.set(key, {
      avg: values.reduce((a, b) => a + b, 0) / values.length,
      min: Math.min(...values),
      max: Math.max(...values),
      samples: values.length,
    });
  }
  return out;
}
