/**
 * D1への読み取りをエッジのキャッシュで抑える。
 *
 * このサイトは誰でも叩けるJSONを公開している。素直に作ると、
 * `/api/history.json` を1回読むたびにD1から576行を読むことになり、
 * 少し連打されただけで1日の無料枠（読み取り500万行）が飛ぶ。
 * それはコストの問題ではなく、その日1日サイトが死ぬという可用性の問題になる。
 *
 * 対策は素直に「同じ結果を何度もDBに聞かない」こと。
 * キャッシュキーに時刻を量子化して埋め、観測が更新される間隔でだけ作り直す。
 * 金額のようなクエリで結果が変わらない読み取りは、キーに含めない。
 */

/** 観測の間隔より短く作り直しても意味がないが、鮮度は落としたくないのでこの粒度。 */
export const LATEST_TTL_SECONDS = 60;

/** 10分足は10分ごとにしか増えない。 */
export const HISTORY_TTL_SECONDS = 600;

/** 日次集計は1時間に1回しか書き換わらない。 */
export const DAILY_TTL_SECONDS = 3600;

/** キャッシュキーの名前空間。実在しないホスト名を使う（外に出るリクエストではない）。 */
const CACHE_ORIGIN = 'https://cache.spread-teiten.internal';

/**
 * 時刻を粒度で切り捨ててキーに混ぜる。
 * TTL任せにせず、キー自体を変えることで「更新のたびに必ず作り直る」状態にする。
 */
export function versionedKey(name: string, now: number, granularitySeconds: number): string {
  return `${name}:${Math.floor(now / granularitySeconds)}`;
}

/**
 * キャッシュがあればそれを返し、無ければ読み込んで裏で保存する。
 *
 * 保存に失敗しても読み取り自体は成功させる。キャッシュは速度と枠の保護であって、
 * ここで落ちて画面が出なくなるほうが損。
 */
export async function cachedRead<T>(
  key: string,
  waitUntil: (promise: Promise<unknown>) => void,
  ttlSeconds: number,
  load: () => Promise<T>,
): Promise<T> {
  const cache = caches.default;
  const cacheKey = new Request(`${CACHE_ORIGIN}/${encodeURIComponent(key)}`);

  const hit = await cache.match(cacheKey);
  if (hit) {
    try {
      return (await hit.json()) as T;
    } catch {
      // 壊れたキャッシュは無視して取り直す
    }
  }

  const data = await load();
  const stored = new Response(JSON.stringify(data), {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': `public, max-age=${ttlSeconds}`,
    },
  });
  waitUntil(cache.put(cacheKey, stored));
  return data;
}
