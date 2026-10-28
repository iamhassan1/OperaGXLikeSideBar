// mysidebar - WhatsApp Bridge Script
// Runs inside WhatsApp Web iframe to:
// 1. Detect unread messages and relay the count to the sidebar dock
// 2. Auto-resume session ("Use Here") when switching between browser tabs

(function () {
  'use strict';

  if (window.location.hostname !== 'web.whatsapp.com') return;

  let lastUnreadCount = -1;
  let titleObserver = null;

  // ===================== UNREAD MESSAGE DETECTION =====================
  function getUnreadFromTitle() {
    const match = document.title.match(/^\((\d+)\)/);
    return match ? parseInt(match[1], 10) : 0;
  }

  function reportUnread(count) {
    if (count === lastUnreadCount) return;
    lastUnreadCount = count;
    try {
      chrome.runtime.sendMessage({
        action: 'wa_unread_update',
        count: count
      });
    } catch (e) {
      // Extension context may be invalidated on update
    }
  }

  function watchTitle() {
    const titleEl = document.querySelector('title');
    if (!titleEl) {
      setTimeout(watchTitle, 1000);
      return;
    }

    reportUnread(getUnreadFromTitle());

    titleObserver = new MutationObserver(() => {
      reportUnread(getUnreadFromTitle());
    });

    titleObserver.observe(titleEl, { childList: true, characterData: true, subtree: true });
  }

  function scanDOMForUnread() {
    let total = 0;
    const badges = document.querySelectorAll('[data-testid="icon-unread-count"], span[aria-label*="unread message"]');
    if (badges.length > 0) {
      badges.forEach(badge => {
        const label = badge.getAttribute('aria-label') || badge.closest('[aria-label]')?.getAttribute('aria-label') || badge.textContent || '';
        const match = label.match(/(\d+)/);
        if (match) total += parseInt(match[1], 10);
      });
    }
    return total;
  }

  function periodicScan() {
    const domCount = scanDOMForUnread();
    const titleCount = getUnreadFromTitle();
    const count = titleCount > 0 ? titleCount : domCount;
    reportUnread(count);
    checkAutoResume();
  }

  // ===================== AUTO-RESUME ACROSS TABS =====================
  // When switching between tabs, if WhatsApp shows "Use Here", automatically
  // click it if and only if this tab is the visible foreground tab.
  function checkAutoResume() {
    if (document.visibilityState !== 'visible') return;
    const buttons = document.querySelectorAll('button, [role="button"]');
    for (const btn of buttons) {
      const text = (btn.textContent || '').trim().toLowerCase();
      if (text === 'use here') {
        btn.click();
        break;
      }
    }
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      checkAutoResume();
      setTimeout(checkAutoResume, 300);
    }
  });

  window.addEventListener('focus', () => {
    checkAutoResume();
  });

  function init() {
    watchTitle();
    setInterval(periodicScan, 3000);
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(init, 2000);
  } else {
    window.addEventListener('load', () => setTimeout(init, 2000));
  }
})();
