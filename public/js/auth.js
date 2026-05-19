const loginForm = document.getElementById('loginForm');
const registerForm = document.getElementById('registerForm');
const forgotForm = document.getElementById('forgotForm');
const msg = document.getElementById('msg');
const regMsg = document.getElementById('regMsg');
const forgotMsg = document.getElementById('forgotMsg');
const resetForm = document.getElementById('resetForm');
const showRegister = document.getElementById('showRegister');
const showLogin = document.getElementById('showLogin');
const showForgot = document.getElementById('showForgot');
const forgotBack = document.getElementById('forgotBack');
const loginBox = document.getElementById('loginBox');
const registerBox = document.getElementById('registerBox');
const forgotBox = document.getElementById('forgotBox');

async function postJson(url, body){
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:controller.signal});
    const data = await res.json().catch(()=>({}));
    return {res, data};
  } catch (err) {
    if(err.name === 'AbortError') throw new Error('The request took too long. Please confirm the server is running.');
    throw err;
  } finally { clearTimeout(timer); }
}
function setFormBusy(form, busy){
  const btn = form.querySelector('button[type="submit"], button:not([type])');
  if(!btn) return;
  btn.disabled = busy;
  btn.dataset.originalText = btn.dataset.originalText || btn.textContent;
  btn.textContent = busy ? 'Processing...' : btn.dataset.originalText;
}

function showOnly(box){
  [loginBox, registerBox, forgotBox].forEach(x=>x.classList.add('hidden'));
  box.classList.remove('hidden');
}
showRegister.addEventListener('click', ()=> showOnly(registerBox));
showLogin.addEventListener('click', ()=> showOnly(loginBox));
showForgot.addEventListener('click', ()=> showOnly(forgotBox));
forgotBack.addEventListener('click', ()=> showOnly(loginBox));

loginForm.addEventListener('submit', async (e)=>{
  e.preventDefault();
  msg.textContent = 'Checking login...';
  const emailField = document.getElementById('email');
  const passwordField = document.getElementById('password');
  const body = { email: emailField.value.trim(), password: passwordField.value };
  setFormBusy(e.target, true);
  try {
    const {res, data} = await postJson('/api/login', body);
    if(!res.ok){ msg.textContent = data.error || 'Invalid login'; return; }
    location.href = '/dashboard.html';
  } catch (err) {
    msg.textContent = err.message || 'Login failed. Make sure the server is running and try again.';
  } finally {
    setFormBusy(e.target, false);
  }
});

registerForm.addEventListener('submit', async (e)=>{
  e.preventDefault();
  regMsg.textContent = 'Submitting registration...';
  const body = Object.fromEntries(new FormData(e.target));
  let res, data;
  setFormBusy(e.target, true);
  try {
    ({res, data} = await postJson('/api/register', body));
  } catch (err) { regMsg.textContent = err.message || 'Registration failed. Make sure the server is running.'; setFormBusy(e.target, false); return; }
  finally { setFormBusy(e.target, false); }
  if(!res.ok){ regMsg.textContent = data.error || 'Registration failed'; return; }
  regMsg.innerHTML = '<span class="notice-text">Registration submitted. Please wait for administrator approval before logging in.</span>';
  e.target.reset();
});

forgotForm.addEventListener('submit', async (e)=>{
  e.preventDefault();
  forgotMsg.textContent = 'Submitting password help request...';
  const body = Object.fromEntries(new FormData(e.target));
  let res, data;
  setFormBusy(e.target, true);
  try {
    ({res, data} = await postJson('/api/forgot-password', body));
  } catch (err) { forgotMsg.textContent = err.message || 'Request failed. Make sure the server is running.'; setFormBusy(e.target, false); return; }
  finally { setFormBusy(e.target, false); }
  if(!res.ok){ forgotMsg.textContent = data.error || 'Request failed'; return; }
  forgotMsg.innerHTML = '<span class="notice-text">Reset code request submitted. Check your email or ask the System Administrator to review the email log.</span>';
  resetForm.email.value = body.email || '';
  e.target.reset();
});

resetForm.addEventListener('submit', async (e)=>{
  e.preventDefault();
  forgotMsg.textContent = 'Resetting password...';
  const body = Object.fromEntries(new FormData(e.target));
  let res, data;
  setFormBusy(e.target, true);
  try {
    ({res, data} = await postJson('/api/reset-password', body));
  } catch (err) { forgotMsg.textContent = err.message || 'Password reset failed. Make sure the server is running.'; setFormBusy(e.target, false); return; }
  finally { setFormBusy(e.target, false); }
  if(!res.ok){ forgotMsg.textContent = data.error || 'Password reset failed'; return; }
  forgotMsg.innerHTML = '<span class="notice-text">Password reset successfully. You can now log in.</span>';
  e.target.reset();
});

document.addEventListener('click', (event) => {
  const button = event.target.closest('[data-toggle-password]');
  if (!button) return;
  const input = document.getElementById(button.dataset.togglePassword);
  if (!input) return;
  const showing = input.type === 'text';
  input.type = showing ? 'password' : 'text';
  button.textContent = showing ? 'Show' : 'Hide';
});
