<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Schedule;
use App\Services\WorkflowDispatcher;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class ScheduleController extends Controller {
    public function index() {
        $schedules = Schedule::with(['workflow', 'group'])
            ->orderByDesc('is_active')
            ->orderBy('name')
            ->paginate(50);

        return response()->json(['success' => true, 'data' => $schedules]);
    }

    public function show(Schedule $schedule) {
        return response()->json([
            'success' => true,
            'data' => $schedule->load(['workflow', 'group']),
        ]);
    }

    public function store(Request $request) {
        $validated = $this->validatePayload($request);

        $schedule = Schedule::create($validated);

        return response()->json([
            'success' => true,
            'data' => $schedule->load(['workflow', 'group']),
            'message' => 'Schedule creado',
        ], 201);
    }

    public function update(Request $request, Schedule $schedule) {
        $validated = $this->validatePayload($request, true);
        $schedule->update($validated);

        return response()->json([
            'success' => true,
            'data' => $schedule->fresh()->load(['workflow', 'group']),
            'message' => 'Schedule actualizado',
        ]);
    }

    public function destroy(Schedule $schedule) {
        $schedule->delete();
        return response()->json(['success' => true, 'message' => 'Schedule eliminado']);
    }

    public function pause(Schedule $schedule) {
        $schedule->update(['is_active' => false]);
        return response()->json(['success' => true, 'data' => $schedule->fresh(), 'message' => 'Schedule pausado']);
    }

    public function resume(Schedule $schedule) {
        $schedule->update(['is_active' => true]);
        return response()->json(['success' => true, 'data' => $schedule->fresh(), 'message' => 'Schedule reanudado']);
    }

    /**
     * Dispara una vuelta inmediata de la rutina de este schedule.
     */
    public function runNow(Schedule $schedule, WorkflowDispatcher $dispatcher) {
        $schedule->loadMissing('workflow');

        if (!$schedule->workflow) {
            return response()->json(['success' => false, 'message' => 'La rutina no existe'], 422);
        }

        $result = $dispatcher->dispatch(
            $schedule->workflow,
            $schedule->group_id,
            ['schedule_id' => $schedule->id, 'schedule_name' => $schedule->name, 'manual' => true]
        );

        if (!$result['task']) {
            return response()->json(['success' => false, 'message' => $result['message']], 422);
        }

        $schedule->update(['last_run_at' => now()]);

        return response()->json([
            'success' => true,
            'data' => ['task' => $result['task'], 'devices_assigned' => $result['devices_assigned']],
            'message' => $result['message'],
        ], 201);
    }

    private function validatePayload(Request $request, bool $partial = false): array {
        $req = $partial ? 'sometimes|' : 'required|';

        $rules = [
            'name' => $req . 'string|max:255',
            'workflow_id' => $req . 'exists:workflows,id',
            'group_id' => 'nullable|exists:device_groups,id',
            'mode' => $req . Rule::in(['fixed_times', 'loop']),
            'times' => 'nullable|array',
            'times.*' => ['string', 'regex:/^([01]\d|2[0-3]):[0-5]\d$/'],
            'window_start' => ['nullable', 'regex:/^([01]\d|2[0-3]):[0-5]\d$/'],
            'window_end' => ['nullable', 'regex:/^([01]\d|2[0-3]):[0-5]\d$/'],
            'loop_gap_seconds' => 'nullable|integer|min:0|max:86400',
            'days_of_week' => 'nullable|array',
            'days_of_week.*' => 'integer|min:0|max:6',
            'is_active' => 'boolean',
        ];

        $validated = $request->validate($rules);

        // Coherencia por modo
        $mode = $validated['mode'] ?? $request->input('mode');
        if ($mode === 'fixed_times' && empty($validated['times']) && !$partial) {
            abort(response()->json(['success' => false, 'message' => 'El modo horas fijas requiere al menos una hora en "times"'], 422));
        }
        if ($mode === 'loop' && !$partial && (empty($validated['window_start']) || empty($validated['window_end']))) {
            abort(response()->json(['success' => false, 'message' => 'El modo bucle requiere window_start y window_end'], 422));
        }

        return $validated;
    }
}
