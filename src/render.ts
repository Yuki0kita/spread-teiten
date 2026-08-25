/**
 * 画面のHTMLを組み立てる。
 *
 * 数字はサーバー側で埋めて返す。開いた瞬間に結論が見えている状態を優先し、
 * JavaScriptはグラフの描画にしか使わない（JSを切っても比較は読める）。
 */
import type { Ranked } from './spread.ts';
import { VENUE_LABEL } from './venues.ts';

export const DEFAULT_AMOUNT_YEN = 100_000;
export const MIN_AMOUNT_YEN = 1_000;
export const MAX_AMOUNT_YEN = 100_000_000;

/**
 * 観測がこれ以上止まったら、古い値であることを画面に出す。
 *
 * 取得は5分ごとだが、GitHub Actionsの定期実行は数分ずれることがある。
 * 通常のずれで「止まっています」と出すと文言が意味を持たなくなるので、
 * 実際の間隔の3倍以上あいたときだけ言う。
 */
export const STALE_AFTER_SECONDS = 1200;

export type PageData = {
  amountYen: number;
  ranked: Ranked[];
  gapYen: number;
  observedAt: number | null;
  now: number;
  assetVersion: string;
  siteUrl: string;
};

/**
 * 観測が止まっているかどうか。
 *
 * 古い値を黙って新しい顔で出すのが、このサイトでいちばんやってはいけないこと。
 * Cronが落ちても画面は普通に表示されてしまうので、鮮度は必ず自分で名乗る。
 */
export function isStale(observedAt: number | null, now: number): boolean {
  if (observedAt === null) return false;
  return now - observedAt > STALE_AFTER_SECONDS;
}

export function clampAmount(raw: string | undefined): number {
  const parsed = Number((raw ?? '').replace(/[,\s円]/g, ''));
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_AMOUNT_YEN;
  return Math.min(MAX_AMOUNT_YEN, Math.max(MIN_AMOUNT_YEN, Math.round(parsed)));
}

export function renderPage(data: PageData): string {
  const { amountYen, ranked, gapYen, observedAt, now } = data;
  const stale = isStale(observedAt, now);
  const title = 'スプレッド定点';
  const description =
    '国内の暗号資産取引所のビットコインのスプレッドを5分ごとに実測して記録しています。同じ金額を買って売り戻したときに消える金額を、実測値で比べられます。';

  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>${esc(title)}｜ビットコインのスプレッドを実測して記録</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(data.siteUrl)}/">
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(data.siteUrl)}/">
<meta property="og:image" content="${esc(data.siteUrl)}/og.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:site_name" content="${esc(title)}">
<meta property="og:locale" content="ja_JP">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><rect width='100' height='100' rx='22' fill='%232f4f7f'/><rect x='20' y='36' width='60' height='6' rx='3' fill='white'/><rect x='20' y='58' width='60' height='6' rx='3' fill='white' opacity='.55'/></svg>">
<link rel="stylesheet" href="/style.css?v=${esc(data.assetVersion)}">
</head>
<body>
<header class="head">
  <h1>スプレッド定点</h1>
  <p class="head__meta">${observedAt ? `${esc(formatTime(observedAt))} 実測` : '観測データがまだありません'}</p>
</header>

<main>
  ${stale ? renderStaleNotice(observedAt as number, now) : ''}
  <section class="lede">
    <form class="amount" method="get" action="/">
      <label for="amount">金額</label>
      <input id="amount" name="amount" type="text" inputmode="numeric" value="${amountYen.toLocaleString('ja-JP')}" autocomplete="off">
      <span class="amount__unit">円</span>
      <button type="submit">計算</button>
    </form>
    <p class="lede__text">この金額のビットコインをいま買って、すぐ売り戻すと消える金額です。</p>
  </section>

  ${ranked.length === 0 ? renderEmpty() : renderRanking(ranked, gapYen)}

  <section class="section">
    <h2 class="section__title">24時間のスプレッド推移</h2>
    <div id="chart" class="chart" data-loading="1">
      <p class="chart__fallback">推移グラフの表示にはJavaScriptが必要です。上の比較表はJavaScriptなしで読めます。</p>
    </div>
  </section>

  <section class="section">
    <h2 class="section__title">この数字について</h2>
    <ul class="notes">
      <li>各取引所が公開しているAPIから、板の最良気配を5分ごとに取得して計算しています。編集部が調べた値ではありません。混雑時はもう少し間隔があきます。</li>
      <li>表示しているのは<strong>スプレッドだけ</strong>です。取引手数料・入出金手数料は含みません。</li>
      <li>取引所形式（板取引）の気配値です。販売所のレートは公開APIから取得できないため扱っていません。</li>
      <li>スプレッドは秒単位で変わります。ここにあるのは観測した瞬間の値で、いま注文して同じ値で約定することを保証するものではありません。</li>
      <li>特定の取引所をすすめるものでも、投資判断を助言するものでもありません。</li>
    </ul>
  </section>
</main>

<footer class="foot">
  <p>データは <a href="/api/latest.json">/api/latest.json</a> と <a href="/api/history.json">/api/history.json</a> でも取得できます。</p>
</footer>

<script src="/app.js?v=${esc(data.assetVersion)}" defer></script>
</body>
</html>
`;
}

function renderRanking(ranked: Ranked[], gapYen: number): string {
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
        ? `<p class="rank__note">いちばん狭いのは ${esc(VENUE_LABEL[best.venue] ?? best.venue)}。同じ瞬間の取引所間の価格差は ${esc(formatYen(gapYen))} でした。</p>`
        : ''
    }
  </section>`;
}

function renderStaleNotice(observedAt: number, now: number): string {
  const minutes = Math.floor((now - observedAt) / 60);
  return `<p class="notice">観測が${minutes}分止まっています。表示しているのは${esc(formatTime(observedAt))}時点の値です。</p>`;
}

/** 404と500。素のテキストを返すより、戻る先がある画面のほうが親切。 */
export function renderNotFound(assetVersion: string, status: 404 | 500): string {
  const heading = status === 404 ? 'ページが見つかりません' : '問題が起きました';
  const detail =
    status === 404
      ? 'アドレスが変わったか、もともと存在しないページです。'
      : '時間をおいてもう一度開いてみてください。';

  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="robots" content="noindex">
<title>${esc(heading)}｜スプレッド定点</title>
<link rel="stylesheet" href="/style.css?v=${esc(assetVersion)}">
</head>
<body>
<header class="head"><h1>スプレッド定点</h1></header>
<main>
  <section class="section">
    <p class="empty__title">${esc(heading)}</p>
    <p class="empty__note">${esc(detail)}</p>
    <p class="empty__note"><a href="/">最新のスプレッドを見る</a></p>
  </section>
</main>
</body>
</html>
`;
}

function renderEmpty(): string {
  return `<section class="section">
    <p class="empty">まだ観測データがありません。定期取得が始まると、ここに比較が出ます。</p>
  </section>`;
}

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

export function formatTime(ts: number): string {
  const jst = new Date((ts + 9 * 3600) * 1000);
  const hh = String(jst.getUTCHours()).padStart(2, '0');
  const mm = String(jst.getUTCMinutes()).padStart(2, '0');
  return `${jst.getUTCMonth() + 1}/${jst.getUTCDate()} ${hh}:${mm}`;
}

export function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
