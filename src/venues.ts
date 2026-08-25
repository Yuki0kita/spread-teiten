/**
 * 取引所ごとの気配値の取り方。
 *
 * どれも認証不要の公開APIで、板（取引所形式）の最良気配を返す。
 * 販売所レートは公開APIから取れないため、このサイトは扱わない。
 *
 * レスポンスの形は取引所ごとにバラバラなので、
 * 「取得」と「解釈」を分けて、解釈のほうだけをテストできるようにしている。
 */
import { isPlausible, type Quote } from './spread.ts';

export type VenueId = 'gmo' | 'bitbank' | 'bitflyer' | 'coincheck';

export type Venue = {
  id: VenueId;
  label: string;
  /** 板の気配値を返す公開APIエンドポイント。 */
  url: string;
  /** レスポンスから買値・売値を取り出す。取れなければ例外。 */
  parse: (payload: unknown) => { bid: number; ask: number };
};

export class VenueError extends Error {}

/** 表示順の基準にもなるので、ここの並びは触らない。 */
export const VENUES: readonly Venue[] = [
  {
    id: 'gmo',
    label: 'GMOコイン',
    url: 'https://api.coin.z.com/public/v1/ticker?symbol=BTC',
    parse: parseGmo,
  },
  {
    id: 'bitbank',
    label: 'bitbank',
    url: 'https://public.bitbank.cc/btc_jpy/ticker',
    parse: parseBitbank,
  },
  {
    id: 'bitflyer',
    label: 'bitFlyer',
    url: 'https://api.bitflyer.com/v1/ticker?product_code=BTC_JPY',
    parse: parseBitflyer,
  },
  {
    id: 'coincheck',
    label: 'Coincheck',
    url: 'https://coincheck.com/api/ticker',
    parse: parseCoincheck,
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

/**
 * 全取引所を同時に取りにいく。1つが遅くても他を待たせない。
 *
 * 比較の前提は「同じ瞬間の値であること」なので、直列に取ってはいけない。
 */
export async function fetchAll(
  timeoutMs = 8_000,
): Promise<{ quotes: Quote[]; errors: { venue: VenueId; message: string }[] }> {
  const results = await Promise.all(VENUES.map((venue) => fetchOne(venue, timeoutMs)));

  const quotes: Quote[] = [];
  const errors: { venue: VenueId; message: string }[] = [];
  for (const result of results) {
    if ('message' in result) errors.push(result);
    else quotes.push(result);
  }
  return { quotes, errors };
}

async function fetchOne(
  venue: Venue,
  timeoutMs: number,
): Promise<Quote | { venue: VenueId; message: string }> {
  try {
    const response = await fetch(venue.url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) {
      throw new VenueError(`HTTP ${response.status}`);
    }
    const { bid, ask } = venue.parse(await response.json());
    if (!isPlausible(bid, ask)) {
      throw new VenueError(`気配値が異常です: bid=${bid} ask=${ask}`);
    }
    return { venue: venue.id, bid, ask };
  } catch (error) {
    return { venue: venue.id, message: messageOf(error) };
  }
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
