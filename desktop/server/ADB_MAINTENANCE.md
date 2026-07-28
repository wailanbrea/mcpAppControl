# Mantenimiento ADB integrado

Esta implementación reemplaza los scripts PowerShell externos por comandos
parametrizados de AppControl. Siempre utiliza el `adb.exe` incluido en el
instalador y los dispositivos seleccionados en la interfaz.

## Equivalencia de los scripts originales

| Scripts originales | Acción integrada |
| --- | --- |
| `xpace-clear-proxy-5.ps1` | `CLEAR_PROXY` |
| `xpace-stabilize-5.ps1` | `DEVICE_STABILIZE` + `ASSIGN_PROXY` + `DEVICE_NETWORK_STATUS` |
| `box1-proxy-control*.ps1` | `SET_PROXY`, `CLEAR_PROXY`, `DEVICE_NETWORK_STATUS` |
| `box1-stabilize*.ps1` | `DEVICE_STABILIZE` + `ASSIGN_PROXY` |

Los archivos con sufijos `good` y `all20` son copias idénticas de sus versiones
base; no representan comportamientos diferentes.

## Acciones

### `DEVICE_STABILIZE`

- Despierta la pantalla.
- Configura pantalla encendida mientras tenga alimentación USB o AC.
- Configura el tiempo de apagado entre 1 y 120 minutos.
- Configura las tres escalas de animación en `0`, `0.5` o `1`.
- Opcionalmente activa hora automática y establece una zona horaria IANA.
- Lee de nuevo cada ajuste y falla si Android no aplicó el valor solicitado.

Parámetros:

```json
{
  "keep_awake": true,
  "screen_timeout_minutes": 30,
  "animation_scale": 0,
  "sync_time": false,
  "timezone": "America/Chicago"
}
```

### `DEVICE_NETWORK_STATUS`

Devuelve proxy global, IP local, ruta, fecha, zona horaria, tiempo de apagado y
escalas de animación.

### `SET_PROXY` y `CLEAR_PROXY`

Ambas acciones verifican el valor final. Al aplicar o limpiar se eliminan también
credenciales antiguas y las claves heredadas `global_http_proxy_*`.

## Límites de Android

- El proxy HTTP global de Android no admite usuario y contraseña.
- Cambiar manualmente la hora exacta suele requerir privilegios de sistema o
  `root`. AppControl usa hora automática de red cuando se solicita sincronización.
- Algunos fabricantes pueden bloquear el cambio de zona horaria por ADB. En ese
  caso la acción reporta fallo parcial con los detalles de verificación.
- `stay_on_while_plugged_in=3` cubre alimentación AC y USB; no cubre carga
  inalámbrica.

## Uso

1. Seleccionar dispositivos en el panel, o usar **Todos los dispositivos**.
2. Abrir **Acciones > ADB**.
3. Ejecutar **Estabilizar**, **Diagnóstico red** o **Limpiar proxy**.

También hay tres plantillas nuevas en el constructor de rutinas y herramientas
equivalentes disponibles desde Hermes.
