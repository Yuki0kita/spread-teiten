/**
 * 取引所ごとの気配値の取り方。
 *
 * どれも認証不要の公開APIで、板（取引所形式）の最良気配を返す。
 * 販売所レートは公開APIから取れないため、このサイトは扱わない。
 *
 * レスポンスの形も、銘柄の指定方法も取引所ごとにバラバラなので、
 * 「URLの組み立て」と「解釈」を分けて、解釈のほうだけをテストできるようにしている。
 */
import { isPlausible, type Quote } from './spread.ts';
import type { Book, Level } from './depth.ts';
import type { PairId } from './pairs.ts';

export type VenueId = 'gmo' | 'bitbank' | 'bitflyer' | 'coincheck';

export type Venue = {
  id: VenueId;
  label: string;
  /** 銘柄ごとの公開APIエンドポイント。 */
  url: (pair: PairId) => string;
  /** レスポンスから買値・売値を取り出す。取れなければ例外。 */
  parse: (payload: unknown) => { bid: number; ask: number };
  /** 板の深さを返す公開APIエンドポイント。 */
  bookUrl: (pair: PairId) => string;
  /** 板のレスポンスを共通の形にそろえる。 */
  parseBook: (payload: unknown) => Book;
};

export class VenueError extends Error {}

/** もう一度試せば直るかもしれない失敗（5xx・接続断）。 */
class RetriableError extends VenueError {}

/** 5xxを受けたときに待つ時間。長くすると全体の取得が遅れる。 */
const RETRY_DELAY_MS = 400;

/** 各取引所での銘柄の呼び方。同じBTCでも書き方が4通りある。 */
const SYMBOL: Record<PairId, { upper: string; lowerJpy: string; upperJpy: string }> = {
  btc: { upper: 'BTC', lowerJpy: 'btc_jpy', upperJpy: 'BTC_JPY' },
  eth: { upper: 'ETH', lowerJpy: 'eth_jpy', upperJpy: 'ETH_JPY' },
  xrp: { upper: 'XRP', lowerJpy: 'xrp_jpy', upperJpy: 'XRP_JPY' },
};

/** 表示順の基準にもなるので、ここの並びは触らない。 */
export const VENUES: readonly Venue[] = [
  {
    id: 'gmo',
    label: 'GMOコイン',
    url: (pair) => `https://api.coin.z.com/public/v1/ticker?symbol=${SYMBOL[pair].upper}`,
    parse: parseGmo,
    bookUrl: (pair) => `https://api.coin.z.com/public/v1/orderbooks?symbol=${SYMBOL[pair].upper}`,
    parseBook: parseGmoBook,
  },
  {
    id: 'bitbank',
    label: 'bitbank',
    url: (pair) => `https://public.bitbank.cc/${SYMBOL[pair].lowerJpy}/ticker`,
    parse: parseBitbank,
    bookUrl: (pair) => `https://public.bitbank.cc/${SYMBOL[pair].lowerJpy}/depth`,
    parseBook: parseBitbankBook,
  },
  {
    id: 'bitflyer',
    label: 'bitFlyer',
    url: (pair) => `https://api.bitflyer.com/v1/ticker?product_code=${SYMBOL[pair].upperJpy}`,
    parse: parseBitflyer,
    bookUrl: (pair) => `https://api.bitflyer.com/v1/getboard?product_code=${SYMBOL[pair].upperJpy}`,
    parseBook: parseBitflyerBook,
  },
  {
    id: 'coincheck',
    label: 'Coincheck',
    url: (pair) => `https://coincheck.com/api/ticker?pair=${SYMBOL[pair].lowerJpy}`,
    parse: parseCoincheck,
    // Coincheckの板はBTC/JPYのみ。他の銘柄はpairを付けても同じものが返るため、
    // 銘柄ごとに取り違えないよう明示的に指定する。
    bookUrl: (pair) => `https://coincheck.com/api/order_books?pair=${SYMBOL[pair].lowerJpy}`,
    parseBook: parseCoinCheckBook,
  },
];

export const VENUE_LABEL: Record<string, string> = Object.fromEntries(
  VENUES.map((v) => [v.id, v.label]),
);

/** 最新の観測値を取引所ごとに引くときに使う。 */
export const VENUE_IDS: readonly VenueId[] = VENUES.map((v) => v.id);

export function parseGmo(payload: unknown): { bid: number; ask: number } {
  const root = asObject(payload, 'GMOコイン');
  if (root['status'] !== 0) {
    throw new VenueError(`GMOコインがエラーを返しました: status=${String(root['status'])}`);
  }
  const rows = root['data'];
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new VenueError('GMOコインのdataが空です。');
  }
  const row = asObject(rows[0], 'GMOコイン');
  return { bid: toNumber(row['bid'], 'GMOコイン'), ask: toNumber(row['ask'], 'GMOコイン') };
}

export function parseBitbank(payload: unknown): { bid: number; ask: number } {
  const root = asObject(payload, 'bitbank');
  if (root['success'] !== 1) {
    throw new VenueError('bitbankがエラーを返しました。');
  }
  const data = asObject(root['data'], 'bitbank');
  // bitbankの sell は「売り注文の最安値」= こちらが買う値段（ask）。
  // buy は「買い注文の最高値」= こちらが売る値段（bid）。名前が直感と逆なので注意。
  return { bid: toNumber(data['buy'], 'bitbank'), ask: toNumber(data['sell'], 'bitbank') };
}

export function parseBitflyer(payload: unknown): { bid: number; ask: number } {
  const root = asObject(payload, 'bitFlyer');
  if (typeof root['error_message'] === 'string') {
    throw new VenueError(`bitFlyerがエラーを返しました: ${root['error_message']}`);
  }
  const state = root['state'];
  if (typeof state === 'string' && state !== 'RUNNING') {
    throw new VenueError(`bitFlyerの板が稼働していません: state=${state}`);
  }
  return {
    bid: toNumber(root['best_bid'], 'bitFlyer'),
    ask: toNumber(root['best_ask'], 'bitFlyer'),
  };
}

export function parseCoincheck(payload: unknown): { bid: number; ask: number } {
  const root = asObject(payload, 'Coincheck');
  return { bid: toNumber(root['bid'], 'Coincheck'), ask: toNumber(root['ask'], 'Coincheck') };
}

/* 板の解釈 ----------------------------------------------------------- */

/** [値段, 数量] の配列に直す。数値として読めない段は捨てる。 */
function toLevels(rows: unknown, who: string): Level[] {
  if (!Array.isArray(rows)) throw new VenueError(`${who}の板が配列ではありません。`);
  const levels: Level[] = [];
  for (const row of rows) {
    let price: unknown;
    let size: unknown;
    if (Array.isArray(row)) {
      [price, size] = row;
    } else if (typeof row === 'object' && row !== null) {
      const record = row as Record<string, unknown>;
      price = record['price'];
      size = record['size'];
    } else {
      continue;
    }
    const p = Number(price);
    const s = Number(size);
    if (Number.isFinite(p) && Number.isFinite(s) && p > 0 && s > 0) levels.push([p, s]);
  }
  if (levels.length === 0) throw new VenueError(`${who}の板が空です。`);
  return levels;
}

/** 板の並びを保証する。asksは安い順、bidsは高い順でないと食い進む計算が狂う。 */
function orderBook(asks: Level[], bids: Level[]): Book {
  return {
    asks: [...asks].sort((a, b) => a[0] - b[0]),
    bids: [...bids].sort((a, b) => b[0] - a[0]),
  };
}

export function parseGmoBook(payload: unknown): Book {
  const root = asObject(payload, 'GMOコイン');
  const data = asObject(root['data'], 'GMOコイン');
  return orderBook(toLevels(data['asks'], 'GMOコイン'), toLevels(data['bids'], 'GMOコイン'));
}

export function parseBitbankBook(payload: unknown): Book {
  const root = asObject(payload, 'bitbank');
  const data = asObject(root['data'], 'bitbank');
  return orderBook(toLevels(data['asks'], 'bitbank'), toLevels(data['bids'], 'bitbank'));
}

export function parseBitflyerBook(payload: unknown): Book {
  const root = asObject(payload, 'bitFlyer');
  return orderBook(toLevels(root['asks'], 'bitFlyer'), toLevels(root['bids'], 'bitFlyer'));
}

export function parseCoinCheckBook(payload: unknown): Book {
  const root = asObject(payload, 'Coincheck');
  return orderBook(toLevels(root['asks'], 'Coincheck'), toLevels(root['bids'], 'Coincheck'));
}

/**
 * 1銘柄について全取引所の板を同時に取る。
 *
 * 板は数十KBあるので、毎分すべての銘柄を取ると重い。呼び出す側で銘柄を回して、
 * 1回の実行では1銘柄だけにする。4取引所は同時に取る（同じ瞬間の板であることが前提）。
 */
export async function fetchBooks(
  pair: PairId,
  timeoutMs = 10_000,
): Promise<{ books: { venue: VenueId; book: Book }[]; errors: { venue: VenueId; message: string }[] }> {
  type BookResult = { venue: VenueId; book: Book } | { venue: VenueId; message: string };

  const results: BookResult[] = await Promise.all(
    VENUES.map(async (venue): Promise<BookResult> => {
      try {
        const response = await fetch(venue.bookUrl(pair), {
          headers: { Accept: 'application/json' },
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (!response.ok) throw new VenueError(`HTTP ${response.status}`);
        return { venue: venue.id, book: venue.parseBook(await response.json()) };
      } catch (error) {
        return { venue: venue.id, message: messageOf(error) };
      }
    }),
  );

  const books: { venue: VenueId; book: Book }[] = [];
  const errors: { venue: VenueId; message: string }[] = [];
  for (const result of results) {
    if ('message' in result) errors.push(result);
    else books.push(result);
  }
  return { books, errors };
}

/**
 * 1銘柄について全取引所を同時に取りにいく。1つが遅くても他を待たせない。
 *
 * 比較の前提は「同じ瞬間の値であること」なので、直列に取ってはいけない。
 */
export async function fetchPair(
  pair: PairId,
  timeoutMs = 8_000,
): Promise<{ quotes: Quote[]; errors: { venue: VenueId; message: string }[] }> {
  const results = await Promise.all(VENUES.map((venue) => fetchOne(venue, pair, timeoutMs)));

  const quotes: Quote[] = [];
  const errors: { venue: VenueId; message: string }[] = [];
  for (const result of results) {
    if ('message' in result) errors.push(result);
    else quotes.push(result);
  }
  return { quotes, errors };
}

/**
 * 1取引所ぶんの取得。5xxのときだけ一度だけ取り直す。
 *
 * bitFlyerはCloudflareの経路からだと503を返すことがあり、放っておくと
 * その取引所だけ観測が2割ほど欠ける。欠けた時間帯が値動きの荒い時間に偏ると、
 * その取引所の平均スプレッドが実際より狭く見えてしまう。
 * 解釈の失敗（レスポンスの形が違う等）は待っても直らないので、やり直さない。
 */
async function fetchOne(
  venue: Venue,
  pair: PairId,
  timeoutMs: number,
): Promise<Quote | { venue: VenueId; message: string }> {
  let last = '';
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await fetchQuote(venue, pair, timeoutMs);
    } catch (error) {
      last = messageOf(error);
      if (attempt === 0 && error instanceof RetriableError) {
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
        continue;
      }
      break;
    }
  }
  return { venue: venue.id, message: last };
}

async function fetchQuote(venue: Venue, pair: PairId, timeoutMs: number): Promise<Quote> {
  let response: Response;
  try {
    response = await fetch(venue.url(pair), {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    // 接続できなかった場合も、もう一度なら通ることがある。
    throw new RetriableError(messageOf(error));
  }

  if (response.status >= 500) {
    throw new RetriableError(`HTTP ${response.status}`);
  }
  if (!response.ok) {
    throw new VenueError(`HTTP ${response.status}`);
  }

  const { bid, ask } = venue.parse(await response.json());
  if (!isPlausible(bid, ask)) {
    throw new VenueError(`気配値が異常です: bid=${bid} ask=${ask}`);
  }
  return { venue: venue.id, bid, ask };
}

function asObject(value: unknown, who: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new VenueError(`${who}のレスポンスがオブジェクトではありません。`);
  }
  return value as Record<string, unknown>;
}

function toNumber(value: unknown, who: string): number {
  const parsed = typeof value === 'string' ? Number(value) : value;
  if (typeof parsed !== 'number' || !Number.isFinite(parsed)) {
    throw new VenueError(`${who}の気配値を数値として読めません: ${String(value)}`);
  }
  return parsed;
}

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
