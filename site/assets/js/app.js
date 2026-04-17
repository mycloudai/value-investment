/* ═══════════════════════════════════════════════════
   app.js - SPA Core: Router + Renderers
   ═══════════════════════════════════════════════════ */
(function () {
  'use strict';

  // ─── Category Config ──────────────────────────────
  var CATEGORY_MAP = {
    'shareholder-letter': { dir: 'shareholder-letters', label: '伯克希尔股东信', icon: '📄' },
    'partnership-letter': { dir: 'partnership-letters', label: '合伙基金信件', icon: '📋' },
    'special-letter':     { dir: 'special-letters',     label: '特别信件',       icon: '📌' },
    'concept':            { dir: 'concepts',             label: '投资理念',       icon: '💡' },
    'company':            { dir: 'companies',            label: '公司解析',       icon: '🏢' },
    'person':             { dir: 'people',               label: '关键人物',       icon: '👤' }
  };

  var DIR_TO_CATEGORY = {
    'shareholder-letters': 'shareholder-letter',
    'partnership-letters': 'partnership-letter',
    'special-letters': 'special-letter',
    'concepts': 'concept',
    'companies': 'company',
    'people': 'person'
  };

  var DECADE_LABELS = {
    '1950': '1950年代 · 合伙基金创始',
    '1960': '1960年代 · 合伙基金辉煌与伯克希尔早期',
    '1970': '1970年代 · 伯克希尔转型期',
    '1980': '1980年代 · 保险帝国奠基',
    '1990': '1990年代 · 黄金投资期',
    '2000': '2000年代 · 互联网泡沫与金融危机',
    '2010': '2010年代 · 巨型并购时代',
    '2020': '2020年代 · 新纪元'
  };

  // ─── State ────────────────────────────────────────
  var _d3Loaded = false;
  var _graphInitialized = false;
  var _talkInitialized = false;

  // Capture initial URL params before router overwrites
  var _initialSearch = window.location.search || '';
  var _initialHash = window.location.hash || '';

  // ─── Router ───────────────────────────────────────
  var Router = {
    routes: [
      { pattern: /^\/$/, handler: renderHomepage },
      { pattern: /^\/graph\/?$/, handler: renderGraph },
      { pattern: /^\/talk\/?$/, handler: renderTalk },
      { pattern: /^\/quotes\/?$/, handler: renderQuotes },
      { pattern: /^\/changelog\/?$/, handler: renderChangelog },
      { pattern: /^\/guide\/(shareholder-letters|partnership-letters|special-letters|concepts|companies|people)\/?$/, handler: renderGuide },
      { pattern: /^\/(shareholder-letters|partnership-letters|special-letters|concepts|companies|people)\/([^/]+?)\/?$/, handler: renderContent },
      { pattern: /^\/(shareholder-letters|partnership-letters|special-letters|concepts|companies|people)\/?$/, handler: renderIndex },
      { pattern: /.*/, handler: render404 }
    ],

    navigate: function (path) {
      // Separate query string and hash from path
      var queryIdx = path.indexOf('?');
      var hashIdx = path.indexOf('#');
      var pathname = path;
      var search = '';
      var hash = '';

      if (queryIdx !== -1) {
        pathname = path.substring(0, queryIdx);
        var rest = path.substring(queryIdx);
        var restHashIdx = rest.indexOf('#');
        if (restHashIdx !== -1) {
          search = rest.substring(0, restHashIdx);
          hash = rest.substring(restHashIdx);
        } else {
          search = rest;
        }
      } else if (hashIdx !== -1) {
        pathname = path.substring(0, hashIdx);
        hash = path.substring(hashIdx);
      }

      // Normalize: remove trailing slash except for root
      if (pathname !== '/' && pathname.endsWith('/')) pathname = pathname.replace(/\/+$/, '');

      // Update URL state with full path including search and hash
      var fullUrl = pathname + search + hash;
      window.history.pushState({}, '', fullUrl);

      // Store search/hash for applyHighlightFromURL
      _initialSearch = search;
      _initialHash = hash;

      this.render(pathname);
    },

    render: function (path) {
      // Normalize
      if (path !== '/' && path.endsWith('/')) path = path.replace(/\/+$/, '');

      var content = document.getElementById('app-content');
      if (!content) return;

      // Remove special page classes from main
      var mainEl = document.getElementById('main');
      if (mainEl) {
        mainEl.classList.remove('graph-page', 'talk-page');
      }

      for (var i = 0; i < this.routes.length; i++) {
        var route = this.routes[i];
        var match = path.match(route.pattern);
        if (match) {
          route.handler(match);
          // Update active nav item
          if (typeof window.updateActiveNavItem === 'function') {
            window.updateActiveNavItem(path);
          }
          return;
        }
      }
    }
  };

  // Expose Router globally
  window.Router = Router;
  window.router = Router;

  // ─── Front Matter Parser ──────────────────────────
  function parseFrontMatter(raw) {
    var match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    if (!match) return { frontMatter: {}, body: raw };

    var frontMatter = {};
    var lines = match[1].split('\n');
    var currentArrayKey = null;

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];

      // YAML array item: starts with optional spaces then "- "
      if (/^\s+-\s/.test(line)) {
        if (currentArrayKey) {
          var itemVal = line.replace(/^\s+-\s+/, '').trim().replace(/^"|"$/g, '');
          if (!Array.isArray(frontMatter[currentArrayKey])) {
            frontMatter[currentArrayKey] = [];
          }
          frontMatter[currentArrayKey].push(itemVal);
        }
        continue;
      }

      // Key: value line
      currentArrayKey = null;
      var colonIdx = line.indexOf(':');
      if (colonIdx === -1) continue;
      var key = line.substring(0, colonIdx).trim();
      var val = line.substring(colonIdx + 1).trim();
      if (!key) continue;

      if (val === '') {
        // Empty value = start of array block
        currentArrayKey = key;
        frontMatter[key] = [];
      } else {
        frontMatter[key] = val.replace(/^"|"$/g, '');
      }
    }

    return { frontMatter: frontMatter, body: match[2] };
  }

  // ─── Get Category Label ───────────────────────────
  function getCategoryLabel(category) {
    var info = CATEGORY_MAP[category];
    return info ? (info.icon + ' ' + info.label) : category;
  }

  // ─── Get Siblings (prev/next) ─────────────────────
  function getSiblings(dirName, slug) {
    var manifest = window.manifest;
    if (!manifest) return null;

    var category = DIR_TO_CATEGORY[dirName];
    if (!category) return null;

    var catInfo = CATEGORY_MAP[category];
    if (!catInfo) return null;

    // Find the nav key
    var navKey = catInfo.dir.replace(/-([a-z])/g, function (_, c) { return c.toUpperCase(); });
    var items = manifest.nav[navKey];
    if (!items || items.length === 0) return null;

    var idx = -1;
    for (var i = 0; i < items.length; i++) {
      if (items[i].slug === slug) { idx = i; break; }
    }
    if (idx === -1) return null;

    return {
      prev: idx > 0 ? { title: items[idx - 1].title.substring(0, 30), route: items[idx - 1].route } : null,
      next: idx < items.length - 1 ? { title: items[idx + 1].title.substring(0, 30), route: items[idx + 1].route } : null
    };
  }

  // ─── Get Backlinks ────────────────────────────────
  function getBacklinks(slug) {
    // Use graph-data to find who links to this slug
    var graphData = window._graphData;
    if (!graphData) return [];

    var sourceIds = [];
    for (var i = 0; i < graphData.edges.length; i++) {
      var edge = graphData.edges[i];
      if (edge.target === slug && edge.source !== slug) {
        sourceIds.push(edge.source);
      }
    }

    // Resolve slugs to manifest items
    var manifest = window.manifest;
    if (!manifest || sourceIds.length === 0) return [];

    var results = [];
    for (var j = 0; j < sourceIds.length; j++) {
      for (var k = 0; k < manifest.items.length; k++) {
        if (manifest.items[k].slug === sourceIds[j]) {
          results.push({ title: manifest.items[k].title, route: manifest.items[k].route });
          break;
        }
      }
    }
    return results;
  }

  // ─── Build Cross-Reference Panel ─────────────────
  // Resolves a list of slugs to manifest items, returns [{title, route}]
  function resolveSlugs(slugs) {
    var manifest = window.manifest;
    if (!manifest || !slugs || !slugs.length) return [];
    var results = [];
    for (var i = 0; i < slugs.length; i++) {
      var s = slugs[i];
      // Support both bare slug ("acquisitions") and path slug ("concepts/acquisitions").
      // When the category prefix is present, match by full route so duplicate year-based
      // slugs like 1965/1966 don't resolve to the wrong letter category.
      var bare = s.indexOf('/') !== -1 ? s.split('/').pop() : s;
      var targetRoute = s.indexOf('/') !== -1 ? '/' + s.replace(/^\/+/, '') : '';
      for (var k = 0; k < manifest.items.length; k++) {
        var item = manifest.items[k];
        var routeMatches = targetRoute && item.route === targetRoute;
        var slugMatches = !targetRoute && item.slug === bare;
        if (routeMatches || slugMatches) {
          results.push({ title: item.title, route: item.route, slug: item.slug });
          break;
        }
      }
    }
    return results;
  }

  // Renders chips that open directly in new tab (letter pages → concept/company/people)
  function renderDirectChips(items) {
    var html = '';
    for (var i = 0; i < items.length; i++) {
      html += '<a href="' + items[i].route + '" target="_blank" rel="noopener" class="xref-chip xref-chip-direct">' + items[i].title + '</a>';
    }
    return html;
  }

  // Extract short keyword from title: "护城河（Economic Moat）" → "护城河"
  function extractKeyword(title) {
    var m = title.match(/^([^（(]+)/);
    return m ? m[1].trim() : title;
  }

  // Escape HTML attribute values
  function escapeAttr(str) {
    return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // Renders letter list items for entity pages (concept/company/person → letters)
  function renderLetterList(items, keyword) {
    var html = '<ul class="xref-letter-list">';
    for (var i = 0; i < items.length; i++) {
      html += '<li><a href="javascript:void(0)" class="xref-letter-item"' +
        ' data-letter-slug="' + escapeAttr(items[i].slug) + '"' +
        ' data-letter-route="' + escapeAttr(items[i].route) + '"' +
        ' data-letter-title="' + escapeAttr(items[i].title) + '"' +
        ' data-keyword="' + escapeAttr(keyword) + '">' +
        items[i].title + '</a></li>';
    }
    html += '</ul>';
    return html;
  }

  // Build the full cross-reference panel HTML based on front matter
  function buildCrossRefPanel(fm, category) {
    var isLetter = (category === 'shareholder-letter' || category === 'partnership-letter' || category === 'special-letter');
    var isEntity = (category === 'concept' || category === 'company' || category === 'person');

    var sections = [];

    if (isLetter) {
      // Letters → show concepts / companies / people chips
      var groups = [
        { key: 'concepts_discussed',  icon: '💡', label: '涉及概念' },
        { key: 'companies_mentioned', icon: '🏢', label: '提到公司' },
        { key: 'people_mentioned',    icon: '👤', label: '相关人物' }
      ];
      for (var g = 0; g < groups.length; g++) {
        var grp = groups[g];
        var raw = fm[grp.key];
        var slugs = Array.isArray(raw) ? raw : (raw ? [raw] : []);
        if (!slugs.length) continue;
        var items = resolveSlugs(slugs);
        if (!items.length) continue;
        sections.push(
          '<div class="xref-group">' +
          '<span class="xref-group-label">' + grp.icon + ' ' + grp.label + '</span>' +
          '<div class="xref-chips">' + renderDirectChips(items) + '</div>' +
          '</div>'
        );
      }
    }

    if (isEntity) {
      // Concepts/companies/people → show which letters mention them (as a list for scoped search)
      var keyword = extractKeyword(fm.title || '');
      var raw = fm['mentioned_in_letters'];
      var slugs = Array.isArray(raw) ? raw : (raw ? [raw] : []);
      if (slugs.length) {
        // Group by category prefix
        var letterGroups = { 'shareholder-letters': [], 'partnership-letters': [], 'special-letters': [] };
        for (var i = 0; i < slugs.length; i++) {
          var parts = slugs[i].split('/');
          var dir = parts[0], lSlug = parts[1] || parts[0];
          // Store the full "dir/slug" path so resolveSlugs can use targetRoute
          // matching and never confuse same-year slugs across letter categories
          // (e.g. partnership-letters/1966 vs shareholder-letters/1966).
          if (letterGroups[dir]) letterGroups[dir].push(dir + '/' + lSlug);
        }
        var groupDefs = [
          { dir: 'shareholder-letters', icon: '📄', label: '伯克希尔股东信' },
          { dir: 'partnership-letters', icon: '📋', label: '巴菲特合伙基金信' },
          { dir: 'special-letters',     icon: '📌', label: '特别信件' }
        ];
        for (var d = 0; d < groupDefs.length; d++) {
          var def = groupDefs[d];
          var lSlugs = letterGroups[def.dir];
          if (!lSlugs || !lSlugs.length) continue;
          var items = resolveSlugs(lSlugs);
          if (!items.length) continue;
          // Sort by year ascending (slug is usually the year)
          items.sort(function(a, b) { return a.slug < b.slug ? -1 : 1; });
          sections.push(
            '<div class="xref-group">' +
            '<span class="xref-group-label">' + def.icon + ' ' + def.label + '（' + items.length + ' 篇）</span>' +
            renderLetterList(items, keyword) +
            '</div>'
          );
        }
      }
    }

    if (!sections.length) return '';

    return '<div class="xref-panel">' +
      '<h3 class="xref-panel-title">🔗 关联内容</h3>' +
      sections.join('') +
      '</div>';
  }

  // ─── Generate TOC from Markdown ───────────────────
  function generateTOC(htmlContent) {
    var headings = [];
    var regex = /<h([1-3])\s+id="([^"]+)"[^>]*>(.*?)<\/h[1-3]>/gi;
    var m;
    while ((m = regex.exec(htmlContent)) !== null) {
      headings.push({ level: parseInt(m[1]), id: m[2], text: m[3].replace(/<[^>]+>/g, '') });
    }
    // Skip first heading (page title), need at least 2 more
    var tocHeadings = headings.slice(1);
    if (tocHeadings.length < 2) return '';

    var html = '<div class="toc-title">目录</div><ul>';
    for (var i = 0; i < tocHeadings.length; i++) {
      html += '<li class="toc-h' + tocHeadings[i].level + '"><a href="#' + tocHeadings[i].id + '">' + tocHeadings[i].text + '</a></li>';
    }
    html += '</ul>';
    return html;
  }

  // ─── Configure marked renderer ────────────────────
  var headingCounter = 0;

  function getConfiguredMarked() {
    if (typeof marked === 'undefined') return null;
    var renderer = new marked.Renderer();
    renderer.heading = function (token) {
      var text, depth;
      if (typeof token === 'object' && token !== null) {
        text = token.text || '';
        depth = token.depth || 1;
      } else {
        text = arguments[0];
        depth = arguments[1];
      }
      var id = 'heading-' + (headingCounter++);
      return '<h' + depth + ' id="' + id + '">' + text + '</h' + depth + '>\n';
    };
    marked.setOptions({ renderer: renderer, breaks: false, gfm: true });
    return marked;
  }

  // ─── Scroll to top ────────────────────────────────
  function scrollToTop() {
    var mainEl = document.getElementById('main');
    if (mainEl) mainEl.scrollTop = 0;
    window.scrollTo(0, 0);
  }

  // ─── Init TOC scroll spy ──────────────────────────
  // Note: click handling is done via event delegation in the global click handler above.
  // This function is kept as a no-op for future scroll-spy / active-link highlighting.
  function initTOC() {
    // TOC click events are handled by the global delegated handler (.toc a).
    // No per-element binding needed here — avoids conflict with SPA router interception.
  }

  // ─── Close mobile sidebar ─────────────────────────
  function closeMobileSidebar() {
    var sidebar = document.getElementById('sidebar');
    if (sidebar) sidebar.classList.remove('open');
  }

  // ─── RENDER: Content Page ─────────────────────────
  function renderContent(match) {
    var dirName = match[1];
    var slug = match[2];
    // Remove .html extension if present (backward compat)
    slug = slug.replace(/\.html$/, '');
    var mdPath = '/content/' + dirName + '/' + slug + '.md';
    var content = document.getElementById('app-content');

    // Enable flex row layout for article + right-panel
    content.className = 'content-layout';

    content.innerHTML = '<div style="display:flex;justify-content:center;align-items:center;min-height:40vh;color:var(--text-muted,#888)">载入中...</div>';

    fetch(mdPath).then(function (res) {
      if (!res.ok) { render404(); return; }
      return res.text();
    }).then(function (raw) {
      if (!raw) return;
      headingCounter = 0;
      var parsed = parseFrontMatter(raw);
      var fm = parsed.frontMatter;
      var body = parsed.body;
      var category = fm.category || DIR_TO_CATEGORY[dirName] || 'concept';

      var m = getConfiguredMarked();
      if (!m) { content.innerHTML = '<p>Markdown渲染库未加载</p>'; return; }

      var htmlBody = m.parse(body);

      // Replace [[wiki-links]] with SPA links
      var manifest = window.manifest;
      if (manifest) {
        htmlBody = htmlBody.replace(/\[\[([^\]]+)\]\]/g, function (match, linkText) {
          var targetSlug = linkText.toLowerCase().replace(/\s+/g, '-');
          for (var i = 0; i < manifest.items.length; i++) {
            if (manifest.items[i].slug === targetSlug) {
              return '<a href="' + manifest.items[i].route + '" data-route="' + manifest.items[i].route + '" class="wiki-link">' + linkText + '</a>';
            }
          }
          return linkText;
        });
      }

      // Inject chunk anchors (chunk-0, chunk-1, ...) on top-level block elements
      // Headings already have id="heading-N", so add data-chunk instead via a span
      var chunkCounter = 0;
      htmlBody = htmlBody.replace(/<(p|blockquote|ul|ol|table|pre)(\s|>)/g, function(m, tag, after) {
        return '<' + tag + ' id="chunk-' + (chunkCounter++) + '"' + after;
      });

      var toc = generateTOC(htmlBody);
      var siblings = getSiblings(dirName, slug);
      var xref = buildCrossRefPanel(fm, category);

      var navHTML = '';
      if (siblings) {
        navHTML = '<div class="content-nav">';
        navHTML += siblings.prev
          ? '<a href="' + siblings.prev.route + '" data-route="' + siblings.prev.route + '" class="nav-prev">← ' + siblings.prev.title + '</a>'
          : '<span></span>';
        navHTML += siblings.next
          ? '<a href="' + siblings.next.route + '" data-route="' + siblings.next.route + '" class="nav-next">' + siblings.next.title + ' →</a>'
          : '<span></span>';
        navHTML += '</div>';
      }

      // Right panel: TOC on top, cross-ref links below — both sticky, no scroll
      var rightPanelInner = '';
      if (toc) rightPanelInner += '<div class="toc">' + toc + '</div>';
      if (xref) rightPanelInner += xref;
      var rightPanel = '<aside class="right-panel">' + rightPanelInner + '</aside>';

      content.innerHTML =
        '<article class="article">' +
        '  <div class="article-meta">' +
        '    <span class="category-badge">' + getCategoryLabel(category) + '</span>' +
        (fm.year ? '    <span class="year-badge">' + fm.year + '</span>' : '') +
        '  </div>' +
        (fm.title ? '  <h1 class="article-title">' + fm.title + '</h1>' : '') +
        '  <div class="article-body">' + htmlBody + '</div>' +
        '  <div id="article-quotes-section"></div>' +
        navHTML +
        '</article>' +
        rightPanel;

      // Set page title
      document.title = (fm.title || slug) + ' | MyCloudAI - 价值投资';

      // Load related quotes if {slug}-quotes.md exists
      loadArticleQuotes(dirName, slug);

      scrollToTop();
      initTOC();
      closeMobileSidebar();

      // ── Highlight from URL params ──
      applyHighlightFromURL();
    }).catch(function () {
      render404();
    });
  }

  // ─── Load article-related quotes ──────────────────
  function loadArticleQuotes(dirName, slug) {
    var quotesPath = '/content/' + dirName + '/' + slug + '-quotes.md';
    fetch(quotesPath).then(function (res) {
      if (!res.ok) return null;
      return res.text();
    }).then(function (raw) {
      if (!raw) return;
      var quotes = extractQuotesFromMd(raw);
      if (quotes.length === 0) return;
      var section = document.getElementById('article-quotes-section');
      if (!section) return;
      var html = '<div class="article-quotes">' +
        '<h2 class="article-quotes-title">📝 相关金句</h2>';
      for (var i = 0; i < quotes.length; i++) {
        html += '<blockquote class="quote-block"><p>' + quotes[i] + '</p></blockquote>';
      }
      html += '</div>';
      section.innerHTML = html;
    }).catch(function () {});
  }

  // ─── RENDER: Category Index ───────────────────────
  function renderIndex(match) {
    var dirName = match[1];
    var category = DIR_TO_CATEGORY[dirName];
    var catInfo = CATEGORY_MAP[category];
    if (!catInfo) { render404(); return; }

    var manifest = window.manifest;
    if (!manifest) { render404(); return; }

    var navKey = catInfo.dir.replace(/-([a-z])/g, function (_, c) { return c.toUpperCase(); });
    var items = manifest.nav[navKey] || [];

    var content = document.getElementById('app-content');
    content.className = '';

    // Dispatch to category-specific renderer
    if (category === 'shareholder-letter' || category === 'partnership-letter') {
      content.innerHTML = renderLetterIndex(items, catInfo);
    } else if (category === 'special-letter') {
      content.innerHTML = renderSpecialLetterIndex(items, catInfo);
    } else if (category === 'concept') {
      content.innerHTML = renderConceptIndex(items, catInfo);
    } else if (category === 'company') {
      content.innerHTML = renderCompanyIndex(items, catInfo);
    } else if (category === 'person') {
      content.innerHTML = renderPersonIndex(items, catInfo);
    } else {
      content.innerHTML = renderFallbackIndex(items, catInfo);
    }

    document.title = catInfo.label + ' | MyCloudAI - 价值投资';
    scrollToTop();
    closeMobileSidebar();
  }

  // ─── INDEX: Letters (Shareholder & Partnership) ────
  function renderLetterIndex(items, catInfo) {
    // Compute year range stats
    var years = items.filter(function(i) { return i.year; }).map(function(i) { return i.year; });
    var minYear = years.length ? Math.min.apply(null, years) : '';
    var maxYear = years.length ? Math.max.apply(null, years) : '';
    var yearSpan = (minYear && maxYear) ? (maxYear - minYear + 1) : 0;

    // Group by decade
    var decades = {};
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      var decade = item.year ? Math.floor(item.year / 10) * 10 : 0;
      if (!decades[decade]) decades[decade] = [];
      decades[decade].push(item);
    }
    var decadeKeys = Object.keys(decades).sort(function(a, b) { return a - b; });

    var statsHTML =
      '<div class="idx-stats">' +
      '  <div class="idx-stat"><span class="idx-stat-num">' + items.length + '</span><span class="idx-stat-label">封信件</span></div>' +
      (yearSpan ? '<div class="idx-stat"><span class="idx-stat-num">' + yearSpan + '</span><span class="idx-stat-label">年跨度</span></div>' : '') +
      (minYear ? '<div class="idx-stat"><span class="idx-stat-num">' + minYear + '–' + maxYear + '</span><span class="idx-stat-label">年份范围</span></div>' : '') +
      '</div>';

    var decadesHTML = '';
    for (var d = 0; d < decadeKeys.length; d++) {
      var dk = decadeKeys[d];
      var dLabel = DECADE_LABELS[dk] || (dk + '年代');
      var dItems = decades[dk];
      var cardsHTML = '';
      for (var j = 0; j < dItems.length; j++) {
        var it = dItems[j];
        var shortTitle = it.title.replace(/（.*?）/g, '').replace(/\(.*?\)/g, '').trim();
        cardsHTML +=
          '<a href="' + it.route + '" data-route="' + it.route + '" class="letter-card">' +
          '  <span class="letter-card-year">' + (it.year || '') + '</span>' +
          '  <span class="letter-card-title">' + shortTitle + '</span>' +
          '</a>';
      }
      decadesHTML +=
        '<div class="decade-section">' +
        '  <h3 class="decade-label">' + dLabel + '</h3>' +
        '  <div class="letter-card-grid">' + cardsHTML + '</div>' +
        '</div>';
    }

    return (
      '<div class="category-index">' +
      '  <div class="idx-header">' +
      '    <h1>' + catInfo.icon + ' ' + catInfo.label + '</h1>' +
      '    <p class="idx-subtitle">巴菲特' + (catInfo.dir.includes('shareholder') ? '致伯克希尔股东' : '致合伙人') + '的信件全集</p>' +
      '  </div>' +
      statsHTML +
      '<div class="decade-timeline">' + decadesHTML + '</div>' +
      '</div>'
    );
  }

  // ─── INDEX: Special Letters ───────────────────────
  function renderSpecialLetterIndex(items, catInfo) {
    var cardsHTML = '';
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      var shortTitle = item.title.replace(/（.*?）/g, '').replace(/\(.*?\)/g, '').trim();
      var desc = item.description || '';
      cardsHTML +=
        '<a href="' + item.route + '" data-route="' + item.route + '" class="special-card">' +
        '  <div class="special-card-icon">📌</div>' +
        '  <div class="special-card-body">' +
        '    <div class="special-card-title">' + shortTitle + '</div>' +
        (desc ? '    <div class="special-card-desc">' + desc + '</div>' : '') +
        '  </div>' +
        '  <span class="special-card-arrow">→</span>' +
        '</a>';
    }
    return (
      '<div class="category-index">' +
      '  <div class="idx-header">' +
      '    <h1>' + catInfo.icon + ' ' + catInfo.label + '</h1>' +
      '    <p class="idx-subtitle">共 ' + items.length + ' 封特别信件</p>' +
      '  </div>' +
      '  <div class="special-card-list">' + cardsHTML + '</div>' +
      '</div>'
    );
  }

  // ─── INDEX: Concepts ──────────────────────────────
  function renderConceptIndex(items, catInfo) {
    // Tag cloud from all tags across concepts
    var tagCount = {};
    for (var i = 0; i < items.length; i++) {
      var tags = items[i].tags || [];
      for (var t = 0; t < tags.length; t++) {
        tagCount[tags[t]] = (tagCount[tags[t]] || 0) + 1;
      }
    }
    var tagEntries = Object.keys(tagCount).sort(function(a, b) { return tagCount[b] - tagCount[a]; }).slice(0, 20);
    var tagCloudHTML = '';
    for (var k = 0; k < tagEntries.length; k++) {
      var tag = tagEntries[k];
      var weight = Math.min(3, Math.ceil(tagCount[tag] / 3));
      tagCloudHTML += '<span class="tag-cloud-item tag-w' + weight + '">' + tag + '</span>';
    }

    // Core concepts first
    var coreItems = items.filter(function(i) { return i.importance === 'core'; });
    var otherItems = items.filter(function(i) { return i.importance !== 'core'; });
    var sortedItems = coreItems.concat(otherItems);

    var cardsHTML = '';
    for (var j = 0; j < sortedItems.length; j++) {
      var item = sortedItems[j];
      var shortTitle = item.title.replace(/（.*?）/g, '').replace(/\(.*?\)/g, '').trim();
      var desc = item.description || '';
      var letterCount = item.letter_count || 0;
      var isCore = item.importance === 'core';
      cardsHTML +=
        '<a href="' + item.route + '" data-route="' + item.route + '" class="concept-card' + (isCore ? ' concept-card-core' : '') + '">' +
        '  <div class="concept-card-head">' +
        '    <span class="concept-card-title">' + shortTitle + '</span>' +
        (isCore ? '    <span class="concept-badge">核心</span>' : '') +
        '  </div>' +
        (desc ? '  <p class="concept-card-desc">' + desc + '</p>' : '') +
        (letterCount ? '  <span class="concept-card-letters">出现于 ' + letterCount + ' 封信件</span>' : '') +
        '</a>';
    }

    return (
      '<div class="category-index">' +
      '  <div class="idx-header">' +
      '    <h1>' + catInfo.icon + ' ' + catInfo.label + '</h1>' +
      '    <p class="idx-subtitle">共 ' + items.length + ' 个投资理念，源自巴菲特数十年实践</p>' +
      '  </div>' +
      '  <div class="tag-cloud">' + tagCloudHTML + '</div>' +
      '  <div class="concept-card-grid">' + cardsHTML + '</div>' +
      '</div>'
    );
  }

  // ─── INDEX: Companies ─────────────────────────────
  function renderCompanyIndex(items, catInfo) {
    // Gather all tags for filter
    var allTags = {};
    for (var i = 0; i < items.length; i++) {
      var tags = items[i].tags || [];
      for (var t = 0; t < tags.length; t++) {
        allTags[tags[t]] = (allTags[tags[t]] || 0) + 1;
      }
    }
    var topTags = Object.keys(allTags).sort(function(a, b) { return allTags[b] - allTags[a]; }).slice(0, 8);

    var cardsHTML = '';
    for (var j = 0; j < items.length; j++) {
      var item = items[j];
      var shortTitle = item.title.replace(/（.*?）/g, '').replace(/\(.*?\)/g, '').trim();
      var tags = item.tags || [];
      var tagsHTML = '';
      for (var k = 0; k < Math.min(tags.length, 3); k++) {
        tagsHTML += '<span class="company-tag">' + tags[k] + '</span>';
      }
      var externalHTML = '';
      if (item.wikipedia) {
        externalHTML += '<a href="' + item.wikipedia + '" class="company-ext-link" target="_blank" rel="noopener" onclick="event.stopPropagation()">Wiki ↗</a>';
      }
      var rel = item.relationship || '';
      cardsHTML +=
        '<a href="' + item.route + '" data-route="' + item.route + '" class="company-card">' +
        '  <div class="company-card-head">' +
        '    <span class="company-card-name">' + shortTitle + '</span>' +
        (rel ? '    <span class="company-rel-badge">' + rel + '</span>' : '') +
        '  </div>' +
        (tagsHTML ? '  <div class="company-tags">' + tagsHTML + '</div>' : '') +
        (externalHTML ? '  <div class="company-card-footer">' + externalHTML + '</div>' : '') +
        '</a>';
    }

    return (
      '<div class="category-index">' +
      '  <div class="idx-header">' +
      '    <h1>' + catInfo.icon + ' ' + catInfo.label + '</h1>' +
      '    <p class="idx-subtitle">共 ' + items.length + ' 家公司，巴菲特的投资宇宙</p>' +
      '  </div>' +
      '  <div class="company-card-grid">' + cardsHTML + '</div>' +
      '</div>'
    );
  }

  // ─── INDEX: People ────────────────────────────────
  function renderPersonIndex(items, catInfo) {
    var cardsHTML = '';
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      var shortTitle = item.title.replace(/（.*?）/g, '').replace(/\(.*?\)/g, '').trim();
      var desc = item.description || '';
      var role = item.role || '';
      var tags = item.tags || [];
      var tagsHTML = '';
      for (var k = 0; k < Math.min(tags.length, 3); k++) {
        tagsHTML += '<span class="person-tag">' + tags[k] + '</span>';
      }
      cardsHTML +=
        '<a href="' + item.route + '" data-route="' + item.route + '" class="person-card">' +
        '  <div class="person-avatar">' + shortTitle.charAt(0) + '</div>' +
        '  <div class="person-card-body">' +
        '    <div class="person-card-name">' + shortTitle + '</div>' +
        (role ? '    <div class="person-card-role">' + role + '</div>' : '') +
        (desc ? '    <p class="person-card-desc">' + desc + '</p>' : '') +
        (tagsHTML ? '    <div class="person-tags">' + tagsHTML + '</div>' : '') +
        '  </div>' +
        '</a>';
    }
    return (
      '<div class="category-index">' +
      '  <div class="idx-header">' +
      '    <h1>' + catInfo.icon + ' ' + catInfo.label + '</h1>' +
      '    <p class="idx-subtitle">共 ' + items.length + ' 位影响巴菲特投资生涯的关键人物</p>' +
      '  </div>' +
      '  <div class="person-card-list">' + cardsHTML + '</div>' +
      '</div>'
    );
  }

  // ─── INDEX: Fallback ──────────────────────────────
  function renderFallbackIndex(items, catInfo) {
    var listHTML = '';
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      var shortTitle = item.title.replace(/（.*?）/g, '').replace(/\(.*?\)/g, '').trim();
      listHTML += '<a href="' + item.route + '" data-route="' + item.route + '" class="list-item">' +
        '<span class="list-year">' + (item.year || '') + '</span>' +
        '<span class="list-title">' + shortTitle + '</span>' +
        '</a>';
    }
    return (
      '<div class="category-index">' +
      '  <h1>' + catInfo.icon + ' ' + catInfo.label + '</h1>' +
      '  <p class="category-count">共 ' + items.length + ' 篇</p>' +
      '  <div class="list-grid">' + listHTML + '</div>' +
      '</div>'
    );
  }

  // ─── RENDER: Homepage ─────────────────────────────
  function renderHomepage() {
    var manifest = window.manifest;
    if (!manifest) {
      document.getElementById('app-content').innerHTML = '<p>加载中...</p>';
      return;
    }

    var content = document.getElementById('app-content');
    content.className = 'homepage-layout';  // enable homepage centering

    var stats = manifest.stats;

    // ── Hero section with gradient background, title, subtitle, stats, CTAs ──
    var heroHTML =
      '<section class="hero-section">' +
      '  <div class="hero-inner">' +
      '    <p class="hero-eyebrow">Warren Buffett · Letters & Wisdom</p>' +
      '    <h1 class="hero-title">与巴菲特同行<br>读懂价值投资</h1>' +
      '    <p class="hero-subtitle">70年投资智慧，' + stats.letters + '封亲笔信件，系统性解读巴菲特的投资哲学与商业洞察</p>' +
      '    <div class="hero-stats">' +
      '      <div class="hero-stat"><span class="hero-stat-num">' + stats.letters + '</span><span class="hero-stat-label">封信件</span></div>' +
      '      <div class="hero-stat"><span class="hero-stat-num">' + stats.concepts + '</span><span class="hero-stat-label">个概念</span></div>' +
      '      <div class="hero-stat"><span class="hero-stat-num">' + stats.companies + '</span><span class="hero-stat-label">家公司</span></div>' +
      '      <div class="hero-stat"><span class="hero-stat-num">' + stats.people + '</span><span class="hero-stat-label">位人物</span></div>' +
      '    </div>' +
      '    <div class="hero-cta">' +
      '      <a href="/shareholder-letters" data-route="/shareholder-letters" class="cta-btn cta-primary">开始阅读</a>' +
      '      <a href="/talk" data-route="/talk" class="cta-btn cta-secondary">AI对话</a>' +
      '    </div>' +
      '  </div>' +
      '</section>';

    // ── Quick entry cards: 4 categories ──
    var cardData = [
      { emoji: '📄', title: '伯克希尔股东信', desc: '1965–2024年完整收录，见证伯克希尔从纺织厂到万亿帝国', count: (manifest.nav.shareholderLetters || []).length, route: '/shareholder-letters' },
      { emoji: '📋', title: '合伙人信件', desc: '1956–1970年巴菲特合伙基金时期，了解早期投资哲学', count: (manifest.nav.partnershipLetters || []).length, route: '/partnership-letters' },
      { emoji: '💡', title: '投资理念', desc: '护城河、安全边际、内在价值等核心概念系统解析', count: (manifest.nav.concepts || []).length, route: '/concepts' },
      { emoji: '🕸️', title: '知识图谱', desc: '概念、公司、人物之间的关联关系可视化探索', count: stats.total, route: '/graph', countLabel: '个节点' }
    ];
    var cardsHTML = '<section class="section"><h2 class="section-title">快速入口</h2><div class="entry-cards">';
    for (var i = 0; i < cardData.length; i++) {
      var card = cardData[i];
      cardsHTML += '<a href="' + card.route + '" data-route="' + card.route + '" class="entry-card">' +
        '<span class="entry-card-icon">' + card.emoji + '</span>' +
        '<div class="entry-card-body">' +
        '  <h3 class="entry-card-title">' + card.title + '</h3>' +
        '  <p class="entry-card-desc">' + card.desc + '</p>' +
        '</div>' +
        '<span class="entry-card-badge">' + card.count + ' ' + (card.countLabel || '篇') + '</span>' +
        '</a>';
    }
    cardsHTML += '</div></section>';

    // ── Featured quotes section ──
    var quotesHTML = '';
    var quotesFiles = manifest.quotesFiles || [];
    if (quotesFiles.length > 0) {
      quotesHTML =
        '<section class="section" id="home-quotes-section">' +
        '  <h2 class="section-title">精选金句</h2>' +
        '  <div class="home-quotes-grid" id="home-quotes-grid">' +
        '    <div style="color:var(--text-muted);padding:20px;text-align:center">加载金句中...</div>' +
        '  </div>' +
        '  <div style="text-align:center;margin-top:20px">' +
        '    <a href="/quotes" data-route="/quotes" class="cta-btn cta-secondary" style="display:inline-flex">查看全部金句 →</a>' +
        '  </div>' +
        '</section>';

      // Async load quotes from pre-built data
      setTimeout(function () { loadHomeQuotesFromData(); }, 100);
    }

    // ── Recent letters section ──
    var allLetters = (manifest.nav.shareholderLetters || []).concat(manifest.nav.partnershipLetters || []);
    allLetters.sort(function (a, b) { return (b.year || 0) - (a.year || 0); });
    var recentLetters = allLetters.slice(0, 5);
    var recentHTML = '<section class="section"><h2 class="section-title">近期更新</h2><div class="recent-letters">';
    for (var l = 0; l < recentLetters.length; l++) {
      var letter = recentLetters[l];
      var catLabel = letter.category === 'partnership-letter' ? '合伙人信' : '股东信';
      recentHTML += '<a href="' + letter.route + '" data-route="' + letter.route + '" class="recent-letter-item">' +
        '<span class="recent-letter-year">' + (letter.year || '') + '</span>' +
        '<span class="recent-letter-title">' + letter.title.replace(/（.*?）/g, '').replace(/\(.*?\)/g, '').trim() + '</span>' +
        '<span class="recent-letter-cat">' + catLabel + '</span>' +
        '</a>';
    }
    recentHTML += '</div></section>';

    // ── Timeline section (keep existing) ──
    var partnershipItems = manifest.nav.partnershipLetters || [];
    var shareholderItems = manifest.nav.shareholderLetters || [];
    var allTimeLetters = [];
    for (var pi = 0; pi < partnershipItems.length; pi++) {
      allTimeLetters.push({ item: partnershipItems[pi], type: 'partnership' });
    }
    for (var si = 0; si < shareholderItems.length; si++) {
      allTimeLetters.push({ item: shareholderItems[si], type: 'shareholder' });
    }
    var decades = {};
    for (var k = 0; k < allTimeLetters.length; k++) {
      var entry = allTimeLetters[k];
      if (!entry.item.year) continue;
      var decade = String(Math.floor(entry.item.year / 10) * 10);
      if (!decades[decade]) decades[decade] = [];
      decades[decade].push(entry);
    }
    var timelineHTML = '';
    var sortedDecades = Object.keys(decades).sort();
    for (var d = 0; d < sortedDecades.length; d++) {
      var dec = sortedDecades[d];
      var label = DECADE_LABELS[dec] || (dec + '年代');
      var entries = decades[dec];
      var itemsHTML = '';
      for (var e = 0; e < entries.length; e++) {
        var en = entries[e];
        var shortTitle = en.item.year || en.item.slug;
        itemsHTML += '<a href="' + en.item.route + '" data-route="' + en.item.route + '" class="timeline-item ' + en.type + '" title="' + en.item.title + '">' + shortTitle + '</a>';
      }
      timelineHTML += '<div class="timeline-decade"><div class="timeline-decade-label">' + label + '</div><div class="timeline-items">' + itemsHTML + '</div></div>';
    }

    // Concept tags
    var concepts = manifest.nav.concepts || [];
    var conceptHTML = '';
    for (var c = 0; c < concepts.length; c++) {
      var shortName = concepts[c].title.replace(/（.*?）/g, '').replace(/\(.*?\)/g, '').trim();
      conceptHTML += '<a href="' + concepts[c].route + '" data-route="' + concepts[c].route + '" class="concept-tag">' + shortName + '</a>';
    }

    // People cards
    var people = manifest.nav.people || [];
    var peopleHTML = '';
    for (var p = 0; p < people.length; p++) {
      var pName = people[p].title.replace(/（.*?）/g, '').replace(/\(.*?\)/g, '').trim();
      var initial = pName.charAt(0);
      peopleHTML += '<a href="' + people[p].route + '" data-route="' + people[p].route + '" class="person-card">' +
        '<div class="person-avatar">' + initial + '</div>' +
        '<div class="person-name">' + pName + '</div></a>';
    }

    content.innerHTML =
      '<div class="home-container">' +
      heroHTML +
      cardsHTML +
      quotesHTML +
      recentHTML +
      '  <section class="section">' +
      '    <h2 class="section-title">信件时间轴</h2>' +
      '    <div class="timeline-legend">' +
      '      <span class="legend-item partnership">● 合伙人信</span>' +
      '      <span class="legend-item shareholder">● 股东信</span>' +
      '    </div>' +
      '    <div class="timeline">' + timelineHTML + '</div>' +
      '  </section>' +
      '  <section class="section">' +
      '    <h2 class="section-title">核心概念</h2>' +
      '    <div class="concept-cloud">' + conceptHTML + '</div>' +
      '  </section>' +
      '  <section class="section">' +
      '    <h2 class="section-title">关键人物</h2>' +
      '    <div class="people-grid">' + peopleHTML + '</div>' +
      '  </section>' +
      '</div>';

    document.title = 'MyCloudAI - 价值投资';
    scrollToTop();
    closeMobileSidebar();
  }

  // ─── Load featured quotes for homepage from pre-built data ──
  function loadHomeQuotesFromData() {
    fetch('/assets/data/quotes-data.json').then(function (res) {
      if (!res.ok) throw new Error('Failed');
      return res.json();
    }).then(function (data) {
      // Shuffle and pick 5
      for (var s = data.length - 1; s > 0; s--) {
        var r = Math.floor(Math.random() * (s + 1));
        var tmp = data[s]; data[s] = data[r]; data[r] = tmp;
      }
      var picks = data.slice(0, 5);
      var quotes = [];
      for (var i = 0; i < picks.length; i++) {
        quotes.push({
          text: picks[i].t,
          sourceTitle: picks[i].s,
          sourceRoute: picks[i].r
        });
      }
      renderHomeQuotesGrid(quotes);
    }).catch(function () {
      var grid = document.getElementById('home-quotes-grid');
      if (grid) grid.innerHTML = '';
    });
  }

  function renderHomeQuotesGrid(quotes) {
    var grid = document.getElementById('home-quotes-grid');
    if (!grid) return;
    if (quotes.length === 0) {
      grid.innerHTML = '<p style="color:var(--text-muted);text-align:center">暂无金句</p>';
      return;
    }
    var html = '';
    for (var i = 0; i < quotes.length; i++) {
      var q = quotes[i];
      var sourceLink = q.sourceRoute
        ? '<a href="' + q.sourceRoute + '" data-route="' + q.sourceRoute + '" class="quote-source-link">—— ' + q.sourceTitle + '</a>'
        : '<span class="quote-source-link">—— ' + q.sourceTitle + '</span>';
      html += '<div class="home-quote-card">' +
        '<blockquote class="quote-block">' +
        '<p>' + q.text + '</p>' +
        '</blockquote>' +
        sourceLink +
        '</div>';
    }
    grid.innerHTML = html;
  }

  // ─── Extract quotes (blockquotes) from markdown text ──
  function extractQuotesFromMd(raw) {
    var parsed = parseFrontMatter(raw);
    var body = parsed.body;
    var quotes = [];
    var lines = body.split('\n');
    var current = '';
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (line.trim().indexOf('>') === 0) {
        var text = line.replace(/^>\s*/, '').trim();
        if (text) current += (current ? ' ' : '') + text;
      } else {
        if (current) {
          // Clean up markdown emphasis
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

  // ─── RENDER: Quotes Page ─────────────────────────────
  function renderQuotes() {
    var manifest = window.manifest;
    if (!manifest) {
      document.getElementById('app-content').innerHTML = '<p>加载中...</p>';
      return;
    }

    var content = document.getElementById('app-content');
    content.className = '';

    var quotesFiles = manifest.quotesFiles || [];
    if (quotesFiles.length === 0) {
      content.innerHTML = '<div class="quotes-page"><h1>📝 巴菲特金句</h1><p>暂无金句数据</p></div>';
      return;
    }

    // Group by sourceCategory for filter tabs
    var FILTER_MAP = {
      'all': '全部',
      'shareholder-letters': '股东信金句',
      'partnership-letters': '合伙人信金句',
      'concepts': '概念金句',
      'companies': '公司金句',
      'people': '人物金句'
    };

    var filterHTML = '<div class="quotes-filters">';
    var filterKeys = ['all', 'shareholder-letters', 'partnership-letters', 'concepts', 'companies', 'people'];
    for (var f = 0; f < filterKeys.length; f++) {
      var key = filterKeys[f];
      var activeClass = key === 'all' ? ' active' : '';
      filterHTML += '<button class="quotes-filter-btn' + activeClass + '" data-filter="' + key + '">' + FILTER_MAP[key] + '</button>';
    }
    filterHTML += '</div>';

    content.innerHTML =
      '<div class="quotes-page">' +
      '  <div class="quotes-header">' +
      '    <h1>📝 巴菲特金句</h1>' +
      '    <p class="quotes-subtitle">从 ' + quotesFiles.length + ' 篇文章中提取的投资智慧</p>' +
      '  </div>' +
      filterHTML +
      '  <div class="quotes-list" id="quotes-list">' +
      '    <div style="text-align:center;padding:60px 0;color:var(--text-muted)">加载金句中...</div>' +
      '  </div>' +
      '</div>';

    document.title = '巴菲特金句 | MyCloudAI - 价值投资';
    scrollToTop();
    closeMobileSidebar();

    // Load pre-built quotes data
    loadQuotesData();

    // Bind filter buttons
    content.addEventListener('click', function (e) {
      var btn = e.target.closest('.quotes-filter-btn');
      if (!btn) return;
      var filter = btn.getAttribute('data-filter');
      var allBtns = content.querySelectorAll('.quotes-filter-btn');
      for (var b = 0; b < allBtns.length; b++) allBtns[b].classList.remove('active');
      btn.classList.add('active');
      filterQuotes(filter);
    });
  }

  var _allLoadedQuotes = [];

  function loadQuotesData() {
    fetch('/assets/data/quotes-data.json').then(function (res) {
      if (!res.ok) throw new Error('Failed to load quotes data');
      return res.json();
    }).then(function (data) {
      _allLoadedQuotes = [];
      for (var i = 0; i < data.length; i++) {
        _allLoadedQuotes.push({
          text: data[i].t,
          sourceTitle: data[i].s,
          sourceRoute: data[i].r,
          sourceCategory: data[i].c
        });
      }
      // Shuffle for variety
      for (var s = _allLoadedQuotes.length - 1; s > 0; s--) {
        var r = Math.floor(Math.random() * (s + 1));
        var tmp = _allLoadedQuotes[s]; _allLoadedQuotes[s] = _allLoadedQuotes[r]; _allLoadedQuotes[r] = tmp;
      }
      filterQuotes('all');
    }).catch(function (err) {
      var list = document.getElementById('quotes-list');
      if (list) list.innerHTML = '<p style="text-align:center;padding:40px;color:var(--text-muted)">加载金句失败，请刷新重试</p>';
    });
  }

  function filterQuotes(category) {
    var filtered = _allLoadedQuotes;
    if (category !== 'all') {
      filtered = [];
      for (var i = 0; i < _allLoadedQuotes.length; i++) {
        if (_allLoadedQuotes[i].sourceCategory === category) {
          filtered.push(_allLoadedQuotes[i]);
        }
      }
    }
    var list = document.getElementById('quotes-list');
    if (!list) return;
    if (filtered.length === 0) {
      list.innerHTML = '<p style="text-align:center;padding:40px;color:var(--text-muted)">该分类暂无金句</p>';
      return;
    }
    var html = '<p class="quotes-count">共 ' + filtered.length + ' 条金句</p>';
    for (var i = 0; i < filtered.length; i++) {
      var q = filtered[i];
      var sourceLink = q.sourceRoute
        ? '<a href="' + q.sourceRoute + '" data-route="' + q.sourceRoute + '" class="quote-source-link">—— ' + q.sourceTitle + '</a>'
        : '<span class="quote-source-link">—— ' + q.sourceTitle + '</span>';
      html += '<div class="quote-item" data-category="' + q.sourceCategory + '">' +
        '<blockquote class="quote-block">' +
        '<p>' + q.text + '</p>' +
        '</blockquote>' +
        sourceLink +
        '</div>';
    }
    list.innerHTML = html;
  }

  // ─── RENDER: Graph ────────────────────────────────
  function renderGraph() {
    var mainEl = document.getElementById('main');
    if (mainEl) mainEl.classList.add('graph-page');

    var content = document.getElementById('app-content');
    content.className = '';  // clear content-layout class
    content.innerHTML =
      '<div class="graph-header">' +
      '  <h1>🕸️ 知识图谱</h1>' +
      '  <div class="graph-legend">' +
      '    <span class="legend-dot" style="background:#2563EB"></span> 股东信 ' +
      '    <span class="legend-dot" style="background:#1D4ED8"></span> 合伙人信 ' +
      '    <span class="legend-dot" style="background:#38BDF8"></span> 概念 ' +
      '    <span class="legend-dot" style="background:#60A5FA"></span> 公司 ' +
      '    <span class="legend-dot" style="background:#A78BFA"></span> 人物 ' +
      '  </div>' +
      '</div>' +
      '<div id="graph-container" class="graph-container"></div>' +
      '<div id="graph-tooltip" class="graph-tooltip"></div>';

    document.title = '知识图谱 | MyCloudAI - 价值投资';
    closeMobileSidebar();

    // Load D3 if needed, then init graph
    if (!_d3Loaded && typeof d3 === 'undefined') {
      var script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/d3@7/dist/d3.min.js';
      script.onload = function () {
        _d3Loaded = true;
        if (typeof window.initGraph === 'function') window.initGraph();
      };
      document.head.appendChild(script);
    } else {
      // D3 already loaded - re-initialize graph
      _graphInitialized = false;
      setTimeout(function () {
        if (typeof window.initGraph === 'function') window.initGraph();
      }, 50);
    }
  }

  // ─── RENDER: Talk ─────────────────────────────────
  function renderTalk() {
    var mainEl = document.getElementById('main');
    if (mainEl) mainEl.classList.add('talk-page');

    var content = document.getElementById('app-content');
    content.className = '';  // clear content-layout class
    content.innerHTML =
      '<div class="talk-container">' +
      '  <div class="talk-header">' +
      '    <h1>🤖 与巴菲特对话</h1>' +
      '    <div class="talk-actions">' +
      '      <button id="settings-btn" class="talk-btn" title="设置">⚙️</button>' +
      '      <button id="clear-btn" class="talk-btn" title="清空对话">🗑️</button>' +
      '    </div>' +
      '  </div>' +
      '  <div class="talk-body">' +
      '    <div class="chat-area">' +
      '      <div id="chat-messages" class="chat-messages">' +
      '        <div class="chat-welcome">' +
      '          <div class="welcome-avatar">W</div>' +
      '          <p>你好！我是基于巴菲特公开文献模拟的AI助手。你可以问我关于价值投资、伯克希尔·哈撒韦、或者任何巴菲特曾公开讨论过的话题。</p>' +
      '          <p class="welcome-hint">💡 试试问：「什么是护城河？」「你为什么买入可口可乐？」「如何看待市场波动？」</p>' +
      '          <p class="welcome-disclaimer"><em>（注：本功能由AI基于巴菲特公开文献模拟生成，非真实巴菲特本人）</em></p>' +
      '        </div>' +
      '      </div>' +
      '      <div class="chat-input-area">' +
      '        <textarea id="chat-input" placeholder="输入你的问题..." rows="1"></textarea>' +
      '        <button id="send-btn" class="send-btn">发送</button>' +
      '      </div>' +
      '    </div>' +
      '    <div class="reference-panel" id="reference-panel">' +
      '      <div class="ref-header">' +
      '        <span>📚 参考原文</span>' +
      '        <button id="ref-toggle" class="ref-toggle">收起</button>' +
      '      </div>' +
      '      <div id="ref-content" class="ref-content">' +
      '        <p class="ref-placeholder">发送问题后，相关原文会显示在这里。</p>' +
      '      </div>' +
      '    </div>' +
      '  </div>' +
      '</div>' +
      '<div id="settings-modal" class="modal-overlay" style="display:none">' +
      '  <div class="modal">' +
      '    <div class="modal-header">' +
      '      <h3>⚙️ AI设置</h3>' +
      '      <button id="modal-close" class="modal-close">✕</button>' +
      '    </div>' +
      '    <p class="settings-warning">🔒 您的API密钥仅保存在浏览器本地（localStorage），不会上传至任何服务器。</p>' +
      '    <div class="form-group">' +
      '      <label for="provider">AI提供商</label>' +
      '      <select id="provider">' +
      '        <option value="openai">OpenAI 格式</option>' +
      '        <option value="claude">Claude (Anthropic) 格式</option>' +
      '      </select>' +
      '    </div>' +
      '    <div class="form-group">' +
      '      <label for="api-key">API Key</label>' +
      '      <input type="password" id="api-key" placeholder="sk-...">' +
      '    </div>' +
      '    <div class="form-group">' +
      '      <label for="base-url">Base URL（可选，支持代理/中转）</label>' +
      '      <input type="text" id="base-url" placeholder="https://api.openai.com/v1">' +
      '    </div>' +
      '    <div class="form-group">' +
      '      <label for="model">模型名称</label>' +
      '      <input type="text" id="model" placeholder="gpt-4o">' +
      '      <div class="model-fetch-row">' +
      '        <button id="fetch-models-btn" class="fetch-models-btn">🔄 从 API 获取模型列表</button>' +
      '      </div>' +
      '      <div id="model-select-wrap"></div>' +
      '    </div>' +
      '    <button id="save-settings" class="save-btn">保存设置</button>' +
      '  </div>' +
      '</div>';

    document.title = 'AI问答 | MyCloudAI - 价值投资';
    closeMobileSidebar();

    // Re-initialize talk.js bindings
    setTimeout(function () {
      if (typeof window.initTalk === 'function') window.initTalk();
    }, 50);
  }

  // ─── RENDER: 404 ──────────────────────────────────
  function renderChangelog() {
    var content = document.getElementById('app-content');
    if (!content) return;
    content.className = 'content-layout';
    content.innerHTML = '<div class="article-body" style="max-width:860px;margin:0 auto;padding:40px 24px"><p style="color:var(--text-muted)">加载更新日志...</p></div>';
    document.title = '更新日志 | MyCloudAI - 价值投资';

    fetch('/content/changelog.md')
      .then(function(r) {
        if (!r.ok) throw new Error('404');
        return r.text();
      })
      .then(function(md) {
        if (window.marked) {
          content.innerHTML =
            '<article class="article-body" style="max-width:860px;margin:0 auto;padding:40px 24px">' +
            '<a href="/" data-route="/" style="color:var(--text-muted);font-size:0.85rem;text-decoration:none">← 返回首页</a>' +
            '<div style="margin-top:24px">' + marked.parse(md) + '</div>' +
            '</article>';
        }
      })
      .catch(function() {
        content.innerHTML = '<div style="padding:40px;color:var(--text-muted)">更新日志加载失败。</div>';
      });
  }

  // ─── RENDER: Guide Page ───────────────────────────
  function renderGuide(match) {
    var dirName = match[1];
    var category = DIR_TO_CATEGORY[dirName];
    var catInfo = CATEGORY_MAP[category];
    if (!catInfo) { render404(); return; }

    var manifest = window.manifest;
    if (!manifest) { render404(); return; }

    var navKey = catInfo.dir.replace(/-([a-z])/g, function(_, c) { return c.toUpperCase(); });
    var items = (manifest.nav && manifest.nav[navKey]) || [];

    var content = document.getElementById('app-content');
    content.className = 'guide-layout';

    var html = '<div class="guide-page">';
    html += '<h1 class="guide-title">' + escapeHtmlText(catInfo.label) + ' · 导读</h1>';
    html += '<p class="guide-subtitle">共 ' + items.length + ' 篇，点击标题跳转阅读</p>';
    html += '<div class="guide-list">';

    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      var year = item.year ? '<span class="guide-year">' + item.year + '</span>' : '';
      var summary = item.summary || item.description || '';

      html += '<div class="guide-item">';
      html += '  <div class="guide-item-header">';
      html += '    ' + year;
      html += '    <a href="' + item.route + '" data-route="' + item.route + '" class="guide-item-title nav-link">' + escapeHtmlText(item.title) + '</a>';
      html += '  </div>';
      if (summary) {
        html += '  <p class="guide-item-summary">' + escapeHtmlText(summary) + '</p>';
      }
      html += '</div>';
    }

    html += '</div></div>';
    content.innerHTML = html;
    document.title = catInfo.label + ' 导读 | MyCloudAI - 价值投资';
    scrollToTop();
    closeMobileSidebar();
  }

  function render404() {
    var content = document.getElementById('app-content');
    if (!content) return;
    content.className = '';  // clear content-layout class
    content.innerHTML =
      '<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:60vh;text-align:center">' +
      '  <h1 style="font-size:4rem;margin-bottom:1rem">404</h1>' +
      '  <p style="font-size:1.2rem;color:var(--text-muted,#888);margin-bottom:2rem">页面未找到</p>' +
      '  <a href="/" data-route="/" style="color:var(--accent,#38BDF8)">← 返回首页</a>' +
      '</div>';
    document.title = '404 | MyCloudAI - 价值投资';
  }

  // ─── Highlight keywords from URL params ──────────
  function applyHighlightFromURL() {
    // Use initial URL params (before SPA router may have cleared them)
    var search = window.location.search || _initialSearch;
    var hash = window.location.hash || _initialHash;
    var params = new URLSearchParams(search);
    var highlight = params.get('highlight');

    // ── Hash-only scroll (e.g. #chunk-6 from search results, no highlight) ──
    if (!highlight && hash) {
      _initialHash = '';
      setTimeout(function() {
        var anchor = document.getElementById(hash.slice(1));
        if (anchor) scrollToElement(anchor);
      }, 300);
      return;
    }

    if (!highlight) return;

    // Consume the initial params so they don't apply on subsequent navigations
    _initialSearch = '';
    _initialHash = '';

    setTimeout(function() {
      var articleBody = document.querySelector('.article-body');
      if (!articleBody) return;

      // Walk text nodes and wrap matches in <mark>
      highlightInElement(articleBody, highlight);

      // Scroll to hash anchor first, then to first mark
      if (hash) {
        var anchor = document.getElementById(hash.slice(1));
        if (anchor) {
          scrollToElement(anchor);
          return;
        }
      }
      // Fallback: scroll to first <mark>
      var firstMark = articleBody.querySelector('mark.highlight-mark');
      if (firstMark) {
        scrollToElement(firstMark);
      }
    }, 300);
  }

  function scrollToElement(el) {
    // #main has overflow:visible — scroll the window instead
    var HEADER_OFFSET = 80; // fixed header height + padding
    var top = el.getBoundingClientRect().top + window.pageYOffset - HEADER_OFFSET;
    window.scrollTo({ top: top, behavior: 'smooth' });
  }

  function highlightInElement(el, keyword) {
    if (!keyword) return;
    var escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    var re = new RegExp('(' + escaped + ')', 'gi');
    var walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null, false);
    var textNodes = [];
    while (walker.nextNode()) textNodes.push(walker.currentNode);

    for (var i = 0; i < textNodes.length; i++) {
      var node = textNodes[i];
      if (!re.test(node.nodeValue)) continue;
      re.lastIndex = 0;
      var span = document.createElement('span');
      span.innerHTML = node.nodeValue.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(re, '<mark class="highlight-mark">$1</mark>');
      node.parentNode.replaceChild(span, node);
    }
  }

  // ─── Scoped Search Modal (entity page → letter) ────
  function ensureServerSearchIndex(cb) {
    if (window._serverSearchIndex) {
      cb(window._serverSearchIndex);
      return;
    }
    fetch('/assets/data/server-search-index.json', { cache: 'no-store' })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        window._serverSearchIndex = data;
        cb(data);
      })
      .catch(function() { cb(null); });
  }

  function escapeHtmlText(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function highlightSnippetHtml(text, keyword) {
    var escaped = escapeHtmlText(text);
    var keyEscaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    var re = new RegExp('(' + keyEscaped + ')', 'gi');
    return escaped.replace(re, '<mark class="search-hl">$1</mark>');
  }

  function extractScopedSnippet(text, keyword, maxLen) {
    maxLen = maxLen || 100;
    var lowerText = text.toLowerCase();
    var lowerKeyword = keyword.toLowerCase();
    var idx = lowerText.indexOf(lowerKeyword);
    if (idx === -1) return text.substring(0, maxLen);
    var start = Math.max(0, idx - 40);
    var end = Math.min(text.length, idx + keyword.length + maxLen - 40);
    var snippet = text.substring(start, end);
    if (start > 0) snippet = '...' + snippet;
    if (end < text.length) snippet += '...';
    return snippet;
  }

  function showScopedSearchModal(letterSlug, letterRoute, letterTitle, keyword) {
    var overlay = document.getElementById('xref-modal-overlay');
    var titleEl = document.getElementById('xref-modal-title');
    var bodyEl = document.getElementById('xref-modal-body');
    var footerEl = document.getElementById('xref-modal-footer');
    if (!overlay || !titleEl || !bodyEl || !footerEl) return;

    titleEl.textContent = '在「' + letterTitle + '」中搜索「' + keyword + '」';
    bodyEl.innerHTML = '<p class="xref-modal-empty">加载搜索索引中...</p>';
    footerEl.innerHTML = '';
    overlay.style.display = 'flex';

    ensureServerSearchIndex(function(index) {
      if (!index) {
        bodyEl.innerHTML = '<p class="xref-modal-empty">搜索索引加载失败</p>';
        footerEl.innerHTML = '<a href="' + letterRoute + '" target="_blank" rel="noopener" class="xref-modal-viewpage">直接打开信件 →</a>';
        return;
      }

      // Filter chunks by slug
      var scopedChunks = index.filter(function(c) { return c.slug === letterSlug; });
      // Search for keyword in those chunks
      var lowerKeyword = keyword.toLowerCase();
      var results = scopedChunks.filter(function(c) {
        return c.content.toLowerCase().indexOf(lowerKeyword) !== -1;
      });

      if (results.length === 0) {
        bodyEl.innerHTML = '<p class="xref-modal-empty">该信件未找到「' + keyword + '」相关内容，点击下方直接打开</p>';
        footerEl.innerHTML = '<a href="' + letterRoute + '" target="_blank" rel="noopener" class="xref-modal-viewpage">直接打开信件 →</a>';
      } else {
        var html = '<ul class="xref-modal-list">';
        for (var i = 0; i < results.length; i++) {
          var chunk = results[i];
          var preview = extractScopedSnippet(chunk.content, keyword, 100);
          // Navigate with highlight param only — no #chunk-N anchor because the
          // server-index chunk numbering (char-based) does not align with the DOM
          // element IDs (element-based). applyHighlightFromURL() will scroll to
          // the first rendered <mark> instead, which is always accurate.
          var url = letterRoute + '?highlight=' + encodeURIComponent(keyword);
          html += '<li><a href="' + url + '" target="_blank" rel="noopener" class="xref-modal-link xref-scoped-result">';
          html += '<span class="xref-scoped-preview">' + highlightSnippetHtml(preview, keyword) + '</span>';
          html += '<span class="xref-modal-badge">段落 ' + ((chunk.chunkIndex || 0) + 1) + '</span>';
          html += '</a></li>';
        }
        html += '</ul>';
        bodyEl.innerHTML = html;
        footerEl.innerHTML = '<a href="' + letterRoute + '?highlight=' + encodeURIComponent(keyword) + '" target="_blank" rel="noopener" class="xref-modal-viewpage">打开完整信件 →</a>';
      }
    });
  }

  function closeXrefModal() {
    var overlay = document.getElementById('xref-modal-overlay');
    if (overlay) overlay.style.display = 'none';
  }

  // ─── Xref Modal Event Binding ─────────────────────
  document.addEventListener('DOMContentLoaded', function() {
    var closeBtn = document.getElementById('xref-modal-close');
    if (closeBtn) closeBtn.addEventListener('click', closeXrefModal);

    var overlay = document.getElementById('xref-modal-overlay');
    if (overlay) {
      overlay.addEventListener('click', function(e) {
        if (e.target === overlay) closeXrefModal();
      });
    }
  });

  // ─── Global Link Interception ─────────────────────
  document.addEventListener('click', function (e) {
    // ── TOC hash-link: event delegation (must run first to prevent re-navigation) ──
    var tocLink = e.target.closest('.toc a');
    if (tocLink) {
      var href = tocLink.getAttribute('href');
      if (href && href.charAt(0) === '#') {
        e.preventDefault();
        e.stopPropagation();
        var targetId = href.slice(1);
        var target = document.getElementById(targetId);
        if (target) {
          var mainEl = document.getElementById('main');
          if (mainEl) {
            // Scroll within #main (the overflow scroll container in fixed-sidebar layout)
            var offset = target.getBoundingClientRect().top
                       - mainEl.getBoundingClientRect().top
                       + mainEl.scrollTop
                       - 80; // 80px breathing room below sticky header
            mainEl.scrollTo({ top: offset, behavior: 'smooth' });
          } else {
            target.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }
        }
        return;
      }
    }

    // ── Xref chip (letter page): open concept/company/person in new tab ──
    var xrefChipDirect = e.target.closest('.xref-chip-direct');
    if (xrefChipDirect) {
      // Let browser handle target="_blank" natively — don't intercept
      return;
    }

    // ── Xref letter item (entity page): trigger scoped search ──
    var letterItem = e.target.closest('.xref-letter-item');
    if (letterItem) {
      e.preventDefault();
      e.stopPropagation();
      var letterSlug = letterItem.getAttribute('data-letter-slug');
      var letterRoute = letterItem.getAttribute('data-letter-route');
      var letterTitle = letterItem.getAttribute('data-letter-title');
      var keyword = letterItem.getAttribute('data-keyword');
      showScopedSearchModal(letterSlug, letterRoute, letterTitle, keyword);
      return;
    }

    // Check for data-route attribute
    var link = e.target.closest('[data-route]');
    if (link) {
      e.preventDefault();
      Router.navigate(link.getAttribute('data-route'));
      return;
    }

    // Also intercept internal links (same origin, not external, not hash-only)
    var anchor = e.target.closest('a');
    if (anchor && anchor.href) {
      var url;
      try { url = new URL(anchor.href); } catch (_) { return; }

      // Only intercept same-origin, non-asset links
      if (url.origin === window.location.origin &&
          !url.pathname.startsWith('/assets/') &&
          !url.pathname.startsWith('/content/') &&
          !anchor.hasAttribute('download') &&
          anchor.target !== '_blank') {
        e.preventDefault();
        Router.navigate(url.pathname);
      }
    }
  });

  // ─── Browser back/forward ─────────────────────────
  window.addEventListener('popstate', function () {
    Router.render(window.location.pathname);
  });

  // ─── Bootstrap ────────────────────────────────────
  window.addEventListener('DOMContentLoaded', function () {
    // Load manifest
    fetch('/content/manifest.json').then(function (r) { return r.json(); }).then(function (data) {
      window.manifest = data;

      // Update version badge in sidebar
      var verEl = document.getElementById('version-number');
      if (verEl && data.version) {
        verEl.textContent = data.version;
      }

      // Also preload graph data for backlinks
      fetch('/assets/data/graph-data.json').then(function (r) { return r.json(); }).then(function (gd) {
        window._graphData = gd;
      }).catch(function () {});

      // Initialize navigation
      if (typeof window.initNav === 'function') {
        window.initNav(data);
      }

      // Render current route (preserve initial search/hash in URL)
      var initialPath = window.location.pathname;
      if (_initialSearch || _initialHash) {
        window.history.replaceState({}, '', initialPath + _initialSearch + _initialHash);
      }
      Router.render(initialPath);
    }).catch(function (err) {
      console.error('Failed to load manifest:', err);
      document.getElementById('app-content').innerHTML = '<p style="padding:40px;color:red">无法加载数据，请刷新页面重试。</p>';
    });
  });

  // ─── Theme Toggle ────────────────────────────────
  (function initThemeToggle() {
    // Apply saved theme immediately (before DOMContentLoaded to prevent flash)
    var saved = localStorage.getItem('theme') || 'dark';
    document.documentElement.setAttribute('data-theme', saved);

    document.addEventListener('DOMContentLoaded', function () {
      var btn = document.getElementById('theme-toggle');
      if (!btn) return;
      var moon = btn.querySelector('.icon-moon');
      var sun = btn.querySelector('.icon-sun');
      var label = btn.querySelector('.theme-label');

      function applyTheme(theme) {
        document.documentElement.setAttribute('data-theme', theme);
        localStorage.setItem('theme', theme);
        if (moon && sun) {
          moon.style.display = theme === 'light' ? 'none' : '';
          sun.style.display = theme === 'light' ? '' : 'none';
        }
        if (label) {
          label.textContent = theme === 'light' ? '深色模式' : '浅色模式';
        }
      }

      // Apply current theme to button state
      applyTheme(saved);

      btn.addEventListener('click', function () {
        var current = document.documentElement.getAttribute('data-theme') || 'dark';
        applyTheme(current === 'dark' ? 'light' : 'dark');
      });
    });
  })();

  // ─── Sidebar Collapse Toggle ──────────────────────────────────
  (function initSidebarCollapse() {
    // Restore saved state immediately to prevent layout flash
    if (localStorage.getItem('sidebarCollapsed') === 'true') {
      document.body.classList.add('sidebar-collapsed');
    }

    document.addEventListener('DOMContentLoaded', function () {
      var toggleBtn = document.getElementById('sidebar-toggle');
      var expandBtn = document.getElementById('sidebar-expand-btn');

      function setCollapsed(collapsed) {
        document.body.classList.toggle('sidebar-collapsed', collapsed);
        localStorage.setItem('sidebarCollapsed', collapsed ? 'true' : 'false');
        if (toggleBtn) toggleBtn.setAttribute('aria-label', collapsed ? '展开侧边栏' : '折叠侧边栏');
        if (toggleBtn) toggleBtn.setAttribute('title', collapsed ? '展开侧边栏' : '折叠侧边栏');
      }

      if (toggleBtn) {
        toggleBtn.addEventListener('click', function () {
          setCollapsed(!document.body.classList.contains('sidebar-collapsed'));
        });
      }
      if (expandBtn) {
        expandBtn.addEventListener('click', function () {
          setCollapsed(false);
        });
      }
    });
  })();

  // ─── Help Modal ──────────────────────────────────────────────
  (function initHelpModal() {
    var helpLoaded = false;

    function openHelp() {
      var overlay = document.getElementById('help-modal-overlay');
      if (!overlay) return;
      overlay.style.display = 'flex';
      document.body.style.overflow = 'hidden';

      if (!helpLoaded) {
        helpLoaded = true;
        fetch('/content/help.md')
          .then(function(r) {
            if (!r.ok) throw new Error(r.status);
            return r.text();
          })
          .then(function(md) {
            var body = document.getElementById('help-modal-body');
            if (body && window.marked) {
              body.innerHTML = '<div class="help-content article-body">' + marked.parse(md) + '</div>';
            }
          })
          .catch(function() {
            var body = document.getElementById('help-modal-body');
            if (body) body.innerHTML = '<p style="padding:20px;color:var(--text-muted)">帮助文档加载失败，请查看项目根目录 HELP.md。</p>';
          });
      }
    }

    function closeHelp() {
      var overlay = document.getElementById('help-modal-overlay');
      if (!overlay) return;
      overlay.style.display = 'none';
      document.body.style.overflow = '';
    }

    document.addEventListener('DOMContentLoaded', function() {
      var helpBtn = document.getElementById('help-btn');
      var closeBtn = document.getElementById('help-modal-close');
      var overlay = document.getElementById('help-modal-overlay');

      if (helpBtn) helpBtn.addEventListener('click', openHelp);
      if (closeBtn) closeBtn.addEventListener('click', closeHelp);
      if (overlay) overlay.addEventListener('click', function(e) {
        if (!e.target.closest('.help-modal')) closeHelp();
      });

      // ESC key closes modal
      document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape' && overlay && overlay.style.display !== 'none') closeHelp();
      });
    });
  })();

})();
