# MCP AppControl — aplicación de escritorio para Windows

Aplicación todo-en-uno basada en Electron. Integra en un único proceso:

- API local Express y base de datos SQLite mediante `sql.js`.
- Dashboard web.
- Command Router HTTP/WebSocket para los agentes Android.
- Transporte ADB para detectar, visualizar y controlar dispositivos conectados por USB.

La aplicación de escritorio no necesita XAMPP, PHP ni MySQL.

## Conexión de dispositivos

- **USB/ADB:** es el transporte recomendado para la granja local. La aplicación detecta
  automáticamente los equipos autorizados mediante depuración USB.
- **Agente por red:** el teléfono ejecuta la aplicación Android y se conecta al Command
  Router por WebSocket.

La API y el router escuchan únicamente en `127.0.0.1`:

- Dashboard/API: `http://127.0.0.1:8733`
- Command Router: `ws://127.0.0.1:6011/ws`

El token local se genera en el primer arranque, se guarda en
`%APPDATA%/MCP Control Bsolutions V1/api-token.txt` y se inyecta automáticamente en el
dashboard.

## Desarrollo

Requisitos:

- Node.js.
- Android Platform Tools, si `desktop/vendor/platform-tools` no está disponible.

```powershell
cd desktop
npm install
npm start
```

En desarrollo, ADB se busca en este orden:

1. `ADB_PATH`
2. Recursos empaquetados
3. `%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe`
4. `ANDROID_HOME`
5. `PATH`

## Empaquetado

`desktop/vendor/platform-tools` debe contener:

- `adb.exe`
- `AdbWinApi.dll`
- `AdbWinUsbApi.dll`

```powershell
npm run dist
```

El instalador se genera en `desktop/release`. En Windows, `electron-builder` necesita
permiso para crear enlaces simbólicos al preparar sus herramientas de firma. Si el build
falla en `winCodeSign`, active el Modo de desarrollador de Windows o ejecute el build en
una consola con privilegios administrativos. Para generar un instalador local sin firma
ni edición del ejecutable, use:

```powershell
npm run dist:unsigned
```

`desktop/vendor/php` es un remanente de la arquitectura Laravel anterior y no forma parte
del paquete actual.

## Estructura

- `main.js`: ciclo de vida de Electron y arranque coordinado de servicios.
- `server/`: API, persistencia y lógica de negocio.
- `router.js`: Command Router para ADB y agentes WebSocket.
- `adb/`: detección, captura y control directo mediante ADB.
- `dashboard/`: interfaz de usuario.
- `vendor/platform-tools/`: runtime ADB incluido en el instalador.
