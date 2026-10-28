// mysidebar - New Tab Page Script
(function () {
  'use strict';

  function updateClock() {
    const now = new Date();
    const clockEl = document.getElementById('clock');
    const dateEl = document.getElementById('dateText');
    if (clockEl) {
      clockEl.textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    if (dateEl) {
      const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
      dateEl.textContent = now.toLocaleDateString(undefined, options);
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    updateClock();
    setInterval(updateClock, 1000);

    const searchInput = document.getElementById('searchInput');
    if (searchInput) {
      searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          const q = e.target.value.trim();
          if (q) {
            if (/^(https?:\/\/|www\.)/i.test(q) || (/^[a-z0-9-]+(\.[a-z]{2,})+/i.test(q) && !q.includes(' '))) {
              window.location.href = q.startsWith('http') ? q : `https://${q}`;
            } else {
              window.location.href = `https://search.brave.com/search?q=${encodeURIComponent(q)}`;
            }
          }
        }
      });
    }
  });
})();

