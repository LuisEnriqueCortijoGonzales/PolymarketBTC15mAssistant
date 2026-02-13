$coins = @('BTC','ETH','SOL','XRP')

foreach ($coin in $coins) {
  Start-Process powershell -ArgumentList @(
    '-NoExit',
    '-Command',
    "Set-Location '$PSScriptRoot\..'; `$env:COIN='$coin'; npm start"
  )
}
