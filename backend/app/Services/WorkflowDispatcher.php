<?php

namespace App\Services;

use App\Jobs\ExecuteWorkflowTask;
use App\Models\Device;
use App\Models\Task;
use App\Models\TaskAssignment;
use App\Models\Workflow;
use Illuminate\Support\Str;

/**
 * Lógica compartida para lanzar un workflow sobre un conjunto de dispositivos.
 * La usan tanto WorkflowController::execute (bajo demanda) como ScheduleRunner
 * (rutinas programadas). Crea la Task, las TaskAssignment, marca dispositivos
 * ocupados y despacha ExecuteWorkflowTask.
 */
class WorkflowDispatcher {
    /**
     * @return array{task: ?Task, devices_assigned: int, message: string}
     */
    public function dispatch(Workflow $workflow, ?int $groupId = null, array $params = [], ?array $deviceIds = null): array {
        if ($workflow->status !== 'active') {
            return ['task' => null, 'devices_assigned' => 0, 'message' => 'Workflow must be active to execute'];
        }

        // A group explicitly selected by a schedule takes precedence. Otherwise,
        // use the routine's saved device targets; legacy routines still use all online devices.
        if ($deviceIds === null && $groupId === null) {
            $configuredDeviceIds = $workflow->targetDevices()->pluck('devices.id')->all();
            $deviceIds = $configuredDeviceIds !== [] ? $configuredDeviceIds : null;
        }

        $devices = Device::where('status', 'online')
            ->when($groupId !== null, fn($q) => $q->where('assigned_group_id', $groupId))
            ->when($deviceIds !== null, fn($q) => $q->whereIn('id', $deviceIds))
            ->whereDoesntHave('assignedGroup', fn($q) => $q->whereNotNull('paused_at'))
            ->get();

        if ($devices->isEmpty()) {
            return ['task' => null, 'devices_assigned' => 0, 'message' => 'No online devices available'];
        }

        $task = Task::create([
            'external_id' => 'task-' . Str::uuid(),
            'workflow_id' => $workflow->id,
            'params' => $params,
            'status' => 'running',
            'started_at' => now(),
        ]);

        foreach ($devices as $device) {
            TaskAssignment::create([
                'task_id' => $task->id,
                'device_id' => $device->id,
                'device_serial' => $device->serial_number,
                'status' => 'assigned',
            ]);
            $device->update(['current_task_id' => $task->id, 'status' => 'busy']);
        }

        ExecuteWorkflowTask::dispatch($task);

        return [
            'task' => $task->fresh(),
            'devices_assigned' => $devices->count(),
            'message' => "Workflow dispatched to {$devices->count()} devices",
        ];
    }
}
