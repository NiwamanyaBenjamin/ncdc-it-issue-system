const loginForm = document.getElementById('loginForm');
const registerForm = document.getElementById('registerForm');
const forgotForm = document.getElementById('forgotForm');
const resetForm = document.getElementById('resetForm');

const msg = document.getElementById('msg');
const regMsg = document.getElementById('regMsg');
const forgotMsg = document.getElementById('forgotMsg');

const showRegister = document.getElementById('showRegister');
const showLogin = document.getElementById('showLogin');
const showForgot = document.getElementById('showForgot');
const forgotBack = document.getElementById('forgotBack');

const loginBox = document.getElementById('loginBox');
const registerBox = document.getElementById('registerBox');
const forgotBox = document.getElementById('forgotBox');

async function postJson(url, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);

  try {
    const res = await fetch(url, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });

    const data = await res.json().catch(() => ({}));

    return { res, data };
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error('The request took too long. Please confirm the server is running.');
    }

    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function setFormBusy(form, busy) {
  const btn = form.querySelector('button[type="submit"], button:not([type])');

  if (!btn) return;

  btn.disabled = busy;
  btn.dataset.originalText = btn.dataset.originalText || btn.textContent;
  btn.textContent = busy ? 'Processing...' : btn.dataset.originalText;
}

function showOnly(box) {
  [loginBox, registerBox, forgotBox].forEach(item => {
    if (item) item.classList.add('hidden');
  });

  if (box) box.classList.remove('hidden');
}

if (showRegister) {
  showRegister.addEventListener('click', () => showOnly(registerBox));
}

if (showLogin) {
  showLogin.addEventListener('click', () => showOnly(loginBox));
}

if (showForgot) {
  showForgot.addEventListener('click', () => showOnly(forgotBox));
}

if (forgotBack) {
  forgotBack.addEventListener('click', () => showOnly(loginBox));
}

if (loginForm) {
  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    if (msg) msg.textContent = 'Checking login...';

    const emailField = document.getElementById('email');
    const passwordField = document.getElementById('password');

    const body = {
      email: emailField.value.trim(),
      password: passwordField.value
    };

    setFormBusy(e.target, true);

    try {
      const { res, data } = await postJson('/api/login', body);

      if (!res.ok) {
        if (msg) msg.textContent = data.error || 'Invalid login';
        return;
      }

      window.location.href = '/dashboard.html';
    } catch (err) {
      if (msg) {
        msg.textContent = err.message || 'Login failed. Make sure the server is running and try again.';
      }
    } finally {
      setFormBusy(e.target, false);
    }
  });
}

if (registerForm) {
  registerForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    if (regMsg) regMsg.textContent = 'Submitting registration...';

    const body = Object.fromEntries(new FormData(e.target));

    setFormBusy(e.target, true);

    try {
      const { res, data } = await postJson('/api/register', body);

      if (!res.ok) {
        if (regMsg) regMsg.textContent = data.error || 'Registration failed';
        return;
      }

      if (regMsg) {
        regMsg.innerHTML = '<span class="notice-text">Registration submitted. Please wait for administrator approval before logging in.</span>';
      }

      e.target.reset();
    } catch (err) {
      if (regMsg) {
        regMsg.textContent = err.message || 'Registration failed. Make sure the server is running.';
      }
    } finally {
      setFormBusy(e.target, false);
    }
  });
}

if (forgotForm) {
  forgotForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    if (forgotMsg) forgotMsg.textContent = 'Submitting password help request...';

    const body = Object.fromEntries(new FormData(e.target));

    setFormBusy(e.target, true);

    try {
      const { res, data } = await postJson('/api/forgot-password', body);

      if (!res.ok) {
        if (forgotMsg) forgotMsg.textContent = data.error || 'Request failed';
        return;
      }

      if (forgotMsg) {
        forgotMsg.innerHTML = '<span class="notice-text">Reset code request submitted. Check your email or ask the System Administrator to review the email log.</span>';
      }

      if (resetForm && resetForm.email) {
        resetForm.email.value = body.email || '';
      }

      e.target.reset();
    } catch (err) {
      if (forgotMsg) {
        forgotMsg.textContent = err.message || 'Request failed. Make sure the server is running.';
      }
    } finally {
      setFormBusy(e.target, false);
    }
  });
}

if (resetForm) {
  resetForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    if (forgotMsg) forgotMsg.textContent = 'Resetting password...';

    const body = Object.fromEntries(new FormData(e.target));

    setFormBusy(e.target, true);

    try {
      const { res, data } = await postJson('/api/reset-password', body);

      if (!res.ok) {
        if (forgotMsg) forgotMsg.textContent = data.error || 'Password reset failed';
        return;
      }

      if (forgotMsg) {
        forgotMsg.innerHTML = '<span class="notice-text">Password reset successfully. You can now log in.</span>';
      }

      e.target.reset();
    } catch (err) {
      if (forgotMsg) {
        forgotMsg.textContent = err.message || 'Password reset failed. Make sure the server is running.';
      }
    } finally {
      setFormBusy(e.target, false);
    }
  });
}

document.addEventListener('click', (event) => {
  const button = event.target.closest('[data-toggle-password]');

  if (!button) return;

  const input = document.getElementById(button.dataset.togglePassword);

  if (!input) return;

  const showing = input.type === 'text';

  input.type = showing ? 'password' : 'text';
  button.textContent = showing ? 'Show' : 'Hide';
});
