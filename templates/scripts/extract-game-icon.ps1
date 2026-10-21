param(
  [Parameter(Mandatory = $true)][string]$Executable,
  [Parameter(Mandatory = $true)][string]$OutputPath
)

$ErrorActionPreference = 'Stop'
if (-not (Test-Path -LiteralPath $Executable -PathType Leaf)) {
  throw 'Game executable is missing.'
}
$executableFullPath = [System.IO.Path]::GetFullPath($Executable)
$outputFullPath = [System.IO.Path]::GetFullPath($OutputPath)
$expectedOutput = [System.IO.Path]::GetFullPath((Join-Path (Get-Location).Path 'public/game/favicon.ico'))
if ([string]::Equals($executableFullPath, $outputFullPath, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw 'Refusing to overwrite the game executable.'
}
if (-not [string]::Equals($outputFullPath, $expectedOutput, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw 'Output must be the local public/game/favicon.ico.'
}

Add-Type -AssemblyName System.Drawing
$icon = $null
$stream = $null
$temporaryPath = "$outputFullPath.$PID.tmp"
try {
  $icon = [System.Drawing.Icon]::ExtractAssociatedIcon($Executable)
  if ($null -eq $icon) { throw 'The executable has no associated icon resource.' }
  $directory = Split-Path -Parent $outputFullPath
  [System.IO.Directory]::CreateDirectory($directory) | Out-Null
  $stream = [System.IO.File]::Open($temporaryPath, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
  $icon.Save($stream)
  $stream.Dispose(); $stream = $null
  # Remove the old directory entry before moving the new file so a stale link cannot redirect writes.
  if (Test-Path -LiteralPath $outputFullPath) { [System.IO.File]::Delete($outputFullPath) }
  [System.IO.File]::Move($temporaryPath, $outputFullPath)
} finally {
  if ($null -ne $stream) { $stream.Dispose() }
  if ($null -ne $icon) { $icon.Dispose() }
  if (Test-Path -LiteralPath $temporaryPath) { [System.IO.File]::Delete($temporaryPath) }
}
