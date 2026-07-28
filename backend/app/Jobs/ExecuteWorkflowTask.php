<?php

namespace App\Jobs;

use App\Models\Task;
use App\Models\Workflow;
use App\Services\TaskExecutionService;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\DB;

class ExecuteWorkflowTask implements ShouldQueue {
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public function __construct(public Task $task) {}

    public function handle(TaskExecutionService $service): void {
        $this->task->markAsRunning();

        $workflow = Workflow::findOrFail($this->task->workflow_id);
        $assignments = \App\Models\TaskAssignment::where('task_id', $this->task->id)
            ->where('status', 'assigned')
            ->get();

        $anyRan = false;

        foreach ($assignments as $assignment) {
            $device = \App\Models\Device::find($assignment->device_id);
            // El dispatcher ya puso el dispositivo en 'busy' para esta tarea; solo se
            // salta si está realmente inalcanzable (offline/error).
            if (!$device || in_array($device->status, ['offline', 'error'], true)) {
                continue;
            }
            $anyRan = true;

            $assignment->update([
                'status' => 'running',
                'device_serial' => $device->serial_number,
                'started_at' => now(),
            ]);

            $stepResults = [];
            $failed = false;

            foreach ($workflow->steps as $index => $step) {
                $stepJob = new ExecuteWorkflowStep($device, $step, $this->task->id, $index);
                $result = $stepJob->execute($service);

                $stepResults[] = [
                    'step' => $step['type'],
                    'success' => $result['success'],
                    'message' => $result['message'],
                ];

                if (!$result['success']) {
                    $failed = true;
                    break;
                }
            }

            $assignment->update([
                'status' => $failed ? 'failed' : 'completed',
                'error_message' => $failed ? end($stepResults)['message'] : null,
                'completed_at' => now(),
            ]);

            // Liberar el dispositivo para la siguiente rutina
            $device->update(['status' => 'online', 'current_task_id' => null]);

            if ($failed) {
                $this->task->markAsFailed("Fallo en dispositivo {$device->serial_number}");
                break;
            } else {
                $this->task->markAsCompleted(['steps' => $stepResults]);
            }
        }

        // Si ningún dispositivo estaba disponible, no dejar la tarea colgada en 'running'
        if (!$anyRan && $this->task->fresh()->status === 'running') {
            $this->task->markAsFailed('Ningún dispositivo disponible en el momento de ejecutar');
        }
    }
}
