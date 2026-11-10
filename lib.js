const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const dgram = require('node:dgram');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);
const dataFile = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'Portkeeper', 'assignments.json');

function validatePort(value) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Port must be an integer from 1 to 65535.');
  return port;
}

function validateAssignment(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid assignment.');
  const port = validatePort(input.port);
  const project = String(input.project || '').trim();
  const folder = String(input.folder || '').trim();
  const note = String(input.note || '').trim();
  if (!project || project.length > 100) throw new Error('Project name must contain 1 to 100 characters.');
  if (folder.length > 1024 || note.length > 500) throw new Error('Folder or note is too long.');
  return { port, project, folder, note };
}

function loadAssignments(file = dataFile) {
  try {
    const content = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!Array.isArray(content)) throw new Error('Assignments file is not a list.');
    return content.map(validateAssignment);
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

function saveAssignments(assignments, file = dataFile) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(assignments, null, 2) + '\n', 'utf8');
  fs.renameSync(temp, file);
}

function inferFolder(commandLine) {
  if (!commandLine) return '';
  // Only use explicit absolute paths in command lines. An executable folder such as
  // C:\Program Files\nodejs is not the application's project folder.
  const quoted = [...commandLine.matchAll(/"([A-Za-z]:\\[^"]+)"/g)].map(match => match[1]);
  const matches = [...quoted, ...(commandLine.match(/(?:[A-Za-z]:\\|\\\\)[^"\s]+/g) || [])];
  const files = matches.map(p => p.replace(/[),;]+$/, '')).filter(p => /\.(?:js|mjs|cjs|ts|py|jar|exe)$/i.test(p));
  const script = files.find(p => !/\\(?:node|python|pythonw|java|pwsh|powershell)\.exe$/i.test(p));
  return script ? path.dirname(script) : '';
}

async function scanUncached() {
  if (process.platform !== 'win32') throw new Error('Portkeeper currently supports Windows only.');
  const { stdout } = await execFileAsync('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'scan.ps1')
  ], { timeout: 60000, maxBuffer: 16 * 1024 * 1024, windowsHide: true });
  const raw = JSON.parse(stdout.trim() || '[]');
  return (Array.isArray(raw) ? raw : [raw]).map(item => ({
    protocol: item.protocol,
    address: item.address,
    port: item.port,
    pid: item.pid,
    processName: item.processName || 'Unknown',
    folder: inferFolder(item.commandLine),
    startedAt: item.startedAt || '',
    isService: !!item.isService
  })).sort((a, b) => a.port - b.port || a.protocol.localeCompare(b.protocol));
}

let scanCache = null;
let scanPromise = null;
async function scan(fresh = false) {
  if (!fresh && scanCache && Date.now() - scanCache.at < 10000) return scanCache.items;
  if (!scanPromise) scanPromise = scanUncached().then(items => {
    scanCache = { at: Date.now(), items };
    return items;
  }).finally(() => { scanPromise = null; });
  return scanPromise;
}

const protectedProcesses = new Set([
  'system', 'registry', 'smss.exe', 'csrss.exe', 'wininit.exe', 'winlogon.exe',
  'services.exe', 'lsass.exe', 'svchost.exe', 'dwm.exe', 'explorer.exe',
  'spoolsv.exe', 'taskhostw.exe', 'fontdrvhost.exe', 'sihost.exe'
]);

function withinFolder(child, parent) {
  if (!child || !parent) return false;
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative));
}

function stopEligibility(port, pid, active, assignments, selfPid = process.pid) {
  port = validatePort(port);
  pid = Number(pid);
  const owner = active.find(item => item.port === port && item.pid === pid);
  if (!owner) return { allowed: false, reason: 'That process no longer owns this port. Refresh the list.' };
  if (!Number.isInteger(pid) || pid <= 4 || pid === selfPid || !owner.startedAt || owner.isService || protectedProcesses.has(owner.processName.toLowerCase())) {
    return { allowed: false, reason: 'This process is protected or cannot be verified safely.' };
  }
  const assignmentByPort = new Map(assignments.map(item => [item.port, item]));
  const project = assignmentByPort.get(port);
  if (!project?.folder || !withinFolder(owner.folder, project.folder)) {
    return { allowed: false, reason: 'Save this port with its matching project folder before stopping it.' };
  }
  const owned = active.filter(item => item.pid === pid);
  if (owned.some(item => !withinFolder(item.folder, assignmentByPort.get(item.port)?.folder))) {
    return { allowed: false, reason: 'This application also owns a port outside its saved project assignments.' };
  }
  return { allowed: true, owner, ports: [...new Set(owned.map(item => item.port))].sort((a, b) => a - b) };
}

async function stopProcess(owner) {
  await execFileAsync('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'stop.ps1'),
    '-TargetPid', String(owner.pid), '-ExpectedName', owner.processName, '-ExpectedStartedAt', owner.startedAt
  ], { timeout: 15000, windowsHide: true });
  scanCache = null;
}

function probeTcp(port) {
  return new Promise(resolve => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.listen({ port, host: '0.0.0.0', exclusive: true }, () => server.close(() => resolve(true)));
  });
}

function probeUdp(port) {
  return new Promise(resolve => {
    const socket = dgram.createSocket('udp4');
    socket.once('error', () => { socket.close(); resolve(false); });
    socket.bind({ port, address: '0.0.0.0', exclusive: true }, () => socket.close(() => resolve(true)));
  });
}

async function suggestPort(start, end, assignments, active, probe = async port => (await probeTcp(port)) && (await probeUdp(port))) {
  start = validatePort(start);
  end = validatePort(end);
  if (end < start || end - start > 10000) throw new Error('Choose a range of up to 10,001 ports.');
  const taken = new Set([...assignments, ...active].map(item => item.port));
  for (let port = start; port <= end; port++) {
    if (!taken.has(port) && await probe(port)) return port;
  }
  return null;
}

module.exports = { dataFile, validatePort, validateAssignment, loadAssignments, saveAssignments, inferFolder, scan, suggestPort, stopEligibility, stopProcess };
