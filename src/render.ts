/**
 * 画面のHTMLを組み立てる。
 *
 * 数字はサーバー側で埋めて返す。開いた瞬間に結論が見えている状態を優先し、
 * JavaScriptはグラフの描画にしか使わない（JSを切っても比較は読める）。
 *
 * ページは3種類だけ。
 *   /{lang}/                    銘柄の一覧
 *   /{lang}/{pair}/             その銘柄の現在値と24時間の推移
 *   /{lang}/{pair}/{YYYY-MM-DD}/ その日の記録
 *
 * 日別ページはデータが貯まるほど自動で増える。手を動かさずにページが増えるのは
 * ここだけなので、日付の前後リンクを必ず置いてクロールの導線を切らさない。
 */
import { costFromBps, type Ranked } from './spread.ts';
import { AMOUNT_LADDER } from './depth.ts';
import { DEFAULT_LOCALE, LOCALES, otherLocale, pairName, t, type Locale } from './i18n.ts';
import { PAIRS, type Pair, type PairId } from './pairs.ts';
import { VENUE_LABEL } from './venues.ts';
import type { DailyRow } from './store.ts';

export const DEFAULT_AMOUNT_YEN = 100_000;
export const MIN_AMOUNT_YEN = 1_000;
export const MAX_AMOUNT_YEN = 100_000_000;

/**
 * 観測がこれ以上止まったら、古い値であることを画面に出す。
 *
 * 取得は毎分だが、取りこぼしや予備経路（5分間隔）への切り替わりで間隔があくことがある。
 * 通常のずれで「止まっています」と出すと文言が意味を持たなくなるので、
 * 予備経路の間隔より十分に長くあいたときだけ言う。
 */
export const STALE_AFTER_SECONDS = 1200;

export function homePath(locale: Locale): string {
  return `/${locale}/`;
}

export function pairPath(locale: Locale, pair: PairId): string {
  return `/${locale}/${pair}/`;
}

export function dayPath(locale: Locale, pair: PairId, day: string): string {
  return `/${locale}/${pair}/${day}/`;
}

export function isStale(observedAt: number | null, now: number): boolean {
  if (observedAt === null) return false;
  return now - observedAt > STALE_AFTER_SECONDS;
}

export function clampAmount(raw: string | undefined): number {
  const parsed = Number((raw ?? '').replace(/[,\s円]/g, ''));
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_AMOUNT_YEN;
  return Math.min(MAX_AMOUNT_YEN, Math.max(MIN_AMOUNT_YEN, Math.round(parsed)));
}

type LayoutOptions = {
  locale: Locale;
  siteUrl: string;
  assetVersion: string;
  title: string;
  description: string;
  /** 言語ごとのパス。hreflangとcanonicalを作るのに使う。 */
  pathFor: (locale: Locale) => string;
  body: string;
  noindex?: boolean;
  withScript?: boolean;
};

function layout(options: LayoutOptions): string {
  const { locale, siteUrl, assetVersion, pathFor } = options;
  const canonical = `${siteUrl}${pathFor(locale)}`;
  const messages = t(locale);

  const alternates = LOCALES.map(
    (other) =>
      `<link rel="alternate" hreflang="${other}" href="${esc(siteUrl + pathFor(other))}">`,
  ).join('\n');

  return `<!DOCTYPE html>
<html lang="${locale}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
${options.noindex ? '<meta name="robots" content="noindex">' : ''}
<title>${esc(options.title)}</title>
<meta name="description" content="${esc(options.description)}">
<link rel="canonical" href="${esc(canonical)}">
${alternates}
<link rel="alternate" hreflang="x-default" href="${esc(siteUrl + pathFor(DEFAULT_LOCALE))}">
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(options.title)}">
<meta property="og:description" content="${esc(options.description)}">
<meta property="og:url" content="${esc(canonical)}">
<meta property="og:image" content="${esc(siteUrl)}/og.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:site_name" content="${esc(messages.siteName)}">
<meta property="og:locale" content="${locale === 'ja' ? 'ja_JP' : 'en_US'}">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><rect width='100' height='100' rx='22' fill='%232f4f7f'/><rect x='20' y='36' width='60' height='6' rx='3' fill='white'/><rect x='20' y='58' width='60' height='6' rx='3' fill='white' opacity='.55'/></svg>">
<link rel="stylesheet" href="/style.css?v=${esc(assetVersion)}">
</head>
<body>
${options.body}
<footer class="foot">
  <p><a href="${esc(pathFor(otherLocale(locale)))}" hreflang="${otherLocale(locale)}">${esc(messages.otherLanguage)}</a></p>
  <p>${esc(messages.dataFooter)} <a href="/api/latest.json">/api/latest.json</a></p>
</footer>
${options.withScript ? `<script src="/app.js?v=${esc(assetVersion)}" defer></script>` : ''}
</body>
</html>
`;
}

/** タイトルの区切り。日本語は全角の縦棒、英語は半角のパイプが読みやすい。 */
function titleJoin(locale: Locale, head: string, tail: string): string {
  return locale === 'ja' ? `${head}｜${tail}` : `${head} | ${tail}`;
}

/** 「名前（CODE）」の括弧も言語に合わせる。英語に全角括弧を混ぜない。 */
function withCode(locale: Locale, name: string, code: string): string {
  return locale === 'ja' ? `${name}（${code}）` : `${name} (${code})`;
}

function header(locale: Locale, meta: string, homeHref: string): string {
  const messages = t(locale);
  return `<header class="head">
  <h1><a href="${esc(homeHref)}">${esc(messages.siteName)}</a></h1>
  <p class="head__meta">${meta}</p>
</header>`;
}

/* 銘柄の一覧 --------------------------------------------------------- */

export type IndexData = {
  locale: Locale;
  siteUrl: string;
  assetVersion: string;
  /** 銘柄ごとの、いちばん狭い取引所とその往復コスト。 */
  rows: { pair: Pair; best: Ranked | null }[];
  amountYen: number;
};

export function renderIndex(data: IndexData): string {
  const { locale, rows, amountYen } = data;
  const messages = t(locale);

  const items = rows
    .map(({ pair, best }) => {
      const name = pairName(locale, pair);
      const detail = best
        ? `<span class="rank__cost">${esc(formatYen(best.costYen))}</span>
           <span class="rank__pct">${esc(VENUE_LABEL[best.venue] ?? best.venue)}</span>`
        : `<span class="rank__pct">${esc(messages.noData)}</span>`;
      return `<li class="rank__item">
        <span class="rank__venue"><a href="${esc(pairPath(locale, pair.id))}">${esc(withCode(locale, name, pair.code))}</a></span>
        ${detail}
      </li>`;
    })
    .join('\n');

  return layout({
    locale,
    siteUrl: data.siteUrl,
    assetVersion: data.assetVersion,
    title: titleJoin(locale, messages.siteName, messages.tagline),
    description: messages.description(pairName(locale, PAIRS[0] as Pair)),
    pathFor: (l) => homePath(l),
    body: `${header(locale, esc(messages.tagline), homePath(locale))}
<main>
  <section class="section">
    <h2 class="section__title">${esc(messages.pairsTitle)}</h2>
    <p class="lede__text">${esc(messages.indexLede(formatYen(amountYen)))}</p>
    <ol class="rank">
      ${items}
    </ol>
  </section>

  <section class="section">
    <h2 class="section__title">${esc(messages.aboutTitle)}</h2>
    <ul class="notes">
      ${messages.about.map((line) => `<li>${esc(line)}</li>`).join('\n      ')}
    </ul>
  </section>
</main>`,
  });
}

/* 銘柄ページ --------------------------------------------------------- */

export type PairPageData = {
  locale: Locale;
  siteUrl: string;
  assetVersion: string;
  pair: Pair;
  amountYen: number;
  ranked: Ranked[];
  gapYen: number;
  observedAt: number | null;
  now: number;
  recentDays: string[];
  /** 取引所ごとの、金額別の実効コスト。取れていない段は null。 */
  depth: { venue: string; costs: Record<string, number | null> }[];
};

export function renderPairPage(data: PairPageData): string {
  const { locale, pair, amountYen, ranked, gapYen, observedAt, now } = data;
  const messages = t(locale);
  const name = pairName(locale, pair);
  const stale = isStale(observedAt, now);

  const meta = observedAt
    ? esc(messages.observedAt(formatTime(observedAt, locale)))
    : esc(messages.noData);

  const days = data.recentDays
    .map(
      (day) =>
        `<li><a href="${esc(dayPath(locale, pair.id, day))}">${esc(day)}</a></li>`,
    )
    .join('\n      ');

  return layout({
    locale,
    siteUrl: data.siteUrl,
    assetVersion: data.assetVersion,
    title: titleJoin(
      locale,
      locale === 'ja'
        ? `${withCode(locale, name, pair.code)}のスプレッド実測`
        : `${withCode(locale, name, pair.code)} spread, measured`,
      messages.siteName,
    ),
    description: messages.description(name),
    pathFor: (l) => pairPath(l, pair.id),
    withScript: true,
    body: `${header(locale, meta, homePath(locale))}
<main data-pair="${esc(pair.id)}">
  ${stale ? `<p class="notice">${esc(messages.staleNotice(Math.floor((now - (observedAt as number)) / 60), formatTime(observedAt as number, locale)))}</p>` : ''}

  ${renderDepth(locale, data.depth)}

  <section class="section">
    <h2 class="section__title">${esc(messages.bestQuoteTitle)}</h2>
    <form class="amount" method="get" action="${esc(pairPath(locale, pair.id))}" data-pair="${esc(pair.id)}">
      <label for="amount">${esc(messages.amountLabel)}</label>
      <input id="amount" name="amount" type="text" inputmode="numeric" value="${amountYen.toLocaleString('ja-JP')}" autocomplete="off">
      <span class="amount__unit">${esc(messages.amountUnit)}</span>
      <button type="submit">${esc(messages.calculate)}</button>
    </form>
    <p class="lede__text">${esc(messages.lede(name))}</p>
    ${ranked.length === 0 ? `<p class="empty">${esc(messages.noDataYet)}</p>` : renderRanking(locale, ranked, gapYen)}
    <p class="rank__note">${esc(messages.bestQuoteNote)}</p>
  </section>

  <section class="section">
    <h2 class="section__title">${esc(messages.chartTitle)}</h2>
    <div id="chart" class="chart" data-loading="1"
         data-pair="${esc(pair.id)}"
         data-msg-notenough="${esc(messages.chartNotEnough(0))}"
         data-msg-failed="${esc(messages.chartFailed)}">
      <p class="chart__fallback">${esc(messages.chartNeedsJs)}</p>
    </div>
  </section>

  ${
    days
      ? `<section class="section">
    <h2 class="section__title">${esc(messages.recentDays)}</h2>
    <ul class="days">
      ${days}
    </ul>
  </section>`
      : ''
  }

  <section class="section">
    <h2 class="section__title">${esc(messages.aboutTitle)}</h2>
    <ul class="notes">
      ${messages.about.map((line) => `<li>${esc(line)}</li>`).join('\n      ')}
    </ul>
  </section>
</main>`,
  });
}

/**
 * 金額別の実効コスト。このサイトでいちばん判断に効く表。
 *
 * 板の一番上の値段だけを見ていると、金額が変わってもコストは比例するように見える。
 * 実際は板の厚みが取引所ごとに違うので、金額によっていちばん安い取引所が入れ替わる。
 * 行を金額、列を取引所にして、各行の最小値を強調する。
 */
function renderDepth(
  locale: Locale,
  depth: { venue: string; costs: Record<string, number | null> }[],
): string {
  const messages = t(locale);
  if (depth.length === 0) {
    return `<section class="section">
    <h2 class="section__title">${esc(messages.depthTitle)}</h2>
    <p class="empty">${esc(messages.depthNone)}</p>
  </section>`;
  }

  const venues = depth.map((row) => row.venue);
  const head = venues
    .map((venue) => `<th scope="col" class="num">${esc(VENUE_LABEL[venue] ?? venue)}</th>`)
    .join('');

  const cheapestAt: Record<number, string | null> = {};
  const rows = AMOUNT_LADDER.map((amount) => {
    const key = String(amount);
    const values = depth.map((row) => ({ venue: row.venue, cost: row.costs[key] ?? null }));
    const available = values.filter((v) => v.cost !== null) as { venue: string; cost: number }[];
    const best = available.length > 0 ? Math.min(...available.map((v) => v.cost)) : null;
    cheapestAt[amount] = available.find((v) => v.cost === best)?.venue ?? null;

    const cells = values
      .map((v) =>
        v.cost === null
          ? `<td class="num muted">${esc(messages.depthNotEnough)}</td>`
          : `<td class="num${v.cost === best ? ' cell--best' : ''}">${esc(formatYen(v.cost))}</td>`,
      )
      .join('');
    return `<tr><th scope="row" class="num">${esc(formatYen(amount))}</th>${cells}</tr>`;
  }).join('\n');

  const smallest = cheapestAt[AMOUNT_LADDER[0] as number] ?? null;
  const largest = cheapestAt[AMOUNT_LADDER.at(-1) as number] ?? null;
  const insight =
    smallest && largest
      ? smallest === largest
        ? messages.depthSameVenue(VENUE_LABEL[smallest] ?? smallest)
        : messages.depthInsight(
            VENUE_LABEL[smallest] ?? smallest,
            VENUE_LABEL[largest] ?? largest,
          )
      : '';

  return `<section class="section">
    <h2 class="section__title">${esc(messages.depthTitle)}</h2>
    <p class="lede__text">${esc(messages.depthLede)}</p>
    <div class="table-wrap"><table class="table table--matrix">
      <thead><tr><th scope="col" class="num">${esc(messages.depthAmount)}</th>${head}</tr></thead>
      <tbody>
        ${rows}
      </tbody>
    </table></div>
    ${insight ? `<p class="rank__note">${esc(insight)}</p>` : ''}
  </section>`;
}

function renderRanking(locale: Locale, ranked: Ranked[], gapYen: number): string {
  const messages = t(locale);
  const best = ranked[0];
  const rows = ranked
    .map((row, index) => {
      const label = VENUE_LABEL[row.venue] ?? row.venue;
      return `<li class="rank__item${index === 0 ? ' rank__item--best' : ''}">
        <span class="rank__venue">${esc(label)}</span>
        <span class="rank__cost">${esc(formatYen(row.costYen))}</span>
        <span class="rank__pct">${esc(formatPercent(row.bps))}</span>
      </li>`;
    })
    .join('\n');

  return `<section class="section">
    <ol class="rank">
      ${rows}
    </ol>
    ${
      best
        ? `<p class="rank__note">${esc(messages.narrowest(VENUE_LABEL[best.venue] ?? best.venue, formatYen(gapYen)))}</p>`
        : ''
    }
  </section>`;
}

/* 日別ページ --------------------------------------------------------- */

export type DailyPageData = {
  locale: Locale;
  siteUrl: string;
  assetVersion: string;
  pair: Pair;
  day: string;
  rows: DailyRow[];
  prevDay: string | null;
  nextDay: string | null;
  amountYen: number;
};

export function renderDailyPage(data: DailyPageData): string {
  const { locale, pair, day, rows, amountYen } = data;
  const messages = t(locale);
  const name = pairName(locale, pair);
  const columns = messages.dailyColumns;

  const sorted = [...rows].sort((a, b) => a.avg_bps - b.avg_bps);
  const best = sorted[0];
  const summary = best
    ? `${messages.dailyBest(VENUE_LABEL[best.venue] ?? best.venue, formatPercent(best.avg_bps))}` +
      `<br>${esc(messages.dailyCost(formatYen(amountYen), formatYen(costFromBps(amountYen, best.avg_bps))))}`
    : '';

  const body = sorted
    .map(
      (row) => `<tr>
        <td>${esc(VENUE_LABEL[row.venue] ?? row.venue)}</td>
        <td class="num">${esc(formatPercent(row.avg_bps))}</td>
        <td class="num">${esc(formatPercent(row.min_bps))}</td>
        <td class="num">${esc(formatPercent(row.max_bps))}</td>
        <td class="num">${row.samples}</td>
      </tr>`,
    )
    .join('\n');

  const title = titleJoin(
    locale,
    locale === 'ja' ? `${day}の${name}スプレッド` : `${name} spreads on ${day}`,
    messages.siteName,
  );

  return layout({
    locale,
    siteUrl: data.siteUrl,
    assetVersion: data.assetVersion,
    title,
    description: messages.dailyIntro(name, day),
    pathFor: (l) => dayPath(l, pair.id, day),
    body: `${header(locale, esc(day), homePath(locale))}
<main>
  <section class="section">
    <h2 class="section__title">${esc(messages.dailyTitle)}</h2>
    <p class="lede__text">${esc(messages.dailyIntro(name, day))}</p>
    ${
      rows.length === 0
        ? `<p class="empty">${esc(messages.dailyNone)}</p>`
        : `<div class="table-wrap"><table class="table">
      <thead><tr>
        <th scope="col">${esc(columns.venue)}</th>
        <th scope="col" class="num">${esc(columns.avg)}</th>
        <th scope="col" class="num">${esc(columns.min)}</th>
        <th scope="col" class="num">${esc(columns.max)}</th>
        <th scope="col" class="num">${esc(columns.samples)}</th>
      </tr></thead>
      <tbody>
        ${body}
      </tbody>
    </table></div>
    <p class="rank__note">${summary}</p>`
    }
  </section>

  <nav class="pager">
    ${data.prevDay ? `<a class="button" href="${esc(dayPath(locale, pair.id, data.prevDay))}">← ${esc(messages.prevDay)}</a>` : '<span></span>'}
    <a class="button" href="${esc(pairPath(locale, pair.id))}">${esc(messages.backToPair)}</a>
    ${data.nextDay ? `<a class="button" href="${esc(dayPath(locale, pair.id, data.nextDay))}">${esc(messages.nextDay)} →</a>` : '<span></span>'}
  </nav>
</main>`,
  });
}

/* エラーページ ------------------------------------------------------- */

export function renderNotFound(
  locale: Locale,
  siteUrl: string,
  assetVersion: string,
  status: 404 | 500,
): string {
  const messages = t(locale);
  const heading = status === 404 ? messages.notFoundTitle : messages.errorTitle;
  const detail = status === 404 ? messages.notFoundBody : messages.errorBody;

  return layout({
    locale,
    siteUrl,
    assetVersion,
    title: titleJoin(locale, heading, messages.siteName),
    description: detail,
    pathFor: (l) => homePath(l),
    noindex: true,
    body: `${header(locale, '', homePath(locale))}
<main>
  <section class="section">
    <p class="empty__title">${esc(heading)}</p>
    <p class="empty__note">${esc(detail)}</p>
    <p class="empty__note"><a href="${esc(homePath(locale))}">${esc(messages.backHome)}</a></p>
  </section>
</main>`,
  });
}

/* 整形 --------------------------------------------------------------- */

/**
 * 金額の表示。小さいほうを丸めて0円にしないことが、このサイトでは特に大事になる。
 * 「1円も取られない取引所がある」ことが伝わらないと、比較する意味が半分消える。
 */
export function formatYen(value: number): string {
  if (value >= 100) return `${Math.round(value).toLocaleString('ja-JP')}円`;
  if (value >= 10) return `${value.toFixed(1)}円`;
  if (value >= 1) return `${value.toFixed(2)}円`;
  if (value === 0) return '0円';
  if (value < 1e-4) return '0.0001円未満';
  return `${Number(value.toPrecision(2))}円`;
}

/**
 * スプレッドを%で表す。
 *
 * 取引所間で60倍以上ひらくため、桁を固定すると狭いほうが「0.0000%」になり、
 * 比較記事が丸めてしまっているのと同じ嘘になる。常に有効数字2桁で出す。
 */
export function formatPercent(bps: number): string {
  const percent = bps / 100;
  if (percent === 0) return '0%';
  if (percent >= 1) return `${percent.toFixed(2)}%`;
  // これより小さいとJavaScriptが指数表記に切り替わり、画面で読めなくなる。
  if (percent < 1e-6) return '0.000001%未満';
  return `${Number(percent.toPrecision(2))}%`;
}

export function formatTime(ts: number, locale: Locale = 'ja'): string {
  const jst = new Date((ts + 9 * 3600) * 1000);
  const hh = String(jst.getUTCHours()).padStart(2, '0');
  const mm = String(jst.getUTCMinutes()).padStart(2, '0');
  const month = jst.getUTCMonth() + 1;
  const date = jst.getUTCDate();
  return locale === 'ja'
    ? `${month}/${date} ${hh}:${mm}`
    : `${month}/${date} ${hh}:${mm} JST`;
}

export function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
