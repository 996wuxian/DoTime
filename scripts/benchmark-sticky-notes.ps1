param(
    [Parameter(Mandatory = $true)][string]$Executable,
    [Parameter(Mandatory = $true)][string]$OutputDirectory,
    [int[]]$Counts = @(1, 5, 10, 20)
)
$ErrorActionPreference = 'Stop'
$executablePath = (Resolve-Path -LiteralPath $Executable).Path
$sdkRoot = (Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows Kits\Installed Roots').KitsRoot10
$manifestTool = Get-ChildItem -Path (Join-Path $sdkRoot 'bin\*\x64\mt.exe') | Sort-Object FullName -Descending | Select-Object -First 1 -ExpandProperty FullName
if (-not $manifestTool) { throw 'Windows SDK mt.exe is required for the example executable manifest' }
& $manifestTool -nologo -manifest (Join-Path $PSScriptRoot '../src-tauri/examples/sticky_notes_stress.manifest') "-outputresource:$executablePath;#1"
if ($LASTEXITCODE -ne 0) { throw 'Could not embed the Common Controls v6 manifest' }
$outputPath = [IO.Path]::GetFullPath($OutputDirectory)
New-Item -ItemType Directory -Force -Path $outputPath | Out-Null
$logicalProcessors = [Environment]::ProcessorCount
$results = @()
foreach ($count in $Counts) {
    $casePath = Join-Path $outputPath "notes-$count"
    if (Test-Path -LiteralPath $casePath) { throw "Use a new output directory; the fixture never overwrites an existing case: $casePath" }
    New-Item -ItemType Directory -Path $casePath | Out-Null
    $env:DOTIME_BENCH_DIR = $casePath
    $env:DOTIME_BENCH_COUNT = "$count"
    $process = Start-Process -FilePath $executablePath -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $casePath 'stdout.log') -RedirectStandardError (Join-Path $casePath 'stderr.log')
    $samples = @()
    $previousCpu = @{}
    $previousTime = [DateTime]::UtcNow
    $deadline = [DateTime]::UtcNow.AddSeconds(140)
    try {
        while (-not $process.HasExited) {
            if ([DateTime]::UtcNow -gt $deadline) { throw "Benchmark timed out: $count notes" }
            $processRows = @(Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId, KernelModeTime, UserModeTime)
            $cpuTimes = @{}
            foreach ($row in $processRows) { $cpuTimes["$($row.ProcessId)"] = ([double]$row.KernelModeTime + [double]$row.UserModeTime) / 10000000 }
            $ids = [Collections.Generic.HashSet[int]]::new()
            $null = $ids.Add($process.Id)
            do {
                $added = $false
                foreach ($row in $processRows) {
                    if ($ids.Contains([int]$row.ParentProcessId) -and $ids.Add([int]$row.ProcessId)) { $added = $true }
                }
            } while ($added)
            $cpuDelta = 0.0
            $privateBytes = 0L
            $workingSetBytes = 0L
            $alive = 0
            $nextCpu = @{}
            foreach ($processId in $ids) {
                $child = Get-Process -Id $processId -ErrorAction SilentlyContinue
                if (-not $child) { continue }
                $cpuKey = "$processId"
                $cpu = $cpuTimes[$cpuKey]
                if ($previousCpu.ContainsKey($cpuKey)) { $cpuDelta += [Math]::Max(0.0, [double]($cpu - $previousCpu[$cpuKey])) }
                $nextCpu[$cpuKey] = $cpu
                $privateBytes += $child.PrivateMemorySize64
                $workingSetBytes += $child.WorkingSet64
                $alive++
            }
            $now = [DateTime]::UtcNow
            $seconds = ($now - $previousTime).TotalSeconds
            $previousCpu = $nextCpu
            $previousTime = $now
            $phasePath = Join-Path $casePath 'phase.txt'
            $phase = if (Test-Path -LiteralPath $phasePath) { [IO.File]::ReadAllText($phasePath) } else { 'startup' }
            $sample = [PSCustomObject]@{
                phase = $phase; privateMB = [Math]::Round($privateBytes / 1MB, 2); workingSetMB = [Math]::Round($workingSetBytes / 1MB, 2)
                cpuOneCorePercent = [Math]::Round(100 * $cpuDelta / [Math]::Max(.01, $seconds), 2)
                cpuMachinePercent = [Math]::Round(100 * $cpuDelta / [Math]::Max(.01, $seconds) / $logicalProcessors, 2)
                processCount = $alive
            }
            $samples += $sample
            if ($privateBytes -gt 2GB) { throw 'Fixture exceeded the 2 GiB private-memory safety limit' }
            Start-Sleep -Milliseconds 700
            $process.Refresh()
        }
        if ($process.ExitCode -ne 0) { throw "Benchmark process failed: $($process.ExitCode). See $casePath" }
    } finally {
        $samples | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $casePath 'samples.json') -Encoding utf8
        if (-not $process.HasExited) {
            foreach ($processId in $ids) { Stop-Process -Id $processId -ErrorAction SilentlyContinue }
        }
        Remove-Item Env:DOTIME_BENCH_DIR -ErrorAction SilentlyContinue
        Remove-Item Env:DOTIME_BENCH_COUNT -ErrorAction SilentlyContinue
    }
    $phases = @{}
    foreach ($phase in @('idle', 'editing', 'settled', 'half-closed')) {
        $phaseSamples = @($samples | Where-Object phase -eq $phase)
        if ($phaseSamples.Count -eq 0) { throw "No samples for phase $phase" }
        $phases[$phase] = [PSCustomObject]@{
            meanPrivateMB = [Math]::Round(($phaseSamples | Measure-Object privateMB -Average).Average, 2)
            lastPrivateMB = $phaseSamples[-1].privateMB
            meanCpuMachinePercent = [Math]::Round(($phaseSamples | Measure-Object cpuMachinePercent -Average).Average, 2)
            peakCpuMachinePercent = ($phaseSamples | Measure-Object cpuMachinePercent -Maximum).Maximum
            samples = $phaseSamples.Count
        }
    }
    $result = [PSCustomObject]@{ count = $count; startupMs = [int]([IO.File]::ReadAllText((Join-Path $casePath 'startup-ms.txt'))); phases = $phases; samples = $samples }
    $results += $result
    $results | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $outputPath 'results.json') -Encoding utf8
    Write-Output ($result | Select-Object count, startupMs, phases | ConvertTo-Json -Depth 5 -Compress)
}
