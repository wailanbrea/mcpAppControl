<?php

use Illuminate\Support\Facades\Route;
use App\Http\Controllers\Api\DeviceController;
use App\Http\Controllers\Api\WorkflowController;
use App\Http\Controllers\Api\TaskController;
use App\Http\Controllers\Api\GroupController;
use App\Http\Controllers\Api\ReportController;
use App\Http\Controllers\Api\ScheduleController;

// API v1 — todas las rutas requieren Authorization: Bearer <token> (tabla api_keys)
Route::prefix('v1')->middleware('api.token')->group(function () {

    // Device routes
    Route::get('/devices', [DeviceController::class, 'index']);
    Route::post('/devices', [DeviceController::class, 'store']);
    Route::get('/devices/stats', [DeviceController::class, 'stats']);
    Route::post('/devices/heartbeat', [DeviceController::class, 'heartbeat']);
    Route::post('/devices/batch-command', [DeviceController::class, 'batchCommand']);
    Route::post('/devices/{serial}/command-result', [DeviceController::class, 'commandResult']);
    Route::post('/devices/{serial}/screenshot', [DeviceController::class, 'screenshot']);
    Route::post('/devices/{serial}/log', [DeviceController::class, 'log']);
    Route::post('/devices/{device}/screen-frame', [DeviceController::class, 'screenFrame']);
    Route::get('/devices/{device}', [DeviceController::class, 'show']);
    Route::put('/devices/{device}', [DeviceController::class, 'update']);
    Route::delete('/devices/{device}', [DeviceController::class, 'destroy']);
    Route::patch('/devices/{device}/status', [DeviceController::class, 'updateStatus']);

    // Workflow routes
    Route::get('/workflows', [WorkflowController::class, 'index']);
    Route::post('/workflows', [WorkflowController::class, 'store']);
    Route::get('/workflows/stats/{workflow}', [WorkflowController::class, 'stats']);
    Route::get('/workflows/{workflow}', [WorkflowController::class, 'show']);
    Route::put('/workflows/{workflow}', [WorkflowController::class, 'update']);
    Route::delete('/workflows/{workflow}', [WorkflowController::class, 'destroy']);
    Route::post('/workflows/{workflow}/execute', [WorkflowController::class, 'execute']);
    Route::post('/workflows/{workflow}/validate', [WorkflowController::class, 'validateWorkflow']);

    // Task routes
    Route::get('/tasks', [TaskController::class, 'index']);
    Route::post('/tasks', [TaskController::class, 'store']);
    Route::get('/tasks/stats', [TaskController::class, 'stats']);
    Route::get('/tasks/daily-report', [TaskController::class, 'dailyReport']);
    Route::get('/tasks/{task}', [TaskController::class, 'show']);
    Route::post('/tasks/{task}/cancel', [TaskController::class, 'cancel']);
    Route::post('/tasks/{task}/retry', [TaskController::class, 'retry']);

    // Group routes
    Route::get('/groups', [GroupController::class, 'index']);
    Route::post('/groups', [GroupController::class, 'store']);
    Route::get('/groups/{group}', [GroupController::class, 'show']);
    Route::put('/groups/{group}', [GroupController::class, 'update']);
    Route::delete('/groups/{group}', [GroupController::class, 'destroy']);
    Route::post('/groups/{group}/pause', [GroupController::class, 'pause']);
    Route::post('/groups/{group}/resume', [GroupController::class, 'resume']);
    Route::post('/groups/{group}/assign-devices', [GroupController::class, 'assignDevices']);
    Route::post('/groups/{group}/remove-devices', [GroupController::class, 'removeDevices']);

    // Schedule routes (rutinas programadas)
    Route::get('/schedules', [ScheduleController::class, 'index']);
    Route::post('/schedules', [ScheduleController::class, 'store']);
    Route::get('/schedules/{schedule}', [ScheduleController::class, 'show']);
    Route::put('/schedules/{schedule}', [ScheduleController::class, 'update']);
    Route::delete('/schedules/{schedule}', [ScheduleController::class, 'destroy']);
    Route::post('/schedules/{schedule}/pause', [ScheduleController::class, 'pause']);
    Route::post('/schedules/{schedule}/resume', [ScheduleController::class, 'resume']);
    Route::post('/schedules/{schedule}/run-now', [ScheduleController::class, 'runNow']);

    // Report routes
    Route::get('/reports/execution-summary', [ReportController::class, 'executionSummary']);
    Route::get('/reports/device-failures', [ReportController::class, 'deviceFailures']);
    Route::get('/reports/daily-activity', [ReportController::class, 'dailyActivity']);

    // Dashboard
    Route::get('/dashboard/stats', [ReportController::class, 'dashboardStats']);
    Route::get('/dashboard/realtime', [ReportController::class, 'realtimeDashboard']);

});
