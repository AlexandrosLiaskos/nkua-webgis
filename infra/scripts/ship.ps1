[CmdletBinding()]
param(
  [string]$Server = "root@76.13.133.211",
  [switch]$ResearchExpansion,
  [switch]$FloodsIntegration
)
$ErrorActionPreference = "Stop"

$sha = (git rev-parse HEAD).Trim()
$bundle = Join-Path $env:TEMP "nkua-webgis-$sha.bundle"
$remoteFile = Join-Path $env:TEMP "nkua-webgis-remote-deploy.sh"
$remoteBundleTarget = "{0}:/opt/nkua-webgis/incoming.bundle" -f $Server
$remoteScriptTarget = "{0}:/opt/nkua-webgis/run-deploy.sh" -f $Server
$deployScript = if ($FloodsIntegration) { 'infra/scripts/release-floods-integration.sh' } elseif ($ResearchExpansion) { 'infra/scripts/release-20260905.sh' } else { 'infra/scripts/deploy.sh' }

try {
  Write-Host "bundling $sha ..."
  git bundle create $bundle HEAD
  if ($LASTEXITCODE -ne 0) {
    throw "git bundle failed with exit code $LASTEXITCODE"
  }

  Write-Host "copying bundle to $Server ..."
  ssh $Server "mkdir -p /opt/nkua-webgis"
  if ($LASTEXITCODE -ne 0) {
    throw "remote directory creation failed with exit code $LASTEXITCODE"
  }

  scp $bundle $remoteBundleTarget
  if ($LASTEXITCODE -ne 0) {
    throw "bundle copy failed with exit code $LASTEXITCODE"
  }

  $remote = @"
set -euo pipefail
mkdir -p /opt/nkua-webgis/src
cd /opt/nkua-webgis/src
if [ ! -d .git ]; then git init -q; fi
git fetch -q /opt/nkua-webgis/incoming.bundle HEAD
git checkout -q -f $sha
bash $deployScript
"@

  [IO.File]::WriteAllText(
    $remoteFile,
    ($remote -replace [char]13, "") + [char]10,
    [Text.UTF8Encoding]::new($false)
  )

  scp $remoteFile $remoteScriptTarget
  if ($LASTEXITCODE -ne 0) {
    throw "remote script copy failed with exit code $LASTEXITCODE"
  }

  ssh $Server "bash /opt/nkua-webgis/run-deploy.sh"
  if ($LASTEXITCODE -ne 0) {
    throw "remote deploy failed with exit code $LASTEXITCODE"
  }
} finally {
  Remove-Item -LiteralPath $bundle, $remoteFile -Force -ErrorAction SilentlyContinue
}

Write-Host "done"
