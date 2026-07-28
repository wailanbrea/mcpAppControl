<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Device;
use App\Services\NotificationService;
use App\Services\AdbScreenCaptureService;
use App\Services\TaskExecutionService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class DeviceController extends Controller {
    /**
     * Get all devices with optional filtering
     */
    public function index(Request $request) {
        $query = Device::with(['assignedGroup', 'currentTask']);

        // Filter by status if provided
        if ($request->has('status')) {
            $query->where('status', $request->status);
        }

        // Search by name or serial number
        if ($request->has('search')) {
            $query->where(function($q) use ($request) {
                $q->where('name', 'like', '%' . $request->search . '%')
                  ->orWhere('serial_number', 'like', '%' . $request->search . '%');
            });
        }

        $validated = $request->validate([
            'per_page' => ['nullable', 'integer', 'min:1', 'max:100'],
        ]);

        $devices = $query
            ->orderByRaw("CASE status WHEN 'online' THEN 0 WHEN 'busy' THEN 1 WHEN 'error' THEN 2 ELSE 3 END")
            ->orderBy('id')
            ->paginate($validated['per_page'] ?? 20);

        return response()->json([
            'success' => true,
            'data' => $devices,
        ]);
    }

    /**
     * Get a single device by ID or serial number
     */
    public function show($identifier) {
        // Try to find by ID first, then by serial number
        $device = Device::with(['assignedGroup', 'currentTask'])
            ->where(function($q) use ($identifier) {
                if (ctype_digit($identifier)) {
                    $q->where('id', $identifier);
                } else {
                    $q->where('serial_number', $identifier);
                }
            })
            ->first();

        if (!$device) {
            return response()->json([
                'success' => false,
                'message' => 'Device not found',
            ], 404);
        }

        // Get recent execution logs for this device
        $logs = DB::table('execution_logs')
            ->where('device_serial', $device->serial_number)
            ->orderBy('timestamp', 'desc')
            ->limit(50)
            ->get();

        return response()->json([
            'success' => true,
            'data' => [
                'device' => $device,
                'recent_logs' => $logs,
            ],
        ]);
    }

    /**
     * Register a device (idempotent: re-registering an existing serial updates it).
     * Called both manually and by the WS server when an agent connects.
     */
    public function store(Request $request) {
        $validated = $request->validate([
            'serial_number' => 'required|string|max:255',
            'name' => 'nullable|string|max:255',
            'model' => 'nullable|string|max:255',
            'android_version' => 'nullable|string|max:50',
            'status' => 'nullable|in:online,offline,busy,error',
            'transport' => 'nullable|in:agent,adb',
            'adb_serial' => 'nullable|string|max:128',
        ]);

        $device = Device::firstOrNew(['serial_number' => $validated['serial_number']]);

        $device->fill(array_filter([
            'name' => $validated['name'] ?? null,
            'model' => $validated['model'] ?? null,
            'android_version' => $validated['android_version'] ?? null,
            'status' => $validated['status'] ?? null,
            'transport' => $validated['transport'] ?? null,
            'adb_serial' => $validated['adb_serial'] ?? null,
        ], fn($v) => $v !== null));

        if (!$device->exists) {
            $device->name = $device->name ?? 'Device ' . $validated['serial_number'];
            $device->model = $device->model ?? 'unknown';
            $device->android_version = $device->android_version ?? 'unknown';
            $device->status = $device->status ?? 'offline';
        }

        $device->last_seen = now();
        $device->save();

        return response()->json([
            'success' => true,
            'data' => $device,
            'message' => 'Device registered successfully',
        ], 201);
    }

    /**
     * Acción rápida por lotes: ejecuta un comando/utilidad en varios dispositivos
     * a la vez, sin crear una rutina guardada. Reutiliza TaskExecutionService para
     * despachar cada paso al router (transporte ADB o agente) y lo registra.
     */
    public function batchCommand(Request $request, \App\Services\TaskExecutionService $svc) {
        $validated = $request->validate([
            'device_ids' => 'required|array|min:1',
            'device_ids.*' => 'exists:devices,id',
            'command' => 'required|string|max:64',
            'params' => 'nullable|array',
        ]);

        $step = array_merge(['type' => $validated['command']], $validated['params'] ?? []);
        $results = [];

        foreach (Device::whereIn('id', $validated['device_ids'])->get() as $device) {
            $r = $svc->executeStep($device, $step, 0);

            DB::table('execution_logs')->insert([
                'device_serial' => $device->serial_number,
                'command_type' => $validated['command'],
                'success' => $r['success'],
                'message' => $r['message'] ?? null,
                'result_data' => json_encode($r['data'] ?? []),
                'timestamp' => now(),
                'created_at' => now(),
                'updated_at' => now(),
            ]);

            $results[] = [
                'device' => $device->serial_number,
                'success' => (bool) $r['success'],
                'message' => $r['message'] ?? null,
            ];
        }

        $ok = count(array_filter($results, fn($x) => $x['success']));
        return response()->json([
            'success' => true,
            'data' => [
                'total' => count($results),
                'ok' => $ok,
                'failed' => count($results) - $ok,
                'results' => $results,
            ],
        ]);
    }

    /**
     * Heartbeat from the WS server for a connected device
     */
    public function heartbeat(Request $request) {
        $validated = $request->validate([
            'serial_number' => 'required|string',
            'status' => 'nullable|in:online,offline,busy,error',
        ]);

        $device = Device::where('serial_number', $validated['serial_number'])->first();

        if (!$device) {
            return response()->json([
                'success' => false,
                'message' => 'Device not found',
            ], 404);
        }

        $device->update([
            'status' => $validated['status'] ?? 'online',
            'last_seen' => now(),
        ]);

        return response()->json(['success' => true]);
    }

    /**
     * Store the result of a command executed on a device (from the WS server)
     */
    public function commandResult(Request $request, string $serial) {
        $validated = $request->validate([
            'command_type' => 'required|string',
            'success' => 'required|boolean',
            'message' => 'nullable|string',
            'result_data' => 'nullable|array',
            'task_id' => 'nullable|integer|exists:tasks,id',
        ]);

        DB::table('execution_logs')->insert([
            'task_id' => $validated['task_id'] ?? null,
            'device_serial' => $serial,
            'command_type' => $validated['command_type'],
            'success' => $validated['success'],
            'message' => $validated['message'] ?? null,
            'result_data' => json_encode($validated['result_data'] ?? []),
            'timestamp' => now(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        return response()->json(['success' => true]);
    }

    /**
     * Store a screenshot uploaded by a device (from the WS server)
     */
    public function screenshot(Request $request, string $serial) {
        $validated = $request->validate([
            'image_data' => 'required|string',
        ]);

        $screenshot = \App\Models\Screenshot::create([
            'device_serial' => $serial,
            'image_data' => $validated['image_data'],
            'timestamp' => now(),
        ]);

        return response()->json(['success' => true, 'data' => ['id' => $screenshot->id]], 201);
    }

    /**
     * Captures a single frame for the authenticated dashboard viewer.
     * The image is returned directly and is intentionally not persisted.
     */
    public function screenFrame(Device $device, TaskExecutionService $taskExecutionService, AdbScreenCaptureService $adbScreenCaptureService) {
        if (!in_array($device->status, ['online', 'busy'], true)) {
            return response()->json([
                'success' => false,
                'message' => 'El dispositivo no esta conectado.',
            ], 409);
        }

        $result = $device->adb_serial
            ? $adbScreenCaptureService->capture($device)
            : $taskExecutionService->captureFrame($device);

        if (!$result['success']) {
            return response()->json([
                'success' => false,
                'message' => $result['message'],
            ], 502);
        }

        return response()->json([
            'success' => true,
            'data' => [
                'image' => $result['image'],
                'mime' => $result['mime'] ?? 'image/png',
                'source' => $result['source'] ?? 'agent',
                'captured_at' => now()->toIso8601String(),
            ],
        ]);
    }

    /**
     * Store a free-form log line from a device (from the WS server)
     */
    public function log(Request $request, string $serial) {
        $validated = $request->validate([
            'message' => 'required|string',
            'success' => 'nullable|boolean',
            'task_id' => 'nullable|integer|exists:tasks,id',
        ]);

        DB::table('execution_logs')->insert([
            'task_id' => $validated['task_id'] ?? null,
            'device_serial' => $serial,
            'command_type' => 'AGENT_LOG',
            'success' => $validated['success'] ?? true,
            'message' => $validated['message'],
            'timestamp' => now(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        return response()->json(['success' => true]);
    }

    /**
     * Update device information
     */
    public function update(Request $request, Device $device) {
        $validated = $request->validate([
            'name' => 'sometimes|string|max:255',
            'adb_serial' => ['nullable', 'string', 'max:128', 'regex:/^[A-Za-z0-9._:-]+$/', 'unique:devices,adb_serial,' . $device->id],
            'model' => 'sometimes|string|max:255',
            'android_version' => 'sometimes|string|max:50',
            'assigned_group_id' => 'nullable|exists:device_groups,id',
        ]);

        $device->update($validated);

        return response()->json([
            'success' => true,
            'data' => $device->fresh(),
            'message' => 'Device updated successfully',
        ]);
    }

    /**
     * Delete a device
     */
    public function destroy(Device $device) {
        // Check if device is currently running a task
        if ($device->status === 'busy') {
            return response()->json([
                'success' => false,
                'message' => 'Cannot delete device while it is busy',
            ], 422);
        }

        $device->delete();

        return response()->json([
            'success' => true,
            'message' => 'Device deleted successfully',
        ]);
    }

    /**
     * Update device status (called by agent)
     */
    public function updateStatus(Request $request, Device $device) {
        $validated = $request->validate([
            'status' => 'required|in:online,offline,busy,error',
            'current_task_id' => 'nullable|integer',
        ]);

        // Update last_seen timestamp
        $validated['last_seen'] = now();

        // If status changed to online, send notification
        if ($device->status !== 'online' && $validated['status'] === 'online') {
            app(NotificationService::class)->notifyDeviceOnline(
                $device->serial_number,
                $device->name
            );
        }

        // If status changed to offline, send notification
        if ($device->status !== 'offline' && $validated['status'] === 'offline') {
            app(NotificationService::class)->notifyDeviceOffline(
                $device->serial_number,
                $device->name
            );
        }

        $device->update($validated);

        return response()->json([
            'success' => true,
            'data' => $device->fresh(),
        ]);
    }

    /**
     * Get device statistics
     */
    public function stats() {
        $totalDevices = Device::count();
        $onlineDevices = Device::where('status', 'online')->count();
        $busyDevices = Device::where('status', 'busy')->count();
        $offlineDevices = Device::where('status', 'offline')->count();

        // Get device health metrics
        $healthMetrics = [
            'total' => $totalDevices,
            'online' => $onlineDevices,
            'busy' => $busyDevices,
            'offline' => $offlineDevices,
            'health_percentage' => $totalDevices > 0 ? round(($onlineDevices / $totalDevices) * 100, 2) : 0,
        ];

        return response()->json([
            'success' => true,
            'data' => $healthMetrics,
        ]);
    }
}
