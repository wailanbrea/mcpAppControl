<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use App\Models\Device;

class RegisterDevice extends Command {
    protected $signature = 'device:register';
    protected $description = 'Registra un nuevo dispositivo en la flota';

    public function handle(): int {
        $name = $this->ask('Nombre del dispositivo');

        if (!$name) {
            $this->error('El nombre es requerido');
            return Command::FAILURE;
        }

        $serial = $this->ask('Número de serie', fn() => 'ANDROID-' . strtoupper(substr(md5(uniqid()), 0, 12)));

        if (!\App\Models\Device::where('serial_number', $serial)->exists()) {
            $model = $this->choice('Modelo del dispositivo', [
                'Samsung Galaxy A54',
                'Xiaomi Redmi Note 12',
                'Motorola Edge 40',
                'Otro'
            ]);

            if ($model === 'Otro') {
                $model = $this->ask('Especifica el modelo');
            }

            $androidVersion = $this->ask('Versión de Android', fn() => '13');

            $device = Device::create([
                'name' => $name,
                'serial_number' => $serial,
                'model' => $model,
                'android_version' => $androidVersion,
                'status' => 'offline',
            ]);

            $this->info("Dispositivo registrado exitosamente!");
            $this->table(
                ['ID', 'Nombre', 'Serie', 'Modelo', 'Estado'],
                [[
                    $device->id,
                    $device->name,
                    $device->serial_number,
                    $device->model,
                    $device->status
                ]]
            );

            return Command::SUCCESS;
        }

        $this->error('Ya existe un dispositivo con ese número de serie');
        return Command::FAILURE;
    }
}
