const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

const MAX_OUTPUT_CHARS = 4000;
const MAX_OUTPUT_LINES = 80;

/**
 * Truncates text exceeding character or line thresholds while preserving context
 */
function truncateOutput(text, maxChars = MAX_OUTPUT_CHARS, maxLines = MAX_OUTPUT_LINES) {
  if (!text) return '';
  const lines = text.split('\n');
  if (lines.length > maxLines) {
    const keepStart = Math.floor(maxLines * 0.6);
    const keepEnd = maxLines - keepStart;
    const omitted = lines.length - maxLines;
    const head = lines.slice(0, keepStart).join('\n');
    const tail = lines.slice(lines.length - keepEnd).join('\n');
    text = `${head}\n\n[... truncated ${omitted} lines ...]\n\n${tail}`;
  }
  if (text.length > maxChars) {
    text = text.slice(0, maxChars) + `\n[... truncated ${text.length - maxChars} characters ...]`;
  }
  return text;
}

/**
 * Executes shell commands locally with timeout and buffer limits
 */
function run_command({ command, timeout = 30000, cwd = process.cwd() }) {
  return new Promise((resolve) => {
    if (!command || typeof command !== 'string') {
      return resolve({
        error: 'Missing or invalid command parameter',
        exitCode: 1,
        stdout: '',
        stderr: 'Error: command must be a non-empty string'
      });
    }

    exec(command, { timeout, cwd, maxBuffer: 1024 * 1024 * 2 }, (error, stdout, stderr) => {
      const exitCode = error ? (error.code !== undefined ? error.code : 1) : 0;
      resolve({
        stdout: truncateOutput(stdout || ''),
        stderr: truncateOutput(stderr || ''),
        exitCode,
        error: error ? error.message : null
      });
    });
  });
}

/**
 * Reads local file contents with optional startLine and endLine slices
 */
function read_file({ path: targetPath, startLine, endLine }) {
  return new Promise((resolve) => {
    if (!targetPath) {
      return resolve({ error: 'Missing path parameter' });
    }
    const resolvedPath = path.resolve(process.cwd(), targetPath);

    if (!fs.existsSync(resolvedPath)) {
      return resolve({ error: `File not found: ${targetPath}` });
    }

    try {
      const content = fs.readFileSync(resolvedPath, 'utf8');
      const lines = content.split('\n');

      if (startLine !== undefined || endLine !== undefined) {
        const start = Math.max(1, parseInt(startLine, 10) || 1) - 1;
        const end = Math.min(lines.length, parseInt(endLine, 10) || lines.length);
        const sliced = lines.slice(start, end).join('\n');
        return resolve({
          path: targetPath,
          totalLines: lines.length,
          startLine: start + 1,
          endLine: end,
          content: truncateOutput(sliced)
        });
      }

      resolve({
        path: targetPath,
        totalLines: lines.length,
        content: truncateOutput(content)
      });
    } catch (err) {
      resolve({ error: `Failed to read file: ${err.message}` });
    }
  });
}

/**
 * Writes or appends content to local files, creating missing directories
 */
function write_file({ path: targetPath, content, append = false }) {
  return new Promise((resolve) => {
    if (!targetPath) {
      return resolve({ error: 'Missing path parameter' });
    }
    if (content === undefined || content === null) {
      return resolve({ error: 'Missing content parameter' });
    }

    try {
      const resolvedPath = path.resolve(process.cwd(), targetPath);
      const dir = path.dirname(resolvedPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      if (append) {
        fs.appendFileSync(resolvedPath, content, 'utf8');
      } else {
        fs.writeFileSync(resolvedPath, content, 'utf8');
      }

      resolve({
        path: targetPath,
        bytesWritten: Buffer.byteLength(content, 'utf8'),
        status: 'success'
      });
    } catch (err) {
      resolve({ error: `Failed to write file: ${err.message}` });
    }
  });
}

module.exports = {
  run_command,
  read_file,
  write_file,
  truncateOutput
};
