<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class ApiKey extends Model {
    protected $fillable = [
        'name',
        'token_hash',
        'last_used_at',
    ];

    protected $casts = [
        'last_used_at' => 'datetime',
    ];

    /**
     * Find the key matching a plain-text token, or null.
     */
    public static function findByToken(string $token): ?self {
        return self::where('token_hash', hash('sha256', $token))->first();
    }
}
