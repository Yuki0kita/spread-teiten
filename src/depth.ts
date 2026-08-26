/**
 * 板を食ったときの実効コスト。
 *
 * 最良気配だけを見ていると、10万円でも1,000万円でもコストが比例するように見える。
 * 実際は板の一番上に並んでいる量はごくわずかで、金額が大きいほど下の値段まで
 * 食い進むことになり、コストは比例より速く増える。
 *
 * 実測すると、金額によって「いちばん安い取引所」自体が入れ替わる。
 * 板の薄い取引所は小口では良く見えるのに、大口では最下位になる。
 * その入れ替わりこそが、取引所を選ぶときに本当に効く情報になる。
 */

/** [値段, 数量] の並び。asksは安い順、bidsは高い順に並んでいる前提。 */
export type Level = readonly [price: number, size: number];

export type Book = {
  asks: Level[];
  bids: Level[];
};

/**
 * 画面に出す金額のはしご。
 *
 * 自由入力にすると桁ごとの違いが見えにくく、板を歩く計算も金額のたびに必要になる。
 * 意思決定に効くのは「自分の桁ではどこが安いか」なので、桁で刻む。
 */
export const AMOUNT_LADDER = [100_000, 300_000, 1_000_000, 3_000_000, 10_000_000] as const;

export type LadderAmount = (typeof AMOUNT_LADDER)[number];

/** 板が壊れているとみなす条件。ここを通さないと嘘の安値が出る。 */
export function isSaneBook(book: Book): boolean {
  const bestAsk = book.asks[0];
  const bestBid = book.bids[0];
  if (!bestAsk || !bestBid) return false;
  if (bestAsk[0] <= 0 || bestBid[0] <= 0) return false;
  // 売値が買値以下になっている板は取得タイミングがずれているか壊れている。
  if (bestAsk[0] <= bestBid[0]) return false;
  return true;
}

/**
 * 指定金額ぶん買い上がったときに手に入る数量。
 * 板を全部食っても足りなければ null（その取引所では約定しきれない）。
 */
export function buyQuantity(asks: Level[], amountYen: number): number | null {
  let remaining = amountYen;
  let quantity = 0;
  for (const [price, size] of asks) {
    if (price <= 0 || size <= 0) continue;
    const levelCost = price * size;
    if (levelCost >= remaining) {
      return quantity + remaining / price;
    }
    remaining -= levelCost;
    quantity += size;
  }
  return null;
}

/** その数量を売り下がったときに戻ってくる金額。板が足りなければ null。 */
export function sellProceeds(bids: Level[], quantity: number): number | null {
  let remaining = quantity;
  let proceeds = 0;
  for (const [price, size] of bids) {
    if (price <= 0 || size <= 0) continue;
    if (size >= remaining) {
      return proceeds + remaining * price;
    }
    remaining -= size;
    proceeds += size * price;
  }
  return null;
}

/**
 * その金額を買って、すぐ売り戻したときに消える金額。
 * 板が足りずに往復できない場合は null を返し、画面では「板が足りない」と出す。
 */
export function roundTripCost(book: Book, amountYen: number): number | null {
  if (!isSaneBook(book) || !(amountYen > 0)) return null;
  const quantity = buyQuantity(book.asks, amountYen);
  if (quantity === null) return null;
  const proceeds = sellProceeds(book.bids, quantity);
  if (proceeds === null) return null;
  return amountYen - proceeds;
}

/** はしごの全段について実効コストを出す。取れない段は null のまま残す。 */
export function costLadder(book: Book): Record<string, number | null> {
  const out: Record<string, number | null> = {};
  for (const amount of AMOUNT_LADDER) {
    out[String(amount)] = roundTripCost(book, amount);
  }
  return out;
}

/** 保存したJSONを読み戻す。壊れていたら空として扱い、画面を止めない。 */
export function parseLadder(raw: string): Record<string, number | null> {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return {};
    const out: Record<string, number | null> = {};
    for (const amount of AMOUNT_LADDER) {
      const value = (parsed as Record<string, unknown>)[String(amount)];
      out[String(amount)] = typeof value === 'number' && Number.isFinite(value) ? value : null;
    }
    return out;
  } catch {
    return {};
  }
}
