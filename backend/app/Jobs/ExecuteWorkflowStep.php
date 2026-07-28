<?php

namespace App\Jobs;

use App\Models\Device;
use App\Services\TaskExecutionService;
use Illuminate\Support\Facades\DB;

/**
 * Envoltorio de un paso de workflow sobre un dispositivo: delega la
 * ejecución real en TaskExecutionService y registra el resultado en
 * execution_logs.
 */
class ExecuteWorkflowStep implements \JsonSerializable {
    public function __construct(
        private Device $device,
        private array $step,
        private int $taskId,
        private int $stepIndex
    ) {}

    public function execute(TaskExecutionService $service): array {
        $result = $service->executeStep($this->device, $this->step, $this->stepIndex);
        $result['timestamp'] = now()->toISOString();

        DB::table('execution_logs')->insert([
            'task_id' => $this->taskId,
            'device_serial' => $this->device->serial_number,
            'command_type' => $this->step['type'],
            'success' => $result['success'],
            'message' => $result['message'],
            'result_data' => json_encode($result['data'] ?? []),
            'timestamp' => now(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        return $result;
    }

    public function jsonSerialize(): array {
        return [
            'step_index' => $this->stepIndex,
            'step_type' => $this->step['type'],
            'device_serial' => $this->device->serial_number,
            'task_id' => $this->taskId,
        ];
    }
}
