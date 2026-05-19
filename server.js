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

if (!DATABASE_URL) {
  console.warn('DATABASE_URL is not set. Add PostgreSQL connection string before deployment.');
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

app.set('trust proxy', 1);
app.use(express.json({ limit: '8mb' }));
app.use(express.urlencoded({ extended: true }));
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'same-origin');
  next();
});
app.use(session({
  store: new PgSession({ pool, tableName: 'session', createTableIfMissing: true }),
  secret: process.env.SESSION_SECRET || 'group17_change_this_secret',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 1000 * 60 * 60 * 8 }
}));
app.use(express.static(path.join(__dirname, 'public')));

const q = (text, params=[]) => pool.query(text, params);
const one = async (text, params=[]) => (await q(text, params)).rows[0];
const many = async (text, params=[]) => (await q(text, params)).rows;
const now = () => new Date().toISOString();
const roles = ['admin','manager','it_staff','user'];
const requireAuth = (req,res,next)=> req.session.user ? next() : res.status(401).json({error:'Login required'});
const requireRole = (...allowed)=>(req,res,next)=> allowed.includes(req.session.user?.role) ? next() : res.status(403).json({error:'Access denied'});
const roleLabel = r => ({admin:'Admin',manager:'Manager',it_staff:'IT Staff',user:'User'}[r] || r);
function isEmail(v){ return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v||'')); }
function passwordMessage(v){ if(!v || v.length < 6) return 'Password must be at least 6 characters.'; return null; }
function dueDate(priority){ const h = {Critical:2, High:8, Medium:24, Low:48}[priority] || 24; const d = new Date(); d.setHours(d.getHours()+h); return d.toISOString(); }
async function audit(req, action, details=''){ try { await q('INSERT INTO audit_logs(user_id, action, details) VALUES ($1,$2,$3)', [req.session.user?.id || null, action, details]); } catch(e){} }
async function notify(userId, message, issueId=null){ if(!userId) return; await q('INSERT INTO notifications(user_id, issue_id, message) VALUES ($1,$2,$3)', [userId, issueId, message]); }
async function notifyRole(role, message, issueId=null){ const users = await many('SELECT id FROM users WHERE role=$1 AND active=true AND approval_status=$2', [role,'approved']); for(const u of users) await notify(u.id, message, issueId); }
async function visibleIssueWhere(user, baseParams=[]){
  if(user.role === 'admin' || user.role === 'manager') return { where:'', params:baseParams };
  if(user.role === 'it_staff') return { where:`WHERE (i.assigned_to=$${baseParams.length+1} OR i.reported_by=$${baseParams.length+1})`, params:[...baseParams,user.id] };
  return { where:`WHERE i.reported_by=$${baseParams.length+1}`, params:[...baseParams,user.id] };
}
async function canViewIssue(user, issueId){
  const issue = await one('SELECT * FROM issues WHERE id=$1', [issueId]);
  if(!issue) return null;
  if(user.role === 'admin' || user.role === 'manager') return issue;
  if(user.role === 'it_staff' && (issue.assigned_to === user.id || issue.reported_by === user.id)) return issue;
  if(issue.reported_by === user.id) return issue;
  return false;
}

async function init(){
  await q(`CREATE TABLE IF NOT EXISTS users(
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user',
    department TEXT DEFAULT '',
    staff_number TEXT DEFAULT '',
    phone TEXT DEFAULT '',
    active BOOLEAN DEFAULT true,
    approval_status TEXT DEFAULT 'approved',
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
  await q(`CREATE TABLE IF NOT EXISTS notifications(
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    issue_id INTEGER REFERENCES issues(id) ON DELETE CASCADE,
    message TEXT NOT NULL,
    read BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`);
  await q(`CREATE TABLE IF NOT EXISTS audit_logs(
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    action TEXT NOT NULL,
    details TEXT DEFAULT '',
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`);
  const demo = [
    ['System Admin','admin@ncdc.local','Admin@123','admin','ICT Administration','ADM-001','0700000001'],
    ['IT Manager','manager@ncdc.local','Manager@123','manager','ICT Management','MGT-001','0700000002'],
    ['IT Staff One','staff@ncdc.local','Staff@123','it_staff','ICT Support','IT-001','0700000003'],
    ['NCDC User','user@ncdc.local','User@123','user','Curriculum','USR-001','0700000004']
  ];
  for(const d of demo){
    const exists = await one('SELECT id FROM users WHERE email=$1', [d[1]]);
    const hash = await bcrypt.hash(d[2], 10);
    if(exists){
      await q('UPDATE users SET name=$1,password=$2,role=$3,department=$4,staff_number=$5,phone=$6,active=true,approval_status=$7 WHERE email=$8', [d[0],hash,d[3],d[4],d[5],d[6],'approved',d[1]]);
    } else {
      await q('INSERT INTO users(name,email,password,role,department,staff_number,phone,active,approval_status) VALUES($1,$2,$3,$4,$5,$6,$7,true,$8)', [d[0],d[1],hash,d[3],d[4],d[5],d[6],'approved']);
    }
  }
}

app.get('/health', (req,res)=>res.json({status:'ok', system:'NCDC IT Issue Resolution Management System'}));
app.get('/', (req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));

app.post('/api/login', async (req,res)=>{
  const {email,password}=req.body;
  if(!isEmail(email) || !password) return res.status(400).json({error:'Enter a valid email and password.'});
  const user = await one('SELECT * FROM users WHERE LOWER(email)=LOWER($1)', [email]);
  if(!user || !(await bcrypt.compare(password, user.password))) return res.status(401).json({error:'Invalid email or password.'});
  if(!user.active || user.approval_status !== 'approved') return res.status(403).json({error:'Account is not active.'});
  req.session.regenerate(async err=>{
    if(err) return res.status(500).json({error:'Could not create session.'});
    req.session.user = {id:user.id,name:user.name,email:user.email,role:user.role,department:user.department};
    await q('UPDATE users SET last_seen=NOW() WHERE id=$1',[user.id]);
    await audit(req,'LOGIN','User logged in');
    res.json({success:true,user:req.session.user});
  });
});
app.post('/api/logout', requireAuth, async (req,res)=>{ await audit(req,'LOGOUT','User logged out'); req.session.destroy(()=>res.json({success:true})); });
app.get('/api/me', requireAuth, async (req,res)=>{ const u=await one('SELECT id,name,email,role,department,staff_number,phone,last_seen FROM users WHERE id=$1',[req.session.user.id]); res.json(u); });
app.post('/api/register', async (req,res)=>{
  const {name,email,password,department,phone}=req.body;
  if(!name || !isEmail(email) || !password) return res.status(400).json({error:'Name, valid email and password are required.'});
  const pw = passwordMessage(password); if(pw) return res.status(400).json({error:pw});
  const exist=await one('SELECT id FROM users WHERE LOWER(email)=LOWER($1)',[email]); if(exist) return res.status(409).json({error:'Email already exists.'});
  await q('INSERT INTO users(name,email,password,role,department,phone,active,approval_status) VALUES($1,$2,$3,$4,$5,$6,false,$7)', [name,email,await bcrypt.hash(password,10),'user',department||'',phone||'','pending']);
  await notifyRole('admin', `New account request from ${name}.`);
  res.json({success:true,message:'Account request submitted.'});
});

app.use('/api', requireAuth, async (req,res,next)=>{ q('UPDATE users SET last_seen=NOW() WHERE id=$1',[req.session.user.id]).catch(()=>{}); next(); });

app.get('/api/dashboard', async (req,res)=>{
  const total = await one('SELECT COUNT(*)::int c FROM issues');
  const mine = await one('SELECT COUNT(*)::int c FROM issues WHERE reported_by=$1 OR assigned_to=$1',[req.session.user.id]);
  const status = await many('SELECT status, COUNT(*)::int count FROM issues GROUP BY status ORDER BY status');
  const priority = await many('SELECT priority, COUNT(*)::int count FROM issues GROUP BY priority ORDER BY priority');
  const recent = await many(`SELECT i.id,i.title,i.priority,i.status,i.created_at,u.name reporter,s.name assigned_to
    FROM issues i LEFT JOIN users u ON u.id=i.reported_by LEFT JOIN users s ON s.id=i.assigned_to
    ORDER BY i.created_at DESC LIMIT 8`);
  const users = req.session.user.role === 'admin' ? (await one('SELECT COUNT(*)::int c FROM users')).c : 0;
  res.json({total:total.c,mine:mine.c,status,priority,recent,users});
});

app.get('/api/issues', async (req,res)=>{
  let params=[]; const filters=[];
  if(req.session.user.role === 'user'){ params.push(req.session.user.id); filters.push(`i.reported_by=$${params.length}`); }
  if(req.session.user.role === 'it_staff'){ params.push(req.session.user.id); filters.push(`(i.assigned_to=$${params.length} OR i.reported_by=$${params.length})`); }
  if(req.query.status){ params.push(req.query.status); filters.push(`i.status=$${params.length}`); }
  if(req.query.priority){ params.push(req.query.priority); filters.push(`i.priority=$${params.length}`); }
  if(req.query.q){ params.push(`%${req.query.q}%`); filters.push(`(i.title ILIKE $${params.length} OR i.description ILIKE $${params.length} OR u.name ILIKE $${params.length})`); }
  const where = filters.length ? 'WHERE '+filters.join(' AND ') : '';
  const rows = await many(`SELECT i.*,u.name reporter_name,s.name assigned_name,s.staff_number assigned_staff_number
    FROM issues i LEFT JOIN users u ON u.id=i.reported_by LEFT JOIN users s ON s.id=i.assigned_to
    ${where} ORDER BY i.created_at DESC`, params);
  res.json(rows);
});
app.post('/api/issues', async (req,res)=>{
  const {title,description,category,priority,location,department}=req.body;
  if(!title || !description || !category || !priority) return res.status(400).json({error:'Fill all required issue details.'});
  if(!['Critical','High','Medium','Low'].includes(priority)) return res.status(400).json({error:'Invalid priority.'});
  const created = await one(`INSERT INTO issues(title,description,category,priority,status,reported_by,location,department,deadline_at)
    VALUES($1,$2,$3,$4,'Pending',$5,$6,$7,$8) RETURNING id`, [title,description,category,priority,req.session.user.id,location||'',department||req.session.user.department||'',dueDate(priority)]);
  await q('INSERT INTO issue_updates(issue_id,user_id,status,message) VALUES($1,$2,$3,$4)', [created.id, req.session.user.id, 'Pending', 'Issue reported']);
  await notify(req.session.user.id, `Issue #${created.id} has been submitted.`, created.id);
  await notifyRole('manager', `New issue #${created.id} requires assignment.`, created.id);
  await audit(req,'CREATE_ISSUE',`Issue #${created.id}`);
  res.json({success:true,id:created.id});
});
app.patch('/api/issues/:id/assign', requireRole('manager','admin'), async (req,res)=>{
  const {assigned_to, deadline_at}=req.body;
  const staff = await one("SELECT id,name FROM users WHERE id=$1 AND role='it_staff' AND active=true", [assigned_to]);
  if(!staff) return res.status(400).json({error:'Select an active IT staff member.'});
  const busy = await one("SELECT id FROM issues WHERE assigned_to=$1 AND status IN ('Pending','In Progress') AND id<>$2 LIMIT 1", [assigned_to, req.params.id]);
  if(busy) return res.status(409).json({error:'This IT staff already has an active issue.'});
  await q("UPDATE issues SET assigned_to=$1,assigned_by=$2,status='In Progress',deadline_at=COALESCE($3,deadline_at),updated_at=NOW() WHERE id=$4", [assigned_to,req.session.user.id,deadline_at||null,req.params.id]);
  await q('INSERT INTO issue_updates(issue_id,user_id,status,message) VALUES($1,$2,$3,$4)', [req.params.id,req.session.user.id,'In Progress',`Assigned to ${staff.name}`]);
  await notify(assigned_to, `Issue #${req.params.id} has been assigned to you.`, req.params.id);
  await audit(req,'ASSIGN_ISSUE',`Issue #${req.params.id} to ${staff.name}`);
  res.json({success:true});
});
app.patch('/api/issues/:id/status', async (req,res)=>{
  const issue = await canViewIssue(req.session.user, req.params.id);
  if(!issue) return res.status(issue===null?404:403).json({error:'Issue not found or access denied.'});
  const {status,message}=req.body;
  const allowed = ['Pending','In Progress','Resolved','Closed'];
  if(!allowed.includes(status)) return res.status(400).json({error:'Invalid status.'});
  if(req.session.user.role === 'user' && issue.reported_by !== req.session.user.id) return res.status(403).json({error:'Access denied.'});
  const resolved = status === 'Resolved' ? 'NOW()' : 'resolved_at';
  await q(`UPDATE issues SET status=$1,updated_at=NOW(),resolved_at=${resolved} WHERE id=$2`, [status, req.params.id]);
  await q('INSERT INTO issue_updates(issue_id,user_id,status,message) VALUES($1,$2,$3,$4)', [req.params.id,req.session.user.id,status,message || `Status changed to ${status}`]);
  if(issue.reported_by) await notify(issue.reported_by, `Issue #${req.params.id} updated to ${status}.`, req.params.id);
  if(issue.assigned_to) await notify(issue.assigned_to, `Issue #${req.params.id} updated to ${status}.`, req.params.id);
  await audit(req,'UPDATE_ISSUE',`Issue #${req.params.id} status ${status}`);
  res.json({success:true});
});
app.get('/api/issues/:id/updates', async (req,res)=>{
  const issue = await canViewIssue(req.session.user, req.params.id);
  if(!issue) return res.status(issue===null?404:403).json({error:'Issue not found or access denied.'});
  const rows = await many('SELECT up.*,u.name updated_by FROM issue_updates up LEFT JOIN users u ON u.id=up.user_id WHERE issue_id=$1 ORDER BY up.created_at DESC',[req.params.id]);
  res.json(rows);
});

app.get('/api/users', requireRole('admin','manager'), async (req,res)=>{
  const rows = await many('SELECT id,name,email,role,department,staff_number,phone,active,approval_status,last_seen,created_at FROM users ORDER BY role,name');
  res.json(rows);
});
app.post('/api/users', requireRole('admin'), async (req,res)=>{
  const {name,email,password,role,department,staff_number,phone}=req.body;
  if(!name || !isEmail(email) || !roles.includes(role)) return res.status(400).json({error:'Enter valid user details.'});
  const pw = passwordMessage(password || 'User@123'); if(pw) return res.status(400).json({error:pw});
  await q('INSERT INTO users(name,email,password,role,department,staff_number,phone,active,approval_status) VALUES($1,$2,$3,$4,$5,$6,$7,true,$8)', [name,email,await bcrypt.hash(password || 'User@123',10),role,department||'',staff_number||'',phone||'','approved']);
  await audit(req,'CREATE_USER',email);
  res.json({success:true});
});
app.patch('/api/users/:id', requireRole('admin'), async (req,res)=>{
  const {role,active,approval_status}=req.body;
  if(role && !roles.includes(role)) return res.status(400).json({error:'Invalid role.'});
  await q('UPDATE users SET role=COALESCE($1,role), active=COALESCE($2,active), approval_status=COALESCE($3,approval_status) WHERE id=$4', [role, typeof active==='boolean'?active:null, approval_status||null, req.params.id]);
  await audit(req,'UPDATE_USER',`User #${req.params.id}`);
  res.json({success:true});
});
app.get('/api/staff', requireRole('admin','manager'), async (req,res)=>{
  const rows = await many(`SELECT u.id,u.name,u.email,u.department,u.staff_number,
    i.id active_issue_id,i.title active_issue_title
    FROM users u LEFT JOIN issues i ON i.assigned_to=u.id AND i.status IN ('Pending','In Progress')
    WHERE u.role='it_staff' AND u.active=true ORDER BY u.name`);
  res.json(rows);
});
app.get('/api/notifications', async (req,res)=>{
  const rows = await many('SELECT * FROM notifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT 40',[req.session.user.id]);
  res.json(rows);
});
app.patch('/api/notifications/read', async (req,res)=>{ await q('UPDATE notifications SET read=true WHERE user_id=$1',[req.session.user.id]); res.json({success:true}); });
app.get('/api/audit', requireRole('admin'), async (req,res)=>{ const rows=await many('SELECT a.*,u.name FROM audit_logs a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.created_at DESC LIMIT 100'); res.json(rows); });

init().then(()=>app.listen(PORT,()=>console.log(`NCDC IT Issue System running on port ${PORT}`))).catch(err=>{ console.error('Startup failed:', err); process.exit(1); });
