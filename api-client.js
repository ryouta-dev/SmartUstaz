/* OpenAI-compatible transport: JSON and incremental SSE. No provider SDK. */
(function (root) {
  'use strict';
  function fail(code, status) { var e = new Error(code); e.code = code; if (status) e.status = status; return e; }
  function textPart(value) {
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) return value.map(function (p) { return p && p.type === 'text' ? p.text || '' : ''; }).join('');
    return '';
  }
  async function request(config, prompt, opts) {
    opts = opts || {};
    var ctl = new AbortController(), timeoutCode = '', idleTimer, totalTimer, reader;
    var idleMs = opts.idleMs == null ? 300000 : opts.idleMs;
    var totalMs = opts.totalMs == null ? 1800000 : opts.totalMs;
    function resetIdle() { clearTimeout(idleTimer); idleTimer = setTimeout(function () { timeoutCode = 'timeout'; ctl.abort(); }, idleMs); }
    function abort() { ctl.abort(); }
    if (opts.signal && opts.signal.aborted) throw fail('cancelled');
    if (opts.signal) opts.signal.addEventListener('abort', abort, { once: true });
    resetIdle();
    totalTimer = setTimeout(function () { timeoutCode = 'total_timeout'; ctl.abort(); }, totalMs);
    var content = '', sawFinish = false, sawDone = false;
    function notify(reasoning) { if (opts.onActivity) opts.onActivity({ chars: content.length, thinking: !!reasoning }); }
    function append(part) { if (part) { content += part; if (content.length > 1000000) throw fail('response_too_large'); if (opts.onText) opts.onText({ text: content }); } }
    function consume(data) {
      if (data.trim() === '[DONE]') { sawDone = true; return; }
      var event; try { event = JSON.parse(data); } catch (_) { throw fail('invalid_json'); }
      if (event.error) throw fail('upstream_error');
      var choice = event.choices && event.choices[0];
      if (!choice) return; // Usage-only event.
      if (choice.finish_reason === 'length') throw fail('truncated');
      if (choice.finish_reason === 'content_filter') throw fail('refused');
      var delta = choice.delta || choice.message || {};
      if (delta.refusal) throw fail('refused');
      append(textPart(delta.content));
      // Signal activity only; do not expose the model's private reasoning text.
      notify(delta.reasoning_content || delta.reasoning);
      if (choice.finish_reason) sawFinish = true;
    }
    try {
      var body = { model: config.model, stream: config.stream !== false, messages: [{ role: 'user', content: prompt }] };
      if (opts.maxTokens) body.max_tokens = opts.maxTokens;
      var res = await (opts.fetch || fetch)(config.base.replace(/\/+$/, '') + '/chat/completions', {
        method: 'POST', redirect: 'error', credentials: 'omit', referrerPolicy: 'no-referrer',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + config.key },
        body: JSON.stringify(body), signal: ctl.signal
      });
      resetIdle();
      if (!res.ok) throw fail(res.status === 401 || res.status === 403 ? 'session_expired' : res.status === 429 ? 'rate_limited' : res.status === 413 ? 'prompt_too_large' : 'http', res.status);
      var isSse = (res.headers.get('content-type') || '').toLowerCase().includes('text/event-stream');
      if (!isSse) {
        var json = await res.json();
        consume(JSON.stringify(json));
      } else {
        if (!res.body || !res.body.getReader) throw fail('stream_unavailable');
        reader = res.body.getReader();
        var decoder = new TextDecoder(), buffer = '', eventLines = [];
        function line(value) {
          if (value === '') { if (eventLines.length) { consume(eventLines.join('\n')); eventLines = []; } }
          else if (value.startsWith('data:')) eventLines.push(value.slice(5).replace(/^ /, ''));
        }
        function drain(final) {
          var match;
          while ((match = buffer.match(/\r\n|\r|\n/))) {
            // A CR split from its LF must remain buffered until the next chunk.
            if (!final && match[0] === '\r' && match.index === buffer.length - 1) break;
            line(buffer.slice(0, match.index)); buffer = buffer.slice(match.index + match[0].length);
          }
          if (final) { if (buffer) line(buffer); buffer = ''; line(''); }
        }
        while (!sawDone) {
          var chunk = await reader.read();
          if (chunk.done) { buffer += decoder.decode(); drain(true); break; }
          resetIdle(); notify(false);
          buffer += decoder.decode(chunk.value, { stream: true });
          if (buffer.length > 2000000) throw fail('response_too_large');
          drain(false);
        }
        if (!sawDone && !sawFinish) throw fail('stream_interrupted');
      }
      if (!content.trim()) throw fail('invalid_json');
      return content;
    } catch (e) {
      if (timeoutCode) throw fail(timeoutCode);
      if (ctl.signal.aborted) throw fail('cancelled');
      if (e && e.code) throw e;
      throw fail(e instanceof SyntaxError ? 'invalid_json' : 'network');
    } finally {
      clearTimeout(idleTimer); clearTimeout(totalTimer);
      if (opts.signal) opts.signal.removeEventListener('abort', abort);
      if (reader) { try { await reader.cancel(); } catch (_) {} reader.releaseLock(); }
    }
  }
  var api = { request: request };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SmartApi = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
