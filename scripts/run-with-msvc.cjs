#!/usr/bin/env node

const { execFileSync, spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const args = process.argv.slice(2);

if (args.length === 0) {
  console.error('Usage: node scripts/run-with-msvc.cjs <command> [...args]');
  process.exit(2);
}

function run(command, commandArgs, options = {}) {
  const child = spawn(command, commandArgs, {
    stdio: 'inherit',
    shell: false,
    ...options,
  });

  child.on('exit', (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 1);
  });

  child.on('error', (error) => {
    console.error(error.message);
    process.exit(1);
  });
}

function quoteCmdArg(arg) {
  return `"${String(arg).replace(/"/g, '""')}"`;
}

function appendPath(env, candidate) {
  if (!candidate || !fs.existsSync(candidate)) {
    return;
  }

  const delimiter = path.delimiter;
  const entries = (env.Path || env.PATH || '').split(delimiter).filter(Boolean);
  const alreadyPresent = entries.some((entry) => (
    entry.replace(/[\\/]+$/, '').toLowerCase() === candidate.replace(/[\\/]+$/, '').toLowerCase()
  ));

  if (!alreadyPresent) {
    env.Path = [...entries, candidate].join(delimiter);
    env.PATH = env.Path;
  }
}

function commandExists(name, env = process.env) {
  try {
    execFileSync('where.exe', [name], { stdio: 'ignore', env });
    return true;
  } catch {
    return false;
  }
}

if (process.platform !== 'win32') {
  run(args[0], args.slice(1));
  return;
}

const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
const vswhere = path.join(programFilesX86, 'Microsoft Visual Studio', 'Installer', 'vswhere.exe');

let installPath = '';
if (fs.existsSync(vswhere)) {
  try {
    installPath = execFileSync(vswhere, [
      '-latest',
      '-products',
      '*',
      '-requires',
      'Microsoft.VisualStudio.Component.VC.Tools.x86.x64',
      '-property',
      'installationPath',
    ], { encoding: 'utf8' }).trim();
  } catch {
    installPath = '';
  }
}

const vcvars64 = installPath
  ? path.join(installPath, 'VC', 'Auxiliary', 'Build', 'vcvars64.bat')
  : '';

if (!vcvars64 || !fs.existsSync(vcvars64)) {
  run(args[0], args.slice(1));
  return;
}

const env = { ...process.env };

const userProfile = env.USERPROFILE || '';
appendPath(env, path.join(userProfile, 'vcpkg'));
appendPath(env, 'C:\\Program Files\\LLVM\\bin');
appendPath(env, 'C:\\Program Files\\CMake\\bin');
appendPath(env, path.join(
  env.LOCALAPPDATA || '',
  'Microsoft',
  'WinGet',
  'Packages',
  'Ninja-build.Ninja_Microsoft.Winget.Source_8wekyb3d8bbwe',
));

if (!env.VCPKG_ROOT) {
  const defaultVcpkgRoot = path.join(userProfile, 'vcpkg');
  if (fs.existsSync(path.join(defaultVcpkgRoot, 'vcpkg.exe'))) {
    env.VCPKG_ROOT = defaultVcpkgRoot;
  }
}
if (!env.LIBCLANG_PATH && fs.existsSync('C:\\Program Files\\LLVM\\bin\\libclang.dll')) {
  env.LIBCLANG_PATH = 'C:\\Program Files\\LLVM\\bin';
}

if (!env.CMAKE_GENERATOR && commandExists('ninja.exe', env)) {
  env.CMAKE_GENERATOR = 'Ninja';
}
if (!env.CMAKE_TOOLCHAIN_FILE) {
  const toolchainFile = path.join(__dirname, 'cmake-windows-msvc-toolchain.cmake');
  if (fs.existsSync(toolchainFile)) {
    env.CMAKE_TOOLCHAIN_FILE = toolchainFile;
  }
}

const command = args.map(quoteCmdArg).join(' ');
const cmdLine = `call ${quoteCmdArg(vcvars64)} >nul && ${command}`;

run('cmd.exe', ['/d', '/c', cmdLine], { windowsVerbatimArguments: true, env });
