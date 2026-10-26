import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, basename, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const helper = fileURLToPath(new URL('../scripts/store-activation.ps1', import.meta.url));
const shell = join(process.env.SystemRoot || 'C:/Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
const project = fileURLToPath(new URL('../', import.meta.url));

test('all PowerShell entry points parse in the Windows PowerShell used by the shortcut', { skip: process.platform !== 'win32' }, async () => {
  const files = (await Promise.all(['scripts', 'src'].map(async dir => (await readdir(join(project, dir))).filter(name => name.endsWith('.ps1')).map(name => join(project, dir, name))))).flat();
  const script = "$ErrorActionPreference='Stop'; $paths=$env:NCM_TEST_SCRIPTS | ConvertFrom-Json; foreach ($file in $paths) { $tokens=$null; $errors=$null; [void][System.Management.Automation.Language.Parser]::ParseFile($file,[ref]$tokens,[ref]$errors); if ($errors.Count) { throw ($errors[0].Message + ' at ' + $file + ':' + $errors[0].Extent.StartLineNumber) } }; Write-Output 'parsed'";
  const { stdout } = await run(shell, ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, env: { ...process.env, NCM_TEST_SCRIPTS: JSON.stringify(files) } });
  assert.equal(stdout.trim(), 'parsed');
});

test('the actual shortcut script reaches preflight successfully without activating the client', { skip: process.platform !== 'win32' }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ncm-launch-test-'));
  try {
    const { stdout } = await run(shell, ['-NoProfile', '-NonInteractive', '-File', join(project, 'scripts/launch.ps1'), '-CheckOnly'], { windowsHide: true, env: { ...process.env, LOCALAPPDATA: directory } });
    const status = JSON.parse(stdout.trim());
    assert.equal(status.ok, true); assert.ok(status.nodeMajor >= 24); assert.equal(status.activationHelper, true);
  } finally {
    const absolute = resolve(directory);
    if (!absolute.startsWith(resolve(tmpdir()) + sep) || !basename(absolute).startsWith('ncm-launch-test-')) throw Error('Unexpected test cleanup path');
    await rm(absolute, { recursive: true, force: true });
  }
});

test('Store launch resolves the installed manifest identity and compiles the official activation interface without starting an app', { skip: process.platform !== 'win32' }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ncm-launch-test-'));
  try {
    await writeFile(join(directory, 'AppxManifest.xml'), '<Package xmlns="http://schemas.microsoft.com/appx/manifest/foundation/windows10"><Applications><Application Id="CLOUDMUSIC" Executable="VFS\\ProgramFilesX86\\Netease\\CloudMusic\\cloudmusic.exe" EntryPoint="Windows.FullTrustApplication"/></Applications></Package>');
    const testScript = join(directory, 'test.ps1');
    await writeFile(testScript, '\ufeff' + [
      "$ErrorActionPreference = 'Stop'",
      '. $env:NCM_TEST_HELPER',
      '$target = Get-NcmStoreLaunchTarget -Package ([pscustomobject]@{InstallLocation=$env:NCM_TEST_DIRECTORY;PackageFamilyName="example_publisher"})',
      'Initialize-NcmStoreActivator',
      '[pscustomobject]@{kind=$target.Kind;appId=$target.AppUserModelId;compiled=[bool]("NcmKnowledge.StoreActivator" -as [type])} | ConvertTo-Json -Compress',
    ].join('\r\n'));
    const { stdout } = await run(shell, ['-NoProfile', '-NonInteractive', '-File', testScript], { windowsHide: true, env: { ...process.env, NCM_TEST_HELPER: helper, NCM_TEST_DIRECTORY: directory } });
    assert.deepEqual(JSON.parse(stdout.trim()), { kind: 'Store', appId: 'example_publisher!CLOUDMUSIC', compiled: true });
    await writeFile(join(directory, 'AppxManifest.xml'), '<Package><Applications><Application Id="Other" Executable="other.exe"/></Applications></Package>');
    await assert.rejects(run(shell, ['-NoProfile', '-NonInteractive', '-File', testScript], { windowsHide: true, env: { ...process.env, NCM_TEST_HELPER: helper, NCM_TEST_DIRECTORY: directory } }));
  } finally {
    const absolute = resolve(directory);
    if (!absolute.startsWith(resolve(tmpdir()) + sep) || !basename(absolute).startsWith('ncm-launch-test-')) throw Error('Unexpected test cleanup path');
    await rm(absolute, { recursive: true, force: true });
  }
});
