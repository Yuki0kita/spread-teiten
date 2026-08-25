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

if (form && input) {
  let timer = null;

  const recalc = async () => {
    const amount = Number(input.value.replace(/[,\s円]/g, ''));
    if (!Number.isFinite(amount) || amount <= 0) return;

    try {
      const response = await fetch(`/api/latest.json?amount=${amount}`, { cache: 'no-cache' });
      if (!response.ok) return;
      const data = await response.json();
      applyAmount(data);
      // 再読み込みなしでもURLは共有できる状態にしておく。
      history.replaceState(null, '', `/?amount=${amount}`);
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
  fetch('/api/history.json?hours=24', { cache: 'no-cache' })
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
        chart.innerHTML = `<p class="chart__fallback">推移を描くにはあと少し観測が必要です（いま ${spans.size} 点。10分ごとに1点増えます）。</p>`;
        chart.removeAttribute('data-loading');
        return;
      }
      chart.innerHTML = '';
      chart.append(drawChart(series));
      chart.removeAttribute('data-loading');
    })
    .catch(() => {
      chart.innerHTML = '<p class="chart__error">推移グラフを読み込めませんでした。</p>';
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
