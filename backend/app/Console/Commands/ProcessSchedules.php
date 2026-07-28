<?php

namespace App\Console\Commands;

use App\Services\ScheduleRunner;
use Illuminate\Console\Command;

class ProcessSchedules extends Command {
    protected $signature = 'schedules:process';
    protected $description = 'Evalúa los schedules activos y lanza sus rutinas cuando toca';

    public function handle(ScheduleRunner $runner): int {
        $fired = $runner->tick();
        if ($fired > 0) {
            $this->info("Schedules disparados: {$fired}");
        }
        return Command::SUCCESS;
    }
}
