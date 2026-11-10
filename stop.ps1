param(
  [Parameter(Mandatory=$true)][int]$TargetPid,
  [Parameter(Mandatory=$true)][string]$ExpectedName,
  [Parameter(Mandatory=$true)][string]$ExpectedStartedAt
)
$ErrorActionPreference = 'Stop'
$owner = Get-CimInstance Win32_Process -Filter "ProcessId = $TargetPid"
if (-not $owner) { throw 'The application has already stopped.' }
if ($owner.Name -ne $ExpectedName -or $owner.CreationDate.ToUniversalTime().ToString('o') -ne $ExpectedStartedAt) {
  throw 'The process changed. Refresh the port list and try again.'
}
$service = Get-CimInstance Win32_Service -Filter "ProcessId = $TargetPid"
if ($service) { throw 'Windows services cannot be stopped from Portkeeper.' }
Stop-Process -Id $TargetPid -ErrorAction Stop
