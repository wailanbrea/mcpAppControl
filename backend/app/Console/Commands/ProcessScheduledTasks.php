<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use App\Services\TaskScheduler;
use App\Services\NotificationService;

class ProcessScheduledTasks extends Command {
    protected $signature = 'tasks:process';
    protected $description = 'Procesa tareas programadas y recurrentes';

    public function handle(TaskScheduler $scheduler, NotificationService $notifications): int {
        $this->info('Procesando tareas programadas...');

        // Process scheduled tasks
        $processed = $scheduler->processScheduledTasks();
        $this->info("Tareas procesadas: {$processed}");

        // Process recurring tasks
        $recurringProcessed = $scheduler->processRecurringTasks();
        $this->info("Tareas recurrentes actualizadas: {$recurringProcessed}");

        // Check scheduler stats and send alerts if needed
        $stats = $scheduler->getStats();

        if ($stats['tasks_due_now'] > 0) {
            $this->warn("Advertencia: Hay {$stats['tasks_due_now']} tareas pendientes sin procesar");
        }

        // Check device health and notify if needed
        $onlineDevices = \App\Models\Device::where('status', 'online')->count();
        $totalDevices = \App\Models\Device::count();

        if ($totalDevices > 0) {
            $notifications->notifyLowOnlineDevices($onlineDevices, $totalDevices);
        }

        $this->info('Procesamiento completado');

        return Command::SUCCESS;
    }
}
