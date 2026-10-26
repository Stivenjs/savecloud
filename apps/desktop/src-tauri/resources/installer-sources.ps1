param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('Check', 'Apply', 'Dismiss')]
    [string]$Action,
    [Parameter(Mandatory = $true)]
    [string]$DataRoot,
    [Parameter(Mandatory = $true)]
    [string]$PresetPath,
    [Parameter(Mandatory = $true)]
    [string]$PendingPath
)

$ErrorActionPreference = 'Stop'

function Read-JsonArray {
    param([string]$Path)
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return @() }
    $json = [System.IO.File]::ReadAllText($Path)
    if ([string]::IsNullOrWhiteSpace($json)) { return @() }
    $value = ConvertFrom-Json -InputObject $json
    if ($null -eq $value) { return @() }
    return @($value)
}

function Read-JsonObject {
    param([string]$Path)
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $null }
    $json = [System.IO.File]::ReadAllText($Path)
    if ([string]::IsNullOrWhiteSpace($json)) { return $null }
    return ConvertFrom-Json -InputObject $json
}

function Write-JsonAtomic {
    param([string]$Path, [object]$Value)
    $directory = Split-Path -Parent $Path
    [System.IO.Directory]::CreateDirectory($directory) | Out-Null
    $temporaryPath = "$Path.$PID.tmp"
    $json = ConvertTo-Json -InputObject $Value -Depth 32
    $encoding = [System.Text.UTF8Encoding]::new($false)
    [System.IO.File]::WriteAllText($temporaryPath, $json, $encoding)
    if (Test-Path -LiteralPath $Path -PathType Leaf) {
        $backupPath = "$Path.$PID.bak"
        [System.IO.File]::Replace($temporaryPath, $Path, $backupPath)
        if (Test-Path -LiteralPath $backupPath -PathType Leaf) {
            Remove-Item -LiteralPath $backupPath -Force
        }
    }
    else {
        [System.IO.File]::Move($temporaryPath, $Path)
    }
}

function Resolve-RemoteSourcesPath {
    param([string]$Root)
    $indexPaths = @(
        (Join-Path (Join-Path $Root 'core') 'profiles.json'),
        (Join-Path $Root 'profiles.json')
    )
    foreach ($indexPath in $indexPaths) {
        if (-not (Test-Path -LiteralPath $indexPath -PathType Leaf)) { continue }
        try {
            $index = Read-JsonObject -Path $indexPath
            $activeId = [string]$index.activeProfileId
            $activeProfile = @($index.profiles) |
                Where-Object { [string]$_.id -eq $activeId } |
                Select-Object -First 1
            if (
                -not [string]::IsNullOrWhiteSpace($activeId) -and
                [System.IO.Path]::GetFileName($activeId) -eq $activeId -and
                $null -ne $activeProfile
            ) {
                $profileSourcesPath = Join-Path (Join-Path (Join-Path $Root 'profiles') $activeId) 'remote_sources.json'
                if (Test-Path -LiteralPath $profileSourcesPath -PathType Leaf) {
                    return $profileSourcesPath
                }

                if ($activeId -eq 'config-default') {
                    $legacySourcesPath = Join-Path (Join-Path $Root 'cache') 'remote_sources.json'
                    if (Test-Path -LiteralPath $legacySourcesPath -PathType Leaf) {
                        return $legacySourcesPath
                    }
                }

                return $profileSourcesPath
            }
        }
        catch {
            # Fall back to the legacy default-profile path if its index is unreadable.
        }
    }
    return Join-Path (Join-Path $Root 'cache') 'remote_sources.json'
}

function Normalize-SourceUrl {
    param([string]$Url)
    if ([string]::IsNullOrWhiteSpace($Url)) { return '' }
    try { return ([System.Uri]$Url).AbsoluteUri.TrimEnd('/') }
    catch { return $Url.Trim().TrimEnd('/') }
}

function Add-KnownSource {
    param([hashtable]$Ids, [hashtable]$Urls, [object]$Source)
    $id = [string]$Source.id
    if (-not [string]::IsNullOrWhiteSpace($id)) { $Ids[$id] = $true }
    $url = Normalize-SourceUrl -Url ([string]$Source.url)
    if (-not [string]::IsNullOrWhiteSpace($url)) { $Urls[$url] = $true }
}

function Get-SourceIdSet {
    param([object[]]$Sources)
    $ids = @{}
    foreach ($source in $Sources) {
        $id = [string]$source.id
        if (-not [string]::IsNullOrWhiteSpace($id)) { $ids[$id] = $true }
    }
    return $ids
}

try {
    $root = [System.IO.Path]::GetFullPath($DataRoot)
    $remotePath = Resolve-RemoteSourcesPath -Root $root
    $promptedPath = Join-Path (Join-Path $root 'core') 'verified_sources_prompted.json'
    $presets = @(Read-JsonArray -Path $PresetPath)
    $existing = @(Read-JsonArray -Path $remotePath)
    $promptedMarker = Read-JsonObject -Path $promptedPath
    $promptedIds = Get-SourceIdSet -Sources @($promptedMarker.sourceIds)

    if ($Action -eq 'Check') {
        $knownIds = @{}
        $knownUrls = @{}
        foreach ($source in $existing) {
            Add-KnownSource -Ids $knownIds -Urls $knownUrls -Source $source
        }

        $pending = [System.Collections.Generic.List[object]]::new()
        foreach ($preset in $presets) {
            $id = [string]$preset.id
            $url = Normalize-SourceUrl -Url ([string]$preset.url)
            $installed = (
                (-not [string]::IsNullOrWhiteSpace($id) -and $knownIds.ContainsKey($id)) -or
                (-not [string]::IsNullOrWhiteSpace($url) -and $knownUrls.ContainsKey($url))
            )
            if ($installed) {
                if (-not [string]::IsNullOrWhiteSpace($id)) { $promptedIds[$id] = $true }
            }
            elseif (-not [string]::IsNullOrWhiteSpace($id) -and -not $promptedIds.ContainsKey($id)) {
                [void]$pending.Add($preset)
            }
        }

        Write-JsonAtomic -Path $promptedPath -Value ([PSCustomObject]@{
            sourceIds = @($promptedIds.Keys | Sort-Object)
        })
        if ($pending.Count -eq 0) {
            if (Test-Path -LiteralPath $PendingPath -PathType Leaf) {
                Remove-Item -LiteralPath $PendingPath -Force
            }
            exit 0
        }
        Write-JsonAtomic -Path $PendingPath -Value @($pending.ToArray())
        exit 10
    }

    $pending = @(Read-JsonArray -Path $PendingPath)
    if ($Action -eq 'Dismiss') {
        foreach ($source in $pending) {
            $id = [string]$source.id
            if (-not [string]::IsNullOrWhiteSpace($id)) { $promptedIds[$id] = $true }
        }
        Write-JsonAtomic -Path $promptedPath -Value ([PSCustomObject]@{
            sourceIds = @($promptedIds.Keys | Sort-Object)
        })
        if (Test-Path -LiteralPath $PendingPath -PathType Leaf) {
            Remove-Item -LiteralPath $PendingPath -Force
        }
        exit 0
    }

    if ($Action -eq 'Apply') {
        $knownIds = @{}
        $knownUrls = @{}
        foreach ($source in $existing) {
            Add-KnownSource -Ids $knownIds -Urls $knownUrls -Source $source
        }

        $merged = [System.Collections.Generic.List[object]]::new()
        foreach ($source in $existing) { [void]$merged.Add($source) }
        foreach ($source in $pending) {
            $id = [string]$source.id
            $url = Normalize-SourceUrl -Url ([string]$source.url)
            $installed = (
                (-not [string]::IsNullOrWhiteSpace($id) -and $knownIds.ContainsKey($id)) -or
                (-not [string]::IsNullOrWhiteSpace($url) -and $knownUrls.ContainsKey($url))
            )
            if (-not $installed) {
                $source | Add-Member -NotePropertyName enabled -NotePropertyValue $true -Force
                [void]$merged.Add($source)
                Add-KnownSource -Ids $knownIds -Urls $knownUrls -Source $source
            }
            if (-not [string]::IsNullOrWhiteSpace($id)) { $promptedIds[$id] = $true }
        }

        Write-JsonAtomic -Path $remotePath -Value @($merged.ToArray())
        Write-JsonAtomic -Path $promptedPath -Value ([PSCustomObject]@{
            sourceIds = @($promptedIds.Keys | Sort-Object)
        })
        if (Test-Path -LiteralPath $PendingPath -PathType Leaf) {
            Remove-Item -LiteralPath $PendingPath -Force
        }
        exit 0
    }
}
catch {
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 1
}
