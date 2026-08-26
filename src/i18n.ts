/**
 * 日本語と英語。
 *
 * ライブラリは入れない。文言はここに全部あり、追加も削除もこの1ファイルで済む。
 * 型で縛ってあるので、片方の言語だけ書き忘れるとビルドが通らない。
 *
 * URLは `/ja/...` `/en/...` の形にする。`?lang=ja` のようなパラメータ方式は
 * 検索エンジンに別ページとして扱われにくいため使わない。
 */

export const LOCALES = ['ja', 'en'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'ja';

export function isLocale(value: string | undefined): value is Locale {
  return LOCALES.includes(value as Locale);
}

/** Accept-Language から表示言語を決める。判断できなければ日本語。 */
export function localeFromHeader(header: string | undefined): Locale {
  if (!header) return DEFAULT_LOCALE;
  for (const part of header.split(',')) {
    const tag = part.split(';')[0]?.trim().toLowerCase() ?? '';
    if (tag.startsWith('ja')) return 'ja';
    if (tag.startsWith('en')) return 'en';
  }
  return DEFAULT_LOCALE;
}

type Messages = {
  siteName: string;
  tagline: string;
  heroIndex: string;
  heroPair: (pairName: string) => string;
  heroSub: string;
  description: (pairName: string) => string;
  amountLabel: string;
  amountUnit: string;
  calculate: string;
  lede: (pairName: string) => string;
  observedAt: (time: string) => string;
  noData: string;
  noDataYet: string;
  staleNotice: (minutes: number, time: string) => string;
  narrowest: (venue: string, gap: string) => string;
  chartTitle: string;
  chartNeedsJs: string;
  chartNotEnough: (points: number) => string;
  chartFailed: string;
  aboutTitle: string;
  about: string[];
  depthTitle: string;
  depthLede: string;
  depthAmount: string;
  depthNotEnough: string;
  depthNone: string;
  depthInsight: (small: string, large: string) => string;
  dealerWarnLead: string;
  dealerWarnBody: string;
  depthSameVenue: (venue: string) => string;
  bestQuoteTitle: string;
  bestQuoteNote: string;
  pairsTitle: string;
  indexLede: (amount: string) => string;
  indexNote: string;
  dailyTitle: string;
  dailyIntro: (pairName: string, date: string) => string;
  dailyColumns: { venue: string; avg: string; min: string; max: string; samples: string };
  dailyBest: (venue: string, value: string) => string;
  dailyCost: (amount: string, cost: string) => string;
  dailyNone: string;
  recentDays: string;
  prevDay: string;
  nextDay: string;
  backToPair: string;
  notFoundTitle: string;
  notFoundBody: string;
  errorTitle: string;
  errorBody: string;
  backHome: string;
  dataFooter: string;
  otherLanguage: string;
};

const JA: Messages = {
  siteName: 'スプレッド定点',
  tagline: '国内取引所のスプレッドを実測して記録',
  heroIndex: 'いくら買うかで、いちばん安い取引所は変わります',
  heroPair: (pair) => `${pair}は、いくら買うかで安い取引所が変わります`,
  heroSub: '国内4取引所の板を実測して、実際に消える金額で比べています。',
  description: (pair) =>
    `国内の暗号資産取引所の${pair}のスプレッドを1分ごとに実測して記録しています。同じ金額を買って売り戻したときに消える金額を、実測値で比べられます。`,
  amountLabel: '金額',
  amountUnit: '円',
  calculate: '計算',
  lede: (pair) => `この金額の${pair}をいま買って、すぐ売り戻すと消える金額です。`,
  observedAt: (time) => `${time} 実測`,
  noData: '観測データがまだありません',
  noDataYet: 'まだ観測データがありません。定期取得が始まると、ここに比較が出ます。',
  staleNotice: (minutes, time) =>
    `観測が${minutes}分止まっています。表示しているのは${time}時点の値です。`,
  narrowest: (venue, gap) =>
    `いちばん狭いのは ${venue}。同じ瞬間の取引所間の価格差は ${gap} でした。`,
  chartTitle: '24時間のスプレッド推移',
  chartNeedsJs:
    '推移グラフの表示にはJavaScriptが必要です。上の比較表はJavaScriptなしで読めます。',
  chartNotEnough: (points) =>
    `推移を描くにはあと少し観測が必要です（いま ${points} 点。10分ごとに1点増えます）。`,
  chartFailed: '推移グラフを読み込めませんでした。',
  aboutTitle: 'この数字について',
  about: [
    '各取引所が公開しているAPIから、板の最良気配を1分ごとに取得して計算しています。編集部が調べた値ではありません。取得に失敗した回は欠測として扱い、日別ページの観測数に出しています。',
    '表示しているのはスプレッドだけです。取引手数料・入出金手数料は含みません。',
    '取引所形式（板取引）の気配値です。販売所のレートは公開APIから取得できないため扱っていません。',
    'スプレッドは秒単位で変わります。ここにあるのは観測した瞬間の値で、いま注文して同じ値で約定することを保証するものではありません。',
    '特定の取引所をすすめるものでも、投資判断を助言するものでもありません。',
  ],
  depthTitle: '金額別の実効コスト',
  depthLede:
    '板に並んでいる注文を上から食べていったときに、実際に消える金額です。板の一番上の値段だけでは分かりません。',
  depthAmount: '買う金額',
  depthNotEnough: '板不足',
  depthNone: 'まだ板を観測できていません。',
  depthInsight: (small, large) =>
    `金額によって答えが変わります。少額なら${small}、大口なら${large}がいちばん安く済みます。`,
  dealerWarnLead: '同じ取引所でも「販売所」で買うと、この値段では買えません。',
  dealerWarnBody:
    '販売所は相手方が値段を決める仕組みで、板で買うより不利になります。差は桁で変わることもあります。このサイトが測っているのは板の値段だけです。「取引所」「板」と書かれた画面で買ってください。',
  depthSameVenue: (venue) => `どの金額でも${venue}がいちばん安く済みます。`,
  bestQuoteTitle: '板の一番上だけを見た場合',
  bestQuoteNote:
    'これは板の先頭に並んでいる、ごくわずかな量だけで買えたと仮定した数字です。実際に買える金額では上の表のようになります。下のグラフはこの数字の推移です。',
  pairsTitle: '銘柄',
  indexLede: (amount) => `${amount}を買ってすぐ売り戻したとき、いちばん損が小さい取引所と金額です。`,
  indexNote: '金額を上げると順位は入れ替わります。銘柄をひらくと金額別の表が出ます。',
  dailyTitle: '日別の記録',
  dailyIntro: (pair, date) => `${date}に観測した${pair}のスプレッドです。`,
  dailyColumns: { venue: '取引所', avg: '平均', min: '最小', max: '最大', samples: '観測数' },
  dailyBest: (venue, value) => `この日いちばん狭かったのは ${venue}（平均 ${value}）。`,
  dailyCost: (amount, cost) => `${amount}を買って売り戻すと、平均で ${cost} が消えた計算になります。`,
  dailyNone: 'この日の記録はありません。',
  recentDays: '最近の日別記録',
  prevDay: '前の日',
  nextDay: '次の日',
  backToPair: '最新のスプレッドに戻る',
  notFoundTitle: 'ページが見つかりません',
  notFoundBody: 'アドレスが変わったか、もともと存在しないページです。',
  errorTitle: '問題が起きました',
  errorBody: '時間をおいてもう一度開いてみてください。',
  backHome: '最新のスプレッドを見る',
  dataFooter: 'データはJSONでも取得できます。',
  otherLanguage: 'English',
};

const EN: Messages = {
  siteName: 'Spread Teiten',
  tagline: 'Measured spreads on Japanese crypto exchanges',
  heroIndex: 'The cheapest exchange depends on how much you buy',
  heroPair: (pair) => `For ${pair}, the cheapest exchange depends on how much you buy`,
  heroSub:
    'Measured from the live order books of four Japanese exchanges, in the yen you actually lose.',
  description: (pair) =>
    `We measure ${pair} spreads on Japanese crypto exchanges every minute and keep the record. Compare what a trade actually costs you, using measured numbers rather than published claims.`,
  amountLabel: 'Amount',
  amountUnit: 'JPY',
  calculate: 'Calculate',
  lede: (pair) => `What you lose if you buy this much ${pair} now and sell it straight back.`,
  observedAt: (time) => `measured ${time}`,
  noData: 'No observations yet',
  noDataYet: 'No observations yet. The comparison appears once collection starts.',
  staleNotice: (minutes, time) =>
    `Collection has been stopped for ${minutes} minutes. These are the values from ${time}.`,
  narrowest: (venue, gap) =>
    `${venue} is narrowest. The price gap between exchanges at that moment was ${gap}.`,
  chartTitle: 'Spread over the last 24 hours',
  chartNeedsJs: 'The chart needs JavaScript. The comparison above reads fine without it.',
  chartNotEnough: (points) =>
    `Not enough observations to draw a line yet (${points} so far, one more every ten minutes).`,
  chartFailed: 'Could not load the chart.',
  aboutTitle: 'About these numbers',
  about: [
    'Best bid and ask are read from each exchange’s public API every minute and the spread is computed from them. Nobody looked these up by hand. Failed reads are counted as gaps and shown in the sample count on each daily page.',
    'Only the spread is shown. Trading fees and deposit or withdrawal fees are not included.',
    'These are order book quotes. Dealer (hanbaisho) rates are not available from public APIs, so they are not covered.',
    'Spreads move by the second. These are the values at the moment of observation and are no guarantee of the price you will get.',
    'This is not a recommendation of any exchange, nor investment advice.',
  ],
  depthTitle: 'What it really costs, by size',
  depthLede:
    'What actually disappears once you eat through the orders sitting on the book. The top quote alone does not tell you this.',
  depthAmount: 'Order size',
  depthNotEnough: 'book too thin',
  depthNone: 'No order book observations yet.',
  depthInsight: (small, large) =>
    `The answer depends on size. ${small} is cheapest for small orders, ${large} for large ones.`,
  dealerWarnLead: 'At the same exchange, the dealer desk will not sell to you at these prices.',
  dealerWarnBody:
    'A dealer desk (hanbaisho) sets its own price as your counterparty, which is worse than buying on the book, sometimes by orders of magnitude. This site measures the order book only. Buy on the screen labelled 取引所 or 板.',
  depthSameVenue: (venue) => `${venue} is cheapest at every size.`,
  bestQuoteTitle: 'Top of book only',
  bestQuoteNote:
    'This assumes you fill against the tiny amount sitting at the very front of the book. For sizes you would actually trade, see the table above. The chart below tracks this number over time.',
  pairsTitle: 'Assets',
  indexLede: (amount) => `The cheapest exchange, and what it costs, if you buy ${amount} and sell it straight back.`,
  indexNote: 'The order changes at larger sizes. Open an asset to see the full table.',
  dailyTitle: 'Daily record',
  dailyIntro: (pair, date) => `${pair} spreads observed on ${date}.`,
  dailyColumns: { venue: 'Exchange', avg: 'Average', min: 'Lowest', max: 'Highest', samples: 'Samples' },
  dailyBest: (venue, value) => `${venue} was narrowest that day (average ${value}).`,
  dailyCost: (amount, cost) =>
    `Buying ${amount} and selling straight back would have cost ${cost} on average.`,
  dailyNone: 'No record for this day.',
  recentDays: 'Recent days',
  prevDay: 'Previous day',
  nextDay: 'Next day',
  backToPair: 'Back to the latest spreads',
  notFoundTitle: 'Page not found',
  notFoundBody: 'The address may have changed, or this page never existed.',
  errorTitle: 'Something went wrong',
  errorBody: 'Please try opening the page again in a little while.',
  backHome: 'See the latest spreads',
  dataFooter: 'The data is also available as JSON.',
  otherLanguage: '日本語',
};

const MESSAGES: Record<Locale, Messages> = { ja: JA, en: EN };

export function t(locale: Locale): Messages {
  return MESSAGES[locale];
}

/** 相手の言語（いまはもう一方）。言語切り替えリンクに使う。 */
export function otherLocale(locale: Locale): Locale {
  return locale === 'ja' ? 'en' : 'ja';
}

/** その言語での通貨名。 */
export function pairName(locale: Locale, pair: { nameJa: string; nameEn: string }): string {
  return locale === 'ja' ? pair.nameJa : pair.nameEn;
}
