# Phase 1 Validation Script — Overtaxed Platform
# Run against production: https://www.overtaxed-il.com
# Requires: CRON_SECRET and ADMIN_SECRET from Vercel env vars

param(
    [string]$CronSecret = $env:CRON_SECRET,
    [string]$AdminSecret = $env:ADMIN_SECRET,
    [string]$TestEmail = "",
    [switch]$SkipCron,
    [switch]$SkipAdmin
)

$baseUrl = "https://www.overtaxed-il.com"
$passed = 0
$failed = 0

function Test-Step {
    param([string]$Name, [scriptblock]$Test)
    Write-Host "`n--- $Name ---" -ForegroundColor Cyan
    try {
        & $Test
        Write-Host "PASS: $Name" -ForegroundColor Green
        $script:passed++
        return $true
    } catch {
        Write-Host "FAIL: $Name - $_" -ForegroundColor Red
        $script:failed++
        return $false
    }
}

Write-Host "`n========================================" -ForegroundColor Yellow
Write-Host " Phase 1 Validation — Overtaxed IL" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Yellow

# 1. Site reachability
Test-Step "Site reachable" {
    $r = Invoke-WebRequest -Uri $baseUrl -UseBasicParsing -TimeoutSec 10
    if ($r.StatusCode -ne 200) { throw "Status $($r.StatusCode)" }
}

# 2. Key pages load
@("/", "/pricing", "/auth/signin", "/terms", "/faq", "/contact") | ForEach-Object {
    Test-Step "Page $_ loads" {
        $r = Invoke-WebRequest -Uri "$baseUrl$_" -UseBasicParsing -TimeoutSec 10
        if ($r.StatusCode -ne 200) { throw "Status $($r.StatusCode)" }
    }
}

# 3. SEO
Test-Step "Sitemap exists" {
    $r = Invoke-WebRequest -Uri "$baseUrl/sitemap.xml" -UseBasicParsing -TimeoutSec 10
    if ($r.StatusCode -ne 200) { throw "Status $($r.StatusCode)" }
    if ($r.Content -notmatch "overtaxed") { throw "Sitemap missing expected content" }
}

Test-Step "Robots.txt exists" {
    $r = Invoke-WebRequest -Uri "$baseUrl/robots.txt" -UseBasicParsing -TimeoutSec 10
    if ($r.StatusCode -ne 200) { throw "Status $($r.StatusCode)" }
}

# 4. Cron (deadline reminders) — requires CRON_SECRET
if (-not $SkipCron -and $CronSecret) {
    Test-Step "Cron deadline-reminders" {
        $r = Invoke-WebRequest -Uri "$baseUrl/api/cron/deadline-reminders" -UseBasicParsing -Headers @{
            "Authorization" = "Bearer $CronSecret"
        } -TimeoutSec 30
        if ($r.StatusCode -ne 200) { throw "Status $($r.StatusCode)" }
        Write-Host "Response: $($r.Content.Substring(0, [Math]::Min(200, $r.Content.Length)))..."
    }
} else {
    Write-Host "`n--- Cron (skipped - set CRON_SECRET or -CronSecret) ---" -ForegroundColor Gray
}

# 5. Admin set-subscription (optional — requires ADMIN_SECRET and test email)
if (-not $SkipAdmin -and $AdminSecret -and $TestEmail) {
    Test-Step "Admin set-subscription (get user)" {
        $r = Invoke-RestMethod -Uri "$baseUrl/api/admin/set-subscription?email=$TestEmail" -Headers @{
            "x-admin-secret" = $AdminSecret
        }
        Write-Host "User: $($r.email) tier=$($r.subscriptionTier) qty=$($r.subscriptionQuantity)"
    }
} else {
    Write-Host "`n--- Admin API (skipped - set ADMIN_SECRET and -TestEmail) ---" -ForegroundColor Gray
}

# Summary
Write-Host "`n========================================" -ForegroundColor Yellow
Write-Host " Results: $passed passed, $failed failed" -ForegroundColor $(if ($failed -eq 0) { "Green" } else { "Red" })
Write-Host "========================================" -ForegroundColor Yellow

# Manual test reminders
Write-Host "`nManual tests (browser):" -ForegroundColor Magenta
Write-Host "  1. Live checkout - Sign in, Pricing, complete Starter/Growth payment"
Write-Host "  2. Property limits - Add properties to limit; 5th should be blocked"
Write-Host "  3. Email - Check inbox after cron or assessment alert"
Write-Host "  4. Webhook - After checkout, Account/Dashboard should show updated slots"
Write-Host "  5. Appeal flow - Property, Comps, Start Appeal with These Comps, PDF"
Write-Host "  6. Filing auth - Appeal detail, Authorize filing, Admin Filing Queue"
Write-Host ""

exit $failed
