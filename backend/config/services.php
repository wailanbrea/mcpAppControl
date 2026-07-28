<?php

return [
    // Servidor WebSocket (mcp-server/src/websocket-server.ts) que mantiene
    // las conexiones con los agentes Android.
    'ws' => [
        'dispatch_url' => env('WS_DISPATCH_URL', 'http://127.0.0.1:6001/command/dispatch'),
        'token' => env('WS_AUTH_TOKEN', ''),
    ],

    'adb_screen_capture' => [
        'enabled' => env('ADB_SCREEN_CAPTURE_ENABLED', false),
        'path' => env('ADB_PATH', ''),
        'host' => env('ADB_SERVER_HOST', '127.0.0.1'),
        'port' => env('ADB_SERVER_PORT', 5037),
        'timeout' => env('ADB_SCREEN_CAPTURE_TIMEOUT', 12),
        'max_width' => env('ADB_SCREEN_CAPTURE_MAX_WIDTH', 360),
    ],
];
