/**
 * 「いま板が薄くなっているか」を判定する。
 *
 * 比較サイトは一度来て口座を作れば用済みになる。開きっぱなしにしてもらうには、
 * 見るたびに変わっていて、しかも「見逃すと困る瞬間」がある必要がある。
 *
 * スプレッドの絶対値（0.005%）を何度も眺める人はいない。意味を持つのは
 * 「普段の何倍に開いているか」のほう。板が引かれた瞬間はスプレッドが桁で開くので、
 * 平常時との比を見れば、相場が動いている瞬間がそのまま分かる。
 *
 * 平常時の基準は直近24時間の中央値を使う。平均だと、まさに拾いたい急拡大に
 * 基準そのものが引きずられて、異常が異常に見えなくなる。
 */

/** 平常とみなす上限。ここを超えると「少し荒れている」。 */
export const WATCH_RATIO = 2;

/** ここを超えると「何か起きている」。 */
export const ALERT_RATIO = 5;

/** 基準が小さすぎるときに倍率が跳ねるのを防ぐ下限（bps）。 */
export const MIN_BASELINE_BPS = 0.05;

export type Level = 'calm' | 'watch' | 'alert';

export type VenuePulse = {
  venue: string;
  /** いまのスプレッド（bps）。取れていなければ null。 */
  bps: number | null;
  /** 直近24時間の中央値（bps）。 */
  baselineBps: number | null;
  /** 平常時の何倍か。基準が無ければ null。 */
  ratio: number | null;
  level: Level;
  /** スパークライン用。古い順。 */
  spark: number[];
};

/** 中央値。平均と違い、一部の極端な値に引きずられない。 */
export function median(values: number[]): number | null {
  const sorted = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid] as number;
  return (((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2);
}

/**
 * 平常時の何倍か。
 *
 * 基準が極端に小さいと、1円動いただけで何十倍にもなってしまう。
 * 板が1円差で張り付いている取引所では実際に起きるので、下限で頭を押さえる。
 */
export function ratioOf(bps: number | null, baseline: number | null): number | null {
  if (bps === null || baseline === null) return null;
  if (!Number.isFinite(bps) || !Number.isFinite(baseline)) return null;
  return bps / Math.max(baseline, MIN_BASELINE_BPS);
}

export function levelOf(ratio: number | null): Level {
  if (ratio === null) return 'calm';
  if (ratio >= ALERT_RATIO) return 'alert';
  if (ratio >= WATCH_RATIO) return 'watch';
  return 'calm';
}

/** 画面の一番上に出す一言のための、いちばん目立つ取引所。 */
export function loudest(pulses: VenuePulse[]): VenuePulse | null {
  const withRatio = pulses.filter((p) => p.ratio !== null);
  if (withRatio.length === 0) return null;
  return withRatio.reduce((a, b) => ((b.ratio as number) > (a.ratio as number) ? b : a));
}

/** 全体の状態。ひとつでも荒れていれば、そちらを名乗る。 */
export function overallLevel(pulses: VenuePulse[]): Level {
  if (pulses.some((p) => p.level === 'alert')) return 'alert';
  if (pulses.some((p) => p.level === 'watch')) return 'watch';
  return 'calm';
}

/**
 * 倍率の表示。
 *
 * 小数を細かく出しても意味が変わらないので、桁で丸める。
 * 「1.0倍」と「1.04倍」の違いを読み取る人はいない。
 */
export function formatRatio(ratio: number | null): string {
  if (ratio === null) return '—';
  if (ratio >= 10) return `${Math.round(ratio)}倍`;
  return `${ratio.toFixed(1)}倍`;
}
