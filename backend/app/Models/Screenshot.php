<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class Screenshot extends Model {
    use HasFactory;

    protected $table = 'screenshots';

    protected $fillable = [
        'device_serial',
        'image_data',
        'timestamp',
    ];

    protected $casts = [
        'timestamp' => 'datetime',
    ];

    /**
     * Get recent screenshots for a device
     */
    public static function getRecentScreenshots(string $serialNumber, int $limit = 10): \Illuminate\Database\Eloquent\Collection {
        return self::where('device_serial', $serialNumber)
            ->orderByDesc('timestamp')
            ->limit($limit)
            ->get();
    }

    /**
     * Get screenshot by ID with base64 data
     */
    public function getScreenshotUrlAttribute(): string {
        return 'data:image/png;base64,' . $this->image_data;
    }
}
