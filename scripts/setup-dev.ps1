param(
  [string]$VcpkgRoot = $(if ($env:VCPKG_ROOT) { $env:VCPKG_ROOT } else { Join-Path $env:USERPROFILE "vcpkg" }),
  [string]$Triplet = "x64-windows",
  [switch]$SkipGitInstall,
  [switch]$SkipNodeInstall,
  [switch]$SkipBunInstall,
  [switch]$SkipRustInstall,
  [switch]$SkipVsInstall,
  [switch]$SkipVcpkgInstall,
  [switch]$SkipLlvmInstall,
  [switch]$SkipCmakeInstall,
  [switch]$SkipNinjaInstall,
  [switch]$SkipDependencyInstall
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Write-Step {
  param([string]$Message)
  Write-Host ""
  Write-Host "==> $Message" -ForegroundColor Cyan
}

function Add-UserPath {
  param([string]$PathToAdd)

  if (-not (Test-Path -LiteralPath $PathToAdd)) {
    return
  }

  $currentUserPath = [Environment]::GetEnvironmentVariable("Path", "User")
  $entries = @()
  if ($currentUserPath) {
    $entries = $currentUserPath -split ";" | Where-Object { $_ }
  }

  $alreadyPresent = $entries | Where-Object { $_.TrimEnd("\") -ieq $PathToAdd.TrimEnd("\") }
  if (-not $alreadyPresent) {
    $nextPath = (@($entries) + $PathToAdd) -join ";"
    [Environment]::SetEnvironmentVariable("Path", $nextPath, "User")
  }

  $processEntries = $env:Path -split ";" | Where-Object { $_ }
  $processPresent = $processEntries | Where-Object { $_.TrimEnd("\") -ieq $PathToAdd.TrimEnd("\") }
  if (-not $processPresent) {
    $env:Path = "$env:Path;$PathToAdd"
  }
}

function Refresh-ProcessPath {
  $machinePath = [Environment]::GetEnvironmentVariable("Path", "Machine")
  $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
  $paths = @()
  if ($machinePath) {
    $paths += $machinePath
  }
  if ($userPath) {
    $paths += $userPath
  }
  if ($paths.Count -gt 0) {
    $env:Path = $paths -join ";"
  }
}

function Test-Command {
  param([string]$Name)
  return $null -ne (Get-Command $Name -ErrorAction SilentlyContinue)
}

function Get-Winget {
  $winget = Get-Command winget.exe -ErrorAction SilentlyContinue
  if (-not $winget) {
    throw "winget is required for automatic setup. Install App Installer from Microsoft Store, then rerun this script."
  }
  return $winget
}

function Install-WingetPackage {
  param(
    [string]$Id,
    [string]$Name,
    [string[]]$ExtraArgs = @()
  )

  Get-Winget | Out-Null
  Write-Step "Installing $Name"
  $args = @(
    "install",
    "--id", $Id,
    "--exact",
    "--accept-package-agreements",
    "--accept-source-agreements"
  ) + $ExtraArgs

  & winget @args
  if ($LASTEXITCODE -ne 0) {
    throw "winget failed to install $Name ($Id). Install it manually, then rerun this script."
  }

  Refresh-ProcessPath
}

function Ensure-Git {
  if (Test-Command "git.exe") {
    Write-Host "Found Git: $((Get-Command git.exe).Source)"
    return
  }
  if ($SkipGitInstall) {
    throw "Git was not found. Install Git for Windows or rerun without -SkipGitInstall."
  }

  Install-WingetPackage -Id "Git.Git" -Name "Git"
  if (-not (Test-Command "git.exe")) {
    throw "Git was installed but git.exe is still not on PATH. Open a new terminal and rerun this script."
  }
}

function Ensure-Node {
  if (Test-Command "node.exe") {
    Write-Host "Found Node: $((Get-Command node.exe).Source)"
    return
  }
  if ($SkipNodeInstall) {
    throw "Node.js was not found. Install Node.js LTS or rerun without -SkipNodeInstall."
  }

  Install-WingetPackage -Id "OpenJS.NodeJS.LTS" -Name "Node.js LTS"
  if (-not (Test-Command "node.exe")) {
    throw "Node.js was installed but node.exe is still not on PATH. Open a new terminal and rerun this script."
  }
}

function Ensure-Bun {
  if (Test-Command "bun.exe") {
    Write-Host "Found Bun: $((Get-Command bun.exe).Source)"
    return
  }
  if ($SkipBunInstall) {
    throw "Bun was not found. Install Bun or rerun without -SkipBunInstall."
  }

  Install-WingetPackage -Id "Oven-sh.Bun" -Name "Bun"
  Add-UserPath (Join-Path $env:USERPROFILE ".bun\bin")
  Refresh-ProcessPath
  if (-not (Test-Command "bun.exe")) {
    throw "Bun was installed but bun.exe is still not on PATH. Open a new terminal and rerun this script."
  }
}

function Ensure-Rust {
  Add-UserPath (Join-Path $env:USERPROFILE ".cargo\bin")
  Refresh-ProcessPath

  if (-not (Test-Command "rustup.exe")) {
    if ($SkipRustInstall) {
      throw "rustup was not found. Install Rust with rustup or rerun without -SkipRustInstall."
    }
    Install-WingetPackage -Id "Rustlang.Rustup" -Name "Rustup"
    Add-UserPath (Join-Path $env:USERPROFILE ".cargo\bin")
    Refresh-ProcessPath
  }

  if (-not (Test-Command "rustup.exe")) {
    throw "rustup.exe is still not on PATH. Open a new terminal and rerun this script."
  }

  Write-Step "Installing Rust MSVC toolchain"
  rustup toolchain install stable-x86_64-pc-windows-msvc --profile minimal
  if ($LASTEXITCODE -ne 0) {
    throw "rustup failed to install stable-x86_64-pc-windows-msvc."
  }

  rustup default stable-x86_64-pc-windows-msvc
  if ($LASTEXITCODE -ne 0) {
    throw "rustup failed to set stable-x86_64-pc-windows-msvc as the default toolchain."
  }

  if (-not (Test-Command "cargo.exe")) {
    throw "cargo.exe is still not on PATH after Rust setup."
  }
}

function Install-WorkspaceDependencies {
  if ($SkipDependencyInstall) {
    return
  }

  $repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
  $packageJson = Join-Path $repoRoot "package.json"
  if (-not (Test-Path -LiteralPath $packageJson)) {
    throw "package.json was not found at $packageJson"
  }

  Write-Step "Installing workspace dependencies"
  Push-Location $repoRoot
  try {
    bun install --frozen-lockfile
    if ($LASTEXITCODE -ne 0) {
      throw "bun install failed."
    }
  }
  finally {
    Pop-Location
  }
}

function Get-VsInstallPath {
  $vswhere = Join-Path ${env:ProgramFiles(x86)} "Microsoft Visual Studio\Installer\vswhere.exe"
  if (-not (Test-Path -LiteralPath $vswhere)) {
    return $null
  }

  $path = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
  if ($LASTEXITCODE -ne 0 -or -not $path) {
    return $null
  }

  return $path.Trim()
}

function Install-VisualStudioBuildTools {
  if ($SkipVsInstall) {
    throw "Visual Studio C++ Build Tools were not found. Install the 'Desktop development with C++' workload or rerun without -SkipVsInstall."
  }

  Install-WingetPackage `
    -Id "Microsoft.VisualStudio.2022.BuildTools" `
    -Name "Visual Studio 2022 Build Tools" `
    -ExtraArgs @(
      "--override",
      "--wait --quiet --add Microsoft.VisualStudio.Workload.NativeDesktop --includeRecommended --norestart"
    )
}

function Find-LibclangPath {
  $candidates = @()

  if ($env:LIBCLANG_PATH) {
    $candidates += $env:LIBCLANG_PATH
  }

  $candidates += @(
    "C:\Program Files\LLVM\bin",
    "C:\Program Files (x86)\LLVM\bin"
  )

  $llvmCommand = Get-Command clang.exe -ErrorAction SilentlyContinue
  if ($llvmCommand) {
    $candidates += Split-Path -Parent $llvmCommand.Source
  }

  foreach ($candidate in $candidates | Select-Object -Unique) {
    if ($candidate -and (Test-Path -LiteralPath (Join-Path $candidate "libclang.dll"))) {
      return $candidate
    }
  }

  return $null
}

function Install-Llvm {
  if ($SkipLlvmInstall) {
    return
  }

  $existing = Find-LibclangPath
  if ($existing) {
    Write-Host "Found libclang: $existing"
    return
  }

  Install-WingetPackage -Id "LLVM.LLVM" -Name "LLVM for libclang"
}

function Find-CmakePath {
  $command = Get-Command cmake.exe -ErrorAction SilentlyContinue
  if ($command) {
    return Split-Path -Parent $command.Source
  }

  $candidates = @(
    "C:\Program Files\CMake\bin",
    "C:\Program Files (x86)\CMake\bin"
  )

  foreach ($candidate in $candidates) {
    if (Test-Path -LiteralPath (Join-Path $candidate "cmake.exe")) {
      return $candidate
    }
  }

  return $null
}

function Find-NinjaPath {
  $command = Get-Command ninja.exe -ErrorAction SilentlyContinue
  if ($command) {
    return Split-Path -Parent $command.Source
  }

  $candidates = @(
    (Join-Path $env:LOCALAPPDATA "Microsoft\WinGet\Packages\Ninja-build.Ninja_Microsoft.Winget.Source_8wekyb3d8bbwe"),
    "C:\Program Files\Ninja"
  )

  foreach ($candidate in $candidates) {
    if ($candidate -and (Test-Path -LiteralPath (Join-Path $candidate "ninja.exe"))) {
      return $candidate
    }
  }

  return $null
}

function Install-Cmake {
  if ($SkipCmakeInstall) {
    return
  }

  $existing = Find-CmakePath
  if ($existing) {
    Write-Host "Found CMake: $existing"
    Add-UserPath $existing
    return
  }

  Install-WingetPackage -Id "Kitware.CMake" -Name "CMake"
}

function Install-Ninja {
  if ($SkipNinjaInstall) {
    return
  }

  $existing = Find-NinjaPath
  if ($existing) {
    Write-Host "Found Ninja: $existing"
    Add-UserPath $existing
    return
  }

  Install-WingetPackage -Id "Ninja-build.Ninja" -Name "Ninja"
}

Write-Step "Checking base tools"
Ensure-Git
Ensure-Node
Ensure-Bun
Ensure-Rust

Write-Step "Checking Visual Studio C++ Build Tools"
$vsInstallPath = Get-VsInstallPath
if (-not $vsInstallPath) {
  Install-VisualStudioBuildTools
  $vsInstallPath = Get-VsInstallPath
}

if (-not $vsInstallPath) {
  throw "Visual Studio 2022 Build Tools with the 'Desktop development with C++' workload were not found after setup."
}

$vcvars64 = Join-Path $vsInstallPath "VC\Auxiliary\Build\vcvars64.bat"
if (-not (Test-Path -LiteralPath $vcvars64)) {
  throw "vcvars64.bat was not found at $vcvars64"
}
Write-Host "Found Visual Studio: $vsInstallPath"

Write-Step "Installing vcpkg"
if (-not (Test-Path -LiteralPath $VcpkgRoot)) {
  git clone https://github.com/microsoft/vcpkg.git $VcpkgRoot
}

$vcpkgExe = Join-Path $VcpkgRoot "vcpkg.exe"
if (-not (Test-Path -LiteralPath $vcpkgExe)) {
  $bootstrap = Join-Path $VcpkgRoot "bootstrap-vcpkg.bat"
  if (-not (Test-Path -LiteralPath $bootstrap)) {
    throw "bootstrap-vcpkg.bat was not found in $VcpkgRoot"
  }
  & $bootstrap -disableMetrics
}

if (-not (Test-Path -LiteralPath $vcpkgExe)) {
  throw "vcpkg.exe was not created at $vcpkgExe"
}

[Environment]::SetEnvironmentVariable("VCPKG_ROOT", $VcpkgRoot, "User")
$env:VCPKG_ROOT = $VcpkgRoot
Add-UserPath $VcpkgRoot
Write-Host "VCPKG_ROOT=$VcpkgRoot"

if (-not $SkipVcpkgInstall) {
  Write-Step "Installing FFmpeg development libraries with vcpkg"
  & $vcpkgExe install "ffmpeg:$Triplet"
  if ($LASTEXITCODE -ne 0) {
    throw "vcpkg failed to install ffmpeg:$Triplet"
  }
}

Install-Llvm

Install-Cmake

Install-Ninja

Write-Step "Configuring LLVM/libclang"
$libclangPath = Find-LibclangPath
if (-not $libclangPath) {
  throw "libclang.dll was not found after LLVM setup. Set LIBCLANG_PATH manually to the folder containing libclang.dll."
}

[Environment]::SetEnvironmentVariable("LIBCLANG_PATH", $libclangPath, "User")
$env:LIBCLANG_PATH = $libclangPath
Add-UserPath $libclangPath
Write-Host "LIBCLANG_PATH=$libclangPath"

Write-Step "Configuring CMake"
$cmakePath = Find-CmakePath
if (-not $cmakePath) {
  throw "cmake.exe was not found after CMake setup."
}
Add-UserPath $cmakePath
Write-Host "CMake=$cmakePath"

Write-Step "Configuring Ninja"
$ninjaPath = Find-NinjaPath
if (-not $ninjaPath) {
  throw "ninja.exe was not found after Ninja setup."
}
Add-UserPath $ninjaPath
Write-Host "Ninja=$ninjaPath"

Write-Step "Verifying tools"
node (Join-Path $PSScriptRoot "run-with-msvc.cjs") where link
node (Join-Path $PSScriptRoot "run-with-msvc.cjs") where cl
rustup --version
cargo --version
node --version
bun --version
git --version
where.exe cmake
where.exe ninja
& $vcpkgExe list "ffmpeg:$Triplet"
if (-not (Test-Path -LiteralPath (Join-Path $libclangPath "libclang.dll"))) {
  throw "libclang verification failed."
}

Install-WorkspaceDependencies

Write-Step "Done"
Write-Host "Open a new terminal before running dev commands so persisted environment variables are loaded."
Write-Host "For this terminal, VCPKG_ROOT and LIBCLANG_PATH have already been set."
Write-Host "Next: bun run dev:all"
