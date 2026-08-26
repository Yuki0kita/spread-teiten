/**
 * アクセスの集計。
 *
 * 外部の解析サービスを入れない。CSPを緩めることになり、Cookieも増える。
 * このサイトは「自分で測る」ことを売りにしているので、解析も自分で測る。
 *
 * 記録するのは日付・パス・リファラのホスト名・国だけ。
 * IPもCookieもUser-Agentも保存しない。個人を追いかけるためではなく、
 * 「どこから来て、どの画面を見ているか」を数えるためのもの。
 *
 * リファラは**ホスト名だけ**にする。URL全体にはクエリが付いていることがあり、
 * そこに他所のサイトの個人情報が混ざっていることがある。
 */

/** 集計するパスの上限。想定外のパスで行が増え続けるのを防ぐ。 */
const MAX_PATH_LENGTH = 120;

export type Visit = {
  day: string;
  path: string;
  referrer: string;
  country: string;
};

/**
 * 数えるべきリクエストか。
 *
 * 画面だけを数える。APIや静的ファイルまで数えると、
 * 自動更新のたびに行が増えて「人が来た数」が分からなくなる。
 */
export function isCountable(path: string, method: string): boolean {
  if (method !== 'GET') return false;
  if (path.startsWith('/api/')) return false;
  if (path.startsWith('/internal/')) return false;
  if (path === '/robots.txt' || path === '/sitemap.xml') return false;
  // 拡張子のあるものは静的ファイル
  if (/\.[a-z0-9]{2,5}$/i.test(path)) return false;
  return true;
}

/**
 * リファラからホスト名だけを取り出す。
 * 自分のサイト内の移動は流入ではないので落とす。
 */
export function referrerHost(referrer: string | undefined, selfHost: string): string {
  if (!referrer) return 'direct';
  try {
    const host = new URL(referrer).hostname;
    if (!host) return 'direct';
    if (host === selfHost) return 'self';
    return host.slice(0, 80);
  } catch {
    return 'direct';
  }
}

/** パスを正規化する。クエリは落とし、長さを切る。 */
export function normalizePath(path: string): string {
  const withoutQuery = path.split('?')[0] ?? '/';
  return withoutQuery.slice(0, MAX_PATH_LENGTH) || '/';
}

/**
 * 1件を数える。
 *
 * 応答を待たせないよう、呼び出し側は waitUntil に渡す。
 * 失敗しても握りつぶす。解析が落ちて画面が出なくなるほうが困る。
 */
export async function recordVisit(db: D1Database, visit: Visit): Promise<void> {
  try {
    await db
      .prepare(
        `INSERT INTO visits (day, path, referrer, country, count) VALUES (?1, ?2, ?3, ?4, 1)
         ON CONFLICT(day, path, referrer, country) DO UPDATE SET count = count + 1`,
      )
      .bind(visit.day, visit.path, visit.referrer, visit.country)
      .run();
  } catch {
    // 数えられなかっただけ。画面には影響させない。
  }
}
