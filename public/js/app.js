const page = location.pathname.split('/').pop() || 'dashboard.html';
let me = null;
let lastUnreadCount = 0;
let liveCharts = {};
let dashboardLiveTimer = null;
const $ = (s)=>document.querySelector(s);
const app = $('#app');

async function api(url, opts={}){
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(url,{headers:{'Content-Type':'application/json'}, signal: controller.signal, ...opts});
    if(res.status===401){ location.href='/'; return; }
    const data = await res.json().catch(()=>({}));
    if(!res.ok) throw new Error(data.error || 'Request failed');
    return data;
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('The request took too long. Please confirm the server is running.');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
function formBusy(form, busy=true){
  if(!form) return;
  const btn = form.querySelector('button[type="submit"], button:not([type])');
  if(btn){ btn.disabled = busy; btn.dataset.originalText = btn.dataset.originalText || btn.textContent; btn.textContent = busy ? 'Processing...' : btn.dataset.originalText; }
}
function cls(x){ return String(x||'').replace(/\s+/g,''); }
function roleLabel(role){ return ({admin:'System Admin',manager:'Manager',it_staff:'IT Staff',user:'User'}[role] || role); }
function roleWelcome(role){ return ({admin:'ADMIN',manager:'MANAGER',it_staff:'IT STAFF',user:'USER'}[role] || String(role||'USER').toUpperCase()); }
function dashboardTitle(){ return ({admin:'Admin Dashboard',manager:'Manager Dashboard',it_staff:'IT Staff Dashboard',user:'User Dashboard'}[me.role] || 'Dashboard'); }
function welcomeText(){ return `Welcome ${roleWelcome(me.role)}`; }
function avatar(u=me, cls='mini-avatar'){ return u.profile_picture ? `<img src="${u.profile_picture}" class="${cls}">` : `<img src="assets/default-avatar.svg" class="${cls}">`; }
function canAdmin(){ return me.role==='admin'; }
function canAssign(){ return me.role==='manager'; }
function canResolve(){ return me.role==='it_staff'; }
function canReport(){ return ['admin','manager','it_staff','user'].includes(me.role); }
function canManageKnowledge(){ return ['admin','manager','it_staff'].includes(me.role); }
function isReporter(issue){ return Number(issue.reported_by)===Number(me.id); }
function navItem(href,label,roles=['admin','manager','it_staff','user']){ return roles.includes(me.role) ? `<a class="${page===href?'active':''}" href="/${href}">${label}</a>` : ''; }
function toast(message, type='info'){ const box=document.createElement('div'); box.className='toast '+type; box.textContent=message; document.body.appendChild(box); setTimeout(()=>box.remove(),6000); }
function ringNotification(){ try{ const ctx=new (window.AudioContext||window.webkitAudioContext)(); const master=ctx.createGain(); master.gain.setValueAtTime(0.001,ctx.currentTime); master.gain.exponentialRampToValueAtTime(0.18,ctx.currentTime+0.015); master.gain.exponentialRampToValueAtTime(0.001,ctx.currentTime+0.72); master.connect(ctx.destination); [[1046.5,0,0.11],[1396.9,0.14,0.13]].forEach(([freq,start,duration])=>{ const osc=ctx.createOscillator(); const gain=ctx.createGain(); osc.type='sine'; osc.frequency.value=freq; gain.gain.setValueAtTime(0.001,ctx.currentTime+start); gain.gain.exponentialRampToValueAtTime(0.24,ctx.currentTime+start+0.015); gain.gain.exponentialRampToValueAtTime(0.001,ctx.currentTime+start+duration); osc.connect(gain); gain.connect(master); osc.start(ctx.currentTime+start); osc.stop(ctx.currentTime+start+duration+0.02); }); }catch(e){} }
async function notificationPopup(showEmpty=false){ try{ const n=await api('/api/notifications'); const unread=n.filter(x=>!x.read); if(unread.length){ if(unread.length!==lastUnreadCount) ringNotification(); lastUnreadCount=unread.length; toast(unread[0].message,'notice'); } else if(showEmpty) { toast('No new notifications','notice'); } }catch(e){} }
function getHelpGuide(){
  const guides = {
    admin: {
      title: 'System Admin Help',
      items: [
        'Approve or reject new account registration requests.',
        'Create approved users and assign system roles.',
        'View audit log totals and monitor security activity.',
        'Manage backups and system accountability records.'
      ],
      note: ''
    },
    manager: {
      title: 'Manager Help',
      items: [
        'Open Issue Updates to review reported issues.',
        'Assign each issue to one available IT Staff member using staff number and department.',
        'Set a completion deadline when assigning an issue.',
        'Monitor deadline status, staff progress, assistance requests, and submitted reports.'
      ],
      note: 'Only the Manager assigns issues to IT Staff.'
    },
    it_staff: {
      title: 'IT Staff Help',
      items: [
        'Work only on the issue assigned to you.',
        'Update progress and submit a resolution report for review.',
        'Mark the issue as resolved when work is completed.',
        'Request external assistance from the Manager when the issue cannot be completed internally.'
      ],
      note: 'An IT Staff member can only handle one active issue at a time.'
    },
    user: {
      title: 'User Help',
      items: [
        'Report IT issues using the Report Issue page.',
        'Check dashboard notifications for progress updates.',
        'Review the resolution message when IT Staff complete the work.',
        'Confirm whether the issue has been resolved or not resolved.'
      ],
      note: ''
    }
  };
  return guides[me.role] || {title:'Help', items:['Use the menu to continue.'], note:''};
}

function openHelp(){
  const guide = getHelpGuide();
  const modal = document.getElementById('helpModal');
  if(!modal) return;
  document.getElementById('helpTitle').textContent = guide.title;
  document.getElementById('helpList').innerHTML = guide.items.map(item => `<li>${item}</li>`).join('');
  document.getElementById('helpNote').textContent = guide.note || '';
  modal.classList.add('show');
}
function closeHelp(){
  const modal = document.getElementById('helpModal');
  if(modal) modal.classList.remove('show');
}

document.addEventListener('keydown', e => {
  if(e.key === 'Escape') closeHelp();
});

function shell(title, content){
  app.innerHTML = `<div class="layout"><aside class="sidebar"><div class="logo logo-img-wrap"><img src="assets/ncdc-logo.png" class="side-logo" alt="NCDC Logo"></div><nav class="nav">
  ${navItem('dashboard.html','Dashboard')}
  ${navItem('report.html','Report Issue')}
  ${navItem('issues.html','Issue Updates')}
  ${navItem('profile.html','Profile')}
  ${navItem('knowledge.html','Knowledge Base')}
  ${navItem('reports.html','Reports',['manager'])}
  ${navItem('admin.html','Admin Panel',['admin'])}
  ${navItem('audit.html','Audit Logs',['admin'])}
  ${navItem('backup.html','Backup',['admin'])}
  <a href="#" onclick="logout()">Logout</a></nav></aside><main class="main"><div class="topbar ${page==='dashboard.html'?'dashboard-topbar':''}"><div class="topbar-title"><h1>${title}</h1><p class="welcome-line">${welcomeText()}</p></div><div class="top-actions"><button class="help-btn" onclick="openHelp()">Help</button><button class="notification-btn" onclick="notificationPopup(true)">Notifications</button><a href="/profile.html" class="user-pill profile-pill top-profile">${avatar(me)}<span><b>${me.name}</b><small>${roleLabel(me.role)}</small></span></a></div></div><div class="main-content">${content}</div><footer class="system-footer global-footer"><b>NCDC IT Issue Resolution Management System</b><br>Developed by Group 17 - Makerere University © 2026</footer></main></div><div id="helpModal" class="help-modal" onclick="if(event.target.id==='helpModal') closeHelp()"><div class="help-card"><button type="button" class="modal-close" onclick="closeHelp()">Close</button><h2 id="helpTitle">Help</h2><ul id="helpList"></ul><p id="helpNote" class="help-note"></p></div></div>`;
}
async function logout(){ await api('/api/logout',{method:'POST'}); location.href='/'; }
async function init(){ try { me = await api('/api/me'); await route(); notificationPopup(false); setInterval(()=>notificationPopup(false), 30000); } catch (err) { location.href='/'; } }
init();
async function route(){ if(page==='dashboard.html') return dashboard(); if(page==='report.html') return reportPage(); if(page==='issues.html') return issuesPage(); if(page==='profile.html') return profilePage(); if(page==='knowledge.html') return knowledgePage(); if(page==='reports.html') return reportsPage(); if(page==='admin.html') return adminPage(); if(page==='audit.html') return auditPage(); if(page==='backup.html') return backupPage(); dashboard(); }

async function dashboard(){
  shell(dashboardTitle(), `<section class="grid stats" id="stats"></section><section class="grid priority-split compact-section" id="prioritySplit"></section><section class="card compact-section"><h3>Active Members and Last Seen</h3><div id="activityList"></div></section><section class="grid charts compact-section"><div class="card"><h3>Live Issue Status</h3><canvas id="statusChart"></canvas></div><div class="card"><h3>Priority of Issues</h3><canvas id="priorityChart"></canvas></div><div class="card"><h3>Monthly Trend</h3><canvas id="monthChart"></canvas></div></section><section class="card compact-section"><h3>Latest Dashboard Notifications</h3><div id="notifications"></div></section><section class="card compact-section"><h3>Email Notification Log</h3><div id="emails"></div></section>`);
  await refreshDashboardData();
  if(dashboardLiveTimer) clearInterval(dashboardLiveTimer);
  dashboardLiveTimer = setInterval(()=>{ if(page==='dashboard.html') refreshDashboardData(true); }, 20000);
}
function createOrUpdateChart(id, type, labels, values, label){
  if(!window.Chart) return;
  const canvas = document.getElementById(id);
  if(!canvas) return;
  if(liveCharts[id]){
    liveCharts[id].data.labels = labels;
    liveCharts[id].data.datasets[0].data = values;
    liveCharts[id].update();
    return;
  }
  liveCharts[id] = new Chart(canvas,{type,data:{labels,datasets:[{label:label||'Issues',data:values,borderWidth:1}]},options:{responsive:true,maintainAspectRatio:false,animation:{duration:450},plugins:{legend:{display:type!=='bar'}}}});
}
async function refreshDashboardData(silent=false){
  const d = await api('/api/dashboard');
  const deadlineCard = me.role === 'user' ? '' : `<div class="card stat"><small>Deadline Danger</small><div class="value danger-text">${d.breached}</div></div>`;
  $('#stats').innerHTML = `<div class="card stat"><small>Total Issues</small><div class="value">${d.total}</div></div><div class="card stat"><small>Pending Issues</small><div class="value">${d.byStatus.Pending||0}</div></div><div class="card stat"><small>Resolved / Closed</small><div class="value">${(d.byStatus.Resolved||0)+(d.byStatus.Closed||0)}</div></div><div class="card stat"><small>Average Resolution Time</small><div class="value">${d.avgResolutionHours||'0.0'}h</div></div><div class="card stat"><small>Resolved Today</small><div class="value">${d.resolvedToday||0}</div></div><div class="card stat"><small>Completion Rate</small><div class="value">${d.completionRate||0}%</div></div>${deadlineCard}${canAdmin()?`<div class="card stat"><small>Pending Account Approvals</small><div class="value warning-text">${d.pendingUsers||0}</div></div><div class="card stat"><small>Total Audit Logs</small><div class="value">${d.auditLogs||0}</div></div>`:''}`;
  $('#prioritySplit').innerHTML = `<div class="card stat priority-card urgent"><small>Urgent Priority Issues</small><div class="value">${d.twoPriority?.urgent||0}</div><p>Critical and High open issues</p></div><div class="card stat priority-card normal"><small>Normal Priority Issues</small><div class="value">${d.twoPriority?.normal||0}</div><p>Medium and Low open issues</p></div>`;
  const members = await api('/api/users/activity').catch(()=>[]);
  $('#activityList').innerHTML = members.length ? `<div class="activity-grid">${members.map(u=>`<div class="activity-card ${u.online?'online':'offline'}">${avatar(u)}<div><b>${u.name}</b><small>${roleLabel(u.role)} - ${u.department||'No department'}</small><small>${u.online?'Active now':'Last seen: '+(u.last_seen?new Date(u.last_seen).toLocaleString():'Not yet seen')}</small></div></div>`).join('')}</div>` : '<p class="muted">No member activity yet.</p>';
  createOrUpdateChart('statusChart','doughnut',Object.keys(d.byStatus||{}),Object.values(d.byStatus||{}),'Status');
  const priorities = d.byPriority || {Critical:0,High:0,Medium:0,Low:0};
  createOrUpdateChart('priorityChart','bar',Object.keys(priorities),Object.values(priorities),'Priority');
  createOrUpdateChart('monthChart','line',(d.monthly||[]).map(x=>x.month),(d.monthly||[]).map(x=>x.count),'Issues');
  const n = await api('/api/notifications');
  $('#notifications').innerHTML = n.length?n.map(x=>`<p class="notice-row"><b>#${x.issue_id||''}</b> ${x.message}<br><small class="muted">${new Date(x.created_at).toLocaleString()}</small></p>`).join(''):'<p class="muted">No notifications yet.</p>';
  const emails = await api('/api/email-outbox').catch(()=>[]);
  $('#emails').innerHTML = emails.length ? emails.slice(0,8).map(e=>`<p class="email-row"><b>${e.subject}</b> - ${e.email}<br><small class="muted">${new Date(e.created_at).toLocaleString()} - ${e.status}</small></p>`).join('') : '<p class="muted">No email logs yet.</p>';
}

async function reportPage(){
  if(!canReport()) return shell('Report Issue','<div class="card"><h2>Access denied</h2><p>You do not have permission to report issues.</p></div>');
  shell('Report an IT Issue', `<div class="card"><form id="issueForm" class="form-grid"><input name="title" placeholder="Issue title e.g. Printer not working" required><select name="category" required><option value="">Select category</option><option>Hardware</option><option>Software</option><option>Network</option><option>Access</option><option>Email</option><option>Security</option></select><select name="priority" required><option value="">Priority level</option><option>Critical</option><option>High</option><option>Medium</option><option>Low</option></select><input name="location" placeholder="Office / department location"><input name="asset_tag" placeholder="Asset tag or device name"><input name="attachment_name" placeholder="Attachment name if any"><textarea class="full" name="description" placeholder="Describe the problem clearly" required></textarea><button class="full">Submit Issue</button></form><div id="msg"></div></div>`);
  $('#issueForm').onsubmit = async e=>{ e.preventDefault(); formBusy(e.target,true); try{ await api('/api/issues',{method:'POST',body:JSON.stringify(Object.fromEntries(new FormData(e.target)))}); $('#msg').innerHTML='<p class="notice">Issue submitted successfully.</p>'; e.target.reset(); }catch(err){ $('#msg').innerHTML='<p class="danger-text">'+err.message+'</p>'; } finally { formBusy(e.target,false); } };
}
async function issuesPage(){
  const deadlineHead = me.role === 'user' ? '' : '<th>Deadline</th>';
  shell('Issue Updates', `<div class="card filter-card"><h3>Search and Filter Issues</h3><div class="filter-grid"><input id="filterQ" placeholder="Search by title, description, reporter or staff"><select id="filterStatus"><option value="">All statuses</option><option>Pending</option><option>In Progress</option><option>Resolved</option><option>Closed</option></select><select id="filterPriority"><option value="">All priorities</option><option>Critical</option><option>High</option><option>Medium</option><option>Low</option></select><select id="filterCategory"><option value="">All categories</option><option>Hardware</option><option>Software</option><option>Network</option><option>Access</option><option>Email</option><option>Security</option></select><input id="filterFrom" type="date"><input id="filterTo" type="date"><button onclick="loadIssues()">Apply Filters</button><button class="ghost" onclick="clearIssueFilters()">Clear</button></div></div><div class="toolbar"><button type="button" id="refreshIssuesBtn" onclick="refreshIssues()">Refresh</button></div><div class="table-wrap"><table class="professional-table issues-table"><thead><tr><th>ID</th><th>Issue</th><th>Priority</th><th>Status</th>${deadlineHead}<th>Reporter</th><th>Assigned IT Staff</th><th>Action</th></tr></thead><tbody id="issueRows"></tbody></table></div><div id="timelineModal" class="help-modal" onclick="if(event.target.id==='timelineModal') closeTimeline()"><div class="help-card wide-modal"><button type="button" class="modal-close" onclick="closeTimeline()">Close</button><h2 id="timelineTitle">Issue Timeline</h2><div id="timelineBody"></div></div></div>`);
  loadIssues();
}
async function refreshIssues(){
  const btn=document.getElementById('refreshIssuesBtn');
  if(btn){ btn.disabled=true; btn.dataset.originalText=btn.dataset.originalText || btn.textContent; btn.textContent='Refreshing...'; }
  try{ await loadIssues(); toast('Issue updates refreshed.','notice'); }
  catch(e){ toast(e.message || 'Issue updates could not be refreshed.','error'); }
  finally{ if(btn){ btn.disabled=false; btn.textContent=btn.dataset.originalText || 'Refresh'; } }
}
function issueFilterQuery(){
  const p = new URLSearchParams();
  const ids=['filterQ','filterStatus','filterPriority','filterCategory','filterFrom','filterTo'];
  const keys=['q','status','priority','category','from','to'];
  ids.forEach((id,i)=>{ const el=document.getElementById(id); if(el && el.value) p.set(keys[i],el.value); });
  return p.toString() ? '?' + p.toString() : '';
}
function clearIssueFilters(){ ['filterQ','filterStatus','filterPriority','filterCategory','filterFrom','filterTo'].forEach(id=>{ const el=document.getElementById(id); if(el) el.value=''; }); loadIssues(); }
async function loadIssues(){
  const tbody = $('#issueRows');
  if(tbody) tbody.innerHTML = '<tr><td colspan="8">Loading issue updates...</td></tr>';
  const rows = await api('/api/issues' + issueFilterQuery()); const staff = canAssign() ? await api('/api/staff').catch(()=>[]) : [];
  $('#issueRows').innerHTML = rows.length ? rows.map(r=>{
    const showDeadline = me.role !== 'user';
    const rowClass = showDeadline && r.deadline_status==='Danger' ? 'deadline-danger' : '';
    const deadlineCell = showDeadline ? `<td><span class="badge ${cls(r.sla_status)}">${r.sla_status}</span><br><small>${new Date(r.sla_due).toLocaleString()}</small>${r.deadline_status==='Danger'?'<br><b class="danger-text">Deadline exceeded</b>':''}</td>` : '';
    return `<tr class="${rowClass}"><td>#${r.id}</td><td><b>${r.title}</b><br><small>${r.category} - ${r.location||'No location'} - ${new Date(r.created_at).toLocaleString()}</small><br>${r.description}</td><td><span class="badge priority-badge ${r.priority}">${r.priority}</span></td><td><span class="badge ${cls(r.status)}">${r.status}</span></td>${deadlineCell}<td>${r.reporter_name||'-'}</td><td>${r.assigned_name||'-'}<br><small>${r.assigned_staff_number||''} ${r.assigned_department||''}</small></td><td>${actionPanel(r,staff)}</td></tr>`;
  }).join('') : '<tr><td colspan="8">No issues match your search.</td></tr>';
}
async function openTimeline(id){
  const events = await api(`/api/issues/${id}/timeline`);
  document.getElementById('timelineTitle').textContent = 'Issue #' + id + ' Activity Timeline';
  document.getElementById('timelineBody').innerHTML = events.length ? `<div class="timeline-list">${events.map(e=>`<div class="timeline-item"><div class="timeline-dot"></div><div><b>${e.title}</b><p>${e.details}</p><small>${new Date(e.created_at).toLocaleString()}</small></div></div>`).join('')}</div>` : '<p class="muted">No timeline activity found.</p>';
  document.getElementById('timelineModal').classList.add('show');
}
function closeTimeline(){ const m=document.getElementById('timelineModal'); if(m) m.classList.remove('show'); }
function actionPanel(r,staff){
  let html='<div class="action-panel">';
  if(canAssign()){
    html += '<label class="tiny">Manager assignment by staff number and department</label>';
    html += '<select id="ass'+r.id+'">' + staff.map(u=>{ const busy=!!u.active_issue_id && Number(u.id)!==Number(r.assigned_to); const label=(u.staff_number||'No Staff No.')+' - '+u.name+' - '+(u.department||'No Department')+(busy?' - BUSY on Issue #'+u.active_issue_id:' - AVAILABLE'); return '<option value="'+u.id+'" '+(busy?'disabled':'')+'>'+label+'</option>'; }).join('') + '</select>';
    html += '<input id="deadline'+r.id+'" type="datetime-local" title="Completion deadline">';
    html += '<div class="staff-list">' + staff.map(u=>'<span class="staff-chip '+(u.active_issue_id?'busy':'available')+'">'+(u.staff_number||'No Staff No.')+' - '+u.name+' - '+(u.department||'No Department')+' - '+(u.active_issue_id?'Busy: Issue #'+u.active_issue_id:'Available')+'</span>').join('') + '</div>';
    html += '<button type="button" onclick="assignIssue('+r.id+')">Assign to IT Staff</button>';
    html += '<select id="pri'+r.id+'"><option '+(r.priority==='Critical'?'selected':'')+'>Critical</option><option '+(r.priority==='High'?'selected':'')+'>High</option><option '+(r.priority==='Medium'?'selected':'')+'>Medium</option><option '+(r.priority==='Low'?'selected':'')+'>Low</option></select><button type="button" class="ghost btn" onclick="changePriority('+r.id+')">Update Priority</button>';
  }
  if(canResolve()){
    html += '<label class="tiny">IT staff progress / resolution update</label><select id="st'+r.id+'"><option '+(r.status==='In Progress'?'selected':'')+'>In Progress</option><option '+(r.status==='Resolved'?'selected':'')+'>Resolved</option></select>';
    html += '<input id="msg'+r.id+'" placeholder="Progress or resolution message"><button type="button" class="ghost btn" onclick="updateStatus('+r.id+')">Send Update</button>';
    html += '<input id="helpmsg'+r.id+'" placeholder="Reason for external assistance"><button type="button" class="warning-btn" onclick="requestAssistance('+r.id+')">Request External Assistance</button>';
    html += '<input id="repmsg'+r.id+'" placeholder="Resolved issue report summary"><input id="repfile'+r.id+'" placeholder="Report file name e.g. report.pdf"><button type="button" class="success" onclick="uploadResolutionReport('+r.id+')">Upload Resolution Report</button>';
  }
  if(isReporter(r) && r.status==='Resolved') html += '<label class="tiny">Resolution confirmation</label><input id="fb'+r.id+'" placeholder="Write confirmation or reason"><button type="button" class="success" onclick="confirmClose('+r.id+')">Yes, Issue Resolved</button><button type="button" class="danger" onclick="reopenIssue('+r.id+')">No, Not Resolved</button>';
  html += '<button type="button" class="ghost btn" onclick="openTimeline('+r.id+')">View Activity Timeline</button>';
  if(html==='<div class="action-panel">') html+='<small class="muted">Track progress only</small>';
  return html+'</div>';
}
async function assignIssue(id){ try{ await api(`/api/issues/${id}/assign`,{method:'PATCH',body:JSON.stringify({assigned_to:$(`#ass${id}`).value,deadline_at:$(`#deadline${id}`).value})}); toast('Issue assigned successfully. Notifications and email logs have been sent.','notice'); await loadIssues(); }catch(e){ toast(e.message,'error'); } }
async function changePriority(id){ try{ await api(`/api/issues/${id}/priority`,{method:'PATCH',body:JSON.stringify({priority:$(`#pri${id}`).value})}); toast('Priority updated successfully.','notice'); await loadIssues(); }catch(e){ toast(e.message,'error'); } }
async function updateStatus(id){ try{ await api(`/api/issues/${id}/status`,{method:'PATCH',body:JSON.stringify({status:$(`#st${id}`).value,message:$(`#msg${id}`).value})}); toast('Issue update submitted successfully.','notice'); await loadIssues(); }catch(e){ toast(e.message,'error'); } }
async function requestAssistance(id){ try{ await api(`/api/issues/${id}/assistance`,{method:'POST',body:JSON.stringify({message:$(`#helpmsg${id}`).value})}); toast('External assistance request sent to the manager.','notice'); await loadIssues(); }catch(e){ toast(e.message,'error'); } }
async function uploadResolutionReport(id){ try{ await api(`/api/issues/${id}/resolution-report`,{method:'POST',body:JSON.stringify({report_message:$(`#repmsg${id}`).value,report_file:$(`#repfile${id}`).value})}); toast('Resolution report uploaded to the manager for review.','notice'); await loadIssues(); }catch(e){ toast(e.message,'error'); } }
async function confirmClose(id){ try{ await api(`/api/issues/${id}/confirm-close`,{method:'PATCH',body:JSON.stringify({feedback:$(`#fb${id}`).value})}); toast('Issue closure confirmed successfully.','notice'); await loadIssues(); }catch(e){ toast(e.message,'error'); } }
async function reopenIssue(id){ try{ await api(`/api/issues/${id}/reopen`,{method:'PATCH',body:JSON.stringify({feedback:$(`#fb${id}`).value||'Issue is not yet resolved.'})}); toast('Issue returned for further work.','notice'); await loadIssues(); }catch(e){ toast(e.message,'error'); } }

async function profilePage(){
  shell('My Profile', '<section class="grid profile-grid"><div class="card profile-card"><div class="avatar-wrap"><img id="previewAvatar" class="profile-avatar" src="" alt="Profile picture"><div><h3 id="profileName">My Profile</h3><p class="muted">Update your personal information and profile picture.</p></div></div><form id="profileForm" class="form-grid"><input name="name" placeholder="Full name" required><input name="email" type="email" placeholder="Email address" disabled><input name="department" placeholder="Department"><input name="staff_number" placeholder="Staff number"><input name="phone" placeholder="Phone contact"><textarea class="full" name="bio" placeholder="Short profile note / responsibility"></textarea><label class="full file-label">Upload Profile Picture<input type="file" id="profilePic" accept="image/*"></label><button class="full">Save Profile</button></form><div id="profileMsg"></div></div><div class="card"><h3>Change Password</h3><p class="muted">Use a password you can remember but others cannot easily guess.</p><form id="passwordForm"><div class="password-wrapper"><input id="currentPassword" name="current_password" type="password" placeholder="Current password" required><button type="button" class="password-toggle" data-toggle-password="currentPassword">Show</button></div><div class="password-wrapper"><input id="newPassword" name="new_password" type="password" placeholder="New password" required><button type="button" class="password-toggle" data-toggle-password="newPassword">Show</button></div><button>Change Password</button></form><div id="passMsg"></div></div></section>');
  const profile=await api('/api/profile');
  const f=$('#profileForm');
  f.name.value=profile.name||''; f.email.value=profile.email||''; f.department.value=profile.department||''; f.staff_number.value=profile.staff_number||''; f.phone.value=profile.phone||''; f.bio.value=profile.bio||'';
  $('#profileName').textContent=profile.name||'My Profile';
  $('#previewAvatar').src=profile.profile_picture || 'assets/default-avatar.svg';
  let profilePicture=profile.profile_picture||'';
  $('#profilePic').addEventListener('change', e=>{ const file=e.target.files[0]; if(!file) return; const reader=new FileReader(); reader.onload=()=>{ profilePicture=reader.result; $('#previewAvatar').src=profilePicture; }; reader.readAsDataURL(file); });
  f.onsubmit=async e=>{ e.preventDefault(); formBusy(e.target,true); const body=Object.fromEntries(new FormData(f)); body.profile_picture=profilePicture; delete body.email; try{ const r=await api('/api/profile',{method:'PATCH',body:JSON.stringify(body)}); me={...me,...r.user}; $('#profileMsg').innerHTML='<p class="notice">Profile updated successfully.</p>'; }catch(err){ $('#profileMsg').innerHTML='<p class="danger-text">'+err.message+'</p>'; } finally { formBusy(e.target,false); } };
  $('#passwordForm').onsubmit=async e=>{ e.preventDefault(); formBusy(e.target,true); const body=Object.fromEntries(new FormData(e.target)); try{ await api('/api/profile/password',{method:'PATCH',body:JSON.stringify(body)}); $('#passMsg').innerHTML='<p class="notice">Password changed successfully.</p>'; e.target.reset(); }catch(err){ $('#passMsg').innerHTML='<p class="danger-text">'+err.message+'</p>'; } finally { formBusy(e.target,false); } };
}

async function knowledgePage(){ shell('Knowledge Base', `<div class="grid" style="grid-template-columns:1fr ${canManageKnowledge()?'1fr':'0'}"><div id="kbList"></div>${canManageKnowledge()?`<div class="card"><h3>Add Solution</h3><form id="kbForm"><input name="title" placeholder="Article title" required><select name="category"><option>Hardware</option><option>Software</option><option>Network</option><option>Access</option><option>Email</option><option>Security</option></select><textarea name="solution" placeholder="Step-by-step solution" required></textarea><button>Save Knowledge Article</button></form></div>`:''}</div>`); const load=async()=>{const kb=await api('/api/knowledge'); $('#kbList').innerHTML=kb.map(k=>`<article class="kb-card"><span class="badge">${k.category}</span><h3>${k.title}</h3><p>${k.solution}</p><small class="muted">Created: ${new Date(k.created_at).toLocaleString()}</small></article>`).join('<br>');}; await load(); if(canManageKnowledge()) $('#kbForm').onsubmit=async e=>{e.preventDefault(); formBusy(e.target,true); try{ await api('/api/knowledge',{method:'POST',body:JSON.stringify(Object.fromEntries(new FormData(e.target)))}); e.target.reset(); await load(); toast('Knowledge article saved successfully.','notice'); }catch(err){ toast(err.message,'error'); } finally { formBusy(e.target,false); }}; }
async function reportsPage(){ if(me.role!=='manager') return shell('Reports','<div class="card">Only the manager can access issue management reports.</div>'); shell('Management Reports', `<div class="toolbar"><a class="btn" href="/api/reports/issues.csv">Download CSV</a><a class="btn" href="/api/reports/issues.xls">Download Excel</a><button onclick="window.print()">Print / Save as PDF</button></div><div class="card"><h3>Report Summary</h3><p>This page allows the manager to monitor issue performance, assignments, deadline status, resolution progress and staff workload.</p></div><div class="table-wrap" style="margin-top:18px"><table class="professional-table reports-table"><thead><tr><th>ID</th><th>Title</th><th>Category</th><th>Priority</th><th>Status</th><th>Assigned Staff</th><th>Department</th><th>Deadline</th><th>Date</th></tr></thead><tbody id="reportRows"></tbody></table></div>`); const rows=await api('/api/reports/issues.json'); $('#reportRows').innerHTML=rows.map(r=>`<tr><td>#${r.id}</td><td>${r.title}</td><td>${r.category}</td><td>${r.priority}</td><td>${r.status}</td><td>${r.assigned_to||'-'}<br><small>${r.assigned_staff_number||''}</small></td><td>${r.assigned_department||'-'}</td><td>${r.deadline_at?new Date(r.deadline_at).toLocaleString():'-'}</td><td>${new Date(r.created_at).toLocaleDateString()}</td></tr>`).join(''); }
async function adminPage(){ if(!canAdmin()) return shell('Admin Panel','<div class="card"><h2>Access denied</h2><p>Only the system administrator can access the Admin Panel.</p></div>'); shell('Admin Panel', `<div class="grid stats" id="adminStats"></div><section class="card"><h3>Create Approved User</h3><form id="userForm" class="form-grid admin-create-grid"><input name="name" placeholder="Full name" required><input name="email" type="email" placeholder="Email" required><div class="password-wrapper"><input id="adminCreatePassword" name="password" type="password" placeholder="Password e.g. user123"><button type="button" class="password-toggle" data-toggle-password="adminCreatePassword">Show</button></div><select name="role"><option value="user">User</option><option value="it_staff">IT Staff</option><option value="manager">Manager</option><option value="admin">System Admin</option></select><input name="department" placeholder="Department"><input name="staff_number" placeholder="Staff number"><input name="phone" placeholder="Phone"><button class="full">Create User</button></form></section><div class="table-wrap admin-users-wrap" style="margin-top:18px"><table class="professional-table admin-users-table"><thead><tr><th>User</th><th>Role and Status</th><th>Department / Staff No.</th><th>Admin Action</th></tr></thead><tbody id="users"></tbody></table></div>`); const d=await api('/api/dashboard'); $('#adminStats').innerHTML=`<div class="card stat"><small>Total Audit Logs</small><div class="value">${d.auditLogs||0}</div></div><div class="card stat"><small>Pending Approvals</small><div class="value warning-text">${d.pendingUsers||0}</div></div>`; await loadUsers(); $('#userForm').onsubmit=async e=>{e.preventDefault(); formBusy(e.target,true); try{ await api('/api/users',{method:'POST',body:JSON.stringify(Object.fromEntries(new FormData(e.target)))}); e.target.reset(); await loadUsers(); toast('User account created successfully.','notice'); }catch(err){ toast(err.message,'error'); } finally { formBusy(e.target,false); }}; }
async function loadUsers(){ const users=await api('/api/users'); $('#users').innerHTML=users.map(u=>`<tr><td><b>${u.name}</b><br><small>${u.email}</small><br><small>${u.phone||''}</small></td><td><span class="badge">${roleLabel(u.role)}</span><br><span class="badge ${u.approval_status}">${u.approval_status||'approved'}</span><br><small>${u.active?'Active':'Inactive'}</small></td><td><b>${u.department||'-'}</b><br><small>${u.staff_number||'-'}</small></td><td><div class="admin-action-box"><select id="role${u.id}"><option ${u.role==='user'?'selected':''} value="user">User</option><option ${u.role==='it_staff'?'selected':''} value="it_staff">IT Staff</option><option ${u.role==='manager'?'selected':''} value="manager">Manager</option><option ${u.role==='admin'?'selected':''} value="admin">System Admin</option></select><button onclick="changeRole(${u.id})">Save</button>${u.approval_status!=='approved'?`<button class="success" onclick="approveUser(${u.id})">Approve</button>`:''}<button class="ghost" onclick="toggleUser(${u.id},${u.active?0:1})">${u.active?'Disable':'Activate'}</button><button class="danger" onclick="rejectUser(${u.id})">Reject</button></div></td></tr>`).join(''); }
async function changeRole(id){ try{ await api(`/api/users/${id}`,{method:'PATCH',body:JSON.stringify({role:$(`#role${id}`).value})}); toast('Role updated successfully.','notice'); await loadUsers(); }catch(e){ toast(e.message,'error'); } }
async function approveUser(id){ try{ await api(`/api/users/${id}/approve`,{method:'PATCH'}); toast('Account approved and email notification recorded.','notice'); await loadUsers(); }catch(e){ toast(e.message,'error'); } }
async function rejectUser(id){ try{ await api(`/api/users/${id}/reject`,{method:'PATCH'}); toast('Account rejected successfully.','notice'); await loadUsers(); }catch(e){ toast(e.message,'error'); } }
async function toggleUser(id,active){ try{ await api(`/api/users/${id}`,{method:'PATCH',body:JSON.stringify({active,approval_status:active?'approved':'pending'})}); toast('Account status updated successfully.','notice'); await loadUsers(); }catch(e){ toast(e.message,'error'); } }
async function auditPage(){ if(!canAdmin()) return shell('Audit Logs','<div class="card">Only admin can view audit logs.</div>'); shell('Audit Logs', `<div class="table-wrap"><table class="professional-table"><thead><tr><th>Date</th><th>User</th><th>Action</th><th>Details</th></tr></thead><tbody id="auditRows"></tbody></table></div>`); const rows=await api('/api/audit'); $('#auditRows').innerHTML=rows.map(a=>`<tr><td>${new Date(a.created_at).toLocaleString()}</td><td>${a.name||'System'}</td><td><span class="badge">${a.action}</span></td><td>${a.details||''}</td></tr>`).join(''); }
async function backupPage(){ if(!canAdmin()) return shell('Backup & Restore','<div class="card">Only admin can access backup tools.</div>'); shell('Backup & Recovery', `<div class="card"><h3>Database Backup</h3><p>Create a safe copy of the system database. Backups are saved inside the project folder under <b>backups</b>.</p><button onclick="createBackup()">Create Backup</button><div id="bkMsg"></div></div><div class="card" style="margin-top:18px"><h3>Restore Note</h3><p>For safety, restore preparation creates a file named <b>restore-next-start.db</b>. The administrator can replace <b>database.db</b> with that file when the server is stopped.</p></div><div class="table-wrap" style="margin-top:18px"><table class="professional-table"><thead><tr><th>Backup file</th><th>Created</th><th>Action</th></tr></thead><tbody id="backups"></tbody></table></div>`); loadBackups(); }
async function createBackup(){ const r=await api('/api/backup',{method:'POST'}); $('#bkMsg').innerHTML=`<p class="notice">Backup created: ${r.file}</p>`; loadBackups(); }
async function loadBackups(){ const rows=await api('/api/backups'); $('#backups').innerHTML=rows.map(b=>`<tr><td>${b.file}</td><td>${new Date(b.created).toLocaleString()}</td><td><a class="btn" href="/api/backups/${b.file}/download">Download</a><button class="ghost" onclick="prepareRestore('${b.file}')">Prepare Restore</button></td></tr>`).join(''); }
async function prepareRestore(file){ const r=await api('/api/restore',{method:'POST',body:JSON.stringify({file})}); $('#bkMsg').innerHTML=`<p class="notice">${r.message}</p>`; }

document.addEventListener('click', (event) => {
  const button = event.target.closest('[data-toggle-password]');
  if (!button) return;
  const input = document.getElementById(button.dataset.togglePassword);
  if (!input) return;
  const showing = input.type === 'text';
  input.type = showing ? 'password' : 'text';
  button.textContent = showing ? 'Show' : 'Hide';
});
