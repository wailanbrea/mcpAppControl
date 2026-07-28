<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use App\Models\Device;
use App\Models\Workflow;
use App\Models\Task;
use Illuminate\Support\Facades\DB;

class ExecuteWorkflow extends Command {
    protected $signature = 'workflow:execute';
    protected $description = 'Ejecuta un workflow en dispositivos específicos o todos';

    public function handle(): int {
        // Get all active workflows
        $workflows = Workflow::where('status', 'active')->get();

        if ($workflows->isEmpty()) {
            $this->error('No hay workflows activos');
            return Command::FAILURE;
        }

        $this->info('Workflows disponibles:');
        foreach ($workflows as $wf) {
            $this->line("  - [{$wf->id}] {$wf->name} ({$wf->steps_count} pasos)");
        }

        $workflowId = $this->choice('Selecciona un workflow',
            $workflows->pluck('id')->toArray(),
            0
        );

        $workflow = Workflow::findOrFail($workflowId);

        // Get target devices
        $onlineDevices = Device::where('status', 'online')->get();

        if ($onlineDevices->isEmpty()) {
            $this->error('No hay dispositivos en línea');
            return Command::FAILURE;
        }

        $this->info("Dispositivos en línea: {$onlineDevices->count()}");

        // Ask for confirmation
        $this->line("\nWorkflow a ejecutar: {$workflow->name}");
        $this->line("Pasos: " . count($workflow->steps));
        $this->line("Dispositivos objetivo: {$onlineDevices->count()}");

        if (!$this->confirm('¿Confirmar ejecución?')) {
            return Command::FAILURE;
        }

        // Create task
        $task = Task::create([
            'external_id' => 'task-' . \Illuminate\Support\Str::uuid(),
            'workflow_id' => $workflow->id,
            'params' => json_encode(['executed_by' => 'artisan', 'target_devices' => $onlineDevices->count()]),
            'status' => 'running',
            'started_at' => now(),
        ]);

        // Assign to all online devices
        foreach ($onlineDevices as $device) {
            DB::table('task_assignments')->insert([
                'task_id' => $task->id,
                'device_id' => $device->id,
                'status' => 'assigned',
                'created_at' => now(),
                'updated_at' => now(),
            ]);

            // Update device status
            $device->update([
                'current_task_id' => $task->id,
                'status' => 'busy',
            ]);
        }

        $this->info("Tarea creada: {$task->external_id}");
        $this->info("Asignada a {$onlineDevices->count()} dispositivos");

        return Command::SUCCESS;
    }
}
