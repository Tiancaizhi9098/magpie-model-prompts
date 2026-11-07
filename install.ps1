param([string]$MagpiePath)
$ErrorActionPreference = 'Stop'
if (-not $MagpiePath) {
    $magpieCommand = Get-Command magpie -ErrorAction SilentlyContinue
    if ($magpieCommand) { $MagpiePath = $magpieCommand.Source }
    else { $MagpiePath = Join-Path $env:LOCALAPPDATA 'Programs\magpie\magpie.exe' }
}
if (-not (Test-Path -LiteralPath $MagpiePath -PathType Leaf)) { throw 'Magpie was not found. Run install.ps1 -MagpiePath with the path to magpie.exe.' }
$consoleLauncher = [IO.Path]::ChangeExtension($MagpiePath, '.com')
if (Test-Path -LiteralPath $consoleLauncher -PathType Leaf) { $MagpiePath = $consoleLauncher }
$configurationRoot = if ($env:XDG_CONFIG_HOME) { $env:XDG_CONFIG_HOME } else { Join-Path $env:USERPROFILE '.config' }
$pluginRoot = Join-Path $configurationRoot 'magpie\plugins'
$pluginDestination = Join-Path $pluginRoot 'magpie-model-prompts'
New-Item -ItemType Directory -Force -Path $pluginDestination | Out-Null
if ([IO.Path]::GetFullPath($PSScriptRoot).TrimEnd('\') -ne [IO.Path]::GetFullPath($pluginDestination).TrimEnd('\')) {
    $runtimeEntries = @('package.json','index.mjs','prompts.middleware.js','lib','page','README.md','LICENSE','install.ps1','install.cmd')
    foreach ($entryName in $runtimeEntries) {
        $entryPath = Join-Path $PSScriptRoot $entryName
        if (Test-Path -LiteralPath $entryPath) { Copy-Item -LiteralPath $entryPath -Destination $pluginDestination -Recurse -Force }
    }
}
& $MagpiePath plugin add $pluginDestination
$pluginConfiguration = Join-Path $configurationRoot 'magpie\plugins.json'
$registered = $false
for ($attempt = 0; $attempt -lt 20; $attempt++) {
    if (Test-Path -LiteralPath $pluginConfiguration) {
        $configuration = Get-Content -Raw -LiteralPath $pluginConfiguration | ConvertFrom-Json
        $registered = @($configuration.plugins | Where-Object { $_.spec -eq $pluginDestination }).Count -gt 0
        if ($registered) { break }
    }
    Start-Sleep -Milliseconds 150
}
if (-not $registered) { throw 'Magpie did not register the plugin. Add the destination folder in Plugins manually.' }
Write-Host 'Installed. Open Magpie > Plugins > Model Prompts.'
Write-Host $pluginDestination
