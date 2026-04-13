#!/usr/bin/env python3
"""
把 data/quotes.yml 和 data/scraped-quotes.yml 中的金句
按来源整理到各自的 content/{category}/{slug}-quotes.md 文件中。

source_page 映射规则：
  - shareholder-letters/YYYY.md          -> (shareholder-letters, YYYY)
  - partnership-letters/YYYY-xxx.md      -> (partnership-letters, YYYY-xxx)
  - berkshire/YYYY-巴菲特致股东信          -> (shareholder-letters, YYYY)
  - companies/中文名  /  companies/en.md  -> (companies, mapped_english_slug)
  - concepts/中文名   /  concepts/en.md   -> (concepts,  mapped_english_slug)
  - people/中文名                          -> (people,    mapped_english_slug)
"""

import yaml
import re
from collections import defaultdict
from pathlib import Path

ROOT    = Path('/Users/RVTYadmin/git/personal/value-investment')
CONTENT = ROOT / 'content'

# ──────────────────────────────────────────────
# 1. 中文→英文 slug 映射表
# ──────────────────────────────────────────────
COMPANY_MAP = {
    '可口可乐':         'coca-cola',
    '盖可保险':         'geico',
    '喜诗糖果':         'sees-candies',
    '华盛顿邮报':       'washington-post',
    '美国运通':         'american-express',
    '富国银行':         'wells-fargo',
    'IBM':              'ibm',
    '苹果':             'apple',
    '比亚迪':           'byd',
    'BNSF铁路':         'bnsf-railway',
    '伯克希尔哈撒韦':   'berkshire-hathaway',
    '伯克希尔哈撒韦能源': 'berkshire-hathaway-energy',
    '中美能源':         'midamerican-energy',
    '吉列':             'gillette',
    '卡夫亨氏':         'kraft-heinz',
    '内布拉斯加家具店': 'nebraska-furniture-mart',
    '所罗门':           'salomon',
    '克莱顿房屋':       'clayton-homes',
    '通用再保险':       'general-re',
    '通用汽车':         'general-motors',
    '通用电气':         'general-electric',
    '路博润':           'lubrizol',
    '精密铸件':         'precision-castparts',
    '三井物产':         'mitsui',
    '三菱商事':         'mitsubishi',
    '中国石油':         'petrochina',
    '伊斯卡':           'iscar',
    '约翰斯曼维尔':     'johns-manville',
    '纽约梅隆银行':     'bny-mellon',
    '马蒙集团':         'marmon-group',
    '穆迪':             'moodys',
    '德克斯特鞋业':     'dexter-shoe',
    '康菲石油':         'conocophillips',
    '特许通讯':         'charter-communications',
    '西方石油':         'occidental-petroleum',
    '美国银行':         'bank-of-america',
    '美国家庭服务':     'american-home-services',
    '美国合众银行':     'us-bancorp',
    '国民保险公司':     'national-indemnity',
    '波仙珠宝':         'borsheims',
    '科比吸尘器':       'kirby',
    '利捷航空':         'netjets',
    '冰雪皇后':         'dairy-queen',
    '布法罗新闻报':     'buffalo-news',
    '蓝筹印花':         'blue-chip-stamps',
    '斯科特费泽':       'scott-fetzer',
    '鲜果布衣':         'fruit-of-the-loom',
    '大都会通信':       'capital-cities',
    '威瑞森通讯':       'verizon',
    '森林河公司':       'forest-river',
    '雪佛龙':           'chevron',
    '房地美':           'freddie-mac',
    '韦斯科':           'wesco',
    '飞安公司':         'flightsafety',
    '麦克莱恩':         'mclane',
    '费希海默制服':     'fechheimer',
    '伊藤忠':           'itochu',
    '州立农业保险':     'state-farm',
}

CONCEPT_MAP = {
    '护城河':           'moat',
    '内在价值':         'intrinsic-value',
    '安全边际':         'margin-of-safety',
    '复利':             'compound-interest',
    '市场先生':         'mr-market',
    '竞争优势':         'competitive-advantage',
    '管理层':           'management',
    '资本配置':         'capital-allocation',
    '保险浮存金':       'insurance-float',
    '保险业':           'insurance-industry',
    '能力圈':           'circle-of-competence',
    '股东导向':         'shareholder-orientation',
    '商业模式':         'business-model',
    '品牌':             'brand',
    '收购':             'acquisitions',
    '回购':             'buybacks',
    '股息':             'dividends',
    '债券':             'bonds',
    '衍生品':           'derivatives',
    '套利':             'arbitrage',
    '企业文化':         'corporate-culture',
    '公司治理':         'corporate-governance',
    '长期持有':         'long-term-holding',
    '集中投资':         'concentrated-investing',
    '分散投资':         'diversification',
    '可转换证券':       'convertible-securities',
    '账面价值':         'book-value',
    '留存收益':         'retained-earnings',
    '通货膨胀':         'inflation',
    '商誉':             'goodwill',
    '特许经营权':       'franchise',
    '银行业':           'banking',
    '能源':             'energy',
    '航空业':           'airline-industry',
    '铁路运输':         'railroad-transportation',
    '零售与消费':       'retail-and-consumer',
    '科技与互联网':     'technology-and-internet',
    '市盈率':           'pe-ratio',
    '低估':             'undervaluation',
    '纺织业务':         'textile-business',
    '透视盈余':         'look-through-earnings',
    '诚信':             'integrity',
    '有效市场':         'efficient-market',
    '税收效率':         'tax-efficiency',
    '媒体与出版':       'media-and-publishing',
    '市场预测':         'market-forecasting',
    '杠杆':             'leverage',
    '买入价格':         'purchase-price',
    '承保纪律':         'underwriting-discipline',
}

PEOPLE_MAP = {
    '芒格':             'charlie-munger',
    '格雷厄姆':         'benjamin-graham',
    '格雷格·阿贝尔':   'greg-abel',
    '阿吉特·贾恩':     'ajit-jain',
    '泰德·韦施勒':     'ted-weschler',
    '托德·库姆斯':     'todd-combs',
    'B夫人':            'mrs-b',
}

# ──────────────────────────────────────────────
# 2. source_page -> (category_dir, slug) 解析
# ──────────────────────────────────────────────
def parse_source_page(source_page):
    """返回 (category_dir, slug) 或 None。"""
    if not source_page:
        return None

    parts  = source_page.split('/', 1)
    prefix = parts[0]
    rest   = parts[1] if len(parts) > 1 else ''

    if prefix == 'shareholder-letters':
        slug = rest[:-3] if rest.endswith('.md') else rest
        return ('shareholder-letters', slug)

    if prefix == 'partnership-letters':
        slug = rest[:-3] if rest.endswith('.md') else rest
        return ('partnership-letters', slug)

    # 旧式抓取路径 berkshire/YYYY-巴菲特致股东信
    if prefix == 'berkshire':
        m = re.match(r'^(\d{4})', rest)
        if m:
            return ('shareholder-letters', m.group(1))
        return None

    if prefix == 'companies':
        raw  = rest[:-3] if rest.endswith('.md') else rest
        slug = COMPANY_MAP.get(raw, raw)
        return ('companies', slug)

    if prefix == 'concepts':
        raw  = rest[:-3] if rest.endswith('.md') else rest
        slug = CONCEPT_MAP.get(raw, raw)
        return ('concepts', slug)

    if prefix == 'people':
        raw  = rest[:-3] if rest.endswith('.md') else rest
        slug = PEOPLE_MAP.get(raw, raw)
        return ('people', slug)

    return None


def parse_from_fields(q):
    """从 quotes.yml 传统字段推导 (category_dir, slug)。"""
    cat  = q.get('source_category', '')
    slug = str(q.get('source_slug', q.get('source_year', ''))).strip()
    if not slug:
        return None
    if 'shareholder' in cat:
        return ('shareholder-letters', slug)
    if 'partnership' in cat:
        return ('partnership-letters', slug)
    if 'special' in cat:
        return ('special-letters', slug)
    return None


# ──────────────────────────────────────────────
# 3. 读取 & 合并金句（按文本去重）
# ──────────────────────────────────────────────
def load_quotes(yml_path):
    with open(yml_path, 'r', encoding='utf-8') as f:
        data = yaml.safe_load(f)
    return data.get('quotes', [])


seen_texts = set()
all_quotes = []

for q in load_quotes(ROOT / 'data/quotes.yml'):
    text = q.get('text', '').strip()
    if text and text not in seen_texts:
        seen_texts.add(text)
        all_quotes.append(q)

for q in load_quotes(ROOT / 'data/scraped-quotes.yml'):
    text = q.get('text', '').strip()
    if text and text not in seen_texts and len(text) > 20:
        seen_texts.add(text)
        all_quotes.append(q)

print(f'合并后总金句数：{len(all_quotes)}')

# ──────────────────────────────────────────────
# 4. 按 (category_dir, slug) 分组
# ──────────────────────────────────────────────
quotes_by_key = defaultdict(list)
unsorted_list = []

for q in all_quotes:
    key = parse_source_page(q.get('source_page', '')) or parse_from_fields(q)
    if key:
        quotes_by_key[key].append(q)
    else:
        unsorted_list.append(q)

print(f'已分组：{sum(len(v) for v in quotes_by_key.values())} 条 | 未分组：{len(unsorted_list)} 条')

# ──────────────────────────────────────────────
# 5. 来源归属行
# ──────────────────────────────────────────────
CATEGORY_LABELS = {
    'shareholder-letters': '致股东信',
    'partnership-letters': '合伙人信',
    'special-letters':     '特别信件',
    'concepts':            '投资概念',
    'companies':           '公司',
    'people':              '人物',
}

def build_attribution(q, category):
    year = q.get('source_letter_year') or q.get('source_year')
    attr = q.get('attribution', '')
    if year:
        label = CATEGORY_LABELS.get(category, '')
        return f'*——巴菲特，{year}年{label}*'
    if attr:
        first_line = attr.strip().splitlines()[0].strip('"').strip()
        if first_line:
            return f'*——{first_line}*'
    return ''


# ──────────────────────────────────────────────
# 6. 生成 {slug}-quotes.md
# ──────────────────────────────────────────────
generated = []
skipped   = []

for (category, slug), quotes in sorted(quotes_by_key.items()):
    target_dir = CONTENT / category
    if not target_dir.exists():
        skipped.append(f'{category}/{slug}  (目录不存在)')
        continue

    out_path = target_dir / f'{slug}-quotes.md'
    title    = f'{slug} 精选金句'

    lines = [
        '---',
        f'title: "{title}"',
        'category: "quotes"',
        f'source_slug: "{slug}"',
        f'source_category: "{category}"',
        f'count: {len(quotes)}',
        '---',
        '',
        f'# {title}',
        '',
    ]

    for i, q in enumerate(quotes, 1):
        text = q.get('text', '').strip()
        if not text:
            continue

        for bq_line in text.splitlines():
            lines.append(f'> {bq_line}' if bq_line.strip() else '>')
        lines.append('')

        attr = build_attribution(q, category)
        if attr:
            lines.append(attr)
            lines.append('')

        if i < len(quotes):
            lines.append('---')
            lines.append('')

    out_path.write_text('\n'.join(lines), encoding='utf-8')
    generated.append(f'  ✓ {out_path.relative_to(ROOT)}  ({len(quotes)} 条)')

# ──────────────────────────────────────────────
# 7. 汇总
# ──────────────────────────────────────────────
print(f'\n生成文件 ({len(generated)} 个)：')
for line in generated:
    print(line)

if skipped:
    print(f'\n跳过 ({len(skipped)} 项，目录不存在）：')
    for line in skipped:
        print(f'  ✗ {line}')

if unsorted_list:
    print(f'\n未分组金句（{len(unsorted_list)} 条，source_page 无法解析）：')
    for q in unsorted_list[:5]:
        print(f'  · [{q.get("id", "")}] page={q.get("source_page", "")}')
    if len(unsorted_list) > 5:
        print(f'  … 共 {len(unsorted_list)} 条')

print('\n完成！')
