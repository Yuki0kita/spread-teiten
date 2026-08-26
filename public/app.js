// このファイルがやることは2つだけ。
//   1. 金額を入れ直したときに、ページを再読み込みせず比較を更新する
//   2. 24時間のスプレッド推移を描く
// どちらも無くても本体（比較表）は読める。壊れても致命傷にならない範囲に留める。

document.documentElement.classList.add('js');

const VENUE_ORDER = ['gmo', 'bitbank', 'bitflyer', 'coincheck'];

// src/render.ts の formatYen と同じ規則。小さいほうを丸めて0円にしない。
const yen = (value) => {
  if (value >= 100) return `${Math.round(value).toLocaleString('ja-JP')}円`;
  if (value >= 10) return `${value.toFixed(1)}円`;
  if (value >= 1) return `${value.toFixed(2)}円`;
  if (value === 0) return '0円';
  if (value < 1e-4) return '0.0001円未満';
  return `${Number(value.toPrecision(2))}円`;
};

// 桁を固定すると狭い取引所が「0.0000%」に潰れる。src/render.ts と同じ規則で有効数字2桁。
const percent = (bps) => {
  const p = bps / 100;
  if (p === 0) return '0%';
  if (p >= 1) return `${p.toFixed(2)}%`;
  if (p < 1e-6) return '0.000001%未満';
  return `${Number(p.toPrecision(2))}%`;
};

// --- 金額の入れ直し -------------------------------------------------

const form = document.querySelector('.amount');
const input = document.getElementById('amount');
// 銘柄はサーバーが出したHTMLから読む。JS側に銘柄の一覧を持たせない。
const PAIR = (document.getElementById('chart') || {}).dataset?.pair || 'btc';

if (form && input) {
  let timer = null;

  const recalc = async () => {
    const amount = Number(input.value.replace(/[,\s円]/g, ''));
    if (!Number.isFinite(amount) || amount <= 0) return;

    try {
      const response = await fetch(`/api/latest.json?pair=${PAIR}&amount=${amount}`, {
        cache: 'no-cache',
      });
      if (!response.ok) return;
      const data = await response.json();
      applyAmount(data);
      // 再読み込みなしでもURLは共有できる状態にしておく。
      const url = new URL(location.href);
      url.searchParams.set('amount', String(amount));
      history.replaceState(null, '', url);
    } catch {
      // 取得に失敗したらサーバー側で計算された表示のまま残す。
    }
  };

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    recalc();
  });

  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(recalc, 300);
  });
}

function applyAmount(data) {
  const items = document.querySelectorAll('.rank__item');
  data.venues.forEach((venue, index) => {
    const item = items[index];
    if (!item) return;
    item.querySelector('.rank__venue').textContent = venue.label;
    item.querySelector('.rank__cost').textContent = yen(venue.cost_yen);
    item.querySelector('.rank__pct').textContent = percent(venue.spread_bps);
  });
}

// --- 推移グラフ -----------------------------------------------------

const chart = document.getElementById('chart');

if (chart) {
  fetch(`/api/history.json?pair=${PAIR}&hours=24`, { cache: 'no-cache' })
    .then((response) => {
      if (!response.ok) throw new Error('取得に失敗しました');
      return response.json();
    })
    .then((data) => {
      const series = groupByVenue(data.points || []);
      // 1点だけだと線が引けず、目盛りと取引所名だけが浮いた壊れた絵になる。
      // 公開直後は必ずこの状態を通るので、素直に「まだ足りない」と書く。
      const spans = new Set((data.points || []).map((p) => p.t));
      if (series.size === 0 || spans.size < 2) {
        // 文言はサーバーが言語ごとに出したものを使う。JS側に日本語を持たせない。
        const template = chart.dataset.msgNotenough || '';
        chart.textContent = '';
        const note = document.createElement('p');
        note.className = 'chart__fallback';
        note.textContent = template.replace(/\d+/, String(spans.size));
        chart.append(note);
        chart.removeAttribute('data-loading');
        return;
      }
      chart.innerHTML = '';
      chart.append(drawChart(series));
      chart.removeAttribute('data-loading');
    })
    .catch(() => {
      chart.textContent = '';
      const note = document.createElement('p');
      note.className = 'chart__error';
      note.textContent = chart.dataset.msgFailed || '';
      chart.append(note);
    });
}

function groupByVenue(points) {
  const series = new Map();
  for (const point of points) {
    if (!Number.isFinite(point.avg_bps)) continue;
    const list = series.get(point.venue) || [];
    list.push({ t: point.t, v: point.avg_bps });
    series.set(point.venue, list);
  }
  for (const list of series.values()) list.sort((a, b) => a.t - b.t);
  return series;
}

const LABELS = {
  gmo: 'GMOコイン',
  bitbank: 'bitbank',
  bitflyer: 'bitFlyer',
  coincheck: 'Coincheck',
};

const SVG_NS = 'http://www.w3.org/2000/svg';
const W = 720;
const H = 260;
// 左は「0.0001%」のような長い目盛りラベルが入る幅、右は線の終端に置く取引所名の幅。
const PAD = { top: 22, right: 96, bottom: 26, left: 68 };
/** 終端ラベルが重ならないようにする最小の縦間隔。 */
const LABEL_GAP = 13;

function drawChart(series) {
  const all = [...series.values()].flat();
  const times = all.map((p) => p.t);
  const tMin = Math.min(...times);
  const tMax = Math.max(...times);

  // GMOとCoincheckで60倍以上ひらくため、線形だと狭いほうが潰れて読めない。
  // 対数にして、桁の違いをそのまま高さの違いにする。
  const FLOOR_BPS = 0.01;
  const values = all.map((p) => Math.max(p.v, FLOOR_BPS));
  const vMin = Math.min(...values);
  const vMax = Math.max(...values);
  const logMin = Math.log10(vMin) - 0.1;
  const logMax = Math.log10(vMax) + 0.1;

  const x = (t) => {
    const span = tMax - tMin || 1;
    return PAD.left + ((t - tMin) / span) * (W - PAD.left - PAD.right);
  };
  const y = (v) => {
    const span = logMax - logMin || 1;
    const ratio = (Math.log10(Math.max(v, FLOOR_BPS)) - logMin) / span;
    return H - PAD.bottom - ratio * (H - PAD.top - PAD.bottom);
  };

  const svg = el('svg', {
    viewBox: `0 0 ${W} ${H}`,
    role: 'img',
    'aria-label': '24時間のスプレッド推移',
  });

  for (const tick of logTicks(vMin, vMax)) {
    const yy = y(tick);
    // 描画領域からはみ出す目盛りは引かない（ラベルが上端で切れるのを防ぐ）
    if (yy < PAD.top || yy > H - PAD.bottom) continue;
    svg.append(el('line', { class: 'axis', x1: PAD.left, y1: yy, x2: W - PAD.right, y2: yy }));
    svg.append(text(PAD.left - 8, yy + 4, percent(tick), 'axis-label', 'end'));
  }

  svg.append(text(PAD.left, H - 6, formatClock(tMin), 'axis-label', 'start'));
  svg.append(text(W - PAD.right, H - 6, formatClock(tMax), 'axis-label', 'end'));

  const ordered = VENUE_ORDER.filter((v) => series.has(v));
  const labels = [];

  ordered.forEach((venue, index) => {
    const points = series.get(venue);
    const d = points
      .map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`)
      .join('');
    svg.append(el('path', { class: `line line--${index + 1}`, d }));

    const last = points[points.length - 1];
    labels.push({ y: y(last.v), text: LABELS[venue] || venue, index: index + 1 });
  });

  for (const label of spreadLabels(labels)) {
    svg.append(
      text(
        W - PAD.right + 8,
        label.y + 4,
        label.text,
        `series-label series-label--${label.index}`,
        'start',
      ),
    );
  }

  return svg;
}

/**
 * 線の終端に置く取引所名が重ならないように、上から順に押し下げる。
 * 凡例を別に置くより、線の隣に名前がある方が目で追う手間が少ない。
 */
function spreadLabels(labels) {
  const sorted = [...labels].sort((a, b) => a.y - b.y);
  for (let i = 1; i < sorted.length; i += 1) {
    const gap = sorted[i].y - sorted[i - 1].y;
    if (gap < LABEL_GAP) sorted[i].y = sorted[i - 1].y + LABEL_GAP;
  }
  // 下端からはみ出したぶんは全体を上へ戻す
  const overflow = sorted[sorted.length - 1].y - (H - PAD.bottom);
  if (overflow > 0) for (const label of sorted) label.y -= overflow;
  return sorted;
}

/** 対数軸に置く目盛り。桁の区切りだけを置いて線を増やしすぎない。 */
function logTicks(vMin, vMax) {
  const ticks = [];
  for (let exponent = -2; exponent <= 3; exponent += 1) {
    const value = 10 ** exponent;
    if (value >= vMin / 3 && value <= vMax * 3) ticks.push(value);
  }
  return ticks;
}

function formatClock(unixSeconds) {
  const jst = new Date((unixSeconds + 9 * 3600) * 1000);
  return `${String(jst.getUTCHours()).padStart(2, '0')}:${String(jst.getUTCMinutes()).padStart(2, '0')}`;
}

function el(name, attributes) {
  const node = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
  return node;
}

function text(x, y, content, className, anchor) {
  const node = el('text', { x, y, class: className, 'text-anchor': anchor });
  node.textContent = content;
  return node;
}

// --- 監視画面の自動更新 ---------------------------------------------
// 開きっぱなしにしてもらう画面なので、こちらから静かに取りに行く。
// 更新は差し替えではなく、変わった文字だけを書き換える。丸ごと作り直すと
// 見ている最中に画面がちらつき、落ち着かない画面になる。

const watch = document.getElementById('watch');

if (watch) {
  const REFRESH_MS = 60_000;
  const state = document.getElementById('watchState');
  const headline = document.getElementById('watchHeadline');

  const percent2 = (bps) => (bps === null ? '—' : percent(bps));
  const ratioText = (r) => (r === null ? '—' : r >= 10 ? `${Math.round(r)}倍` : `${r.toFixed(1)}倍`);

  const apply = (data) => {
    let worst = null;
    for (const pair of data.pairs) {
      for (const v of pair.venues) {
        const row = document.querySelector(
          `.watch__pair[data-pair="${pair.pair}"] .watch__row[data-venue="${v.venue}"]`,
        );
        if (!row) continue;

        row.className = `watch__row watch__row--${v.level}`;
        row.querySelector('.watch__bps').textContent = percent2(v.spread_bps);

        // 倍率は荒れている行にだけ出す。静かな行に数字を残すと見るべき行が埋もれる。
        let chip = row.querySelector('.watch__ratio');
        if (v.level === 'calm') {
          if (chip) chip.remove();
        } else {
          if (!chip) {
            chip = document.createElement('span');
            chip.className = 'watch__ratio';
            row.insertBefore(chip, row.querySelector('.watch__spark'));
          }
          chip.textContent = ratioText(v.ratio);
        }

        const spark = row.querySelector('.watch__spark');
        if (spark && v.spark && v.spark.length > 1) spark.innerHTML = drawSpark(v.spark);

        if (v.ratio !== null && (worst === null || v.ratio > worst.ratio)) {
          worst = { ratio: v.ratio, venue: v.venue, level: v.level, pair: pair.pair };
        }
      }
    }

    const level = worst && worst.level !== 'calm' ? worst.level : 'calm';
    watch.dataset.level = level;
    if (headline && watch.dataset.msgCalm && level === 'calm') {
      headline.textContent = watch.dataset.msgCalm;
    }
  };

  const tick = async () => {
    try {
      const response = await fetch('/api/pulse.json', { cache: 'no-cache' });
      if (!response.ok) throw new Error(String(response.status));
      apply(await response.json());
      if (state) {
        state.textContent = watch.dataset.msgUpdating || '';
        state.classList.remove('watch__state--stopped');
      }
    } catch {
      // 取れなかったことを黙って隠さない。古い値を新しい顔で見せるのがいちばん困る。
      if (state) {
        state.textContent = watch.dataset.msgStopped || '';
        state.classList.add('watch__state--stopped');
      }
    }
  };

  setInterval(tick, REFRESH_MS);
  // タブを戻したときは待たずに取り直す。放置後に古い値を見せないため。
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) tick();
  });
}

/** src/render.ts の sparkline と同じ描き方。形だけ読めれば十分なので軸は置かない。 */
function drawSpark(values, width = 96, height = 20) {
  const points = values.filter((v) => Number.isFinite(v));
  if (points.length < 2) return '';
  const max = Math.max(...points);
  const min = Math.min(...points);
  const span = max - min || 1;
  const step = width / (points.length - 1);
  const d = points
    .map((v, i) => {
      const x = i * step;
      const y = height - ((v - min) / span) * (height - 2) - 1;
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join('');
  return `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" aria-hidden="true"><path d="${d}" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
}
