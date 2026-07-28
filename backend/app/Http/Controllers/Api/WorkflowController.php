<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Workflow;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class WorkflowController extends Controller {
    /**
     * Get all workflows with optional filtering
     */
    public function index(Request $request) {
        $query = Workflow::with(['createdBy', 'targetDevices:id,name,serial_number,status']);

        // Filter by status if provided
        if ($request->has('status')) {
            $query->where('status', $request->status);
        }

        // Search by name
        if ($request->has('search')) {
            $query->where('name', 'like', '%' . $request->search . '%');
        }

        // Paginate results
        $workflows = $query->paginate(20);

        return response()->json([
            'success' => true,
            'data' => $workflows,
        ]);
    }

    /**
     * Get a single workflow by ID
     */
    public function show($id) {
        $workflow = Workflow::with(['createdBy', 'tasks', 'targetDevices:id,name,serial_number,status'])->findOrFail($id);

        return response()->json([
            'success' => true,
            'data' => $workflow,
        ]);
    }

    /**
     * Create a new workflow
     */
    public function store(Request $request) {
        $validated = $request->validate([
            'name' => 'required|string|max:255',
            'description' => 'nullable|string',
            'steps' => 'required|array|min:1',
            'allowed_package' => 'nullable|string|max:255',
            'device_ids' => 'nullable|array',
            'device_ids.*' => 'integer|distinct|exists:devices,id',
        ]);

        // Validate workflow steps structure
        $this->validateWorkflowSteps($validated['steps']);

        $workflow = Workflow::create([
            ...collect($validated)->except('device_ids')->all(),
            'created_by' => auth()->id(),
            'status' => 'draft',
        ]);
        $workflow->targetDevices()->sync($validated['device_ids'] ?? []);

        return response()->json([
            'success' => true,
            'data' => $workflow->fresh('targetDevices'),
            'message' => 'Workflow created successfully',
        ], 201);
    }

    /**
     * Update a workflow
     */
    public function update(Request $request, Workflow $workflow) {
        $validated = $request->validate([
            'name' => 'sometimes|string|max:255',
            'description' => 'nullable|string',
            'steps' => 'sometimes|array|min:1',
            'allowed_package' => 'nullable|string|max:255',
            'status' => 'sometimes|in:draft,active,inactive',
            'device_ids' => 'sometimes|array',
            'device_ids.*' => 'integer|distinct|exists:devices,id',
        ]);

        // Validate workflow steps structure if provided
        if (isset($validated['steps'])) {
            $this->validateWorkflowSteps($validated['steps']);
        }

        $workflow->update(collect($validated)->except('device_ids')->all());
        if (array_key_exists('device_ids', $validated)) {
            $workflow->targetDevices()->sync($validated['device_ids']);
        }

        return response()->json([
            'success' => true,
            'data' => $workflow->fresh('targetDevices'),
            'message' => 'Workflow updated successfully',
        ]);
    }

    /**
     * Delete a workflow
     */
    public function destroy(Workflow $workflow) {
        // Check if workflow is currently being used by active tasks
        $activeTasks = DB::table('tasks')
            ->where('workflow_id', $workflow->id)
            ->whereIn('status', ['scheduled', 'running'])
            ->count();

        if ($activeTasks > 0) {
            return response()->json([
                'success' => false,
                'message' => "Cannot delete workflow with {$activeTasks} active tasks",
            ], 422);
        }

        $workflow->delete();

        return response()->json([
            'success' => true,
            'message' => 'Workflow deleted successfully',
        ]);
    }

    /**
     * Validate workflow steps structure
     */
    private function validateWorkflowSteps(array $steps): void {
        foreach ($steps as $index => $step) {
            if (!isset($step['type'])) {
                throw new \InvalidArgumentException("Step at index {$index} missing 'type' field");
            }

            // Validate step type and required fields
            switch ($step['type']) {
                case 'OPEN_APP':
                    if (empty($step['packageName'])) {
                        throw new \InvalidArgumentException("Step '{$step['type']}' requires 'packageName'");
                    }
                    break;

                case 'CLICK_BY_TEXT':
                    if (empty($step['text'])) {
                        throw new \InvalidArgumentException("Step '{$step['type']}' requires 'text'");
                    }
                    break;

                case 'CLICK_BY_ID':
                    if (empty($step['resourceId'])) {
                        throw new \InvalidArgumentException("Step '{$step['type']}' requires 'resourceId'");
                    }
                    break;

                case 'SET_TEXT':
                    if (empty($step['resourceId']) || empty($step['value'])) {
                        throw new \InvalidArgumentException("Step '{$step['type']}' requires 'resourceId' and 'value'");
                    }
                    break;

                case 'PLAY_MEDIA':
                    if (!isset($step['durationSeconds'])) {
                        throw new \InvalidArgumentException("Step '{$step['type']}' requires 'durationSeconds'");
                    }
                    break;

                case 'WAIT_FOR_ELEMENT':
                    if (empty($step['text']) && empty($step['resourceId'])) {
                        throw new \InvalidArgumentException("Step '{$step['type']}' requires 'text' or 'resourceId'");
                    }
                    break;

                default:
                    // Allow custom step types but log a warning
                    logger()->warning("Unknown workflow step type: {$step['type']}");
            }
        }
    }

    /**
     * Execute a workflow now on the given devices/group (or all online devices)
     */
    public function execute(Request $request, Workflow $workflow, \App\Services\WorkflowDispatcher $dispatcher) {
        $validated = $request->validate([
            'device_ids' => 'nullable|array',
            'device_ids.*' => 'exists:devices,id',
            'group_id' => 'nullable|exists:device_groups,id',
            'params' => 'nullable|array',
        ]);

        $result = $dispatcher->dispatch(
            $workflow,
            $validated['group_id'] ?? null,
            $validated['params'] ?? [],
            $validated['device_ids'] ?? null
        );

        if (!$result['task']) {
            return response()->json([
                'success' => false,
                'message' => $result['message'],
            ], 422);
        }

        return response()->json([
            'success' => true,
            'data' => [
                'task' => $result['task'],
                'devices_assigned' => $result['devices_assigned'],
            ],
            'message' => $result['message'],
        ], 201);
    }

    /**
     * Validate workflow steps (the stored ones, or the ones in the request body)
     */
    public function validateWorkflow(Request $request, Workflow $workflow) {
        $steps = $request->input('steps', $workflow->steps);

        try {
            $this->validateWorkflowSteps($steps ?? []);
        } catch (\InvalidArgumentException $e) {
            return response()->json([
                'success' => true,
                'data' => ['valid' => false, 'error' => $e->getMessage()],
            ]);
        }

        return response()->json([
            'success' => true,
            'data' => ['valid' => true, 'steps_count' => count($steps ?? [])],
        ]);
    }

    /**
     * Get workflow execution statistics
     */
    public function stats(Workflow $workflow) {
        $totalTasks = DB::table('tasks')
            ->where('workflow_id', $workflow->id)
            ->count();

        $completedTasks = DB::table('tasks')
            ->where('workflow_id', $workflow->id)
            ->where('status', 'completed')
            ->count();

        $failedTasks = DB::table('tasks')
            ->where('workflow_id', $workflow->id)
            ->where('status', 'failed')
            ->count();

        $successRate = $totalTasks > 0 ? round(($completedTasks / $totalTasks) * 100, 2) : 0;

        return response()->json([
            'success' => true,
            'data' => [
                'total_tasks' => $totalTasks,
                'completed_tasks' => $completedTasks,
                'failed_tasks' => $failedTasks,
                'success_rate' => $successRate . '%',
            ],
        ]);
    }
}
