<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class Schedule extends Model {
    use HasFactory;

    protected $fillable = [
        'name',
        'workflow_id',
        'group_id',
        'mode',
        'times',
        'window_start',
        'window_end',
        'loop_gap_seconds',
        'days_of_week',
        'is_active',
        'last_run_at',
        'next_run_at',
    ];

    protected $casts = [
        'times' => 'array',
        'days_of_week' => 'array',
        'is_active' => 'boolean',
        'loop_gap_seconds' => 'integer',
        'last_run_at' => 'datetime',
        'next_run_at' => 'datetime',
    ];

    public function workflow(): BelongsTo {
        return $this->belongsTo(Workflow::class);
    }

    public function group(): BelongsTo {
        return $this->belongsTo(DeviceGroup::class, 'group_id');
    }

    /**
     * ¿Toca ejecutar hoy según days_of_week? (null = todos los días)
     */
    public function runsToday(\DateTimeInterface $now): bool {
        if (empty($this->days_of_week)) {
            return true;
        }
        // Carbon dayOfWeek: 0=domingo..6=sábado
        return in_array((int) $now->format('w'), $this->days_of_week, true);
    }

    /**
     * ¿La hora actual coincide con alguna de las horas fijas (HH:MM)?
     */
    public function matchesFixedTime(\DateTimeInterface $now): bool {
        if ($this->mode !== 'fixed_times' || empty($this->times)) {
            return false;
        }
        return in_array($now->format('H:i'), $this->times, true);
    }

    /**
     * ¿Estamos dentro de la franja horaria del bucle?
     * Soporta franjas que cruzan medianoche (start > end).
     */
    public function isWithinWindow(\DateTimeInterface $now): bool {
        if ($this->mode !== 'loop' || !$this->window_start || !$this->window_end) {
            return false;
        }

        $current = $now->format('H:i');
        $start = substr((string) $this->window_start, 0, 5);
        $end = substr((string) $this->window_end, 0, 5);

        if ($start <= $end) {
            return $current >= $start && $current <= $end;
        }
        // franja que cruza medianoche
        return $current >= $start || $current <= $end;
    }

    /**
     * ¿Ya se lanzó esta hora fija hoy? (evita disparos duplicados dentro del mismo minuto)
     */
    public function alreadyRanThisMinute(\DateTimeInterface $now): bool {
        return $this->last_run_at
            && $this->last_run_at->format('Y-m-d H:i') === $now->format('Y-m-d H:i');
    }
}
