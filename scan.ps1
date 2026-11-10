$ErrorActionPreference = 'Stop'

$processes = @{}
Get-CimInstance Win32_Process | ForEach-Object {
  $processes[[string]$_.ProcessId] = @{
    name = [string]$_.Name
    executablePath = [string]$_.ExecutablePath
    commandLine = [string]$_.CommandLine
    startedAt = if ($_.CreationDate) { $_.CreationDate.ToUniversalTime().ToString('o') } else { '' }
  }
}
$servicePids = @{}
Get-CimInstance Win32_Service | Where-Object { $_.ProcessId -gt 0 } | ForEach-Object { $servicePids[[string]$_.ProcessId] = $true }

$items = @()
Get-NetTCPConnection -State Listen | ForEach-Object {
  $owner = $processes[[string]$_.OwningProcess]
  $items += [pscustomobject]@{
    protocol = 'TCP'
    address = [string]$_.LocalAddress
    port = [int]$_.LocalPort
    pid = [int]$_.OwningProcess
    processName = if ($owner) { $owner.name } else { '' }
    executablePath = if ($owner) { $owner.executablePath } else { '' }
    commandLine = if ($owner) { $owner.commandLine } else { '' }
    startedAt = if ($owner) { $owner.startedAt } else { '' }
    isService = [bool]$servicePids[[string]$_.OwningProcess]
  }
}
Get-NetUDPEndpoint | ForEach-Object {
  $owner = $processes[[string]$_.OwningProcess]
  $items += [pscustomobject]@{
    protocol = 'UDP'
    address = [string]$_.LocalAddress
    port = [int]$_.LocalPort
    pid = [int]$_.OwningProcess
    processName = if ($owner) { $owner.name } else { '' }
    executablePath = if ($owner) { $owner.executablePath } else { '' }
    commandLine = if ($owner) { $owner.commandLine } else { '' }
    startedAt = if ($owner) { $owner.startedAt } else { '' }
    isService = [bool]$servicePids[[string]$_.OwningProcess]
  }
}

ConvertTo-Json -InputObject @($items) -Depth 3 -Compress
