# =====================================================================
#  Local preview server for the $SLING site.
#  Pure PowerShell — no Node, Python or any other install required.
#  Started by serve.cmd in the project root; Ctrl+C to stop.
# =====================================================================
param([int]$Port = 8080)

$root = Split-Path -Parent $PSScriptRoot
$prefix = "http://localhost:$Port/"

$mime = @{
  ".html" = "text/html; charset=utf-8"
  ".css"  = "text/css; charset=utf-8"
  ".js"   = "application/javascript; charset=utf-8"
  ".mjs"  = "application/javascript; charset=utf-8"
  ".json" = "application/json; charset=utf-8"
  ".jpg"  = "image/jpeg";  ".jpeg" = "image/jpeg"
  ".png"  = "image/png";   ".svg"  = "image/svg+xml"
  ".ico"  = "image/x-icon"; ".webp" = "image/webp"
  ".woff" = "font/woff";   ".woff2" = "font/woff2"
  ".txt"  = "text/plain; charset=utf-8"
}

$listener = New-Object System.Net.HttpListener
try {
  $listener.Prefixes.Add($prefix)
  $listener.Start()
} catch {
  Write-Host ""
  Write-Host "  Could not open port $Port." -ForegroundColor Red
  Write-Host "  Something else may be using it. Try:  powershell -File tools\serve.ps1 -Port 8081"
  Write-Host ""
  Read-Host "  Press Enter to close"
  exit 1
}

Write-Host ""
Write-Host "  THE RETARDED BULL RUN - local preview" -ForegroundColor Yellow
Write-Host "  ------------------------------------------------"
Write-Host "  Site:  $prefix" -ForegroundColor Green
Write-Host "  Game:  ${prefix}game.html" -ForegroundColor Green
Write-Host "  ------------------------------------------------"
Write-Host "  Serving: $root"
Write-Host "  Press Ctrl+C in this window to stop."
Write-Host ""

Start-Process $prefix

while ($listener.IsListening) {
  try {
    $ctx = $listener.GetContext()
    $path = [System.Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath)
    if ($path -eq "/") { $path = "/index.html" }

    $rel = ($path -replace '^/','') -replace '/','\'
    $file = Join-Path $root $rel

    # keep requests inside the project folder
    $full = [System.IO.Path]::GetFullPath($file)
    $rootFull = [System.IO.Path]::GetFullPath($root)
    if (-not $full.StartsWith($rootFull, [System.StringComparison]::OrdinalIgnoreCase)) {
      $ctx.Response.StatusCode = 403
      $ctx.Response.OutputStream.Close()
      continue
    }

    if (Test-Path -LiteralPath $full -PathType Leaf) {
      $ext = [System.IO.Path]::GetExtension($full).ToLower()
      $ct = $mime[$ext]
      if (-not $ct) { $ct = "application/octet-stream" }
      $bytes = [System.IO.File]::ReadAllBytes($full)
      $ctx.Response.ContentType = $ct
      $ctx.Response.Headers.Add("Cache-Control", "no-cache")
      $ctx.Response.ContentLength64 = $bytes.Length
      $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
      Write-Host ("  200  " + $path)
    } else {
      $ctx.Response.StatusCode = 404
      $b = [System.Text.Encoding]::UTF8.GetBytes("404 - $path")
      $ctx.Response.ContentType = "text/plain; charset=utf-8"
      $ctx.Response.OutputStream.Write($b, 0, $b.Length)
      Write-Host ("  404  " + $path) -ForegroundColor DarkYellow
    }
    $ctx.Response.OutputStream.Close()
  } catch {
    # a browser closing a connection mid-response is normal; keep serving
  }
}
