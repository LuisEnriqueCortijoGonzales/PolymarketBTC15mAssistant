# Tutorial paso a paso: falso trading (simulación) en mercados de 15 minutos

Este tutorial te guía para ejecutar el bot en **modo simulado** (sin enviar órdenes reales) y validar compras/ventas en mercados 15m de Polymarket.

## 1) Requisitos

- Node.js 18+
- npm

Verifica:

```bash
node -v
npm -v
```

## 2) Instalar dependencias

```bash
npm install
```

## 3) Crear archivo de entorno

```bash
cp env_plantilla .env
```

## 4) Configurar modo simulado (seguro)

En `.env`, usa estas claves:

```env
POLY_TRADING_ENABLED=false
POLY_TRADING_DRY_RUN=true
```

> Con esta combinación no se envían órdenes reales. El bot solo simula y registra la ejecución.

## 5) Elegir moneda (BTC, ETH, SOL, XRP)

En `.env`:

```env
COIN=BTC
```

También puedes cambiarla por terminal antes de iniciar:

```bash
export COIN=ETH
```

## 6) Ejecutar el bot

```bash
npm start
```

## 7) Qué esperar en simulación

- El motor puede abrir y cerrar posiciones simuladas tipo `SCALP` y `HOLD`.
- Para `HOLD`, hay cierres simulados por:
  - `TP_+0.03`
  - `SL_-0.03`
  - `TIMEOUT_240s`
  - `FINAL_EXIT_5s` (cierre cercano al settlement)
- El bot evita abrir un `HOLD` cuando quedan <= 5 segundos para evitar aperturas tardías.

## 8) Revisar el log de ejecuciones simuladas

Archivo:

```text
logs/trade_execution_log.csv
```

Columnas clave:

- `mode`: `simulated` o `dry_run`
- `action`: `buy` / `sell`
- `outcome`: `UP` / `DOWN`
- `reason`: motivo de apertura/cierre
- `status`: resultado

## 9) Ejecutar varias monedas en paralelo (Windows)

Puedes usar el script:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\run-4coins.ps1
```

## 10) Mantenerte siempre en simulación

Checklist de seguridad:

- `POLY_TRADING_ENABLED=false`
- `POLY_TRADING_DRY_RUN=true`
- `POLYMARKET_API_KEY`, `POLYMARKET_API_SECRET`, `POLYMARKET_API_PASSPHRASE` vacíos

Si más adelante quieres pasar a real, hazlo bajo tu propio riesgo y en montos mínimos.
