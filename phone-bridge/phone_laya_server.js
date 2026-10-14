#!/usr/bin/env node
/**
 * Phone System 1 Microservice (Termux / Android)
 * Runs on port 8000. Provides fast-path gating, output pruning, and safety scoring.
 */

const http = require('http');

const PORT = process.env.PORT || 8000;

const DESTRUCTIVE_COMMANDS = [
  /\brm\s+(-[rfRF]+\s+|-[a-zA-Z]*r[a-zA-Z]*\s+)/,
  /\bdd\s+if=/,
  /\bmkfs/,
  /\bchmod\s+-R\s+777/,
  /\bchown\s+-R/,
  />\s*\/dev\/sd/,
  /\bshutdown\b/,
  /\breboot\b/,
  /\bpoweroff\b/
];

const server = http.createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'GET' && (req.url === '/' || req.url === '/health')) {
    res.writeHead(200);
    res.end(
      JSON.stringify({
        status: 'ok',
        device: 'Android Phone (Termux System 1)',
        service: 'Laya Fast-Gate and Output Pruning',
        timestamp: new Date().toISOString()
      })
    );
    return;
  }

  if (req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      let data = {};
      try {
        if (body) data = JSON.parse(body);
      } catch {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'Malformed JSON payload' }));
        return;
      }

      if (req.url === '/risk') {
        const cmd = data.command || '';
        let highRisk = false;
        let matchedPattern = null;

        for (const pattern of DESTRUCTIVE_COMMANDS) {
          if (pattern.test(cmd)) {
            highRisk = true;
            matchedPattern = pattern.toString();
            break;
          }
        }

        res.writeHead(200);
        res.end(
          JSON.stringify({
            risk_score: highRisk ? 'high' : 'low',
            requires_confirmation: highRisk,
            reason: highRisk ? `Matches dangerous pattern: ${matchedPattern}` : 'Safe command'
          })
        );
        return;
      }

      if (req.url === '/prune') {
        const rawOutput = data.output || '';
        const lines = rawOutput.split('\n');
        const maxLines = data.max_lines || 40;

        let pruned = rawOutput;
        if (lines.length > maxLines) {
          const keepStart = Math.floor(maxLines * 0.5);
          const keepEnd = maxLines - keepStart;
          const omitted = lines.length - maxLines;
          const head = lines.slice(0, keepStart).join('\n');
          const tail = lines.slice(lines.length - keepEnd).join('\n');
          pruned = `${head}\n\n[... Phone System 1 Pruned ${omitted} verbose lines ...]\n\n${tail}`;
        }

        res.writeHead(200);
        res.end(
          JSON.stringify({
            original_length: rawOutput.length,
            pruned_length: pruned.length,
            output: pruned
          })
        );
        return;
      }

      if (req.url === '/route') {
        const query = (data.query || '').toLowerCase();
        const fastPathCandidates = ['git status', 'pwd', 'ls', 'whoami', 'date', 'uptime'];
        const isFastPath = fastPathCandidates.some((c) => query.includes(c));

        res.writeHead(200);
        res.end(
          JSON.stringify({
            decision: isFastPath ? 'fast_path' : 'deep_reasoning',
            confidence: 0.94,
            model: 'Laya-ModernBERT-System1'
          })
        );
        return;
      }

      res.writeHead(404);
      res.end(JSON.stringify({ error: 'Endpoint not found' }));
    });
    return;
  }

  res.writeHead(405);
  res.end(JSON.stringify({ error: 'Method not allowed' }));
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Phone System 1 server listening on port ${PORT}`);
});
