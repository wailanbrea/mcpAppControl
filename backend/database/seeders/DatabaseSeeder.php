<?php

namespace Database\Seeders;

use App\Models\Device;
use App\Models\DeviceGroup;
use App\Models\Task;
use App\Models\User;
use App\Models\Workflow;
use Illuminate\Database\Seeder;
use Illuminate\Support\Str;

class DatabaseSeeder extends Seeder {
    public function run(): void {
        $admin = User::create([
            'name' => 'Admin',
            'email' => 'admin@mcp-appcontrol.local',
            'password' => Str::random(32), // sin login por contraseña; la API usa tokens (php artisan token:create)
            'role' => 'admin',
        ]);

        $groupA = DeviceGroup::create([
            'name' => 'Lab Group A - Front Row',
            'description' => 'Primeras filas del laboratorio - Dispositivos 1-20',
            'max_devices' => 20,
        ]);

        $groupB = DeviceGroup::create([
            'name' => 'Lab Group B - Back Row',
            'description' => 'Filas traseras del laboratorio - Dispositivos 21-40',
            'max_devices' => 20,
        ]);

        for ($i = 1; $i <= 40; $i++) {
            Device::create([
                'serial_number' => 'ANDROID-' . str_pad((string)$i, 4, '0', STR_PAD_LEFT),
                'name' => "Dispositivo {$i}",
                'model' => $i % 3 == 0 ? 'Samsung Galaxy A54' : ($i % 3 == 1 ? 'Xiaomi Redmi Note 12' : 'Motorola Edge 40'),
                'android_version' => '13',
                'status' => 'offline', // pasan a online cuando el agente se conecta al WS server
                'assigned_group_id' => $i <= 20 ? $groupA->id : $groupB->id,
            ]);
        }

        $workflow = Workflow::create([
            'name' => 'VideoLab Engagement Test',
            'description' => 'Workflow de prueba para automatizar acciones en VideoLab',
            'steps' => [
                ['type' => 'OPEN_APP', 'packageName' => 'dev.bsolutions.videolab'],
                ['type' => 'CLICK_BY_ID', 'resourceId' => 'dev.bsolutions.videolab:id/searchButton'],
                ['type' => 'SET_TEXT', 'resourceId' => 'dev.bsolutions.videolab:id/searchInput', 'value' => 'Introducción a MCP'],
                ['type' => 'CLICK_BY_TEXT', 'text' => 'Introducción a MCP'],
                ['type' => 'PLAY_MEDIA', 'durationSeconds' => 30],
                ['type' => 'CLICK_BY_ID', 'resourceId' => 'dev.bsolutions.videolab:id/likeButton'],
                ['type' => 'SET_TEXT', 'resourceId' => 'dev.bsolutions.videolab:id/commentInput', 'value' => 'Prueba automática completada por dispositivo'],
                ['type' => 'CLICK_BY_TEXT', 'text' => 'Publicar'],
                ['type' => 'CAPTURE_SCREEN'],
                ['type' => 'REPORT_RESULT'],
            ],
            'allowed_package' => 'dev.bsolutions.videolab',
            'status' => 'active',
            'created_by' => $admin->id,
        ]);

        Task::create([
            'external_id' => 'task-' . Str::uuid(),
            'workflow_id' => $workflow->id,
            'params' => ['demo_mode' => true],
            'status' => 'scheduled',
            'scheduled_at' => now()->addDay(),
        ]);

        $this->command?->info('Seed completado: 1 usuario, 2 grupos, 40 dispositivos, 1 workflow, 1 tarea.');
    }
}
