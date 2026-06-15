// VieraStudy Shared Components v1
// Provides: sidebar injection, modals, keyboard shortcuts, command palette, sync status, bug report

// ── 1. THEME ENGINE + INSTANT SETTINGS (before paint, prevents flash) ─────────
window.VieraTheme = (function () {
  const root = document.documentElement;

  // Accent presets (label + hex) available to the customizer
  const ACCENTS = [
    { name: 'Blue',   hex: '#3b82f6' },
    { name: 'Violet', hex: '#8b5cf6' },
    { name: 'Emerald',hex: '#10b981' },
    { name: 'Rose',   hex: '#f43f5e' },
    { name: 'Amber',  hex: '#f59e0b' },
    { name: 'Pink',   hex: '#ec4899' },
    { name: 'Cyan',   hex: '#06b6d4' },
    { name: 'Indigo', hex: '#6366f1' },
  ];

  function hexToRgb(hex) {
    const h = hex.replace('#', '');
    const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }
  function shade(hex, amt) {
    const { r, g, b } = hexToRgb(hex);
    const f = c => Math.max(0, Math.min(255, Math.round(c + amt))).toString(16).padStart(2, '0');
    return '#' + f(r) + f(g) + f(b);
  }
  function readableText(hex) {
    const { r, g, b } = hexToRgb(hex);
    return (0.299 * r + 0.587 * g + 0.114 * b) > 150 ? '#0f172a' : '#ffffff';
  }

  function applyAccent(hex) {
    const { r, g, b } = hexToRgb(hex);
    root.style.setProperty('--accent', hex);
    root.style.setProperty('--accent-hover', shade(hex, -22));
    root.style.setProperty('--accent-soft', `rgba(${r}, ${g}, ${b}, 0.13)`);
    root.style.setProperty('--accent-contrast', readableText(hex));
  }

  function applyThemeMode(mode) {
    // mode: 'light' | 'dark' | 'auto'
    let dark = mode === 'dark';
    if (mode === 'auto') {
      dark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    }
    document.body && document.body.classList.toggle('dark-mode', dark);
    // keep legacy flag in sync so existing pages stay consistent
    localStorage.setItem('studyDeckDarkMode', dark ? 'true' : 'false');
  }

  const prefs = {
    mode:    () => localStorage.getItem('vieraThemeMode') || (localStorage.getItem('studyDeckDarkMode') === 'true' ? 'dark' : 'light'),
    accent:  () => localStorage.getItem('vieraAccent') || '#3b82f6',
    density: () => localStorage.getItem('vieraDensity') || 'comfortable',
    radius:  () => localStorage.getItem('vieraRadius') || '14',
    font:    () => localStorage.getItem('vieraFontSize') || '16',
  };

  function apply() {
    applyAccent(prefs.accent());
    applyThemeMode(prefs.mode());
    if (document.body) document.body.setAttribute('data-density', prefs.density());
    root.style.setProperty('--radius', prefs.radius() + 'px');
    root.style.setProperty('--font-size-base', prefs.font() + 'px');
  }

  function set(key, val) {
    const map = { mode: 'vieraThemeMode', accent: 'vieraAccent', density: 'vieraDensity', radius: 'vieraRadius', font: 'vieraFontSize' };
    if (map[key]) localStorage.setItem(map[key], val);
    apply();
    // best-effort cloud persistence via existing API
    try {
      if (key === 'mode' && window.vieraAPI?.setDarkMode) vieraAPI.setDarkMode(document.body.classList.contains('dark-mode'));
      if (key === 'accent' && window.vieraAPI?.setAccentColor) vieraAPI.setAccentColor(val);
    } catch (e) {}
    window.dispatchEvent(new CustomEvent('viera:theme-changed', { detail: { key, val } }));
  }

  // React to OS theme changes while in auto mode
  if (window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if (prefs.mode() === 'auto') applyThemeMode('auto');
    });
  }

  return { ACCENTS, prefs, apply, set, applyAccent, applyThemeMode };
})();

// Apply instantly (body may not exist yet — accent/radius/font are on <html>, theme re-applied on DOM ready)
window.VieraTheme.apply();

// ── 2. SIDEBAR INJECTION ──────────────────────────────────────────────────────
function injectSidebar() {
  const sidebar = document.querySelector('.sidebar');
  if (!sidebar || sidebar.dataset.injected) return;
  sidebar.dataset.injected = '1';

  const path = window.location.pathname;
  function active(page) {
    if (page === 'dashboard' && (path.includes('dashboard') || path === '/' || path.endsWith('/'))) return ' active';
    if (page === 'flashcards' && path.includes('flashcard')) return ' active';
    if (page === 'todo' && path.includes('todo')) return ' active';
    if (page === 'schedule' && path.includes('schedule')) return ' active';
    if (page === 'pomodoro' && path.includes('pomodoro')) return ' active';
    if (page === 'notes' && path.includes('notes')) return ' active';
    if (page === 'progress' && path.includes('progress')) return ' active';
    if (page === 'classes' && path.includes('classes')) return ' active';
    if (page === 'settings' && path.includes('settings')) return ' active';
    return '';
  }

  sidebar.innerHTML = `
    <div class="logo">
      <img src="/vierastudy.png" alt="VieraStudy" loading="lazy">
      <span class="logo-text">VieraStudy</span>
    </div>
    <nav class="nav-menu">
      <a href="/dashboard.html" class="nav-item${active('dashboard')}">
        <i class="fas fa-house"></i><span>Home</span>
      </a>
      <a href="/flashcards" class="nav-item${active('flashcards')}">
        <i class="fas fa-layer-group"></i><span>Flashcards</span>
      </a>
      <a href="/todo" class="nav-item${active('todo')}">
        <i class="fas fa-list-check"></i><span>To-Do List</span>
      </a>
      <a href="/schedule" class="nav-item${active('schedule')}">
        <i class="fas fa-calendar-days"></i><span>Study Schedule</span>
      </a>
      <a href="/pomodoro" class="nav-item${active('pomodoro')}">
        <i class="fas fa-clock"></i><span>Pomodoro Timer</span>
      </a>
      <a href="/notes" class="nav-item${active('notes')}">
        <i class="fas fa-book-open"></i><span>Take Notes</span>
      </a>
      <a href="/progress-tracker" class="nav-item${active('progress')}">
        <i class="fas fa-chart-line"></i><span>Progress Tracker</span>
      </a>
      <a href="/classes" class="nav-item${active('classes')}">
        <i class="fas fa-book"></i><span>My Classes</span>
      </a>
      <a href="/settings" class="nav-item${active('settings')}">
        <i class="fas fa-gear"></i><span>Settings</span>
      </a>
    </nav>
    <div class="user-profile" id="userProfileSection">
      <div class="user-avatar" id="userAvatar"></div>
      <div class="user-info">
        <div class="user-name" id="userName">Loading...</div>
        <div class="user-plan" id="userPlan"></div>
      </div>
      <button class="bug-report-btn" onclick="openCustomizer()" title="Customize appearance" style="margin-right:6px;color:var(--accent)">
        <i class="fas fa-sliders"></i>
      </button>
      <button class="bug-report-btn" onclick="openBugReportModal()" title="Report a Bug">
        <i class="fas fa-bug"></i>
      </button>
      <button class="signout-btn" onclick="handleSignout()" title="Sign Out">
        <i class="fas fa-right-from-bracket"></i>
      </button>
    </div>
  `;

  // Close sidebar on mobile nav click
  sidebar.querySelectorAll('.nav-item').forEach(link => {
    link.addEventListener('click', () => {
      if (window.innerWidth <= 768) {
        document.querySelector('.sidebar')?.classList.remove('active');
        document.querySelector('.mobile-overlay')?.classList.remove('active');
      }
    });
  });
}

// ── 3. USER PROFILE ───────────────────────────────────────────────────────────
function loadSharedUserProfile() {
  const user = window.vieraAPI?.getUser();
  if (!user) return;
  const { firstName, lastName, isPremium } = user;
  const initials = (firstName.charAt(0) + (lastName ? lastName.charAt(0) : '')).toUpperCase();
  const avatar = document.getElementById('userAvatar');
  const name = document.getElementById('userName');
  const plan = document.getElementById('userPlan');
  if (avatar) avatar.textContent = initials;
  if (name) name.textContent = firstName;
  if (plan) {
    plan.textContent = isPremium ? 'Premium' : 'Free';
    plan.className = isPremium ? 'user-plan premium' : 'user-plan';
  }
  document.querySelector('.user-profile')?.classList.add('loaded');
}

// ── 4. MODALS INJECTION ───────────────────────────────────────────────────────
function injectModals() {
  if (!document.getElementById('notificationModal')) {
    const n = document.createElement('div');
    n.innerHTML = `
      <div id="notificationModal" class="notification-modal">
        <div class="notification-content">
          <div id="notificationIcon" class="notification-icon success"><i class="fas fa-check"></i></div>
          <div id="notificationTitle" class="notification-title">Success</div>
          <div id="notificationMessage" class="notification-message"></div>
          <button class="notification-btn" onclick="closeNotification()">OK</button>
        </div>
      </div>
      <div id="confirmationModal" class="notification-modal">
        <div class="notification-content">
          <div id="confirmationIcon" class="notification-icon warning"><i class="fas fa-exclamation-triangle"></i></div>
          <div id="confirmationTitle" class="notification-title">Confirm Action</div>
          <div id="confirmationMessage" class="notification-message"></div>
          <div style="display:flex;gap:10px;justify-content:center">
            <button class="notification-btn" style="background:#64748b" onclick="cancelConfirmation()">Cancel</button>
            <button class="notification-btn" id="confirmButton" onclick="confirmAction()">Confirm</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(n.children[0]);
    document.body.appendChild(n.children[0]);
  }

  if (!document.getElementById('syncStatus')) {
    const s = document.createElement('div');
    s.id = 'syncStatus';
    s.className = 'sync-status';
    s.innerHTML = '<span class="sync-dot"></span><span id="syncStatusText">Saved</span>';
    document.body.appendChild(s);
  }

  if (!document.getElementById('bugReportModal')) {
    const b = document.createElement('div');
    b.id = 'bugReportModal';
    b.className = 'bug-modal';
    b.innerHTML = `
      <div class="bug-modal-content">
        <div class="bug-modal-header">
          <div class="bug-modal-title"><i class="fas fa-bug"></i> Report a Bug</div>
          <button class="bug-close-btn" onclick="closeBugReportModal()"><i class="fas fa-times"></i></button>
        </div>
        <div class="bug-page-info"><i class="fas fa-link"></i><span>Reporting from: <strong id="bugPageName">-</strong></span><input type="hidden" id="bugPage" value=""></div>
        <form onsubmit="submitBugReport(event)">
          <div class="bug-form-group"><label class="bug-form-label">Category</label><select class="bug-form-select" id="bugCategory"><option value="General">General Issue</option><option value="UI/Design">UI/Design Problem</option><option value="Functionality">Feature Not Working</option><option value="Performance">Performance Issue</option><option value="Login/Account">Login/Account Problem</option><option value="Data Loss">Data Loss</option><option value="Mobile">Mobile-Specific Issue</option><option value="Other">Other</option></select></div>
          <div class="bug-form-group"><label class="bug-form-label">Describe the bug *</label><textarea class="bug-form-textarea" id="bugDescription" placeholder="Please describe what happened..." required></textarea></div>
          <div class="bug-form-group"><label class="bug-form-label">Your Email (optional)</label><input type="email" class="bug-form-input" id="bugUserEmail" placeholder="your@email.com"></div>
          <div class="bug-form-group"><label class="bug-form-label">Your Name (optional)</label><input type="text" class="bug-form-input" id="bugUserName" placeholder="Your name"></div>
          <button type="submit" class="bug-submit-btn"><i class="fas fa-paper-plane"></i> Submit Bug Report</button>
        </form>
      </div>
    `;
    document.body.appendChild(b);
  }

  if (!document.getElementById('vieraCustomizer')) {
    const cz = document.createElement('div');
    cz.id = 'vieraCustomizer';
    cz.className = 'customizer';
    cz.addEventListener('click', e => { if (e.target === cz) closeCustomizer(); });
    document.body.appendChild(cz);
  }

  if (!document.getElementById('commandPalette')) {
    const c = document.createElement('div');
    c.id = 'commandPalette';
    c.className = 'cmd-palette';
    c.innerHTML = `
      <div class="cmd-palette-box">
        <div class="cmd-palette-input-wrap">
          <i class="fas fa-search"></i>
          <input type="text" class="cmd-palette-input" id="cmdInput" placeholder="Search pages, notes, flashcards, todos..." autocomplete="off">
        </div>
        <div class="cmd-palette-results" id="cmdResults"></div>
        <div class="cmd-kbd-hint">
          <span><span class="cmd-kbd">↑↓</span> navigate</span>
          <span><span class="cmd-kbd">Enter</span> select</span>
          <span><span class="cmd-kbd">Esc</span> close</span>
        </div>
      </div>
    `;
    c.addEventListener('click', e => { if (e.target === c) closeCommandPalette(); });
    document.body.appendChild(c);
    document.getElementById('cmdInput').addEventListener('input', e => renderCmdResults(e.target.value));
    document.getElementById('cmdInput').addEventListener('keydown', handleCmdKeydown);
  }
}

// ── 5. NOTIFICATION FUNCTIONS ─────────────────────────────────────────────────
window.showNotification = function(message, type, title) {
  type = type || 'success';
  const modal = document.getElementById('notificationModal');
  const icon = document.getElementById('notificationIcon');
  const titleEl = document.getElementById('notificationTitle');
  const msgEl = document.getElementById('notificationMessage');
  const icons = { success: 'fa-check', info: 'fa-info', warning: 'fa-exclamation', error: 'fa-times' };
  const titles = { success: 'Success!', info: 'Information', warning: 'Warning', error: 'Error' };
  icon.className = 'notification-icon ' + type;
  icon.innerHTML = '<i class="fas ' + icons[type] + '"></i>';
  titleEl.textContent = title || titles[type] || 'Notification';
  msgEl.textContent = message;
  modal.classList.add('show');
};

window.closeNotification = function() {
  document.getElementById('notificationModal')?.classList.remove('show');
};

document.addEventListener('click', function(e) {
  const modal = document.getElementById('notificationModal');
  if (e.target === modal) window.closeNotification();
});

let _confirmCallback = null;

window.showConfirmation = function(message, title, type) {
  title = title || 'Confirm Action';
  type = type || 'warning';
  return new Promise(function(resolve) {
    const modal = document.getElementById('confirmationModal');
    const icon = document.getElementById('confirmationIcon');
    const titleEl = document.getElementById('confirmationTitle');
    const msgEl = document.getElementById('confirmationMessage');
    const btn = document.getElementById('confirmButton');
    const icons = { warning: 'fa-exclamation-triangle', danger: 'fa-exclamation-circle', info: 'fa-question-circle' };
    const colors = { warning: 'warning', danger: 'error', info: 'info' };
    icon.className = 'notification-icon ' + (colors[type] || 'warning');
    icon.innerHTML = '<i class="fas ' + (icons[type] || 'fa-exclamation-triangle') + '"></i>';
    titleEl.textContent = title;
    msgEl.textContent = message;
    btn.style.background = type === 'danger' ? '#ef4444' : 'var(--accent)';
    _confirmCallback = resolve;
    modal.classList.add('show');
  });
};

window.confirmAction = function() {
  document.getElementById('confirmationModal')?.classList.remove('show');
  if (_confirmCallback) { _confirmCallback(true); _confirmCallback = null; }
};

window.cancelConfirmation = function() {
  document.getElementById('confirmationModal')?.classList.remove('show');
  if (_confirmCallback) { _confirmCallback(false); _confirmCallback = null; }
};

// ── 6. SIGNOUT ────────────────────────────────────────────────────────────────
window.handleSignout = async function() {
  const ok = await window.showConfirmation('Are you sure you want to sign out?', 'Sign Out', 'warning');
  if (ok) {
    if (window.vieraAPI) {
      await vieraAPI.syncToCloud();
      await vieraAPI.logout();
    }
    window.location.href = '/';
  }
};

// ── 7. MOBILE MENU ────────────────────────────────────────────────────────────
window.toggleMobileMenu = function() {
  document.querySelector('.sidebar')?.classList.toggle('active');
  document.querySelector('.mobile-overlay')?.classList.toggle('active');
};

// ── 8. SYNC STATUS ────────────────────────────────────────────────────────────
let _syncHideTimer = null;

window.showSyncStatus = function(state, text) {
  const el = document.getElementById('syncStatus');
  if (!el) return;
  clearTimeout(_syncHideTimer);
  el.className = 'sync-status show ' + (state || '');
  const textEl = document.getElementById('syncStatusText');
  if (textEl) textEl.textContent = text || state;
  if (state !== 'saving') {
    _syncHideTimer = setTimeout(function() { el.classList.remove('show'); }, state === 'error' ? 3000 : 2000);
  }
};

window.addEventListener('viera:saving', function() { window.showSyncStatus('saving', 'Saving...'); });
window.addEventListener('viera:saved', function() { window.showSyncStatus('saved', 'Saved'); });
window.addEventListener('viera:error', function() { window.showSyncStatus('error', 'Sync error'); });

// ── 9. BUG REPORT ────────────────────────────────────────────────────────────
var BUG_REPORT_URL = 'https://script.google.com/macros/s/AKfycbxW5D6i7Td2Em-OqHmCpgy-DVQuzn1oCzn_pBRB2IOb_8MGfwgPqjF8KghYQDZpMNdKUw/exec';

window.openBugReportModal = function() {
  const modal = document.getElementById('bugReportModal');
  if (!modal) return;
  const pageName = document.getElementById('bugPageName');
  const pageInput = document.getElementById('bugPage');
  if (pageName) pageName.textContent = document.title.replace(' - VieraStudy', '').replace('VieraStudy - ', '');
  if (pageInput) pageInput.value = window.location.href;
  const user = window.vieraAPI?.getUser();
  if (user) {
    const emailEl = document.getElementById('bugUserEmail');
    const nameEl = document.getElementById('bugUserName');
    if (emailEl) emailEl.value = user.email || '';
    if (nameEl) nameEl.value = (user.firstName + ' ' + (user.lastName || '')).trim();
  }
  modal.classList.add('active');
};

window.closeBugReportModal = function() {
  document.getElementById('bugReportModal')?.classList.remove('active');
};

function getBrowserInfo() {
  var ua = navigator.userAgent;
  var browser = 'Unknown';
  if (ua.includes('Firefox')) browser = 'Firefox';
  else if (ua.includes('Chrome') && !ua.includes('Edg')) browser = 'Chrome';
  else if (ua.includes('Safari') && !ua.includes('Chrome')) browser = 'Safari';
  else if (ua.includes('Edg')) browser = 'Edge';
  if (/iPhone|iPad|iPod|Android/i.test(ua)) browser += ' (Mobile)';
  return browser;
}

window.submitBugReport = async function(event) {
  event.preventDefault();
  var btn = event.target.querySelector('button[type="submit"]');
  var orig = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Submitting...';
  var data = {
    page: document.getElementById('bugPage')?.value,
    pageName: document.getElementById('bugPageName')?.textContent,
    category: document.getElementById('bugCategory')?.value,
    description: document.getElementById('bugDescription')?.value,
    userEmail: document.getElementById('bugUserEmail')?.value || 'Anonymous',
    userName: document.getElementById('bugUserName')?.value || 'Anonymous',
    browser: getBrowserInfo(),
    screenSize: window.innerWidth + 'x' + window.innerHeight,
    userAgent: navigator.userAgent
  };
  try {
    await fetch(BUG_REPORT_URL, { method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    window.showNotification('Bug report submitted successfully!', 'success', 'Report Sent');
    window.closeBugReportModal();
    var desc = document.getElementById('bugDescription');
    if (desc) desc.value = '';
  } catch(e) {
    window.showNotification('Failed to submit bug report.', 'error', 'Error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = orig;
  }
};

// ── 9b. APPEARANCE CUSTOMIZER ─────────────────────────────────────────────────
function renderCustomizer() {
  const cz = document.getElementById('vieraCustomizer');
  if (!cz) return;
  const T = window.VieraTheme;
  const p = T.prefs;
  const mode = p.mode(), accent = p.accent(), density = p.density(), radius = p.radius(), font = p.font();

  const modeBtn = (val, icon, label) =>
    `<button class="${mode === val ? 'active' : ''}" data-cz-mode="${val}"><i class="fas ${icon}"></i>${label}</button>`;
  const densBtn = (val, label) =>
    `<button class="${density === val ? 'active' : ''}" data-cz-density="${val}">${label}</button>`;
  const swatches = T.ACCENTS.map(a =>
    `<button class="cz-swatch${accent.toLowerCase() === a.hex.toLowerCase() ? ' active' : ''}" data-cz-accent="${a.hex}" style="background:${a.hex}" title="${a.name}"></button>`
  ).join('');

  cz.innerHTML = `
    <div class="customizer-panel">
      <div class="customizer-head">
        <h2><i class="fas fa-sliders"></i> Appearance</h2>
        <button class="customizer-close" onclick="closeCustomizer()"><i class="fas fa-times"></i></button>
      </div>
      <div class="customizer-body">
        <div>
          <span class="cz-group-label">Theme</span>
          <div class="cz-seg">
            ${modeBtn('light', 'fa-sun', 'Light')}
            ${modeBtn('dark', 'fa-moon', 'Dark')}
            ${modeBtn('auto', 'fa-circle-half-stroke', 'Auto')}
          </div>
        </div>
        <div>
          <span class="cz-group-label">Accent color</span>
          <div class="cz-swatches">${swatches}</div>
        </div>
        <div>
          <span class="cz-group-label">Density</span>
          <div class="cz-seg">
            ${densBtn('compact', 'Compact')}
            ${densBtn('comfortable', 'Cozy')}
            ${densBtn('spacious', 'Spacious')}
          </div>
        </div>
        <div>
          <span class="cz-group-label">Corner roundness</span>
          <div class="cz-slider-row">
            <input type="range" class="cz-slider" id="czRadius" min="0" max="24" step="2" value="${radius}">
            <span class="cz-slider-val" id="czRadiusVal">${radius}px</span>
          </div>
        </div>
        <div>
          <span class="cz-group-label">Text size</span>
          <div class="cz-slider-row">
            <input type="range" class="cz-slider" id="czFont" min="14" max="20" step="1" value="${font}">
            <span class="cz-slider-val" id="czFontVal">${font}px</span>
          </div>
        </div>
        <button class="notification-btn" style="width:100%" onclick="resetCustomizer()">
          <i class="fas fa-rotate-left"></i> Reset to defaults
        </button>
      </div>
    </div>`;

  cz.querySelectorAll('[data-cz-mode]').forEach(b => b.onclick = () => { T.set('mode', b.dataset.czMode); renderCustomizer(); });
  cz.querySelectorAll('[data-cz-density]').forEach(b => b.onclick = () => { T.set('density', b.dataset.czDensity); renderCustomizer(); });
  cz.querySelectorAll('[data-cz-accent]').forEach(b => b.onclick = () => { T.set('accent', b.dataset.czAccent); renderCustomizer(); });

  const rad = cz.querySelector('#czRadius'), radVal = cz.querySelector('#czRadiusVal');
  rad.oninput = () => { radVal.textContent = rad.value + 'px'; T.set('radius', rad.value); };
  const fnt = cz.querySelector('#czFont'), fntVal = cz.querySelector('#czFontVal');
  fnt.oninput = () => { fntVal.textContent = fnt.value + 'px'; T.set('font', fnt.value); };
}

window.openCustomizer = function () {
  renderCustomizer();
  document.getElementById('vieraCustomizer')?.classList.add('active');
};
window.closeCustomizer = function () {
  document.getElementById('vieraCustomizer')?.classList.remove('active');
};
window.resetCustomizer = function () {
  ['vieraThemeMode', 'vieraAccent', 'vieraDensity', 'vieraRadius', 'vieraFontSize'].forEach(k => localStorage.removeItem(k));
  document.documentElement.style.removeProperty('--radius');
  document.documentElement.style.removeProperty('--font-size-base');
  window.VieraTheme.apply();
  renderCustomizer();
  window.showNotification && window.showNotification('Appearance reset to defaults', 'success', 'Reset');
};

// ── 10. COMMAND PALETTE ───────────────────────────────────────────────────────
var CMD_PAGES = [
  { icon: 'fa-home', color: '#3b82f6', label: 'Home / Dashboard', sub: 'Overview and quick actions', href: '/dashboard.html' },
  { icon: 'fa-layer-group', color: '#8b5cf6', label: 'Flashcards', sub: 'Study and create flashcard decks', href: '/flashcards' },
  { icon: 'fa-list-check', color: '#10b981', label: 'To-Do List', sub: 'Manage your tasks', href: '/todo' },
  { icon: 'fa-calendar-days', color: '#f59e0b', label: 'Study Schedule', sub: 'Plan your study sessions', href: '/schedule' },
  { icon: 'fa-clock', color: '#ef4444', label: 'Pomodoro Timer', sub: 'Focus with timed sessions', href: '/pomodoro' },
  { icon: 'fa-book-open', color: '#06b6d4', label: 'Take Notes', sub: 'Write and organize your notes', href: '/notes' },
  { icon: 'fa-chart-line', color: '#ec4899', label: 'Progress Tracker', sub: 'Track your study progress', href: '/progress-tracker' },
  { icon: 'fa-book', color: '#f97316', label: 'My Classes', sub: 'Manage your classes', href: '/classes' },
  { icon: 'fa-cog', color: '#64748b', label: 'Settings', sub: 'Customize your experience', href: '/settings' },
];

var _cmdSelectedIdx = 0;

window.openCommandPalette = function() {
  var pal = document.getElementById('commandPalette');
  if (!pal) return;
  pal.classList.add('active');
  var input = document.getElementById('cmdInput');
  if (input) { input.value = ''; input.focus(); }
  _cmdSelectedIdx = 0;
  renderCmdResults('');
};

window.closeCommandPalette = function() {
  document.getElementById('commandPalette')?.classList.remove('active');
};

function renderCmdResults(query) {
  var container = document.getElementById('cmdResults');
  if (!container) return;
  query = (query || '').toLowerCase().trim();

  var results = [];

  // Pages (always include, filtered by query)
  CMD_PAGES.forEach(function(p) {
    if (!query || p.label.toLowerCase().includes(query) || p.sub.toLowerCase().includes(query)) {
      results.push({ icon: p.icon, color: p.color, label: p.label, sub: p.sub, href: p.href, type: 'page' });
    }
  });

  // Data search (only when query exists)
  if (query && window.vieraAPI) {
    try {
      var notes = vieraAPI.getNotes() || [];
      notes.forEach(function(n) {
        if ((n.title || '').toLowerCase().includes(query) || (n.content || '').toLowerCase().includes(query)) {
          results.push({ icon: 'fa-book-open', color: '#06b6d4', label: n.title || 'Untitled Note', sub: 'Note', href: '/notes', type: 'note' });
        }
      });
      var todos = vieraAPI.getTodos() || [];
      todos.forEach(function(t) {
        if ((t.text || '').toLowerCase().includes(query)) {
          results.push({ icon: 'fa-list-check', color: '#10b981', label: t.text, sub: 'Todo', href: '/todo', type: 'todo' });
        }
      });
      var decks = vieraAPI.getFlashcards() || [];
      decks.forEach(function(d) {
        if ((d.name || '').toLowerCase().includes(query)) {
          results.push({ icon: 'fa-layer-group', color: '#8b5cf6', label: d.name, sub: 'Flashcard deck (' + (d.cards?.length || 0) + ' cards)', href: '/flashcards', type: 'deck' });
        }
      });
    } catch(e) {}
  }

  if (results.length === 0) {
    container.innerHTML = '<div class="cmd-palette-empty"><i class="fas fa-search" style="font-size:24px;margin-bottom:8px;display:block"></i>No results found</div>';
    return;
  }

  _cmdSelectedIdx = Math.min(_cmdSelectedIdx, results.length - 1);
  container.innerHTML = results.map(function(r, i) {
    return '<div class="cmd-result' + (i === _cmdSelectedIdx ? ' selected' : '') + '" onclick="navigateCmdResult(\'' + r.href + '\')" data-idx="' + i + '">' +
      '<div class="cmd-result-icon" style="background:' + r.color + '20;color:' + r.color + '"><i class="fas ' + r.icon + '"></i></div>' +
      '<div><div class="cmd-result-label">' + r.label + '</div><div class="cmd-result-sub">' + r.sub + '</div></div>' +
      '</div>';
  }).join('');

  // Store results for keyboard nav
  container.dataset.resultsJson = JSON.stringify(results.map(function(r) { return r.href; }));
}

window.navigateCmdResult = function(href) {
  window.closeCommandPalette();
  window.location.href = href;
};

function handleCmdKeydown(e) {
  var container = document.getElementById('cmdResults');
  if (!container) return;
  var items = container.querySelectorAll('.cmd-result');
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    _cmdSelectedIdx = Math.min(_cmdSelectedIdx + 1, items.length - 1);
    updateCmdSelection(items);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    _cmdSelectedIdx = Math.max(_cmdSelectedIdx - 1, 0);
    updateCmdSelection(items);
  } else if (e.key === 'Enter') {
    e.preventDefault();
    var selected = items[_cmdSelectedIdx];
    if (selected) selected.click();
  } else if (e.key === 'Escape') {
    window.closeCommandPalette();
  }
}

function updateCmdSelection(items) {
  items.forEach(function(el, i) {
    el.classList.toggle('selected', i === _cmdSelectedIdx);
  });
  if (items[_cmdSelectedIdx]) items[_cmdSelectedIdx].scrollIntoView({ block: 'nearest' });
}

// ── 11. KEYBOARD SHORTCUTS ────────────────────────────────────────────────────
function setupKeyboardShortcuts() {
  document.addEventListener('keydown', function(e) {
    var isTyping = e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable;
    if (e.key === 'Escape') {
      window.closeBugReportModal();
      window.closeCommandPalette();
      window.closeNotification();
      window.closeCustomizer && window.closeCustomizer();
    }
    if (isTyping) return;
    var mod = e.metaKey || e.ctrlKey;
    if (!mod) return;
    if (e.key === 'k') { e.preventDefault(); window.openCommandPalette(); return; }
    if (e.key === '/') { e.preventDefault(); window.showKeyboardShortcuts(); return; }
    if (e.key === 'h') { e.preventDefault(); window.location.href = '/dashboard.html'; return; }
    if (e.key === 't') { e.preventDefault(); window.location.href = '/todo'; return; }
    if (e.key === 'p' && !e.shiftKey) { e.preventDefault(); window.location.href = '/pomodoro'; return; }
    if (e.key === 's' && !e.shiftKey) { e.preventDefault(); window.location.href = '/schedule'; return; }
    if (e.key === ',') { e.preventDefault(); window.location.href = '/settings'; return; }
    if (e.shiftKey && e.key === 'N') { e.preventDefault(); window.location.href = '/notes'; return; }
    if (e.shiftKey && e.key === 'P') { e.preventDefault(); window.location.href = '/progress-tracker'; return; }
    if (e.key === 'f') { e.preventDefault(); window.location.href = '/flashcards'; return; }
  });
}

// ── 12. KEYBOARD SHORTCUTS MODAL ─────────────────────────────────────────────
window.showKeyboardShortcuts = function() {
  var isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
  var mod = isMac ? '⌘' : 'Ctrl';
  var shift = isMac ? '⇧' : 'Shift';
  var isDark = document.body.classList.contains('dark-mode');
  var bg = isDark ? '#1e293b' : 'white';
  var text = isDark ? '#e2e8f0' : '#1e293b';
  var sub = isDark ? '#94a3b8' : '#64748b';
  var kbdBg = isDark ? '#334155' : '#e2e8f0';
  var kbdBorder = isDark ? '#475569' : '#cbd5e1';

  function kbd(k) { return '<kbd style="background:' + kbdBg + ';color:' + text + ';padding:4px 8px;border-radius:5px;font-size:12px;font-weight:600;border:1px solid ' + kbdBorder + ';display:inline-block">' + k + '</kbd>'; }
  function row(icon, label, keys) {
    return '<div style="display:flex;justify-content:space-between;align-items:center;padding:12px 16px;background:rgba(59,130,246,0.05);border-radius:8px;margin-bottom:8px">' +
      '<div style="display:flex;align-items:center;gap:10px"><i class="' + icon + '" style="width:20px;text-align:center"></i><span style="font-weight:600;color:' + text + ';font-size:14px">' + label + '</span></div>' +
      '<div style="display:flex;align-items:center;gap:4px">' + keys + '</div></div>';
  }

  var shortcuts = [
    row('fas fa-home', 'Home', kbd(mod) + ' + ' + kbd('H')),
    row('fas fa-layer-group', 'Flashcards', kbd(mod) + ' + ' + kbd('F')),
    row('fas fa-list-check', 'To-Do List', kbd(mod) + ' + ' + kbd('T')),
    row('fas fa-book-open', 'Notes', kbd(mod) + ' + ' + kbd(shift) + ' + ' + kbd('N')),
    row('fas fa-clock', 'Pomodoro', kbd(mod) + ' + ' + kbd('P')),
    row('fas fa-calendar-days', 'Schedule', kbd(mod) + ' + ' + kbd('S')),
    row('fas fa-chart-line', 'Progress', kbd(mod) + ' + ' + kbd(shift) + ' + ' + kbd('P')),
    row('fas fa-cog', 'Settings', kbd(mod) + ' + ' + kbd(',')),
    row('fas fa-search', 'Command Palette', kbd(mod) + ' + ' + kbd('K')),
    row('fas fa-keyboard', 'Show Shortcuts', kbd(mod) + ' + ' + kbd('/')),
    row('fas fa-times', 'Close / Cancel', kbd('Esc')),
  ].join('');

  var modal = document.createElement('div');
  modal.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;z-index:50000;backdrop-filter:blur(8px)';
  modal.innerHTML = '<div style="background:' + bg + ';border-radius:16px;max-width:500px;width:92%;max-height:80vh;overflow:hidden;box-shadow:0 25px 70px rgba(0,0,0,0.4)">' +
    '<div style="background:#1e293b;padding:20px 24px;display:flex;align-items:center;justify-content:space-between">' +
    '<div style="display:flex;align-items:center;gap:10px"><i class="fas fa-keyboard" style="color:white;font-size:20px"></i><span style="color:white;font-size:18px;font-weight:700">Keyboard Shortcuts</span></div>' +
    '<button onclick="this.closest(\'div\').parentElement.remove()" style="background:rgba(255,255,255,0.2);border:none;color:white;width:32px;height:32px;border-radius:8px;cursor:pointer;font-size:18px;display:flex;align-items:center;justify-content:center">×</button>' +
    '</div><div style="padding:20px 24px;overflow-y:auto;max-height:calc(80vh - 70px)">' + shortcuts + '</div></div>';
  modal.addEventListener('click', function(e) { if (e.target === modal) modal.remove(); });
  document.body.appendChild(modal);
};

// ── 13. INITIALIZATION ────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async function() {
  window.VieraTheme.apply();
  injectSidebar();
  injectModals();
  setupKeyboardShortcuts();

  if (window.vieraAPI) {
    await vieraAPI.ready;
    if (vieraAPI.isLoggedIn()) {
      loadSharedUserProfile();
    }
  }
});
