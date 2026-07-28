<?php

namespace App\Http\Middleware;

use App\Models\ApiKey;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class ApiTokenMiddleware {
    public function handle(Request $request, Closure $next): Response {
        $token = $request->bearerToken();

        if (!$token) {
            return response()->json([
                'success' => false,
                'message' => 'Missing API token',
            ], 401);
        }

        $key = ApiKey::findByToken($token);

        if (!$key) {
            return response()->json([
                'success' => false,
                'message' => 'Invalid API token',
            ], 401);
        }

        $key->update(['last_used_at' => now()]);

        return $next($request);
    }
}
