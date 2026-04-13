#!/usr/bin/env node
// scripts/cross-ref.mjs
// 自动检测信件与概念/公司/人物的交叉引用
// 运行：node scripts/cross-ref.mjs
// 输出：data/cross-references.json

import { readdir, readFile, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';

const ROOT = '/Users/RVTYadmin/git/personal/value-investment';
const CONTENT = join(ROOT, 'content');
const DATA = join(ROOT, 'data');

function extractTitle(content) {
  const m = content.match(/title:\s*"([^"]+)"/);
  return m ? m[1] : null;
}

function getBody(content) {
  // Find second occurrence of ---
  const first = content.indexOf('---');
  if (first < 0) return content;
  const second = content.indexOf('---', first + 3);
  if (second < 0) return content;
  return content.substring(second + 3);
}

async function buildKeywordMap(dir) {
  const map = new Map();
  const files = await readdir(join(CONTENT, dir));
  for (const file of files) {
    if (!file.endsWith('.md')) continue;
    const slug = file.replace('.md', '');
    const content = await readFile(join(CONTENT, dir, file), 'utf-8');
    const title = extractTitle(content);
    if (!title) continue;
    // Extract Chinese name
    const cn = title.replace(/（[^）]*）/g, '').replace(/\([^)]*\)/g, '').trim();
    // Extract English name
    const engM = title.match(/（([^）]+)）/) || title.match(/\(([^)]+)\)/);
    const en = engM ? engM[1].trim() : null;
    if (cn && cn.length >= 2) map.set(cn, slug);
    if (en && en.length >= 3) {
      map.set(en, slug);
      const short = en.replace(/^The\s+/i, '').replace(/\s+(Company|Corp\.?|Inc\.?|Ltd\.?|Co\.?)$/i, '').trim();
      if (short.length >= 3 && short !== en) map.set(short, slug);
    }
    // Add aliases
    const aliases = getAliases(slug);
    for (const a of aliases) map.set(a, slug);
  }
  return map;
}

function getAliases(slug) {
  const m = ALIAS_MAP;
  return m[slug] || [];
}

const ALIAS_MAP = {
  'moat': ['护城河', '经济护城河'],
  'intrinsic-value': ['内在价值', '内在商业价值'],
  'margin-of-safety': ['安全边际'],
  'mr-market': ['市场先生'],
  'circle-of-competence': ['能力圈'],
  'compound-interest': ['复利', '复合增长'],
  'book-value': ['账面价值'],
  'insurance-float': ['浮存金', '保险浮存金'],
  'inflation': ['通货膨胀', '通胀'],
  'goodwill': ['商誉', '经济商誉'],
  'capital-allocation': ['资本配置'],
  'dividends': ['分红', '股息'],
  'buybacks': ['股票回购'],
  'leverage': ['杠杆'],
  'arbitrage': ['套利'],
  'derivatives': ['衍生品', '衍生工具'],
  'management': ['管理层'],
  'long-term-holding': ['长期持有', '永久持有'],
  'look-through-earnings': ['透视收益'],
  'retained-earnings': ['留存收益'],
  'competitive-advantage': ['竞争优势'],
  'brand': ['品牌价值'],
  'franchise': ['特许经营权', '经济特许权'],
  'shareholder-orientation': ['股东导向', '股东利益'],
  'corporate-governance': ['公司治理'],
  'corporate-culture': ['企业文化'],
  'underwriting-discipline': ['承保纪律', '保险承保'],
  'insurance-industry': ['保险业', '保险行业'],
  'efficient-market': ['有效市场'],
  'pe-ratio': ['市盈率'],
  'convertible-securities': ['可转换证券', '优先股'],
  'business-model': ['商业模式'],
  'textile-business': ['纺织业', '纺织业务', '纺织'],
  'concentrated-investing': ['集中投资', '集中持股'],
  'diversification': ['分散投资', '分散化'],
  'acquisitions': ['并购'],
  'integrity': ['诚信', '诚实'],
  'purchase-price': ['买入价格'],
  'undervaluation': ['被低估'],
  'tax-efficiency': ['税务效率', '节税'],
  'media-and-publishing': ['报纸', '出版'],
  'railroad-transportation': ['铁路运输'],
  'banking': ['银行业'],
  'energy': ['能源'],
  'bonds': ['债券'],
  'airline-industry': ['航空业', '航空公司'],
  'retail-and-consumer': ['零售'],
  'technology-and-internet': ['互联网'],
  'coca-cola': ['可口可乐'],
  'berkshire-hathaway': ['伯克希尔', '伯克希尔·哈撒韦'],
  'geico': ['盖可保险', '盖可'],
  'national-indemnity': ['国民保险', '国民保险公司'],
  'sees-candies': ['喜诗糖果', '喜诗'],
  'washington-post': ['华盛顿邮报'],
  'apple': ['苹果公司'],
  'american-express': ['美国运通'],
  'wells-fargo': ['富国银行', '富国'],
  'gillette': ['吉列'],
  'general-re': ['通用再保险'],
  'blue-chip-stamps': ['蓝筹印花'],
  'buffalo-news': ['布法罗新闻报'],
  'nebraska-furniture-mart': ['内布拉斯加家具'],
  'bnsf-railway': ['BNSF', '伯灵顿北方'],
  'dairy-queen': ['冰雪皇后'],
  'flightsafety': ['飞安国际', '飞安公司'],
  'fruit-of-the-loom': ['鲜果布衣'],
  'ibm': ['IBM'],
  'kraft-heinz': ['卡夫亨氏'],
  'moodys': ['穆迪'],
  'salomon': ['所罗门'],
  'bank-of-america': ['美国银行'],
  'capital-cities': ['大都会'],
  'scott-fetzer': ['斯科特费泽'],
  'wesco': ['韦斯科'],
  'freddie-mac': ['房地美'],
  'dexter-shoe': ['德克斯特鞋业'],
  'netjets': ['利捷航空'],
  'clayton-homes': ['克莱顿房屋'],
  'iscar': ['伊斯卡'],
  'precision-castparts': ['精密铸件'],
  'lubrizol': ['路博润'],
  'berkshire-hathaway-energy': ['伯克希尔能源'],
  'byd': ['比亚迪'],
  'petrochina': ['中石油'],
  'occidental-petroleum': ['西方石油'],
  'chevron': ['雪佛龙'],
  'general-electric': ['通用电气'],
  'general-motors': ['通用汽车'],
  'goldman-sachs': ['高盛'],
  'conocophillips': ['康菲石油'],
  'marmon-group': ['马蒙集团'],
  'borsheims': ['波仙'],
  'charlie-munger': ['芒格', '查理·芒格', '查理'],
  'benjamin-graham': ['格雷厄姆', '本杰明·格雷厄姆'],
  'ajit-jain': ['阿吉特', '阿吉特·贾恩'],
  'greg-abel': ['阿贝尔', '格雷格·阿贝尔'],
  'mrs-b': ['B夫人', '罗丝·布鲁姆金'],
  'todd-combs': ['托德·库姆斯'],
  'ted-weschler': ['泰德·韦施勒'],
};

function findMentions(body, keywordMap) {
  const found = new Set();
  for (const [keyword, slug] of keywordMap) {
    if (keyword.length < 2) continue;
    if (body.includes(keyword)) found.add(slug);
  }
  return [...found];
}

async function readLetters(dir) {
  const letters = [];
  const files = await readdir(join(CONTENT, dir));
  for (const file of files) {
    if (!file.endsWith('.md')) continue;
    const slug = file.replace('.md', '');
    const content = await readFile(join(CONTENT, dir, file), 'utf-8');
    const body = getBody(content);
    letters.push({ slug, dir, body, fullPath: dir + '/' + slug });
  }
  return letters;
}

async function main() {
  console.log('Building keyword maps...');
  const conceptsMap = await buildKeywordMap('concepts');
  const companiesMap = await buildKeywordMap('companies');
  const peopleMap = await buildKeywordMap('people');
  console.log('  Concepts:', conceptsMap.size, 'keywords ->', new Set(conceptsMap.values()).size, 'slugs');
  console.log('  Companies:', companiesMap.size, 'keywords ->', new Set(companiesMap.values()).size, 'slugs');
  console.log('  People:', peopleMap.size, 'keywords ->', new Set(peopleMap.values()).size, 'slugs');

  console.log('\nReading letters...');
  const all = [
    ...await readLetters('shareholder-letters'),
    ...await readLetters('partnership-letters'),
    ...await readLetters('special-letters'),
  ];
  console.log('  Total letters:', all.length);

  console.log('\nScanning for cross-references...');
  const crossRefs = { concepts: {}, companies: {}, people: {}, letters: {} };

  for (const letter of all) {
    const mc = findMentions(letter.body, conceptsMap);
    const mco = findMentions(letter.body, companiesMap);
    const mp = findMentions(letter.body, peopleMap);
    for (const s of mc) { if (!crossRefs.concepts[s]) crossRefs.concepts[s] = []; crossRefs.concepts[s].push(letter.fullPath); }
    for (const s of mco) { if (!crossRefs.companies[s]) crossRefs.companies[s] = []; crossRefs.companies[s].push(letter.fullPath); }
    for (const s of mp) { if (!crossRefs.people[s]) crossRefs.people[s] = []; crossRefs.people[s].push(letter.fullPath); }
    crossRefs.letters[letter.fullPath] = { concepts_discussed: mc, companies_mentioned: mco, people_mentioned: mp };
  }

  for (const cat of ['concepts', 'companies', 'people']) {
    for (const s of Object.keys(crossRefs[cat])) crossRefs[cat][s].sort();
  }

  console.log('\nResults:');
  console.log('  Concepts referenced:', Object.keys(crossRefs.concepts).length);
  console.log('  Companies referenced:', Object.keys(crossRefs.companies).length);
  console.log('  People referenced:', Object.keys(crossRefs.people).length);

  await mkdir(DATA, { recursive: true });
  const out = join(DATA, 'cross-references.json');
  await writeFile(out, JSON.stringify(crossRefs, null, 2), 'utf-8');
  console.log('\nOutput written to:', out);

  console.log('\n--- Top 10 most referenced concepts ---');
  Object.entries(crossRefs.concepts).sort((a,b) => b[1].length - a[1].length).slice(0,10)
    .forEach(([s,r]) => console.log('  ' + s + ': ' + r.length + ' letters'));
  console.log('\n--- Top 10 most referenced companies ---');
  Object.entries(crossRefs.companies).sort((a,b) => b[1].length - a[1].length).slice(0,10)
    .forEach(([s,r]) => console.log('  ' + s + ': ' + r.length + ' letters'));
  console.log('\n--- Top 5 most referenced people ---');
  Object.entries(crossRefs.people).sort((a,b) => b[1].length - a[1].length).slice(0,5)
    .forEach(([s,r]) => console.log('  ' + s + ': ' + r.length + ' letters'));
}

main().catch(console.error);
