<?php

namespace App\Services;

use App\Models\Task;
use App\Models\Workflow;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

class TaskScheduler {
    /**
     * Process all scheduled tasks that are due
     */
    public function processScheduledTasks(): int {
        $now = now();

        // Find tasks that should run now
        $dueTasks = Task::where('status', 'scheduled')
            ->where('scheduled_at', '<=', $now)
            ->get();

        $processed = 0;

        foreach ($dueTasks as $task) {
            try {
                // Update task status to running
                $task->update([
                    'status' => 'running',
                    'started_at' => now(),
                ]);

                // Execute the workflow
                $this->executeTask($task);

                $processed++;
            } catch (\Exception $e) {
                Log::error("Error processing scheduled task {$task->id}: " . $e->getMessage());

                $task->update([
                    'status' => 'failed',
                    'error_message' => $e->getMessage(),
                    'completed_at' => now(),
                ]);

                DB::table('execution_logs')->insert([
                    'task_id' => $task->id,
                    'command_type' => 'SCHEDULER',
                    'success' => false,
                    'message' => "Scheduler error: {$e->getMessage()}",
                    'timestamp' => now(),
                    'created_at' => now(),
                    'updated_at' => now(),
                ]);
            }
        }

        return $processed;
    }

    /**
     * Execute a task on assigned devices
     */
    private function executeTask(Task $task): void {
        $workflow = Workflow::findOrFail($task->workflow_id);

        // Get all online devices for this workflow
        if (!empty($task->params)) {
            $params = is_string($task->params) ? json_decode($task->params, true) : $task->params;

            if (isset($params['group_id'])) {
                $devices = \App\Models\Device::where('assigned_group_id', $params['group_id'])
                    ->where('status', 'online')
                    ->get();
            } elseif (isset($params['device_ids'])) {
                $devices = \App\Models\Device::whereIn('id', $params['device_ids'])->get();
            } else {
                $devices = \App\Models\Device::where('status', 'online')->get();
            }
        } else {
            $devices = \App\Models\Device::where('status', 'online')->get();
        }

        if ($devices->isEmpty()) {
            $task->update([
                'status' => 'failed',
                'error_message' => 'No hay dispositivos disponibles',
                'completed_at' => now(),
            ]);
            return;
        }

        // Execute workflow steps on each device
        foreach ($devices as $device) {
            $this->executeWorkflowOnDevice($task, $workflow, $device);
        }

        Log::info("Task {$task->external_id} executed on {$devices->count()} devices");
    }

    /**
     * Execute workflow steps on a single device
     */
    private function executeWorkflowOnDevice(Task $task, Workflow $workflow, \App\Models\Device $device): void {
        $stepResults = [];
        $failed = false;

        foreach ($workflow->steps as $index => $step) {
            try {
                // Use ExecuteWorkflowStep job
                $job = new \App\Jobs\ExecuteWorkflowStep($device, $step, $task->id, $index);
                $result = $job->execute(app(TaskExecutionService::class));

                $stepResults[] = [
                    'step' => $step['type'],
                    'success' => $result['success'],
                    'message' => $result['message'],
                    'timestamp' => $result['timestamp'] ?? now()->toISOString(),
                ];

                if (!$result['success']) {
                    // ExecuteWorkflowStep ya registra el fallo en execution_logs
                    $failed = true;
                    break;
                }
            } catch (\Exception $e) {
                Log::error("Error executing step on device {$device->serial_number}: " . $e->getMessage());

                DB::table('execution_logs')->insert([
                    'task_id' => $task->id,
                    'device_serial' => $device->serial_number,
                    'command_type' => $step['type'],
                    'success' => false,
                    'message' => $e->getMessage(),
                    'timestamp' => now(),
                    'created_at' => now(),
                    'updated_at' => now(),
                ]);

                $failed = true;
                break;
            }
        }

        // Update task status based on results
        if ($failed) {
            $task->update([
                'status' => 'failed',
                'error_message' => "Fallo en dispositivo {$device->serial_number}",
                'completed_at' => now(),
            ]);
        } else {
            $task->markAsCompleted(['steps' => $stepResults, 'device' => $device->serial_number]);

            // Reset device status
            $device->update([
                'status' => 'online',
                'current_task_id' => null,
            ]);
        }
    }

    /**
     * Schedule a recurring task
     */
    public function scheduleRecurringTask(
        int $workflowId,
        string $interval,
        array $params = [],
        ?int $maxExecutions = null
    ): Task {
        // Parse interval (e.g., "1h", "30m", "1d")
        $nextRun = $this->calculateNextRun($interval);

        $task = Task::create([
            'external_id' => 'recurring-' . \Illuminate\Support\Str::uuid(),
            'workflow_id' => $workflowId,
            'params' => json_encode(array_merge($params, [
                'recurring' => true,
                'interval' => $interval,
                'max_executions' => $maxExecutions,
                'execution_count' => 0,
            ])),
            'status' => 'scheduled',
            'scheduled_at' => $nextRun,
        ]);

        Log::info("Recurring task created: {$task->external_id}, interval: {$interval}");

        return $task;
    }

    /**
     * Calculate next run time based on interval
     */
    private function calculateNextRun(string $interval): \DateTime {
        $now = new \DateTime();

        switch (true) {
            case str_ends_with($interval, 'd'):
                $days = (int) rtrim($interval, 'd');
                $now->modify("+{$days} days");
                break;

            case str_ends_with($interval, 'h'):
                $hours = (int) rtrim($interval, 'h');
                $now->modify("+{$hours} hours");
                break;

            case str_ends_with($interval, 'm'):
                $minutes = (int) rtrim($interval, 'm');
                $now->modify("+{$minutes} minutes");
                break;

            default:
                // Assume seconds
                $seconds = (int) $interval;
                $now->modify("+{$seconds} seconds");
        }

        return $now;
    }

    /**
     * Check and update recurring tasks
     */
    public function processRecurringTasks(): int {
        $recurringTasks = Task::whereRaw("JSON_EXTRACT(params, '$.recurring') = true")
            ->get();

        $processed = 0;

        foreach ($recurringTasks as $task) {
            $params = is_string($task->params) ? json_decode($task->params, true) : $task->params;

            // Check if max executions reached
            if (isset($params['max_executions']) && $params['execution_count'] >= $params['max_executions']) {
                $task->update(['status' => 'completed']);
                continue;
            }

            // If task is completed/failed, schedule next execution
            if (in_array($task->status, ['completed', 'failed'])) {
                $executionCount = ($params['execution_count'] ?? 0) + 1;

                // Update params with new count and next run time
                $newParams = array_merge($params, [
                    'execution_count' => $executionCount,
                ]);

                $nextRun = $this->calculateNextRun($params['interval']);

                $task->update([
                    'status' => 'scheduled',
                    'scheduled_at' => $nextRun,
                    'completed_at' => null,
                    'started_at' => null,
                    'error_message' => null,
                    'params' => json_encode($newParams),
                ]);

                $processed++;
            }
        }

        return $processed;
    }

    /**
     * Get scheduler statistics
     */
    public function getStats(): array {
        $now = now();

        return [
            'total_scheduled' => Task::where('status', 'scheduled')->count(),
            'total_running' => Task::where('status', 'running')->count(),
            'recurring_tasks' => Task::whereRaw("JSON_EXTRACT(params, '$.recurring') = true")->count(),
            'tasks_due_now' => Task::where('status', 'scheduled')
                ->where('scheduled_at', '<=', $now)
                ->count(),
        ];
    }
}
