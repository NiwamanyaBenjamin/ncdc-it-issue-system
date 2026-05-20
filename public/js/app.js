let currentUser = null;
let issuesCache = [];

const $ = id => document.getElementById(id);

const api = async (url, opts = {}) => {
  const res = await fetch(url, {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json'
    },
    ...opts
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(data.error || 'Request failed');
  }

  return data;
};

function showMessage(id, msg, ok = false) {
  const el = $(id);
  if (el) {
    el.textContent = msg;
    el.style.color = ok ? '#087443' : '#b42318';
  }
}

function fmt(d) {
  return d ? new Date(d).toLocaleString() : '';
}

function badge(v) {
  return `<span class="badge ${v}">${v}</span>`;
}

function statusBadge(v) {
  return `<span class="badge status">${v}</span>`;
}

function roleTitle(r) {
  return {
    admin: 'ADMIN DASHBOARD',
    manager: 'MANAGER DASHBOARD',
    it_staff: 'IT STAFF DASHBOARD',
    user: 'USER DASHBOARD'
  }[r] || 'DASHBOARD';
}

function roleName(r) {
  return {
    admin: 'Admin',
    manager: 'Manager',
    it_staff: 'IT Staff',
    user: 'User'
  }[r] || r;
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"]/g, m => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;'
  }[m]));
}

async function boot() {
  try {
    currentUser = await api('/api/me');
    showApp();
    render('dashboard');
    pollNotifications();
    setInterval(pollNotifications, 25000);
  } catch {
    if ($('loginPage')) $('loginPage').classList.remove('hidden');
    if ($('appPage')) $('appPage').classList.add('hidden');
  }
}

function showApp() {
  if ($('loginPage')) $('loginPage').classList.add('hidden');
  if ($('appPage')) $('appPage').classList.remove('hidden');

  if ($('currentUserName')) $('currentUserName').textContent = currentUser.name;
  if ($('currentUserRole')) $('currentUserRole').textContent = roleName(currentUser.role);

  document.querySelectorAll('.admin-only').forEach(e => {
    e.style.display = currentUser.role === 'admin' ? 'block' : 'none';
  });

  document.querySelectorAll('.admin-manager-only').forEach(e => {
    e.style.display = ['admin', 'manager'].includes(currentUser.role) ? 'block' : 'none';
  });
}

if ($('togglePassword')) {
  $('togglePassword').onclick = () => {
    const p = $('loginPassword');
    p.type = p.type === 'password' ? 'text' : 'password';
    $('togglePassword').textContent = p.type === 'password' ? 'Show' : 'Hide';
  };
}

if ($('showRegister')) {
  $('showRegister').onclick = () => $('registerBox').classList.toggle('hidden');
}

if ($('loginForm')) {
  $('loginForm').onsubmit = async e => {
    e.preventDefault();

    try {
      const data = await api('/api/login', {
        method: 'POST',
        body: JSON.stringify({
          email: $('loginEmail').value,
          password: $('loginPassword').value
        })
      });

      currentUser = data.user;
      showApp();
      render('dashboard');
    } catch (err) {
      showMessage('loginMessage', err.message);
    }
  };
}

if ($('registerForm')) {
  $('registerForm').onsubmit = async e => {
    e.preventDefault();

    try {
      await api('/api/register', {
        method: 'POST',
        body: JSON.stringify({
          name: $('regName').value,
          email: $('regEmail').value,
          password: $('regPassword').value,
          department: $('regDepartment').value,
          phone: $('regPhone').value
        })
      });

      showMessage('registerMessage', 'Account request submitted.', true);
      e.target.reset();
    } catch (err) {
      showMessage('registerMessage', err.message);
    }
  };
}

if ($('logoutBtn')) {
  $('logoutBtn').onclick = async () => {
    await api('/api/logout', { method: 'POST' }).catch(() => {});
    window.location.href = '/login.html';
  };
}

document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.onclick = () => render(btn.dataset.view);
});

function setView(view, title) {
  document.querySelectorAll('.nav-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.view === view);
  });

  if ($('pageTitle')) $('pageTitle').textContent = title;
  if ($('welcomeText')) $('welcomeText').textContent = view === 'dashboard' ? roleTitle(currentUser.role) : '';
}

async function render(view) {
  const titles = {
    dashboard: 'Dashboard',
    report: 'Report Issue',
    issues: 'Issues',
    updates: 'Issue Updates',
    users: 'Users',
    audit: 'Audit Logs'
  };

  setView(view, titles[view] || 'Dashboard');

  if (view === 'dashboard') return dashboard();
  if (view === 'report') return reportForm();
  if (view === 'issues') return issues();
  if (view === 'updates') return updates();
  if (view === 'users') return users();
  if (view === 'audit') return audit();
}

async function dashboard() {
  const d = await api('/api/dashboard');

  $('content').innerHTML = `
    <div class="cards">
      <div class="card"><h3>Total Issues</h3><div class="num">${d.total}</div></div>
      <div class="card"><h3>My Issues</h3><div class="num">${d.mine}</div></div>
      <div class="card"><h3>Users</h3><div class="num">${d.users || '-'}</div></div>
      <div class="card"><h3>Critical / High</h3><div class="num">${d.priority.filter(p => ['Critical','High'].includes(p.priority)).reduce((a,b) => a + b.count, 0)}</div></div>
    </div>

    <div class="grid-2">
      <div class="panel"><h3>Issues by Status</h3>${chart(d.status, 'status')}</div>
      <div class="panel"><h3>Issues by Priority</h3>${chart(d.priority, 'priority')}</div>
    </div>

    <div class="panel" style="margin-top:16px">
      <h3>Recent Issues</h3>
      ${issueTable(d.recent, false)}
    </div>
  `;
}

function chart(rows, key) {
  if (!rows.length) return '<div class="empty">No data yet</div>';

  const max = Math.max(...rows.map(r => r.count), 1);

  return `
    <div class="chart-row">
      ${rows.map(r => `
        <div class="bar" style="height:${(r.count / max) * 145}px">
          <span>${escapeHtml(r[key])}<br>${r.count}</span>
        </div>
      `).join('')}
    </div>
  `;
}

function reportForm() {
  $('content').innerHTML = `
    <div class="panel">
      <h3>Report an Issue</h3>

      <form id="issueForm" class="form form-grid">
        <div>
          <label>Issue Title</label>
          <input id="issueTitle" required>
        </div>

        <div>
          <label>Category</label>
          <select id="issueCategory">
            <option>Hardware</option>
            <option>Software</option>
            <option>Network</option>
            <option>Access</option>
            <option>Security</option>
            <option>Other</option>
          </select>
        </div>

        <div>
          <label>Priority</label>
          <select id="issuePriority">
            <option>Low</option>
            <option>Medium</option>
            <option>High</option>
            <option>Critical</option>
          </select>
        </div>

        <div>
          <label>Location</label>
          <input id="issueLocation" placeholder="Office / Department">
        </div>

        <div class="full">
          <label>Description</label>
          <textarea id="issueDescription" required></textarea>
        </div>

        <div class="full">
          <button class="primary-btn" type="submit">Submit Issue</button>
          <div id="issueMsg" class="form-message"></div>
        </div>
      </form>
    </div>
  `;

  $('issueForm').onsubmit = async e => {
    e.preventDefault();

    try {
      const data = await api('/api/issues', {
        method: 'POST',
        body: JSON.stringify({
          title: $('issueTitle').value,
          category: $('issueCategory').value,
          priority: $('issuePriority').value,
          location: $('issueLocation').value,
          description: $('issueDescription').value
        })
      });

      showMessage('issueMsg', `Issue #${data.id} submitted successfully.`, true);
      e.target.reset();
    } catch (err) {
      showMessage('issueMsg', err.message);
    }
  };
}

async function loadIssues() {
  issuesCache = await api('/api/issues');
  return issuesCache;
}

async function issues() {
  const rows = await loadIssues();

  $('content').innerHTML = `
    <div class="panel">
      <div class="toolbar">
        <input id="searchIssues" placeholder="Search issues">

        <select id="filterPriority">
          <option value="">All Priorities</option>
          <option>Critical</option>
          <option>High</option>
          <option>Medium</option>
          <option>Low</option>
        </select>

        <select id="filterStatus">
          <option value="">All Status</option>
          <option>Pending</option>
          <option>In Progress</option>
          <option>Resolved</option>
          <option>Closed</option>
        </select>

        <button id="refreshIssues" class="action-btn">Refresh</button>
      </div>

      <div id="issueList"></div>
    </div>
  `;

  const redraw = () => {
    let r = [...issuesCache];
    const q = $('searchIssues').value.toLowerCase();

    if (q) {
      r = r.filter(x => `${x.title} ${x.description} ${x.reporter_name || ''}`.toLowerCase().includes(q));
    }

    if ($('filterPriority').value) r = r.filter(x => x.priority === $('filterPriority').value);
    if ($('filterStatus').value) r = r.filter(x => x.status === $('filterStatus').value);

    $('issueList').innerHTML = issueTable(r, true);
    bindIssueButtons();
  };

  $('searchIssues').oninput = redraw;
  $('filterPriority').onchange = redraw;
  $('filterStatus').onchange = redraw;

  $('refreshIssues').onclick = async () => {
    await loadIssues();
    redraw();
  };

  redraw();
}

function issueTable(rows, actions = true) {
  if (!rows.length) return '<div class="empty">No records found</div>';

  return `
    <div class="table-wrap">
      <table class="data-table">
        <thead>
          <tr>
            <th style="width:55px">ID</th>
            <th>Issue</th>
            <th style="width:90px">Priority</th>
            <th style="width:105px">Status</th>
            <th>Reported By</th>
            <th>Assigned To</th>
            <th style="width:140px">Date</th>
            ${actions ? '<th style="width:150px">Action</th>' : ''}
          </tr>
        </thead>

        <tbody>
          ${rows.map(r => `
            <tr>
              <td>#${r.id}</td>
              <td>
                <strong>${escapeHtml(r.title)}</strong><br>
                <small>${escapeHtml(r.category || '')}</small>
              </td>
              <td>${badge(r.priority)}</td>
              <td>${statusBadge(r.status)}</td>
              <td>${escapeHtml(r.reporter_name || r.reporter || '')}</td>
              <td>${escapeHtml(r.assigned_name || r.assigned_to || 'Not assigned')}</td>
              <td>${fmt(r.created_at)}</td>
              ${actions ? `
                <td>
                  <button class="action-btn view-updates" data-id="${r.id}">Updates</button>
                  ${['admin', 'manager'].includes(currentUser.role) ? `<button class="action-btn assign-btn" data-id="${r.id}">Assign</button>` : ''}
                </td>
              ` : ''}
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function bindIssueButtons() {
  document.querySelectorAll('.view-updates').forEach(b => {
    b.onclick = () => showUpdatesModal(b.dataset.id);
  });

  document.querySelectorAll('.assign-btn').forEach(b => {
    b.onclick = () => assignModal(b.dataset.id);
  });
}

async function assignModal(id) {
  const staff = await api('/api/staff');

  modal(`
    <h3>Assign Issue #${id}</h3>

    <form id="assignForm" class="form">
      <label>IT Staff</label>
      <select id="assignStaff">
        ${staff.map(s => `
          <option value="${s.id}">
            ${escapeHtml(s.name)} - ${escapeHtml(s.staff_number || '')} ${s.active_issue_id ? '(Busy)' : '(Available)'}
          </option>
        `).join('')}
      </select>

      <label>Deadline</label>
      <input id="assignDeadline" type="datetime-local">

      <div class="modal-actions">
        <button type="button" class="secondary-btn close-modal">Cancel</button>
        <button class="primary-btn" type="submit">Assign</button>
      </div>

      <div id="assignMsg" class="form-message"></div>
    </form>
  `);

  $('assignForm').onsubmit = async e => {
    e.preventDefault();

    try {
      await api(`/api/issues/${id}/assign`, {
        method: 'PATCH',
        body: JSON.stringify({
          assigned_to: $('assignStaff').value,
          deadline_at: $('assignDeadline').value
            ? new Date($('assignDeadline').value).toISOString()
            : null
        })
      });

      closeModal();
      render('issues');
    } catch (err) {
      showMessage('assignMsg', err.message);
    }
  };
}

async function updates() {
  const rows = await loadIssues();

  $('content').innerHTML = `
    <div class="panel">
      <div class="toolbar">
        <select id="updateIssueSelect">
          ${rows.map(r => `<option value="${r.id}">#${r.id} - ${escapeHtml(r.title)}</option>`).join('')}
        </select>

        <button id="refreshUpdates" class="action-btn">Refresh</button>
      </div>

      <div id="updatesBox"></div>
    </div>
  `;

  async function draw() {
    const id = $('updateIssueSelect').value;

    if (!id) {
      $('updatesBox').innerHTML = '<div class="empty">No issues available</div>';
      return;
    }

    await showUpdatesInline(id);
  }

  $('updateIssueSelect').onchange = draw;
  $('refreshUpdates').onclick = draw;

  draw();
}

async function showUpdatesInline(id) {
  const ups = await api(`/api/issues/${id}/updates`);

  $('updatesBox').innerHTML = `
    <div class="grid-2">
      <div>
        <h3>Activity</h3>

        ${ups.length ? `
          <table class="data-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Status</th>
                <th>Message</th>
                <th>By</th>
              </tr>
            </thead>

            <tbody>
              ${ups.map(u => `
                <tr>
                  <td>${fmt(u.created_at)}</td>
                  <td>${statusBadge(u.status || 'Update')}</td>
                  <td>${escapeHtml(u.message)}</td>
                  <td>${escapeHtml(u.updated_by || '')}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        ` : '<div class="empty">No updates yet</div>'}
      </div>

      <div>
        <h3>Add Update</h3>

        <form id="statusForm" class="form">
          <label>Status</label>
          <select id="newStatus">
            <option>In Progress</option>
            <option>Resolved</option>
            <option>Closed</option>
          </select>

          <label>Message</label>
          <textarea id="statusMsg" placeholder="Enter update"></textarea>

          <button class="primary-btn" type="submit">Save Update</button>
          <div id="statusErr" class="form-message"></div>
        </form>
      </div>
    </div>
  `;

  $('statusForm').onsubmit = async e => {
    e.preventDefault();

    try {
      await api(`/api/issues/${id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({
          status: $('newStatus').value,
          message: $('statusMsg').value
        })
      });

      await showUpdatesInline(id);
    } catch (err) {
      showMessage('statusErr', err.message);
    }
  };
}

async function showUpdatesModal(id) {
  modal(`<div id="modalUpdates">Loading...</div>`);

  const ups = await api(`/api/issues/${id}/updates`);

  $('modalUpdates').innerHTML = `
    <h3>Issue #${id} Updates</h3>

    ${ups.length ? `
      <table class="data-table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Status</th>
            <th>Message</th>
            <th>By</th>
          </tr>
        </thead>

        <tbody>
          ${ups.map(u => `
            <tr>
              <td>${fmt(u.created_at)}</td>
              <td>${statusBadge(u.status || 'Update')}</td>
              <td>${escapeHtml(u.message)}</td>
              <td>${escapeHtml(u.updated_by || '')}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    ` : '<div class="empty">No updates yet</div>'}

    <div class="modal-actions">
      <button class="secondary-btn close-modal">Close</button>
    </div>
  `;

  bindModalClose();
}

async function users() {
  const rows = await api('/api/users');

  $('content').innerHTML = `
    <div class="panel">
      <h3>Create User</h3>

      <form id="userForm" class="form form-grid">
        <input id="uName" placeholder="Full name" required>
        <input id="uEmail" type="email" placeholder="Email" required>

        <select id="uRole">
          <option value="user">User</option>
          <option value="it_staff">IT Staff</option>
          <option value="manager">Manager</option>
          <option value="admin">Admin</option>
        </select>

        <input id="uPassword" placeholder="Password" value="User@123">
        <input id="uDepartment" placeholder="Department">
        <input id="uStaff" placeholder="Staff number">

        <div class="full">
          <button class="primary-btn" type="submit">Create User</button>
          <span id="userMsg" class="form-message"></span>
        </div>
      </form>
    </div>

    <div class="panel" style="margin-top:16px">
      <h3>User Accounts</h3>

      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Role</th>
              <th>Department</th>
              <th>Staff No.</th>
              <th>Status</th>
            </tr>
          </thead>

          <tbody>
            ${rows.map(u => `
              <tr>
                <td>${escapeHtml(u.name)}</td>
                <td>${escapeHtml(u.email)}</td>
                <td>${roleName(u.role)}</td>
                <td>${escapeHtml(u.department)}</td>
                <td>${escapeHtml(u.staff_number)}</td>
                <td>${u.active ? 'Active' : 'Disabled'}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;

  $('userForm').onsubmit = async e => {
    e.preventDefault();

    try {
      await api('/api/users', {
        method: 'POST',
        body: JSON.stringify({
          name: $('uName').value,
          email: $('uEmail').value,
          password: $('uPassword').value,
          role: $('uRole').value,
          department: $('uDepartment').value,
          staff_number: $('uStaff').value
        })
      });

      showMessage('userMsg', 'User created.', true);
      render('users');
    } catch (err) {
      showMessage('userMsg', err.message);
    }
  };
}

async function audit() {
  const rows = await api('/api/audit');

  $('content').innerHTML = `
    <div class="panel">
      <h3>Audit Logs</h3>

      <table class="data-table">
        <thead>
          <tr>
            <th>Date</th>
            <th>User</th>
            <th>Action</th>
            <th>Details</th>
          </tr>
        </thead>

        <tbody>
          ${rows.map(r => `
            <tr>
              <td>${fmt(r.created_at)}</td>
              <td>${escapeHtml(r.name || 'System')}</td>
              <td>${escapeHtml(r.action)}</td>
              <td>${escapeHtml(r.details)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function modal(html) {
  const d = document.createElement('div');
  d.className = 'modal';
  d.id = 'modal';
  d.innerHTML = `<div class="modal-card">${html}</div>`;
  document.body.appendChild(d);
  bindModalClose();
}

function closeModal() {
  const m = $('modal');
  if (m) m.remove();
}

function bindModalClose() {
  document.querySelectorAll('.close-modal').forEach(b => {
    b.onclick = closeModal;
  });
}

async function pollNotifications() {
  if (!currentUser) return;

  try {
    const rows = await api('/api/notifications');
    const unread = rows.filter(r => !r.read).length;

    if (unread > 0) {
      try {
        if ($('notifySound')) {
          $('notifySound').play().catch(() => {});
        }
      } catch {}

      await api('/api/notifications/read', { method: 'PATCH' });
    }
  } catch {}
}

boot();
