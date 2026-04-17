/* ═══════════════════════════════════════════════════
   talk.js - AI Chat (Buffett Persona) with RAG (SPA)
   ═══════════════════════════════════════════════════ */
(function() {

  // ─── State ───────────────────────────────────────
  var state = {
    messages: [],
    isStreaming: false
  };

  var defaultSettings = {
    provider: 'openai',
    apiKey: '',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o'
  };

  function loadSettings() {
    try {
      var saved = localStorage.getItem('mycloudai-settings');
      return saved ? Object.assign({}, defaultSettings, JSON.parse(saved)) : Object.assign({}, defaultSettings);
    } catch (e) {
      return Object.assign({}, defaultSettings);
    }
  }

  function saveSettings(settings) {
    localStorage.setItem('mycloudai-settings', JSON.stringify(settings));
  }

  // ─── System Prompt ────────────────────────────────
  // System prompt is now handled server-side via Buffett Skill
  // Kept for reference only - not used in /api/chat flow

  // ─── RAG Retrieval ────────────────────────────────
  // RAG is now handled server-side via search_buffett_knowledge tool
  // Client-side search is still used for reference panel display
  async function retrieveContext(query) {
    if (typeof window.searchInIndex !== 'function') return '';
    try {
      var results = await window.searchInIndex(query, 5);
      if (!results || results.length === 0) return '';
      updateRefPanel(results);
      return '';
    } catch (e) {
      return '';
    }
  }

  function updateRefPanel(results) {
    var el = document.getElementById('ref-content');
    if (!el) return;
    if (!results || results.length === 0) {
      el.innerHTML = '<p class="ref-placeholder">暂无相关原文</p>';
      return;
    }
    var h = '';
    for (var i = 0; i < results.length; i++) {
      var route = results[i].route || '';
      var query = results[i].query || '';
      var title = escapeHtml(results[i].title || '未命名来源');
      var snippet = escapeHtml((results[i].content || '').substring(0, 220));
      var href = route;
      if (route && query) {
        href = route + (route.indexOf('?') >= 0 ? '&' : '?') + 'highlight=' + encodeURIComponent(query);
      }
      h += '<div class="ref-item">';
      if (href) {
        h += '<div class="ref-item-title">\u{1F4C4} <a href="' + href + '" data-route="' + route + '" target="_blank" rel="noopener noreferrer">' + title + '</a></div>';
      } else {
        h += '<div class="ref-item-title">\u{1F4C4} ' + title + '</div>';
      }
      h += '<div class="ref-item-text">' + snippet + '...</div>';
      h += '</div>';
    }
    el.innerHTML = h;
  }

  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  var _chatMarkedConfigured = false;
  function getChatMarked() {
    if (!window.marked || typeof window.marked.parse !== 'function') return null;
    if (!_chatMarkedConfigured && typeof window.marked.setOptions === 'function') {
      window.marked.setOptions({ gfm: true, breaks: true });
      _chatMarkedConfigured = true;
    }
    return window.marked;
  }

  // ─── API Calls ────────────────────────────────────
  // Direct API calls are no longer used - all requests go through /api/chat
  // The server-side Agentic Loop handles tool calls and streaming

  // ─── Chat UI ──────────────────────────────────────
  function addMessageToUI(role, content) {
    var el = document.getElementById('chat-messages');
    if (!el) return null;
    var welcome = el.querySelector('.chat-welcome');
    if (welcome) welcome.remove();

    var div = document.createElement('div');
    div.className = 'chat-message ' + role;
    var avText = role === 'user' ? '你' : 'W';
    var avClass = role === 'user' ? 'human' : 'ai';
    div.innerHTML = '<div class="msg-avatar ' + avClass + '">' + avText + '</div><div class="msg-bubble">' + formatMsg(content) + '</div>';
    el.appendChild(div);
    el.scrollTop = el.scrollHeight;
    return div;
  }

  function updateMessageUI(div, content) {
    if (!div) return;
    var bubble = div.querySelector('.msg-bubble');
    if (bubble) bubble.innerHTML = formatMsg(content);
    var el = document.getElementById('chat-messages');
    if (el) el.scrollTop = el.scrollHeight;
  }

  function formatMsg(text) {
    var raw = String(text || '');
    try {
      var md = getChatMarked();
      if (md) {
        return md.parse(raw);
      }
    } catch (_) {}
    return '<pre class="msg-plain">' + escapeHtml(raw) + '</pre>';
  }

  // ─── Send Message ─────────────────────────────────
  async function sendMessage() {
    var input = document.getElementById('chat-input');
    var sendBtn = document.getElementById('send-btn');
    if (!input || state.isStreaming) return;

    var userInput = input.value.trim();
    if (!userInput) return;

    var settings = loadSettings();
    if (!settings.apiKey) {
      showSettings();
      alert('请先设置API Key');
      return;
    }

    input.value = '';
    input.style.height = 'auto';
    state.isStreaming = true;
    if (sendBtn) sendBtn.disabled = true;

    addMessageToUI('user', userInput);

    // Build message history (without system prompt - server adds it via Skill)
    var historyForApi = [];
    for (var i = 0; i < state.messages.length; i++) {
      historyForApi.push(state.messages[i]);
    }
    historyForApi.push({ role: 'user', content: userInput });

    var aiDiv = addMessageToUI('assistant', '');
    var fullText = '';
    var searchIndicator = null;
    var receivedEvent = false;

    try {
      var res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiKey: settings.apiKey,
          provider: settings.provider,
          baseUrl: settings.baseUrl,
          model: settings.model,
          messages: historyForApi
        })
      });

        if (!res.ok) {
          var errMsg = '';
          try { errMsg = await res.text(); } catch(e) {}
          throw new Error('请求失败: ' + res.status + (errMsg ? ' - ' + errMsg.substring(0, 200) : ''));
        }

        var contentType = (res.headers && res.headers.get && res.headers.get('content-type')) || '';
        if (contentType.indexOf('text/event-stream') === -1) {
          var rawBody = '';
          try { rawBody = await res.text(); } catch (e) {}
          if (contentType.indexOf('text/html') !== -1 || /^\s*<!DOCTYPE html/i.test(rawBody)) {
            throw new Error('当前 /api/chat 返回的是网页内容而不是聊天流。请使用支持 Pages Functions 的方式启动站点（如 ./start-local.sh 或 wrangler pages dev）。');
          }
          throw new Error('服务端未返回流式聊天响应（content-type: ' + (contentType || 'unknown') + '）');
        }

        var reader = res.body.getReader();
        var dec = new TextDecoder();
        var buf = '';

      while (true) {
        var result = await reader.read();
        if (result.done) break;
        buf += dec.decode(result.value, { stream: true });
        var blocks = buf.split('\n\n');
        buf = blocks.pop() || '';

        for (var bi = 0; bi < blocks.length; bi++) {
          var block = blocks[bi];
          var eventMatch = block.match(/^event: (.+)/m);
          var dataMatch = block.match(/^data: (.+)/m);
          if (!dataMatch) continue;

            var event = eventMatch ? eventMatch[1] : 'chunk';
            var data;
            try { data = JSON.parse(dataMatch[1]); } catch(e) { continue; }
            receivedEvent = true;

            if (event === 'tool_call') {
              // Show search indicator
              if (!searchIndicator) {
              searchIndicator = document.createElement('div');
              searchIndicator.className = 'search-indicator';
              var bubble = aiDiv ? aiDiv.querySelector('.msg-bubble') : null;
              if (bubble) bubble.appendChild(searchIndicator);
            }
            if (searchIndicator) {
              searchIndicator.innerHTML = '\uD83D\uDD0D 正在检索：' + (data.query || '...');
            }
            // Update reference panel
            updateRefPanel([{ title: '搜索中...', content: data.query || '' }]);
            } else if (event === 'tool_result') {
              if (searchIndicator) {
                searchIndicator.remove();
                searchIndicator = null;
              }
              if (data && data.refs && data.refs.length) {
                updateRefPanel(data.refs);
              }
          } else if (event === 'chunk') {
            // Remove search indicator on first text chunk
            if (searchIndicator) {
              searchIndicator.remove();
              searchIndicator = null;
            }
            fullText += data.text || '';
            updateMessageUI(aiDiv, fullText);
          } else if (event === 'done') {
            if (searchIndicator) {
              searchIndicator.remove();
              searchIndicator = null;
            }
          } else if (event === 'error') {
            throw new Error(data.message || '服务端错误');
            }
          }
        }

        if (!receivedEvent) {
          throw new Error('服务端返回了空响应，请检查本地 Functions / API 代理是否正常启动。');
        }

        // Update history
        state.messages.push({ role: 'user', content: userInput });
        state.messages.push({ role: 'assistant', content: fullText });
        sessionStorage.setItem('chatHistory', JSON.stringify(state.messages));

    } catch(e) {
      if (searchIndicator) { searchIndicator.remove(); }
      updateMessageUI(aiDiv, '\u274C 错误: ' + e.message + '\n\n请检查API设置是否正确。');
    }

    state.isStreaming = false;
    if (sendBtn) sendBtn.disabled = false;
    input.focus();
  }

  // ─── Settings Modal ───────────────────────────────
  // ─── Fetch Models from API ────────────────────────
  async function fetchModels() {
    // Read directly from the visible DOM inputs so that unsaved (freshly typed)
    // values are picked up immediately — loadSettings() only reads localStorage
    // and would return empty strings when the modal has never been saved before.
    var apiKeyEl  = document.getElementById('api-key');
    var baseUrlEl = document.getElementById('base-url');
    var providerEl = document.getElementById('provider');
    var modelEl   = document.getElementById('model');

    var apiKey  = apiKeyEl  ? apiKeyEl.value.trim()  : '';
    var baseUrl = baseUrlEl ? baseUrlEl.value.trim()  : '';
    var provider = providerEl ? providerEl.value      : 'openai';
    var currentModel = modelEl ? modelEl.value        : '';

    // Fall back to persisted settings for any field still blank
    if (!apiKey || !baseUrl) {
      var saved = loadSettings();
      if (!apiKey)  apiKey  = saved.apiKey  || '';
      if (!baseUrl) baseUrl = saved.baseUrl || 'https://api.openai.com/v1';
      if (!provider) provider = saved.provider || 'openai';
      if (!currentModel) currentModel = saved.model || '';
    }

    if (!apiKey) { alert('请先填写 API Key 再获取模型列表'); return; }

    var btn = document.getElementById('fetch-models-btn');
    if (btn) { btn.textContent = '获取中...'; btn.disabled = true; }

    try {
      var models = [];
      if (provider === 'claude') {
        // Claude 没有公开 /models 端点，返回已知常用模型
        models = [
          'claude-opus-4-5-20250514',
          'claude-sonnet-4-5-20250514',
          'claude-haiku-4-5-20250514',
          'claude-3-5-sonnet-20241022',
          'claude-3-opus-20240229',
          'claude-3-haiku-20240307'
        ];
      } else {
        var res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'list_models',
            apiKey: apiKey,
            provider: provider,
            baseUrl: baseUrl
          })
        });
        if (!res.ok) {
          var err = '';
          try { err = await res.text(); } catch (_) {}
          throw new Error(err || ('HTTP ' + res.status));
        }
        var data = await res.json();
        var items = data.models || data.data || data || [];
        models = items
          .map(function(m) { return m.id || m.name || m; })
          .filter(function(id) {
            // 只展示 chat 类模型
            return typeof id === 'string' && (
              id.includes('gpt') || id.includes('claude') ||
              id.includes('deepseek') || id.includes('qwen') ||
              id.includes('llama') || id.includes('mixtral') ||
              id.includes('gemini') || id.includes('o1') || id.includes('o3')
            );
          })
          .sort();
      }

      // 渲染下拉框
      var container = document.getElementById('model-select-wrap');
      if (!container) return;
      var opts = models.map(function(id) {
        return '<option value="' + id + '"' + (id === currentModel ? ' selected' : '') + '>' + id + '</option>';
      }).join('');
      container.innerHTML =
        '<select id="model-select" class="settings-select">' + opts + '</select>';

      // 同步 select 值到隐藏 input（保存时读取）
      var sel = document.getElementById('model-select');
      var inp = document.getElementById('model');
      if (sel && inp) {
        inp.value = sel.value;
        sel.addEventListener('change', function() { inp.value = sel.value; });
      }
    } catch (e) {
      alert('获取模型列表失败：' + e.message + '\n\n请检查 API Key、Base URL，或稍后重试。');
    } finally {
      if (btn) { btn.textContent = '🔄 获取模型列表'; btn.disabled = false; }
    }
  }

  function showSettings() {
    var modal = document.getElementById('settings-modal');
    if (!modal) return;
    var s = loadSettings();
    var el;
    el = document.getElementById('provider'); if (el) el.value = s.provider;
    el = document.getElementById('api-key');  if (el) el.value = s.apiKey;
    el = document.getElementById('base-url'); if (el) el.value = s.baseUrl;
    el = document.getElementById('model');    if (el) el.value = s.model;
    // 重置模型选择区为纯文本输入（fetch之前）
    var container = document.getElementById('model-select-wrap');
    if (container) container.innerHTML = '';
    modal.style.display = 'flex';
  }

  function hideSettings() {
    var modal = document.getElementById('settings-modal');
    if (modal) modal.style.display = 'none';
  }

  // ─── Init (called by app.js when talk page is rendered) ────────
  function initTalk() {
    var sendBtn = document.getElementById('send-btn');
    if (sendBtn) sendBtn.addEventListener('click', sendMessage);

    var input = document.getElementById('chat-input');
    if (input) {
      input.addEventListener('keydown', function(e) {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
      });
      input.addEventListener('input', function() {
        this.style.height = 'auto';
        this.style.height = Math.min(this.scrollHeight, 120) + 'px';
      });
    }

    var settingsBtn = document.getElementById('settings-btn');
    if (settingsBtn) settingsBtn.addEventListener('click', showSettings);

    var modalClose = document.getElementById('modal-close');
    if (modalClose) modalClose.addEventListener('click', hideSettings);

    var settingsModal = document.getElementById('settings-modal');
    if (settingsModal) {
      settingsModal.addEventListener('click', function(e) {
        if (e.target === settingsModal) hideSettings();
      });
    }

    var saveBtn = document.getElementById('save-settings');
    if (saveBtn) {
      saveBtn.addEventListener('click', function() {
        saveSettings({
          provider: document.getElementById('provider').value,
          apiKey: document.getElementById('api-key').value,
          baseUrl: document.getElementById('base-url').value,
          model: document.getElementById('model').value
        });
        hideSettings();
      });
    }

    // Fetch Models button
    var fetchModelsBtn = document.getElementById('fetch-models-btn');
    if (fetchModelsBtn) fetchModelsBtn.addEventListener('click', fetchModels);

    var clearBtn = document.getElementById('clear-btn');
    if (clearBtn) {
      clearBtn.addEventListener('click', function() {
        if (!confirm('确定要清空对话历史吗？')) return;
        state.messages = [];
        sessionStorage.removeItem('chatHistory');
        var el = document.getElementById('chat-messages');
        if (el) {
          el.innerHTML = '<div class="chat-welcome"><div class="welcome-avatar">W</div><p>你好！我是基于巴菲特公开文献模拟的AI助手。</p><p class="welcome-hint">\u{1F4A1} 试试问：「什么是护城河？」</p></div>';
        }
        var ref = document.getElementById('ref-content');
        if (ref) ref.innerHTML = '<p class="ref-placeholder">发送问题后，相关原文会显示在这里。</p>';
      });
    }

    var refToggle = document.getElementById('ref-toggle');
    var refPanel = document.getElementById('reference-panel');
    if (refToggle && refPanel) {
      refToggle.addEventListener('click', function() {
        var collapsed = refPanel.style.display === 'none';
        refPanel.style.display = collapsed ? 'flex' : 'none';
        refToggle.textContent = collapsed ? '收起' : '展开';
      });
    }

    // Restore history
    try {
      var saved = sessionStorage.getItem('chatHistory');
      if (saved) {
        state.messages = JSON.parse(saved);
        for (var i = 0; i < state.messages.length; i++) {
          addMessageToUI(state.messages[i].role, state.messages[i].content);
        }
      }
    } catch (e) {}
  }

  // Expose globally for app.js
  window.initTalk = initTalk;
})();
