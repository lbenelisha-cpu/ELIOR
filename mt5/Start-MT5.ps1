$ErrorActionPreference = 'Stop'
$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
$nodePath = if ($nodeCmd) { $nodeCmd.Source } else { Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' }
if (-not (Test-Path -LiteralPath $nodePath)) { throw 'Install Node.js from nodejs.org, then run this script again.' }
if (-not $env:MT5_MCP_TOKEN) {
    Write-Host 'In MT5, open Ctrl+O > MCP > Copy. Then press Enter here.'
    Read-Host | Out-Null
    $copied = Get-Clipboard -Raw
    $section = [regex]::Match($copied, '(?ms)^\[mcp_servers\.terminal\]\s*\r?\n(?<body>.*?)(?=^\[|\z)').Groups['body'].Value
    $env:MT5_MCP_TOKEN = [regex]::Match($section, '"Authorization"\s*=\s*"Bearer ([^"]+)"').Groups[1].Value
    $env:MT5_MCP_URL = [regex]::Match($section, 'url\s*=\s*"([^"]+)"').Groups[1].Value
    $copied = $null; $section = $null
    if (-not $env:MT5_MCP_TOKEN) { throw 'The clipboard does not contain the MT5 terminal connection settings.' }
}
try { & $nodePath (Join-Path $PSScriptRoot 'bridge.mjs') } finally { Remove-Item Env:\MT5_MCP_TOKEN -ErrorAction SilentlyContinue; Remove-Item Env:\MT5_MCP_URL -ErrorAction SilentlyContinue }
