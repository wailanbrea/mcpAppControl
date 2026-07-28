<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Task extends Model {
    use HasFactory;

    protected $fillable = [
        'external_id',
        'workflow_id',
        'params',
        'status',
        'scheduled_at',
        'started_at',
        'completed_at',
        'error_message',
    ];

    protected $casts = [
        'params' => 'array',
        'scheduled_at' => 'datetime',
        'started_at' => 'datetime',
        'completed_at' => 'datetime',
    ];

    public function workflow(): BelongsTo {
        return $this->belongsTo(Workflow::class);
    }

    public function assignments(): HasMany {
        return $this->hasMany(TaskAssignment::class);
    }

    /**
     * Mark task as running
     */
    public function markAsRunning(): void {
        $this->update([
            'status' => 'running',
            'started_at' => $this->started_at ?? now(),
        ]);
    }

    /**
     * Mark task as completed
     */
    public function markAsCompleted(?array $result = null): void {
        $params = $this->params ?? [];
        if ($result !== null) {
            $params['last_result'] = $result;
        }

        $this->update([
            'status' => 'completed',
            'completed_at' => now(),
            'params' => $params,
        ]);
    }

    /**
     * Mark task as failed
     */
    public function markAsFailed(string $errorMessage): void {
        $this->update([
            'status' => 'failed',
            'error_message' => $errorMessage,
            'completed_at' => now(),
        ]);
    }

    /**
     * Get total number of device assignments
     */
    public function getAssignmentsCountAttribute(): int {
        return $this->assignments()->count();
    }

    /**
     * Get completed assignment count
     */
    public function getCompletedAssignmentsCountAttribute(): int {
        return $this->assignments()
            ->where('status', 'completed')
            ->count();
    }

    /**
     * Get failed assignment count
     */
    public function getFailedAssignmentsCountAttribute(): int {
        return $this->assignments()
            ->where('status', 'failed')
            ->count();
    }

    /**
     * Check if task is completed
     */
    public function isCompleted(): bool {
        return $this->status === 'completed';
    }

    /**
     * Check if task is running
     */
    public function isRunning(): bool {
        return $this->status === 'running';
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

    /**
     * Get success rate for this task
     */
    public function getSuccessRateAttribute(): float {
        $totalAssignments = $this->assignments()->count();

        if ($totalAssignments === 0) {
            return 0.0;
        }

        $completedAssignments = $this->assignments()
            ->where('status', 'completed')
            ->count();

        return round(($completedAssignments / $totalAssignments) * 100, 2);
    }
}
