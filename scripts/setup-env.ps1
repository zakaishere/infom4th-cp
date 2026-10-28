$ErrorActionPreference = 'Stop'
$envFile = Join-Path $PSScriptRoot '../.env'
$existing = if (Test-Path -LiteralPath $envFile) { [IO.File]::ReadAllText($envFile) } else { '' }
foreach ($key in @('DB_PASSWORD','RABBITMQ_PASSWORD','WORKER_TOKEN')) {
    if ($existing -notmatch "(?m)^$key=") {
        $secretBytes = [byte[]]::new(32)
        $generator = [Security.Cryptography.RandomNumberGenerator]::Create()
        $generator.GetBytes($secretBytes)
        $generator.Dispose()
        $secretValue = [BitConverter]::ToString($secretBytes).Replace('-','').ToLowerInvariant()
        $existing += "`n$key=$secretValue`n"
    }
}
[IO.File]::WriteAllText($envFile,$existing,[Text.UTF8Encoding]::new($false))
Write-Host 'Environment secrets prepared. Existing values were preserved.'
