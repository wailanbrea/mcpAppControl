<?php

namespace App\Services;

use App\Models\Schedule;
use App\Models\Task;
use Illuminate\Support\Facades\Log;

/**
 * Evalúa los schedules activos cada minuto y lanza sus rutinas (workflows)
 * cuando toca, reutilizando WorkflowDispatcher.
 */
class ScheduleRunner {
    public function __construct(private WorkflowDispatcher $dispatcher) {}

    /**
     * Un "tick" del scheduler (llamado cada minuto). Devuelve nº de schedules disparados.
     */
    public function tick(): int {
        $now = now();
        $fired = 0;

        $schedules = Schedule::with('workflow')
            ->where('is_active', true)
            ->get();

        foreach ($schedules as $schedule) {
            try {
                if ($this->shouldFire($schedule, $now)) {
                    $this->fire($schedule, $now);
                    $fired++;
                }
            } catch (\Throwable $e) {
                Log::error("ScheduleRunner error en schedule {$schedule->id}: " . $e->getMessage());
            }
        }

        return $fired;
    }

    private function shouldFire(Schedule $schedule, \DateTimeInterface $now): bool {
        if (!$schedule->workflow || $schedule->workflow->status !== 'active') {
            return false;
        }
        if (!$schedule->runsToday($now)) {
            return false;
        }

        if ($schedule->mode === 'fixed_times') {
            // Dispara una vez por minuto coincidente
            return $schedule->matchesFixedTime($now) && !$schedule->alreadyRanThisMinute($now);
        }

        // modo loop
        if (!$schedule->isWithinWindow($now)) {
            return false;
        }
        // Protección de solape: no relanzar si aún hay una tarea de este schedule en curso
        if ($this->hasRunningTask($schedule)) {
            return false;
        }
        // Respetar la pausa entre vueltas
        if ($schedule->loop_gap_seconds > 0 && $schedule->last_run_at) {
            $elapsed = $now->getTimestamp() - $schedule->last_run_at->getTimestamp();
            if ($elapsed < $schedule->loop_gap_seconds) {
                return false;
            }
        }
        return true;
    }

    /**
     * ¿Hay una tarea lanzada por este schedule todavía en ejecución?
     */
    private function hasRunningTask(Schedule $schedule): bool {
        return Task::whereIn('status', ['scheduled', 'running'])
            ->whereRaw("JSON_EXTRACT(params, '$.schedule_id') = ?", [$schedule->id])
            ->exists();
    }

    private function fire(Schedule $schedule, \DateTimeInterface $now): void {
        $result = $this->dispatcher->dispatch(
            $schedule->workflow,
            $schedule->group_id,
            ['schedule_id' => $schedule->id, 'schedule_name' => $schedule->name]
        );

        $schedule->update(['last_run_at' => $now]);

        if ($result['task']) {
            Log::info("Schedule '{$schedule->name}' disparado en {$result['devices_assigned']} dispositivos");
        } else {
            Log::warning("Schedule '{$schedule->name}' sin dispositivos: {$result['message']}");
        }
    }
}
