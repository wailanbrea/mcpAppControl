<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Workflow extends Model {
    use HasFactory;

    protected $fillable = [
        'name',
        'description',
        'steps',
        'allowed_package',
        'status',
        'created_by',
    ];

    protected $casts = [
        'steps' => 'array',
    ];

    public function createdBy(): BelongsTo {
        return $this->belongsTo(User::class, 'created_by');
    }

    public function tasks(): HasMany {
        return $this->hasMany(Task::class);
    }

    public function schedules(): HasMany {
        return $this->hasMany(Schedule::class);
    }

    /** Devices explicitly selected as the routine's default execution targets. */
    public function targetDevices(): BelongsToMany {
        return $this->belongsToMany(Device::class, 'workflow_device_targets')->withTimestamps();
    }

    /**
     * Get total number of steps in workflow
     */
    public function getStepsCountAttribute(): int {
        return is_array($this->steps) ? count($this->steps) : 0;
    }

    /**
     * Validate workflow steps structure
     */
    public static function validateSteps(array $steps): bool {
        foreach ($steps as $step) {
            if (!isset($step['type'])) {
                return false;
            }
        }
        return true;
    }

    /**
     * Get workflow execution success rate
     */
    public function getSuccessRateAttribute(): float {
        $totalTasks = $this->tasks()->count();

        if ($totalTasks === 0) {
            return 0.0;
        }

        $completedTasks = $this->tasks()
            ->where('status', 'completed')
            ->count();

        return round(($completedTasks / $totalTasks) * 100, 2);
    }
}
