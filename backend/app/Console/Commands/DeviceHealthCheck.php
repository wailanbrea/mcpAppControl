<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use App\Models\Device;
use App\Services\NotificationService;

class DeviceHealthCheck extends Command {
    protected $signature = 'device:health-check';
    protected $description = 'Verifica la salud de todos los dispositivos y envía alertas';

    public function handle(NotificationService $notifications): int {
        $this->info('Iniciando verificación de salud de dispositivos...');

        $devices = Device::all();
        $onlineCount = 0;
        $offlineCount = 0;
        $busyCount = 0;
        $errorCount = 0;
        $staleDevices = [];

        foreach ($devices as $device) {
            switch ($device->status) {
                case 'online':
                    $onlineCount++;

                    // Check if device is stale (last_seen > 5 minutes ago)
                    if ($device->last_seen && $device->last_seen->diffInMinutes(now()) > 5) {
                        $staleDevices[] = $device;
                    }
                    break;

                case 'offline':
                    $offlineCount++;
                    break;

                case 'busy':
                    $busyCount++;
                    break;

                case 'error':
                    $errorCount++;
                    break;
            }
        }

        // Display summary
        $this->table(
            ['Estado', 'Cantidad'],
            [
                ['Online', $onlineCount],
                ['Offline', $offlineCount],
                ['Ejecutando', $busyCount],
                ['Error', $errorCount],
            ]
        );

        // Send notifications if needed
        if (count($staleDevices) > 0) {
            foreach ($staleDevices as $device) {
                $notifications->notifyDeviceOffline($device->serial_number, $device->name);
                $this->warn("Dispositivo stale: {$device->name} ({$device->serial_number})");
            }
        }

        if ($onlineCount < ($devices->count() * 0.5) && $devices->count() > 0) {
            $notifications->notifyLowOnlineDevices($onlineCount, $devices->count());
        }

        // Check for devices with no last_seen (never connected)
        $neverConnected = Device::whereNull('last_seen')->get();
        if ($neverConnected->isNotEmpty()) {
            foreach ($neverConnected as $device) {
                $this->warn("Dispositivo sin conexión previa: {$device->name}");
            }
        }

        $this->info('Verificación de salud completada');

        return Command::SUCCESS;
    }
}
