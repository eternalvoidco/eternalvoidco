<#
.SYNOPSIS
  Builds the finished ETERNAL VOID video from the After Effects template.

.DESCRIPTION
  1. Inventories the asset folder (template, emblem, instructions, preview video).
  2. Locates the newest installed After Effects + aerender (+ ffmpeg if present).
  3. Runs ev_customise.jsx inside After Effects: opens the .aet as a new project,
     swaps the logo placeholder for the original EV emblem, sets the website to
     "eternalvoid.co" and brand text to "ETERNAL VOID", checks footage/fonts/plugins,
     saves ETERNAL-VOID.aep and queues the render.
  4. Renders with aerender, encodes ETERNAL-VOID-Final.mp4 (H.264, CRF 14, yuv420p, BT.709,
     AAC 320k audio if the template has audio).
  5. Verifies resolution / fps / frame count / duration and extracts check frames.

  The .aet template and source assets are only read, never written (SHA-256 verified).

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\Run-EternalVoid.ps1 -InspectOnly
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\Run-EternalVoid.ps1 -Logo "C:\...\EV emblem.png"
#>
[CmdletBinding()]
param(
    [string]$AssetDir = 'C:\Eternalvoidco\Eternalvoidco\assets\After Effects Assets',
    [string]$Template,
    [string]$Logo,
    [string]$LogoTarget,
    [string]$RenderComp,
    [ValidateSet('Original', 'White')][string]$LogoColor = 'Original',
    [string]$AfterEffects,
    [string]$Ffmpeg,
    [int]$Crf = 14,
    [switch]$InspectOnly,
    [switch]$HideOtherPlaceholders,
    [switch]$EnableScriptFileAccess,
    [switch]$SkipRender,
    [int]$TimeoutMinutes = 60
)

$ErrorActionPreference = 'Stop'
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Jsx = Join-Path $ScriptDir 'ev_customise.jsx'
$OutDir = Join-Path $AssetDir 'ETERNAL VOID Output'
$Report = New-Object System.Collections.Generic.List[string]

function Say([string]$m) { Write-Host $m; $Report.Add($m) }
function Fail([string]$m) {
    Write-Host "STOPPED: $m" -ForegroundColor Red
    $Report.Add("STOPPED: $m")
    if (Test-Path $OutDir) { $Report | Set-Content -Encoding UTF8 (Join-Path $OutDir 'VERIFY-REPORT.txt') }
    exit 2
}

# ---------------------------------------------------------------- 1. inventory
if (-not (Test-Path -LiteralPath $AssetDir)) { Fail "Asset folder not found: $AssetDir" }
if (-not (Test-Path -LiteralPath $Jsx)) { Fail "ev_customise.jsx not found next to this script." }
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

Say "ETERNAL VOID build  $(Get-Date -Format s)"
Say "Asset folder: $AssetDir"
$files = Get-ChildItem -LiteralPath $AssetDir -Recurse -File | Where-Object { $_.FullName -notlike "$OutDir*" }
$files | Select-Object FullName, Length, LastWriteTime | Format-Table -AutoSize | Out-String -Width 400 |
    Set-Content -Encoding UTF8 (Join-Path $OutDir 'asset-inventory.txt')

$aet   = @($files | Where-Object Extension -eq '.aet')
$imgs  = @($files | Where-Object { $_.Extension -match '^\.(png|psd|ai|eps|svg|tif|tiff|pdf)$' })
$docs  = @($files | Where-Object { $_.Extension -match '^\.(txt|md|rtf|pdf|docx?|html?|url)$' })
$vids  = @($files | Where-Object { $_.Extension -match '^\.(mp4|mov|avi|mkv|webm|gif)$' })
$fontf = @($files | Where-Object { $_.Extension -match '^\.(ttf|otf|ttc)$' })
Say ""
Say "Templates (.aet): $($aet.Count)";      $aet   | ForEach-Object { Say "  $($_.FullName)" }
Say "Images / logos:  $($imgs.Count)";      $imgs  | ForEach-Object { Say "  $($_.FullName)" }
Say "Instructions:    $($docs.Count)";      $docs  | ForEach-Object { Say "  $($_.FullName)" }
Say "Preview videos:  $($vids.Count)";      $vids  | ForEach-Object { Say "  $($_.FullName)" }
Say "Bundled fonts:   $($fontf.Count)";     $fontf | ForEach-Object { Say "  $($_.FullName)" }

# Dump readable instructions so they are kept with the build record.
foreach ($d in $docs | Where-Object { $_.Extension -match '^\.(txt|md|html?|url)$' }) {
    Say ""
    Say "----- $($d.Name) -----"
    Get-Content -LiteralPath $d.FullName -TotalCount 200 | ForEach-Object { Say "  $_" }
}
if ($fontf.Count) {
    Say ""
    Say "NOTE: the template ships font files. Install them (right-click > Install for all users) BEFORE running, or After Effects will report them missing."
}

# Emblem pre-check (alpha / size) using System.Drawing for raster files.
function Test-Emblem([string]$path) {
    if ($path -notmatch '\.(png|tif|tiff)$') { Say "Emblem: $path (vector/layered file, alpha checked inside AE)"; return }
    Add-Type -AssemblyName System.Drawing
    $bmp = [System.Drawing.Bitmap]::FromFile($path)
    try {
        $hasAlpha = [System.Drawing.Image]::IsAlphaPixelFormat($bmp.PixelFormat)
        $step = [Math]::Max(1, [int]([Math]::Sqrt($bmp.Width * $bmp.Height / 40000)))
        $opaque = 0; $partial = 0; $lum = 0.0; $n = 0
        for ($y = 0; $y -lt $bmp.Height; $y += $step) {
            for ($x = 0; $x -lt $bmp.Width; $x += $step) {
                $c = $bmp.GetPixel($x, $y); $n++
                if ($c.A -gt 0) { if ($c.A -lt 255) { $partial++ } else { $opaque++ }
                    $lum += 0.2126 * $c.R + 0.7152 * $c.G + 0.0722 * $c.B }
            }
        }
        $vis = $opaque + $partial
        $meanLum = if ($vis) { [Math]::Round($lum / $vis) } else { 0 }
        Say ("Emblem: {0}  {1}x{2}  alpha={3}  coverage={4:P1}  mean luminance={5}/255" -f $path, $bmp.Width, $bmp.Height, $hasAlpha, ($vis / $n), $meanLum)
        if (-not $hasAlpha) { Fail "The emblem has no alpha channel. Supply the clean transparent original with -Logo." }
        if ($meanLum -lt 128 -and $LogoColor -eq 'Original') {
            Say "  NOTE: emblem is dark. If the template background is dark, re-run with -LogoColor White."
        }
    } finally { $bmp.Dispose() }
}
if ($Logo) {
    if (-not (Test-Path -LiteralPath $Logo)) { Fail "Logo not found: $Logo" }
    $Logo = (Resolve-Path -LiteralPath $Logo).Path
    Test-Emblem $Logo
}

# Fingerprint sources so we can prove they were not modified.
$srcHashes = @{}
foreach ($f in @($aet) + @($imgs)) { $srcHashes[$f.FullName] = (Get-FileHash -LiteralPath $f.FullName -Algorithm SHA256).Hash }

# ---------------------------------------------------------------- 2. tools
function Find-AE {
    if ($AfterEffects) { return Get-Item -LiteralPath $AfterEffects }
    $roots = @("$env:ProgramFiles\Adobe", "${env:ProgramFiles(x86)}\Adobe") | Where-Object { $_ -and (Test-Path $_) }
    $found = foreach ($r in $roots) {
        Get-ChildItem -LiteralPath $r -Directory -Filter 'Adobe After Effects*' -ErrorAction SilentlyContinue |
            ForEach-Object { Join-Path $_.FullName 'Support Files\AfterFX.exe' } |
            Where-Object { Test-Path -LiteralPath $_ } | ForEach-Object { Get-Item -LiteralPath $_ }
    }
    $found | Sort-Object { [version]('{0}.{1}.{2}' -f $_.VersionInfo.FileMajorPart, $_.VersionInfo.FileMinorPart, $_.VersionInfo.FileBuildPart) } -Descending |
        Select-Object -First 1
}
$ae = Find-AE
if (-not $ae) { Fail "After Effects not found under Program Files\Adobe. Pass -AfterEffects 'C:\...\Support Files\AfterFX.exe'." }
$aeVer = $ae.VersionInfo
$aerender = Join-Path $ae.DirectoryName 'aerender.exe'
Say ""
Say "After Effects: $($ae.FullName)  version $($aeVer.ProductVersion)"
if (-not (Test-Path -LiteralPath $aerender)) { Fail "aerender.exe not found next to AfterFX.exe." }

function Find-Tool([string]$name, [string]$explicit) {
    if ($explicit) { if (Test-Path -LiteralPath $explicit) { return (Resolve-Path -LiteralPath $explicit).Path } else { Fail "$name not found: $explicit" } }
    $cmd = Get-Command $name -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    $guess = @("C:\ffmpeg\bin\$name.exe", "$env:ProgramFiles\ffmpeg\bin\$name.exe", "$env:LOCALAPPDATA\Microsoft\WinGet\Links\$name.exe",
               "$env:USERPROFILE\scoop\shims\$name.exe", "C:\ProgramData\chocolatey\bin\$name.exe")
    foreach ($g in $guess) { if (Test-Path -LiteralPath $g) { return $g } }
    return $null
}
$ffmpegExe = Find-Tool 'ffmpeg' $Ffmpeg
$ffprobeExe = $null
if ($ffmpegExe) {
    $p = Join-Path (Split-Path $ffmpegExe) 'ffprobe.exe'
    $ffprobeExe = if (Test-Path -LiteralPath $p) { $p } else { Find-Tool 'ffprobe' $null }
}
Say ("ffmpeg: " + $(if ($ffmpegExe) { $ffmpegExe } else { 'not found -> After Effects native H.264 export will be used (AE 2023+ required)' }))

if (Get-Process -Name 'AfterFX' -ErrorAction SilentlyContinue) { Fail "After Effects is running. Save your work, close it, and run again." }

# ---------------------------------------------------------------- 3. scripting permission
$prefRoot = Join-Path $env:APPDATA 'Adobe\After Effects'
$prefFiles = @()
if (Test-Path $prefRoot) {
    $verDir = '{0}.{1}' -f $aeVer.FileMajorPart, $aeVer.FileMinorPart
    $prefFiles = @(Get-ChildItem -LiteralPath $prefRoot -Recurse -Filter 'Adobe After Effects * Prefs.txt' -ErrorAction SilentlyContinue |
        Where-Object { $_.DirectoryName -like "*\$verDir" -or $_.DirectoryName -like "*\$($aeVer.FileMajorPart).*" })
}
$key = '"Pref_SCRIPTING_FILE_NETWORK_SECURITY"'
foreach ($pf in $prefFiles) {
    $txt = Get-Content -LiteralPath $pf.FullName -Raw
    if ($txt -match [regex]::Escape($key) + '\s*=\s*"1"') { Say "Scripting file access: ON ($($pf.Name))"; continue }
    if ($EnableScriptFileAccess) {
        Copy-Item -LiteralPath $pf.FullName "$($pf.FullName).ev-backup" -Force
        if ($txt -match [regex]::Escape($key)) {
            $txt = [regex]::Replace($txt, [regex]::Escape($key) + '\s*=\s*"\d"', "$key = `"1`"")
        } else {
            $txt = $txt -replace '(\["Main Pref Section v2"\]\r?\n)', "`$1`t$key = `"1`"`r`n"
        }
        Set-Content -LiteralPath $pf.FullName -Value $txt -Encoding UTF8 -NoNewline
        Say "Scripting file access enabled in $($pf.FullName) (backup *.ev-backup)."
    } else {
        Say "WARNING: 'Allow Scripts to Write Files and Access Network' appears OFF. Enable it in AE (Preferences > Scripting & Expressions) or re-run with -EnableScriptFileAccess."
    }
}

# ---------------------------------------------------------------- 4. run the JSX in After Effects
$renderMode = if ($SkipRender -or $InspectOnly) { 'none' } elseif ($ffmpegExe) { 'intermediate' } else { 'h264' }
$env:EV_ASSET_DIR   = $AssetDir
$env:EV_OUT_DIR     = $OutDir
$env:EV_TEMPLATE    = $Template
$env:EV_LOGO        = $Logo
$env:EV_LOGO_TARGET = $LogoTarget
$env:EV_LOGO_COLOR  = $LogoColor.ToLower()
$env:EV_RENDER_COMP = $RenderComp
$env:EV_RENDER_MODE = $renderMode
$env:EV_HIDE_UNKNOWN = $(if ($HideOtherPlaceholders) { '1' } else { '0' })
$env:EV_DRY_RUN     = $(if ($InspectOnly) { '1' } else { '0' })
$env:EV_QUIT        = '1'

$logFile = Join-Path $OutDir 'ev-customise-log.txt'
$manFile = Join-Path $OutDir 'ev-manifest.txt'
Remove-Item -LiteralPath $logFile, $manFile -ErrorAction SilentlyContinue

Say ""
Say "Running ev_customise.jsx in After Effects (this opens AE; it closes itself when done)..."
$proc = Start-Process -FilePath $ae.FullName -ArgumentList @('-r', "`"$Jsx`"") -PassThru
if (-not $proc.WaitForExit($TimeoutMinutes * 60 * 1000)) { Fail "After Effects did not finish within $TimeoutMinutes minutes. Check it for an open dialog." }
Start-Sleep -Seconds 2

if (-not (Test-Path -LiteralPath $logFile)) {
    Fail "The JSX wrote no log. Most likely 'Allow Scripts to Write Files and Access Network' is OFF (re-run with -EnableScriptFileAccess), or AE showed a dialog. Alternatively run ev_customise.jsx via File > Scripts > Run Script File."
}
$man = @{}
Get-Content -LiteralPath $manFile | ForEach-Object { $k, $v = $_ -split '=', 2; $man[$k] = $v }
Get-Content -LiteralPath $logFile -TotalCount 60 | ForEach-Object { Say "  | $_" }
if ($man['status'] -ne 'OK') { Fail "After Effects step reported blockers - see $logFile" }
if ($InspectOnly) { Say "Inspection complete. Review $logFile"; $Report | Set-Content -Encoding UTF8 (Join-Path $OutDir 'VERIFY-REPORT.txt'); exit 0 }
if ($SkipRender) { Say "Project saved; render skipped."; exit 0 }

# ---------------------------------------------------------------- 5. render
$aep = Join-Path $OutDir 'ETERNAL-VOID.aep'
$final = Join-Path $OutDir 'ETERNAL-VOID-Final.mp4'
$renderOut = $man['render_output']
$renderLog = Join-Path $OutDir 'aerender-log.txt'
if (Test-Path -LiteralPath $renderOut) { Remove-Item -LiteralPath $renderOut }
Say ""
Say "Rendering with aerender -> $renderOut"
& $aerender -project $aep 2>&1 | Tee-Object -FilePath $renderLog | Out-Host
$rc = $LASTEXITCODE
if ($rc -ne 0 -or -not (Test-Path -LiteralPath $renderOut)) { Fail "aerender failed (exit $rc). See $renderLog" }
if (Select-String -LiteralPath $renderLog -Pattern 'aerender ERROR|Unable to Render|missing' -Quiet) {
    Say "WARNING: aerender log mentions errors/missing items - review $renderLog"
}

# ---------------------------------------------------------------- 6. encode
if ($renderMode -eq 'intermediate') {
    if ([int]$man['width'] % 2 -or [int]$man['height'] % 2) { Fail "Odd frame size $($man['width'])x$($man['height']) cannot be encoded as 4:2:0 H.264 without changing resolution." }
    Say "Encoding H.264 -> $final"
    $ffArgs = @('-hide_banner', '-y', '-i', $renderOut, '-map', '0:v:0', '-map', '0:a?',
        '-c:v', 'libx264', '-preset', 'slow', '-crf', "$Crf", '-profile:v', 'high',
        '-vf', 'scale=out_color_matrix=bt709:out_range=tv,format=yuv420p',
        '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709',
        '-c:a', 'aac', '-b:a', '320k', '-movflags', '+faststart', $final)
    & $ffmpegExe @ffArgs 2>&1 | Tee-Object -FilePath (Join-Path $OutDir 'ffmpeg-log.txt') | Out-Null
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $final)) { Fail "ffmpeg encode failed. See ffmpeg-log.txt" }
} elseif ($renderOut -ne $final) {
    Move-Item -LiteralPath $renderOut $final -Force
}

# ---------------------------------------------------------------- 7. verify
Say ""
Say "== VERIFICATION"
$expW = [int]$man['width']; $expH = [int]$man['height']; $expFps = [double]$man['fps']
$expDur = [double]$man['duration']; $expFrames = [int]$man['frames']
Say ("Template comp '{0}': {1}x{2} @ {3} fps, {4:N3}s ({5} frames), audio={6}" -f $man['comp'], $expW, $expH, $expFps, $expDur, $expFrames, $man['has_audio'])

if ($ffprobeExe) {
    $probe = & $ffprobeExe -v error -count_frames -show_entries 'stream=codec_type,codec_name,width,height,r_frame_rate,nb_read_frames,pix_fmt:format=duration' -of json $final | ConvertFrom-Json
    $v = $probe.streams | Where-Object codec_type -eq 'video' | Select-Object -First 1
    $a = $probe.streams | Where-Object codec_type -eq 'audio' | Select-Object -First 1
    $num, $den = $v.r_frame_rate -split '/'; $fps = [double]$num / [double]$den
    $dur = [double]$probe.format.duration
    Say ("Output: {0}x{1} {2} {3} @ {4:N3} fps, {5:N3}s, {6} frames, audio={7}" -f $v.width, $v.height, $v.codec_name, $v.pix_fmt, $fps, $dur, $v.nb_read_frames, $(if ($a) { $a.codec_name } else { 'none' }))
    $checks = @(
        @('Resolution matches', ($v.width -eq $expW -and $v.height -eq $expH)),
        @('Frame rate matches', ([Math]::Abs($fps - $expFps) -lt 0.01)),
        @('Frame count matches', ([int]$v.nb_read_frames -eq $expFrames)),
        @('Audio preserved', (($man['has_audio'] -eq '1') -eq [bool]$a))
    )
    foreach ($c in $checks) { Say ("  [{0}] {1}" -f $(if ($c[1]) { 'PASS' } else { 'FAIL' }), $c[0]) }

    $vf = Join-Path $OutDir 'verify-frames'
    New-Item -ItemType Directory -Force -Path $vf | Out-Null
    $marks = [ordered]@{ '01-opening' = 0; '02-25pct' = [int]($expFrames * 0.25); '03-50pct' = [int]($expFrames * 0.5);
                         '04-75pct' = [int]($expFrames * 0.75); '05-90pct' = [int]($expFrames * 0.9); '06-ending' = $expFrames - 1 }
    foreach ($k in $marks.Keys) {
        $t = '{0:F4}' -f ($marks[$k] / $expFps)
        & $ffmpegExe -hide_banner -v error -y -ss $t -i $final -frames:v 1 (Join-Path $vf "$k.png")
    }
    $step = [Math]::Max(1, [int][Math]::Floor($expFrames / 24))
    & $ffmpegExe -hide_banner -v error -y -i $final -vf "select='not(mod(n\,$step))',scale=480:-2,tile=6x4" -fps_mode vfr -frames:v 1 (Join-Path $vf 'contact-sheet.png')
    Say "Check frames: $vf  (open contact-sheet.png to find the logo reveal and website frames)"
} else {
    Say "ffprobe not available - inspect $final manually (resolution/fps/duration in AE: $expW x $expH, $expFps fps, $expDur s)."
}

# Source integrity
$changed = @()
foreach ($k in $srcHashes.Keys) { if ((Get-FileHash -LiteralPath $k -Algorithm SHA256).Hash -ne $srcHashes[$k]) { $changed += $k } }
Say $(if ($changed.Count) { "WARNING: source files changed: $($changed -join ', ')" } else { "[PASS] Template and source images unchanged (SHA-256)." })

# Keep the automation scripts with the deliverables.
$sd = Join-Path $OutDir 'scripts'
New-Item -ItemType Directory -Force -Path $sd | Out-Null
Get-ChildItem -LiteralPath $ScriptDir -File | Where-Object { $_.Extension -match '^\.(jsx|ps1|bat|md)$' } | Copy-Item -Destination $sd -Force

Say ""
Say "Deliverables:"
Say "  $aep"
Say "  $final"
Say "  $sd"
Say "Remaining manual step: open verify-frames\*.png and confirm emblem, 'eternalvoid.co' and 'ETERNAL VOID' visually."
$Report | Set-Content -Encoding UTF8 (Join-Path $OutDir 'VERIFY-REPORT.txt')
