param([string]$PostgresBin='C:\Program Files\PostgreSQL\17\bin')
$ErrorActionPreference='Stop'
$backend=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$run=Join-Path ([IO.Path]::GetTempPath()) ('pms-catalogue-test-'+[Guid]::NewGuid().ToString('N'))
$data=Join-Path $run 'data'
New-Item -ItemType Directory -Path $run | Out-Null
$listener=[Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback,0)
$listener.Start();$port=$listener.LocalEndpoint.Port;$listener.Stop()
$database='pms_lms_test_'+[Guid]::NewGuid().ToString('N')
$oldUrl=$env:PMS_LMS_TEST_URL;$oldData=$env:PMS_TEST_DATA_DIRECTORY
$started=$false
try {
  & (Join-Path $PostgresBin 'initdb.exe') -D $data -U pms_remediation_test_admin -A trust --encoding=UTF8 --locale=C
  if($LASTEXITCODE){throw 'Disposable cluster initialization failed'}
  $arguments='-D "{0}" -l "{1}" -o "-h 127.0.0.1 -p {2} -c max_connections=40" -w -t 30 start' -f $data,(Join-Path $run 'server.log'),$port
  $server=Start-Process -FilePath (Join-Path $PostgresBin 'pg_ctl.exe') -ArgumentList $arguments -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $run 'startup.log') -RedirectStandardError (Join-Path $run 'startup-error.log')
  $serverHandle=$server.Handle
  if(-not $server.WaitForExit(40000) -or $server.ExitCode -ne 0){throw 'Disposable server startup failed'}
  $started=$true
  $actual=& (Join-Path $PostgresBin 'psql.exe') -X -w -h 127.0.0.1 -p $port -U pms_remediation_test_admin -d postgres -Atc 'SHOW data_directory'
  if($LASTEXITCODE -or [IO.Path]::GetFullPath(($actual|Select-Object -Last 1)) -ne [IO.Path]::GetFullPath($data)){throw 'Unexpected PostgreSQL data directory'}
  foreach($testFile in @('pms-catalogue-postgres.cjs','billing-postgres.cjs','plans-settings-postgres.cjs')) {
  $database='pms_lms_test_'+[Guid]::NewGuid().ToString('N')
  & (Join-Path $PostgresBin 'createdb.exe') -w -h 127.0.0.1 -p $port -U pms_remediation_test_admin $database
  if($LASTEXITCODE){throw 'Disposable database creation failed'}
  foreach($migration in (Get-ChildItem (Join-Path $backend 'prisma/migrations') -Directory | Sort-Object Name)) {
    if($testFile -eq 'pms-catalogue-postgres.cjs' -and $migration.Name -eq '20261117000300_pms_plan_catalogue_parity') {
      & (Join-Path $PostgresBin 'psql.exe') -X -w -h 127.0.0.1 -p $port -U pms_remediation_test_admin -d $database -v ON_ERROR_STOP=1 -q -f (Join-Path $backend 'test/pms-catalogue-before-migration.sql')
      if($LASTEXITCODE){throw 'Pre-migration synthetic fixture failed'}
    }
    & (Join-Path $PostgresBin 'psql.exe') -X -w -h 127.0.0.1 -p $port -U pms_remediation_test_admin -d $database -v ON_ERROR_STOP=1 -q -f (Join-Path $migration.FullName 'migration.sql')
    if($LASTEXITCODE){throw "Migration failed: $($migration.Name)"}
  }
  $env:PMS_LMS_TEST_URL="postgresql://pms_remediation_test_admin@127.0.0.1:$port/$database"
  $env:PMS_TEST_DATA_DIRECTORY=$data
  Push-Location $backend
  try {
    & node.exe --test (Join-Path 'test' $testFile)
    if($LASTEXITCODE){throw 'Isolated PostgreSQL regression failed'}
  } finally { Pop-Location }
  }
} finally {
  $env:PMS_LMS_TEST_URL=$oldUrl;$env:PMS_TEST_DATA_DIRECTORY=$oldData
  if($started -or (Test-Path -LiteralPath (Join-Path $data 'postmaster.pid'))){& (Join-Path $PostgresBin 'pg_ctl.exe') -D $data -m fast -w -t 30 stop}
}
