const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { dataFile, validatePort, validateAssignment, loadAssignments, saveAssignments, scan, suggestPort, stopEligibility, stopProcess } = require('./lib');

const host = '127.0.0.1';
const preferredPort = Number(process.env.PORTKEEPER_PORT || 8765);
const publicDir = path.join(__dirname, 'public');
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };

function json(response, code, data) {
  response.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(data));
}

async function readBody(request) {
  let body = '';
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 20_000) throw new Error('Request is too large.');
  }
  try { return JSON.parse(body); } catch { throw new Error('Expected JSON.'); }
}

async function handle(request, response) {
  const url = new URL(request.url, `http://${host}`);
  try {
    if (request.method !== 'GET') {
      const expectedOrigin = `http://${host}:${request.socket.localPort}`;
      if (request.headers.origin && request.headers.origin !== expectedOrigin) {
        return json(response, 403, { error: 'Requests must come from the local Portkeeper page.' });
      }
    }
    if (url.pathname === '/api/state' && request.method === 'GET') {
      const [active, assignments] = await Promise.all([scan(), Promise.resolve(loadAssignments())]);
      const stoppable = Object.fromEntries(active.map(item => {
        const check = stopEligibility(item.port, item.pid, active, assignments);
        return [`${item.port}:${item.pid}`, { allowed: check.allowed, reason: check.reason || '', ports: check.ports || [] }];
      }));
      return json(response, 200, { active, assignments, stoppable, dataFile });
    }
    if (url.pathname === '/api/assignments' && request.method === 'POST') {
      const assignment = validateAssignment(await readBody(request));
      const assignments = loadAssignments().filter(item => item.port !== assignment.port);
      assignments.push(assignment);
      assignments.sort((a, b) => a.port - b.port);
      saveAssignments(assignments);
      return json(response, 200, { assignments });
    }
    if (url.pathname.startsWith('/api/assignments/') && request.method === 'DELETE') {
      const port = validatePort(url.pathname.split('/').pop());
      const assignments = loadAssignments().filter(item => item.port !== port);
      saveAssignments(assignments);
      return json(response, 200, { assignments });
    }
    if (url.pathname === '/api/suggest' && request.method === 'GET') {
      const start = url.searchParams.get('start') || '3000';
      const end = url.searchParams.get('end') || '3999';
      const [active, assignments] = await Promise.all([scan(), Promise.resolve(loadAssignments())]);
      return json(response, 200, { port: await suggestPort(start, end, assignments, active) });
    }
    if (url.pathname === '/api/stop' && request.method === 'POST') {
      const body = await readBody(request);
      const active = await scan(true);
      const check = stopEligibility(body.port, body.pid, active, loadAssignments());
      if (!check.allowed) return json(response, 403, { error: check.reason });
      await stopProcess(check.owner);
      return json(response, 200, { stoppedPid: check.owner.pid, releasedPorts: check.ports });
    }
    if (request.method !== 'GET') return json(response, 405, { error: 'Method not allowed.' });
    const file = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    if (!['index.html', 'style.css', 'app.js'].includes(file)) return json(response, 404, { error: 'Not found.' });
    response.writeHead(200, { 'Content-Type': mime[path.extname(file)], 'Cache-Control': 'no-store' });
    return fs.createReadStream(path.join(publicDir, file)).pipe(response);
  } catch (error) {
    return json(response, /^(Port |Project |Folder |Choose |Invalid |Request |Expected )/.test(error.message) ? 400 : 500, { error: error.message });
  }
}

function start() {
  const server = http.createServer(handle);
  server.on('error', error => { console.error(error.message); process.exitCode = 1; });
  server.listen(preferredPort, host, () => {
    const address = `http://${host}:${server.address().port}`;
    console.log(`Portkeeper: ${address}`);
    console.log(`Assignments: ${dataFile}`);
    if (process.argv.includes('--open')) spawn('cmd.exe', ['/c', 'start', '', address], { windowsHide: true, detached: true, stdio: 'ignore' }).unref();
  });
  return server;
}

if (require.main === module) start();
module.exports = { start, handle };
