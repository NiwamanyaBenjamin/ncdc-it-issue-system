
require('dotenv').config();

const express = require('express');
const session = require('express-session');
const PgSession = require('connect-pg-simple')(session);
const bcrypt = require('bcryptjs');
const path = require('path');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;
const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) console.warn('DATABASE_URL is not set. Add your Neon/PostgreSQL connection string.');

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

app.set('trust proxy', 1);
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'same-origin');
  next();
});

app.use(session({
  name: 'ncdc_issue_sid',
  store: new PgSession({ pool, tableName: 'session', createTableIfMissing: true }),
  secret: process.env.SESSION_SECRET || 'ncdc_group17_change_this_secret',
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: false,
    maxAge: 1000 * 60 * 60 * 8
  }
}));

app.use(express.static(path.join(__dirname, 'public')));

const q = (text, params = []) => pool.query(text, params);
const one = async (text, params = []) => (await q(text, params)).rows[0];
const many = async (text, params = []) => (await q(text, params)).rows;
const now = () => new Date().toISOString();
const roles = ['admin', 'manager', 'it_staff', 'user'];

function isEmail(v) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v || '').trim()); }
function passwordMessage(v) { if (!v || v.length < 6) return 'Password must be at least 6 characters.'; return null; }
function slaHours(priority) { return ({ Critical: 2, High: 8, Medium: 24, Low: 48 }[priority] || 24); }
function dueDate(priority) { const d = new Date(); d.setHours(d.getHours() + slaHours(priority)); return d.toISOString(); }
function roleOk(role) { return roles.includes(role); }
function formatCsvValue(v) { return '"' + String(v ?? '').replace(/"/g, '""') + '"'; }

const requireAuth = (req, res, next) => req.session.user ? next() : res.status(401).json({ error: 'Login required' });
const requireRole = (...allowed) => (req, res, next) => allowed.includes(req.session.user?.role) ? next() : res.status(403).json({ error: 'Access denied' });

async function audit(req, action, details = '') {
  try { await q('INSERT INTO audit_logs(user_id, action, details) VALUES ($1,$2,$3)', [req.session.user?.id || null, action, details]); } catch (e) { console.error('Audit failed:', e.message); }
}
async function emailLog(userId, issueId, email, subject, body, status = 'queued') {
  await q('INSERT INTO email_outbox(user_id, issue_id, email, subject, body, status) VALUES ($1,$2,$3,$4,$5,$6)', [userId, issueId, email || '', subject || '', body || '', status]);
}
async function notify(userId, message, issueId = null, subject = 'NCDC IT Issue System Notification') {
  if (!userId) return;
  await q('INSERT INTO notifications(user_id, issue_id, message) VALUES ($1,$2,$3)', [userId, issueId, message]);
  const u = await one('SELECT email FROM users WHERE id=$1', [userId]);
  if (u?.email) await emailLog(userId, issueId, u.email, subject, message, 'queued');
}
async function notifyRole(role, message, issueId = null, subject = 'NCDC IT Issue System Notification') {
  const users = await many('SELECT id FROM users WHERE role=$1 AND active=true AND approval_status=$2', [role, 'approved']);
  for (const u of users) await notify(u.id, message, issueId, subject);
}
async function canViewIssue(user, issueId) {
  const issue = await one('SELECT * FROM issues WHERE id=$1', [issueId]);
  if (!issue) return null;
  if (user.role === 'admin' || user.role === 'manager') return issue;
  if (user.role === 'it_staff' && (Number(issue.assigned_to) === Number(user.id) || Number(issue.reported_by) === Number(user.id))) return issue;
  if (Number(issue.reported_by) === Number(user.id)) return issue;
  return false;
}
function addSla(row) {
  const due = row.deadline_at || row.created_at;
  const breached = !['Resolved', 'Closed'].includes(row.status) && due && new Date() > new Date(due);
  row.sla_due = due;
  row.sla_status = ['Resolved', 'Closed'].includes(row.status) ? 'Completed' : (breached ? 'Breached' : 'Within SLA');
  row.deadline_status = breached ? 'Danger' : 'Safe';
  return row;
}

async function init() {
  await q(`CREATE TABLE IF NOT EXISTS users(
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user',
    department TEXT DEFAULT '',
    staff_number TEXT DEFAULT '',
    phone TEXT DEFAULT '',
    profile_picture TEXT DEFAULT '',
    bio TEXT DEFAULT '',
    active BOOLEAN DEFAULT true,
    approval_status TEXT DEFAULT 'approved',
    created_by INTEGER,
    approved_by INTEGER,
    approved_at TIMESTAMPTZ,
    last_seen TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`);
  await q(`CREATE TABLE IF NOT EXISTS issues(
    id SERIAL PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    category TEXT NOT NULL,
    priority TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'Pending',
    reported_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    assigned_to INTEGER REFERENCES users(id) ON DELETE SET NULL,
    assigned_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    location TEXT DEFAULT '',
    department TEXT DEFAULT '',
    asset_tag TEXT DEFAULT '',
    attachment_name TEXT DEFAULT '',
    assistance_requested BOOLEAN DEFAULT false,
    deadline_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    resolved_at TIMESTAMPTZ
  )`);
  await q(`CREATE TABLE IF NOT EXISTS issue_updates(
    id SERIAL PRIMARY KEY,
    issue_id INTEGER REFERENCES issues(id) ON DELETE CASCADE,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    status TEXT,
    message TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`);
  await q(`CREATE TABLE IF NOT EXISTS issue_reports(
    id SERIAL PRIMARY KEY,
    issue_id INTEGER REFERENCES issues(id) ON DELETE CASCADE,
    staff_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    report_message TEXT DEFAULT '',
    report_file TEXT DEFAULT '',
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`);
  await q(`CREATE TABLE IF NOT EXISTS notifications(
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    issue_id INTEGER REFERENCES issues(id) ON DELETE CASCADE,
    message TEXT NOT NULL,
    read BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`);
  await q(`CREATE TABLE IF NOT EXISTS email_outbox(
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    issue_id INTEGER REFERENCES issues(id) ON DELETE SET NULL,
    email TEXT DEFAULT '',
    subject TEXT DEFAULT '',
    body TEXT DEFAULT '',
    status TEXT DEFAULT 'queued',
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`);
  await q(`CREATE TABLE IF NOT EXISTS knowledge_base(
    id SERIAL PRIMARY KEY,
    title TEXT NOT NULL,
    category TEXT DEFAULT '',
    solution TEXT NOT NULL,
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`);
  await q(`CREATE TABLE IF NOT EXISTS audit_logs(
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    action TEXT NOT NULL,
    details TEXT DEFAULT '',
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`);
  await q(`CREATE TABLE IF NOT EXISTS password_resets(
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    reset_code TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    used BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`);
  await q(`CREATE TABLE IF NOT EXISTS backup_records(
    id SERIAL PRIMARY KEY,
    file TEXT NOT NULL,
    created TIMESTAMPTZ DEFAULT NOW(),
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL
  )`);

  const demo = [
    ['NIWAMANYA BENJAMIN','niwamanyabenjamin023@gmail.com','Maggie@56','admin','ICT Administration','ADM-001','0702686882'],
    ['KIKULWE JOHN','kjohncyrus@gmail.com','john253313','manager','Management','MGT-001','0755659039'],
    ['CHEMUTAI FLORENCE','chemutaiflo28@gmail.com','florence28','it_staff','ICT Support','IT-001','076062937'],
    ['BUGODYO JOEL','bugodyojoel531@gmail.com','joel531','it_staff','Network Support','IT-002','0763999562'],
    ['CHEMTAI PATIENCE','chemtaipatience@gmail.com','patience@','user','Curriculum','USR-001','0783721086']
  ];
  for (const u of demo) {
    const hash = await bcrypt.hash(u[2], 6);
    const exists = await one('SELECT id FROM users WHERE LOWER(email)=LOWER($1)', [u[1]]);
    if (exists) {
      await q(`UPDATE users SET name=$1,password=$2,role=$3,department=$4,staff_number=$5,phone=$6,active=true,approval_status='approved',approved_at=NOW(),last_seen=COALESCE(last_seen,NOW()) WHERE LOWER(email)=LOWER($7)`, [u[0],hash,u[3],u[4],u[5],u[6],u[1]]);
    } else {
      await q(`INSERT INTO users(name,email,password,role,department,staff_number,phone,active,approval_status,approved_at) VALUES($1,$2,$3,$4,$5,$6,$7,true,'approved',NOW())`, [u[0],u[1],hash,u[3],u[4],u[5],u[6]]);
    }
  }
  const kbCount = await one('SELECT COUNT(*)::int c FROM knowledge_base');
  if (!kbCount || kbCount.c === 0) {
    await q(`INSERT INTO knowledge_base(title,category,solution,created_by) VALUES
      ('Printer not responding','Hardware','Check power, cables, paper tray and restart the printer. If it continues, report the issue to ICT support.',1),
      ('Slow internet connection','Network','Restart the network adapter, test another website and report the affected office or device.',1),
      ('Email login problem','Access','Confirm the email address and request secure password help if login still fails.',1)`);
  }
}

app.get('/health', (req, res) => res.json({ status: 'ok', system: 'NCDC IT Issue Resolution Management System' }));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));

app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!isEmail(email) || !password) return res.status(400).json({ error: 'Enter a valid email and password.' });
    const user = await one('SELECT * FROM users WHERE LOWER(email)=LOWER($1)', [email]);
    if (!user || !(await bcrypt.compare(password, user.password))) return res.status(401).json({ error: 'Invalid email or password.' });
    if (!user.active || user.approval_status !== 'approved') return res.status(403).json({ error: 'Account is not active.' });
    req.session.regenerate(async err => {
      if (err) return res.status(500).json({ error: 'Could not create session.' });
      req.session.user = { id: user.id, name: user.name, email: user.email, role: user.role, department: user.department };
      await q('UPDATE users SET last_seen=NOW() WHERE id=$1', [user.id]);
      await audit(req, 'LOGIN', 'User logged in');
      req.session.save(saveErr => {
        if (saveErr) return res.status(500).json({ error: 'Could not save session.' });
        res.json({ success: true, user: req.session.user });
      });
    });
  } catch (e) { console.error('Login error:', e); res.status(500).json({ error: 'Login failed.' }); }
});
app.post('/api/logout', requireAuth, async (req, res) => { await audit(req, 'LOGOUT', 'User logged out'); req.session.destroy(() => res.json({ success: true })); });
app.get('/api/me', requireAuth, async (req, res) => {
  const u = await one('SELECT id,name,email,role,department,staff_number,phone,profile_picture,bio,last_seen FROM users WHERE id=$1', [req.session.user.id]);
  res.json(u);
});
app.post('/api/register', async (req, res) => {
  const { name, email, password, department, staff_number, phone } = req.body;
  if (!name || !isEmail(email) || !password) return res.status(400).json({ error: 'Name, valid email and password are required.' });
  const pw = passwordMessage(password); if (pw) return res.status(400).json({ error: pw });
  const exists = await one('SELECT id FROM users WHERE LOWER(email)=LOWER($1)', [email]);
  if (exists) return res.status(409).json({ error: 'Email already exists.' });
  await q(`INSERT INTO users(name,email,password,role,department,staff_number,phone,active,approval_status) VALUES($1,$2,$3,'user',$4,$5,$6,false,'pending')`, [name,email,await bcrypt.hash(password,6),department||'',staff_number||'',phone||'']);
  await notifyRole('admin', `New account request from ${name} (${email}) requires administrator approval.`, null, 'New account request');
  res.json({ success: true, message: 'Account request submitted.' });
});
app.post('/api/forgot-password', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email is required.' });
  const u = await one('SELECT id,name,email FROM users WHERE LOWER(email)=LOWER($1)', [email]);
  if (u) {
    const code = String(Math.floor(100000 + Math.random() * 900000));
    await q('INSERT INTO password_resets(user_id,reset_code,expires_at) VALUES($1,$2,NOW()+INTERVAL \'15 minutes\')', [u.id, code]);
    await notifyRole('admin', `Password reset requested by ${u.name}. Reset code: ${code}`, null, 'Password reset request');
    await emailLog(u.id, null, u.email, 'NCDC password reset code', `Your password reset code is ${code}.`, 'queued');
  }
  res.json({ success: true, message: 'If the email exists, a reset code has been generated.' });
});
app.post('/api/reset-password', async (req, res) => {
  const { email, reset_code, new_password } = req.body;
  if (!email || !reset_code || !new_password) return res.status(400).json({ error: 'Email, reset code and new password are required.' });
  const pw = passwordMessage(new_password); if (pw) return res.status(400).json({ error: pw });
  const u = await one('SELECT id FROM users WHERE LOWER(email)=LOWER($1)', [email]);
  if (!u) return res.status(400).json({ error: 'Invalid reset details.' });
  const reset = await one('SELECT * FROM password_resets WHERE user_id=$1 AND reset_code=$2 AND used=false AND expires_at>NOW() ORDER BY created_at DESC LIMIT 1', [u.id, reset_code]);
  if (!reset) return res.status(400).json({ error: 'Invalid or expired reset code.' });
  await q('UPDATE users SET password=$1 WHERE id=$2', [await bcrypt.hash(new_password, 6), u.id]);
  await q('UPDATE password_resets SET used=true WHERE id=$1', [reset.id]);
  res.json({ success: true });
});

app.use('/api', requireAuth, async (req, res, next) => { q('UPDATE users SET last_seen=NOW() WHERE id=$1', [req.session.user.id]).catch(() => {}); next(); });

app.get('/api/dashboard', async (req, res) => {
  const rows = await many('SELECT * FROM issues');
  const byStatus = Object.fromEntries(['Pending','In Progress','Resolved','Closed'].map(s => [s, rows.filter(r => r.status === s).length]));
  const byPriority = Object.fromEntries(['Critical','High','Medium','Low'].map(p => [p, rows.filter(r => r.priority === p).length]));
  const active = rows.filter(r => !['Resolved','Closed'].includes(r.status));
  const breached = active.filter(r => r.deadline_at && new Date() > new Date(r.deadline_at)).length;
  const resolvedRows = rows.filter(r => r.resolved_at);
  const avgResolutionHours = resolvedRows.length ? (resolvedRows.reduce((a,r)=>a + (new Date(r.resolved_at)-new Date(r.created_at))/(1000*60*60),0)/resolvedRows.length).toFixed(1) : '0.0';
  const today = new Date().toISOString().slice(0,10);
  const resolvedToday = rows.filter(r => r.resolved_at && String(r.resolved_at).slice(0,10) === today).length;
  const completionRate = rows.length ? Math.round(((byStatus.Resolved||0)+(byStatus.Closed||0))*100/rows.length) : 0;
  const pendingUsers = req.session.user.role === 'admin' ? (await one("SELECT COUNT(*)::int c FROM users WHERE approval_status='pending' OR active=false")).c : 0;
  const auditLogs = req.session.user.role === 'admin' ? (await one('SELECT COUNT(*)::int c FROM audit_logs')).c : 0;
  const monthly = await many("SELECT TO_CHAR(created_at,'YYYY-MM') month, COUNT(*)::int count FROM issues GROUP BY 1 ORDER BY 1");
  res.json({ total: rows.length, byStatus, byPriority, twoPriority: { urgent: active.filter(r=>['Critical','High'].includes(r.priority)).length, normal: active.filter(r=>['Medium','Low'].includes(r.priority)).length }, breached, pendingUsers, auditLogs, monthly, avgResolutionHours, resolvedToday, completionRate });
});
app.get('/api/users/activity', async (req, res) => {
  const hideAdmin = req.session.user.role !== 'admin';
  const rows = await many(`SELECT id,name,email,role,department,staff_number,profile_picture,last_seen FROM users WHERE active=true AND approval_status='approved' ${hideAdmin ? "AND role<>'admin'" : ''} ORDER BY role,name`);
  const cutoff = Date.now() - 5*60*1000;
  res.json(rows.map(u => ({ ...u, online: u.last_seen && new Date(u.last_seen).getTime() >= cutoff })));
});
app.get('/api/email-outbox', async (req, res) => {
  if (['admin','manager'].includes(req.session.user.role)) return res.json(await many('SELECT * FROM email_outbox ORDER BY created_at DESC LIMIT 100'));
  res.json(await many('SELECT * FROM email_outbox WHERE user_id=$1 ORDER BY created_at DESC LIMIT 30', [req.session.user.id]));
});

app.get('/api/issues', async (req, res) => {
  const params = []; const filters = [];
  if (req.session.user.role === 'user') { params.push(req.session.user.id); filters.push(`i.reported_by=$${params.length}`); }
  if (req.session.user.role === 'it_staff') { params.push(req.session.user.id); filters.push(`(i.assigned_to=$${params.length} OR i.reported_by=$${params.length})`); }
  if (req.query.status) { params.push(req.query.status); filters.push(`i.status=$${params.length}`); }
  if (req.query.priority) { params.push(req.query.priority); filters.push(`i.priority=$${params.length}`); }
  if (req.query.category) { params.push(req.query.category); filters.push(`i.category=$${params.length}`); }
  if (req.query.from) { params.push(req.query.from); filters.push(`DATE(i.created_at)>=DATE($${params.length})`); }
  if (req.query.to) { params.push(req.query.to); filters.push(`DATE(i.created_at)<=DATE($${params.length})`); }
  if (req.query.q) { params.push(`%${req.query.q}%`); filters.push(`(i.title ILIKE $${params.length} OR i.description ILIKE $${params.length} OR u.name ILIKE $${params.length} OR s.name ILIKE $${params.length})`); }
  const where = filters.length ? 'WHERE ' + filters.join(' AND ') : '';
  const rows = await many(`SELECT i.*,u.name reporter_name,s.name assigned_name,s.staff_number assigned_staff_number,s.department assigned_department,m.name manager_name FROM issues i LEFT JOIN users u ON u.id=i.reported_by LEFT JOIN users s ON s.id=i.assigned_to LEFT JOIN users m ON m.id=i.assigned_by ${where} ORDER BY i.created_at DESC`, params);
  res.json(rows.map(addSla));
});
app.post('/api/issues', async (req, res) => {
  const { title, description, category, priority, location, department, asset_tag, attachment_name } = req.body;
  if (!title || !description || !category || !priority) return res.status(400).json({ error: 'Fill all required issue details.' });
  if (!['Critical','High','Medium','Low'].includes(priority)) return res.status(400).json({ error: 'Invalid priority.' });
  const created = await one(`INSERT INTO issues(title,description,category,priority,status,reported_by,location,department,asset_tag,attachment_name,deadline_at) VALUES($1,$2,$3,$4,'Pending',$5,$6,$7,$8,$9,$10) RETURNING id`, [title,description,category,priority,req.session.user.id,location||'',department||req.session.user.department||'',asset_tag||'',attachment_name||'',dueDate(priority)]);
  await q('INSERT INTO issue_updates(issue_id,user_id,status,message) VALUES($1,$2,$3,$4)', [created.id, req.session.user.id, 'Pending', 'Issue reported']);
  await notify(req.session.user.id, `Issue #${created.id} has been submitted.`, created.id, 'Issue submitted successfully');
  await notifyRole('manager', `New issue #${created.id} requires assignment.`, created.id, 'New issue waiting for assignment');
  await audit(req, 'CREATE_ISSUE', `Issue #${created.id}`);
  res.json({ success: true, id: created.id });
});
app.patch('/api/issues/:id/assign', requireRole('manager'), async (req, res) => {
  const { assigned_to, deadline_at } = req.body;
  const issue = await one('SELECT * FROM issues WHERE id=$1', [req.params.id]);
  if (!issue) return res.status(404).json({ error: 'Issue not found.' });
  const staff = await one("SELECT id,name,staff_number,department FROM users WHERE id=$1 AND role='it_staff' AND active=true AND approval_status='approved'", [assigned_to]);
  if (!staff) return res.status(400).json({ error: 'Select an active IT staff member.' });
  const busy = await one("SELECT id FROM issues WHERE assigned_to=$1 AND status IN ('Pending','In Progress','Resolved') AND id<>$2 LIMIT 1", [assigned_to, req.params.id]);
  if (busy) return res.status(409).json({ error: `${staff.name} is already assigned to an active issue.` });
  const finalDeadline = deadline_at ? new Date(deadline_at).toISOString() : issue.deadline_at;
  await q("UPDATE issues SET assigned_to=$1,assigned_by=$2,status='In Progress',deadline_at=$3,updated_at=NOW() WHERE id=$4", [assigned_to, req.session.user.id, finalDeadline, req.params.id]);
  await q('INSERT INTO issue_updates(issue_id,user_id,status,message) VALUES($1,$2,$3,$4)', [req.params.id, req.session.user.id, 'In Progress', `Assigned to ${staff.name}`]);
  await notify(assigned_to, `Issue #${req.params.id} has been assigned to you.`, req.params.id, 'Issue assigned to you');
  if (issue.reported_by) await notify(issue.reported_by, `Your issue #${req.params.id} has been assigned to ${staff.name}.`, req.params.id, 'Your issue has been assigned');
  await audit(req, 'ASSIGN_ISSUE', `Issue #${req.params.id} to ${staff.name}`);
  res.json({ success: true });
});
app.patch('/api/issues/:id/priority', requireRole('manager'), async (req, res) => {
  const { priority } = req.body;
  if (!['Critical','High','Medium','Low'].includes(priority)) return res.status(400).json({ error: 'Invalid priority.' });
  await q('UPDATE issues SET priority=$1,updated_at=NOW() WHERE id=$2', [priority, req.params.id]);
  await q('INSERT INTO issue_updates(issue_id,user_id,status,message) VALUES($1,$2,$3,$4)', [req.params.id, req.session.user.id, null, `Priority changed to ${priority}`]);
  await audit(req, 'UPDATE_PRIORITY', `Issue #${req.params.id} priority ${priority}`);
  res.json({ success: true });
});
app.patch('/api/issues/:id/status', async (req, res) => {
  const issue = await canViewIssue(req.session.user, req.params.id);
  if (!issue) return res.status(issue === null ? 404 : 403).json({ error: 'Issue not found or access denied.' });
  const { status, message } = req.body;
  if (!['Pending','In Progress','Resolved','Closed'].includes(status)) return res.status(400).json({ error: 'Invalid status.' });
  if (req.session.user.role === 'it_staff' && Number(issue.assigned_to) !== Number(req.session.user.id) && Number(issue.reported_by) !== Number(req.session.user.id)) return res.status(403).json({ error: 'Access denied.' });
  const resolved = status === 'Resolved' ? 'NOW()' : 'resolved_at';
  await q(`UPDATE issues SET status=$1,updated_at=NOW(),resolved_at=${resolved} WHERE id=$2`, [status, req.params.id]);
  await q('INSERT INTO issue_updates(issue_id,user_id,status,message) VALUES($1,$2,$3,$4)', [req.params.id, req.session.user.id, status, message || `Status changed to ${status}`]);
  if (issue.reported_by) await notify(issue.reported_by, `Issue #${req.params.id} updated to ${status}.`, req.params.id, 'Issue progress update');
  if (issue.assigned_by) await notify(issue.assigned_by, `Issue #${req.params.id} updated to ${status}.`, req.params.id, 'Assigned issue status update');
  await audit(req, 'UPDATE_ISSUE', `Issue #${req.params.id} status ${status}`);
  res.json({ success: true });
});
app.post('/api/issues/:id/assistance', requireRole('it_staff'), async (req, res) => {
  const issue = await canViewIssue(req.session.user, req.params.id);
  if (!issue) return res.status(403).json({ error: 'Access denied.' });
  const message = req.body.message || 'External assistance requested.';
  await q('UPDATE issues SET assistance_requested=true,updated_at=NOW() WHERE id=$1', [req.params.id]);
  await q('INSERT INTO issue_updates(issue_id,user_id,status,message) VALUES($1,$2,$3,$4)', [req.params.id, req.session.user.id, issue.status, 'External assistance requested: ' + message]);
  if (issue.assigned_by) await notify(issue.assigned_by, `External assistance requested for issue #${req.params.id}. Reason: ${message}`, req.params.id, 'External assistance requested');
  await audit(req, 'REQUEST_ASSISTANCE', `Issue #${req.params.id}`);
  res.json({ success: true });
});
app.post('/api/issues/:id/resolution-report', requireRole('it_staff'), async (req, res) => {
  const issue = await canViewIssue(req.session.user, req.params.id);
  if (!issue) return res.status(403).json({ error: 'Access denied.' });
  const { report_message, report_file } = req.body;
  await q('INSERT INTO issue_reports(issue_id,staff_id,report_message,report_file) VALUES($1,$2,$3,$4)', [req.params.id, req.session.user.id, report_message || '', report_file || '']);
  await q('INSERT INTO issue_updates(issue_id,user_id,status,message) VALUES($1,$2,$3,$4)', [req.params.id, req.session.user.id, issue.status, 'Resolution report uploaded: ' + (report_message || report_file || '')]);
  if (issue.assigned_by) await notify(issue.assigned_by, `Resolution report uploaded for issue #${req.params.id}.`, req.params.id, 'Resolution report uploaded');
  await audit(req, 'UPLOAD_RESOLUTION_REPORT', `Issue #${req.params.id}`);
  res.json({ success: true });
});
app.patch('/api/issues/:id/confirm-close', async (req, res) => {
  const issue = await canViewIssue(req.session.user, req.params.id);
  if (!issue || Number(issue.reported_by) !== Number(req.session.user.id)) return res.status(403).json({ error: 'Access denied.' });
  await q("UPDATE issues SET status='Closed',updated_at=NOW() WHERE id=$1", [req.params.id]);
  await q('INSERT INTO issue_updates(issue_id,user_id,status,message) VALUES($1,$2,$3,$4)', [req.params.id, req.session.user.id, 'Closed', req.body.feedback || 'Issue confirmed resolved.']);
  if (issue.assigned_to) await notify(issue.assigned_to, `Issue #${req.params.id} has been confirmed and closed.`, req.params.id, 'User confirmed issue resolved');
  res.json({ success: true });
});
app.patch('/api/issues/:id/reopen', async (req, res) => {
  const issue = await canViewIssue(req.session.user, req.params.id);
  if (!issue || Number(issue.reported_by) !== Number(req.session.user.id)) return res.status(403).json({ error: 'Access denied.' });
  await q("UPDATE issues SET status='In Progress',resolved_at=NULL,updated_at=NOW() WHERE id=$1", [req.params.id]);
  await q('INSERT INTO issue_updates(issue_id,user_id,status,message) VALUES($1,$2,$3,$4)', [req.params.id, req.session.user.id, 'In Progress', req.body.feedback || 'Issue is not yet resolved.']);
  if (issue.assigned_to) await notify(issue.assigned_to, `Issue #${req.params.id} was returned for further work.`, req.params.id, 'User rejected resolution');
  res.json({ success: true });
});
app.get('/api/issues/:id/timeline', async (req, res) => {
  const issue = await canViewIssue(req.session.user, req.params.id);
  if (!issue) return res.status(403).json({ error: 'Access denied.' });
  const events = [];
  const reporter = await one('SELECT name FROM users WHERE id=$1', [issue.reported_by]);
  events.push({ created_at: issue.created_at, title: 'Issue reported', details: `Reported by ${reporter?.name || 'User'}` });
  const updates = await many('SELECT up.*,u.name updated_by_name FROM issue_updates up LEFT JOIN users u ON u.id=up.user_id WHERE issue_id=$1', [req.params.id]);
  for (const u of updates) events.push({ created_at: u.created_at, title: u.status || 'Issue update', details: `${u.message}${u.updated_by_name ? ' - ' + u.updated_by_name : ''}` });
  const reports = await many('SELECT r.*,u.name staff_name FROM issue_reports r LEFT JOIN users u ON u.id=r.staff_id WHERE issue_id=$1', [req.params.id]);
  for (const r of reports) events.push({ created_at: r.created_at, title: 'Resolution report submitted', details: `${r.report_message || ''} ${r.report_file || ''} ${r.staff_name ? '- '+r.staff_name : ''}` });
  res.json(events.sort((a,b)=>new Date(a.created_at)-new Date(b.created_at)));
});

app.get('/api/profile', async (req,res)=>{ const u=await one('SELECT id,name,email,role,department,staff_number,phone,profile_picture,bio,approval_status,active,created_at FROM users WHERE id=$1',[req.session.user.id]); res.json(u); });
app.patch('/api/profile', async (req,res)=>{ const {name,department,staff_number,phone,bio,profile_picture}=req.body; if(!name) return res.status(400).json({error:'Name is required.'}); await q('UPDATE users SET name=$1,department=$2,staff_number=$3,phone=$4,bio=$5,profile_picture=$6 WHERE id=$7',[name,department||'',staff_number||'',phone||'',bio||'',profile_picture||'',req.session.user.id]); const u=await one('SELECT id,name,email,role,department,staff_number,phone,profile_picture,bio FROM users WHERE id=$1',[req.session.user.id]); req.session.user={id:u.id,name:u.name,email:u.email,role:u.role,department:u.department}; req.session.save(()=>{}); res.json({success:true,user:u}); });
app.patch('/api/profile/password', async (req,res)=>{ const {current_password,new_password}=req.body; const u=await one('SELECT password FROM users WHERE id=$1',[req.session.user.id]); if(!u || !(await bcrypt.compare(current_password||'',u.password))) return res.status(400).json({error:'Current password is incorrect.'}); const pw=passwordMessage(new_password); if(pw) return res.status(400).json({error:pw}); await q('UPDATE users SET password=$1 WHERE id=$2',[await bcrypt.hash(new_password,6),req.session.user.id]); res.json({success:true}); });

app.get('/api/staff', requireRole('admin','manager'), async (req,res)=>{ const rows=await many(`SELECT u.id,u.name,u.email,u.department,u.staff_number,i.id active_issue_id,i.title active_issue_title FROM users u LEFT JOIN issues i ON i.assigned_to=u.id AND i.status IN ('Pending','In Progress','Resolved') WHERE u.role='it_staff' AND u.active=true AND u.approval_status='approved' ORDER BY u.staff_number,u.name`); res.json(rows); });
app.get('/api/users', requireRole('admin','manager'), async (req,res)=>{ const rows=await many('SELECT id,name,email,role,department,staff_number,phone,active,approval_status,last_seen,created_at,approved_at FROM users ORDER BY role,name'); res.json(rows); });
app.post('/api/users', requireRole('admin'), async (req,res)=>{ const {name,email,password,role,department,staff_number,phone}=req.body; if(!name||!isEmail(email)||!roleOk(role)) return res.status(400).json({error:'Enter valid user details.'}); const pw=passwordMessage(password||'User@123'); if(pw) return res.status(400).json({error:pw}); const exists=await one('SELECT id FROM users WHERE LOWER(email)=LOWER($1)',[email]); if(exists) return res.status(409).json({error:'Email already exists.'}); await q('INSERT INTO users(name,email,password,role,department,staff_number,phone,active,approval_status,created_by,approved_by,approved_at) VALUES($1,$2,$3,$4,$5,$6,$7,true,\'approved\',$8,$8,NOW())',[name,email,await bcrypt.hash(password||'User@123',6),role,department||'',staff_number||'',phone||'',req.session.user.id]); await audit(req,'CREATE_USER',email); res.json({success:true}); });
app.patch('/api/users/:id', requireRole('admin'), async (req,res)=>{ const {role,active,approval_status}=req.body; if(role && !roleOk(role)) return res.status(400).json({error:'Invalid role.'}); await q('UPDATE users SET role=COALESCE($1,role),active=COALESCE($2,active),approval_status=COALESCE($3,approval_status),approved_by=CASE WHEN $3=\'approved\' THEN $4 ELSE approved_by END,approved_at=CASE WHEN $3=\'approved\' THEN NOW() ELSE approved_at END WHERE id=$5',[role,typeof active==='boolean'?active:null,approval_status||null,req.session.user.id,req.params.id]); await audit(req,'UPDATE_USER',`User #${req.params.id}`); res.json({success:true}); });
app.patch('/api/users/:id/approve', requireRole('admin'), async (req,res)=>{ await q("UPDATE users SET active=true,approval_status='approved',approved_by=$1,approved_at=NOW() WHERE id=$2",[req.session.user.id,req.params.id]); await audit(req,'APPROVE_USER',`User #${req.params.id}`); res.json({success:true}); });
app.patch('/api/users/:id/reject', requireRole('admin'), async (req,res)=>{ await q("UPDATE users SET active=false,approval_status='rejected',approved_by=$1,approved_at=NOW() WHERE id=$2",[req.session.user.id,req.params.id]); await audit(req,'REJECT_USER',`User #${req.params.id}`); res.json({success:true}); });

app.get('/api/knowledge', async (req,res)=>res.json(await many('SELECT * FROM knowledge_base ORDER BY created_at DESC')));
app.post('/api/knowledge', requireRole('admin','manager','it_staff'), async (req,res)=>{ const {title,category,solution}=req.body; if(!title||!solution) return res.status(400).json({error:'Title and solution are required.'}); await q('INSERT INTO knowledge_base(title,category,solution,created_by) VALUES($1,$2,$3,$4)',[title,category||'',solution,req.session.user.id]); res.json({success:true}); });
app.get('/api/notifications', async (req,res)=>res.json(await many('SELECT * FROM notifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT 40',[req.session.user.id])));
app.patch('/api/notifications/read', async (req,res)=>{ await q('UPDATE notifications SET read=true WHERE user_id=$1',[req.session.user.id]); res.json({success:true}); });
app.get('/api/audit', requireRole('admin'), async (req,res)=>res.json(await many('SELECT a.*,u.name FROM audit_logs a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.created_at DESC LIMIT 100')));

async function reportRows(){ return await many('SELECT i.id,i.title,i.category,i.priority,i.status,u.name reported_by,s.name assigned_to,s.staff_number assigned_staff_number,s.department assigned_department,i.location,i.asset_tag,i.deadline_at,i.created_at,i.updated_at,i.resolved_at FROM issues i LEFT JOIN users u ON u.id=i.reported_by LEFT JOIN users s ON s.id=i.assigned_to ORDER BY i.created_at DESC'); }
app.get('/api/reports/issues.json', requireRole('manager'), async (req,res)=>res.json(await reportRows()));
app.get('/api/reports/issues.csv', requireRole('manager'), async (req,res)=>{ const rows=await reportRows(); const h=['id','title','category','priority','status','reported_by','assigned_to','assigned_staff_number','assigned_department','location','asset_tag','deadline_at','created_at','updated_at','resolved_at']; const csv=[h.join(','),...rows.map(r=>h.map(k=>formatCsvValue(r[k])).join(','))].join('\n'); res.setHeader('Content-Type','text/csv'); res.setHeader('Content-Disposition','attachment; filename="ncdc-issue-report.csv"'); res.send(csv); });
app.get('/api/reports/issues.xls', requireRole('manager'), async (req,res)=>{ const rows=await reportRows(); const h=['id','title','category','priority','status','reported_by','assigned_to','assigned_staff_number','assigned_department','location','asset_tag','deadline_at','created_at']; const html='<table><tr>'+h.map(x=>'<th>'+x+'</th>').join('')+'</tr>'+rows.map(r=>'<tr>'+h.map(k=>'<td>'+String(r[k]??'')+'</td>').join('')+'</tr>').join('')+'</table>'; res.setHeader('Content-Type','application/vnd.ms-excel'); res.setHeader('Content-Disposition','attachment; filename="ncdc-issue-report.xls"'); res.send(html); });
app.post('/api/backup', requireRole('admin'), async (req,res)=>{ const file=`postgres-backup-${Date.now()}.json`; await q('INSERT INTO backup_records(file,created_by) VALUES($1,$2)',[file,req.session.user.id]); await audit(req,'BACKUP_DATABASE',file); res.json({success:true,file}); });
app.get('/api/backups', requireRole('admin'), async (req,res)=>res.json(await many('SELECT file,created FROM backup_records ORDER BY created DESC')));
app.get('/api/backups/:file/download', requireRole('admin'), async (req,res)=>{ const users=await many('SELECT id,name,email,role,department,staff_number,phone,active,approval_status,created_at FROM users ORDER BY id'); const issues=await reportRows(); res.setHeader('Content-Type','application/json'); res.setHeader('Content-Disposition',`attachment; filename="${req.params.file.replace(/[^a-zA-Z0-9_.-]/g,'')}"`); res.json({created_at:new Date().toISOString(),users,issues}); });
app.post('/api/restore', requireRole('admin'), async (req,res)=>res.json({success:true,message:'Restore preparation recorded. Use the downloaded backup file for database review.'}));

init().then(() => app.listen(PORT, () => console.log(`NCDC IT Issue System running on port ${PORT}`))).catch(err => { console.error('Startup failed:', err); process.exit(1); });
