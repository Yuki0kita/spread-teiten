/**
 * 観測の1回ぶん。CronからもHTTPからも同じものを呼ぶ。
 *
 * CloudflareのCron Triggerは、登録されていても発火しないことがある
 * （新規アカウントで実際に起きた）。スケジューラが1つしかないと、
 * 黙って止まったときに気づけないままデータが欠ける。
 * そこで収集本体をここに出して、外部のスケジューラからも叩けるようにしてある。
 *
 * 同じ分に何度呼ばれても結果は変わらない（tsを分単位に丸めた
 * INSERT OR REPLACE なので、行が増えずに上書きされる）。
 */
import { fetchAll } from './venues.ts';
import { insertErrors, insertTicks, pruneTicks, refreshBucket, refreshDaily } from './store.ts';

export type CollectResult = {
  ts: number;
  collected: number;
  failed: string[];
  /** その分ぶんが既にあり、取得を省いたか。 */
  skipped?: boolean;
};

/**
 * 4取引所を同時に取って記録する。
 *
 * 同じ分ぶんが既にあるなら何もしない。
 * このガードが無いと、収集トークンが漏れたときに、
 * このWorkerを踏み台にして取引所のAPIを好きなだけ叩けてしまう。
 * 通常の5分間隔の呼び出しは毎回ちがう分になるので、ここで止まることはない。
 *
 * @param atMs 観測時刻（ミリ秒）。分単位に丸めて全取引所で同じtsにそろえる。
 */
export async function collectOnce(db: D1Database, atMs: number): Promise<CollectResult> {
  const ts = Math.floor(atMs / 1000 / 60) * 60;

  const existing = await db
    .prepare('SELECT COUNT(*) AS c FROM ticks WHERE ts = ?1')
    .bind(ts)
    .first<{ c: number }>();
  if ((existing?.c ?? 0) > 0) {
    return { ts, collected: 0, failed: [], skipped: true };
  }

  const { quotes, errors } = await fetchAll();

  await insertTicks(db, ts, quotes);
  await insertErrors(db, ts, errors);

  if (quotes.length > 0) {
    await refreshBucket(db, ts);
  }

  const jst = new Date((ts + 9 * 3600) * 1000);
  const minute = jst.getUTCMinutes();
  const hour = jst.getUTCHours();

  // 日次集計は1時間に1回で足りる。毎回やると10分足を24時間ぶん読むことになる。
  if (minute % 60 === 3) {
    await refreshDaily(db, ts);
  }
  // 日付が変わった直後に前日ぶんを確定させ、古い生データを捨てる。
  if (hour === 0 && minute < 10) {
    await refreshDaily(db, ts - 3600);
    await pruneTicks(db, ts);
  }

  return { ts, collected: quotes.length, failed: errors.map((e) => e.venue) };
}

/**
 * トークンの照合。長さと内容の両方を、比較にかかる時間が変わらない形で見る。
 *
 * 素朴な `===` は先頭から一致しなくなった時点で返るため、
 * 応答時間の差から1文字ずつ推測されうる。
 */
export function tokenMatches(provided: string | undefined, expected: string): boolean {
  if (!expected || !provided) return false;
  if (provided.length !== expected.length) return false;

  let diff = 0;
  for (let i = 0; i < expected.length; i += 1) {
    diff |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}

/** `Authorization: Bearer xxx` からトークンだけ取り出す。 */
export function bearerToken(header: string | undefined): string | undefined {
  if (!header) return undefined;
  const match = /^Bearer\s+(.+)$/.exec(header.trim());
  return match?.[1];
}
