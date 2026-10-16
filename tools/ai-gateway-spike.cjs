'use strict';

const SmartApi = require('../api-client.js');

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

function parseBase(value) {
  const url = new URL(value);
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.username || url.password || url.search || url.hash || (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback))) {
    throw new Error('Base URL must use HTTPS (HTTP is allowed only for loopback) and have no credentials, query, or fragment');
  }
  return url;
}

async function main() {
  if (process.env.SMARTUSTAZ_SPIKE_ALLOW_CHARGED_REQUESTS !== 'YES') {
    throw new Error('Set SMARTUSTAZ_SPIKE_ALLOW_CHARGED_REQUESTS=YES only after accepting provider usage charges');
  }

  const base = parseBase(required('SMARTUSTAZ_SPIKE_BASE'));
  const config = {
    base: base.toString().replace(/\/+$/, ''),
    key: required('SMARTUSTAZ_SPIKE_KEY'),
    model: required('SMARTUSTAZ_SPIKE_MODEL'),
    stream: process.env.SMARTUSTAZ_SPIKE_STREAM !== 'false'
  };
  const timeoutMs = Math.min(Math.max(Number(process.env.SMARTUSTAZ_SPIKE_TIMEOUT_MS) || 145000, 1000), 145000);
  const idleMs = Math.min(140000, timeoutMs - 1000);
  const parts = [
    {
      name: 'plan',
      maxTokens: 2600,
      prompt: 'На русском языке составь компактный JSON-план 90-минутного занятия для колледжа на тему «Поступление товаров от поставщика». Верни объект с topic, specialty, module, lessonType, methods, goals (3 строки), criteria (3 строки), stages (4 этапа с полями stage, teacher, students, resources) и homework. Время этапов суммарно 90 минут.'
    },
    {
      name: 'notes',
      maxTokens: 3500,
      prompt: 'На русском языке подготовь компактный JSON-конспект для занятия колледжа по теме «Поступление товаров от поставщика». Верни объект с theory (2 раздела: heading, content, example), case (title, text), mistakes (1 ошибка с исправлением), tasks (3 задания A/B/C с ответом) и quiz (2 вопроса с ответом). Значения должны быть содержательными, но краткими.'
    },
    {
      name: 'slides',
      maxTokens: 2200,
      prompt: 'На русском языке составь ровно 6 коротких слайдов для занятия колледжа по теме «Поступление товаров от поставщика». Верни JSON-массив объектов с title, bullets (2-3 тезиса), example и notes. Последний слайд — практика.'
    }
  ];
  const results = {};

  async function runPart(part) {
    const started = Date.now();
    let firstTextMs = null;
    let chars = 0;
    try {
      const text = await SmartApi.request(config, part.prompt, {
        maxTokens: part.maxTokens,
        idleMs,
        totalMs: timeoutMs,
        onText: update => {
          chars = update.text.length;
          if (firstTextMs === null && chars > 0) firstTextMs = Date.now() - started;
        }
      });
      results[part.name] = { ok: true, elapsedMs: Date.now() - started, firstTextMs, chars: text.length };
    } catch (error) {
      results[part.name] = {
        ok: false,
        elapsedMs: Date.now() - started,
        firstTextMs,
        chars,
        code: error.code || 'unknown',
        status: error.status || null
      };
    }
  }

  await runPart(parts[0]);
  if (results.plan.ok) await Promise.all(parts.slice(1).map(runPart));
  else {
    results.notes = { skipped: true, reason: 'plan_failed' };
    results.slides = { skipped: true, reason: 'plan_failed' };
  }

  process.stdout.write(JSON.stringify({
    endpointHost: base.host,
    model: config.model,
    stream: config.stream,
    perRequestTimeoutMs: timeoutMs,
    results
  }, null, 2) + '\n');

  if (Object.values(results).some(result => result.ok === false)) process.exitCode = 1;
}

main().catch(error => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
