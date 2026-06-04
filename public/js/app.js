// ── STARS BACKGROUND ──────────────────────────────────────────────────────────
function createStars(count = 80) {
  const container = document.querySelector('.stars-bg');
  if (!container) return;
  for (let i = 0; i < count; i++) {
    const star = document.createElement('div');
    star.className = 'star';
    const size = Math.random() * 2.5 + 0.5;
    star.style.cssText = `
      width: ${size}px;
      height: ${size}px;
      left: ${Math.random() * 100}%;
      top: ${Math.random() * 100}%;
      --duration: ${Math.random() * 4 + 2}s;
      --delay: ${Math.random() * 4}s;
    `;
    container.appendChild(star);
  }
}

// ── NAV HAMBURGER ─────────────────────────────────────────────────────────────
function initNav() {
  const hamburger = document.querySelector('.nav-hamburger');
  const links = document.querySelector('.nav-links');
  if (!hamburger || !links) return;

  // Add close button inside nav-links
  const closeBtn = document.createElement('button');
  closeBtn.className = 'nav-close';
  closeBtn.innerHTML = '✕';
  links.prepend(closeBtn);

  hamburger.addEventListener('click', () => links.classList.toggle('open'));
  closeBtn.addEventListener('click', () => links.classList.remove('open'));
  links.querySelectorAll('a').forEach(a => {
    a.addEventListener('click', () => links.classList.remove('open'));
  });
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
    btn.textContent = 'Copied ✓';
    setTimeout(() => { btn.textContent = orig; }, 2000);
  });
}

// ── INIT ──────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  createStars();
  initNav();
  initAnonToggle();
  // Auto-init dob inputs
  ['belovedDob', 'senderDob', 'filterDob'].forEach(initDobInput);
});
