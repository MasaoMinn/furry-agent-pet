Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

public static class NativeSmokeWindow
{
    public const int GWL_STYLE = -16;
    public const int GWL_EXSTYLE = -20;
    public const long WS_CAPTION = 0x00C00000L;
    public const long WS_THICKFRAME = 0x00040000L;
    public const long WS_EX_TOPMOST = 0x00000008L;
    public const long WS_EX_TOOLWINDOW = 0x00000080L;
    public const long WS_EX_APPWINDOW = 0x00040000L;

    private const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
    private const uint MOUSEEVENTF_LEFTUP = 0x0004;
    private const uint SWP_NOSIZE = 0x0001;
    private const uint SWP_NOMOVE = 0x0002;
    private const uint SWP_NOACTIVATE = 0x0010;
    private const uint WM_CLOSE = 0x0010;
    private const uint GW_HWNDPREV = 3;
    private static readonly IntPtr HWND_TOPMOST = new IntPtr(-1);

    private delegate bool EnumWindowsProc(IntPtr window, IntPtr parameter);

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

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool EnumWindows(EnumWindowsProc callback, IntPtr parameter);

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);

    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern int GetWindowTextLengthW(IntPtr window);

    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern int GetWindowTextW(IntPtr window, StringBuilder text, int maximumCount);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool IsWindowVisible(IntPtr window);

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool GetWindowRect(IntPtr window, out RECT rect);

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool GetClientRect(IntPtr window, out RECT rect);

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool ClientToScreen(IntPtr window, ref POINT point);

    [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW", SetLastError = true)]
    private static extern IntPtr GetWindowLongPtr64(IntPtr window, int index);

    [DllImport("user32.dll", EntryPoint = "GetWindowLongW", SetLastError = true)]
    private static extern int GetWindowLong32(IntPtr window, int index);

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool PostMessageW(IntPtr window, uint message, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool SetWindowPos(
        IntPtr window,
        IntPtr insertAfter,
        int x,
        int y,
        int width,
        int height,
        uint flags);

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool SetCursorPos(int x, int y);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetCursorPos(out POINT point);

    [DllImport("user32.dll")]
    private static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extraInfo);

    [DllImport("user32.dll")]
    private static extern IntPtr GetDC(IntPtr window);

    [DllImport("user32.dll")]
    private static extern int ReleaseDC(IntPtr window, IntPtr deviceContext);

    [DllImport("gdi32.dll")]
    private static extern uint GetPixel(IntPtr deviceContext, int x, int y);

    [DllImport("user32.dll")]
    private static extern IntPtr GetWindow(IntPtr window, uint command);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool SetProcessDpiAwarenessContext(IntPtr value);

    public static void EnablePerMonitorDpi()
    {
        try
        {
            SetProcessDpiAwarenessContext(new IntPtr(-4));
        }
        catch
        {
            // An already-selected process DPI context is safe for this probe.
        }
    }

    public static IntPtr[] FindExact(uint expectedProcessId, string expectedTitle)
    {
        var matches = new List<IntPtr>();
        EnumWindows(delegate (IntPtr window, IntPtr parameter)
        {
            uint processId;
            GetWindowThreadProcessId(window, out processId);
            if (processId != expectedProcessId)
            {
                return true;
            }

            int length = GetWindowTextLengthW(window);
            var title = new StringBuilder(length + 1);
            GetWindowTextW(window, title, title.Capacity);
            if (string.Equals(title.ToString(), expectedTitle, StringComparison.Ordinal))
            {
                matches.Add(window);
            }
            return true;
        }, IntPtr.Zero);
        return matches.ToArray();
    }

    public static long GetStyle(IntPtr window, int index)
    {
        return IntPtr.Size == 8
            ? GetWindowLongPtr64(window, index).ToInt64()
            : (long)(uint)GetWindowLong32(window, index);
    }

    public static POINT GetClientOrigin(IntPtr window)
    {
        var point = new POINT { X = 0, Y = 0 };
        if (!ClientToScreen(window, ref point))
        {
            throw new InvalidOperationException("ClientToScreen failed.");
        }
        return point;
    }

    public static bool PostClose(IntPtr window)
    {
        return PostMessageW(window, WM_CLOSE, IntPtr.Zero, IntPtr.Zero);
    }

    public static bool BringToTopmost(IntPtr window)
    {
        return SetWindowPos(
            window,
            HWND_TOPMOST,
            0,
            0,
            0,
            0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
    }

    public static int CompareZOrder(IntPtr first, IntPtr second)
    {
        if (first == second)
        {
            return 0;
        }

        var current = first;
        while (current != IntPtr.Zero)
        {
            current = GetWindow(current, GW_HWNDPREV);
            if (current == second)
            {
                return 1;
            }
        }

        current = second;
        while (current != IntPtr.Zero)
        {
            current = GetWindow(current, GW_HWNDPREV);
            if (current == first)
            {
                return -1;
            }
        }
        return 0;
    }

    public static uint ReadScreenPixel(int x, int y)
    {
        IntPtr deviceContext = GetDC(IntPtr.Zero);
        if (deviceContext == IntPtr.Zero)
        {
            throw new InvalidOperationException("GetDC(NULL) failed.");
        }
        try
        {
            uint color = GetPixel(deviceContext, x, y);
            if (color == 0xFFFFFFFF)
            {
                throw new InvalidOperationException("GetPixel failed.");
            }
            return color;
        }
        finally
        {
            ReleaseDC(IntPtr.Zero, deviceContext);
        }
    }

    public static bool DragFromTo(int startX, int startY, int endX, int endY)
    {
        POINT original;
        if (!GetCursorPos(out original) || !SetCursorPos(startX, startY))
        {
            return false;
        }

        try
        {
            Thread.Sleep(120);
            mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, UIntPtr.Zero);
            Thread.Sleep(240);
            const int steps = 16;
            for (int step = 1; step <= steps; step++)
            {
                int x = startX + ((endX - startX) * step / steps);
                int y = startY + ((endY - startY) * step / steps);
                if (!SetCursorPos(x, y))
                {
                    return false;
                }
                Thread.Sleep(35);
            }
            mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, UIntPtr.Zero);
            Thread.Sleep(180);
            return true;
        }
        finally
        {
            mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, UIntPtr.Zero);
            SetCursorPos(original.X, original.Y);
        }
    }
}

public static class NativeSmokeBackdrop
{
    private const uint WS_POPUP = 0x80000000;
    private const uint WS_EX_TOPMOST = 0x00000008;
    private const uint WS_EX_TOOLWINDOW = 0x00000080;
    private const uint WS_EX_NOACTIVATE = 0x08000000;
    private const int SW_SHOWNOACTIVATE = 4;
    private const uint WM_DESTROY = 0x0002;
    private const uint WM_PAINT = 0x000F;

    private delegate IntPtr WindowProc(IntPtr window, uint message, IntPtr wParam, IntPtr lParam);
    private static WindowProc windowProc = HandleMessage;
    private static IntPtr backgroundBrush = IntPtr.Zero;

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct WNDCLASS
    {
        public uint style;
        public WindowProc lpfnWndProc;
        public int cbClsExtra;
        public int cbWndExtra;
        public IntPtr hInstance;
        public IntPtr hIcon;
        public IntPtr hCursor;
        public IntPtr hbrBackground;
        [MarshalAs(UnmanagedType.LPWStr)] public string lpszMenuName;
        [MarshalAs(UnmanagedType.LPWStr)] public string lpszClassName;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct MSG
    {
        public IntPtr hwnd;
        public uint message;
        public UIntPtr wParam;
        public IntPtr lParam;
        public uint time;
        public NativeSmokeWindow.POINT point;
        public uint lPrivate;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct PAINTSTRUCT
    {
        public IntPtr hdc;
        public bool erase;
        public NativeSmokeWindow.RECT paint;
        public bool restore;
        public bool incUpdate;
        [MarshalAs(UnmanagedType.ByValArray, SizeConst = 32)] public byte[] reserved;
    }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
    private static extern IntPtr GetModuleHandleW(string moduleName);

    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern ushort RegisterClassW(ref WNDCLASS windowClass);

    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr CreateWindowExW(
        uint extendedStyle,
        string className,
        string windowName,
        uint style,
        int x,
        int y,
        int width,
        int height,
        IntPtr parent,
        IntPtr menu,
        IntPtr instance,
        IntPtr parameter);

    [DllImport("user32.dll")]
    private static extern bool ShowWindow(IntPtr window, int command);

    [DllImport("user32.dll")]
    private static extern bool UpdateWindow(IntPtr window);

    [DllImport("user32.dll")]
    private static extern int GetMessageW(out MSG message, IntPtr window, uint minimum, uint maximum);

    [DllImport("user32.dll")]
    private static extern bool TranslateMessage(ref MSG message);

    [DllImport("user32.dll")]
    private static extern IntPtr DispatchMessageW(ref MSG message);

    [DllImport("user32.dll")]
    private static extern IntPtr DefWindowProcW(IntPtr window, uint message, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll")]
    private static extern void PostQuitMessage(int exitCode);

    [DllImport("user32.dll")]
    private static extern IntPtr BeginPaint(IntPtr window, out PAINTSTRUCT paint);

    [DllImport("user32.dll")]
    private static extern bool EndPaint(IntPtr window, ref PAINTSTRUCT paint);

    [DllImport("user32.dll")]
    private static extern bool GetClientRect(IntPtr window, out NativeSmokeWindow.RECT rect);

    [DllImport("user32.dll")]
    private static extern int FillRect(IntPtr deviceContext, ref NativeSmokeWindow.RECT rect, IntPtr brush);

    [DllImport("gdi32.dll")]
    private static extern IntPtr CreateSolidBrush(uint color);

    public static void Run(int x, int y, int width, int height, byte red, byte green, byte blue)
    {
        NativeSmokeWindow.EnablePerMonitorDpi();
        uint colorRef = (uint)(red | (green << 8) | (blue << 16));
        backgroundBrush = CreateSolidBrush(colorRef);
        string className = "AgentDesktopPetNativeSmokeBackdrop_" + Process.GetCurrentProcess().Id;
        IntPtr instance = GetModuleHandleW(null);
        var windowClass = new WNDCLASS
        {
            lpfnWndProc = windowProc,
            hInstance = instance,
            hbrBackground = backgroundBrush,
            lpszClassName = className,
        };
        if (RegisterClassW(ref windowClass) == 0)
        {
            throw new InvalidOperationException("RegisterClassW failed.");
        }

        IntPtr window = CreateWindowExW(
            WS_EX_TOPMOST | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE,
            className,
            "",
            WS_POPUP,
            x,
            y,
            width,
            height,
            IntPtr.Zero,
            IntPtr.Zero,
            instance,
            IntPtr.Zero);
        if (window == IntPtr.Zero)
        {
            throw new InvalidOperationException("CreateWindowExW failed.");
        }

        ShowWindow(window, SW_SHOWNOACTIVATE);
        UpdateWindow(window);
        Console.Out.WriteLine("READY " + window.ToInt64());
        Console.Out.Flush();

        MSG message;
        while (GetMessageW(out message, IntPtr.Zero, 0, 0) > 0)
        {
            TranslateMessage(ref message);
            DispatchMessageW(ref message);
        }
    }

    private static IntPtr HandleMessage(IntPtr window, uint message, IntPtr wParam, IntPtr lParam)
    {
        if (message == WM_PAINT)
        {
            PAINTSTRUCT paint;
            IntPtr deviceContext = BeginPaint(window, out paint);
            NativeSmokeWindow.RECT rect;
            GetClientRect(window, out rect);
            FillRect(deviceContext, ref rect, backgroundBrush);
            EndPaint(window, ref paint);
            return IntPtr.Zero;
        }
        if (message == WM_DESTROY)
        {
            PostQuitMessage(0);
            return IntPtr.Zero;
        }
        return DefWindowProcW(window, message, wParam, lParam);
    }
}
'@

[NativeSmokeWindow]::EnablePerMonitorDpi()
$action = $env:NATIVE_SMOKE_ACTION

if ($action -eq "backdrop") {
    $bounds = $env:NATIVE_SMOKE_BACKDROP_BOUNDS | ConvertFrom-Json
    $color = $env:NATIVE_SMOKE_BACKDROP_COLOR | ConvertFrom-Json
    [NativeSmokeBackdrop]::Run(
        [int]$bounds.left,
        [int]$bounds.top,
        [int]$bounds.width,
        [int]$bounds.height,
        [byte]$color.r,
        [byte]$color.g,
        [byte]$color.b)
    exit 0
}

$targetProcessId = [uint32]::Parse($env:NATIVE_SMOKE_WINDOW_PID)
$targetTitle = $env:NATIVE_SMOKE_WINDOW_TITLE
$matches = [NativeSmokeWindow]::FindExact($targetProcessId, $targetTitle)

if ($matches.Length -ne 1) {
    [pscustomobject]@{
        count = $matches.Length
        visible = $null
        handle = $null
    } | ConvertTo-Json -Compress
    exit 0
}

$window = $matches[0]
$rect = New-Object NativeSmokeWindow+RECT
if (-not [NativeSmokeWindow]::GetWindowRect($window, [ref]$rect)) {
    throw "GetWindowRect failed."
}
$origin = [NativeSmokeWindow]::GetClientOrigin($window)
$clientRect = New-Object NativeSmokeWindow+RECT
if (-not [NativeSmokeWindow]::GetClientRect($window, [ref]$clientRect)) {
    throw "GetClientRect failed."
}
$style = [NativeSmokeWindow]::GetStyle($window, [NativeSmokeWindow]::GWL_STYLE)
$extendedStyle = [NativeSmokeWindow]::GetStyle($window, [NativeSmokeWindow]::GWL_EXSTYLE)

if ($action -eq "close") {
    if (-not [NativeSmokeWindow]::PostClose($window)) {
        throw "PostMessageW(WM_CLOSE) failed."
    }
} elseif ($action -eq "topmost") {
    if (-not [NativeSmokeWindow]::BringToTopmost($window)) {
        throw "SetWindowPos(HWND_TOPMOST) failed."
    }
} elseif ($action -eq "drag") {
    $startX = [int]::Parse($env:NATIVE_SMOKE_DRAG_START_X)
    $startY = [int]::Parse($env:NATIVE_SMOKE_DRAG_START_Y)
    $endX = [int]::Parse($env:NATIVE_SMOKE_DRAG_END_X)
    $endY = [int]::Parse($env:NATIVE_SMOKE_DRAG_END_Y)
    if (-not [NativeSmokeWindow]::DragFromTo($startX, $startY, $endX, $endY)) {
        throw "SendInput-compatible mouse drag failed."
    }
} elseif ($action -ne "query" -and $action -ne "pixels") {
    throw "Unsupported native smoke action: $action"
}

if ($action -eq "drag") {
    if (-not [NativeSmokeWindow]::GetWindowRect($window, [ref]$rect)) {
        throw "GetWindowRect after drag failed."
    }
    $origin = [NativeSmokeWindow]::GetClientOrigin($window)
    if (-not [NativeSmokeWindow]::GetClientRect($window, [ref]$clientRect)) {
        throw "GetClientRect after drag failed."
    }
}
$style = [NativeSmokeWindow]::GetStyle($window, [NativeSmokeWindow]::GWL_STYLE)
$extendedStyle = [NativeSmokeWindow]::GetStyle($window, [NativeSmokeWindow]::GWL_EXSTYLE)

$pixels = @()
if ($action -eq "pixels") {
    $points = $env:NATIVE_SMOKE_POINTS | ConvertFrom-Json
    foreach ($point in @($points)) {
        $raw = [NativeSmokeWindow]::ReadScreenPixel([int]$point.x, [int]$point.y)
        $pixels += [pscustomobject]@{
            name = [string]$point.name
            x = [int]$point.x
            y = [int]$point.y
            r = [int]($raw -band 0xFF)
            g = [int](($raw -shr 8) -band 0xFF)
            b = [int](($raw -shr 16) -band 0xFF)
        }
    }
}

$otherHandle = [IntPtr]::Zero
if ($env:NATIVE_SMOKE_OTHER_HANDLE) {
    $otherHandle = [IntPtr]([int64]::Parse($env:NATIVE_SMOKE_OTHER_HANDLE))
}
$zOrder = if ($otherHandle -eq [IntPtr]::Zero) {
    $null
} else {
    [NativeSmokeWindow]::CompareZOrder($window, $otherHandle)
}

[pscustomobject]@{
    count = 1
    visible = [NativeSmokeWindow]::IsWindowVisible($window)
    handle = $window.ToInt64()
    bounds = [pscustomobject]@{
        left = $rect.Left
        top = $rect.Top
        right = $rect.Right
        bottom = $rect.Bottom
        width = $rect.Right - $rect.Left
        height = $rect.Bottom - $rect.Top
    }
    clientOrigin = [pscustomobject]@{ x = $origin.X; y = $origin.Y }
    clientBounds = [pscustomobject]@{
        left = $origin.X
        top = $origin.Y
        right = $origin.X + $clientRect.Right - $clientRect.Left
        bottom = $origin.Y + $clientRect.Bottom - $clientRect.Top
        width = $clientRect.Right - $clientRect.Left
        height = $clientRect.Bottom - $clientRect.Top
    }
    style = $style
    extendedStyle = $extendedStyle
    topmost = [bool](($extendedStyle -band [NativeSmokeWindow]::WS_EX_TOPMOST) -ne 0)
    caption = [bool](($style -band [NativeSmokeWindow]::WS_CAPTION) -ne 0)
    thickFrame = [bool](($style -band [NativeSmokeWindow]::WS_THICKFRAME) -ne 0)
    toolWindow = [bool](($extendedStyle -band [NativeSmokeWindow]::WS_EX_TOOLWINDOW) -ne 0)
    appWindow = [bool](($extendedStyle -band [NativeSmokeWindow]::WS_EX_APPWINDOW) -ne 0)
    targetAboveOther = if ($null -eq $zOrder) { $null } else { [bool]($zOrder -lt 0) }
    zOrderComparison = $zOrder
    pixels = $pixels
} | ConvertTo-Json -Compress -Depth 6
