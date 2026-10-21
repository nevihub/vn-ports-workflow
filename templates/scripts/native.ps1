# Drive a COPY of the original saya.exe for side-by-side comparison (never the user's install).
# The game reads the real mouse/keyboard (posted messages are ignored), so each input briefly focuses it, then gives
# focus and the cursor back. Captures use PrintWindow and work while the game sits behind other windows (not minimized).
#   native.ps1 start [gameDir]       launch (default re/native/game) behind the current window, print pid
#   native.ps1 shot <out.png>        capture the client area, scaled to 800x600
#   native.ps1 click <x> <y> [right] click at 800x600 game coordinates
#   native.ps1 move <x> <y>          park the cursor on a point (hover state) without clicking
#   native.ps1 key <name>            enter | esc | space | ctrl | up | down | left | right | a single letter/digit
#   native.ps1 hold-ctrl <ms>        hold Ctrl (skip) for ms
#   native.ps1 stop
param([Parameter(Mandatory)][string]$cmd, [string]$a, [string]$b, [string]$c)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type @'
using System; using System.Runtime.InteropServices;
public static class W {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int n);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint f);
  [StructLayout(LayoutKind.Sequential)] public struct PT { public int X, Y; }
  [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr h, ref PT p);
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out PT p);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, int x, int y, int d, IntPtr e);
  [DllImport("user32.dll")] public static extern void keybd_event(byte k, byte s, uint f, IntPtr e);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr dc, uint f);
}
'@
$root = Split-Path $PSScriptRoot
function Win {
  $p = Get-Process saya -ErrorAction SilentlyContinue | Where-Object MainWindowHandle -ne 0 | Select-Object -First 1
  if (!$p) { throw 'saya.exe is not running' }
  if ([W]::IsIconic($p.MainWindowHandle)) { [W]::ShowWindow($p.MainWindowHandle, 4) | Out-Null } # SW_SHOWNOACTIVATE
  $p.MainWindowHandle
}
function Size($h) { $r = New-Object W+RECT; [W]::GetClientRect($h, [ref]$r) | Out-Null; @(($r.R - $r.L), ($r.B - $r.T)) }
# Focus the game only for the duration of one input, then restore the user's window and cursor.
function WithFocus($h, [scriptblock]$act) {
  $prev = [W]::GetForegroundWindow(); $cur = New-Object W+PT; [W]::GetCursorPos([ref]$cur) | Out-Null
  [W]::SetForegroundWindow($h) | Out-Null; Start-Sleep -Milliseconds 80
  try { & $act } finally {
    Start-Sleep -Milliseconds 40; [W]::SetCursorPos($cur.X, $cur.Y) | Out-Null; [W]::SetForegroundWindow($prev) | Out-Null
  }
}
function Key($vk, $up) { [W]::keybd_event([byte]$vk, 0, $(if ($up) { 2 } else { 0 }), [IntPtr]::Zero) }
$vks = @{ enter = 0x0D; esc = 0x1B; space = 0x20; ctrl = 0x11; up = 0x26; down = 0x28; left = 0x25; right = 0x27 }
switch ($cmd) {
  'start' {
    $dir = if ($a) { $a } else { Join-Path $root 're\native\game' }
    if ($dir -like '*<game-install>*') { throw 'Refusing to run the original install; use a copy' }
    $prev = [W]::GetForegroundWindow()
    $p = Start-Process (Join-Path $dir 'saya.exe') -WorkingDirectory $dir -PassThru
    for ($i = 0; $i -lt 100 -and $p.MainWindowHandle -eq 0; $i++) { Start-Sleep -Milliseconds 100; $p.Refresh() }
    # Send the game to the back and give focus back to whatever the user was using.
    [W]::SetWindowPos($p.MainWindowHandle, [IntPtr]1, 0, 0, 0, 0, 0x13) | Out-Null # HWND_BOTTOM, NOSIZE|NOMOVE|NOACTIVATE
    [W]::SetForegroundWindow($prev) | Out-Null
    $p.Id
  }
  'shot' {
    $h = Win; $w, $hh = Size $h
    $bmp = New-Object System.Drawing.Bitmap $w, $hh
    $g = [System.Drawing.Graphics]::FromImage($bmp); $dc = $g.GetHdc()
    [W]::PrintWindow($h, $dc, 3) | Out-Null # PW_CLIENTONLY | PW_RENDERFULLCONTENT
    $g.ReleaseHdc($dc); $g.Dispose()
    $out = New-Object System.Drawing.Bitmap $bmp, 800, 600
    $out.Save([IO.Path]::GetFullPath($a), [System.Drawing.Imaging.ImageFormat]::Png); $bmp.Dispose(); $out.Dispose()
    "800x600 (from ${w}x$hh) -> $a"
  }
  'click' {
    $h = Win; $w, $hh = Size $h; $k = $w / 800
    $o = New-Object W+PT; [W]::ClientToScreen($h, [ref]$o) | Out-Null
    $down, $up = if ($c -eq 'right') { 8, 16 } else { 2, 4 }
    WithFocus $h {
      [W]::SetCursorPos($o.X + [int]([int]$a * $k), $o.Y + [int]([int]$b * $k)) | Out-Null; Start-Sleep -Milliseconds 60
      [W]::mouse_event($down, 0, 0, 0, [IntPtr]::Zero); Start-Sleep -Milliseconds 60; [W]::mouse_event($up, 0, 0, 0, [IntPtr]::Zero)
    }
  }
  'move' {
    # Hover without clicking: park the cursor over a point while the game briefly has focus.
    $h = Win; $w, $hh = Size $h; $k = $w / 800
    $o = New-Object W+PT; [W]::ClientToScreen($h, [ref]$o) | Out-Null
    WithFocus $h {
      [W]::SetCursorPos($o.X + [int]([int]$a * $k), $o.Y + [int]([int]$b * $k)) | Out-Null
      Start-Sleep -Milliseconds 200
    }
  }
  'key' {
    $h = Win; $vk = if ($vks.ContainsKey($a)) { $vks[$a] } else { [int][char]$a.ToUpper() }
    WithFocus $h { Key $vk $false; Start-Sleep -Milliseconds 60; Key $vk $true }
  }
  'hold-ctrl' { $h = Win; WithFocus $h { Key 0x11 $false; Start-Sleep -Milliseconds ([int]$a); Key 0x11 $true } }
  'stop' { Get-Process saya -ErrorAction SilentlyContinue | Stop-Process }
  default { throw "unknown command $cmd" }
}
