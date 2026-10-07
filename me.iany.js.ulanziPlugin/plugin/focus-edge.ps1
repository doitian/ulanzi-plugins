$ErrorActionPreference = 'Stop'

try {
    $scheme = $env:ULANZI_BROWSER_SCHEME
    if ($scheme -ne 'microsoft-edge') {
        if ($scheme -notin @('http', 'https')) { exit }
        $choice = Get-ItemProperty "HKCU:\Software\Microsoft\Windows\Shell\Associations\UrlAssociations\$scheme\UserChoice"
        if ($choice.ProgId -notlike 'MSEdge*') { exit }
    }

    Add-Type -TypeDefinition @'
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;

public static class EdgeForeground {
    private delegate bool EnumWindowsProc(IntPtr window, IntPtr param);
    [DllImport("user32.dll")] private static extern bool EnumWindows(EnumWindowsProc callback, IntPtr param);
    [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll")] private static extern bool IsIconic(IntPtr window);
    [DllImport("user32.dll")] private static extern IntPtr GetWindow(IntPtr window, uint command);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetClassName(IntPtr window, StringBuilder name, int count);
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window, out uint process);
    [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] private static extern bool ShowWindowAsync(IntPtr window, int command);
    [DllImport("user32.dll")] private static extern bool BringWindowToTop(IntPtr window);
    [DllImport("user32.dll")] private static extern bool SetForegroundWindow(IntPtr window);
    [DllImport("user32.dll")] private static extern bool AttachThreadInput(uint from, uint to, bool attach);
    [DllImport("kernel32.dll")] private static extern uint GetCurrentThreadId();

    public static bool Focus() {
        IntPtr target = IntPtr.Zero;
        // EnumWindows walks Z-order, so prefer the most recently raised Edge window.
        EnumWindows(delegate(IntPtr window, IntPtr param) {
            if (!IsWindowVisible(window) || GetWindow(window, 4) != IntPtr.Zero) return true;
            var name = new StringBuilder(256);
            GetClassName(window, name, name.Capacity);
            if (name.ToString() != "Chrome_WidgetWin_1") return true;
            uint pid;
            GetWindowThreadProcessId(window, out pid);
            try {
                using (var process = Process.GetProcessById((int)pid)) {
                    if (process.ProcessName != "msedge") return true;
                }
            } catch { return true; }
            target = window;
            return false;
        }, IntPtr.Zero);
        if (target == IntPtr.Zero) return false;
        if (IsIconic(target)) ShowWindowAsync(target, 9);
        if (GetForegroundWindow() == target) return true;

        uint ignored;
        uint current = GetCurrentThreadId();
        uint foreground = GetWindowThreadProcessId(GetForegroundWindow(), out ignored);
        // The plugin is not the foreground process; temporarily share its input queue.
        bool attached = foreground != 0 && foreground != current && AttachThreadInput(current, foreground, true);
        try {
            BringWindowToTop(target);
            SetForegroundWindow(target);
        } finally {
            if (attached) AttachThreadInput(current, foreground, false);
        }
        return GetForegroundWindow() == target;
    }
}
'@

    # URL opening is handled by UlanziStudio and may arrive after the focus request.
    Start-Sleep -Milliseconds 300
    for ($attempt = 0; $attempt -lt 15; $attempt++) {
        if ([EdgeForeground]::Focus()) { Write-Output 'focused'; exit }
        Start-Sleep -Milliseconds 200
    }
} catch {
    # Focusing must not interfere with opening the page or expose desktop details.
    exit 1
}
