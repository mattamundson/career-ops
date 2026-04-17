// Minimal MCP stdio JSON-RPC client for talking to an MCP server spawned as a
// child process (uvx, npx, python -m, etc.). Handles the initialize handshake,
// tools/call, tools/list, request timeouts, and graceful shutdown.
//
// Shared by scripts that need MCP access outside a Claude Code session
// (scan-linkedin-mcp.mjs, future get_job_details enrichment pass, etc.).

import { spawn } from 'child_process';

export class McpClient {
  constructor(cmd, cmdArgs, { stderrPrefix = 'mcp', suppressInfo = true } = {}) {
    this.proc = spawn(cmd, cmdArgs, { stdio: ['pipe', 'pipe', 'pipe'] });
    this.buffer = '';
    this.pending = new Map();
    this.nextId = 1;
    this.initialized = false;
    this.closed = false;
    this.stderrPrefix = stderrPrefix;
    this.suppressInfo = suppressInfo;

    this.proc.stdout.on('data', d => this._onData(d));
    this.proc.stderr.on('data', d => {
      const text = d.toString();
      for (const line of text.split('\n')) {
        if (!line.trim()) continue;
        if (this.suppressInfo && /^(INFO|DEBUG)/i.test(line)) continue;
        process.stderr.write(`[${this.stderrPrefix}] ${line}\n`);
      }
    });
    this.proc.on('exit', code => {
      this.closed = true;
      for (const { reject } of this.pending.values()) {
        reject(new Error(`MCP server exited (code ${code}) before response`));
      }
      this.pending.clear();
    });
    this.proc.on('error', err => {
      this.closed = true;
      process.stderr.write(`[${this.stderrPrefix}] spawn error: ${err.message}\n`);
    });
  }

  _onData(data) {
    this.buffer += data.toString();
    let nl;
    while ((nl = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, nl).trim();
      this.buffer = this.buffer.slice(nl + 1);
      if (!line) continue;
      let msg;
      try { msg = JSON.parse(line); } catch { continue; }
      if (msg.id !== undefined && this.pending.has(msg.id)) {
        const { resolve: res, reject: rej } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? rej(new Error(msg.error.message || JSON.stringify(msg.error))) : res(msg.result);
      }
    }
  }

  request(method, params, timeoutMs = 60000) {
    if (this.closed) return Promise.reject(new Error('MCP client closed'));
    const id = this.nextId++;
    return new Promise((res, rej) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        rej(new Error(`timeout: ${method}`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: v => { clearTimeout(timer); res(v); },
        reject: e => { clearTimeout(timer); rej(e); },
      });
      this.proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params: params || {} }) + '\n');
    });
  }

  notify(method, params) {
    if (this.closed) return;
    this.proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params: params || {} }) + '\n');
  }

  async init(clientInfo = { name: 'career-ops', version: '1.0' }) {
    if (this.initialized) return;
    await this.request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo,
    });
    this.notify('notifications/initialized');
    this.initialized = true;
  }

  async callTool(name, args = {}, timeoutMs = 90000) {
    await this.init();
    return this.request('tools/call', { name, arguments: args }, timeoutMs);
  }

  async listTools() {
    await this.init();
    return this.request('tools/list', {});
  }

  close() {
    if (!this.closed) {
      try { this.proc.kill(); } catch { /* noop */ }
    }
    this.closed = true;
  }
}

// Convenience: parse MCP tool-call result content and return the first
// text item parsed as JSON. MCP servers commonly return results as
// `{ content: [{ type: 'text', text: '<JSON>' }] }`.
export function parseJsonTextContent(result) {
  const text = result?.content?.[0]?.text;
  if (!text) return null;
  try { return JSON.parse(text); } catch { return null; }
}
