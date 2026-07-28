<?php

namespace App\Services;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

class NotificationService {
    /**
     * Send notification to database
     */
    public function send(string $type, string $message, array $data = []): void {
        DB::table('notifications')->insert([
            'type' => $type,
            'message' => $message,
            'data' => json_encode($data),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        Log::info("Notification sent: {$type} - {$message}");
    }

    /**
     * Notify when device comes online
     */
    public function notifyDeviceOnline(string $serialNumber, string $deviceName): void {
        $this->send(
            'device_online',
            "Device '{$deviceName}' ({$serialNumber}) is now online",
            [
                'serial_number' => $serialNumber,
                'device_name' => $deviceName,
            ]
        );
    }

    /**
     * Notify when device goes offline
     */
    public function notifyDeviceOffline(string $serialNumber, string $deviceName): void {
        $this->send(
            'device_offline',
            "Device '{$deviceName}' ({$serialNumber}) is now offline",
            [
                'serial_number' => $serialNumber,
                'device_name' => $deviceName,
            ]
        );
    }

    /**
     * Notify when task fails
     */
    public function notifyTaskFailed(string $taskId, string $errorMessage): void {
        $this->send(
            'task_failed',
            "Task {$taskId} has failed",
            [
                'task_id' => $taskId,
                'error_message' => $errorMessage,
            ]
        );
    }

    /**
     * Notify when task completes successfully
     */
    public function notifyTaskCompleted(string $taskId): void {
        $this->send(
            'task_completed',
            "Task {$taskId} has completed successfully",
            [
                'task_id' => $taskId,
            ]
        );
    }

    /**
     * Notify when device status changes to error
     */
    public function notifyDeviceError(string $serialNumber, string $errorMessage): void {
        $this->send(
            'device_error',
            "Device '{$serialNumber}' has encountered an error",
            [
                'serial_number' => $serialNumber,
                'error_message' => $errorMessage,
            ]
        );
    }

    /**
     * Notify when the fraction of online devices drops below 50%.
     * Safe to call on every scheduler tick: only fires under the threshold.
     */
    public function notifyLowOnlineDevices(int $onlineCount, int $totalCount): void {
        if ($totalCount === 0 || $onlineCount >= ($totalCount * 0.5)) {
            return;
        }

        $this->send(
            'low_online_devices',
            "Only {$onlineCount} of {$totalCount} devices are online",
            [
                'online_count' => $onlineCount,
                'total_count' => $totalCount,
            ]
        );
    }

    /**
     * Get unread notifications count
     */
    public function getUnreadCount(): int {
        return DB::table('notifications')
            ->where('read', false)
            ->count();
    }

    /**
     * Mark all notifications as read
     */
    public function markAllAsRead(): void {
        DB::table('notifications')
            ->where('read', false)
            ->update(['read' => true]);
    }

    /**
     * Get recent notifications
     */
    public function getRecent(int $limit = 20): \Illuminate\Support\Collection {
        return DB::table('notifications')
            ->orderByDesc('created_at')
            ->limit($limit)
            ->get();
    }

    /**
     * Clear old notifications (older than 30 days)
     */
    public function clearOld(): int {
        $deleted = DB::table('notifications')
            ->where('created_at', '<', now()->subDays(30))
            ->delete();

        return $deleted;
    }
}
