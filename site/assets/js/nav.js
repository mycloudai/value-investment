/* ═══════════════════════════════════════════════════
   nav.js - Sidebar Navigation Controller (SPA)
   ═══════════════════════════════════════════════════ */
(function() {
  var CATEGORY_MAP = {
    'partnership-letter': { label: '合伙基金信件', icon: '📋', order: 1 },
    'shareholder-letter': { label: '伯克希尔股东信', icon: '📄', order: 2 },
    'special-letter':     { label: '特别信件', icon: '📌', order: 3 },
    'concept':            { label: '投资理念', icon: '💡', order: 4 },
    'company':            { label: '公司解析', icon: '🏢', order: 5 },
    'person':             { label: '关键人物', icon: '👤', order: 6 }
  };

  // NAV_KEY_TO_CAT maps manifest nav keys back to category keys
  var NAV_KEY_TO_CAT = {
    'partnershipLetters': 'partnership-letter',
    'shareholderLetters': 'shareholder-letter',
    'specialLetters': 'special-letter',
    'concepts': 'concept',
    'companies': 'company',
    'people': 'person'
  };

  function initNav(manifest) {
    var navEl = document.getElementById('sidebar-nav');
    if (!navEl) return;

    if (manifest) {
      renderNav(navEl, manifest);
    }

    // Hamburger toggle
    var hamburger = document.getElementById('hamburger');
    var sidebar = document.getElementById('sidebar');
    var closeBtn = document.getElementById('sidebar-close');

    if (hamburger && sidebar) {
      hamburger.addEventListener('click', function() { sidebar.classList.add('open'); });
    }
    if (closeBtn && sidebar) {
      closeBtn.addEventListener('click', function() { sidebar.classList.remove('open'); });
    }

    // Close on outside click (mobile)
    document.addEventListener('click', function(e) {
      if (sidebar && sidebar.classList.contains('open') &&
          !sidebar.contains(e.target) &&
          e.target !== hamburger) {
        sidebar.classList.remove('open');
      }
    });
  }

  function renderNav(container, manifest) {
    var currentPath = window.location.pathname;
    if (currentPath !== '/' && currentPath.endsWith('/')) {
      currentPath = currentPath.replace(/\/+$/, '');
    }
    var html = '';

    // Home link
    html += '<a href="/" data-route="/" class="nav-item' + (currentPath === '/' ? ' active' : '') + '" style="padding-left:16px;font-weight:500;">🏠 首页</a>';

    // Category groups sorted by order
    var categories = Object.entries(CATEGORY_MAP)
      .sort(function(a, b) { return a[1].order - b[1].order; });

    for (var i = 0; i < categories.length; i++) {
      var cat = categories[i][0];
      var info = categories[i][1];

      // Find nav key for this category
      var navKey = null;
      for (var key in NAV_KEY_TO_CAT) {
        if (NAV_KEY_TO_CAT[key] === cat) { navKey = key; break; }
      }
      var items = navKey && manifest.nav[navKey] ? manifest.nav[navKey] : [];
      if (items.length === 0) continue;

      var hasActive = false;
      for (var j = 0; j < items.length; j++) {
        if (currentPath === items[j].route) { hasActive = true; break; }
      }
      var isOpen = hasActive ? ' open' : '';

      html += '<div class="nav-group' + isOpen + '">';
      html += '<div class="nav-group-header" data-group="' + cat + '">';
      html += '<span>' + info.icon + ' ' + info.label + '<span class="nav-group-count">(' + items.length + ')</span></span>';
      html += '<span class="arrow">▸</span>';
      html += '</div>';
      html += '<div class="nav-group-items">';

      for (var k = 0; k < items.length; k++) {
        var item = items[k];
        var shortTitle = item.title
          .replace(/（.*?）/g, '')
          .replace(/\(.*?\)/g, '')
          .replace(/巴菲特致(股东|合伙人)信/g, '')
          .replace(/中文全文/g, '')
          .trim();
        var displayTitle = item.year ? item.year + ' ' + shortTitle.substring(0, 20) : shortTitle.substring(0, 25);
        var isActive = currentPath === item.route ? ' active' : '';
        html += '<a href="' + item.route + '" data-route="' + item.route + '" class="nav-item' + isActive + '">' + displayTitle + '</a>';
      }

      html += '</div></div>';
    }

    // ─── Guide section ──────────────────────────────
    html += '<div class="sidebar-section-title">导读</div>';
    var guideItems = [
      { href: '/guide/partnership-letters', icon: '📋', label: '合伙人信导读' },
      { href: '/guide/shareholder-letters', icon: '📄', label: '股东信导读' },
      { href: '/guide/concepts',            icon: '💡', label: '概念导读' },
      { href: '/guide/companies',           icon: '🏢', label: '公司导读' },
      { href: '/guide/people',              icon: '👤', label: '人物导读' }
    ];
    for (var gi = 0; gi < guideItems.length; gi++) {
      var g = guideItems[gi];
      var isGuideActive = currentPath === g.href ? ' active' : '';
      html += '<a href="' + g.href + '" data-route="' + g.href + '" class="nav-item sidebar-link' + isGuideActive + '" style="padding-left:16px;">' + g.icon + ' ' + g.label + '</a>';
    }

    container.innerHTML = html;

    // Toggle groups
    container.querySelectorAll('.nav-group-header').forEach(function(header) {
      header.addEventListener('click', function() {
        header.parentElement.classList.toggle('open');
      });
    });
  }

  // Update active nav item (called by Router)
  function updateActiveNavItem(path) {
    if (path !== '/' && path.endsWith('/')) {
      path = path.replace(/\/+$/, '');
    }
    var navEl = document.getElementById('sidebar-nav');
    if (!navEl) return;

    // Remove all active
    var activeItems = navEl.querySelectorAll('.nav-item.active');
    for (var i = 0; i < activeItems.length; i++) {
      activeItems[i].classList.remove('active');
    }

    // Find and set new active
    var links = navEl.querySelectorAll('.nav-item[data-route]');
    for (var j = 0; j < links.length; j++) {
      if (links[j].getAttribute('data-route') === path) {
        links[j].classList.add('active');
        // Open parent group if collapsed
        var group = links[j].closest('.nav-group');
        if (group && !group.classList.contains('open')) {
          group.classList.add('open');
        }
        break;
      }
    }
  }

  // Expose globally for app.js
  window.initNav = initNav;
  window.updateActiveNavItem = updateActiveNavItem;
})();
