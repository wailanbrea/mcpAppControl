# MCP AppControl

Plataforma para administrar, visualizar y automatizar dispositivos Android desde
Windows. La distribución principal es una aplicación Electron todo-en-uno que integra
la API local, SQLite, el dashboard, el Command Router y el transporte ADB.

## Arquitectura actual

```text
Aplicación Windows (Electron)
├── Dashboard web             http://127.0.0.1:8733
├── API Express + SQLite      /api/v1
├── Command Router            ws://127.0.0.1:6011/ws
├── Pool de proxies           asignación, capacidad y rotación
├── Servidor MCP              herramientas para Hermes
└── Transporte ADB
    ├── detección USB
    ├── control de pantalla
    ├── ejecución de rutinas
    └── captura en tiempo real

Dispositivos Android
├── USB/ADB, recomendado para la granja local
└── Agente Android por WebSocket
```

El backend Laravel se conserva como componente independiente para compatibilidad. La
aplicación Windows no necesita XAMPP, PHP ni MySQL. El servidor MCP TypeScript permite
que Hermes controle la flota usando la API local autenticada.

## Componentes

- `desktop/`: aplicación Windows, API embebida, dashboard, SQLite, ADB y WebSocket.
- `android-agent/`: agente Android en Kotlin.
- `backend/`: API Laravel independiente.
- `mcp-server/`: servidor MCP y WebSocket TypeScript independiente.
- `videolab-app/`: aplicación Android de prueba.
- `docs/`: documentación técnica.

La carpeta local `panda/` contiene material de referencia propietario y está excluida del
repositorio.

## Ejecutar la aplicación Windows

```powershell
cd desktop
npm install
npm start
```

Después del arranque:

- Dashboard: `http://127.0.0.1:8733`
- Salud: `http://127.0.0.1:8733/up`
- Router: `ws://127.0.0.1:6011/ws`

Desde la raíz también puede ejecutarse:

```powershell
.\start-all.ps1
```

La arquitectura Laravel/MySQL independiente permanece disponible mediante
`start-legacy.ps1`.

El token local se genera automáticamente en:

```text
%APPDATA%\MCP Control Bsolutions V1\api-token.txt
```

No debe copiarse al repositorio.

## Proxies y rutinas

El constructor de rutinas incluye cuatro pasos:

- `ASSIGN_PROXY`: reserva y aplica el siguiente proxy disponible.
- `ROTATE_PROXY`: libera el actual y cambia al siguiente.
- `CLEAR_PROXY`: quita el proxy y libera su capacidad.
- `CHECK_IP`: comprueba y registra la IP de salida.

En **Constructor de rutinas → Proxies** se pueden crear e importar proxies,
establecer su capacidad máxima y distribuirlos sobre los dispositivos seleccionados.
Las contraseñas se guardan con AES-256-GCM y no se devuelven por la API.

El proxy HTTP global configurado por ADB no soporta usuario/contraseña y algunas apps
Android pueden ignorarlo. Para proxies autenticados o tráfico UDP se requiere un agente
VPN/proxy instalado en el teléfono. La aplicación detecta ese caso y no reporta una
asignación falsa como exitosa.

## Conectar Hermes

El instalador incluye un servidor MCP autocontenido. En cada computadora:

1. Instale y abra AppControl.
2. Abra **Scripts → Conectar / reparar Hermes**.
3. Pulse **Conectar Hermes**.
4. Abra una sesión nueva de Hermes.

El asistente detecta la CLI local de Hermes, crea una copia de seguridad de
`%LOCALAPPDATA%\hermes\config.yaml`, registra el MCP incluido y ejecuta una prueba.
Si el alta o la prueba falla, restaura la configuración anterior.

No se necesita instalar Node.js ni clonar este repositorio. El instalador incluye un
runtime Node LTS privado usado exclusivamente como transporte `stdio` del servidor MCP.
La comunicación queda en `127.0.0.1`.
`BACKEND_TOKEN_FILE` contiene únicamente la ruta del archivo local, no la clave API.

Hermes descubre herramientas para dispositivos, proxies, grupos, rutinas, horarios,
tareas y reportes. La pantalla ofrece **Probar**, **Reparar** y **Desconectar**.

## Construir el instalador

La carpeta `desktop/vendor/platform-tools/` debe contener `adb.exe`,
`AdbWinApi.dll` y `AdbWinUsbApi.dll`.

```powershell
cd desktop
npm run dist
```

Si Windows no permite crear enlaces simbólicos para las herramientas de firma:

```powershell
npm run dist:unsigned
```

El segundo comando genera un instalador local sin firma digital. Para distribución
pública debe configurarse firma de código.

## Validación

```powershell
# Aplicación de escritorio
cd desktop
npm test

# Backend Laravel
cd ../backend
composer install
php artisan test

# Servidor MCP
cd ../mcp-server
npm ci
npm run build

# Agente Android
cd ../android-agent
.\gradlew.bat :app:assembleDebug --no-daemon
```

## Seguridad y datos locales

- La API Electron escucha exclusivamente en `127.0.0.1`.
- Todas las rutas `/api/v1` requieren un token Bearer.
- Credenciales, bases SQLite, capturas, configuraciones locales, dependencias y
  artefactos de compilación están excluidos mediante `.gitignore`.
- Las credenciales de cuentas se almacenan cifradas localmente.
- Las credenciales de proxies se almacenan cifradas; el MCP solo recibe vistas sin
  contraseñas.
- Hermes recibe la ruta del token, no el token en texto dentro de su configuración.

## Estado conocido

- Transporte USB/ADB y captura de pantalla verificados con Samsung SM-G998U.
- Integración MCP con Hermes verificada con 35 herramientas descubiertas.
- El instalador incluye el puente MCP portable; no depende del Node.js del sistema.
- Instalador Windows NSIS generado y validado.
- El instalador local no está firmado y Windows SmartScreen puede advertir al abrirlo.
