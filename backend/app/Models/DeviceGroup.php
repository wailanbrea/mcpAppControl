<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Database\Eloquent\Relations\HasMany;

class DeviceGroup extends Model {
    use HasFactory;

    protected $fillable = [
        'name',
        'description',
        'max_devices',
        'paused_at',
    ];

    protected $casts = [
        'max_devices' => 'integer',
        'paused_at' => 'datetime',
    ];

    /**
     * Check if the group is paused (no new tasks are assigned to its devices)
     */
    public function isPaused(): bool {
        return $this->paused_at !== null;
    }

    public function devices(): HasMany {
        return $this->hasMany(Device::class, 'assigned_group_id');
    }

    public function schedules(): HasMany {
        return $this->hasMany(Schedule::class, 'group_id');
    }

    /**
     * Get count of online devices in group
     */
    public function getOnlineDevicesCountAttribute(): int {
        return $this->devices()->where('status', 'online')->count();
    }

    /**
     * Get count of busy devices in group
     */
    public function getBusyDevicesCountAttribute(): int {
        return $this->devices()->where('status', 'busy')->count();
    }

    /**
     * Check if group has capacity for more devices
     */
    public function hasCapacity(int $count = 1): bool {
        if (!$this->max_devices) {
            return true; // No limit
        }

        return ($this->devices()->count() + $count) <= $this->max_devices;
    }
}
