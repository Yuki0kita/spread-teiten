/**
 * スプレッド定点のエントリポイント。
 *
 * やることは2つだけ。
 *   1. 定期的に4取引所の気配値を同時に取って記録する（scheduled / POST /internal/collect）
 *   2. 記録した値を読んで画面とJSONで返す（fetch）
 */
import { Hono } from 'hono';
import type { Context } from 'hono';
import { bucketOf, rank, venueGapYen } from './spread.ts';
import {
  cachedRead,
  DAILY_TTL_SECONDS,
  HISTORY_TTL_SECONDS,
  LATEST_TTL_SECONDS,
  versionedKey,
} from './cache.ts';
import { clampAmount, renderNotFound, renderPage } from './render.ts';
import { VENUE_IDS, VENUE_LABEL } from './venues.ts';
import { bearerToken, collectOnce, tokenMatches } from './collect.ts';
import {
  bucketsSince,
  latestTicks,
  recentDaily,
  recentErrors,
  type BucketRow,
  type DailyRow,
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
const ASSET_VERSION = '5';

/** グラフに出す時間の既定値。 */
const DEFAULT_HISTORY_HOURS = 24;
const MAX_HISTORY_HOURS = 24 * 14;

const app = new Hono<{ Bindings: Bindings }>();

/**
 * 全レスポンスに保護ヘッダを付ける。
 * インラインのscript/styleを使っていないので、CSPは 'self' だけで足りる。
 */
app.use('*', async (c, next) => {
  await next();
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

app.get('/', async (c) => {
  const now = nowSeconds();
  const amountYen = clampAmount(c.req.query('amount'));
  const ticks = await readLatest(c, now);

  const html = renderPage({
    amountYen,
    ranked: rank(ticks, amountYen),
    gapYen: venueGapYen(ticks),
    observedAt: ticks.length > 0 ? Math.max(...ticks.map((t) => t.ts)) : null,
    now,
    assetVersion: ASSET_VERSION,
    siteUrl: siteUrl(c),
  });

  return c.html(html, 200, {
    'Cache-Control': 'public, max-age=30, stale-while-revalidate=120',
  });
});

app.get('/api/latest.json', async (c) => {
  const now = nowSeconds();
  const ticks = await readLatest(c, now);
  const ranked = rank(ticks, clampAmount(c.req.query('amount')));

  return json(c, {
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
  const hours = clampHours(c.req.query('hours'));
  const rows = await cachedRead<BucketRow[]>(
    versionedKey(`history:${hours}`, now, HISTORY_TTL_SECONDS),
    (p) => c.executionCtx.waitUntil(p),
    HISTORY_TTL_SECONDS,
    () => bucketsSince(c.env.DB, bucketOf(now - hours * 3600)),
  );

  return json(c, {
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
  const rows = await cachedRead<DailyRow[]>(
    versionedKey('daily', now, DAILY_TTL_SECONDS),
    (p) => c.executionCtx.waitUntil(p),
    DAILY_TTL_SECONDS,
    () => recentDaily(c.env.DB, 90),
  );

  return json(c, {
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

/** 欠測を隠さないための確認用。運用の健全性はここで見る。 */
app.get('/api/errors.json', async (c) => {
  const now = nowSeconds();
  const rows = await cachedRead(
    versionedKey('errors', now, LATEST_TTL_SECONDS),
    (p) => c.executionCtx.waitUntil(p),
    LATEST_TTL_SECONDS,
    () => recentErrors(c.env.DB, now - 86_400),
  );
  return json(c, { errors: rows });
});

app.get('/robots.txt', (c) =>
  c.text(`User-agent: *\nAllow: /\n\nSitemap: ${siteUrl(c)}/sitemap.xml\n`, 200, {
    'Cache-Control': 'public, max-age=86400',
  }),
);

app.get('/sitemap.xml', (c) => {
  const url = siteUrl(c);
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${url}/</loc><changefreq>hourly</changefreq><priority>1.0</priority></url>
</urlset>
`;
  return c.body(body, 200, {
    'Content-Type': 'application/xml; charset=utf-8',
    'Cache-Control': 'public, max-age=86400',
  });
});

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
    return c.html(renderNotFound(ASSET_VERSION, 404), 404);
  }

  const result = await collectOnce(c.env.DB, Date.now());
  return c.json(result, 200, { 'Cache-Control': 'no-store' });
});

app.notFound((c) => c.html(renderNotFound(ASSET_VERSION, 404), 404));

app.onError((error, c) => {
  // 詳細はCloudflareのログに残す。画面には内部情報を出さない。
  console.error(error);
  return c.html(renderNotFound(ASSET_VERSION, 500), 500);
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

/**
 * 最新の観測値。金額が変わっても読む行は同じなので、キャッシュキーに金額を入れない。
 * ここを分けないと、金額を変えるたびにD1を読みにいくことになる。
 */
function readLatest(c: Context<{ Bindings: Bindings }>, now: number): Promise<Tick[]> {
  return cachedRead<Tick[]>(
    versionedKey('latest', now, LATEST_TTL_SECONDS),
    (p) => c.executionCtx.waitUntil(p),
    LATEST_TTL_SECONDS,
    () => latestTicks(c.env.DB, VENUE_IDS),
  );
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

/** JSONは誰でも読めるようにしておく。データそのものをこのサイトの資産にするため。 */
function json(c: Context<{ Bindings: Bindings }>, data: unknown): Response {
  return c.json(data, 200, {
    'Cache-Control': 'public, max-age=60, stale-while-revalidate=300',
    'Access-Control-Allow-Origin': '*',
  });
}
