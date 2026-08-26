/**
 * スプレッド定点のエントリポイント。
 *
 * やることは2つだけ。
 *   1. 定期的に4取引所の気配値を同時に取って記録する（scheduled / POST /internal/collect）
 *   2. 記録した値を読んで画面とJSONで返す（fetch）
 *
 * URLは `/{lang}/{pair}/{date}/` の形。言語をパラメータではなくパスに置くのは、
 * 検索エンジンに別ページとして正しく扱わせるため。
 */
import { Hono } from 'hono';
import type { Context } from 'hono';
import { bucketOf, jstDay, rank, spreadBps, venueGapYen } from './spread.ts';
import {
  cachedRead,
  DAILY_TTL_SECONDS,
  HISTORY_TTL_SECONDS,
  LATEST_TTL_SECONDS,
  versionedKey,
} from './cache.ts';
import { DEFAULT_LOCALE, isLocale, localeFromHeader, LOCALES, type Locale } from './i18n.ts';
import { DEFAULT_PAIR, findPair, PAIRS, PAIR_IDS, type PairId } from './pairs.ts';
import {
  clampAmount,
  dayPath,
  homePath,
  pairPath,
  renderDailyPage,
  renderNotFound,
  renderPairPage,
  renderWatch,
} from './render.ts';
import { VENUE_IDS, VENUE_LABEL } from './venues.ts';
import { levelOf, median, ratioOf, type VenuePulse } from './pulse.ts';
import { isCountable, normalizePath, recordVisit, referrerHost } from './visits.ts';
import { parseLadder } from './depth.ts';
import { bearerToken, collectOnce, tokenMatches } from './collect.ts';
import {
  bucketSeries,
  bucketsSince,
  dailyFor,
  daysWithData,
  latestDepth,
  latestTicks,
  recentDaily,
  recentErrors,
  type BucketRow,
  type DailyRow,
  type DepthRow,
  type Tick,
} from './store.ts';

type Bindings = {
  DB: D1Database;
  SITE_URL: string;
  ASSETS: Fetcher;
  /** 外部スケジューラから観測を叩くためのトークン。未設定なら経路ごと無効。 */
  COLLECT_TOKEN?: string;
};

/** CSSとJSのキャッシュを確実に切り替えるための版。変更したら上げる。 */
const ASSET_VERSION = '14';

const DEFAULT_HISTORY_HOURS = 24;
const MAX_HISTORY_HOURS = 24 * 14;

/** 銘柄ページに並べる日別リンクの数。多すぎると本題がぼやける。 */
const RECENT_DAYS_ON_PAGE = 14;

/** YYYY-MM-DD 以外を日付として受け取らない。 */
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const app = new Hono<{ Bindings: Bindings }>();

/**
 * 全レスポンスに保護ヘッダを付ける。
 * インラインのscript/styleを使っていないので、CSPは 'self' だけで足りる。
 */
app.use('*', async (c, next) => {
  await next();

  // 画面が表示されたことだけを数える。応答は待たせない。
  if (isCountable(c.req.path, c.req.method) && c.res.status === 200) {
    const url = new URL(c.req.url);
    c.executionCtx.waitUntil(
      recordVisit(c.env.DB, {
        day: jstDay(nowSeconds()),
        path: normalizePath(c.req.path),
        referrer: referrerHost(c.req.header('Referer'), url.hostname),
        country: (c.req.raw as { cf?: { country?: string } }).cf?.country ?? 'unknown',
      }),
    );
  }

  c.header('X-Content-Type-Options', 'nosniff');
  c.header('X-Frame-Options', 'DENY');
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  c.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  c.header(
    'Content-Security-Policy',
    [
      "default-src 'none'",
      "script-src 'self'",
      "style-src 'self'",
      "img-src 'self' data:",
      "connect-src 'self'",
      "form-action 'self'",
      "base-uri 'none'",
      "frame-ancestors 'none'",
    ].join('; '),
  );
});

/** 言語なしで来たら、ブラウザの設定を見て振り分ける。 */
app.get('/', (c) => c.redirect(homePath(localeFromHeader(c.req.header('Accept-Language'))), 302));

/* 画面 --------------------------------------------------------------- */

app.get('/:locale{(ja|en)}/', async (c) => {
  const locale = c.req.param('locale') as Locale;
  const now = nowSeconds();
  const pairs = await Promise.all(PAIRS.map((pair) => pulseFor(c, pair.id, now)));

  return html(
    c,
    renderWatch({
      locale,
      siteUrl: siteUrl(c),
      assetVersion: ASSET_VERSION,
      now,
      pairs: pairs.map((p, i) => ({
        pair: PAIRS[i] as (typeof PAIRS)[number],
        observedAt: p.observedAt,
        venues: p.venues,
      })),
    }),
  );
});

app.get('/:locale{(ja|en)}/:pair/', async (c) => {
  const locale = c.req.param('locale') as Locale;
  const pair = findPair(c.req.param('pair'));
  if (!pair) return notFound(c, locale);

  const now = nowSeconds();
  const amountYen = clampAmount(c.req.query('amount'));
  const ticks = await readLatest(c, pair.id, now);
  const recentDays = (await readDays(c, pair.id, now)).slice(0, RECENT_DAYS_ON_PAGE);
  const depthRows = await readDepth(c, pair.id, now);

  return html(
    c,
    renderPairPage({
      locale,
      siteUrl: siteUrl(c),
      assetVersion: ASSET_VERSION,
      pair,
      amountYen,
      ranked: rank(ticks, amountYen),
      gapYen: venueGapYen(ticks),
      observedAt: ticks.length > 0 ? Math.max(...ticks.map((t) => t.ts)) : null,
      now,
      recentDays,
      depth: depthRows.map((row) => ({ venue: row.venue, costs: parseLadder(row.costs) })),
    }),
  );
});

app.get('/:locale{(ja|en)}/:pair/:day/', async (c) => {
  const locale = c.req.param('locale') as Locale;
  const pair = findPair(c.req.param('pair'));
  const day = c.req.param('day');
  if (!pair || !DAY_PATTERN.test(day)) return notFound(c, locale);

  const now = nowSeconds();
  const rows = await cachedRead<DailyRow[]>(
    versionedKey(`day:${pair.id}:${day}`, now, DAILY_TTL_SECONDS),
    waitUntil(c),
    DAILY_TTL_SECONDS,
    () => dailyFor(c.env.DB, pair.id, day),
  );
  // 記録の無い日付をページとして残すと、中身の無いURLが無限に生えてしまう。
  if (rows.length === 0) return notFound(c, locale);

  const days = await readDays(c, pair.id, now);
  const index = days.indexOf(day);

  return html(
    c,
    renderDailyPage({
      locale,
      siteUrl: siteUrl(c),
      assetVersion: ASSET_VERSION,
      pair,
      day,
      rows,
      // daysは新しい順。ひとつ後ろの要素が「前の日」になる。
      prevDay: index >= 0 ? (days[index + 1] ?? null) : null,
      nextDay: index > 0 ? (days[index - 1] ?? null) : null,
      amountYen: clampAmount(c.req.query('amount')),
    }),
  );
});

/* データ ------------------------------------------------------------- */

app.get('/api/latest.json', async (c) => {
  const now = nowSeconds();
  const pair = pairFromQuery(c.req.query('pair'));
  const ticks = await readLatest(c, pair, now);
  const ranked = rank(ticks, clampAmount(c.req.query('amount')));

  return json(c, {
    pair,
    observed_at: ticks.length > 0 ? Math.max(...ticks.map((t) => t.ts)) : null,
    venue_gap_yen: venueGapYen(ticks),
    venues: ranked.map((row) => ({
      venue: row.venue,
      label: VENUE_LABEL[row.venue] ?? row.venue,
      bid: row.bid,
      ask: row.ask,
      mid: row.mid,
      spread_bps: round(row.bps, 6),
      cost_yen: round(row.costYen, 4),
    })),
  });
});

app.get('/api/history.json', async (c) => {
  const now = nowSeconds();
  const pair = pairFromQuery(c.req.query('pair'));
  const hours = clampHours(c.req.query('hours'));
  const rows = await cachedRead<BucketRow[]>(
    versionedKey(`history:${pair}:${hours}`, now, HISTORY_TTL_SECONDS),
    waitUntil(c),
    HISTORY_TTL_SECONDS,
    () => bucketsSince(c.env.DB, pair, bucketOf(now - hours * 3600)),
  );

  return json(c, {
    pair,
    bucket_seconds: 600,
    hours,
    points: rows.map((row) => ({
      t: row.bucket,
      venue: row.venue,
      avg_bps: round(row.avg_bps, 6),
      max_bps: round(row.max_bps, 6),
      min_bps: round(row.min_bps, 6),
      samples: row.samples,
    })),
  });
});

app.get('/api/daily.json', async (c) => {
  const now = nowSeconds();
  const pair = pairFromQuery(c.req.query('pair'));
  const rows = await cachedRead<DailyRow[]>(
    versionedKey(`daily:${pair}`, now, DAILY_TTL_SECONDS),
    waitUntil(c),
    DAILY_TTL_SECONDS,
    () => recentDaily(c.env.DB, pair, 90),
  );

  return json(c, {
    pair,
    days: rows.map((row) => ({
      day: row.day,
      venue: row.venue,
      avg_bps: round(row.avg_bps, 6),
      min_bps: round(row.min_bps, 6),
      max_bps: round(row.max_bps, 6),
      samples: row.samples,
    })),
  });
});

/**
 * 監視画面が定期的に読むもの。
 *
 * 画面を開きっぱなしにしてもらう前提なので、ここだけは頻度が高くなる。
 * 最新値と基準（中央値）で作り直す間隔を分けてあり、
 * 何人が開いていてもD1への読み取りは一定に収まる。
 */
app.get('/api/pulse.json', async (c) => {
  const now = nowSeconds();
  const pairs = await Promise.all(PAIRS.map((pair) => pulseFor(c, pair.id, now)));

  return json(c, {
    observed_at: Math.max(0, ...pairs.flatMap((p) => (p.observedAt ? [p.observedAt] : []))) || null,
    pairs: pairs.map((p) => ({
      pair: p.pair,
      observed_at: p.observedAt,
      venues: p.venues.map((v) => ({
        venue: v.venue,
        label: VENUE_LABEL[v.venue] ?? v.venue,
        spread_bps: v.bps === null ? null : round(v.bps, 6),
        baseline_bps: v.baselineBps === null ? null : round(v.baselineBps, 6),
        ratio: v.ratio === null ? null : round(v.ratio, 2),
        level: v.level,
        spark: v.spark.map((n) => round(n, 4)),
      })),
    })),
  });
});

/** 欠測を隠さないための確認用。運用の健全性はここで見る。 */
app.get('/api/errors.json', async (c) => {
  const now = nowSeconds();
  const rows = await cachedRead(
    versionedKey('errors', now, LATEST_TTL_SECONDS),
    waitUntil(c),
    LATEST_TTL_SECONDS,
    () => recentErrors(c.env.DB, now - 86_400),
  );
  return json(c, { errors: rows });
});

/* クロール導線 ------------------------------------------------------- */

app.get('/robots.txt', (c) =>
  c.text(`User-agent: *\nAllow: /\n\nSitemap: ${siteUrl(c)}/sitemap.xml\n`, 200, {
    'Cache-Control': 'public, max-age=86400',
  }),
);

/**
 * サイトマップ。日別ページはデータが増えるだけ自動で載る。
 *
 * 記録のある日付だけを並べる。存在しない日付を載せると、
 * クロールされて404が返り、サイト全体の評価を落とす。
 */
app.get('/sitemap.xml', async (c) => {
  const now = nowSeconds();
  const url = siteUrl(c);

  const body = await cachedRead<string>(
    versionedKey('sitemap', now, DAILY_TTL_SECONDS),
    waitUntil(c),
    DAILY_TTL_SECONDS,
    async () => {
      const paths: string[] = [];
      for (const locale of LOCALES) paths.push(homePath(locale));

      for (const pairId of PAIR_IDS) {
        for (const locale of LOCALES) paths.push(pairPath(locale, pairId));
        const days = await daysWithData(c.env.DB, pairId);
        for (const day of days) {
          for (const locale of LOCALES) paths.push(dayPath(locale, pairId, day));
        }
      }

      const entries = paths.map((path) => `  <url><loc>${url}${path}</loc></url>`).join('\n');
      return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries}\n</urlset>\n`;
    },
  );

  return c.body(body, 200, {
    'Content-Type': 'application/xml; charset=utf-8',
    'Cache-Control': 'public, max-age=3600',
  });
});

/* 収集 --------------------------------------------------------------- */

/**
 * 外部スケジューラ用の観測エンドポイント。
 *
 * CloudflareのCronが発火しないことがあるため、別経路を残している。
 * トークンが合わないときは401ではなく404を返す。
 * 「存在するが弾かれた」と分かると、そこを狙う理由を与えることになる。
 */
app.post('/internal/collect', async (c) => {
  const expected = c.env.COLLECT_TOKEN ?? '';
  if (!tokenMatches(bearerToken(c.req.header('Authorization')), expected)) {
    return notFound(c, DEFAULT_LOCALE);
  }

  const result = await collectOnce(c.env.DB, Date.now());
  return c.json(result, 200, { 'Cache-Control': 'no-store' });
});

/**
 * アクセスの集計。個人は特定できないが、事業の数字なのでトークンで守る。
 *
 *   curl -H "Authorization: Bearer $(cat .collect-token)" .../internal/visits.json
 */
app.get('/internal/visits.json', async (c) => {
  if (!tokenMatches(bearerToken(c.req.header('Authorization')), c.env.COLLECT_TOKEN ?? '')) {
    return notFound(c, DEFAULT_LOCALE);
  }

  const { results } = await c.env.DB.prepare(
    `SELECT day, path, referrer, country, count FROM visits
     ORDER BY day DESC, count DESC LIMIT 500`,
  ).all<{ day: string; path: string; referrer: string; country: string; count: number }>();

  const total = results.reduce((sum, row) => sum + row.count, 0);
  return c.json({ total, rows: results }, 200, { 'Cache-Control': 'no-store' });
});

app.notFound((c) => notFound(c, localeFromPath(c.req.path)));

app.onError((error, c) => {
  // 詳細はCloudflareのログに残す。画面には内部情報を出さない。
  console.error(error);
  return c.html(renderNotFound(localeFromPath(c.req.path), siteUrl(c), ASSET_VERSION, 500), 500);
});

export default {
  fetch: app.fetch,

  async scheduled(event: ScheduledController, env: Bindings): Promise<void> {
    const result = await collectOnce(env.DB, event.scheduledTime);
    if (result.failed.length > 0) {
      console.warn(`取得できなかった取引所: ${result.failed.join(', ')}`);
    }
  },
};

/* 補助 --------------------------------------------------------------- */

function waitUntil(c: Context<{ Bindings: Bindings }>): (p: Promise<unknown>) => void {
  return (p) => c.executionCtx.waitUntil(p);
}

/**
 * 最新の観測値。金額が変わっても読む行は同じなので、キャッシュキーに金額を入れない。
 * ここを分けないと、金額を変えるたびにD1を読みにいくことになる。
 */
function readLatest(
  c: Context<{ Bindings: Bindings }>,
  pair: PairId,
  now: number,
): Promise<Tick[]> {
  return cachedRead<Tick[]>(
    versionedKey(`latest:${pair}`, now, LATEST_TTL_SECONDS),
    waitUntil(c),
    LATEST_TTL_SECONDS,
    () => latestTicks(c.env.DB, pair, VENUE_IDS),
  );
}

/** 板から出した実効コスト。銘柄を回して取っているので更新は数分おきになる。 */
function readDepth(
  c: Context<{ Bindings: Bindings }>,
  pair: PairId,
  now: number,
): Promise<DepthRow[]> {
  return cachedRead<DepthRow[]>(
    versionedKey(`depth:${pair}`, now, LATEST_TTL_SECONDS),
    waitUntil(c),
    LATEST_TTL_SECONDS,
    () => latestDepth(c.env.DB, pair, VENUE_IDS),
  );
}

/** 監視画面1銘柄ぶん。基準は24時間、スパークラインは直近6時間。 */
const BASELINE_HOURS = 24;
const SPARK_POINTS = 36;

async function pulseFor(
  c: Context<{ Bindings: Bindings }>,
  pair: PairId,
  now: number,
): Promise<{ pair: PairId; observedAt: number | null; venues: VenuePulse[] }> {
  const ticks = await readLatest(c, pair, now);
  const series = await cachedRead(
    versionedKey(`series:${pair}`, now, HISTORY_TTL_SECONDS),
    waitUntil(c),
    HISTORY_TTL_SECONDS,
    () => bucketSeries(c.env.DB, pair, now - BASELINE_HOURS * 3600),
  );

  const byVenue = new Map<string, number[]>();
  for (const row of series) {
    const list = byVenue.get(row.venue) ?? [];
    list.push(row.avg_bps);
    byVenue.set(row.venue, list);
  }

  const venues: VenuePulse[] = VENUE_IDS.map((venue) => {
    const tick = ticks.find((t) => t.venue === venue);
    const bps = tick ? spreadBps(tick.bid, tick.ask) : null;
    const history = byVenue.get(venue) ?? [];
    const baselineBps = median(history);
    const ratio = ratioOf(bps, baselineBps);
    return {
      venue,
      bps,
      baselineBps,
      ratio,
      level: levelOf(ratio),
      spark: history.slice(-SPARK_POINTS),
    };
  });

  return {
    pair,
    observedAt: ticks.length > 0 ? Math.max(...ticks.map((t) => t.ts)) : null,
    venues,
  };
}

function readDays(
  c: Context<{ Bindings: Bindings }>,
  pair: PairId,
  now: number,
): Promise<string[]> {
  return cachedRead<string[]>(
    versionedKey(`days:${pair}`, now, DAILY_TTL_SECONDS),
    waitUntil(c),
    DAILY_TTL_SECONDS,
    () => daysWithData(c.env.DB, pair),
  );
}

function notFound(c: Context<{ Bindings: Bindings }>, locale: Locale): Response {
  return c.html(renderNotFound(locale, siteUrl(c), ASSET_VERSION, 404), 404);
}

/** パスの先頭から言語を拾う。エラーページでも母語で出すため。 */
function localeFromPath(path: string): Locale {
  const first = path.split('/')[1];
  return isLocale(first) ? first : DEFAULT_LOCALE;
}

function pairFromQuery(raw: string | undefined): PairId {
  return findPair(raw)?.id ?? DEFAULT_PAIR;
}

/** 設定のSITE_URLを正とし、末尾のスラッシュだけ落とす。 */
function siteUrl(c: Context<{ Bindings: Bindings }>): string {
  return (c.env.SITE_URL ?? '').replace(/\/+$/, '');
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function clampHours(raw: string | undefined): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_HISTORY_HOURS;
  return Math.min(MAX_HISTORY_HOURS, Math.round(parsed));
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function html(c: Context<{ Bindings: Bindings }>, body: string): Response {
  return c.html(body, 200, {
    'Cache-Control': 'public, max-age=30, stale-while-revalidate=120',
  });
}

/** JSONは誰でも読めるようにしておく。データそのものをこのサイトの資産にするため。 */
function json(c: Context<{ Bindings: Bindings }>, data: unknown): Response {
  return c.json(data, 200, {
    'Cache-Control': 'public, max-age=60, stale-while-revalidate=300',
    'Access-Control-Allow-Origin': '*',
  });
}
