Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

Add-Type -AssemblyName Accessibility
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName WindowsBase

Add-Type -ReferencedAssemblies @("System.dll", "Accessibility.dll") -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

public static class NativeTrayProbe
{
    private const uint OBJID_CLIENT = 0xFFFFFFFC;
    private const int ROLE_SYSTEM_MENUITEM = 0x0C;
    private const int STATE_SYSTEM_UNAVAILABLE = 0x00000001;
    private const int STATE_SYSTEM_CHECKED = 0x00000010;
    private const int STATE_SYSTEM_MIXED = 0x00000020;

    private const uint INPUT_MOUSE = 0;
    private const uint INPUT_KEYBOARD = 1;
    private const uint MOUSEEVENTF_MOVE = 0x0001;
    private const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
    private const uint MOUSEEVENTF_LEFTUP = 0x0004;
    private const uint MOUSEEVENTF_RIGHTDOWN = 0x0008;
    private const uint MOUSEEVENTF_RIGHTUP = 0x0010;
    private const uint MOUSEEVENTF_VIRTUALDESK = 0x4000;
    private const uint MOUSEEVENTF_ABSOLUTE = 0x8000;
    private const uint KEYEVENTF_KEYUP = 0x0002;
    private const int VK_LBUTTON = 0x01;
    private const int VK_RBUTTON = 0x02;
    private const int VK_MBUTTON = 0x04;
    private const int VK_XBUTTON1 = 0x05;
    private const int VK_XBUTTON2 = 0x06;
    private const ushort VK_SHIFT = 0x10;
    private const ushort VK_CONTROL = 0x11;
    private const ushort VK_MENU = 0x12;
    private const ushort VK_ESCAPE = 0x1B;
    private const ushort VK_B = 0x42;
    private const ushort VK_LWIN = 0x5B;
    private const ushort VK_RWIN = 0x5C;
    private const ushort VK_LSHIFT = 0xA0;
    private const ushort VK_RSHIFT = 0xA1;
    private const ushort VK_LCONTROL = 0xA2;
    private const ushort VK_RCONTROL = 0xA3;
    private const ushort VK_LMENU = 0xA4;
    private const ushort VK_RMENU = 0xA5;
    private const uint GA_ROOT = 2;
    private const uint WM_CANCELMODE = 0x001F;
    private const uint WM_KEYDOWN = 0x0100;
    private const uint WM_KEYUP = 0x0101;
    private const uint DESKTOP_READOBJECTS = 0x0001;
    private const int UOI_NAME = 2;

    private const int SM_XVIRTUALSCREEN = 76;
    private const int SM_YVIRTUALSCREEN = 77;
    private const int SM_CXVIRTUALSCREEN = 78;
    private const int SM_CYVIRTUALSCREEN = 79;

    private delegate bool EnumWindowsProc(IntPtr window, IntPtr parameter);

    [StructLayout(LayoutKind.Sequential)]
    public struct Rect
    {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;

        public int Width { get { return Right - Left; } }
        public int Height { get { return Bottom - Top; } }
        public int CenterX { get { return Left + (Width / 2); } }
        public int CenterY { get { return Top + (Height / 2); } }
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct Point
    {
        public int X;
        public int Y;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct NotifyIconIdentifier
    {
        public uint cbSize;
        public IntPtr hWnd;
        public uint uID;
        public Guid guidItem;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct MouseInput
    {
        public int dx;
        public int dy;
        public uint mouseData;
        public uint dwFlags;
        public uint time;
        public IntPtr dwExtraInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct KeyboardInput
    {
        public ushort wVk;
        public ushort wScan;
        public uint dwFlags;
        public uint time;
        public IntPtr dwExtraInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct HardwareInput
    {
        public uint uMsg;
        public ushort wParamL;
        public ushort wParamH;
    }

    [StructLayout(LayoutKind.Explicit)]
    private struct InputUnion
    {
        [FieldOffset(0)] public MouseInput mi;
        [FieldOffset(0)] public KeyboardInput ki;
        [FieldOffset(0)] public HardwareInput hi;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct Input
    {
        public uint type;
        public InputUnion value;
    }

    public sealed class NotifyIconMatch
    {
        public uint Id { get; set; }
        public Rect Bounds { get; set; }
    }

    public sealed class MenuItemSnapshot
    {
        public int ChildId { get; set; }
        public string Name { get; set; }
        public bool Enabled { get; set; }
        public string ToggleState { get; set; }
        public Rect Bounds { get; set; }
    }

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool EnumWindows(EnumWindowsProc callback, IntPtr parameter);

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetClassNameW(IntPtr window, StringBuilder className, int maximumCount);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool IsWindowVisible(IntPtr window);

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetWindowRect(IntPtr window, out Rect rect);

    [DllImport("user32.dll")]
    private static extern IntPtr WindowFromPoint(Point point);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern IntPtr FindWindowW(string className, string windowName);

    [DllImport("user32.dll")]
    private static extern IntPtr GetAncestor(IntPtr window, uint flags);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool SetProcessDpiAwarenessContext(IntPtr value);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool SetCursorPos(int x, int y);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetCursorPos(out Point point);

    [DllImport("user32.dll")]
    private static extern short GetAsyncKeyState(int virtualKey);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern IntPtr OpenInputDesktop(uint flags, bool inherit, uint desiredAccess);

    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetUserObjectInformationW(
        IntPtr handle,
        int index,
        StringBuilder information,
        int length,
        out int needed);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CloseDesktop(IntPtr desktop);

    [DllImport("kernel32.dll")]
    private static extern uint GetCurrentProcessId();

    [DllImport("kernel32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool ProcessIdToSessionId(uint processId, out uint sessionId);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern uint SendInput(uint count, Input[] inputs, int size);

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool PostMessageW(IntPtr window, uint message, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll")]
    private static extern int GetSystemMetrics(int index);

    [DllImport("shell32.dll")]
    private static extern int Shell_NotifyIconGetRect(
        ref NotifyIconIdentifier identifier,
        out Rect iconLocation);

    [DllImport("oleacc.dll", PreserveSig = true)]
    private static extern int AccessibleObjectFromWindow(
        IntPtr window,
        uint objectId,
        ref Guid interfaceId,
        [MarshalAs(UnmanagedType.Interface)] out Accessibility.IAccessible accessible);

    public static void EnablePerMonitorDpi()
    {
        try
        {
            SetProcessDpiAwarenessContext(new IntPtr(-4));
        }
        catch
        {
            // The process may already have selected an equally strict context.
        }
    }

    public static void AssertInteractiveDefaultDesktop()
    {
        IntPtr desktop = OpenInputDesktop(0, false, DESKTOP_READOBJECTS);
        if (desktop == IntPtr.Zero)
        {
            throw new InvalidOperationException(
                "The interactive input desktop is unavailable; the session may be locked.");
        }
        try
        {
            var name = new StringBuilder(256);
            int needed;
            if (!GetUserObjectInformationW(
                desktop,
                UOI_NAME,
                name,
                name.Capacity * sizeof(char),
                out needed) ||
                !string.Equals(name.ToString(), "Default", StringComparison.OrdinalIgnoreCase))
            {
                throw new InvalidOperationException(
                    "Global input automation requires the unlocked Default desktop.");
            }
        }
        finally
        {
            CloseDesktop(desktop);
        }

        IntPtr shell = FindWindowW("Shell_TrayWnd", null);
        uint shellProcessId;
        GetWindowThreadProcessId(shell, out shellProcessId);
        uint currentSession;
        uint shellSession;
        if (shell == IntPtr.Zero || shellProcessId == 0 ||
            !ProcessIdToSessionId(GetCurrentProcessId(), out currentSession) ||
            !ProcessIdToSessionId(shellProcessId, out shellSession) ||
            currentSession != shellSession)
        {
            throw new InvalidOperationException(
                "The Explorer taskbar is unavailable in the current interactive session.");
        }
    }

    public static long[] FindWindows(uint processId, string expectedClass)
    {
        var matches = new List<long>();
        EnumWindows(delegate (IntPtr window, IntPtr parameter)
        {
            uint owner;
            GetWindowThreadProcessId(window, out owner);
            if (owner != processId)
            {
                return true;
            }

            var className = new StringBuilder(128);
            GetClassNameW(window, className, className.Capacity);
            if (string.Equals(className.ToString(), expectedClass, StringComparison.Ordinal))
            {
                matches.Add(window.ToInt64());
            }
            return true;
        }, IntPtr.Zero);
        return matches.ToArray();
    }

    public static long[] FindVisiblePopupMenus(uint processId)
    {
        var matches = new List<long>();
        EnumWindows(delegate (IntPtr window, IntPtr parameter)
        {
            uint owner;
            GetWindowThreadProcessId(window, out owner);
            if (owner != processId || !IsWindowVisible(window))
            {
                return true;
            }

            var className = new StringBuilder(32);
            GetClassNameW(window, className, className.Capacity);
            if (string.Equals(className.ToString(), "#32768", StringComparison.Ordinal))
            {
                matches.Add(window.ToInt64());
            }
            return true;
        }, IntPtr.Zero);
        return matches.ToArray();
    }

    public static NotifyIconMatch[] FindNotifyIcons(IntPtr trayWindow, uint minimumId, uint maximumId)
    {
        var matches = new List<NotifyIconMatch>();
        for (uint id = minimumId; id <= maximumId; id++)
        {
            Rect rect;
            var identifier = new NotifyIconIdentifier
            {
                cbSize = (uint)Marshal.SizeOf(typeof(NotifyIconIdentifier)),
                hWnd = trayWindow,
                uID = id,
                guidItem = Guid.Empty,
            };
            if (Shell_NotifyIconGetRect(ref identifier, out rect) == 0)
            {
                matches.Add(new NotifyIconMatch { Id = id, Bounds = rect });
            }
        }
        return matches.ToArray();
    }

    public static Rect GetNotifyIconRect(IntPtr trayWindow, uint id)
    {
        Rect rect;
        var identifier = new NotifyIconIdentifier
        {
            cbSize = (uint)Marshal.SizeOf(typeof(NotifyIconIdentifier)),
            hWnd = trayWindow,
            uID = id,
            guidItem = Guid.Empty,
        };
        int result = Shell_NotifyIconGetRect(ref identifier, out rect);
        if (result != 0)
        {
            throw new InvalidOperationException(
                "Shell_NotifyIconGetRect failed with HRESULT 0x" + result.ToString("X8") + ".");
        }
        return rect;
    }

    public static Rect GetVirtualScreenBounds()
    {
        int left = GetSystemMetrics(SM_XVIRTUALSCREEN);
        int top = GetSystemMetrics(SM_YVIRTUALSCREEN);
        return new Rect
        {
            Left = left,
            Top = top,
            Right = left + GetSystemMetrics(SM_CXVIRTUALSCREEN),
            Bottom = top + GetSystemMetrics(SM_CYVIRTUALSCREEN),
        };
    }

    public static Point GetCursorPosition()
    {
        Point point;
        if (!GetCursorPos(out point))
        {
            throw new InvalidOperationException("GetCursorPos failed.");
        }
        return point;
    }

    public static void MoveCursor(int x, int y)
    {
        AssertInteractiveDefaultDesktop();
        if (!SetCursorPos(x, y))
        {
            throw new InvalidOperationException("SetCursorPos failed.");
        }
    }

    private static void SendMouseClick(int x, int y, string button)
    {
        AssertMouseButtonsReleased();
        uint down;
        uint up;
        if (string.Equals(button, "left", StringComparison.Ordinal))
        {
            down = MOUSEEVENTF_LEFTDOWN;
            up = MOUSEEVENTF_LEFTUP;
        }
        else if (string.Equals(button, "right", StringComparison.Ordinal))
        {
            down = MOUSEEVENTF_RIGHTDOWN;
            up = MOUSEEVENTF_RIGHTUP;
        }
        else
        {
            throw new ArgumentException("Unsupported mouse button.", "button");
        }

        Rect screen = GetVirtualScreenBounds();
        if (screen.Width <= 1 || screen.Height <= 1 ||
            x < screen.Left || x >= screen.Right || y < screen.Top || y >= screen.Bottom)
        {
            throw new InvalidOperationException("The verified click point is outside the virtual screen.");
        }
        int absoluteX = (int)Math.Round(
            (x - screen.Left) * 65535.0 / (screen.Width - 1),
            MidpointRounding.AwayFromZero);
        int absoluteY = (int)Math.Round(
            (y - screen.Top) * 65535.0 / (screen.Height - 1),
            MidpointRounding.AwayFromZero);

        var inputs = new Input[3];
        inputs[0].type = INPUT_MOUSE;
        inputs[0].value.mi.dx = absoluteX;
        inputs[0].value.mi.dy = absoluteY;
        inputs[0].value.mi.dwFlags = MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_VIRTUALDESK;
        inputs[1].type = INPUT_MOUSE;
        inputs[1].value.mi.dwFlags = down;
        inputs[2].type = INPUT_MOUSE;
        inputs[2].value.mi.dwFlags = up;
        uint sent = SendInput((uint)inputs.Length, inputs, Marshal.SizeOf(typeof(Input)));
        if (sent != inputs.Length)
        {
            if (sent >= 2)
            {
                var release = new Input[1];
                release[0].type = INPUT_MOUSE;
                release[0].value.mi.dwFlags = up;
                SendInput(1, release, Marshal.SizeOf(typeof(Input)));
            }
            throw new InvalidOperationException(
                "SendInput inserted " + sent + " of " + inputs.Length + " mouse events.");
        }
        Thread.Sleep(180);
    }

    public static void ClickForProcessRoot(int x, int y, string button, uint expectedProcessId)
    {
        AssertInteractiveDefaultDesktop();
        var point = new Point { X = x, Y = y };
        IntPtr root = GetAncestor(WindowFromPoint(point), GA_ROOT);
        uint owner;
        GetWindowThreadProcessId(root, out owner);
        if (root == IntPtr.Zero || owner != expectedProcessId)
        {
            throw new InvalidOperationException(
                "The click point is no longer owned by the verified UI process.");
        }
        SendMouseClick(x, y, button);
    }

    public static void ClickForExactRoot(int x, int y, string button, IntPtr expectedRoot)
    {
        AssertInteractiveDefaultDesktop();
        var point = new Point { X = x, Y = y };
        IntPtr root = GetAncestor(WindowFromPoint(point), GA_ROOT);
        if (root == IntPtr.Zero || root != expectedRoot)
        {
            throw new InvalidOperationException(
                "The click point is no longer inside the verified popup window.");
        }
        SendMouseClick(x, y, button);
    }

    public static void AssertInputPreconditions()
    {
        AssertInteractiveDefaultDesktop();
        AssertMouseButtonsReleased();
        AssertShortcutKeysReleased();
    }

    private static void AssertMouseButtonsReleased()
    {
        int[] keys = { VK_LBUTTON, VK_RBUTTON, VK_MBUTTON, VK_XBUTTON1, VK_XBUTTON2 };
        foreach (int key in keys)
        {
            if ((GetAsyncKeyState(key) & 0x8000) != 0)
            {
                throw new InvalidOperationException(
                    "A physical mouse button is pressed; refusing global input automation.");
            }
        }
    }

    private static void AssertKeysReleased(ushort[] keys)
    {
        foreach (ushort key in keys)
        {
            if ((GetAsyncKeyState(key) & 0x8000) != 0)
            {
                throw new InvalidOperationException(
                    "An injected keyboard key is physically pressed; refusing global input automation.");
            }
        }
    }

    private static void AssertShortcutKeysReleased()
    {
        AssertKeysReleased(new ushort[] {
            VK_B,
            VK_LWIN,
            VK_RWIN,
            VK_SHIFT,
            VK_CONTROL,
            VK_MENU,
            VK_LSHIFT,
            VK_RSHIFT,
            VK_LCONTROL,
            VK_RCONTROL,
            VK_LMENU,
            VK_RMENU,
        });
    }

    private static void ReleaseKeys(ushort[] keys)
    {
        var inputs = new Input[keys.Length];
        for (int index = 0; index < keys.Length; index++)
        {
            inputs[index].type = INPUT_KEYBOARD;
            inputs[index].value.ki.wVk = keys[index];
            inputs[index].value.ki.dwFlags = KEYEVENTF_KEYUP;
        }
        SendInput((uint)inputs.Length, inputs, Marshal.SizeOf(typeof(Input)));
    }

    public static void FocusNotificationArea()
    {
        AssertInteractiveDefaultDesktop();
        AssertShortcutKeysReleased();
        var inputs = new Input[4];
        inputs[0].type = INPUT_KEYBOARD;
        inputs[0].value.ki.wVk = VK_LWIN;
        inputs[1].type = INPUT_KEYBOARD;
        inputs[1].value.ki.wVk = VK_B;
        inputs[2].type = INPUT_KEYBOARD;
        inputs[2].value.ki.wVk = VK_B;
        inputs[2].value.ki.dwFlags = KEYEVENTF_KEYUP;
        inputs[3].type = INPUT_KEYBOARD;
        inputs[3].value.ki.wVk = VK_LWIN;
        inputs[3].value.ki.dwFlags = KEYEVENTF_KEYUP;
        uint sent = SendInput((uint)inputs.Length, inputs, Marshal.SizeOf(typeof(Input)));
        if (sent != inputs.Length)
        {
            if (sent == 1 || sent == 3)
            {
                ReleaseKeys(new ushort[] { VK_LWIN });
            }
            else if (sent == 2)
            {
                ReleaseKeys(new ushort[] { VK_B, VK_LWIN });
            }
            throw new InvalidOperationException(
                "SendInput inserted " + sent + " of " + inputs.Length + " Win+B events.");
        }
    }

    public static void DismissPopupMenu(IntPtr menuWindow, uint expectedProcessId)
    {
        if (!IsVisibleWindowOwnedBy(menuWindow, expectedProcessId, "#32768"))
        {
            throw new InvalidOperationException(
                "Refusing to dismiss a popup that is no longer the target process menu.");
        }
        if (!PostMessageW(menuWindow, WM_CANCELMODE, IntPtr.Zero, IntPtr.Zero))
        {
            throw new InvalidOperationException("PostMessage(WM_CANCELMODE) failed for the target popup.");
        }
        if (!PostMessageW(menuWindow, WM_KEYDOWN, new IntPtr(VK_ESCAPE), IntPtr.Zero) ||
            !PostMessageW(menuWindow, WM_KEYUP, new IntPtr(VK_ESCAPE), IntPtr.Zero))
        {
            throw new InvalidOperationException("Targeted Escape messages failed for the target popup.");
        }
    }

    public static bool PointBelongsToWindow(int x, int y, IntPtr expectedRoot)
    {
        var point = new Point { X = x, Y = y };
        IntPtr root = GetAncestor(WindowFromPoint(point), GA_ROOT);
        return root == expectedRoot;
    }

    public static MenuItemSnapshot[] ReadMenuItems(IntPtr menuWindow)
    {
        uint owner;
        GetWindowThreadProcessId(menuWindow, out owner);
        if (owner == 0 || !IsWindowVisible(menuWindow))
        {
            throw new InvalidOperationException("The target popup menu is no longer visible.");
        }

        var interfaceId = new Guid("618736E0-3C3D-11CF-810C-00AA00389B71");
        Accessibility.IAccessible accessible;
        int result = AccessibleObjectFromWindow(
            menuWindow,
            OBJID_CLIENT,
            ref interfaceId,
            out accessible);
        if (result != 0 || accessible == null)
        {
            throw new InvalidOperationException(
                "AccessibleObjectFromWindow failed with HRESULT 0x" + result.ToString("X8") + ".");
        }

        var items = new List<MenuItemSnapshot>();
        int childCount = accessible.accChildCount;
        for (int childId = 1; childId <= childCount; childId++)
        {
            object child = childId;
            object roleValue;
            try
            {
                roleValue = accessible.get_accRole(child);
            }
            catch
            {
                continue;
            }
            int role = Convert.ToInt32(roleValue);
            if (role != ROLE_SYSTEM_MENUITEM)
            {
                continue;
            }

            string name = accessible.get_accName(child) ?? string.Empty;
            int state = Convert.ToInt32(accessible.get_accState(child));
            int left;
            int top;
            int width;
            int height;
            accessible.accLocation(out left, out top, out width, out height, child);
            if (string.IsNullOrEmpty(name) || width <= 0 || height <= 0)
            {
                throw new InvalidOperationException(
                    "MSAA returned an unnamed or empty-bounds menu item at child " + childId + ".");
            }

            string toggleState = "unchecked";
            if ((state & STATE_SYSTEM_MIXED) != 0)
            {
                toggleState = "mixed";
            }
            else if ((state & STATE_SYSTEM_CHECKED) != 0)
            {
                toggleState = "checked";
            }

            items.Add(new MenuItemSnapshot
            {
                ChildId = childId,
                Name = name,
                Enabled = (state & STATE_SYSTEM_UNAVAILABLE) == 0,
                ToggleState = toggleState,
                Bounds = new Rect
                {
                    Left = left,
                    Top = top,
                    Right = left + width,
                    Bottom = top + height,
                },
            });
        }

        if (items.Count == 0)
        {
            throw new InvalidOperationException("MSAA exposed no menu items for the target popup.");
        }
        return items.ToArray();
    }

    public static bool IsVisibleWindowOwnedBy(IntPtr window, uint expectedProcessId, string expectedClass)
    {
        uint owner;
        GetWindowThreadProcessId(window, out owner);
        if (owner != expectedProcessId || !IsWindowVisible(window))
        {
            return false;
        }
        var className = new StringBuilder(64);
        GetClassNameW(window, className, className.Capacity);
        return string.Equals(className.ToString(), expectedClass, StringComparison.Ordinal);
    }
}
'@

[NativeTrayProbe]::EnablePerMonitorDpi()
$script:lastControlledCursor = $null

function Fail([string]$Message) {
    throw $Message
}

function Convert-Rect($Rect) {
    return [ordered]@{
        left = [int]$Rect.Left
        top = [int]$Rect.Top
        right = [int]$Rect.Right
        bottom = [int]$Rect.Bottom
        width = [int]$Rect.Width
        height = [int]$Rect.Height
    }
}

function Get-Center($Rect) {
    return [ordered]@{
        x = [int]$Rect.CenterX
        y = [int]$Rect.CenterY
    }
}

function Assert-ControlledCursorUnchanged() {
    if ($null -eq $script:lastControlledCursor) {
        return
    }
    $current = [NativeTrayProbe]::GetCursorPosition()
    if ([Math]::Abs($current.X - $script:lastControlledCursor.x) -gt 1 -or
        [Math]::Abs($current.Y - $script:lastControlledCursor.y) -gt 1) {
        Fail (
            "The mouse moved during tray automation; refusing further global input. " +
            "Expected=($($script:lastControlledCursor.x),$($script:lastControlledCursor.y)); " +
            "current=($($current.X),$($current.Y)).")
    }
}

function Move-ControlledCursor([int]$X, [int]$Y) {
    Assert-ControlledCursorUnchanged
    [NativeTrayProbe]::MoveCursor($X, $Y)
    $script:lastControlledCursor = [ordered]@{ x = $X; y = $Y }
}

function Record-ControlledCursor([int]$X, [int]$Y) {
    $script:lastControlledCursor = [ordered]@{ x = $X; y = $Y }
    Assert-ControlledCursorUnchanged
}

function Get-TrayButtonAtPoint([int]$X, [int]$Y) {
    $point = New-Object System.Windows.Point -ArgumentList @([double]$X, [double]$Y)
    try {
        $element = [System.Windows.Automation.AutomationElement]::FromPoint($point)
    }
    catch {
        Fail "UI Automation could not resolve the tray rectangle center: $($_.Exception.Message)"
    }

    $walker = [System.Windows.Automation.TreeWalker]::RawViewWalker
    $observed = New-Object System.Collections.Generic.List[string]
    for ($depth = 0; $depth -lt 16 -and $null -ne $element; $depth++) {
        try {
            $className = $element.Current.ClassName
            $automationId = $element.Current.AutomationId
            $observed.Add("class='$className' id='$automationId'")
            if ($className -eq "SystemTray.NormalButton" -and
                ($automationId -eq "SystemTrayIcon" -or $automationId -eq "NotifyItemIcon")) {
                return $element
            }
            $element = $walker.GetParent($element)
        }
        catch {
            Fail "The tray UI Automation element disappeared while it was being inspected."
        }
    }

    # Windows 11's XAML notification area can return Shell_TrayWnd itself
    # from FromPoint even though its raw UIA descendants expose the exact
    # SystemTray.NormalButton bounds. Fall back to an exact bounded search;
    # never select the nearest button or accept more than one match.
    $classCondition = New-Object System.Windows.Automation.PropertyCondition -ArgumentList @(
        [System.Windows.Automation.AutomationElement]::ClassNameProperty,
        "SystemTray.NormalButton")
    $buttons = [System.Windows.Automation.AutomationElement]::RootElement.FindAll(
        [System.Windows.Automation.TreeScope]::Descendants,
        $classCondition)
    $boundedMatches = New-Object System.Collections.Generic.List[System.Windows.Automation.AutomationElement]
    $candidates = New-Object System.Collections.Generic.List[string]
    for ($index = 0; $index -lt $buttons.Count; $index++) {
        try {
            $candidate = $buttons.Item($index)
            $automationId = $candidate.Current.AutomationId
            $frameworkId = $candidate.Current.FrameworkId
            $isOffscreen = $candidate.Current.IsOffscreen
            if (($automationId -ne "SystemTrayIcon" -and $automationId -ne "NotifyItemIcon") -or
                $frameworkId -ne "XAML" -or $isOffscreen) {
                continue
            }
            $bounds = $candidate.Current.BoundingRectangle
            $candidates.Add(
                "id='$automationId' framework='$frameworkId' " +
                "bounds=($($bounds.Left),$($bounds.Top),$($bounds.Right),$($bounds.Bottom))")
            if ($bounds.Width -gt 0 -and $bounds.Height -gt 0 -and
                $X -ge [Math]::Floor($bounds.Left) - 2 -and
                $X -lt [Math]::Ceiling($bounds.Right) + 2 -and
                $Y -ge [Math]::Floor($bounds.Top) - 2 -and
                $Y -lt [Math]::Ceiling($bounds.Bottom) + 2) {
                $boundedMatches.Add($candidate)
            }
        }
        catch {
            Fail "The notification-area UI Automation tree changed during bounded lookup."
        }
    }
    if ($boundedMatches.Count -eq 1) {
        return $boundedMatches[0]
    }
    Fail (
        "The notification icon rectangle center ($X,$Y) did not resolve to a " +
        "unique SystemTray.NormalButton (bounded matches=$($boundedMatches.Count)). " +
        "Observed: $($observed -join ' -> '); candidates: $($candidates -join ' | ')")
}

function Get-ElementNames($Element) {
    $names = New-Object System.Collections.Generic.List[string]
    $all = $Element.FindAll(
        [System.Windows.Automation.TreeScope]::Subtree,
        [System.Windows.Automation.Condition]::TrueCondition)
    for ($index = 0; $index -lt $all.Count; $index++) {
        try {
            $name = $all.Item($index).Current.Name
            if (-not [string]::IsNullOrWhiteSpace($name) -and -not $names.Contains($name)) {
                $names.Add($name)
            }
        }
        catch {
            Fail "The notification icon UI Automation tree changed during inspection."
        }
    }
    return @($names)
}

function Test-TooltipPrefix($Names, [string]$Prefix) {
    foreach ($name in @($Names)) {
        # Windows 11 XAML can retain the initial accessible tooltip and append
        # later updates into the same Name. The icon identity is already bound
        # to the target PID/HWND/uID, so require the requested status text as
        # an ordinal substring without accepting a different icon.
        if ($name.IndexOf($Prefix, [System.StringComparison]::Ordinal) -ge 0) {
            return $true
        }
    }
    return $false
}

function Move-To-RevealTaskbar([IntPtr]$TrayWindow, [uint32]$IconId) {
    $screen = [NativeTrayProbe]::GetVirtualScreenBounds()
    $deadline = [DateTime]::UtcNow.AddSeconds(7)
    $keyboardRevealTried = $false
    do {
        $rect = [NativeTrayProbe]::GetNotifyIconRect($TrayWindow, $IconId)
        if ($rect.CenterX -ge $screen.Left -and $rect.CenterX -lt $screen.Right -and
            $rect.CenterY -ge $screen.Top -and $rect.CenterY -lt $screen.Bottom) {
            return $rect
        }

        if (-not $keyboardRevealTried) {
            [NativeTrayProbe]::FocusNotificationArea()
            $keyboardRevealTried = $true
            Start-Sleep -Milliseconds 900
            continue
        }

        # An auto-hidden taskbar reports a valid icon rectangle just beyond
        # the virtual-screen edge. Keep the pointer on the corresponding edge
        # and poll the authoritative Shell rect until the reveal animation has
        # moved its center back on-screen.
        $x = [Math]::Max($screen.Left, [Math]::Min($screen.Right - 1, $rect.CenterX))
        $y = [Math]::Max($screen.Top, [Math]::Min($screen.Bottom - 1, $rect.CenterY))
        $insideX = $x
        $insideY = $y
        if ($rect.CenterY -ge $screen.Bottom) {
            $insideY = [Math]::Max($screen.Top, $screen.Bottom - 12)
        }
        elseif ($rect.CenterY -lt $screen.Top) {
            $insideY = [Math]::Min($screen.Bottom - 1, $screen.Top + 11)
        }
        elseif ($rect.CenterX -ge $screen.Right) {
            $insideX = [Math]::Max($screen.Left, $screen.Right - 12)
        }
        elseif ($rect.CenterX -lt $screen.Left) {
            $insideX = [Math]::Min($screen.Right - 1, $screen.Left + 11)
        }
        Move-ControlledCursor ([int]$insideX) ([int]$insideY)
        Start-Sleep -Milliseconds 500
        Move-ControlledCursor ([int]$x) ([int]$y)
        Start-Sleep -Milliseconds 900
    } while ([DateTime]::UtcNow -lt $deadline)

    Fail (
        "The auto-hidden taskbar did not reveal the target icon. Last rect=" +
        "($($rect.Left),$($rect.Top),$($rect.Right),$($rect.Bottom)); " +
        "virtual screen=($($screen.Left),$($screen.Top),$($screen.Right),$($screen.Bottom)).")
}

function Resolve-TargetIcon([IntPtr]$TrayWindow, [uint32]$IconId, [string]$TooltipPrefix) {
    $bounds = Move-To-RevealTaskbar $TrayWindow $IconId
    $center = Get-Center $bounds
    $button = $null
    $resolutionDiagnostics = New-Object System.Collections.Generic.List[string]
    $resolutionDeadline = [DateTime]::UtcNow.AddSeconds(4)
    $keyboardRefreshAfter = [DateTime]::UtcNow.AddMilliseconds(750)
    $keyboardRefreshTried = $false
    do {
        try {
            $bounds = [NativeTrayProbe]::GetNotifyIconRect($TrayWindow, $IconId)
            $center = Get-Center $bounds
            $button = Get-TrayButtonAtPoint $center.x $center.y
        }
        catch {
            $resolutionDiagnostics.Add(
                "rect=($($bounds.Left),$($bounds.Top),$($bounds.Right),$($bounds.Bottom)): " +
                $_.Exception.Message)
            while ($resolutionDiagnostics.Count -gt 6) {
                $resolutionDiagnostics.RemoveAt(0)
            }
            if (-not $keyboardRefreshTried -and [DateTime]::UtcNow -ge $keyboardRefreshAfter) {
                # The Windows 11 overflow island can outlive its item tree for a
                # short transition while Shell_NotifyIconGetRect still reports
                # the previous popup location. Win+B is a bounded, reversible
                # refresh of the notification area and does not select an icon.
                [NativeTrayProbe]::AssertInputPreconditions()
                Assert-ControlledCursorUnchanged
                [NativeTrayProbe]::FocusNotificationArea()
                $keyboardRefreshTried = $true
                Start-Sleep -Milliseconds 500
            }
            else {
                Start-Sleep -Milliseconds 100
            }
        }
    } while ($null -eq $button -and [DateTime]::UtcNow -lt $resolutionDeadline)
    if ($null -eq $button) {
        Fail (
            "The PID-bound notification icon did not regain a unique UI Automation identity. " +
            "Diagnostics: $($resolutionDiagnostics -join ' | ')")
    }
    $expandedOverflow = $false

    if ($button.Current.AutomationId -eq "SystemTrayIcon") {
        $patternObject = $null
        if (-not $button.TryGetCurrentPattern(
            [System.Windows.Automation.InvokePattern]::Pattern,
            [ref]$patternObject)) {
            Fail "The overflow SystemTrayIcon does not expose InvokePattern."
        }
        ([System.Windows.Automation.InvokePattern]$patternObject).Invoke()
        $expandedOverflow = $true

        $deadline = [DateTime]::UtcNow.AddSeconds(4)
        $resolved = $false
        $overflowDiagnostics = New-Object System.Collections.Generic.List[string]
        do {
            Start-Sleep -Milliseconds 100
            $bounds = [NativeTrayProbe]::GetNotifyIconRect($TrayWindow, $IconId)
            $center = Get-Center $bounds
            try {
                $button = Get-TrayButtonAtPoint $center.x $center.y
                $names = @(Get-ElementNames $button)
                $overflowDiagnostics.Add(
                    "rect=($($bounds.Left),$($bounds.Top),$($bounds.Right),$($bounds.Bottom)) " +
                    "id='$($button.Current.AutomationId)' names='$($names -join ' || ')'")
                if ($button.Current.AutomationId -eq "NotifyItemIcon" -and
                    (Test-TooltipPrefix $names $TooltipPrefix)) {
                    $resolved = $true
                }
            }
            catch {
                $overflowDiagnostics.Add($_.Exception.Message)
                $resolved = $false
            }
            while ($overflowDiagnostics.Count -gt 6) {
                $overflowDiagnostics.RemoveAt(0)
            }
        } while (-not $resolved -and [DateTime]::UtcNow -lt $deadline)

        if (-not $resolved) {
            Fail (
                "The overflow opened, but the PID-bound icon did not resolve to the expected " +
                "NotifyItemIcon. Diagnostics: $($overflowDiagnostics -join ' | ')")
        }
    }
    elseif ($button.Current.AutomationId -ne "NotifyItemIcon") {
        Fail "The PID-bound icon resolved to an unexpected UI Automation id."
    }

    $names = @(Get-ElementNames $button)
    if (-not (Test-TooltipPrefix $names $TooltipPrefix)) {
        Fail "The PID-bound NotifyItemIcon name does not match the required tooltip prefix."
    }

    return [ordered]@{
        bounds = $bounds
        center = Get-Center $bounds
        names = $names
        overflowExpanded = $expandedOverflow
    }
}

function Confirm-TargetIconForClick(
    [IntPtr]$TrayWindow,
    [uint32]$IconId,
    [string]$TooltipPrefix) {
    $bounds = [NativeTrayProbe]::GetNotifyIconRect($TrayWindow, $IconId)
    $center = Get-Center $bounds
    Move-ControlledCursor $center.x $center.y

    # Moving onto an auto-hide/overflow icon can update its Shell rectangle.
    # Re-read the same PID-bound HWND/uID after the cursor move, move once more
    # to that authoritative center, and only then revalidate UIA identity.
    $bounds = [NativeTrayProbe]::GetNotifyIconRect($TrayWindow, $IconId)
    $center = Get-Center $bounds
    Move-ControlledCursor $center.x $center.y
    $button = Get-TrayButtonAtPoint $center.x $center.y
    if ($button.Current.AutomationId -ne "NotifyItemIcon") {
        Fail "The verified tray target changed before the physical click."
    }
    $names = @(Get-ElementNames $button)
    if (-not (Test-TooltipPrefix $names $TooltipPrefix)) {
        Fail "The tray target tooltip changed before the physical click."
    }
    $uiProcessId = [uint32]$button.Current.ProcessId
    if ($uiProcessId -eq 0) {
        Fail "The verified tray target has no UI Automation process id."
    }
    return [ordered]@{
        center = $center
        uiProcessId = $uiProcessId
    }
}

function Wait-ForTargetMenu([uint32]$ProcessId) {
    $deadline = [DateTime]::UtcNow.AddSeconds(4)
    do {
        $menus = @([NativeTrayProbe]::FindVisiblePopupMenus($ProcessId))
        if ($menus.Count -gt 1) {
            Fail "More than one visible #32768 popup menu belongs to the target process."
        }
        if ($menus.Count -eq 1) {
            return [IntPtr][long]$menus[0]
        }
        Start-Sleep -Milliseconds 50
    } while ([DateTime]::UtcNow -lt $deadline)
    return [IntPtr]::Zero
}

function Wait-ForTargetMenuClosed([uint32]$ProcessId) {
    $deadline = [DateTime]::UtcNow.AddSeconds(3)
    do {
        $menus = @([NativeTrayProbe]::FindVisiblePopupMenus($ProcessId))
        if ($menus.Count -eq 0) {
            return
        }
        if ($menus.Count -gt 1) {
            Fail "More than one visible #32768 popup menu belongs to the target process after selection."
        }
        Start-Sleep -Milliseconds 50
    } while ([DateTime]::UtcNow -lt $deadline)
    Fail "The target popup menu stayed open after the physical menu-item click."
}

function Read-Menu([IntPtr]$MenuWindow, [uint32]$ProcessId) {
    if (-not [NativeTrayProbe]::IsVisibleWindowOwnedBy($MenuWindow, $ProcessId, "#32768")) {
        Fail "The popup menu identity changed before it could be read."
    }
    $items = @([NativeTrayProbe]::ReadMenuItems($MenuWindow))
    if (-not [NativeTrayProbe]::IsVisibleWindowOwnedBy($MenuWindow, $ProcessId, "#32768")) {
        Fail "The popup menu identity changed while its items were being read."
    }
    return $items
}

function Convert-MenuItems($Items) {
    $result = @()
    foreach ($item in @($Items)) {
        $result += [ordered]@{
            name = $item.Name
            enabled = [bool]$item.Enabled
            toggleState = $item.ToggleState
            bounds = Convert-Rect $item.Bounds
        }
    }
    return $result
}

$action = $env:NATIVE_TRAY_ACTION
if ($action -notin @("inspect", "left-click", "menu-click")) {
    Fail "NATIVE_TRAY_ACTION must be inspect, left-click, or menu-click."
}

[uint32]$processId = 0
if (-not [uint32]::TryParse($env:NATIVE_TRAY_PID, [ref]$processId) -or $processId -eq 0) {
    Fail "NATIVE_TRAY_PID must be a positive 32-bit process id."
}

$tooltipPrefix = $env:NATIVE_TRAY_TOOLTIP_PREFIX
if ([string]::IsNullOrWhiteSpace($tooltipPrefix)) {
    Fail "NATIVE_TRAY_TOOLTIP_PREFIX must not be empty."
}

$requestedMenuItem = $env:NATIVE_TRAY_MENU_ITEM
if ($action -eq "menu-click" -and [string]::IsNullOrWhiteSpace($requestedMenuItem)) {
    Fail "NATIVE_TRAY_MENU_ITEM is required for menu-click."
}

[NativeTrayProbe]::AssertInputPreconditions()
$originalCursor = [NativeTrayProbe]::GetCursorPosition()
$menuInteractionStarted = $false
$menuSelectionCompleted = $false
$actionCompleted = $false
$primaryError = $null

try {
    $trayWindows = @([NativeTrayProbe]::FindWindows($processId, "tray_icon_app"))
    if ($trayWindows.Count -ne 1) {
        Fail "Expected exactly one tray_icon_app window for PID $processId, found $($trayWindows.Count)."
    }
    $trayWindow = [IntPtr][long]$trayWindows[0]

    $iconMatches = @([NativeTrayProbe]::FindNotifyIcons($trayWindow, 1, 64))
    if ($iconMatches.Count -ne 1) {
        Fail "Expected exactly one Shell_NotifyIconGetRect match for uID 1..64, found $($iconMatches.Count)."
    }
    $iconId = [uint32]$iconMatches[0].Id
    $target = Resolve-TargetIcon $trayWindow $iconId $tooltipPrefix

    $result = [ordered]@{
        action = $action
        pid = $processId
        trayWindow = $trayWindow.ToInt64()
        iconId = $iconId
        icon = [ordered]@{
            bounds = Convert-Rect $target.bounds
            names = @($target.names)
            overflowExpanded = [bool]$target.overflowExpanded
        }
        menu = $null
        clickedItem = $null
    }

    if ($action -eq "left-click") {
        $clickTarget = Confirm-TargetIconForClick $trayWindow $iconId $tooltipPrefix
        [NativeTrayProbe]::ClickForProcessRoot(
            $clickTarget.center.x,
            $clickTarget.center.y,
            "left",
            $clickTarget.uiProcessId)
        # This is the final physical input for a left-click action. Windows can
        # close the overflow island and reposition the cursor immediately after
        # accepting the exact, PID-bound click. Record the intended endpoint so
        # finally can avoid overwriting any new position, but send no more input.
        $script:lastControlledCursor = [ordered]@{
            x = $clickTarget.center.x
            y = $clickTarget.center.y
        }
        $actionCompleted = $true
    }
    else {
        $menuInteractionStarted = $true
        $clickTarget = Confirm-TargetIconForClick $trayWindow $iconId $tooltipPrefix
        [NativeTrayProbe]::ClickForProcessRoot(
            $clickTarget.center.x,
            $clickTarget.center.y,
            "right",
            $clickTarget.uiProcessId)
        if ($action -eq "menu-click") {
            # menu-click still has a later physical selection, so interference
            # after opening the menu remains a hard failure.
            Record-ControlledCursor $clickTarget.center.x $clickTarget.center.y
        }
        else {
            $script:lastControlledCursor = [ordered]@{
                x = $clickTarget.center.x
                y = $clickTarget.center.y
            }
        }
        $menuWindow = Wait-ForTargetMenu $processId
        if ($menuWindow -eq [IntPtr]::Zero) {
            # Right-clicks during an auto-hide/overflow transition can be
            # consumed by the shell after the exact icon has already been
            # verified. Resolve the PID-bound icon from a fresh Shell rect and
            # retry once without sending input to an unrelated foreground UI.
            Start-Sleep -Milliseconds 250
            $target = Resolve-TargetIcon $trayWindow $iconId $tooltipPrefix
            $clickTarget = Confirm-TargetIconForClick $trayWindow $iconId $tooltipPrefix
            [NativeTrayProbe]::ClickForProcessRoot(
                $clickTarget.center.x,
                $clickTarget.center.y,
                "right",
                $clickTarget.uiProcessId)
            if ($action -eq "menu-click") {
                Record-ControlledCursor $clickTarget.center.x $clickTarget.center.y
            }
            else {
                $script:lastControlledCursor = [ordered]@{
                    x = $clickTarget.center.x
                    y = $clickTarget.center.y
                }
            }
            $menuWindow = Wait-ForTargetMenu $processId
        }
        if ($menuWindow -eq [IntPtr]::Zero) {
            Fail "The target process did not expose one visible #32768 popup menu after one safe retry."
        }
        $items = @(Read-Menu $menuWindow $processId)
        $result.menu = [ordered]@{
            window = $menuWindow.ToInt64()
            items = @(Convert-MenuItems $items)
        }

        if ($action -eq "menu-click") {
            $matches = @($items | Where-Object { $_.Name -ceq $requestedMenuItem })
            if ($matches.Count -ne 1) {
                Fail "Expected exactly one menu item named '$requestedMenuItem', found $($matches.Count)."
            }
            $selected = $matches[0]
            if (-not $selected.Enabled) {
                Fail "Menu item '$requestedMenuItem' is disabled."
            }
            $point = Get-Center $selected.Bounds
            if (-not [NativeTrayProbe]::PointBelongsToWindow($point.x, $point.y, $menuWindow)) {
                Fail "The selected menu item center no longer belongs to the target popup menu."
            }
            [NativeTrayProbe]::ClickForExactRoot($point.x, $point.y, "left", $menuWindow)
            # The menu selection is the final physical input. The exact popup
            # root was verified immediately before SendInput, and no later
            # input depends on the cursor retaining this coordinate.
            $script:lastControlledCursor = [ordered]@{ x = $point.x; y = $point.y }
            Wait-ForTargetMenuClosed $processId
            $menuSelectionCompleted = $true
            $result.clickedItem = [ordered]@{
                name = $selected.Name
                enabled = [bool]$selected.Enabled
                toggleState = $selected.ToggleState
                bounds = Convert-Rect $selected.Bounds
            }
        }
        else {
            [NativeTrayProbe]::DismissPopupMenu($menuWindow, $processId)
            Wait-ForTargetMenuClosed $processId
            $menuSelectionCompleted = $true
        }
    }

    # Every physical input is complete and, for menu actions, the exact target
    # popup has closed. Cursor movement after this point cannot redirect a
    # click; it only determines whether restoring the original position is safe.
    $actionCompleted = $true
    $result | ConvertTo-Json -Depth 10 -Compress
}
catch {
    $primaryError = $_
    throw
}
finally {
    if ($menuInteractionStarted -and -not $menuSelectionCompleted) {
        $remainingMenus = @([NativeTrayProbe]::FindVisiblePopupMenus($processId))
        if ($remainingMenus.Count -eq 1) {
            try {
                [NativeTrayProbe]::DismissPopupMenu(
                    [IntPtr][long]$remainingMenus[0],
                    $processId)
                Start-Sleep -Milliseconds 100
            }
            catch {
                # The exact target popup may disappear during failure cleanup.
                # Never fall back to a global Escape keystroke.
            }
        }
    }
    $cursorInterfered = $false
    try {
        Assert-ControlledCursorUnchanged
    }
    catch {
        $cursorInterfered = $true
    }
    if (-not $cursorInterfered) {
        [NativeTrayProbe]::MoveCursor($originalCursor.X, $originalCursor.Y)
    }
    elseif (-not $actionCompleted -and $null -eq $primaryError) {
        Fail "The mouse moved during tray automation; the helper did not overwrite the user's new position."
    }
}
