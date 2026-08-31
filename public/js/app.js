// ── STARS BACKGROUND ──────────────────────────────────────────────────────────
// ── NAV HAMBURGER ─────────────────────────────────────────────────────────────
function initNav() {
  const hamburger = document.querySelector('.nav-hamburger');
  const links = document.querySelector('.nav-links');
  const nav = document.querySelector('.nav');
  if (!hamburger || !links || !nav) return;

  hamburger.setAttribute('aria-expanded', 'false');
  hamburger.setAttribute('aria-controls', 'nav-menu');
  links.id = 'nav-menu';

  const openMenu = () => {
    links.classList.add('open');
    hamburger.setAttribute('aria-expanded', 'true');
  };

  const closeMenu = () => {
    links.classList.remove('open');
    hamburger.setAttribute('aria-expanded', 'false');
  };

  hamburger.addEventListener('click', () => {
    if (links.classList.contains('open')) closeMenu();
    else openMenu();
  });
  document.addEventListener('pointerdown', (event) => {
    if (!nav.contains(event.target)) closeMenu();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeMenu();
  });
  links.querySelectorAll('a').forEach(a => {
    a.addEventListener('click', closeMenu);
  });
}

function addNavSafeMask() {
  if (document.querySelector('.nav-safe-mask')) return;
  const nav = document.querySelector('.nav');
  if (!nav || !nav.parentNode) return;

  const mask = document.createElement('div');
  mask.className = 'nav-safe-mask';
  mask.setAttribute('aria-hidden', 'true');
  nav.parentNode.insertBefore(mask, nav);
}

// ── ALERT ─────────────────────────────────────────────────────────────────────
function showAlert(id, message, type = 'error') {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = message;
  el.className = `alert show alert-${type}`;
  el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  setTimeout(() => el.classList.remove('show'), 6000);
}

// ── TOGGLE ANONYMOUS ──────────────────────────────────────────────────────────
function initAnonToggle() {
  const toggle = document.getElementById('anonToggle');
  const senderFields = document.getElementById('senderFields');
  if (!toggle || !senderFields) return;
  toggle.addEventListener('change', () => {
    senderFields.style.opacity = toggle.checked ? '0.4' : '1';
    senderFields.style.pointerEvents = toggle.checked ? 'none' : 'all';
  });
}

// ── DOB FORMATTER ─────────────────────────────────────────────────────────────
function initDobInput(inputId) {
  const el = document.getElementById(inputId);
  if (!el) return;
  el.addEventListener('input', (e) => {
    let val = e.target.value.replace(/\D/g, '');
    if (val.length > 2) val = val.slice(0, 2) + '/' + val.slice(2, 4);
    e.target.value = val;
  });
}

// ── FORMAT DATE ───────────────────────────────────────────────────────────────
function formatDate(isoStr) {
  if (!isoStr) return '—';
  const d = new Date(isoStr);
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// ── COPY TO CLIPBOARD ─────────────────────────────────────────────────────────
function copyText(text, btn) {
  navigator.clipboard.writeText(text).then(() => {
    const orig = btn.textContent;
    btn.textContent = 'Copied';
    setTimeout(() => { btn.textContent = orig; }, 2000);
  });
}

// ── INIT ──────────────────────────────────────────────────────────────────────
function iconMarkup(name, className = '') {
  return `<svg class="icon ${className}" aria-hidden="true"><use href="/assets/icons.svg#${name}"></use></svg>`;
}

function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem('kitemail-theme', theme);
  document.querySelectorAll('.theme-toggle').forEach((toggle) => {
    const isDark = theme === 'dark';
    toggle.setAttribute('aria-pressed', String(isDark));
    toggle.setAttribute('aria-label', `Switch to ${isDark ? 'light' : 'dark'} mode`);
  });
  if (typeof window.updateLetterDefaultPalette === 'function') {
    window.updateLetterDefaultPalette();
  }
}

function initializeTheme() {
  const savedTheme = localStorage.getItem('kitemail-theme');
  const systemTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  setTheme(savedTheme || systemTheme);
  document.querySelectorAll('.theme-toggle').forEach((toggle) => {
    toggle.addEventListener('click', () => {
      setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
    });
  });
}

function addThemeToggles() {
  document.querySelectorAll('.nav').forEach((nav) => {
    if (nav.querySelector('.theme-toggle')) return;
    const toggle = document.createElement('button');
    toggle.className = 'theme-toggle';
    toggle.type = 'button';
    toggle.innerHTML = `${iconMarkup('sparkles', 'theme-icon-sun')}${iconMarkup('moon', 'theme-icon-moon')}`;
    const hamburger = nav.querySelector('.nav-hamburger');
    if (hamburger) {
      hamburger.innerHTML = `Menu ${iconMarkup('chevron-down', 'menu-chevron')}`;
      hamburger.setAttribute('aria-label', 'Open menu');
    }
    const actions = document.createElement('div');
    actions.className = 'nav-actions';
    actions.appendChild(toggle);
    if (hamburger) actions.appendChild(hamburger);
    nav.appendChild(actions);
  });
}

document.addEventListener('DOMContentLoaded', () => {
  addNavSafeMask();
  addThemeToggles();
  initializeTheme();
  initNav();
  initAnonToggle();
  // Auto-init dob inputs
  ['belovedDob', 'senderDob', 'filterDob'].forEach(initDobInput);
});
