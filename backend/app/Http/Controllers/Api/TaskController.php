<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Task;
use App\Services\NotificationService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class TaskController extends Controller {
    /**
     * Get all tasks with optional filtering
     */
    public function index(Request $request) {
        $query = Task::with(['workflow', 'assignments.device']);

        // Filter by status if provided
        if ($request->has('status')) {
            $query->where('status', $request->status);
        }

        // Filter by workflow_id if provided
        if ($request->has('workflow_id')) {
            $query->where('workflow_id', $request->workflow_id);
        }

        // Search by external_id
        if ($request->has('search')) {
            $query->where('external_id', 'like', '%' . $request->search . '%');
        }

        // Paginate results
        $tasks = $query->paginate(20);

        return response()->json([
            'success' => true,
            'data' => $tasks,
        ]);
    }

    /**
     * Get a single task by ID or external_id
     */
    public function show($identifier) {
        // Try to find by ID first, then by external_id
        $task = Task::with(['workflow', 'assignments.device'])
            ->where(function($q) use ($identifier) {
                if (ctype_digit($identifier)) {
                    $q->where('id', $identifier);
                } else {
                    $q->where('external_id', $identifier);
                }
            })
            ->first();

        if (!$task) {
            return response()->json([
                'success' => false,
                'message' => 'Task not found',
            ], 404);
        }

        // Get execution logs for this task
        $logs = DB::table('execution_logs')
            ->where('task_id', $task->id)
            ->orderBy('timestamp', 'desc')
            ->get();

        return response()->json([
            'success' => true,
            'data' => [
                'task' => $task,
                'execution_logs' => $logs,
            ],
        ]);
    }

    /**
     * Create and schedule a new task
     */
    public function store(Request $request) {
        $validated = $request->validate([
            'workflow_id' => 'required|exists:workflows,id',
            'scheduled_at' => 'nullable|date|after:now',
            'params' => 'nullable|array',
            'device_ids' => 'nullable|array',
            'group_id' => 'nullable|exists:device_groups,id',
        ]);

        // Check if workflow is active
        $workflow = \App\Models\Workflow::findOrFail($validated['workflow_id']);

        if ($workflow->status !== 'active') {
            return response()->json([
                'success' => false,
                'message' => 'Workflow must be active to create tasks',
            ], 422);
        }

        // Generate external ID
        $validated['external_id'] = 'task-' . \Illuminate\Support\Str::uuid();

        // Set status based on scheduling
        if (isset($validated['scheduled_at'])) {
            $validated['status'] = 'scheduled';
        } else {
            $validated['status'] = 'running';
            $validated['started_at'] = now();
        }

        // Create task
        $task = Task::create($validated);

        // If immediate execution, assign to devices
        if ($task->status === 'running') {
            $this->assignTaskToDevices($task, $request);
        }

        return response()->json([
            'success' => true,
            'data' => $task->fresh(),
            'message' => 'Task created successfully',
        ], 201);
    }

    /**
     * Assign task to devices
     */
    private function assignTaskToDevices(Task $task, Request $request): void {
        $deviceIds = $request->input('device_ids');
        $groupId = $request->input('group_id');

        if ($groupId) {
            // Get all online devices in the group
            $devices = DB::table('devices')
                ->where('assigned_group_id', $groupId)
                ->where('status', 'online')
                ->get();
        } elseif ($deviceIds) {
            // Use specific device IDs
            $devices = DB::table('devices')
                ->whereIn('id', $deviceIds)
                ->where('status', 'online')
                ->get();
        } else {
            // Assign to all online devices, skipping paused groups
            $devices = DB::table('devices')
                ->leftJoin('device_groups', 'devices.assigned_group_id', '=', 'device_groups.id')
                ->where('devices.status', 'online')
                ->whereNull('device_groups.paused_at')
                ->select('devices.*')
                ->get();
        }

        foreach ($devices as $device) {
            DB::table('task_assignments')->insert([
                'task_id' => $task->id,
                'device_id' => $device->id,
                'status' => 'assigned',
                'created_at' => now(),
                'updated_at' => now(),
            ]);

            // Update device status to busy
            DB::table('devices')
                ->where('id', $device->id)
                ->update([
                    'current_task_id' => $task->id,
                    'status' => 'busy',
                ]);
        }
    }

    /**
     * Cancel a task
     */
    public function cancel(Task $task) {
        if (!in_array($task->status, ['scheduled', 'running'])) {
            return response()->json([
                'success' => false,
                'message' => "Cannot cancel task with status: {$task->status}",
            ], 422);
        }

        $task->update([
            'status' => 'cancelled',
            'completed_at' => now(),
        ]);

        // Reset device statuses
        DB::table('task_assignments')
            ->where('task_id', $task->id)
            ->get()
            ->each(function($assignment) {
                DB::table('devices')
                    ->where('id', $assignment->device_id)
                    ->update([
                        'current_task_id' => null,
                        'status' => 'online',
                    ]);
            });

        return response()->json([
            'success' => true,
            'data' => $task->fresh(),
            'message' => 'Task cancelled successfully',
        ]);
    }

    /**
     * Retry a failed task
     */
    public function retry(Task $task) {
        if ($task->status !== 'failed') {
            return response()->json([
                'success' => false,
                'message' => "Cannot retry task with status: {$task->status}",
            ], 422);
        }

        // Reset task status
        $task->update([
            'status' => 'running',
            'started_at' => now(),
            'completed_at' => null,
            'error_message' => null,
        ]);

        // Reassign to devices
        $this->assignTaskToDevices($task, new Request());

        return response()->json([
            'success' => true,
            'data' => $task->fresh(),
            'message' => 'Task retry initiated',
        ]);
    }

    /**
     * Get task execution statistics
     */
    public function stats() {
        $totalTasks = Task::count();
        $completedTasks = Task::where('status', 'completed')->count();
        $failedTasks = Task::where('status', 'failed')->count();
        $runningTasks = Task::where('status', 'running')->count();
        $scheduledTasks = Task::where('status', 'scheduled')->count();

        $successRate = $totalTasks > 0 ? round(($completedTasks / $totalTasks) * 100, 2) : 0;

        return response()->json([
            'success' => true,
            'data' => [
                'total_tasks' => $totalTasks,
                'completed_tasks' => $completedTasks,
                'failed_tasks' => $failedTasks,
                'running_tasks' => $runningTasks,
                'scheduled_tasks' => $scheduledTasks,
                'success_rate' => $successRate . '%',
            ],
        ]);
    }

    /**
     * Get daily activity report
     */
    public function dailyReport() {
        $startDate = now()->startOfDay();
        $endDate = now()->endOfDay();

        // Get tasks created today
        $todayTasks = Task::whereBetween('created_at', [$startDate, $endDate])
            ->selectRaw('status, COUNT(*) as count')
            ->groupBy('status')
            ->get()
            ->pluck('count', 'status');

        return response()->json([
            'success' => true,
            'data' => [
                'date' => now()->toDateString(),
                'tasks_created' => $todayTasks['completed'] ?? 0 + ($todayTasks['failed'] ?? 0) + ($todayTasks['running'] ?? 0),
                'tasks_completed' => $todayTasks['completed'] ?? 0,
                'tasks_failed' => $todayTasks['failed'] ?? 0,
            ],
        ]);
    }
}
