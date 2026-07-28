<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class ExecutionLog extends Model {
    use HasFactory;

    protected $table = 'execution_logs';

    protected $fillable = [
        'task_id',
        'device_serial',
        'command_type',
        'success',
        'message',
        'result_data',
        'timestamp',
    ];

    protected $casts = [
        'success' => 'boolean',
        'result_data' => 'array',
        'timestamp' => 'datetime',
    ];

    public function task(): BelongsTo {
        return $this->belongsTo(Task::class);
    }

    /**
     * Get log entries for a specific device
     */
    public static function getDeviceLogs(string $serialNumber, int $limit = 50): \Illuminate\Database\Eloquent\Collection {
        return self::where('device_serial', $serialNumber)
            ->orderByDesc('timestamp')
            ->limit($limit)
            ->get();
    }

    /**
     * Get log entries for a specific task
     */
    public static function getTaskLogs(int $taskId, int $limit = 50): \Illuminate\Database\Eloquent\Collection {
        return self::where('task_id', $taskId)
            ->orderByDesc('timestamp')
            ->limit($limit)
            ->get();
    }

    /**
     * Get success rate for a device
     */
    public static function getDeviceSuccessRate(string $serialNumber): float {
        $total = self::where('device_serial', $serialNumber)->count();

        if ($total === 0) {
            return 0.0;
        }

        $successes = self::where('device_serial', $serialNumber)
            ->where('success', true)
            ->count();

        return round(($successes / $total) * 100, 2);
    }
}
