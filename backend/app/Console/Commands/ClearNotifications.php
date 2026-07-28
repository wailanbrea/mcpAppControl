<?php

namespace App\Console\Commands;

use App\Services\NotificationService;
use Illuminate\Console\Command;

class ClearNotifications extends Command {
    protected $signature = 'notifications:clear';
    protected $description = 'Elimina notificaciones con más de 30 días de antigüedad';

    public function handle(NotificationService $notifications): int {
        $deleted = $notifications->clearOld();
        $this->info("Notificaciones eliminadas: {$deleted}");

        return Command::SUCCESS;
    }
}
