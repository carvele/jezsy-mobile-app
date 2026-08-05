# Run from PowerShell. Prompts for the secret key instead of taking it as an
# argument, so it never lands in shell history or on-screen in plaintext.
$secretKey = Read-Host "Paste your PayMongo sk_test_ key" -AsSecureString
$plainKey = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($secretKey))

$authString = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes("$($plainKey):"))

$body = @{
    data = @{
        attributes = @{
            url    = "https://wufcmtndotfvxvvxkamv.supabase.co/functions/v1/payments-webhook"
            events = @("source.chargeable", "payment.paid", "payment.failed")
        }
    }
} | ConvertTo-Json -Depth 5

$response = Invoke-RestMethod -Uri "https://api.paymongo.com/v1/webhooks" `
    -Method Post `
    -Headers @{ Authorization = "Basic $authString"; "Content-Type" = "application/json" } `
    -Body $body

$response.data.attributes | Select-Object url, status, secret_key

Write-Host "`nCopy the secret_key value above (starts whsk_), then run:"
Write-Host 'supabase secrets set PAYMONGO_WEBHOOK_SECRET=whsk_PASTE_HERE --project-ref wufcmtndotfvxvvxkamv'
