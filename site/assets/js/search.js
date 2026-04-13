/* ═══════════════════════════════════════════════════
   search.js - Header Search with Paragraph-Level Results
   Uses server-search-index.json (chunked) via Fuse.js
   ═══════════════════════════════════════════════════ */
(function() {
  'use strict';

  var fuse = null;
  var serverIndex = null;
  var sidebarFuse = null;
  var sidebarIndex = null;

  var CATEGORY_LABELS = {
    'shareholder-letter': '股东信',
    'partnership-letter': '合伙人信',
    'special-letter': '特别信件',
    'concept': '投资理念',
    'company': '公司解析',
    'person': '关键人物'
  };

  // ─── Load server search index (no cache) ───────────────────
  function loadServerIndex(cb) {
    if (serverIndex) { cb(); return; }
    fetch('/assets/data/server-search-index.json', { cache: 'no-store' })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        serverIndex = data;
        window._serverSearchIndex = data;
        fuse = new Fuse(serverIndex, {
          keys: [
            { name: 'content', weight: 0.7 },
            { name: 'title', weight: 0.3 }
          ],
          threshold: 0.2,
          ignoreLocation: true,   // 不限制匹配位置，支持全文任意位置
          distance: 100000,       // 配合 ignoreLocation 确保全范围匹配
          includeScore: true,
          includeMatches: true,
          minMatchCharLength: 2
        });
        cb();
      })
      .catch(function(e) { console.warn('Failed to load server search index:', e); cb(); });
  }

  // ─── Load sidebar search index (no cache) ──────────────────
  function loadSidebarIndex(cb) {
    if (sidebarIndex) { cb(); return; }
    fetch('/assets/data/search-index.json', { cache: 'no-store' })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        sidebarIndex = data;
        sidebarFuse = new Fuse(sidebarIndex, {
          keys: [
            { name: 'title', weight: 0.7 },
            { name: 'content', weight: 0.3 }
          ],
          threshold: 0.35,
          includeScore: true,
          minMatchCharLength: 2
        });
        cb();
      })
      .catch(function(e) { console.warn('Failed to load search index:', e); cb(); });
  }

  // ─── Highlight text helper ─────────────────────────────────
  function highlightText(text, query) {
    if (!query) return escapeHtml(text);
    var escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    var re = new RegExp('(' + escaped + ')', 'gi');
    return escapeHtml(text).replace(re, '<mark class="search-hl">$1</mark>');
  }

  function escapeHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ─── Extract snippet around match ──────────────────────────
  function extractSnippet(text, query, maxLen) {
    maxLen = maxLen || 120;
    var lowerText = text.toLowerCase();
    var lowerQuery = query.toLowerCase();
    var idx = lowerText.indexOf(lowerQuery);
    if (idx === -1) return text.substring(0, maxLen);
    var start = Math.max(0, idx - 30);
    var end = Math.min(text.length, idx + query.length + maxLen - 30);
    var snippet = text.substring(start, end);
    if (start > 0) snippet = '...' + snippet;
    if (end < text.length) snippet += '...';
    return snippet;
  }

  // ─── Build route from chunk item ───────────────────────────
  function buildRoute(item) {
    // item.id is like "shareholder-letters/1984"
    return '/' + item.id;
  }

  // ─── Deduplicate results by article (keep best score per article) ──
  function deduplicateResults(results, limit) {
    var seen = {};
    var deduped = [];
    for (var i = 0; i < results.length && deduped.length < limit; i++) {
      var item = results[i].item;
      var key = item.id;
      if (!seen[key]) {
        seen[key] = true;
        deduped.push(results[i]);
      }
    }
    return deduped;
  }

  // ─── Init Spotlight Search ─────────────────────────────────
  function initSpotlightSearch() {
    var overlay = document.getElementById('search-overlay');
    var modal = document.getElementById('search-modal');
    var input = document.getElementById('search-modal-input');
    var results = document.getElementById('search-modal-results');
    var openBtn = document.getElementById('search-open-btn');
    var closeBtn = document.getElementById('search-modal-close');
    var mobileBtn = document.getElementById('mobile-search-btn');

    if (!overlay || !modal) return;

    var selectedIndex = -1;

    function openSearch() {
      overlay.classList.add('active');
      modal.classList.add('active');
      document.body.style.overflow = 'hidden';
      setTimeout(function() { if (input) input.focus(); }, 50);
    }

    function closeSearch() {
      overlay.classList.remove('active');
      modal.classList.remove('active');
      document.body.style.overflow = '';
      if (input) input.value = '';
      if (results) results.innerHTML = '';
      selectedIndex = -1;
    }

    if (openBtn) openBtn.addEventListener('click', openSearch);
    if (mobileBtn) mobileBtn.addEventListener('click', openSearch);
    if (closeBtn) closeBtn.addEventListener('click', closeSearch);
    overlay.addEventListener('click', closeSearch);

    // Cmd+K / Ctrl+K shortcut
    document.addEventListener('keydown', function(e) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        if (modal.classList.contains('active')) closeSearch();
        else openSearch();
      }
      if (e.key === 'Escape' && modal.classList.contains('active')) {
        e.preventDefault();
        closeSearch();
      }
    });

    // Keyboard navigation in results
    document.addEventListener('keydown', function(e) {
      if (!modal.classList.contains('active')) return;
      var items = results.querySelectorAll('.spotlight-result-item');
      if (!items.length) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        selectedIndex = Math.min(selectedIndex + 1, items.length - 1);
        updateSelection(items);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        selectedIndex = Math.max(selectedIndex - 1, -1);
        updateSelection(items);
      } else if (e.key === 'Enter' && selectedIndex >= 0) {
        e.preventDefault();
        var selected = items[selectedIndex];
        if (selected) selected.click();
      }
    });

    function updateSelection(items) {
      for (var i = 0; i < items.length; i++) {
        if (i === selectedIndex) {
          items[i].classList.add('selected');
          items[i].scrollIntoView({ block: 'nearest' });
        } else {
          items[i].classList.remove('selected');
        }
      }
    }

    // Search input handler
    var debounceTimer = null;
    if (input) input.addEventListener('input', function() {
      clearTimeout(debounceTimer);
      var query = input.value.trim();
      debounceTimer = setTimeout(function() {
        if (!query || query.length < 1) {
          results.innerHTML = '';
          selectedIndex = -1;
          return;
        }
        doSpotlightSearch(query);
      }, 150);
    });

    function doSpotlightSearch(query) {
      selectedIndex = -1;
      loadServerIndex(function() {
        if (!fuse) {
          results.innerHTML = '<div class="search-no-results">搜索索引加载中...</div>';
          return;
        }

        // 精确匹配优先：先做 includes 全文检索
        var q = query.toLowerCase();
        var exactHits = [];
        var exactSlugs = {};
        for (var ei = 0; ei < serverIndex.length; ei++) {
          var doc = serverIndex[ei];
          if ((doc.content && doc.content.toLowerCase().indexOf(q) !== -1) ||
              (doc.title && doc.title.toLowerCase().indexOf(q) !== -1)) {
            exactHits.push(doc);
            exactSlugs[doc.slug + '_' + doc.chunkIndex] = true;
          }
        }

        // Fuse.js 模糊补充（去掉已精确命中的）
        var rawResults = fuse.search(query, { limit: 30 });
        var deduped = deduplicateResults(rawResults, 15);
        for (var fi = 0; fi < deduped.length; fi++) {
          var item = deduped[fi].item;
          var key = item.slug + '_' + item.chunkIndex;
          if (!exactSlugs[key]) {
            exactHits.push(item);
            exactSlugs[key] = true;
          }
        }

        renderSpotlightResults(exactHits.slice(0, 20), query, closeSearch);
      });
    }

    function renderSpotlightResults(hits, query, closeFn) {
      if (!hits.length) {
        results.innerHTML = '<div class="search-no-results">无匹配结果，换个关键词试试</div>';
        return;
      }

      var html = '';
      for (var i = 0; i < hits.length; i++) {
        var item = hits[i];
        var route = buildRoute(item);
        var url = route + '#chunk-' + (item.chunkIndex || 0);
        var catLabel = CATEGORY_LABELS[item.category] || item.category || '';
        var yearStr = item.year ? item.year + ' · ' : '';
        var snippet = extractSnippet(item.content || '', query, 120);
        var highlightedSnippet = highlightText(snippet, query);
        var highlightedTitle = highlightText(item.title || '', query);

        html += '<a class="spotlight-result-item" href="' + escapeHtml(url) + '" target="_blank" rel="noopener">';
        html += '  <div class="search-result-title">' + highlightedTitle + '</div>';
        html += '  <div class="search-result-snippet">' + highlightedSnippet + '</div>';
        html += '  <div class="search-result-meta"><span>' + yearStr + catLabel + '</span><span class="search-result-arrow">↗</span></div>';
        html += '</a>';
      }
      results.innerHTML = html;

      // Close modal when a result is clicked (new tab opens, modal can close)
      var resultItems = results.querySelectorAll('.spotlight-result-item');
      for (var j = 0; j < resultItems.length; j++) {
        resultItems[j].addEventListener('click', function() {
          closeFn();
        });
      }
    }
  }

  // ─── Init Sidebar Search (legacy, still works) ─────────────
  function initSidebarSearch() {
    var input = document.getElementById('search-input');
    var resultsEl = document.getElementById('search-results');
    if (!input || !resultsEl) return;

    var debounceTimer;
    input.addEventListener('input', function() {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(function() {
        var query = input.value.trim();
        if (query.length < 2) {
          resultsEl.classList.remove('active');
          resultsEl.innerHTML = '';
          return;
        }
        loadSidebarIndex(function() {
          if (!sidebarFuse) return;
          var results = sidebarFuse.search(query, { limit: 15 });
          renderSidebarResults(resultsEl, results);
        });
      }, 200);
    });

    document.addEventListener('click', function(e) {
      if (!e.target.closest('.sidebar-search')) {
        resultsEl.classList.remove('active');
      }
    });

    input.addEventListener('focus', function() {
      if (resultsEl.children.length > 0) resultsEl.classList.add('active');
    });
  }

  function renderSidebarResults(container, results) {
    if (results.length === 0) {
      container.innerHTML = '<div class="search-result-item" style="color:var(--text-muted)">无搜索结果</div>';
      container.classList.add('active');
      return;
    }

    var html = '';
    for (var i = 0; i < results.length; i++) {
      var item = results[i].item;
      var catLabel = CATEGORY_LABELS[item.category] || '';
      var yearStr = item.year ? item.year + ' · ' : '';
      html += '<a href="' + item.path + '" data-route="' + item.path + '" class="search-result-item">';
      html += '<div>' + item.title.substring(0, 40) + '</div>';
      html += '<div class="search-result-cat">' + yearStr + catLabel + '</div>';
      html += '</a>';
    }
    container.innerHTML = html;
    container.classList.add('active');
  }

  // ─── Export for talk.js RAG ────────────────────────────────
  window.searchInIndex = function(query, limit) {
    if (!sidebarFuse) {
      return fetch('/assets/data/search-index.json', { cache: 'no-store' }).then(function(resp) {
        return resp.json();
      }).then(function(data) {
        sidebarIndex = data;
        sidebarFuse = new Fuse(sidebarIndex, {
          keys: [
            { name: 'title', weight: 0.7 },
            { name: 'content', weight: 0.3 }
          ],
          threshold: 0.35,
          includeScore: true,
          minMatchCharLength: 2
        });
        return sidebarFuse.search(query, { limit: limit || 5 }).map(function(r) { return r.item; });
      }).catch(function() { return []; });
    }
    return Promise.resolve(sidebarFuse.search(query, { limit: limit || 5 }).map(function(r) { return r.item; }));
  };

  // ─── Init ──────────────────────────────────────────────────
  function init() {
    initSpotlightSearch();
    initSidebarSearch();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
