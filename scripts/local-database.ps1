param(
    [ValidateSet('Start', 'Stop')][string]$Action = 'Start',
    [string]$PostgresBin = $env:PG_BIN,
    [string]$JdbcJar = $env:PG_JDBC_JAR
)
$ErrorActionPreference = 'Stop'
$platformRoot = Split-Path -Parent $PSScriptRoot
$repositoryRoot = Split-Path -Parent $platformRoot
$localRoot = Join-Path $platformRoot '.local'
$dataDirectory = Join-Path $localRoot 'postgres'
$environmentFile = Join-Path $platformRoot '.env'

if (-not $PostgresBin) {
    $pgCommand = Get-Command pg_ctl -ErrorAction SilentlyContinue
    if ($pgCommand) { $PostgresBin = Split-Path -Parent $pgCommand.Source }
    else {
        # The PostgreSQL integration tests extract portable binaries here.
        $testBinaryRoot = Join-Path ([IO.Path]::GetTempPath()) 'embedded-pg'
        if (Test-Path -LiteralPath $testBinaryRoot) {
            $candidate = Get-ChildItem -LiteralPath $testBinaryRoot -Directory -Filter 'PG-*' |
                Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName 'bin/pg_ctl.exe') } |
                Sort-Object LastWriteTime -Descending | Select-Object -First 1
            if ($candidate) { $PostgresBin = Join-Path $candidate.FullName 'bin' }
        }
    }
}
if (-not $PostgresBin -or -not (Test-Path -LiteralPath (Join-Path $PostgresBin 'pg_ctl.exe'))) {
    throw 'Install PostgreSQL 17, supply -PostgresBin, or run the backend tests first.'
}
$pgControl = Join-Path $PostgresBin 'pg_ctl.exe'
if ($env:JAVA_HOME) { $env:Path = "$(Join-Path $env:JAVA_HOME 'bin');$PostgresBin;$env:Path" }
if ($Action -eq 'Stop') {
    if (-not (Test-Path -LiteralPath (Join-Path $dataDirectory 'PG_VERSION'))) { throw 'No local database exists.' }
    & $pgControl -D $dataDirectory -m fast -w stop
    if ($LASTEXITCODE -ne 0) { throw 'Could not stop the local database.' }
    return
}

if (-not $env:JAVA_HOME) { throw 'Set JAVA_HOME to a JDK 17+ installation first.' }
$env:Path = "$(Join-Path $env:JAVA_HOME 'bin');$PostgresBin;$env:Path"
if (-not $JdbcJar) {
    $driverRoots = @((Join-Path $repositoryRoot '.tools/m2/org/postgresql/postgresql'),
        (Join-Path $env:USERPROFILE '.m2/repository/org/postgresql/postgresql'))
    foreach ($driverRoot in $driverRoots) {
        if (Test-Path -LiteralPath $driverRoot) {
            $driver = Get-ChildItem -LiteralPath $driverRoot -Recurse -Filter 'postgresql-*.jar' |
                Where-Object { $_.Name -notmatch '(sources|javadoc)' } | Sort-Object FullName -Descending | Select-Object -First 1
            if ($driver) { $JdbcJar = $driver.FullName; break }
        }
    }
}
if (-not $JdbcJar -or -not (Test-Path -LiteralPath $JdbcJar)) { throw 'Run the backend tests first or supply -JdbcJar.' }

function New-LocalSecret {
    $bytes = New-Object byte[] 32
    $random = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $random.GetBytes($bytes) } finally { $random.Dispose() }
    return ([BitConverter]::ToString($bytes)).Replace('-', '').ToLowerInvariant()
}
New-Item -ItemType Directory -Force -Path $localRoot | Out-Null
if (-not (Test-Path -LiteralPath $environmentFile)) {
    Set-Content -LiteralPath $environmentFile -Value @(
        "DB_PASSWORD=$(New-LocalSecret)", 'DB_PORT=5433', 'SERVER_PORT=8081'
    )
}
$settings = @{}
foreach ($line in Get-Content -LiteralPath $environmentFile) {
    if ($line -match '^([A-Z_]+)=(.*)$') { $settings[$Matches[1]] = $Matches[2] }
}
if (-not $settings['DB_PASSWORD']) { throw 'Set DB_PASSWORD in cp-platform/.env.' }
if (-not $settings['LOCAL_DB_ADMIN_PASSWORD']) {
    $settings['LOCAL_DB_ADMIN_PASSWORD'] = New-LocalSecret
    Add-Content -LiteralPath $environmentFile -Value "LOCAL_DB_ADMIN_PASSWORD=$($settings['LOCAL_DB_ADMIN_PASSWORD'])"
}
$port = if ($settings['DB_PORT']) { [int]$settings['DB_PORT'] } else { 5433 }
if ($port -lt 1024 -or $port -gt 65535) { throw 'DB_PORT must be between 1024 and 65535.' }
$env:DB_PORT = [string]$port
$env:DB_URL = "jdbc:postgresql://127.0.0.1:$port/cp_platform"
$env:DB_USERNAME = 'cp_app'
$env:DB_PASSWORD = $settings['DB_PASSWORD']
$env:LOCAL_DB_ADMIN_PASSWORD = $settings['LOCAL_DB_ADMIN_PASSWORD']

if (-not (Test-Path -LiteralPath (Join-Path $dataDirectory 'PG_VERSION'))) {
    $passwordFile = Join-Path $localRoot 'bootstrap-password'
    try {
        Set-Content -LiteralPath $passwordFile -Value $env:LOCAL_DB_ADMIN_PASSWORD -Encoding ASCII
        & (Join-Path $PostgresBin 'initdb.exe') -D $dataDirectory -U cp_local_admin -A scram-sha-256 `
            "--pwfile=$passwordFile" --locale=C -E UTF8
        if ($LASTEXITCODE -ne 0) { throw 'PostgreSQL initialization failed.' }
    } finally {
        if (Test-Path -LiteralPath $passwordFile) { Remove-Item -LiteralPath $passwordFile }
    }
}
& $pgControl -D $dataDirectory status *> $null
if ($LASTEXITCODE -ne 0) {
    $arguments = @('-D', "`"$dataDirectory`"", '-l', "`"$(Join-Path $localRoot 'postgres.log')`"",
        '-o', "`"-h 127.0.0.1 -p $port`"", '-w', 'start')
    $process = Start-Process -FilePath $pgControl -ArgumentList $arguments -WindowStyle Hidden -PassThru
    # Start-Process -Wait also waits for the long-lived PostgreSQL descendant.
    # WaitForExit waits only for pg_ctl, which returns once the server is ready.
    $process.WaitForExit()
    $process.Refresh()
    if ($process.ExitCode -ne 0) { throw "PostgreSQL startup failed. Inspect $localRoot/postgres.log." }
}
& (Join-Path $env:JAVA_HOME 'bin/java.exe') --class-path $JdbcJar (Join-Path $PSScriptRoot 'CreateDatabase.java')
if ($LASTEXITCODE -ne 0) { throw 'Database creation failed. Inspect the local PostgreSQL log.' }
Write-Output "PostgreSQL is listening on 127.0.0.1:$port. Data is stored in cp-platform/.local/postgres."
