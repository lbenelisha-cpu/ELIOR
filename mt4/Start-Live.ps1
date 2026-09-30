$ErrorActionPreference='Stop'
$nodeCmd=Get-Command node -ErrorAction SilentlyContinue
$nodePath=if($nodeCmd){$nodeCmd.Source}else{Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'}
if(-not(Test-Path -LiteralPath $nodePath)){throw 'Install Node.js from nodejs.org'}
if(-not $env:LEVI_MT4_SNAPSHOT){$env:LEVI_MT4_SNAPSHOT=Join-Path $env:APPDATA 'MetaQuotes\Terminal\50CA3DFB510CC5A8F28B48D1BF2A5702\MQL4\Files\LEVI_live_snapshot.json'}
$env:LEVI_BRIDGE_PORT='22352'
Write-Host 'Open http://127.0.0.1:22352/mt4 and keep this window open.'
& $nodePath (Join-Path $PSScriptRoot 'live-bridge.mjs')

