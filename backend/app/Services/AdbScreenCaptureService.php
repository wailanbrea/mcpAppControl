<?php

namespace App\Services;

use App\Models\Device;
use RuntimeException;
use Symfony\Component\Process\Process;

class AdbScreenCaptureService {
    private const MAX_IMAGE_BYTES = 8_000_000;

    /**
     * Captures only the ADB serial explicitly assigned to a registered device.
     * No request-controlled command or serial reaches the operating system.
     *
     * @return array{success: bool, message: string, image: ?string, mime: ?string, source: string}
     */
    public function capture(Device $device): array {
        if (!config('services.adb_screen_capture.enabled')) {
            return $this->failure('La captura USB no esta habilitada.');
        }

        if (!$device->adb_serial) {
            return $this->failure('Este dispositivo no tiene una serie ADB vinculada.');
        }

        $adbPath = config('services.adb_screen_capture.path');
        if (!is_string($adbPath) || !is_file($adbPath)) {
            return $this->failure('No se encontro el ejecutable ADB configurado.');
        }

        // Force the local daemon already started for this workstation. This avoids
        // each PHP request attempting to spawn a second adb server on Windows.
        $environment = array_filter([
            'SYSTEMROOT' => getenv('SYSTEMROOT') ?: 'C:\\Windows',
            'WINDIR' => getenv('WINDIR') ?: 'C:\\Windows',
            'PATH' => getenv('PATH') ?: null,
            'USERPROFILE' => getenv('USERPROFILE') ?: null,
            'LOCALAPPDATA' => getenv('LOCALAPPDATA') ?: null,
            'APPDATA' => getenv('APPDATA') ?: null,
            'TEMP' => getenv('TEMP') ?: null,
            'TMP' => getenv('TMP') ?: null,
        ], static fn (?string $value): bool => $value !== null && $value !== '');

        $process = new Process([
            $adbPath,
            '-H', (string) config('services.adb_screen_capture.host', '127.0.0.1'),
            '-P', (string) config('services.adb_screen_capture.port', 5037),
            '-s', $device->adb_serial,
            'exec-out', 'screencap', '-p',
        ], null, $environment);
        $process->setTimeout((float) config('services.adb_screen_capture.timeout', 12));
        $process->run();

        if (!$process->isSuccessful()) {
            $error = trim($process->getErrorOutput());
            return $this->failure($error !== '' ? "ADB no pudo capturar: {$error}" : 'ADB no pudo capturar la pantalla.');
        }

        $png = $process->getOutput();
        if ($png === '' || strlen($png) > self::MAX_IMAGE_BYTES || !str_starts_with($png, "\x89PNG\r\n\x1A\n")) {
            return $this->failure('ADB devolvio una captura invalida o demasiado grande.');
        }

        $image = @imagecreatefromstring($png);
        if ($image === false) {
            return $this->failure('No se pudo procesar la captura USB.');
        }

        try {
            $width = imagesx($image);
            $height = imagesy($image);
            $maxWidth = (int) config('services.adb_screen_capture.max_width', 360);
            $targetWidth = min($width, max(120, $maxWidth));
            $targetHeight = max(1, (int) round($height * ($targetWidth / $width)));

            $resized = imagecreatetruecolor($targetWidth, $targetHeight);
            if ($resized === false || !imagecopyresampled($resized, $image, 0, 0, 0, 0, $targetWidth, $targetHeight, $width, $height)) {
                throw new RuntimeException('No se pudo escalar la captura USB.');
            }

            try {
                ob_start();
                imagejpeg($resized, null, 72);
                $jpeg = ob_get_clean();
            } finally {
                imagedestroy($resized);
            }

            if (!is_string($jpeg) || $jpeg === '') {
                throw new RuntimeException('No se pudo codificar la captura USB.');
            }

            return [
                'success' => true,
                'message' => 'Captura USB realizada',
                'image' => base64_encode($jpeg),
                'mime' => 'image/jpeg',
                'source' => 'adb',
            ];
        } catch (RuntimeException $exception) {
            return $this->failure($exception->getMessage());
        } finally {
            imagedestroy($image);
        }
    }

    private function failure(string $message): array {
        return ['success' => false, 'message' => $message, 'image' => null, 'mime' => null, 'source' => 'adb'];
    }
}
