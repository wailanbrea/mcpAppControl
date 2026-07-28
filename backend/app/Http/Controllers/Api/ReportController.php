<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class ReportController extends Controller {
    /**
     * Get execution summary report
     */
    public function executionSummary(Request $request) {
        $period = $request->input('period', '7'); // Default to last 7 days

        $startDate = now()->subDays($period);

        // Get task statistics for the period
        $taskStats = DB::table('tasks')
            ->where('created_at', '>=', $startDate)
            ->selectRaw('status, COUNT(*) as count')
            ->groupBy('status')
            ->get()
            ->pluck('count', 'status');

        // Get device statistics for the period
        $deviceStats = DB::table('execution_logs')
            ->where('timestamp', '>=', $startDate)
            ->selectRaw('device_serial, COUNT(*) as total_commands,
                         SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as successful_commands')
            ->groupBy('device_serial')
            ->get();

        // Get workflow performance
        $workflowPerformance = DB::table('tasks')
            ->join('workflows', 'tasks.workflow_id', '=', 'workflows.id')
            ->where('tasks.created_at', '>=', $startDate)
            ->selectRaw('workflows.name,
                         COUNT(*) as total_tasks,
                         SUM(CASE WHEN tasks.status = "completed" THEN 1 ELSE 0 END) as completed_tasks')
            ->groupBy('workflows.id', 'workflows.name')
            ->get();

        return response()->json([
            'success' => true,
            'data' => [
                'period_days' => $period,
                'task_statistics' => [
                    'total_tasks' => array_sum($taskStats),
                    'completed_tasks' => $taskStats['completed'] ?? 0,
                    'failed_tasks' => $taskStats['failed'] ?? 0,
                    'running_tasks' => $taskStats['running'] ?? 0,
                    'scheduled_tasks' => $taskStats['scheduled'] ?? 0,
                ],
                'device_statistics' => $deviceStats,
                'workflow_performance' => $workflowPerformance,
            ],
        ]);
    }

    /**
     * Get device failure report
     */
    public function deviceFailures(Request $request) {
        $period = $request->input('period', '30'); // Default to last 30 days

        $startDate = now()->subDays($period);

        // Get failed commands by device
        $failuresByDevice = DB::table('execution_logs')
            ->where('timestamp', '>=', $startDate)
            ->where('success', 0)
            ->selectRaw('device_serial,
                         command_type,
                         COUNT(*) as failure_count,
                         MAX(timestamp) as last_failure')
            ->groupBy('device_serial', 'command_type')
            ->orderByDesc('failure_count')
            ->get();

        // Get most common error messages
        $commonErrors = DB::table('execution_logs')
            ->where('timestamp', '>=', $startDate)
            ->where('success', 0)
            ->selectRaw('message, COUNT(*) as count')
            ->groupBy('message')
            ->orderByDesc('count')
            ->limit(10)
            ->get();

        return response()->json([
            'success' => true,
            'data' => [
                'period_days' => $period,
                'failures_by_device' => $failuresByDevice,
                'common_errors' => $commonErrors,
            ],
        ]);
    }

    /**
     * Get daily activity report
     */
    public function dailyActivity(Request $request) {
        $days = (int)$request->input('days', 30); // Default to last 30 days

        $startDate = now()->subDays($days)->startOfDay();

        // Get daily task counts
        $dailyTasks = DB::table('tasks')
            ->where('created_at', '>=', $startDate)
            ->selectRaw('DATE(created_at) as date,
                         COUNT(*) as total_tasks,
                         SUM(CASE WHEN status = "completed" THEN 1 ELSE 0 END) as completed_tasks,
                         SUM(CASE WHEN status = "failed" THEN 1 ELSE 0 END) as failed_tasks')
            ->groupBy('date')
            ->orderBy('date')
            ->get();

        // Get daily device activity counts
        $dailyDeviceActivity = DB::table('execution_logs')
            ->where('timestamp', '>=', $startDate)
            ->selectRaw('DATE(timestamp) as date,
                         COUNT(*) as total_commands,
                         SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as successful_commands')
            ->groupBy('date')
            ->orderBy('date')
            ->get();

        return response()->json([
            'success' => true,
            'data' => [
                'period_days' => $days,
                'daily_tasks' => $dailyTasks,
                'daily_device_activity' => $dailyDeviceActivity,
            ],
        ]);
    }

    /**
     * Aggregated stats for the dashboard home view
     */
    public function dashboardStats() {
        $deviceCounts = DB::table('devices')
            ->selectRaw('status, COUNT(*) as count')
            ->groupBy('status')
            ->get()
            ->pluck('count', 'status');

        $taskCounts = DB::table('tasks')
            ->selectRaw('status, COUNT(*) as count')
            ->groupBy('status')
            ->get()
            ->pluck('count', 'status');

        $totalTasks = array_sum($taskCounts->toArray());
        $completedTasks = $taskCounts['completed'] ?? 0;

        return response()->json([
            'success' => true,
            'data' => [
                'devices' => [
                    'total' => array_sum($deviceCounts->toArray()),
                    'online' => $deviceCounts['online'] ?? 0,
                    'busy' => $deviceCounts['busy'] ?? 0,
                    'offline' => $deviceCounts['offline'] ?? 0,
                    'error' => $deviceCounts['error'] ?? 0,
                ],
                'tasks' => [
                    'total' => $totalTasks,
                    'running' => $taskCounts['running'] ?? 0,
                    'scheduled' => $taskCounts['scheduled'] ?? 0,
                    'completed' => $completedTasks,
                    'failed' => $taskCounts['failed'] ?? 0,
                    'success_rate' => $totalTasks > 0 ? round(($completedTasks / $totalTasks) * 100, 2) : 0,
                ],
                'workflows' => [
                    'total' => DB::table('workflows')->count(),
                    'active' => DB::table('workflows')->where('status', 'active')->count(),
                ],
                'groups' => [
                    'total' => DB::table('device_groups')->count(),
                ],
                'recent_activity' => DB::table('execution_logs')
                    ->where('timestamp', '>=', now()->subHour())
                    ->count(),
            ],
        ]);
    }

    /**
     * Get real-time dashboard data
     */
    public function realtimeDashboard() {
        // Get current device status counts
        $deviceCounts = DB::table('devices')
            ->selectRaw('status, COUNT(*) as count')
            ->groupBy('status')
            ->get()
            ->pluck('count', 'status');

        // Get currently running tasks
        $runningTasks = DB::table('tasks')
            ->where('status', 'running')
            ->count();

        // Get recent activity (last hour)
        $recentActivity = DB::table('execution_logs')
            ->where('timestamp', '>=', now()->subHour())
            ->selectRaw('command_type, COUNT(*) as count')
            ->groupBy('command_type')
            ->get();

        return response()->json([
            'success' => true,
            'data' => [
                'device_status_counts' => [
                    'online' => $deviceCounts['online'] ?? 0,
                    'busy' => $deviceCounts['busy'] ?? 0,
                    'offline' => $deviceCounts['offline'] ?? 0,
                    'error' => $deviceCounts['error'] ?? 0,
                ],
                'running_tasks_count' => $runningTasks,
                'recent_activity' => $recentActivity,
            ],
        ]);
    }
}
