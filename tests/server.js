/**
 * Local test server: serves the website from the repo and answers POST /api with the real Apps Script
 * code running against the mock tracker (tests/gas-mock.js). Used by the browser test, and handy for
 * trying the pages by hand:  node tests/server.js  then open http://localhost:8080/
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { makeEnv } = require('./gas-mock');

const ROOT = path.join(__dirname, '..');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' };

async function start(opts = {}) {
  const env = opts.env || await makeEnv(opts.tracker || path.join(ROOT, 'tracker', 'MSU_Sheep_Genotyping_Tracker_START.xlsx'), { quiet: opts.quiet !== false });
  if (opts.setup !== false) env.ctx.setupAll_();
  if (opts.passphrase) env.ctx.setSetting_('Staff_Passphrase', opts.passphrase);
  const calls = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (req.method === 'POST' && url.pathname === '/api') {
      let body = '';
      req.on('data', c => { body += c; });
      req.on('end', () => {
        let out;
        try {
          const r = JSON.parse(body || '{}');
          calls.push(r.action);
          out = JSON.stringify(env.ctx.handle_(r));
        } catch (e) { out = JSON.stringify({ ok: false, error: 'The request could not be read.' }); }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(out);
      });
      return;
    }
    if (url.pathname === '/assets/js/config.js') {
      res.writeHead(200, { 'Content-Type': TYPES['.js'] });
      res.end(`window.SITE_CONFIG = { API_URL: '${'http://localhost:' + server.address().port}/api' };`);
      return;
    }
    let file = path.join(ROOT, decodeURIComponent(url.pathname));
    if (!file.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    if (!fs.existsSync(file)) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise(r => server.listen(opts.port || 0, r));
  const base = 'http://localhost:' + server.address().port + '/';
  return { env, server, base, calls, close: () => new Promise(r => server.close(r)) };
}

module.exports = { start };

if (require.main === module) {
  start({ port: Number(process.env.PORT) || 8080, quiet: false, passphrase: 'test' }).then(s => {
    console.log('Website with a mock back end at ' + s.base);
    console.log('Staff passphrase for this local copy: test. Emails print here instead of sending.');
    const push = s.env.outbox.push.bind(s.env.outbox);
    s.env.outbox.push = m => { console.log('\n--- email to ' + m.to + ': ' + m.subject + '\n' + m.body + '\n---'); return push(m); };
  });
}
