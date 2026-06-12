param(
  [string]$TargetRoot = "apps\desktop\src-tauri\target"
)

$ErrorActionPreference = "Stop"

if (!(Test-Path -LiteralPath $TargetRoot)) {
  Write-Host "Cargo target directory not found: $TargetRoot"
  exit 0
}

$targetRootPath = (Resolve-Path -LiteralPath $TargetRoot).Path.TrimEnd("\")
$cmakeCaches = Get-ChildItem -LiteralPath $targetRootPath -Recurse -Force -Filter CMakeCache.txt -ErrorAction SilentlyContinue
$removed = 0

foreach ($cache in $cmakeCaches) {
  $buildDir = $cache.Directory
  if ($null -eq $buildDir) {
    continue
  }

  $buildDirPath = $buildDir.FullName.TrimEnd("\")
  if (!$buildDirPath.StartsWith($targetRootPath, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to remove CMake cache outside target root: $buildDirPath"
  }

  if ($buildDirPath -notmatch "\\whisper-rs-sys-[^\\]+\\out\\build$") {
    continue
  }

  Write-Host "Removing cached whisper CMake build directory: $buildDirPath"
  Remove-Item -LiteralPath $buildDirPath -Recurse -Force
  $removed += 1
}

Write-Host "Removed $removed cached whisper CMake build director$(if ($removed -eq 1) { 'y' } else { 'ies' })."
