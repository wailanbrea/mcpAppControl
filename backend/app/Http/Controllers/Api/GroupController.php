<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\DeviceGroup;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class GroupController extends Controller {
    /**
     * Get all device groups with optional filtering
     */
    public function index(Request $request) {
        $query = DeviceGroup::with(['devices']);

        // Search by name
        if ($request->has('search')) {
            $query->where('name', 'like', '%' . $request->search . '%');
        }

        // Paginate results
        $groups = $query->paginate(20);

        return response()->json([
            'success' => true,
            'data' => $groups,
        ]);
    }

    /**
     * Get a single group by ID
     */
    public function show($id) {
        $group = DeviceGroup::with(['devices'])->findOrFail($id);

        // Calculate group statistics
        $totalDevices = $group->devices()->count();
        $onlineDevices = $group->devices()->where('status', 'online')->count();
        $busyDevices = $group->devices()->where('status', 'busy')->count();

        return response()->json([
            'success' => true,
            'data' => [
                'group' => $group,
                'statistics' => [
                    'total_devices' => $totalDevices,
                    'online_devices' => $onlineDevices,
                    'busy_devices' => $busyDevices,
                ],
            ],
        ]);
    }

    /**
     * Create a new device group
     */
    public function store(Request $request) {
        $validated = $request->validate([
            'name' => 'required|string|max:255',
            'description' => 'nullable|string',
            'max_devices' => 'nullable|integer|min:1',
        ]);

        // Check if group name already exists
        if (DeviceGroup::where('name', $validated['name'])->exists()) {
            return response()->json([
                'success' => false,
                'message' => 'Group with this name already exists',
            ], 422);
        }

        $group = DeviceGroup::create($validated);

        return response()->json([
            'success' => true,
            'data' => $group->fresh(),
            'message' => 'Device group created successfully',
        ], 201);
    }

    /**
     * Update a device group
     */
    public function update(Request $request, DeviceGroup $group) {
        $validated = $request->validate([
            'name' => 'sometimes|string|max:255|unique:device_groups,name,' . $group->id,
            'description' => 'nullable|string',
            'max_devices' => 'nullable|integer|min:1',
        ]);

        // Check if max_devices limit would be exceeded
        if (isset($validated['max_devices'])) {
            $currentDevices = DB::table('devices')
                ->where('assigned_group_id', $group->id)
                ->count();

            if ($currentDevices > $validated['max_devices']) {
                return response()->json([
                    'success' => false,
                    'message' => "Cannot reduce max_devices below current device count ({$currentDevices})",
                ], 422);
            }
        }

        $group->update($validated);

        return response()->json([
            'success' => true,
            'data' => $group->fresh(),
            'message' => 'Device group updated successfully',
        ]);
    }

    /**
     * Delete a device group
     */
    public function destroy(DeviceGroup $group) {
        // Check if group has devices assigned
        $deviceCount = DB::table('devices')
            ->where('assigned_group_id', $group->id)
            ->count();

        if ($deviceCount > 0) {
            return response()->json([
                'success' => false,
                'message' => "Cannot delete group with {$deviceCount} assigned devices",
            ], 422);
        }

        $group->delete();

        return response()->json([
            'success' => true,
            'message' => 'Device group deleted successfully',
        ]);
    }

    /**
     * Assign devices to a group
     */
    public function assignDevices(Request $request, DeviceGroup $group) {
        $validated = $request->validate([
            'device_ids' => 'required|array',
            'device_ids.*' => 'exists:devices,id',
        ]);

        // Check if adding these devices would exceed max_devices limit
        $currentDeviceCount = DB::table('devices')
            ->where('assigned_group_id', $group->id)
            ->count();

        $newDevicesCount = count($validated['device_ids']);

        if ($group->max_devices && ($currentDeviceCount + $newDevicesCount) > $group->max_devices) {
            return response()->json([
                'success' => false,
                'message' => "Adding {$newDevicesCount} devices would exceed group limit of {$group->max_devices}",
            ], 422);
        }

        // Assign devices to group
        DB::table('devices')
            ->whereIn('id', $validated['device_ids'])
            ->update([
                'assigned_group_id' => $group->id,
                'updated_at' => now(),
            ]);

        return response()->json([
            'success' => true,
            'message' => "Assigned " . count($validated['device_ids']) . " devices to group",
        ]);
    }

    /**
     * Pause a group: its devices stop receiving new task assignments
     */
    public function pause(DeviceGroup $group) {
        $group->update(['paused_at' => now()]);

        return response()->json([
            'success' => true,
            'data' => $group->fresh(),
            'message' => 'Group paused',
        ]);
    }

    /**
     * Resume a paused group
     */
    public function resume(DeviceGroup $group) {
        $group->update(['paused_at' => null]);

        return response()->json([
            'success' => true,
            'data' => $group->fresh(),
            'message' => 'Group resumed',
        ]);
    }

    /**
     * Remove devices from a group
     */
    public function removeDevices(Request $request, DeviceGroup $group) {
        $validated = $request->validate([
            'device_ids' => 'required|array',
            'device_ids.*' => 'exists:devices,id',
        ]);

        // Remove devices from group
        DB::table('devices')
            ->whereIn('id', $validated['device_ids'])
            ->update([
                'assigned_group_id' => null,
                'updated_at' => now(),
            ]);

        return response()->json([
            'success' => true,
            'message' => "Removed " . count($validated['device_ids']) . " devices from group",
        ]);
    }
}
