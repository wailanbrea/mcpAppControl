<?php

use Illuminate\Support\Facades\Route;

/*
 * The dashboard is deliberately served by Laravel so the UI and REST API
 * share one origin. This removes the separate static web server and CORS
 * dependency from the deployment topology.
 */
Route::get('/', static function () {
    return response()->file(public_path('dashboard/index.html'), [
        'Cache-Control' => 'no-store, max-age=0',
    ]);
});

Route::redirect('/dashboard', '/');
