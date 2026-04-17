// functions/api/chat.js
// Cloudflare Pages Function - Agentic Chat Handler with Buffett Skill
// Runs on Cloudflare Edge, handles the full Agentic Loop
//
// Architecture:
//   Browser -> POST /api/chat { apiKey, provider, baseUrl, model, messages }
//     -> Load Skill (system prompt) + Define tools
//     -> Agentic Loop: AI decides when to call search_buffett_knowledge
//     -> BM25 search against server-search-index.json
//     -> Stream final answer back as SSE

const MAX_TOOL_ROUNDS = 20;
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 1000;

// ─── Search Index (cached in worker memory) ─────────────────────
async function loadSearchIndex(requestUrl) {
  if (globalThis._searchIndex) return globalThis._searchIndex;
  try {
    const url = new URL('/assets/data/server-search-index.json', requestUrl);
    const res = await fetch(url.toString());
    if (!res.ok) throw new Error('Failed to load search index: ' + res.status);
    globalThis._searchIndex = await res.json();
    return globalThis._searchIndex;
  } catch (e) {
    console.error('Search index load error:', e);
    return [];
  }
}

// ─── Load Skill (cached in worker memory) ────────────────────────
async function loadSkill(requestUrl) {
  if (globalThis._skillPrompt) return globalThis._skillPrompt;
  try {
    const url = new URL('/assets/data/buffett-skill.json', requestUrl);
    const res = await fetch(url.toString());
    if (!res.ok) throw new Error('Failed to load skill: ' + res.status);
    const data = await res.json();
    globalThis._skillPrompt = data.content;
    return globalThis._skillPrompt;
  } catch (e) {
    console.error('Skill load error:', e);
    return getFallbackSkill();
  }
}

function getFallbackSkill() {
  return '# 沃伦·巴菲特 · 思维操作系统\n\n你是沃伦·巴菲特，伯克希尔·哈撒韦公司董事长。用第一人称"我"表达。引用出处时写明年份。诚实说明不确定的领域。每次回答末尾加免责声明。用中文回答。\n\n当问及具体信件内容、年份、历史案例时，先调用 search_buffett_knowledge 工具检索。';
}

// ─── BM25-style keyword search ───────────────────────────────────
function searchKnowledge(index, query, topK) {
  topK = topK || 5;
  if (!index || index.length === 0) {
    return {
      context: '未找到相关内容。知识库加载中，请稍后再试。',
      refs: []
    };
  }

  var terms = query.toLowerCase()
    .replace(/[，。？！、；：""''（）《》\s]+/g, ' ')
    .split(/\s+/)
    .filter(function(t) { return t.length > 1; });

  if (terms.length === 0) {
    return {
      context: '搜索关键词为空。',
      refs: []
    };
  }

  var scored = [];
  for (var i = 0; i < index.length; i++) {
    var doc = index[i];
    var text = ((doc.title || '') + ' ' + (doc.content || '')).toLowerCase();
    var score = 0;

    for (var j = 0; j < terms.length; j++) {
      var term = terms[j];
      var escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      var regex = new RegExp(escaped, 'g');
      var matches = (text.match(regex) || []).length;
      var titleText = (doc.title || '').toLowerCase();
      var titleBoost = titleText.includes(term) ? 3 : 1;
      var yearBoost = doc.year && term.match(/^\d{4}$/) && String(doc.year) === term ? 5 : 1;
      score += matches * titleBoost * yearBoost;
    }

    if (doc.category === 'concept') {
      for (var k = 0; k < terms.length; k++) {
        if ((doc.slug || '').includes(terms[k])) { score *= 2; break; }
      }
    }

    if (score > 0) scored.push({ doc: doc, score: score });
  }

  scored.sort(function(a, b) { return b.score - a.score; });
  var results = scored.slice(0, topK);

  if (results.length === 0) {
    return {
      context: '未找到与"' + query + '"相关的内容。',
      refs: []
    };
  }

  var nl = '\n';
  var refs = results.map(function(item) {
    var doc = item.doc;
    var route = '';
    if (doc.category === 'shareholder-letter') route = '/shareholder-letters/' + doc.slug;
    else if (doc.category === 'partnership-letter') route = '/partnership-letters/' + doc.slug;
    else if (doc.category === 'special-letter') route = '/special-letters/' + doc.slug;
    else if (doc.category === 'concept') route = '/concepts/' + doc.slug;
    else if (doc.category === 'company') route = '/companies/' + doc.slug;
    else if (doc.category === 'person') route = '/people/' + doc.slug;

    return {
      title: doc.title || (doc.slug || '未命名来源'),
      content: (doc.content || '').slice(0, 220),
      route: route,
      query: query,
      category: doc.category,
      year: doc.year,
      score: item.score
    };
  });

  var context = results.map(function(item) {
    var doc = item.doc;
    var route = '';
    var src;
    if (doc.category === 'shareholder-letter') { route = '/shareholder-letters/' + doc.slug; }
    else if (doc.category === 'partnership-letter') { route = '/partnership-letters/' + doc.slug; }
    else if (doc.category === 'special-letter') { route = '/special-letters/' + doc.slug; }
    else if (doc.category === 'concept') { route = '/concepts/' + doc.slug; }
    else if (doc.category === 'company') { route = '/companies/' + doc.slug; }
    else if (doc.category === 'person') { route = '/people/' + doc.slug; }

    if (doc.year && doc.category === 'shareholder-letter') {
      src = doc.year + '年致股东信';
    } else if (doc.year && doc.category === 'partnership-letter') {
      src = doc.year + '年致合伙人信';
    } else if (doc.category === 'concept') {
      src = '投资概念：' + doc.title;
    } else if (doc.category === 'company') {
      src = '公司分析：' + doc.title;
    } else if (doc.category === 'person') {
      src = '人物：' + doc.title;
    } else {
      src = doc.title;
    }
    var routeHint = route ? '（路由：' + route + '）' : '';
    return '### 来源：' + src + routeHint + nl + (doc.content || '').slice(0, 600);
  }).join(nl + nl + '---' + nl + nl);

  return {
    context: context,
    refs: refs
  };
}

// ─── Tool Definitions ────────────────────────────────────────────
var TOOL_DESC = '搜索巴菲特公开信件和投资概念知识库。当需要引用具体信件内容、年份、历史案例、投资概念原文时调用。';
var TOOL_PARAM_DESC = '搜索关键词，如"护城河 1986"或"可口可乐 买入原因"或"市场先生 格雷厄姆"';

function getOpenAITools() {
  return [{
    type: 'function',
    function: {
      name: 'search_buffett_knowledge',
      description: TOOL_DESC,
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: TOOL_PARAM_DESC }
        },
        required: ['query']
      }
    }
  }];
}

function getClaudeTools() {
  return [{
    name: 'search_buffett_knowledge',
    description: TOOL_DESC,
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: TOOL_PARAM_DESC }
      },
      required: ['query']
    }
  }];
}

// ─── SSE Helpers ─────────────────────────────────────────────────
function sseEvent(event, data) {
  return 'event: ' + event + '\ndata: ' + JSON.stringify(data) + '\n\n';
}

async function emitChunkedText(write, text, chunkSize) {
  if (!text) return;
  var size = chunkSize || 28;
  for (var i = 0; i < text.length; i += size) {
    await write(sseEvent('chunk', { text: text.slice(i, i + size) }));
  }
}

var CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};

function getModelListCandidates(baseUrl) {
  var base = (baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
  var candidates = [base];
  if (!/\/v\d+$/i.test(base)) candidates.push(base + '/v1');
  return candidates.filter(function(candidate, index, arr) {
    return arr.indexOf(candidate) === index;
  });
}

async function fetchModelList(apiKey, baseUrl) {
  var candidates = getModelListCandidates(baseUrl);
  var errors = [];

  for (var i = 0; i < candidates.length; i++) {
    var endpoint = candidates[i] + '/models';
    try {
      var res = await fetch(endpoint, {
        method: 'GET',
        headers: { 'Authorization': 'Bearer ' + apiKey }
      });
      if (!res.ok) {
        var errText = '';
        try { errText = await res.text(); } catch (_) {}
        errors.push(endpoint + ' -> HTTP ' + res.status + (errText ? ': ' + errText.slice(0, 120) : ''));
        continue;
      }

      var data = await res.json();
      var items = data.data || data.models || data || [];
      var models = items.map(function(item) {
        return item && (item.id || item.name || item);
      }).filter(function(item) {
        return typeof item === 'string' && item;
      });

      if (models.length) return models;
      errors.push(endpoint + ' -> empty model list');
    } catch (e) {
      errors.push(endpoint + ' -> ' + (e && e.message ? e.message : 'request failed'));
    }
  }

  throw new Error(errors.join(' | ') || '模型列表获取失败');
}

// ─── Main Handler ────────────────────────────────────────────────
export async function onRequestPost(context) {
  var request = context.request;
  var body;
  try {
    body = await request.json();
  } catch (e) {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400,
      headers: Object.assign({ 'Content-Type': 'application/json' }, CORS_HEADERS)
    });
  }

  var apiKey = body.apiKey;
  var action = body.action || '';
  var provider = body.provider || 'openai';
  var baseUrl = body.baseUrl;
  var model = body.model;
  var messages = body.messages || [];

  if (!apiKey) {
    return new Response(JSON.stringify({ error: '请提供 API Key' }), {
      status: 400,
      headers: Object.assign({ 'Content-Type': 'application/json' }, CORS_HEADERS)
    });
  }

  // JSON mode: model list proxy (used by settings panel fetchModels)
  if (action === 'list_models') {
    if (provider === 'claude') {
      return new Response(JSON.stringify({
        models: [
          'claude-opus-4-5-20250514',
          'claude-sonnet-4-5-20250514',
          'claude-haiku-4-5-20250514',
          'claude-3-5-sonnet-20241022',
          'claude-3-opus-20240229',
          'claude-3-haiku-20240307'
        ]
      }), {
        status: 200,
        headers: Object.assign({ 'Content-Type': 'application/json' }, CORS_HEADERS)
      });
    }

    try {
      var models = await fetchModelList(apiKey, baseUrl || 'https://api.openai.com/v1');
      return new Response(JSON.stringify({ models: models }), {
        status: 200,
        headers: Object.assign({ 'Content-Type': 'application/json' }, CORS_HEADERS)
      });
    } catch (e) {
      return new Response(JSON.stringify({
        error: '获取模型列表失败',
        details: (e && e.message) ? e.message : 'unknown error'
      }), {
        status: 502,
        headers: Object.assign({ 'Content-Type': 'application/json' }, CORS_HEADERS)
      });
    }
  }

  // Load skill and search index concurrently
  var skillPrompt, searchIndex;
  try {
    var results = await Promise.all([
      loadSkill(request.url),
      loadSearchIndex(request.url)
    ]);
    skillPrompt = results[0];
    searchIndex = results[1];
  } catch (e) {
    skillPrompt = getFallbackSkill();
    searchIndex = [];
  }

  // SSE stream setup
  var transformStream = new TransformStream();
  var writer = transformStream.writable.getWriter();
  var encoder = new TextEncoder();

  var write = function(text) { return writer.write(encoder.encode(text)); };

  // Run Agentic Loop in background
  var agenticLoop = async function() {
    try {
      if (provider === 'claude') {
        await runClaudeLoop(skillPrompt, messages, searchIndex, apiKey, baseUrl, model, write);
      } else {
        await runOpenAILoop(skillPrompt, messages, searchIndex, apiKey, baseUrl, model, write);
      }
    } catch (e) {
      try { await write(sseEvent('error', { message: e.message || 'Unknown error' })); } catch(ex) {}
    } finally {
      try { await writer.close(); } catch(ex) {}
    }
  };

  context.waitUntil(agenticLoop());

  return new Response(transformStream.readable, {
    headers: Object.assign({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    }, CORS_HEADERS)
  });
}

async function streamOpenAICompatibleResponse(base, headers, model, messages, write) {
  // Ensure base ends with /v1 (or /vN) so endpoints are reachable
  base = base.replace(/\/+$/, '');
  if (!/\/v\d+$/i.test(base)) base = base + '/v1';
  var streamRes = await fetch(base + '/chat/completions', {
    method: 'POST',
    headers: headers,
    body: JSON.stringify({
      model: model,
      messages: messages,
      stream: true
    })
  });

  if (!streamRes.ok) {
    var fallbackRes = await fetch(base + '/chat/completions', {
      method: 'POST',
      headers: headers,
      body: JSON.stringify({
        model: model,
        messages: messages,
        stream: false
      })
    });

    if (!fallbackRes.ok) {
      var fallbackErr = await fallbackRes.text();
      await write(sseEvent('error', { message: 'API Error ' + fallbackRes.status + ': ' + fallbackErr.substring(0, 300) }));
      return false;
    }

    var fallbackData = await fallbackRes.json();
    var fallbackChoice = fallbackData.choices && fallbackData.choices[0];
    var fallbackMessage = fallbackChoice && fallbackChoice.message;
    var fallbackContent = (fallbackMessage && fallbackMessage.content) || '';
    if (fallbackContent) await emitChunkedText(write, fallbackContent);
    await write(sseEvent('done', {}));
    return true;
  }

  var reader = streamRes.body.getReader();
  var decoder = new TextDecoder();
  var buf = '';

  while (true) {
    var chunk = await reader.read();
    if (chunk.done) break;
    buf += decoder.decode(chunk.value, { stream: true });
    var lines = buf.split('\n');
    buf = lines.pop() || '';
    for (var li = 0; li < lines.length; li++) {
      var line = lines[li].trim();
      if (!line || !line.startsWith('data: ')) continue;
      var jsonStr = line.substring(6);
      if (jsonStr === '[DONE]') continue;
      try {
        var parsed = JSON.parse(jsonStr);
        if (parsed.choices && parsed.choices[0] && parsed.choices[0].delta && parsed.choices[0].delta.content) {
          await write(sseEvent('chunk', { text: parsed.choices[0].delta.content }));
        }
      } catch(e) {}
    }
  }

  await write(sseEvent('done', {}));
  return true;
}

// ─── OpenAI Agentic Loop ────────────────────────────────────────
async function runOpenAILoop(skillPrompt, messages, searchIndex, apiKey, baseUrl, model, write) {
  var base = (baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
  // Auto-append /v1 if missing (matches fetchModelList normalization)
  if (!/\/v\d+$/i.test(base)) base = base + '/v1';
  var headers = {
    'Authorization': 'Bearer ' + apiKey,
    'Content-Type': 'application/json'
  };
  var tools = getOpenAITools();
  var citationPrompt = '重要：当你引用检索结果时，请用Markdown链接标注来源。检索结果中会标注文章路由（如 /shareholder-letters/1984），你必须用这些路由生成链接。\n'
    + '格式：[来源名称](路由)，例如：[1984年致股东信](/shareholder-letters/1984)、[护城河](/concepts/moat)\n'
    + '在引用事实的句末插入链接，如：巴菲特在1984年指出... ([1984年致股东信](/shareholder-letters/1984))\n'
    + '若有多处事实来自不同来源，分别标注。不要使用【】括号格式。';
  var currentMessages = [
    { role: 'system', content: skillPrompt },
    { role: 'system', content: citationPrompt }
  ].concat(messages);
  var allRefs = [];
  var toolRound = 0;

  while (toolRound < MAX_TOOL_ROUNDS) {
    var res = null;
    var data = null;
    for (var retry = 0; retry <= MAX_RETRIES; retry++) {
      try {
        res = await fetch(base + '/chat/completions', {
          method: 'POST',
          headers: headers,
          body: JSON.stringify({
            model: model || 'gpt-4o',
            messages: currentMessages,
            tools: tools,
            tool_choice: 'auto',
            stream: false
          })
        });
        if (res.ok) {
          data = await res.json();
          break;
        }
        // Retryable server errors (429, 500, 502, 503, 529)
        var isRetryable = [429, 500, 502, 503, 529].indexOf(res.status) >= 0;
        if (!isRetryable || retry >= MAX_RETRIES) {
          var streamed = await streamOpenAICompatibleResponse(base, headers, model || 'gpt-4o', currentMessages, write);
          if (streamed) return;
          var errText = await res.text();
          await write(sseEvent('error', { message: 'API Error ' + res.status + ': ' + errText.substring(0, 300) }));
          return;
        }
        await new Promise(function(r) { setTimeout(r, RETRY_DELAY_MS * (retry + 1)); });
      } catch (fetchErr) {
        if (retry >= MAX_RETRIES) {
          await write(sseEvent('error', { message: '网络错误: ' + (fetchErr.message || 'fetch failed') }));
          return;
        }
        await new Promise(function(r) { setTimeout(r, RETRY_DELAY_MS * (retry + 1)); });
      }
    }
    if (!data) { await write(sseEvent('error', { message: 'API 响应异常' })); return; }
    var choice = data.choices && data.choices[0];
    if (!choice) {
      await write(sseEvent('error', { message: '无效的API响应' }));
      return;
    }

    var msg = choice.message;
    if (msg && msg.tool_calls && msg.tool_calls.length > 0) {
      currentMessages.push(msg);
      for (var i = 0; i < msg.tool_calls.length; i++) {
        var tc = msg.tool_calls[i];
        var args;
        try { args = JSON.parse(tc.function.arguments); } catch(e) { args = { query: tc.function.arguments }; }
        var query = args.query || '';
        await write(sseEvent('tool_call', { query: query }));
        var result = searchKnowledge(searchIndex, query);
        if (result.refs && result.refs.length) {
          for (var ri = 0; ri < result.refs.length; ri++) allRefs.push(result.refs[ri]);
        }
        await write(sseEvent('tool_result', { query: query, refs: allRefs }));
        currentMessages.push({ role: 'tool', tool_call_id: tc.id, content: result.context || '' });
      }
      toolRound++;
      continue;
    }

    // Final answer - stream it
    if ((msg && msg.content) && typeof msg.content === 'string') {
      // Got a non-streamed final answer, emit as chunks then try re-emitting refs
      await emitChunkedText(write, msg.content);
      if (allRefs.length) await write(sseEvent('tool_result', { refs: allRefs }));
      await write(sseEvent('done', {}));
      return;
    }

    // Stream the final answer
    await streamOpenAICompatibleResponse(base, headers, model || 'gpt-4o', currentMessages, write);
    if (allRefs.length) await write(sseEvent('tool_result', { refs: allRefs }));
    return;
  }

  // Safety: if we somehow exhaust rounds, generate final answer based on collected context
  await write(sseEvent('tool_call', { query: '基于已收集信息生成回答...' }));
  // Remove tools to force a text response
  var finalMessages = currentMessages.concat([{
    role: 'system',
    content: '你已收集了足够的信息。请现在基于已有检索结果生成完整的回答，不要再调用工具。'
  }]);
  var finalRes = await fetch(base + '/chat/completions', {
    method: 'POST',
    headers: headers,
    body: JSON.stringify({ model: model || 'gpt-4o', messages: finalMessages, stream: true })
  });
  if (finalRes.ok) {
    var rdr = finalRes.body.getReader();
    var dec2 = new TextDecoder();
    var fbuf = '';
    while (true) {
      var fchunk = await rdr.read();
      if (fchunk.done) break;
      fbuf += dec2.decode(fchunk.value, { stream: true });
      var flines = fbuf.split('\n');
      fbuf = flines.pop() || '';
      for (var fli = 0; fli < flines.length; fli++) {
        var fline = flines[fli].trim();
        if (!fline || !fline.startsWith('data: ')) continue;
        var fjson = fline.substring(6);
        if (fjson === '[DONE]') continue;
        try {
          var fp = JSON.parse(fjson);
          if (fp.choices && fp.choices[0] && fp.choices[0].delta && fp.choices[0].delta.content) {
            await write(sseEvent('chunk', { text: fp.choices[0].delta.content }));
          }
        } catch(e) {}
      }
    }
  }
  if (allRefs.length) await write(sseEvent('tool_result', { refs: allRefs }));
  await write(sseEvent('done', {}));
}

// ─── Claude Agentic Loop ────────────────────────────────────────
async function runClaudeLoop(skillPrompt, messages, searchIndex, apiKey, baseUrl, model, write) {
  var base = (baseUrl || 'https://api.anthropic.com').replace(/\/+$/, '');
  var headers = {
    'Content-Type': 'application/json',
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01'
  };
  var tools = getClaudeTools();
  var citationPrompt = '重要：当你引用检索结果时，请用Markdown链接标注来源。检索结果中会标注文章路由（如 /shareholder-letters/1984），你必须用这些路由生成链接。\n'
    + '格式：[来源名称](路由)，例如：[1984年致股东信](/shareholder-letters/1984)、[护城河](/concepts/moat)\n'
    + '在引用事实的句末插入链接，如：巴菲特在1984年指出... ([1984年致股东信](/shareholder-letters/1984))\n'
    + '若有多处事实来自不同来源，分别标注。不要使用【】括号格式。';
  var claudeMessages = [{
    role: 'user',
    content: citationPrompt
  }].concat(messages.filter(function(m) { return m.role !== 'system'; }));
  var allRefs = [];
  var toolRound = 0;

  while (toolRound < MAX_TOOL_ROUNDS) {
    var res = null;
    var data = null;
    for (var retry = 0; retry <= MAX_RETRIES; retry++) {
      try {
        res = await fetch(base + '/v1/messages', {
          method: 'POST',
          headers: headers,
          body: JSON.stringify({
            model: model || 'claude-sonnet-4-20250514',
            max_tokens: 4096,
            system: skillPrompt,
            messages: claudeMessages,
            tools: tools,
            stream: false
          })
        });
        if (res.ok) {
          data = await res.json();
          break;
        }
        var isRetryable = [429, 500, 502, 503, 529].indexOf(res.status) >= 0;
        if (!isRetryable || retry >= MAX_RETRIES) {
          var errText = await res.text();
          await write(sseEvent('error', { message: 'Claude API Error ' + res.status + ': ' + errText.substring(0, 300) }));
          return;
        }
        await new Promise(function(r) { setTimeout(r, RETRY_DELAY_MS * (retry + 1)); });
      } catch (fetchErr) {
        if (retry >= MAX_RETRIES) {
          await write(sseEvent('error', { message: '网络错误: ' + (fetchErr.message || 'fetch failed') }));
          return;
        }
        await new Promise(function(r) { setTimeout(r, RETRY_DELAY_MS * (retry + 1)); });
      }
    }
    if (!data) { await write(sseEvent('error', { message: 'API 响应异常' })); return; }

    var toolUseBlocks = (data.content || []).filter(function(b) { return b.type === 'tool_use'; });

    if (toolUseBlocks.length > 0 && data.stop_reason === 'tool_use') {
      claudeMessages.push({ role: 'assistant', content: data.content });
      var toolResults = [];
      for (var i = 0; i < toolUseBlocks.length; i++) {
        var block = toolUseBlocks[i];
        var query = (block.input && block.input.query) || '';
        await write(sseEvent('tool_call', { query: query }));
        var result = searchKnowledge(searchIndex, query);
        if (result.refs && result.refs.length) {
          for (var ri = 0; ri < result.refs.length; ri++) allRefs.push(result.refs[ri]);
        }
        await write(sseEvent('tool_result', { query: query, refs: allRefs }));
        toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: result.context || '' });
      }
      claudeMessages.push({ role: 'user', content: toolResults });
      toolRound++;
      continue;
    }

    // Final answer - stream it
    var streamRes = await fetch(base + '/v1/messages', {
      method: 'POST',
      headers: headers,
      body: JSON.stringify({
        model: model || 'claude-sonnet-4-20250514',
        max_tokens: 4096,
        system: skillPrompt,
        messages: claudeMessages,
        stream: true
      })
    });

    if (!streamRes.ok) {
      var textBlocks = (data.content || []).filter(function(b) { return b.type === 'text'; });
      var fullText = textBlocks.map(function(b) { return b.text; }).join('');
      if (fullText) await emitChunkedText(write, fullText);
      await write(sseEvent('done', {}));
      return;
    }

    var reader = streamRes.body.getReader();
    var decoder = new TextDecoder();
    var buf = '';

    while (true) {
      var chunk = await reader.read();
      if (chunk.done) break;
      buf += decoder.decode(chunk.value, { stream: true });
      var lines = buf.split('\n');
      buf = lines.pop() || '';
      for (var li = 0; li < lines.length; li++) {
        var line = lines[li].trim();
        if (!line || !line.startsWith('data: ')) continue;
        var jsonStr = line.substring(6);
        try {
          var parsed = JSON.parse(jsonStr);
          if (parsed.type === 'content_block_delta' && parsed.delta && parsed.delta.text) {
            await write(sseEvent('chunk', { text: parsed.delta.text }));
          }
        } catch(e) {}
      }
    }
    await write(sseEvent('done', {}));
    return;
  }

  // Safety: exhausted rounds, force a final text answer without tools
  await write(sseEvent('tool_call', { query: '基于已收集信息生成回答...' }));
  var finalClaudeMessages = claudeMessages.concat([{
    role: 'user',
    content: '你已收集了足够的信息。请现在基于已有检索结果生成完整的回答，不要再调用工具。'
  }]);
  var finalRes = await fetch(base + '/v1/messages', {
    method: 'POST',
    headers: headers,
    body: JSON.stringify({
      model: model || 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      system: skillPrompt,
      messages: finalClaudeMessages,
      stream: true
    })
  });
  if (finalRes.ok) {
    var rdr = finalRes.body.getReader();
    var dec2 = new TextDecoder();
    var fbuf = '';
    while (true) {
      var fchunk = await rdr.read();
      if (fchunk.done) break;
      fbuf += dec2.decode(fchunk.value, { stream: true });
      var flines = fbuf.split('\n');
      fbuf = flines.pop() || '';
      for (var fli = 0; fli < flines.length; fli++) {
        var fline = flines[fli].trim();
        if (!fline || !fline.startsWith('data: ')) continue;
        var fjson = fline.substring(6);
        try {
          var fp = JSON.parse(fjson);
          if (fp.type === 'content_block_delta' && fp.delta && fp.delta.text) {
            await write(sseEvent('chunk', { text: fp.delta.text }));
          }
        } catch(e) {}
      }
    }
  }
  if (allRefs.length) await write(sseEvent('tool_result', { refs: allRefs }));
  await write(sseEvent('done', {}));
}

// Handle CORS preflight
export async function onRequestOptions() {
  return new Response(null, {
    headers: Object.assign({
      'Access-Control-Max-Age': '86400'
    }, CORS_HEADERS)
  });
}
