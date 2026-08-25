/**
 * 扱う通貨ペア。
 *
 * 「4取引所すべてが板を公開している」ことを条件にしている。
 * 2社しか対応していない銘柄を並べても、比較として意味が薄いため。
 * 増やすときは必ず全社のエンドポイントを実際に叩いて確かめる。
 */

export type PairId = 'btc' | 'eth' | 'xrp';

export type Pair = {
  id: PairId;
  /** 通貨コード。表示にもURLにも使う。 */
  code: string;
  nameJa: string;
  nameEn: string;
};

export const PAIRS: readonly Pair[] = [
  { id: 'btc', code: 'BTC', nameJa: 'ビットコイン', nameEn: 'Bitcoin' },
  { id: 'eth', code: 'ETH', nameJa: 'イーサリアム', nameEn: 'Ethereum' },
  { id: 'xrp', code: 'XRP', nameJa: 'リップル', nameEn: 'XRP' },
];

export const DEFAULT_PAIR: PairId = 'btc';

export const PAIR_IDS: readonly PairId[] = PAIRS.map((p) => p.id);

export function findPair(id: string | undefined): Pair | undefined {
  return PAIRS.find((p) => p.id === id);
}
