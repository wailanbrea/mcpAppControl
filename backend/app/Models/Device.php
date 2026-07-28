<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Device extends Model {
    use HasFactory;

    protected $fillable = [
        'name',
        'serial_number',
        'adb_serial',
        'transport',
        'model',
        'android_version',
        'status',
        'assigned_group_id',
        'current_task_id',
        'last_seen',
    ];

    protected $casts = [
        'last_seen' => 'datetime',
    ];

    public function assignedGroup(): BelongsTo {
        return $this->belongsTo(DeviceGroup::class, 'assigned_group_id');
    }

    public function currentTask(): BelongsTo {
        return $this->belongsTo(Task::class, 'current_task_id');
    }

    public function taskAssignments(): HasMany {
        return $this->hasMany(TaskAssignment::class);
    }

    public function executionLogs(): HasMany {
        return $this->hasMany(ExecutionLog::class, 'device_serial', 'serial_number');
    }

    public function screenshots(): HasMany {
        return $this->hasMany(Screenshot::class, 'device_serial', 'serial_number');
    }

    /**
     * Check if device is online
     */
    public function isOnline(): bool {
        return $this->status === 'online';
    }

    /**
     * Check if device is busy
     */
    public function isBusy(): bool {
        return $this->status === 'busy';
    }

    /**
     * Get time since last seen
     */
    public function getTimeSinceLastSeen(): ?\DateInterval {
        return $this->last_seen ? now()->diff($this->last_seen) : null;
    }
}
