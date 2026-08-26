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
import { PAIR_IDS, type PairId } from './pairs.ts';
import { costLadder } from './depth.ts';
import { fetchBooks, fetchPair } from './venues.ts';
import {
  hasTicksAt,
  insertDepth,
  insertErrors,
  insertTicks,
  pruneTicks,
  refreshBucket,
  refreshDaily,
} from './store.ts';

export type CollectResult = {
  ts: number;
  collected: number;
  failed: string[];
  /** その分ぶんが既にあり、取得を省いたか。 */
  skipped?: boolean;
};

/**
 * 全銘柄について、4取引所を同時に取って記録する。
 *
 * 銘柄どうしは並列にしない。同時に12本の外部リクエストを投げると、
 * 取引所から見て一気に負荷が上がるため、銘柄は順番に処理する。
 * 1銘柄の中の4取引所だけ並列にする（同じ瞬間の値であることが比較の前提なので）。
 *
 * @param atMs 観測時刻（ミリ秒）。分単位に丸めて全取引所で同じtsにそろえる。
 */
export async function collectOnce(db: D1Database, atMs: number): Promise<CollectResult> {
  const ts = Math.floor(atMs / 1000 / 60) * 60;

  // 同じ分ぶんが既にあるなら何もしない。
  // このガードが無いと、収集トークンが漏れたときに、このWorkerを踏み台にして
  // 取引所のAPIを好きなだけ叩けてしまう。通常の呼び出しは毎回ちがう分になる。
  if (await hasTicksAt(db, PAIR_IDS[0] as PairId, ts)) {
    return { ts, collected: 0, failed: [], skipped: true };
  }

  let collected = 0;
  const failed: string[] = [];

  for (const pair of PAIR_IDS) {
    const { quotes, errors } = await fetchPair(pair);

    await insertTicks(db, pair, ts, quotes);
    await insertErrors(db, pair, ts, errors);
    if (quotes.length > 0) {
      await refreshBucket(db, pair, ts);
    }

    collected += quotes.length;
    for (const error of errors) failed.push(`${pair}/${error.venue}`);
  }

  await collectDepth(db, ts, failed);
  await rollUp(db, ts);
  return { ts, collected, failed };
}

/**
 * 板の深さから実効コストを出す。1回の実行では1銘柄だけ。
 *
 * 板は1銘柄あたり合計150KBほどあるので、毎回すべての銘柄を取ると重い。
 * 銘柄を順に回して、それぞれ数分に1回ずつ更新する。
 * 同じ銘柄の4取引所は同時に取る。別の瞬間の板を並べると比較にならないため。
 */
async function collectDepth(db: D1Database, ts: number, failed: string[]): Promise<void> {
  const pair = PAIR_IDS[Math.floor(ts / 60) % PAIR_IDS.length] as PairId;
  const { books, errors } = await fetchBooks(pair);

  await insertDepth(
    db,
    pair,
    ts,
    books.map(({ venue, book }) => ({ venue, costs: JSON.stringify(costLadder(book)) })),
  );

  for (const error of errors) failed.push(`${pair}/${error.venue}/board`);
}

/**
 * 重い集計をまとめて回す。毎回やると読み取り量が跳ね上がるので間引く。
 *
 * 判定の窓を広めに取っているのは、外部スケジューラの実行時刻がずれるため。
 * 「ちょうど何分」で判定すると、数分の遅延でその時間ぶんの集計を丸ごと落とす。
 * 集計はどれも上書き（UPSERT）なので、多めに回っても壊れない。
 */
async function rollUp(db: D1Database, ts: number): Promise<void> {
  const jst = new Date((ts + 9 * 3600) * 1000);
  const minute = jst.getUTCMinutes();
  const hour = jst.getUTCHours();

  // その日ぶんの日次集計。毎時0〜9分の間に来た回で作り直す。
  const hourly = minute < 10;
  // 前日ぶんの確定。0時台に来た回はすべてやる。ここを取りこぼすと
  // 前日のページが未完成のまま残り、二度と直らない。
  const closeYesterday = hour === 0;
  // 生データの削除。落としても翌日やり直せるので窓は狭くてよい。
  const prune = hour === 4 && minute < 10;

  if (!hourly && !closeYesterday && !prune) return;

  for (const pair of PAIR_IDS) {
    if (hourly || closeYesterday) await refreshDaily(db, pair, ts);
    if (closeYesterday) await refreshDaily(db, pair, ts - 3600);
  }

  if (prune) await pruneTicks(db, ts);
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
