# Asistente 15m para Polymarket (BTC/ETH/SOL/XRP)

Un asistente de trading en consola, en tiempo real, para los mercados de Polymarket **"Bitcoin Up or Down" de 15 minutos**.

Combina:
- Selección de mercado en Polymarket + precios UP/DOWN + liquidez
- WS en vivo de Polymarket para **PRECIO ACTUAL BTC/USD de Chainlink** (la misma fuente que muestra la UI de Polymarket)
- Fallback a Chainlink on-chain (Polygon) vía RPC HTTP/WSS
- Precio spot de Binance como referencia
- Snapshot de análisis técnico de corto plazo (Heikin Ashi, RSI, MACD, VWAP, Variación 1/3m)
- Un **Predict en vivo (LONG/SHORT %)** simple, derivado del scoring técnico actual del asistente

## Requisitos

- Node.js **18+** (https://nodejs.org/en)
- npm (viene con Node)


## Ejecutar desde terminal (paso a paso)


### Checklist de pre-requisitos (recomendado antes de ejecutar)

1) Verifica versión de Node y npm:

```bash
node -v
npm -v
```

2) Instala dependencias del proyecto:

```bash
npm install
```

3) Define la moneda a ejecutar (`COIN`):

- Valores válidos: `BTC`, `ETH`, `SOL`, `XRP`.
- Si no defines `COIN`, el valor por defecto es `BTC`.

Ejemplo PowerShell:

```powershell
$env:COIN = "ETH"
```

Ejemplo CMD:

```cmd
set COIN=ETH
```

4) Verifica conectividad de red saliente (muy importante):

```bash
node -e "fetch('https://api.binance.com/api/v3/time').then(()=>console.log('OK red')).catch(e=>console.error('ERROR red:', e.message, e.cause?.code || ''))"
```

Si este check falla, el bot puede arrancar pero mostrará errores `fetch failed` por entorno de red/proxy.

5) Si trabajas detrás de proxy, define `HTTPS_PROXY`/`HTTP_PROXY`/`ALL_PROXY` correctamente (ver sección de proxy más abajo).


### 1) Clonar el repositorio

```bash
git clone https://github.com/FrondEnt/PolymarketBTC15mAssistant.git
```

Alternativa (sin git):

- Haz clic en el botón verde `<> Code` en GitHub
- Elige `Download ZIP`
- Extrae el ZIP
- Abre una terminal en la carpeta del proyecto extraído

Luego abre una terminal dentro de la carpeta del proyecto.

### 2) Instalar dependencias

```bash
npm install
```

### 3) (Opcional) Configurar variables de entorno

Puedes ejecutar sin configuración extra (ya hay valores por defecto), pero para un fallback de Chainlink más estable se recomienda definir al menos un RPC de Polygon.

#### Windows PowerShell (sesión actual de terminal)

```powershell
$env:POLYGON_RPC_URL = "https://polygon-rpc.com"
$env:POLYGON_RPC_URLS = "https://polygon-rpc.com,https://rpc.ankr.com/polygon"
$env:POLYGON_WSS_URLS = "wss://polygon-bor-rpc.publicnode.com"
```

Configuración opcional de Polymarket:

```powershell
$env:POLYMARKET_AUTO_SELECT_LATEST = "true"
# $env:POLYMARKET_SLUG = "btc-updown-15m-..."   # fija un mercado específico
```

#### Windows CMD (sesión actual de terminal)

```cmd
set POLYGON_RPC_URL=https://polygon-rpc.com
set POLYGON_RPC_URLS=https://polygon-rpc.com,https://rpc.ankr.com/polygon
set POLYGON_WSS_URLS=wss://polygon-bor-rpc.publicnode.com
```

Configuración opcional de Polymarket:

```cmd
set POLYMARKET_AUTO_SELECT_LATEST=true
REM set POLYMARKET_SLUG=btc-updown-15m-...
```

Notas:
- Estas variables de entorno aplican solo a la ventana actual de terminal.
- Si quieres variables permanentes, configúralas en las Variables de Entorno del sistema en Windows o usa un cargador de `.env` de tu preferencia.

## Configuración

Este proyecto lee su configuración desde variables de entorno.

Puedes definirlas en tu shell o crear un archivo `.env` y cargarlo con el método que prefieras.

### Polymarket


### Selección de moneda (multi-coin)

- `COIN` (por defecto: `BTC`)
  - Opciones: `BTC`, `ETH`, `SOL`, `XRP`.
  - Cambia automáticamente:
    - símbolo de Binance (`BTCUSDT`, `ETHUSDT`, `SOLUSDT`, `XRPUSDT`)
    - filtro de mercado Polymarket (`slugPrefix` de cada coin)
    - feed Chainlink USD en Polygon para cada coin


- `POLYMARKET_AUTO_SELECT_LATEST` (por defecto: `true`)
  - Cuando está en `true`, selecciona automáticamente el mercado más reciente de 15m.
- `POLYMARKET_SERIES_ID (legacy/no usado para auto-select)` (por defecto: `10192`)
- `POLYMARKET_SERIES_SLUG` (por defecto: `btc-up-or-down-15m`)
- `POLYMARKET_SLUG` (opcional)
  - Si se define, el asistente apuntará a un slug de mercado específico.
- `POLYMARKET_LIVE_WS_URL` (por defecto: `wss://ws-live-data.polymarket.com`)

### Chainlink en Polygon (fallback)

- `CHAINLINK_USD_AGGREGATOR`
  - Por defecto: `0xc907E116054Ad103354f2D350FD2514433D57F6f`

RPC HTTP:
- `POLYGON_RPC_URL` (por defecto: `https://polygon-rpc.com`)
- `POLYGON_RPC_URLS` (opcional, separado por comas)
  - Ejemplo: `https://polygon-rpc.com,https://rpc.ankr.com/polygon`

RPC WSS (opcional, pero recomendado para fallback más en tiempo real):
- `POLYGON_WSS_URL` (opcional)
- `POLYGON_WSS_URLS` (opcional, separado por comas)

### Soporte de proxy

El bot soporta proxies HTTP(S) tanto para solicitudes HTTP (fetch) como para conexiones WebSocket.

Variables de entorno soportadas (estándar):

- `HTTPS_PROXY` / `https_proxy`
- `HTTP_PROXY` / `http_proxy`
- `ALL_PROXY` / `all_proxy`

Ejemplos:

PowerShell:

```powershell
$env:HTTPS_PROXY = "http://127.0.0.1:8080"
# o
$env:ALL_PROXY = "socks5://127.0.0.1:1080"
```

CMD:

```cmd
set HTTPS_PROXY=http://127.0.0.1:8080
REM o
set ALL_PROXY=socks5://127.0.0.1:1080
```

#### Proxy con usuario + contraseña (guía simple)

1) Toma el host y puerto de tu proxy (ejemplo: `1.2.3.4:8080`).

2) Agrega tu usuario y contraseña en la URL:

- Proxy HTTP/HTTPS:
  - `http://USUARIO:CONTRASEÑA@HOST:PUERTO`
- Proxy SOCKS5:
  - `socks5://USUARIO:CONTRASEÑA@HOST:PUERTO`

3) Defínelo en la terminal y ejecuta el bot.

PowerShell:

```powershell
$env:HTTPS_PROXY = "http://USUARIO:CONTRASEÑA@HOST:PUERTO"
npm start
```

CMD:

```cmd
set HTTPS_PROXY=http://USUARIO:CONTRASEÑA@HOST:PUERTO
npm start
```

Importante: si tu contraseña contiene caracteres especiales como `@` o `:`, debes codificarla en formato URL.

Ejemplo:

- contraseña: `p@ss:word`
- codificada: `p%40ss%3Aword`
- URL de proxy: `http://user:p%40ss%3Aword@1.2.3.4:8080`

## Ejecutar

```bash
npm start
```

### Detener

Presiona `Ctrl + C` en la terminal.

### Actualizar a la última versión

```bash
git pull
npm install
npm start
```


## Estrategia rápida (triple comparación)


### Vista x4 (modo compacto automático)

Si abres 4 terminales al mismo tiempo (cuadrícula x4), el bot activa un **modo compacto** cuando detecta ancho reducido.

En ese modo siempre prioriza mostrar:
- Precio de **Mercado 15m** (UP/DOWN)
- Precio de **Chainlink**
- Precio de **Binance**
- `Poly futuro` + estrategia rápida


El bot ahora calcula una comparación de 3 fuentes por moneda:

- **Binance spot** (referencia de liquidez y micro-movimiento)
- **Chainlink directo** (fuente canónica de resolución)
- **Polymarket 15m** (precio actual implícito de UP/DOWN)

Con estas 3 fuentes estima un **"Poly futuro"** (precio esperado en centavos del lado UP/DN) y un edge en centavos respecto al precio actual de mercado.

Además, cuando Polymarket no entrega `clobTokenIds` en algunos ciclos, el bot ahora usa fallback a `outcomePrices` (Gamma) para no quedar en `UP - / DN -`.


En pantalla verás:

- `Tri-precio`: Binance / Chainlink / Poly UP actual
- `Poly futuro`: precio proyectado UP/DN, edge estimado (ΔUP/ΔDN) y acción rápida sugerida

Acciones sugeridas:

- `BUY_UP_FAST_SELL_HIGH` cuando el valor futuro de UP supera al precio actual de UP con margen suficiente.
- `BUY_DOWN_FAST_SELL_HIGH` cuando el valor futuro de DOWN supera al precio actual de DOWN con margen suficiente.
- `HOLD` si no hay ventaja suficiente o faltan datos.

> Importante: es una estrategia de alta frecuencia y riesgo alto; usa tamaño pequeño y valida siempre spread/liquidez.


## Notas / Solución de problemas

- Si no ves actualizaciones de Chainlink:
  - Puede que el WS de Polymarket esté temporalmente no disponible. El bot hace fallback al precio on-chain de Chainlink vía RPC de Polygon.
  - Asegúrate de tener al menos una URL de RPC de Polygon funcionando.
- Si la consola parece que “spamea” líneas:
  - El render usa `readline.cursorTo` + `clearScreenDown` para mantener una pantalla estática y estable, pero algunos terminales pueden comportarse distinto.

## Seguridad

Esto no es asesoría financiera. Úsalo bajo tu propio riesgo.

hecho por @krajekis
