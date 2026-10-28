# mysidebar — Opera GX-Style Persistent WhatsApp Sidebar for Brave / Chrome

## 1. Project Goal & Architecture

**mysidebar** is a Manifest V3 browser extension for Brave / Chrome (Windows 10/11) paired with a lightweight standalone Win32 C# helper (`mysidebar-dock.cs` -> `mysidebar-dock.exe`) that replicates Opera GX's sidebar behavior:

1. **Always-Active 48px Sidebar Dock (`content.js` + `newtab.html`)**:
   - Injects a 48px dark Shadow DOM sidebar strip (`#mysidebar-root`) on the left or right edge of every webpage and on the custom New Tab / startup page (`newtab.html`).
   - Offsets page content (`html { margin-left: 48px !important; width: calc(100% - 48px) !important }`) and fixed headers/sidebars (including YouTube's `#masthead-container` and `tp-yt-app-drawer#guide`) by **48px only**, so no website UI is covered by the dock.
2. **Single Browser-Wide Persistent WhatsApp Drawer (`background.js` + `drawer.html` + `drawer.js`)**:
   - Instead of creating a separate `<iframe>` inside every tab (which causes WhatsApp to reload on every tab switch and show *"Use WhatsApp Here"*), `background.js` creates **one single persistent popup window** (`drawer.html`) containing `<iframe src="https://web.whatsapp.com/">`.
   - `rules.json` (`declarativeNetRequest`) strips `X-Frame-Options` and `Content-Security-Policy` headers and sets `Sec-Fetch-Dest: document`, `Sec-Fetch-Mode: navigate`, `Sec-Fetch-Site: none` so WhatsApp Web loads inside the iframe without HTTP 400 errors.
   - `whatsapp-bridge.js` runs inside `web.whatsapp.com` to track unread message counts and sync badges across all tabs.
3. **Native Win32 Docking Helper (`mysidebar-dock.cs` / `mysidebar-dock.exe`)**:
   - Listens on `http://127.0.0.1:38492/` (`/show`, `/hide`, `/reposition`, `/metrics`, `/start-resize`).
   - Finds the `WhatsApp — mysidebar` window (`Chrome_WidgetWin_1`) and main Brave window (`braveHwnd`).
   - Uses COM `ITaskbarList::DeleteTab` + `GWLP_HWNDPARENT` to remove the extra taskbar icon and dock the drawer window as an owned window above Brave.

---

## 2. File Inventory

| File | Purpose |
| :--- | :--- |
| `manifest.json` | Manifest V3 config, permissions, content scripts, `declarativeNetRequest` rules, `newtab` override. |
| `rules.json` | Header modification rules allowing `web.whatsapp.com` to load in an extension `<iframe>`. |
| `content.js` | Injects the 48px Shadow DOM dock strip and 48px page-push CSS into every webpage. |
| `background.js` | Service worker managing the single `drawer.html` window and sending coordinates to `127.0.0.1:38492`. |
| `drawer.html` / `drawer.js` | The persistent WhatsApp container with custom header (`WHATSAPP`, Left/Right flip, Refresh, Pin, Close) and drag resizer. |
| `whatsapp-bridge.js` | Extracts unread message count from `web.whatsapp.com` title/DOM and reports to `background.js`. |
| `newtab.html` / `newtab.js` | Custom dark New Tab / startup page that loads `content.js` so the 48px dock is visible immediately on browser launch. |
| `options.html` / `options.js` | Extension settings page (dock side, default width, pin state, cache reset). |
| `mysidebar-dock.cs` / `.exe` | Standalone C# Win32 helper compiled with `.NET Framework csc.exe` (no external dependencies). |
| `Start-DockHelper.bat` | Compiles (if needed) and starts `mysidebar-dock.exe` in the background. |

---

## 3. Root Causes of the 3 Remaining Issues (Diagnosed via Win32 & Pixel Inspection)

### Issue A: Extra Top Bar & Close (`X`) Button + 1px Purple Border on the WhatsApp Drawer
**What caused it:**
1. **`WS_EX_NOREDIRECTIONBITMAP` ignores `SetWindowRgn` on Windows 11:**
   - Chromium (`Chrome_WidgetWin_1`) windows use DirectComposition (`ExStyle = 0x200180`, which includes `WS_EX_NOREDIRECTIONBITMAP = 0x00200000`) and render inside a child window (`Intermediate D3D Window`).
   - On Windows 11, Desktop Window Manager (DWM) **does not clip** `WS_EX_NOREDIRECTIONBITMAP` DirectComposition visual trees using GDI `SetWindowRgn` on the top-level window.
   - Furthermore, calling `SetWindowRgn` while `WS_EX_TOOLWINDOW` and `WS_CAPTION` (`0x00C00000`) are set disables DWM glass and causes Chromium's `OpaqueBrowserFrameView` to paint a 31px dark toolwindow titlebar with a small `X` button at the top-right and a 1px Windows accent border (purple).
2. **Stripping `WS_CAPTION` removes the `X` button, and Parenting (`SetParent`) hardware-clips the top bar:**
   - Stripping `WS_CAPTION (0x00C00000) | WS_THICKFRAME (0x00040000) | WS_SYSMENU (0x00080000)` from `GWL_STYLE` removes the `X`, `-`, `□` buttons.
   - To 100% clip off the remaining 39px blank Chromium titlebar strip on Windows 11 (`WS_EX_NOREDIRECTIONBITMAP`), `mysidebar-dock.exe` should host `drawerHwnd` inside a borderless native `WS_POPUP | WS_CLIPCHILDREN` container window (`SetParent(drawerHwnd, containerHwnd)`) with `drawerHwnd` positioned at `(-borderLeft, -titlebarTop)`. Windows DWM strictly hardware-clips child windows to the parent container's `(0, 0, width, height)` bounds, and setting `DwmSetWindowAttribute(containerHwnd, DWMWA_BORDER_COLOR (34), DWMWA_COLOR_NONE (0xFFFFFFFE))` removes the 1px purple accent border.
3. **UTF-8 Em-Dash (`—`) Encoding Bug with `csc.exe`:**
   - `drawer.html` used `<title>WhatsApp — mysidebar</title>` (with Unicode `U+2014` em-dash). When `mysidebar-dock.cs` was saved without a UTF-8 BOM, `.NET Framework csc.exe` compiled the string literal as `Windows-1252` (`"WhatsApp â€” mysidebar"`), which failed to match the window title unless matched via ASCII.

---

### Issue B: WhatsApp Drawer Misaligned with the 48px Sidebar Dock (and Growing Too Wide)
**What caused it:**
1. **Missing `SetProcessDPIAware()` in `mysidebar-dock.cs` on 125% DPI (`120 DPI`) Display:**
   - On a 125% scaling display (`window.devicePixelRatio = 1.25`), `content.js` and `background.js` multiplied coordinates and `panelWidth` by `dpr = 1.25` to send physical pixels, **but `mysidebar-dock.cs` did not call `SetProcessDPIAware()`**.
   - Because `mysidebar-dock.exe` was DPI-unaware, Windows scaled the `SetWindowPos` coordinates by `1.25` a **second time**!
2. **Resize Feedback Loop in `drawer.js`:**
   - In `drawer.js` lines 114–118:
     ```js
     window.addEventListener('resize', () => {
       if (window.innerWidth > 260) {
         chrome.storage.local.set({ panelWidth: window.innerWidth });
       }
     });
     ```
   - Because `mysidebar-dock.exe` scaled the width by `1.25x`, `drawer.js`'s `resize` listener saved the inflated width back into `chrome.storage.local.panelWidth`, which then got multiplied by `1.25x` again on the next open (`430 -> 538 -> 672 -> 840 -> 1050+`).
3. **Subtracting `titlebarTop` and `borderLeft` When `SetWindowRgn` Was Ignored:**
   - `PositionDrawerWindow()` placed the window at `winX = targetVisibleX - borderLeft` and `winY = targetVisibleY - titlebarTop`. Because Windows 11 ignored `SetWindowRgn` on `drawerHwnd`, shifting the window by `(-8, -31)` visibly pushed the top of the window 31px **up into Brave's bookmarks bar** and 8px **left over the 48px sidebar dock**.

---

### Issue C: 48px Sidebar & Drawer Still Visible in Fullscreen Video Mode
**What caused it:**
1. **Inline `!important` Specificity Override in `content.js`:**
   - `content.js` line 386 set `host.style.cssText = "... display: block !important;"`.
   - In CSS, an inline `style="display: block !important"` always overrides stylesheet rules like `html:has(:fullscreen) #mysidebar-root { display: none !important; }`.
2. **No Fullscreen Event Listener Hiding the Host & Native Drawer:**
   - `content.js` had no `fullscreenchange` / `webkitfullscreenchange` JS listener to toggle `host.style.setProperty('display', 'none', 'important')`, reset `--mysidebar-left: 0px` / `--mysidebar-total: 0px`, or notify `mysidebar-dock.exe` to hide `drawerHwnd` when a video player enters fullscreen.

---

## 4. Exact Fix Implementation Plan

### Step 1: Fix `drawer.html` & `drawer.js`
1. **In `drawer.html`**:
   - Change `<title>WhatsApp — mysidebar</title>` to pure ASCII `<title>WhatsApp - mysidebar</title>` so `csc.exe` encoding never mangles title matching.
2. **In `drawer.js`**:
   - Remove the unconditional `window.addEventListener('resize', ...)` storage write (lines 114–118) that caused the `panelWidth` inflation loop. Only save `panelWidth` to `chrome.storage.local` inside the `#drawerResizer` drag handler (`onMouseMove` / `onMouseUp`).

### Step 2: Fix Fullscreen Video & Exact Cursor-Anchored Coordinates in `content.js`
1. **Fullscreen Video Detection (`content.js`)**:
   Add a `fullscreenchange`, `webkitfullscreenchange`, and `resize` listener in `content.js`:
   ```javascript
   function isFullscreenActive() {
     if (document.fullscreenElement || document.webkitFullscreenElement) return true;
     // Also detect F11 / browser fullscreen
     if (
       Math.abs(window.innerWidth - window.screen.width) <= 2 &&
       Math.abs(window.innerHeight - window.screen.height) <= 2
     ) {
       return true;
     }
     return false;
   }

   function handleFullscreenChange() {
     const fs = isFullscreenActive();
     const root = document.documentElement;
     if (fs) {
       host.style.setProperty('display', 'none', 'important');
       if (root) {
         root.style.setProperty('--mysidebar-left', '0px');
         root.style.setProperty('--mysidebar-right', '0px');
         root.style.setProperty('--mysidebar-total', '0px');
       }
       fetch('http://127.0.0.1:38492/fullscreen?active=1', { mode: 'no-cors' }).catch(() => {});
     } else {
       host.style.setProperty('display', 'block', 'important');
       applyPagePush();
       fetch('http://127.0.0.1:38492/fullscreen?active=0', { mode: 'no-cors' }).catch(() => {});
     }
   }

   document.addEventListener('fullscreenchange', handleFullscreenChange, true);
   document.addEventListener('webkitfullscreenchange', handleFullscreenChange, true);
   window.addEventListener('resize', handleFullscreenChange, { passive: true });
   ```
2. **Exact Viewport Origin via Win32 `GetCursorPos` Anchor (`content.js`)**:
   - When the user clicks `#waDockBtn` or `#dockSideBtn`, `e.clientX` and `e.clientY` give the exact CSS offset of the mouse cursor from the top-left corner `(0, 0)` of the webpage viewport (which is the top-left corner of the 48px dock).
   - Send `clientX: e.clientX`, `clientY: e.clientY`, `innerW: window.innerWidth`, `innerH: window.innerHeight`, `dpr: window.devicePixelRatio` to `mysidebar-dock.exe`.
   - Inside `mysidebar-dock.exe` (with `SetProcessDPIAware()` enabled), call `GetCursorPos(out pt)` at the moment of the click to compute the exact physical screen pixel of the viewport top-left corner:
     ```csharp
     vpLeft = pt.X - (int)Math.Round(clientX * dpr);
     vpTop  = pt.Y - (int)Math.Round(clientY * dpr);
     vpWidth  = (int)Math.Round(innerW * dpr);
     vpHeight = (int)Math.Round(innerH * dpr);
     ```
   - This eliminates all Chromium `window.screenX` / DPI-rounding discrepancies on any monitor.

### Step 3: Fix `mysidebar-dock.cs` (DPI Awareness + Borderless Container Clipping + Fullscreen Hide)
1. **Call `SetProcessDPIAware()` at the very top of `Main()`**:
   ```csharp
   [DllImport("user32.dll")]
   private static extern bool SetProcessDPIAware();
   ```
2. **Match `drawerHwnd` with pure ASCII**:
   ```csharp
   if (title.Contains("WhatsApp") && title.Contains("mysidebar"))
   {
       drawerHwnd = hWnd;
   }
   ```
   And ensure `braveHwnd` never matches `drawerHwnd`:
   ```csharp
   else if (hWnd != drawerHwnd && IsWindowVisible(hWnd) && (title.EndsWith("- Brave") || title.EndsWith("- Google Chrome")))
   ```
3. **Eliminate the Top Bar, `X` Button, and 1px Purple Border on Windows 11**:
   - Create a borderless, taskbar-free Win32/WinForms host window `containerForm` (`FormBorderStyle.None`, `ShowInTaskbar = false`, `WS_CLIPCHILDREN`, owned by `braveHwnd` via `GWLP_HWNDPARENT`):
     ```csharp
     int colorNone = unchecked((int)0xFFFFFFFE); // DWMWA_COLOR_NONE
     DwmSetWindowAttribute(containerHwnd, 34, ref colorNone, sizeof(int));
     int cornerSharp = 1; // DWMWCP_DONOTROUND
     DwmSetWindowAttribute(containerHwnd, 33, ref cornerSharp, sizeof(int));
     ```
   - Strip `WS_CAPTION | WS_THICKFRAME | WS_SYSMENU | WS_BORDER | WS_DLGFRAME` from `drawerHwnd`.
   - Parent `drawerHwnd` inside `containerHwnd` (`SetParent(drawerHwnd, containerHwnd)`) and position:
     - `containerHwnd` at `(targetVisibleX, targetVisibleY, targetVisibleW, targetVisibleH)` (exact alignment flush with the 48px dock: `targetVisibleX = vpLeft + Math.Round(48 * dpr)`, `targetVisibleY = vpTop`).
     - `drawerHwnd` inside `containerHwnd` at `(-borderLeft, -titlebarTop, targetVisibleW + borderLeft + borderRight, targetVisibleH + titlebarTop + borderBottom)` where `borderLeft = 8` and `titlebarTop = (int)Math.Round(31 * dpr)` (or `totalH - innerH - borderBottom`).
   - Because `containerHwnd` is a parent window with `WS_CLIPCHILDREN`, Windows 11 DWM hardware-clips `drawerHwnd`'s top titlebar (`-titlebarTop..0`) and side borders completely, leaving **zero** top bar, **zero** extra `X` button, and **zero** purple border.
   - Before `mysidebar-dock.exe` exits, call `SetParent(drawerHwnd, IntPtr.Zero)` so `drawerHwnd` is preserved.
4. **Fullscreen Auto-Hide in `mysidebar-dock.cs`**:
   - Handle `/fullscreen?active=1` and `/fullscreen?active=0` (and check via `MonitorFromWindow` / `GetMonitorInfo` if `braveHwnd` covers the entire `rcMonitor` screen bounds).
   - When fullscreen is active, immediately hide `containerHwnd` (`ShowWindow(containerHwnd, SW_HIDE)`). When exiting fullscreen, if `isDrawerOpen` is true, show `containerHwnd` again.

### Step 4: Clamp Inflated `panelWidth` in `background.js`
- In `background.js`, when reading `panelWidth` from `chrome.storage.local`, if `panelWidth > 650` (left over from the previous DPI feedback loop), reset it to `430`.

---

## 5. How to Recompile & Restart `mysidebar-dock.exe`

Run the following in PowerShell from the project root (`c:\Users\User\Desktop\Website HTML Section\Extensions\SidebarExtension`):

```powershell
# 1. Stop any running instance of mysidebar-dock
Stop-Process -Name "mysidebar-dock" -Force -ErrorAction SilentlyContinue

# 2. Compile mysidebar-dock.cs into a standalone Windows executable
& "C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe" /nologo /target:winexe /r:System.Windows.Forms.dll /r:System.Drawing.dll /out:"mysidebar-dock.exe" "mysidebar-dock.cs"

# 3. Start mysidebar-dock.exe in the background
Start-Process -FilePath ".\mysidebar-dock.exe" -WindowStyle Hidden
```

Then reload the **mysidebar** extension in `brave://extensions`.
