$ErrorActionPreference = 'Stop'
$OutputEncoding = [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
try {
    Add-Type -AssemblyName System.Security
    $request = [Console]::In.ReadToEnd() | ConvertFrom-Json
    $scope = [System.Security.Cryptography.DataProtectionScope]::CurrentUser
    $entropy = [System.Text.Encoding]::UTF8.GetBytes('ncm-song-knowledge/v1')
    switch ($request.operation) {
        'protect' {
            $bytes = [System.Text.Encoding]::UTF8.GetBytes([string]$request.value)
            $protected = [System.Security.Cryptography.ProtectedData]::Protect($bytes, $entropy, $scope)
            [Console]::Out.Write([Convert]::ToBase64String($protected))
        }
        'unprotect' {
            $bytes = [Convert]::FromBase64String([string]$request.value)
            $plain = [System.Security.Cryptography.ProtectedData]::Unprotect($bytes, $entropy, $scope)
            [Console]::Out.Write([System.Text.Encoding]::UTF8.GetString($plain))
        }
        default { throw 'Unsupported vault operation' }
    }
} catch {
    [Console]::Error.Write('Windows credential protection failed.')
    exit 1
}
