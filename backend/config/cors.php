<?php

return [
    // El dashboard se sirve desde este mismo origen. No se exponen rutas API
    // a orígenes de navegador externos por defecto.
    'paths' => ['api/*'],
    'allowed_methods' => ['*'],
    'allowed_origins' => [],
    'allowed_origins_patterns' => [],
    'allowed_headers' => ['*'],
    'exposed_headers' => [],
    'max_age' => 0,
    'supports_credentials' => false,
];
