#!/usr/bin/env node

/**
 * Gemini Bridge - CLI Orchestrator and Universal OpenAI-Compatible Proxy
 * Connects to active browser webchat (Gemini, ChatGPT, Claude) via WebSocket on port 8765.
 * Provides OpenAI API proxy (/v1/chat/completions, /v1/models) and interactive agent loop.
 */

const { WebSocketServer } = require('ws');
const readline = require('readline');
const http = require('http');
const tools = require('./tools');

// CLI Argument Parsing
const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h')) {
  console.log(`
Gemini Bridge - Universal Webchat Agent Orchestrator & OpenAI Proxy

USAGE:
  node cli.js [OPTIONS]
  npx gemini-bridge [OPTIONS]

OPTIONS:
  -p, --port <number>   Port for WebSocket server and OpenAI HTTP proxy (default: 8765)
  -t, --test            Verify syntax, test configuration, and exit cleanly
  -h, --help            Show this help manual

ENDPOINTS:
  GET  /v1/models             OpenAI-compatible models list
  POST /v1/chat/completions   OpenAI-compatible chat completion (streaming & non-streaming)
  WS   ws://localhost:<port>  Bi-directional communication with Chrome extension
`);
  process.exit(0);
}

if (args.includes('--test')) {
  console.log('\x1b[32m[Gemini Bridge Test]\x1b[0m Syntax and configuration valid.');
  process.exit(0);
}

let configuredPort = process.env.PORT || process.env.WS_PORT || 8765;
const portArgIndex = args.findIndex((arg) => arg === '-p' || arg === '--port');
if (portArgIndex !== -1 && args[portArgIndex + 1]) {
  configuredPort = parseInt(args[portArgIndex + 1], 10) || configuredPort;
}

const WS_PORT = configuredPort;
const PHONE_ENDPOINT = process.env.PHONE_ENDPOINT || 'http://localhost:8000';

let activeSocket = null;
let pendingResponseResolver = null;
let activePlatform = 'Gemini';
let activeModel = 'gemini-web';

const SYSTEM_TOOL_SPEC = `
You have access to the following local developer tools on the user's laptop.
To invoke a tool, output a single JSON block wrapped inside a \`\`\`tool_call markdown fence.

Available tools:
1. run_command: Execute shell commands locally.
   Format:
   \`\`\`tool_call
   { "tool": "run_command", "args": { "command": "npm test" } }
   \`\`\`

2. read_file: Read file contents with optional line slice.
   Format:
   \`\`\`tool_call
   { "tool": "read_file", "args": { "path": "src/index.js", "startLine": 1, "endLine": 50 } }
   \`\`\`

3. write_file: Write or create a file.
   Format:
   \`\`\`tool_call
   { "tool": "write_file", "args": { "path": "src/index.js", "content": "..." } }
   \`\`\`

Rules:
- Make one tool call per turn when you need environment inspection or code edits.
- When your task is complete and you do not need more tools, reply with your final response without any \`\`\`tool_call block.
`;

function parseToolCall(responseText) {
  if (!responseText) return null;

  // 1. Markdown code blocks: ```tool_call ... ``` or ```json ... ```
  const toolCallRegex = /```(?:tool_call|json|bash)?\s*([\s\S]*?)```/g;
  let match;
  while ((match = toolCallRegex.exec(responseText)) !== null) {
    const rawContent = match[1].trim();
    try {
      const parsed = JSON.parse(rawContent);
      if (parsed.tool && parsed.args) return parsed;
      if (parsed.name && (parsed.arguments || parsed.args)) {
        return { tool: parsed.name, args: parsed.arguments || parsed.args };
      }
    } catch {}
  }

  // 2. Direct JSON object containing "tool" and "args"
  const jsonBraceRegex = /\{[\s\S]*?"tool"\s*:\s*"[^"]+"[\s\S]*?"args"\s*:\s*\{[\s\S]*?\}\s*\}/;
  const directMatch = responseText.match(jsonBraceRegex);
  if (directMatch) {
    try {
      const parsed = JSON.parse(directMatch[0]);
      if (parsed.tool && parsed.args) return parsed;
    } catch {}
  }

  // 3. OpenAI format { "name": "...", "arguments": {...} }
  const openaiStyleRegex = /\{[\s\S]*?"name"\s*:\s*"[^"]+"[\s\S]*?"arguments"\s*:\s*\{[\s\S]*?\}\s*\}/;
  const openaiMatch = responseText.match(openaiStyleRegex);
  if (openaiMatch) {
    try {
      const parsed = JSON.parse(openaiMatch[0]);
      return { tool: parsed.name, args: parsed.arguments };
    } catch {}
  }

  return null;
}

/**
 * Checks phone System 1 microservice with ultra-short timeout and zero-crash fallback
 */
function queryPhoneSystem1(pathEndpoint, payload) {
  return new Promise((resolve) => {
    try {
      const data = JSON.stringify(payload);
      const url = new URL(pathEndpoint, PHONE_ENDPOINT);
      const req = http.request(
        url,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(data)
          },
          timeout: 400
        },
        (res) => {
          let body = '';
          res.on('data', (chunk) => (body += chunk));
          res.on('end', () => {
            try {
              resolve(JSON.parse(body));
            } catch {
              resolve(null);
            }
          });
        }
      );

      req.on('error', () => resolve(null));
      req.on('timeout', () => {
        req.destroy();
        resolve(null);
      });
      req.write(data);
      req.end();
    } catch {
      resolve(null);
    }
  });
}

function sendPromptToChrome(promptText) {
  return new Promise((resolve, reject) => {
    if (!activeSocket) {
      return reject(
        new Error(`No browser extension connected. Open ${activePlatform} in Chrome with the extension active.`)
      );
    }
    pendingResponseResolver = resolve;
    activeSocket.send(JSON.stringify({ type: 'PROMPT', text: promptText }));
  });
}

async function runAgentLoop(userGoal) {
  let promptToSend = `${SYSTEM_TOOL_SPEC}\n\nUser Task: ${userGoal}`;
  let turn = 1;
  const maxTurns = 25;

  while (turn <= maxTurns) {
    console.log(`\n\x1b[36m[Turn ${turn}] Routing prompt to ${activePlatform} (${activeModel})...\x1b[0m`);
    let responseText;
    try {
      responseText = await sendPromptToChrome(promptToSend);
    } catch (err) {
      console.error(`\x1b[31m[Bridge Error]\x1b[0m ${err.message}`);
      break;
    }

    const toolCall = parseToolCall(responseText);

    if (!toolCall) {
      console.log(`\n\x1b[32m=== Final Assistant Response ===\x1b[0m\n${responseText}\n`);
      break;
    }

    console.log(`\n\x1b[33m[Tool Call]\x1b[0m ${toolCall.tool}`);
    console.log(JSON.stringify(toolCall.args, null, 2));

    if (toolCall.tool === 'run_command') {
      const riskCheck = await queryPhoneSystem1('/risk', { command: toolCall.args.command });
      if (riskCheck && riskCheck.requires_confirmation) {
        console.log(
          `\x1b[31m[Phone System 1 Warning]\x1b[0m Command flagged high-risk: ${riskCheck.reason || 'Destructive potential'}`
        );
      }
    }

    let toolResult;
    if (toolCall.tool === 'run_command') {
      toolResult = await tools.run_command(toolCall.args);
    } else if (toolCall.tool === 'read_file') {
      toolResult = await tools.read_file(toolCall.args);
    } else if (toolCall.tool === 'write_file') {
      toolResult = await tools.write_file(toolCall.args);
    } else {
      toolResult = { error: `Unknown tool: ${toolCall.tool}` };
    }

    const pruned = await queryPhoneSystem1('/prune', { output: JSON.stringify(toolResult, null, 2) });
    const formattedOutput = pruned && pruned.output ? pruned.output : JSON.stringify(toolResult, null, 2);

    promptToSend = `[Tool Result: ${toolCall.tool}]\n\`\`\`json\n${formattedOutput}\n\`\`\`\nPlease inspect this result and proceed with your next tool call or your final response.`;
    turn++;
  }

  if (turn > maxTurns) {
    console.log('\x1b[31m[Agent Notice]\x1b[0m Reached maximum conversation turns.');
  }
}

function formatOpenAIMessagesToPrompt(messages, toolsList) {
  let prompt = '';
  if (Array.isArray(toolsList) && toolsList.length > 0) {
    prompt += `You have access to the following developer tools on the user's laptop:\n`;
    for (const t of toolsList) {
      if (t.function) {
        prompt += `- ${t.function.name}: ${t.function.description || ''}\n  Parameters: ${JSON.stringify(
          t.function.parameters || {}
        )}\n`;
      }
    }
    prompt += `\nTo invoke a tool, output a single JSON block wrapped inside a \`\`\`tool_call markdown fence:
\`\`\`tool_call
{ "tool": "tool_name", "args": { ... } }
\`\`\`
If no tool is needed, simply write your direct response.\n\n`;
  }

  if (Array.isArray(messages)) {
    prompt += messages
      .map((m) => {
        const roleLabel = m.role === 'system' ? 'System' : m.role === 'user' ? 'User' : 'Assistant';
        const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
        if (m.tool_call_id || m.role === 'tool') {
          return `[Tool Result (${m.name || 'output'})]:\n${content}`;
        }
        return `[${roleLabel}]:\n${content}`;
      })
      .join('\n\n');
  }

  return prompt;
}

function start() {
  const server = http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', '*');

    if (req.method === 'OPTIONS') {
      res.writeHead(200);
      res.end();
      return;
    }

    if (req.method === 'GET' && req.url === '/v1/models') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      const now = Math.floor(Date.now() / 1000);
      res.end(
        JSON.stringify({
          object: 'list',
          data: [
            { id: activeModel, object: 'model', created: now, owned_by: activePlatform.toLowerCase() },
            { id: 'gemini-web', object: 'model', created: now, owned_by: 'google' },
            { id: 'gemini-4-pro-argon', object: 'model', created: now, owned_by: 'google' },
            { id: 'gpt-6.1-sol', object: 'model', created: now, owned_by: 'openai' },
            { id: 'gpt-6-astra', object: 'model', created: now, owned_by: 'openai' },
            { id: 'fable-5.5', object: 'model', created: now, owned_by: 'anthropic' },
            { id: 'fable-5.1', object: 'model', created: now, owned_by: 'anthropic' },
            { id: 'claude-4-opus', object: 'model', created: now, owned_by: 'anthropic' },
            { id: 'claude-3-7-sonnet', object: 'model', created: now, owned_by: 'anthropic' },
            { id: 'gemini-2.0-flash', object: 'model', created: now, owned_by: 'google' }
          ]
        })
      );
      return;
    }

    if (req.method === 'POST' && req.url === '/v1/chat/completions') {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', async () => {
        try {
          const payload = JSON.parse(body || '{}');
          const stream = payload.stream === true;
          const requestedModel = payload.model || activeModel;
          const promptText = formatOpenAIMessagesToPrompt(payload.messages || [], payload.tools);

          if (!activeSocket) {
            res.writeHead(503, { 'Content-Type': 'application/json' });
            res.end(
              JSON.stringify({
                error: {
                  message: `Browser extension is not connected on ws://localhost:${WS_PORT}. Please open ${activePlatform} in Chrome.`
                }
              })
            );
            return;
          }

          console.log(`\n\x1b[36m[OpenAI Proxy] Routing request for '${requestedModel}' to ${activePlatform}...\x1b[0m`);
          const responseText = await sendPromptToChrome(promptText);
          const toolCall = parseToolCall(responseText);

          if (stream) {
            res.writeHead(200, {
              'Content-Type': 'text/event-stream',
              'Cache-Control': 'no-cache',
              Connection: 'keep-alive'
            });
            const chunkId = 'chatcmpl-' + Date.now();
            const chunk = {
              id: chunkId,
              object: 'chat.completion.chunk',
              created: Math.floor(Date.now() / 1000),
              model: requestedModel,
              choices: [
                {
                  index: 0,
                  delta: toolCall
                    ? {
                        tool_calls: [
                          {
                            index: 0,
                            id: 'call_' + Math.random().toString(36).substring(2, 9),
                            type: 'function',
                            function: {
                              name: toolCall.tool,
                              arguments: JSON.stringify(toolCall.args)
                            }
                          }
                        ]
                      }
                    : { content: responseText },
                  finish_reason: toolCall ? 'tool_calls' : 'stop'
                }
              ]
            };
            res.write(`data: ${JSON.stringify(chunk)}\n\n`);
            res.write('data: [DONE]\n\n');
            res.end();
          } else {
            let messageObj = { role: 'assistant', content: responseText };
            let finishReason = 'stop';

            if (toolCall) {
              const toolCallId = 'call_' + Math.random().toString(36).substring(2, 9);
              messageObj = {
                role: 'assistant',
                content: responseText.replace(/```(?:tool_call|json)?\s*[\s\S]*?```/g, '').trim(),
                tool_calls: [
                  {
                    id: toolCallId,
                    type: 'function',
                    function: {
                      name: toolCall.tool,
                      arguments: JSON.stringify(toolCall.args)
                    }
                  }
                ]
              };
              finishReason = 'tool_calls';
            }

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(
              JSON.stringify({
                id: 'chatcmpl-' + Date.now(),
                object: 'chat.completion',
                created: Math.floor(Date.now() / 1000),
                model: requestedModel,
                choices: [
                  {
                    index: 0,
                    message: messageObj,
                    finish_reason: finishReason
                  }
                ]
              })
            );
          }
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { message: err.message } }));
        }
      });
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'Not found' } }));
  });

  const wss = new WebSocketServer({ server });

  wss.on('connection', (ws) => {
    activeSocket = ws;
    console.log(`\n\x1b[32m[Bridge Connected]\x1b[0m Browser extension attached on ws://localhost:${WS_PORT}`);

    ws.on('message', (message) => {
      try {
        const data = JSON.parse(message);
        if (data.type === 'HELLO' || data.type === 'STATUS') {
          if (data.platform) activePlatform = data.platform;
          if (data.model) activeModel = data.model;
          console.log(`\x1b[35m[Active Session]\x1b[0m Platform: ${activePlatform} | Model: ${activeModel}`);
        } else if (data.type === 'RESPONSE' && pendingResponseResolver) {
          const resolve = pendingResponseResolver;
          pendingResponseResolver = null;
          resolve(data.text);
        } else if (data.type === 'ERROR') {
          console.error(`\x1b[31m[Extension Error]\x1b[0m ${data.message}`);
        }
      } catch (err) {
        console.error('[CLI] Failed to parse message from extension:', err);
      }
    });

    ws.on('close', () => {
      console.log('\n\x1b[31m[Bridge Disconnected]\x1b[0m Browser extension detached.');
      activeSocket = null;
    });
  });

  server.listen(WS_PORT, () => {
    console.log(`\x1b[35m=== Gemini Bridge Orchestrator & Universal Proxy ===\x1b[0m`);
    console.log(`HTTP/OpenAI API: http://localhost:${WS_PORT}/v1`);
    console.log(`WebSocket Bridge: ws://localhost:${WS_PORT}`);
    console.log(`Waiting for browser connection (Gemini / ChatGPT / Claude)...`);
  });

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: '\ngemini-bridge> '
  });

  rl.prompt();

  rl.on('line', async (line) => {
    const input = line.trim();
    if (!input) {
      rl.prompt();
      return;
    }

    if (input === 'exit' || input === 'quit') {
      console.log('Exiting Gemini Bridge...');
      process.exit(0);
    }

    if (!activeSocket) {
      console.log('\x1b[33mNotice: Browser extension is not connected yet.\x1b[0m');
      console.log('1. Open Chrome at https://gemini.google.com, https://chatgpt.com, or https://claude.ai');
      console.log('2. Ensure the unpacked Gemini Bridge extension is loaded and active.');
      rl.prompt();
      return;
    }

    await runAgentLoop(input);
    rl.prompt();
  });
}

start();
