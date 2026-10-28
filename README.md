# mysidebar - Opera GX-Style Persistent Sidebar for Chrome & Brave

An always-active, native-feeling sidebar dock that sits directly on your screen edge across all pages, completely independent of Brave's or Chrome's built-in side panel.

## Features Added

1. **Page-Push Layout (Opera GX Style)**:
   - When the dock is visible (and when the drawer opens or resizes), web pages dynamically shift their content margins so the dock never overlaps or covers website buttons or content.

2. **Always Active Across Pages & Home Page**:
   - The dock appears on every website you visit.
   - Includes a sleek dark New Tab / Home Page override (`newtab.html`) with clock, search, and shortcuts where the dock also stays active.
   - Note: Browser internal settings pages (`brave://settings`) are protected by Chromium security and cannot run extensions.

3. **Persistent WhatsApp Session**:
   - Closing, opening, or resizing the drawer does not reload WhatsApp or lose your chat scroll position. The session stays live in memory.

4. **Live Notification Badges with Unread Count**:
   - Built-in bridge script monitors WhatsApp Web unread messages and displays a badge counter directly on the dock's WhatsApp icon, as well as on the browser toolbar extension icon.

5. **Browser Push Notifications**:
   - Manifest configured with `notifications` permission allowing WhatsApp Web notifications.

6. **Unlimited Panel Expansion**:
   - Removed artificial width limits; drag and expand the WhatsApp drawer as wide as you want across your display.

7. **Left / Right Quick-Switch**:
   - Click the `⇋` button on the dock anytime to flip the sidebar between the Left and Right side of your screen.

8. **WhatsApp 400 Bypass**:
   - Uses Declarative Net Request rules (`rules.json`) that rewrite request headers so WhatsApp Web runs without "Sorry, something went wrong" errors.

---

## How to Reload & Test in Brave

1. Open `brave://extensions`.
2. Find **mysidebar**.
3. Click the 🔄 **Reload** icon on the extension card.
4. Open any tab or a new tab — the dock is active on the screen edge ready to use!
