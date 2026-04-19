#!/usr/bin/env node
/**
 * MyCloudAI 价值投资 - SPA Build Script
 * 
 * This build script does NOT generate any HTML pages.
 * It only:
 *   1. Syncs MD files: ../content/ → site/content/ (copy)
 *   2. Generates site/content/manifest.json (directory index)
 *   3. Generates site/assets/data/search-index.json (chunked text for Fuse.js)
 *   4. Generates site/assets/data/graph-data.json (nodes + edges for D3.js)
 *   5. Compiles content/skills/buffett-skill.md → functions/api/_buffett-skill.js & site/assets/data/buffett-skill.json
 *   6. Generates site/_redirects (SPA routing)
 *   7. Generates site/_headers (security headers)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { readFile, writeFile } from 'fs/promises';
import matter from 'gray-matter';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CONTENT_DIR = path.join(__dirname, 'content');
const SITE_DIR = path.join(__dirname, 'site');
const SITE_CONTENT_DIR = path.join(SITE_DIR, 'content');
const ASSETS_DIR = path.join(SITE_DIR, 'assets');

// ─── Configuration ───────────────────────────────────────────────
const CATEGORY_MAP = {
  'shareholder-letter': { dir: 'shareholder-letters', label: '伯克希尔股东信', icon: '📄', order: 2 },
  'partnership-letter': { dir: 'partnership-letters', label: '合伙基金信件', icon: '📋', order: 1 },
  'special-letter':     { dir: 'special-letters',     label: '特别信件',       icon: '📌', order: 3 },
  'concept':            { dir: 'concepts',             label: '投资理念',       icon: '💡', order: 4 },
  'company':            { dir: 'companies',            label: '公司解析',       icon: '🏢', order: 5 },
  'person':             { dir: 'people',               label: '关键人物',       icon: '👤', order: 6 }
};

const DIR_TO_CATEGORY = {
  'shareholder-letters': 'shareholder-letter',
  'partnership-letters': 'partnership-letter',
  'special-letters': 'special-letter',
  'concepts': 'concept',
  'companies': 'company',
  'people': 'person'
};

// ─── Helpers ─────────────────────────────────────────────────────
function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function slugFromFilename(filename) {
  return path.basename(filename, '.md');
}

function cleanDir(dir) {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  ensureDir(dir);
}

// ─── Read all documents ──────────────────────────────────────────
function readAllDocs() {
  const docs = [];
  const contentDirs = fs.readdirSync(CONTENT_DIR);

  for (const dir of contentDirs) {
    const dirPath = path.join(CONTENT_DIR, dir);
    if (!fs.statSync(dirPath).isDirectory()) continue;
    if (dir === 'skills') continue; // handled separately by compileBuffettSkill

    const files = fs.readdirSync(dirPath).filter(f =>
      f.endsWith('.md') &&
      !f.endsWith('-quotes.md') &&
      !f.endsWith('-en.md') &&
      !f.endsWith('-quotes-en.md')
    );
    for (const file of files) {
      const filePath = path.join(dirPath, file);
      const raw = fs.readFileSync(filePath, 'utf-8');
      const { data: frontmatter, content } = matter(raw);
      const slug = slugFromFilename(file);
      const category = frontmatter.category || DIR_TO_CATEGORY[dir] || 'concept';
      const catInfo = CATEGORY_MAP[category];
      const outputDir = catInfo ? catInfo.dir : dir;

      docs.push({
        slug,
        title: frontmatter.title || slug,
        year: frontmatter.year || null,
        category,
        url: frontmatter.url || '',
        content,
        sourceDir: dir,
        outputDir,
        // SPA routes: no .html extension
        route: '/' + outputDir + '/' + slug,
        filePath,
        // Extra front matter fields for index pages
        summary: frontmatter.summary || '',
        description: frontmatter.description || '',
        tags: frontmatter.tags || [],
        wikipedia: frontmatter.wikipedia || '',
        baidu_baike: frontmatter.baidu_baike || '',
        mentioned_in_letters: frontmatter.mentioned_in_letters || [],
        english_name: frontmatter.english_name || '',
        role: frontmatter.role || '',
        relationship: frontmatter.relationship || '',
        importance: frontmatter.importance || '',
        // Cross-reference fields (letters → entities)
        concepts_discussed: frontmatter.concepts_discussed || [],
        companies_mentioned: frontmatter.companies_mentioned || [],
        people_mentioned: frontmatter.people_mentioned || []
      });
    }
  }

  return docs;
}

// ─── Sync MD files to site/content/ ──────────────────────────────
function syncContentFiles() {
  // Clean and recreate site/content/
  cleanDir(SITE_CONTENT_DIR);

  const contentDirs = fs.readdirSync(CONTENT_DIR);
  let fileCount = 0;

  for (const dir of contentDirs) {
    const srcDir = path.join(CONTENT_DIR, dir);
    if (!fs.statSync(srcDir).isDirectory()) continue;

    const destDir = path.join(SITE_CONTENT_DIR, dir);
    ensureDir(destDir);

    const files = fs.readdirSync(srcDir).filter(f => f.endsWith('.md'));
    for (const file of files) {
      fs.copyFileSync(path.join(srcDir, file), path.join(destDir, file));
      fileCount++;
    }
  }

  return fileCount;
}

// ─── Generate manifest.json ──────────────────────────────────────
function generateManifest(docs) {
  const items = docs.map(doc => {
    const item = {
      id: doc.outputDir + '/' + doc.slug,
      title: doc.title,
      category: doc.category,
      year: doc.year,
      path: '/content/' + doc.sourceDir + '/' + doc.slug + '.md',
      route: doc.route,
      slug: doc.slug,
      // Extra fields for enhanced index pages
      summary: doc.summary || '',
      description: doc.description,
      tags: doc.tags,
      wikipedia: doc.wikipedia,
      baidu_baike: doc.baidu_baike,
      letter_count: doc.mentioned_in_letters.length,
      english_name: doc.english_name,
      role: doc.role,
      relationship: doc.relationship,
      importance: doc.importance
    };
    // Cross-reference fields (letters → entities, entities → letters)
    if (doc.concepts_discussed && doc.concepts_discussed.length) item.concepts_discussed = doc.concepts_discussed;
    if (doc.companies_mentioned && doc.companies_mentioned.length) item.companies_mentioned = doc.companies_mentioned;
    if (doc.people_mentioned && doc.people_mentioned.length) item.people_mentioned = doc.people_mentioned;
    if (doc.mentioned_in_letters && doc.mentioned_in_letters.length) item.mentioned_in_letters = doc.mentioned_in_letters;
    return item;
  });

  // Build nav groups (sorted)
  const nav = {};
  const catEntries = Object.entries(CATEGORY_MAP).sort((a, b) => a[1].order - b[1].order);
  
  for (const [cat, info] of catEntries) {
    const catItems = items
      .filter(item => item.category === cat)
      .sort((a, b) => {
        if (a.year && b.year) return a.year - b.year;
        return a.slug.localeCompare(b.slug);
      });
    
    // Use camelCase key matching the dir name
    const key = info.dir.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    nav[key] = catItems;
  }

  // Stats
  const letterCats = ['shareholder-letter', 'partnership-letter', 'special-letter'];
  const letterCount = items.filter(i => letterCats.includes(i.category)).length;

  // Read version from package.json
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf-8'));

  const manifest = {
    generated: new Date().toISOString(),
    version: pkg.version,
    stats: {
      total: items.length,
      letters: letterCount,
      concepts: items.filter(i => i.category === 'concept').length,
      companies: items.filter(i => i.category === 'company').length,
      people: items.filter(i => i.category === 'person').length
    },
    items,
    nav,
    quotesFiles: collectQuotesFiles()
  };

  return manifest;
}

// ─── Collect all *-quotes.md files for the quotes page ───────────
function collectQuotesFiles() {
  const results = [];
  const contentDirs = fs.readdirSync(CONTENT_DIR);
  for (const dir of contentDirs) {
    const dirPath = path.join(CONTENT_DIR, dir);
    if (!fs.statSync(dirPath).isDirectory()) continue;
    if (dir === 'skills') continue;
    const files = fs.readdirSync(dirPath).filter(f => f.endsWith('-quotes.md') && !f.endsWith('-quotes-en.md'));
    for (const file of files) {
      const raw = fs.readFileSync(path.join(dirPath, file), 'utf-8');
      const { data: fm } = matter(raw);
      results.push({
        path: '/content/' + dir + '/' + file,
        sourceSlug: fm.source_slug || file.replace(/-quotes\.md$/, ''),
        sourceCategory: fm.source_category || DIR_TO_CATEGORY[dir] || dir,
        sourceDir: dir,
        title: fm.title || file.replace(/-quotes\.md$/, '') + ' 精选金句',
        count: fm.count || 0
      });
    }
  }
  return results;
}

// ─── Extract all quotes and generate quotes-data.json ────────────
function generateQuotesData(quotesFiles, items) {
  const allQuotes = [];
  for (const qf of quotesFiles) {
    const filePath = path.join(SITE_CONTENT_DIR, qf.path.replace('/content/', ''));
    if (!fs.existsSync(filePath)) continue;
    const raw = fs.readFileSync(filePath, 'utf-8');
    const quotes = extractQuotesFromText(raw);
    // Resolve source title and route
    let sourceTitle = qf.title;
    let sourceRoute = '';
    for (const item of items) {
      if (item.slug === qf.sourceSlug) {
        sourceTitle = item.title;
        sourceRoute = item.route;
        break;
      }
    }
    for (const q of quotes) {
      allQuotes.push({
        t: q,
        s: sourceTitle,
        r: sourceRoute,
        c: qf.sourceDir
      });
    }
  }
  return allQuotes;
}

function extractQuotesFromText(raw) {
  // Remove front matter
  const fmMatch = raw.match(/^---\n[\s\S]*?\n---\n([\s\S]*)$/);
  const body = fmMatch ? fmMatch[1] : raw;
  const quotes = [];
  const lines = body.split('\n');
  let current = '';
  for (const line of lines) {
    if (line.trim().startsWith('>')) {
      const text = line.replace(/^>\s*/, '').trim();
      if (text) current += (current ? ' ' : '') + text;
    } else {
      if (current) {
        current = current.replace(/\*\*(.*?)\*\*/g, '$1').replace(/\*(.*?)\*/g, '$1');
        quotes.push(current);
        current = '';
      }
    }
  }
  if (current) {
    current = current.replace(/\*\*(.*?)\*\*/g, '$1').replace(/\*(.*?)\*/g, '$1');
    quotes.push(current);
  }
  return quotes;
}

// ─── Extract Buffett Skill Knowledge ─────────────────────────────
function extractBuffettSkillKnowledge(docs) {
  const skillSources = [
    { slug: '1957', cat: 'partnership-letter', label: '1957年合伙人信 - 早期投资哲学' },
    { slug: '1962', cat: 'partnership-letter', label: '1962年合伙人信 - 价值投资方法' },
    { slug: '1977', cat: 'shareholder-letter', label: '1977年股东信 - 早期伯克希尔' },
    { slug: '1984', cat: 'shareholder-letter', label: '1984年股东信 - 格雷厄姆的教导' },
    { slug: '1987', cat: 'shareholder-letter', label: '1987年股东信 - 市场波动' },
    { slug: '2008', cat: 'shareholder-letter', label: '2008年股东信 - 金融危机' },
    { slug: 'moat', cat: 'concept', label: '护城河' },
    { slug: 'intrinsic-value', cat: 'concept', label: '内在价值' },
    { slug: 'margin-of-safety', cat: 'concept', label: '安全边际' },
    { slug: 'coca-cola', cat: 'company', label: '可口可乐案例' },
    { slug: 'charlie-munger', cat: 'person', label: '查理·芒格' }
  ];

  const snippets = [];
  for (const src of skillSources) {
    const doc = docs.find(d => d.slug === src.slug && d.category === src.cat);
    if (doc) {
      const lines = doc.content.split('\n').filter(l => l.trim() && !l.startsWith('#'));
      const text = lines.slice(0, 8).join(' ').substring(0, 300).trim();
      snippets.push('### ' + src.label + '\n' + text);
    }
  }
  return snippets.join('\n\n');
}

// ─── Build link graph ────────────────────────────────────────────
function buildLinkGraph(docs) {
  const nodes = [];
  const edges = [];
  const backlinks = {};

  const slugMap = {};
  for (const doc of docs) {
    slugMap[doc.slug] = doc;
    backlinks[doc.slug] = [];
  }

  for (const doc of docs) {
    const wikiLinks = doc.content.match(/\[\[([^\]]+)\]\]/g) || [];
    const linkedSlugs = new Set();

    for (const link of wikiLinks) {
      const target = link.replace(/\[\[|\]\]/g, '').toLowerCase().replace(/\s+/g, '-');
      if (slugMap[target] && target !== doc.slug) {
        linkedSlugs.add(target);
      }
    }

    if (doc.year && (doc.category === 'shareholder-letter' || doc.category === 'partnership-letter')) {
      const prevYear = String(doc.year - 1);
      const nextYear = String(doc.year + 1);
      if (slugMap[prevYear] && slugMap[prevYear].category === doc.category) {
        linkedSlugs.add(prevYear);
      }
      if (slugMap[nextYear] && slugMap[nextYear].category === doc.category) {
        linkedSlugs.add(nextYear);
      }
    }

    for (const target of linkedSlugs) {
      edges.push({ source: doc.slug, target });
      if (backlinks[target]) {
        backlinks[target].push(doc.slug);
      }
    }
  }

  for (const doc of docs) {
    const refCount = (backlinks[doc.slug] || []).length;
    nodes.push({
      id: doc.slug,
      title: doc.title.replace(/（.*?）/g, '').replace(/\(.*?\)/g, '').substring(0, 30),
      category: doc.category,
      year: doc.year,
      // SPA route (no .html)
      path: doc.route,
      refs: refCount
    });
  }

  return { nodes, edges, backlinks };
}

// ─── Build search index ──────────────────────────────────────────
function buildSearchIndex(docs) {
  return docs.map(doc => {
    const plainContent = doc.content
      .replace(/^#{1,6}\s+/gm, '')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/\*([^*]+)\*/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/\[\[([^\]]+)\]\]/g, '$1')
      .replace(/>\s*/gm, '')
      .replace(/---/g, '')
      .trim();

    const searchContent = plainContent.substring(0, 500);

    return {
      title: doc.title,
      slug: doc.slug,
      category: doc.category,
      year: doc.year,
      // SPA route (no .html)
      path: doc.route,
      content: searchContent
    };
  });
}

// ─── Compile Buffett Skill MD → JS constant ─────────────────────
async function buildBuffettSkill() {
  const skillPath = path.join(CONTENT_DIR, 'skills', 'buffett-skill.md');
  if (!fs.existsSync(skillPath)) {
    console.log('   ⚠ content/skills/buffett-skill.md not found, skipping');
    return;
  }
  const skillMd = await readFile(skillPath, 'utf8');
  // Strip front matter, keep only body
  const body = skillMd.replace(/^---[\s\S]*?---\n/, '').trim();

  const output = [
    '// Auto-compiled from content/skills/buffett-skill.md',
    '// DO NOT EDIT THIS FILE DIRECTLY - edit the MD file instead',
    'export const BUFFETT_SKILL_PROMPT = ' + JSON.stringify(body) + ';',
    ''
  ].join('\n');

  const outDir = path.join(__dirname, 'functions', 'api');
  fs.mkdirSync(outDir, { recursive: true });
  await writeFile(path.join(outDir, '_buffett-skill.js'), output, 'utf8');
  console.log('   ✓ Buffett Skill compiled → functions/api/_buffett-skill.js');
}

// ─── Build server-side search index for Pages Function RAG ──────
async function buildServerSearchIndex(docs) {
  const allChunks = [];

  for (const doc of docs) {
    // Strip markdown formatting for cleaner search text
    const plainText = [doc.title, doc.summary, doc.content]
      .filter(Boolean)
      .join('\n')
      .replace(/^#{1,6}\s+/gm, '')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/\*([^*]+)\*/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/\[\[([^\]]+)\]\]/g, '$1')
      .replace(/>\s*/gm, '')
      .replace(/---/g, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    // Chunk the text (~400 chars per chunk)
    const CHUNK_SIZE = 400;
    const MAX_CHUNKS = 20;  // 每篇最多20块（8000字），覆盖完整长文
    const chunks = [];
    for (let i = 0; i < plainText.length && chunks.length < MAX_CHUNKS; i += CHUNK_SIZE) {
      chunks.push(plainText.slice(i, i + CHUNK_SIZE));
    }

    for (let ci = 0; ci < chunks.length; ci++) {
      allChunks.push({
        id: doc.outputDir + '/' + doc.slug,
        title: doc.title,
        slug: doc.slug,
        category: doc.category,
        year: doc.year,
        chunkIndex: ci,
        content: chunks[ci]
      });
    }
  }

  const outPath = path.join(ASSETS_DIR, 'data', 'server-search-index.json');
  fs.mkdirSync(path.join(ASSETS_DIR, 'data'), { recursive: true });
  await writeFile(outPath, JSON.stringify(allChunks), 'utf8');
  console.log('   ✓ Server search index: ' + allChunks.length + ' chunks → site/assets/data/server-search-index.json');
  return allChunks.length;
}

// ─── Generate sitemap.xml ──────────────────────────────────────
function generateSitemap(docs) {
  const siteUrl = (process.env.SITE_URL || 'https://value.mycloudai.org').replace(/\/+$/, '');
  const now = new Date().toISOString().split('T')[0];

  // Static pages with priorities
  const staticPages = [
    { path: '/',                    changefreq: 'weekly',  priority: '1.0' },
    { path: '/shareholder-letters', changefreq: 'monthly', priority: '0.9' },
    { path: '/partnership-letters', changefreq: 'monthly', priority: '0.9' },
    { path: '/concepts',            changefreq: 'monthly', priority: '0.8' },
    { path: '/companies',           changefreq: 'monthly', priority: '0.8' },
    { path: '/people',              changefreq: 'monthly', priority: '0.7' },
    { path: '/quotes',              changefreq: 'monthly', priority: '0.7' },
    { path: '/graph',               changefreq: 'monthly', priority: '0.6' },
    { path: '/talk',                changefreq: 'monthly', priority: '0.6' },
  ];

  // Priority by category
  const categoryPriority = {
    'shareholder-letter': '0.8',
    'partnership-letter': '0.8',
    'special-letter':     '0.7',
    'concept':            '0.7',
    'company':            '0.6',
    'person':             '0.6',
  };

  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
  ];

  for (const page of staticPages) {
    lines.push('  <url>');
    lines.push('    <loc>' + siteUrl + page.path + '</loc>');
    lines.push('    <lastmod>' + now + '</lastmod>');
    lines.push('    <changefreq>' + page.changefreq + '</changefreq>');
    lines.push('    <priority>' + page.priority + '</priority>');
    lines.push('  </url>');
  }

  for (const doc of docs) {
    const priority = categoryPriority[doc.category] || '0.6';
    lines.push('  <url>');
    lines.push('    <loc>' + siteUrl + doc.route + '</loc>');
    lines.push('    <lastmod>' + now + '</lastmod>');
    lines.push('    <changefreq>yearly</changefreq>');
    lines.push('    <priority>' + priority + '</priority>');
    lines.push('  </url>');
  }

  lines.push('</urlset>');
  lines.push('');

  const xml = lines.join('\n');
  fs.writeFileSync(path.join(SITE_DIR, 'sitemap.xml'), xml, 'utf8');

  // robots.txt
  const robotsTxt = [
    'User-agent: *',
    'Allow: /',
    '',
    'Sitemap: ' + siteUrl + '/sitemap.xml',
    '',
  ].join('\n');
  fs.writeFileSync(path.join(SITE_DIR, 'robots.txt'), robotsTxt, 'utf8');

  return docs.length + staticPages.length;
}

// ─── Main Build ──────────────────────────────────────────────────
async function build() {
  console.log('🔨 MyCloudAI 价值投资 - SPA构建开始...\n');

  // 1. Read all content
  console.log('📖 读取内容文件...');
  const docs = readAllDocs();
  console.log('   找到 ' + docs.length + ' 个文档\n');

  // 2. Sync MD files to site/content/
  console.log('📂 同步MD文件到 site/content/...');
  const fileCount = syncContentFiles();
  console.log('   复制了 ' + fileCount + ' 个MD文件\n');

  // 3. Build link graph
  console.log('🔗 构建链接图...');
  const { nodes, edges, backlinks } = buildLinkGraph(docs);
  console.log('   ' + nodes.length + ' 节点, ' + edges.length + ' 条边\n');

  // 4. Build search index
  console.log('🔍 生成搜索索引...');
  const searchIndex = buildSearchIndex(docs);

  // 5. Extract Buffett knowledge
  console.log('🧠 提取巴菲特精华知识...');
  const buffettKnowledge = extractBuffettSkillKnowledge(docs);

  // 5b. Build server search index for RAG (async, writes file directly)
  console.log('🔍 生成服务端搜索索引（RAG）...');
  const serverChunkCount = await buildServerSearchIndex(docs);

  // 5c. Compile Buffett Skill MD → JS (async, writes to functions/api/_buffett-skill.js)
  console.log('🧠 编译巴菲特Skill...');
  await buildBuffettSkill();

  // 5d. Also generate buffett-skill.json for Agentic Loop (loaded via fetch at runtime)
  const skillJsonPath = path.join(CONTENT_DIR, 'skills', 'buffett-skill.md');
  if (fs.existsSync(skillJsonPath)) {
    const skillRaw = fs.readFileSync(skillJsonPath, 'utf-8');
    const { content: skillBody } = matter(skillRaw);
    fs.mkdirSync(path.join(ASSETS_DIR, 'data'), { recursive: true });
    fs.writeFileSync(
      path.join(ASSETS_DIR, 'data', 'buffett-skill.json'),
      JSON.stringify({ content: skillBody.trim() })
    );
    console.log('   ✓ Buffett Skill JSON → site/assets/data/buffett-skill.json');
  }

  // 6. Generate manifest
  console.log('📋 生成 manifest.json...');
  const manifest = generateManifest(docs);

  // 7. Ensure output directories
  console.log('📁 创建输出目录...');
  ensureDir(path.join(ASSETS_DIR, 'data'));
  ensureDir(path.join(ASSETS_DIR, 'js'));

  // 8. Write data files
  console.log('💾 写入数据文件...');
  
  // manifest.json → site/content/manifest.json
  fs.writeFileSync(
    path.join(SITE_CONTENT_DIR, 'manifest.json'),
    JSON.stringify(manifest, null, 2)
  );

  // search-index.json
  fs.writeFileSync(
    path.join(ASSETS_DIR, 'data', 'search-index.json'),
    JSON.stringify(searchIndex)
  );

  // server-search-index.json is already written by buildServerSearchIndex()

  // graph-data.json
  fs.writeFileSync(
    path.join(ASSETS_DIR, 'data', 'graph-data.json'),
    JSON.stringify({ nodes, edges })
  );

  // quotes-data.json - pre-extracted quotes for the quotes page
  const quotesData = generateQuotesData(manifest.quotesFiles, manifest.items);
  fs.writeFileSync(
    path.join(ASSETS_DIR, 'data', 'quotes-data.json'),
    JSON.stringify(quotesData)
  );

  // 10. Generate _redirects (SPA routing for Cloudflare Pages)
  // Note: /api/* routes are handled by Pages Functions, so we exclude them
  console.log('🔀 生成 _redirects...');
  fs.writeFileSync(path.join(SITE_DIR, '_redirects'), '/api/* /api/:splat 200\n/* /index.html 200\n');

  // 11. Generate _headers
  console.log('🔒 生成安全Headers...');
  const headers = '/*\n' +
    '  Cache-Control: no-store, no-cache, must-revalidate\n' +
    '  Pragma: no-cache\n' +
    '  X-Content-Type-Options: nosniff\n' +
    '  X-Frame-Options: DENY\n' +
    '  X-XSS-Protection: 1; mode=block\n' +
    '  Referrer-Policy: strict-origin-when-cross-origin\n' +
    '  Permissions-Policy: camera=(), microphone=(), geolocation=()\n\n' +
    '/assets/data/*\n' +
    '  Cache-Control: no-store\n\n' +
    '/content/*\n' +
    '  Cache-Control: no-store\n\n' +
    '/sitemap.xml\n' +
    '  Cache-Control: public, max-age=86400\n\n' +
    '/robots.txt\n' +
    '  Cache-Control: public, max-age=86400\n\n' +
    '/assets/*\n' +
    '  Cache-Control: public, max-age=31536000, immutable\n';
  fs.writeFileSync(path.join(SITE_DIR, '_headers'), headers);

  // 12. Clean up old generated HTML directories
  console.log('🧹 清理旧的HTML生成目录...');
  const dirsToClean = [
    'shareholder-letters', 'partnership-letters', 'special-letters',
    'concepts', 'companies', 'people', 'graph', 'talk'
  ];
  for (const dir of dirsToClean) {
    const dirPath = path.join(SITE_DIR, dir);
    if (fs.existsSync(dirPath)) {
      fs.rmSync(dirPath, { recursive: true, force: true });
      console.log('   删除 site/' + dir + '/');
    }
  }

  // Also remove old nav-data.json (replaced by manifest.json)
  const oldNavData = path.join(ASSETS_DIR, 'data', 'nav-data.json');
  if (fs.existsSync(oldNavData)) {
    fs.unlinkSync(oldNavData);
    console.log('   删除旧的 nav-data.json');
  }

  // 13. Generate sitemap.xml + robots.txt
  console.log('🗺️  生成 sitemap.xml + robots.txt...');
  const sitemapCount = generateSitemap(docs);
  console.log('   ✓ sitemap.xml: ' + sitemapCount + ' 条URL → site/sitemap.xml');
  console.log('   ✓ robots.txt → site/robots.txt');

  // 14. Copy root docs (CHANGELOG.md, HELP.md) to site/content/
  console.log('📄 复制文档到 site/content/...');
  const rootDocs = [
    { src: 'CHANGELOG.md', dest: 'changelog.md' },
    { src: 'HELP.md',      dest: 'help.md'      },
  ];
  for (const { src, dest } of rootDocs) {
    const srcPath = path.join(__dirname, src);
    const destPath = path.join(SITE_CONTENT_DIR, dest);
    if (fs.existsSync(srcPath)) {
      fs.copyFileSync(srcPath, destPath);
      console.log('   复制 ' + src + ' → site/content/' + dest);
    }
  }

  console.log('\n✅ SPA构建完成！');
  console.log('   📂 MD文件: ' + fileCount + ' 个（复制到 site/content/）');
  console.log('   📋 manifest.json: ' + manifest.items.length + ' 条目');
  console.log('   🔍 搜索索引: ' + searchIndex.length + ' 条目');
  console.log('   🔍 服务端RAG索引: ' + serverChunkCount + ' 块');
  console.log('   🧠 Skill: 已编译 → functions/api/_buffett-skill.js');
  console.log('   🔗 图谱: ' + nodes.length + ' 节点, ' + edges.length + ' 边');
  console.log('   📊 统计: ' + manifest.stats.letters + ' 信件, ' +
    manifest.stats.concepts + ' 概念, ' +
    manifest.stats.companies + ' 公司, ' +
    manifest.stats.people + ' 人物');
  console.log('\n   输出目录: ' + SITE_DIR);
  console.log('   注意: site/index.html 是唯一的HTML文件（SPA shell）');
}

build();
