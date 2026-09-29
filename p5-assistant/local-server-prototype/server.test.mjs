import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import { test } from 'node:test';
import vm from 'node:vm';

const PORT = 18787;
const BASE_URL = `http://127.0.0.1:${PORT}`;

async function stopChild(child) {
  if (child.exitCode !== null || child.signalCode) return;
  const exited = new Promise((resolve) => child.once('exit', resolve));
  child.kill();
  await exited;
}

test('prototype page script parses and renders a chat response', async () => {
  const child = spawn(process.execPath, ['server.mjs'], {
    cwd: new URL('.', import.meta.url),
    env: {
      ...process.env,
      PROTOTYPE_PORT: String(PORT),
      UNIMATE_PROTOTYPE_MOCK: '1'
    },
    stdio: 'ignore'
  });

  try {
    let response;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      try {
        response = await fetch(`${BASE_URL}/`);
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }

    assert.ok(response, 'prototype server did not start');
    assert.equal(response.status, 200);
    const html = await response.text();
    const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
    assert.ok(script, 'prototype page did not contain an inline script');
    assert.doesNotThrow(() => new vm.Script(script));

    const appended = [];
    let submit;
    const elements = {
      '#chat': {
        append(element) { appended.push(element); },
        scrollTop: 0,
        scrollHeight: 0
      },
      '#form': {
        addEventListener(type, listener) {
          if (type === 'submit') submit = listener;
        }
      },
      '#input': { value: '', focus() {} },
      '#send': { disabled: false }
    };
    const context = vm.createContext({
      document: {
        querySelector(selector) { return elements[selector]; },
        createElement() { return { className: '', textContent: '' }; }
      },
      fetch(path, options) { return fetch(new URL(path, BASE_URL), options); },
      JSON,
      Error
    });
    new vm.Script(script).runInContext(context);
    assert.equal(typeof submit, 'function');

    elements['#input'].value = '你好';
    await submit({ preventDefault() {} });
    assert.equal(appended.length, 2);
    assert.equal(appended[0].className, 'row user');
    assert.equal(appended[1].className, 'row uni');
    assert.ok(appended[1].textContent);
    assert.equal(elements['#send'].disabled, false);
  } finally {
    await stopChild(child);
  }
});

test('chat reserves enough tokens for an answer after model reasoning', async () => {
  const gatewayPort = 18788;
  const upstreamPort = 18789;
  let upstreamRequest;
  const upstream = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    upstreamRequest = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    const content = upstreamRequest.max_tokens >= 512 ? '收到' : '';
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({
      choices: [{
        finish_reason: content ? 'stop' : 'length',
        message: { role: 'assistant', content, reasoning_content: '模型内部推理' }
      }]
    }));
  });
  await new Promise((resolve) => upstream.listen(upstreamPort, '127.0.0.1', resolve));

  const child = spawn(process.execPath, ['server.mjs'], {
    cwd: new URL('.', import.meta.url),
    env: {
      ...process.env,
      PROTOTYPE_PORT: String(gatewayPort),
      LLAMA_CHAT_URL: `http://127.0.0.1:${upstreamPort}/v1/chat/completions`,
      PROTOTYPE_TOOL_MODE: 'hybrid'
    },
    stdio: 'ignore'
  });

  try {
    let response;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      try {
        response = await fetch(`http://127.0.0.1:${gatewayPort}/v1/agent/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messages: [{ role: 'user', content: '随便聊聊' }],
            toolNames: ['getSchedule']
          })
        });
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }

    assert.ok(response, 'prototype server did not start');
    assert.equal(response.status, 200);
    assert.equal(upstreamRequest.max_tokens, 512);
    assert.deepEqual(await response.json(), {
      type: 'message',
      content: '收到',
      provider: 'local-distill-prototype'
    });
  } finally {
    await stopChild(child);
    await new Promise((resolve) => upstream.close(resolve));
  }
});

test('hybrid fast path answers common chat and confirms planned notes without calling the model', async () => {
  const gatewayPort = 18790;
  const upstreamPort = 18791;
  let upstreamCalls = 0;
  const upstream = http.createServer((_request, response) => {
    upstreamCalls += 1;
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({
      choices: [{ message: { role: 'assistant', content: '不应调用模型' } }]
    }));
  });
  await new Promise((resolve) => upstream.listen(upstreamPort, '127.0.0.1', resolve));

  const child = spawn(process.execPath, ['server.mjs'], {
    cwd: new URL('.', import.meta.url),
    env: {
      ...process.env,
      PROTOTYPE_PORT: String(gatewayPort),
      LLAMA_CHAT_URL: `http://127.0.0.1:${upstreamPort}/v1/chat/completions`,
      PROTOTYPE_TOOL_MODE: 'hybrid'
    },
    stdio: 'ignore'
  });

  const ask = async (messages) => {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      try {
        const response = await fetch(`http://127.0.0.1:${gatewayPort}/v1/agent/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messages, toolNames: ['addNote'] })
        });
        return { response, body: await response.json() };
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }
    throw new Error('prototype server did not start');
  };

  try {
    const greeting = await ask([{ role: 'user', content: '你好' }]);
    assert.equal(greeting.response.status, 200);
    assert.deepEqual(greeting.body, {
      type: 'message',
      content: '你好，我是 Uni。你可以问课表、记事、天气，也可以直接说准备做什么。',
      provider: 'local-distill-hybrid-router'
    });

    const proposal = await ask([{ role: 'user', content: '周五交高数作业' }]);
    assert.equal(proposal.response.status, 200);
    assert.deepEqual(proposal.body, {
      type: 'message',
      content: '要把“周五交高数作业”加入记事本吗？回复“是”确认，回复“否”取消。',
      provider: 'local-distill-hybrid-router'
    });

    const confirmed = await ask([
      { role: 'user', content: '周五交高数作业' },
      { role: 'assistant', content: proposal.body.content },
      { role: 'user', content: '是' }
    ]);
    assert.equal(confirmed.response.status, 200);
    assert.equal(confirmed.body.type, 'tool_call');
    assert.equal(confirmed.body.call.name, 'addNote');
    assert.deepEqual(confirmed.body.call.arguments, { title: '周五交高数作业' });

    const declined = await ask([
      { role: 'user', content: '周五交高数作业' },
      { role: 'assistant', content: proposal.body.content },
      { role: 'user', content: '不用' }
    ]);
    assert.equal(declined.response.status, 200);
    assert.deepEqual(declined.body, {
      type: 'message',
      content: '好的，不加入记事本。',
      provider: 'local-distill-hybrid-router'
    });

    const explicit = await ask([{ role: 'user', content: '帮我记一下周五交高数作业' }]);
    assert.equal(explicit.body.type, 'message');
    assert.equal(explicit.body.content, '要把“周五交高数作业”加入记事本吗？回复“是”确认，回复“否”取消。');
    assert.equal(upstreamCalls, 0);
  } finally {
    await stopChild(child);
    await new Promise((resolve) => upstream.close(resolve));
  }
});
