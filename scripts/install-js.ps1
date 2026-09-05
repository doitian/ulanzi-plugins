param([Parameter(Mandatory = $true)][string]$PluginsDirectory)
$ErrorActionPreference = 'Stop'
$nodePath = (Get-Command node -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
$major = [int]((& $nodePath --version) -replace '^v(\d+).*$', '$1')
if ($major -lt 18) { throw 'The widget bridge requires Node.js 18 or newer.' }
$pluginName = 'me.iany.js.ulanziPlugin'
$source = Join-Path (Split-Path $PSScriptRoot -Parent) $pluginName
# Install platform-specific runtime packages before copying the plugin.
Push-Location $source
try {
    & $nodePath -e "require('@napi-rs/canvas'); require('ws')" 2>$null
    if ($LASTEXITCODE -ne 0) {
        & npm.cmd install --omit=dev --ignore-scripts
        if ($LASTEXITCODE -ne 0) { throw 'Could not install plugin dependencies' }
    }
} finally { Pop-Location }
$pluginsRoot = [IO.Path]::GetFullPath($PluginsDirectory)
$destination = [IO.Path]::GetFullPath((Join-Path $pluginsRoot $pluginName))
if ((Split-Path $destination -Parent) -ne $pluginsRoot -or (Split-Path $destination -Leaf) -ne $pluginName) {
    throw 'Unexpected plugin installation path'
}
if ($destination -eq [IO.Path]::GetFullPath($source)) { throw 'Installation cannot overwrite the source folder' }

# Remove the old sign-in launcher; Ulanzi now starts the plugin service.
$shortcutPath = Join-Path ([Environment]::GetFolderPath('Startup')) 'iany Ulanzi Widget Bridge.lnk'
if (Test-Path -LiteralPath $shortcutPath) { Remove-Item -LiteralPath $shortcutPath -Force }
# Stop only this plugin's processes so native rendering files can be updated.
$entries = @((Join-Path $destination 'bridge\server.cjs'), (Join-Path $destination 'plugin\main.js'))
Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" | Where-Object {
    $commandLine = if ($_.CommandLine) { $_.CommandLine.Replace('/', '\') } else { '' }
    $commandLine -and @($entries | Where-Object {
        $commandLine.Contains('"' + $_ + '"') -or $commandLine.EndsWith(' ' + $_) -or $commandLine.Contains(' ' + $_ + ' ')
    }).Count -gt 0
} | ForEach-Object {
    $pluginProcess = Get-Process -Id $_.ProcessId -ErrorAction Stop
    $pluginProcess | Stop-Process -ErrorAction Stop
    $pluginProcess.WaitForExit()
}
if (Test-Path -LiteralPath $destination) { Remove-Item -LiteralPath $destination -Recurse -Force }
New-Item -ItemType Directory -Force -Path $pluginsRoot | Out-Null
Copy-Item -LiteralPath $source -Destination $destination -Recurse -Force

Write-Output 'Installed widgets. Restart Ulanzi Studio to launch the plugin and its shared server.'
