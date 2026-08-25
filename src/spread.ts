/**
 * スプレッドの計算。このサイトが出す数字は全部ここを通る。
 *
 * 表示する数値は「実際に取得した気配値から計算したもの」だけに限る。
 * 取引手数料や販売所レートは実測できないので、いまは一切混ぜない。
 * 混ぜた瞬間に「全部実測」という、このサイトの唯一の強みが消えるため。
 */

/** 気配値が壊れているとみなす閾値。ここを超えたら記録しない。 */
export const MAX_PLAUSIBLE_BPS = 2000; // 20%

/** 10分足のバケット幅（秒）。 */
export const BUCKET_SECONDS = 600;

/** 生の観測値を残す日数。これより古いものは10分足と日次だけ残す。 */
export const TICK_RETENTION_DAYS = 14;

export type Quote = {
  venue: string;
  bid: number;
  ask: number;
};

export type Ranked = Quote & {
  bps: number;
  mid: number;
  costYen: number;
};

/**
 * スプレッドをbps（1bps = 0.01%）で返す。
 *
 * 分母は中値。売値・買値のどちらを分母にするかで値が変わるため、
 * 取引所間の比較では中値に揃えるのが一般的な流儀。
 */
export function spreadBps(bid: number, ask: number): number {
  assertQuote(bid, ask);
  const mid = (bid + ask) / 2;
  return ((ask - bid) / mid) * 10_000;
}

/**
 * その金額を「いま買って、いま売り戻した」ときに消える金額。
 *
 * 買うときは売値(ask)で約定し、売るときは買値(bid)で約定するので、
 * 手元に戻るのは amount × bid / ask。差分がスプレッドで失う額になる。
 */
export function roundTripCostYen(amountYen: number, bid: number, ask: number): number {
  assertQuote(bid, ask);
  if (!(amountYen > 0)) throw new RangeError('金額は1円以上で指定してください。');
  return (amountYen * (ask - bid)) / ask;
}

/**
 * スプレッド（bps）から往復コストを出す。
 *
 * 日次ページは気配値そのものではなく平均スプレッドしか持っていない。
 * 比率のままでは実感が湧かないので、必ず金額に直して見せるために使う。
 */
export function costFromBps(amountYen: number, bps: number): number {
  if (!(amountYen > 0)) throw new RangeError('金額は1円以上で指定してください。');
  if (bps <= 0) return 0;
  // 中値をmidとすると ask-bid = bps/10000*mid、ask = mid*(1+bps/20000)。
  // amount*(ask-bid)/ask を約分すると mid が消える。
  return (amountYen * (bps / 10_000)) / (1 + bps / 20_000);
}

/** 記録してよい気配値か。桁飛びや板停止をここで落とす。 */
export function isPlausible(bid: number, ask: number): boolean {
  if (!Number.isFinite(bid) || !Number.isFinite(ask)) return false;
  if (bid <= 0 || ask <= 0) return false;
  // 売値が買値を下回るのは板が壊れているか、取得タイミングがずれている。
  if (ask < bid) return false;
  return spreadBps(bid, ask) <= MAX_PLAUSIBLE_BPS;
}

/** スプレッドの狭い順に並べる。同値なら取引所IDで安定させる。 */
export function rank(quotes: Quote[], amountYen: number): Ranked[] {
  return quotes
    .map((q) => ({
      ...q,
      bps: spreadBps(q.bid, q.ask),
      mid: (q.bid + q.ask) / 2,
      costYen: roundTripCostYen(amountYen, q.bid, q.ask),
    }))
    .sort((a, b) => a.bps - b.bps || a.venue.localeCompare(b.venue));
}

/**
 * 同じ瞬間に取引所間でどれだけ価格がずれていたか。
 * スプレッドとは別軸の「取引所を選ぶ理由」になる数字。
 */
export function venueGapYen(quotes: Quote[]): number {
  if (quotes.length < 2) return 0;
  const mids = quotes.map((q) => (q.bid + q.ask) / 2);
  return Math.max(...mids) - Math.min(...mids);
}

/** UNIX秒を10分足のバケットに丸める。 */
export function bucketOf(ts: number): number {
  return Math.floor(ts / BUCKET_SECONDS) * BUCKET_SECONDS;
}

/** UNIX秒をJSTのYYYY-MM-DDにする。集計の区切りは日本時間に合わせる。 */
export function jstDay(ts: number): string {
  const jst = new Date((ts + 9 * 3600) * 1000);
  return jst.toISOString().slice(0, 10);
}

function assertQuote(bid: number, ask: number): void {
  if (!Number.isFinite(bid) || !Number.isFinite(ask)) {
    throw new RangeError('気配値が数値ではありません。');
  }
  if (bid <= 0 || ask <= 0) {
    throw new RangeError('気配値は正の数である必要があります。');
  }
}
