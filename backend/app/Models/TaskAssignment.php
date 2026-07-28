<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class TaskAssignment extends Model {
    use HasFactory;

    protected $table = 'task_assignments';

    protected $fillable = [
        'task_id',
        'device_id',
        'external_task_id',
        'device_serial',
        'status',
        'error_message',
        'started_at',
        'completed_at',
    ];

    protected $casts = [
        'started_at' => 'datetime',
        'completed_at' => 'datetime',
    ];

    public function task(): BelongsTo {
        return $this->belongsTo(Task::class);
    }

    public function device(): BelongsTo {
        return $this->belongsTo(Device::class);
    }

    /**
     * Check if assignment is completed
     */
    public function isCompleted(): bool {
        return $this->status === 'completed';
    }

    /**
     * Check if assignment has failed
     */
    public function hasFailed(): bool {
        return $this->status === 'failed';
    }

    /**
     * Get execution duration in seconds
     */
    public function getExecutionDurationAttribute(): ?int {
        if (!$this->started_at || !$this->completed_at) {
            return null;
        }

        return $this->started_at->diffInSeconds($this->completed_at);
    }
}
