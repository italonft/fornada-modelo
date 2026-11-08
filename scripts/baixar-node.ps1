# Baixa o Node.js portatil do site oficial, confere a assinatura SHA-256 e guarda em runtime\node.
# Nao instala nada no sistema: apagar a pasta do Fornada remove tudo.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$root = Split-Path -Parent $PSScriptRoot
if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { $arch = 'arm64' }
elseif ([Environment]::Is64BitOperatingSystem) { $arch = 'x64' }
else { $arch = 'x86' }

$base = 'https://nodejs.org/dist/latest-v22.x'
$sums = (Invoke-WebRequest -UseBasicParsing "$base/SHASUMS256.txt").Content
if ($sums -is [byte[]]) { $sums = [Text.Encoding]::UTF8.GetString($sums) }

$line = ($sums -split "`n") | Where-Object { $_ -match "node-v\d+\.\d+\.\d+-win-$arch\.zip\s*$" } | Select-Object -First 1
if (-not $line) { throw "Versao do Node.js para win-$arch nao encontrada." }
$parts = $line.Trim() -split '\s+'
$expected = $parts[0].ToLower()
$file = $parts[1]

$dest = Join-Path $env:TEMP $file
Write-Host "Baixando $file ..."
Invoke-WebRequest -UseBasicParsing "$base/$file" -OutFile $dest

$actual = (Get-FileHash $dest -Algorithm SHA256).Hash.ToLower()
if ($actual -ne $expected) {
  Remove-Item $dest -Force
  throw 'O arquivo baixado nao confere com a assinatura oficial.'
}

$runtime = Join-Path $root 'runtime'
if (Test-Path $runtime) { Remove-Item $runtime -Recurse -Force }
New-Item -ItemType Directory -Path $runtime | Out-Null
Expand-Archive -Path $dest -DestinationPath $runtime -Force
Rename-Item -Path (Join-Path $runtime ($file -replace '\.zip$', '')) -NewName 'node'
Remove-Item $dest -Force
Write-Host 'Node.js pronto.'
