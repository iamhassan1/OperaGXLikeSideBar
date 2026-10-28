using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Net;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using Microsoft.Win32;

namespace MySidebarDock
{
    class Program
    {
        // ===================== WIN32 API DECLARATIONS =====================
        private delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

        [DllImport("user32.dll")]
        private static extern bool EnumWindows(EnumWindowsProc enumProc, IntPtr lParam);

        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        private static extern int GetWindowText(IntPtr hWnd, StringBuilder strText, int maxCount);

        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        private static extern int GetClassName(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);

        [DllImport("user32.dll")]
        private static extern bool IsWindow(IntPtr hWnd);

        [DllImport("user32.dll")]
        private static extern bool IsWindowVisible(IntPtr hWnd);

        [DllImport("user32.dll")]
        private static extern bool IsIconic(IntPtr hWnd);

        [DllImport("user32.dll")]
        private static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);

        [DllImport("user32.dll")]
        private static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);

        [DllImport("user32.dll")]
        private static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

        [DllImport("user32.dll")]
        private static extern IntPtr GetForegroundWindow();

        [DllImport("user32.dll")]
        private static extern bool SetForegroundWindow(IntPtr hWnd);

        [DllImport("user32.dll", EntryPoint = "GetWindowLongPtr")]
        private static extern IntPtr GetWindowLongPtr64(IntPtr hWnd, int nIndex);

        [DllImport("user32.dll", EntryPoint = "SetWindowLongPtr")]
        private static extern IntPtr SetWindowLongPtr64(IntPtr hWnd, int nIndex, IntPtr dwNewLong);

        [DllImport("user32.dll")]
        private static extern int SetWindowRgn(IntPtr hWnd, IntPtr hRgn, bool bRedraw);

        [DllImport("gdi32.dll")]
        private static extern IntPtr CreateRectRgn(int nLeftRect, int nTopRect, int nRightRect, int nBottomRect);

        [DllImport("user32.dll")]
        private static extern bool GetCursorPos(out POINT lpPoint);

        [DllImport("user32.dll")]
        private static extern short GetAsyncKeyState(int vKey);

        [StructLayout(LayoutKind.Sequential)]
        public struct RECT
        {
            public int Left;
            public int Top;
            public int Right;
            public int Bottom;
        }

        [StructLayout(LayoutKind.Sequential)]
        public struct POINT
        {
            public int X;
            public int Y;
        }

        // COM ITaskbarList to delete taskbar icon cleanly
        [ComImport]
        [Guid("56FDF342-FD6D-11d0-958A-006097C9A090")]
        [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        private interface ITaskbarList
        {
            [PreserveSig] void HrInit();
            [PreserveSig] void AddTab(IntPtr hwnd);
            [PreserveSig] void DeleteTab(IntPtr hwnd);
            [PreserveSig] void ActivateTab(IntPtr hwnd);
            [PreserveSig] void SetActiveAlt(IntPtr hwnd);
        }

        [ComImport]
        [Guid("56FDF344-FD6D-11d0-958A-006097C9A090")]
        private class TaskbarList { }

        private const int GWL_STYLE = -16;
        private const int GWL_EXSTYLE = -20;
        private const int GWLP_HWNDPARENT = -8;

        private const long WS_EX_TOOLWINDOW = 0x00000080L;
        private const long WS_EX_APPWINDOW = 0x00040000L;

        private const uint SWP_NOZORDER = 0x0004;
        private const uint SWP_NOACTIVATE = 0x0010;
        private const uint SWP_FRAMECHANGED = 0x0020;

        private const int SW_HIDE = 0;
        private const int SW_SHOW = 5;
        private const int SW_RESTORE = 9;
        private const int VK_LBUTTON = 0x01;

        // ===================== STATE =====================
        private static IntPtr drawerHwnd = IntPtr.Zero;
        private static IntPtr braveHwnd = IntPtr.Zero;
        private static ITaskbarList taskbarList = null;

        private static double dpr = 1.0;
        private static int borderLeft = 8;
        private static int borderRight = 8;
        private static int borderBottom = 8;
        private static int titlebarTop = 32;

        private static int vpLeft = 0;
        private static int vpTop = 80;
        private static int vpWidth = 1366;
        private static int vpHeight = 700;
        private static int panelWidth = 430;
        private static string dockSide = "left";
        private static bool isDrawerOpen = false;
        private static bool isResizing = false;
        private static int resizeStartCursorX = 0;
        private static int resizeStartPanelW = 430;

        private static readonly object stateLock = new object();

        [STAThread]
        static void Main(string[] args)
        {
            bool createdNew;
            using (Mutex mutex = new Mutex(true, @"Global\MySidebarDockHelperMutex", out createdNew))
            {
                if (!createdNew)
                {
                    return; // Already running
                }

                try
                {
                    // Register in Windows Startup so user never has to start it manually
                    string exePath = Process.GetCurrentProcess().MainModule.FileName;
                    using (RegistryKey rk = Registry.CurrentUser.OpenSubKey(@"SOFTWARE\Microsoft\Windows\CurrentVersion\Run", true))
                    {
                        if (rk != null)
                        {
                            rk.SetValue("MySidebarDockHelper", "\"" + exePath + "\"");
                        }
                    }
                }
                catch { }

                try
                {
                    taskbarList = (ITaskbarList)new TaskbarList();
                    taskbarList.HrInit();
                }
                catch { }

                Thread httpThread = new Thread(RunHttpServer);
                httpThread.IsBackground = true;
                httpThread.Start();

                // Main Win32 management loop
                while (true)
                {
                    try
                    {
                        TickWindowManagement();
                    }
                    catch { }
                    Thread.Sleep(isResizing ? 8 : 25);
                }
            }
        }

        private static void FindWindows()
        {
            if (drawerHwnd != IntPtr.Zero && !IsWindow(drawerHwnd))
            {
                drawerHwnd = IntPtr.Zero;
            }
            if (braveHwnd != IntPtr.Zero && !IsWindow(braveHwnd))
            {
                braveHwnd = IntPtr.Zero;
            }

            EnumWindows((hWnd, lParam) =>
            {
                StringBuilder cls = new StringBuilder(64);
                GetClassName(hWnd, cls, cls.Capacity);
                if (cls.ToString() != "Chrome_WidgetWin_1") return true;

                StringBuilder sb = new StringBuilder(256);
                GetWindowText(hWnd, sb, sb.Capacity);
                string title = sb.ToString();
                if (string.IsNullOrEmpty(title)) return true;

                if (title.Contains("WhatsApp — mysidebar"))
                {
                    drawerHwnd = hWnd;
                }
                else if (IsWindowVisible(hWnd) && (title.EndsWith("- Brave") || title.EndsWith("- Google Chrome") || title.StartsWith("New Tab")))
                {
                    if (braveHwnd == IntPtr.Zero || GetForegroundWindow() == hWnd)
                    {
                        braveHwnd = hWnd;
                    }
                }
                return true;
            }, IntPtr.Zero);
        }

        private static void ApplyBorderlessAndOwner(IntPtr hwnd)
        {
            if (hwnd == IntPtr.Zero || !IsWindow(hwnd)) return;

            // 1. Set WS_EX_TOOLWINDOW and remove WS_EX_APPWINDOW so Windows removes taskbar icon
            long exStyle = GetWindowLongPtr64(hwnd, GWL_EXSTYLE).ToInt64();
            long desiredEx = (exStyle | WS_EX_TOOLWINDOW) & ~WS_EX_APPWINDOW;
            if (exStyle != desiredEx)
            {
                SetWindowLongPtr64(hwnd, GWL_EXSTYLE, new IntPtr(desiredEx));
            }

            // 2. Delete tab from Windows Taskbar via COM ITaskbarList
            if (taskbarList != null)
            {
                try { taskbarList.DeleteTab(hwnd); } catch { }
            }

            // 3. Dock to main Brave window (GWLP_HWNDPARENT) so it stays attached over Brave across all tabs
            if (braveHwnd != IntPtr.Zero && IsWindow(braveHwnd) && braveHwnd != hwnd)
            {
                IntPtr currentOwner = GetWindowLongPtr64(hwnd, GWLP_HWNDPARENT);
                if (currentOwner != braveHwnd)
                {
                    SetWindowLongPtr64(hwnd, GWLP_HWNDPARENT, braveHwnd);
                }
            }

            // 4. Clip off the top titlebar (-, □, X) and outer shadow borders using SetWindowRgn
            RECT r;
            if (GetWindowRect(hwnd, out r))
            {
                int w = r.Right - r.Left;
                int h = r.Bottom - r.Top;
                if (w > borderLeft + borderRight + 50 && h > titlebarTop + borderBottom + 50)
                {
                    IntPtr hRgn = CreateRectRgn(borderLeft, titlebarTop, w - borderRight, h - borderBottom);
                    SetWindowRgn(hwnd, hRgn, true);
                }
            }
        }

        private static void PositionDrawerWindow(bool activate)
        {
            if (drawerHwnd == IntPtr.Zero || !IsWindow(drawerHwnd)) return;

            int dockW = (int)Math.Round(48 * dpr);
            int targetVisibleW = Math.Max((int)Math.Round(280 * dpr), panelWidth);
            int targetVisibleH = Math.Max(300, vpHeight);

            int targetVisibleX;
            if (dockSide == "right")
            {
                targetVisibleX = vpLeft + vpWidth - dockW - targetVisibleW;
            }
            else
            {
                targetVisibleX = vpLeft + dockW;
            }
            int targetVisibleY = vpTop;

            int winX = targetVisibleX - borderLeft;
            int winY = targetVisibleY - titlebarTop;
            int winW = targetVisibleW + borderLeft + borderRight;
            int winH = targetVisibleH + titlebarTop + borderBottom;

            uint flags = SWP_NOZORDER | SWP_FRAMECHANGED | (activate ? 0 : SWP_NOACTIVATE);
            SetWindowPos(drawerHwnd, IntPtr.Zero, winX, winY, winW, winH, flags);
            ApplyBorderlessAndOwner(drawerHwnd);
        }

        private static void TickWindowManagement()
        {
            lock (stateLock)
            {
                FindWindows();
                if (drawerHwnd == IntPtr.Zero) return;

                ApplyBorderlessAndOwner(drawerHwnd);

                // Handle live 120Hz mouse drag resizing
                if (isResizing)
                {
                    short keyState = GetAsyncKeyState(VK_LBUTTON);
                    if ((keyState & 0x8000) == 0)
                    {
                        isResizing = false;
                    }
                    else
                    {
                        POINT pt;
                        if (GetCursorPos(out pt))
                        {
                            int delta = pt.X - resizeStartCursorX;
                            int maxW = Math.Max(400, vpWidth - (int)Math.Round(68 * dpr));
                            int newW = dockSide == "right" ? (resizeStartPanelW - delta) : (resizeStartPanelW + delta);
                            panelWidth = Math.Max((int)Math.Round(280 * dpr), Math.Min(newW, maxW));
                            PositionDrawerWindow(false);
                        }
                    }
                }

                // Hide drawer automatically if main Brave window is minimized
                if (braveHwnd != IntPtr.Zero && IsIconic(braveHwnd))
                {
                    if (IsWindowVisible(drawerHwnd))
                    {
                        ShowWindow(drawerHwnd, SW_HIDE);
                    }
                }
                else if (isDrawerOpen && !IsWindowVisible(drawerHwnd))
                {
                    ShowWindow(drawerHwnd, SW_SHOW);
                    PositionDrawerWindow(true);
                }
            }
        }

        private static void RunHttpServer()
        {
            HttpListener listener = new HttpListener();
            listener.Prefixes.Add("http://127.0.0.1:38492/");
            try
            {
                listener.Start();
            }
            catch
            {
                return;
            }

            while (true)
            {
                try
                {
                    HttpListenerContext ctx = listener.GetContext();
                    ThreadPool.QueueUserWorkItem(_ => HandleRequest(ctx));
                }
                catch { }
            }
        }

        private static void HandleRequest(HttpListenerContext ctx)
        {
            try
            {
                string path = ctx.Request.Url.AbsolutePath.ToLowerInvariant();
                var q = ctx.Request.QueryString;

                lock (stateLock)
                {
                    FindWindows();

                    if (q["dpr"] != null) double.TryParse(q["dpr"], System.Globalization.NumberStyles.Any, System.Globalization.CultureInfo.InvariantCulture, out dpr);
                    if (dpr < 0.5) dpr = 1.0;

                    if (q["vpLeft"] != null) int.TryParse(q["vpLeft"], out vpLeft);
                    if (q["vpTop"] != null) int.TryParse(q["vpTop"], out vpTop);
                    if (q["vpWidth"] != null) int.TryParse(q["vpWidth"], out vpWidth);
                    if (q["vpHeight"] != null) int.TryParse(q["vpHeight"], out vpHeight);
                    if (q["panelWidth"] != null) int.TryParse(q["panelWidth"], out panelWidth);
                    if (q["side"] != null) dockSide = q["side"];

                    if (path == "/metrics")
                    {
                        int innerW = 0, innerH = 0;
                        int.TryParse(q["innerW"], out innerW);
                        int.TryParse(q["innerH"], out innerH);

                        if (drawerHwnd != IntPtr.Zero && innerW > 0 && innerH > 0)
                        {
                            RECT r;
                            if (GetWindowRect(drawerHwnd, out r))
                            {
                                int totalW = r.Right - r.Left;
                                int totalH = r.Bottom - r.Top;
                                if (totalW >= innerW && totalH >= innerH)
                                {
                                    int calcBorder = (totalW - innerW) / 2;
                                    int calcTop = totalH - innerH - calcBorder;
                                    if (calcBorder >= 0 && calcBorder <= 24 && calcTop >= 0 && calcTop <= 80)
                                    {
                                        borderLeft = calcBorder;
                                        borderRight = totalW - innerW - borderLeft;
                                        borderBottom = calcBorder;
                                        titlebarTop = calcTop;
                                    }
                                }
                            }
                            ApplyBorderlessAndOwner(drawerHwnd);
                            if (isDrawerOpen && !isResizing)
                            {
                                PositionDrawerWindow(false);
                            }
                        }
                    }
                    else if (path == "/show")
                    {
                        isDrawerOpen = true;
                        if (drawerHwnd != IntPtr.Zero && IsWindow(drawerHwnd))
                        {
                            if (IsIconic(drawerHwnd)) ShowWindow(drawerHwnd, SW_RESTORE);
                            ShowWindow(drawerHwnd, SW_SHOW);
                            PositionDrawerWindow(true);
                            SetForegroundWindow(drawerHwnd);
                        }
                    }
                    else if (path == "/hide")
                    {
                        isDrawerOpen = false;
                        if (drawerHwnd != IntPtr.Zero && IsWindow(drawerHwnd))
                        {
                            ShowWindow(drawerHwnd, SW_HIDE);
                        }
                        if (braveHwnd != IntPtr.Zero && IsWindow(braveHwnd))
                        {
                            SetForegroundWindow(braveHwnd);
                        }
                    }
                    else if (path == "/reposition")
                    {
                        if (drawerHwnd != IntPtr.Zero && isDrawerOpen)
                        {
                            PositionDrawerWindow(false);
                        }
                    }
                    else if (path == "/start-resize")
                    {
                        POINT pt;
                        if (GetCursorPos(out pt))
                        {
                            resizeStartCursorX = pt.X;
                            resizeStartPanelW = panelWidth;
                            isResizing = true;
                        }
                    }
                }

                ctx.Response.Headers.Add("Access-Control-Allow-Origin", "*");
                ctx.Response.StatusCode = 200;
                byte[] buf = Encoding.UTF8.GetBytes("{\"ok\":true,\"hasWindow\":" + (drawerHwnd != IntPtr.Zero ? "true" : "false") + "}");
                ctx.Response.ContentType = "application/json";
                ctx.Response.ContentLength64 = buf.Length;
                ctx.Response.OutputStream.Write(buf, 0, buf.Length);
                ctx.Response.Close();
            }
            catch
            {
                try { ctx.Response.Close(); } catch { }
            }
        }
    }
}

