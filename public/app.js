const $ = id => document.getElementById(id);
let state = { active: [], assignments: [] };

async function api(url, options) {
  const response = await fetch(url, options);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status}).`);
  return data;
}

function cell(row, value, className = '') {
  const td = document.createElement('td');
  td.textContent = value || '—';
  if (className) td.className = className;
  row.append(td);
  return td;
}

function normalized(value) { return (value || '').replace(/[\\/]+$/, '').toLowerCase(); }
function isConflict(item, assignment) {
  return !!(assignment?.folder && item.folder && normalized(assignment.folder) !== normalized(item.folder));
}

function statusCell(row, label, kind = '') {
  const td = document.createElement('td');
  const badge = document.createElement('span');
  badge.className = `badge ${kind}`.trim();
  badge.textContent = label;
  td.append(badge);
  row.append(td);
}

function render() {
  const assignments = new Map(state.assignments.map(item => [item.port, item]));
  const activeByPort = new Map();
  for (const item of state.active) {
    if (!activeByPort.has(item.port)) activeByPort.set(item.port, []);
    activeByPort.get(item.port).push(item);
  }

  const assignmentBody = $('assignment-body');
  assignmentBody.replaceChildren();
  let runningProjects = 0;
  for (const assignment of state.assignments) {
    const owners = activeByPort.get(assignment.port) || [];
    if (owners.length) runningProjects++;
    const conflict = owners.some(item => isConflict(item, assignment));
    const row = document.createElement('tr');
    cell(row, String(assignment.port), 'mono');
    const projectCell = document.createElement('td');
    const name = document.createElement('strong');
    name.textContent = assignment.project;
    projectCell.append(name);
    if (assignment.folder) {
      const folder = document.createElement('div');
      folder.className = 'folder muted';
      folder.textContent = assignment.folder;
      projectCell.append(folder);
    }
    if (assignment.note) {
      const note = document.createElement('div');
      note.className = 'muted';
      note.textContent = assignment.note;
      projectCell.append(note);
    }
    row.append(projectCell);
    const applications = [...new Set(owners.map(item => `${item.processName} (PID ${item.pid})`))];
    cell(row, applications.join(', ') || '—');
    statusCell(row, conflict ? 'Possible conflict' : owners.length ? 'In use' : 'Not running', conflict ? 'conflict' : owners.length ? '' : 'idle');
    const actions = document.createElement('td');
    const uniqueOwners = [...new Map(owners.map(item => [item.pid, item])).values()];
    for (const owner of uniqueOwners) {
      const check = state.stoppable?.[`${assignment.port}:${owner.pid}`] || { allowed: false, reason: 'Refresh the port list.' };
      const stop = document.createElement('button');
      stop.textContent = 'Stop app';
      stop.className = 'danger';
      stop.disabled = !check.allowed;
      stop.title = check.allowed ? `Stops PID ${owner.pid} and releases ports ${check.ports.join(', ')}` : check.reason;
      stop.onclick = async () => {
        if (!confirm(`Stop ${owner.processName} (PID ${owner.pid})? This will close its ports: ${check.ports.join(', ')}.`)) return;
        try {
          stop.disabled = true;
          await api('/api/stop', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ port: assignment.port, pid: owner.pid })
          });
          await refresh();
        } catch (error) { showError(error); stop.disabled = false; }
      };
      actions.append(stop);
    }
    const edit = document.createElement('button');
    edit.textContent = 'Edit'; edit.className = 'secondary';
    edit.style.marginLeft = '6px';
    edit.onclick = () => {
      $('port').value = assignment.port;
      $('project').value = assignment.project;
      $('folder').value = assignment.folder;
      $('note').value = assignment.note;
      $('project').focus();
    };
    const remove = document.createElement('button');
    remove.textContent = 'Remove'; remove.className = 'danger';
    remove.style.marginLeft = '6px';
    remove.onclick = async () => {
      try {
        await api(`/api/assignments/${assignment.port}`, { method: 'DELETE' });
        await refresh();
      } catch (error) { showError(error); }
    };
    actions.append(edit, remove);
    row.append(actions);
    assignmentBody.append(row);
  }
  if (!assignmentBody.children.length) {
    const row = document.createElement('tr');
    const td = cell(row, 'No project ports yet. Add one above, or choose an active port below.', 'empty');
    td.colSpan = 5;
    assignmentBody.append(row);
  }

  const filter = $('filter').value.trim().toLowerCase();
  const activeBody = $('active-body');
  activeBody.replaceChildren();
  const otherActive = state.active.filter(item => !assignments.has(item.port));
  for (const item of otherActive) {
    const search = [item.port, item.protocol, item.address, item.processName, item.pid, item.folder].join(' ').toLowerCase();
    if (!search.includes(filter)) continue;
    const row = document.createElement('tr');
    cell(row, String(item.port), 'mono');
    cell(row, `${item.protocol} · ${item.address}`, 'mono');
    cell(row, `${item.processName} (PID ${item.pid})`);
    cell(row, item.folder || 'Unknown', 'folder');
    const actions = document.createElement('td');
    const add = document.createElement('button');
    add.textContent = 'Add to projects';
    add.className = 'secondary';
    add.onclick = () => {
      $('port').value = item.port;
      $('project').value = '';
      $('folder').value = item.folder || '';
      $('note').value = '';
      $('project').focus();
      $('assignment-form').scrollIntoView({ behavior: 'smooth', block: 'center' });
    };
    actions.append(add);
    row.append(actions);
    activeBody.append(row);
  }
  if (!activeBody.children.length) {
    const row = document.createElement('tr');
    const td = cell(row, filter ? 'No matching ports.' : 'No other active ports found.', 'empty');
    td.colSpan = 5;
    activeBody.append(row);
  }
  $('assigned-count').textContent = String(state.assignments.length);
  $('project-active-count').textContent = String(runningProjects);
  $('other-count').textContent = String(otherActive.length);
}

function showError(error) { $('message').textContent = error.message; }
async function refresh() {
  $('message').textContent = '';
  $('refresh').disabled = true;
  try {
    state = await api('/api/state');
    $('data-path').textContent = `Assignments saved at ${state.dataFile}`;
    render();
  } catch (error) { showError(error); }
  finally { $('refresh').disabled = false; }
}

$('refresh').onclick = refresh;
$('filter').oninput = render;
$('suggest-form').onsubmit = async event => {
  event.preventDefault();
  $('suggestion').textContent = 'Checking…';
  try {
    const start = encodeURIComponent($('start').value);
    const end = encodeURIComponent($('end').value);
    const result = await api(`/api/suggest?start=${start}&end=${end}`);
    $('suggestion').textContent = result.port === null ? 'No available port found in this range.' : `Suggested port: ${result.port}`;
    if (result.port !== null) $('port').value = result.port;
  } catch (error) { $('suggestion').textContent = ''; showError(error); }
};
$('assignment-form').onsubmit = async event => {
  event.preventDefault();
  try {
    await api('/api/assignments', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ port: $('port').value, project: $('project').value, folder: $('folder').value, note: $('note').value })
    });
    event.target.reset();
    await refresh();
  } catch (error) { showError(error); }
};
refresh();
setInterval(refresh, 45000);
