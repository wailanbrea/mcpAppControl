<?php

namespace App\Services;

use App\Models\Device;
use App\Models\Screenshot;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

/**
 * Ejecuta pasos de workflow enviando comandos al dispositivo a través
 * del servidor WebSocket (mcp-server/src/websocket-server.ts), que
 * mantiene la conexión persistente con cada agente Android.
 */
class TaskExecutionService {
    /**
     * Request an ephemeral screen frame for the authenticated dashboard.
     * Stream frames are returned in the command result and never persisted.
     */
    public function captureFrame(Device $device): array {
        $result = $this->dispatch(
            $device,
            'CAPTURE_SCREEN_FRAME',
            [],
            'Captura de pantalla realizada',
            timeout: 15
        );

        $image = $result['data']['image'] ?? null;
        if (!$result['success'] || !is_string($image) || $image === '') {
            return [
                'success' => false,
                'message' => $result['message'] ?? 'El dispositivo no devolvio una captura.',
                'image' => null,
            ];
        }

        return [
            'success' => true,
            'message' => $result['message'],
            'image' => $image,
        ];
    }

    /**
     * Mapa de tipo de paso => [comando, claves de params].
     * Los pasos locales (WAIT, REPORT_RESULT, ...) se resuelven sin red.
     */
    public function executeStep(Device $device, array $step, int $stepIndex): array {
        try {
            switch ($step['type']) {
                case 'OPEN_APP':
                    return $this->dispatch($device, 'OPEN_APP', ['package_name' => $step['packageName']], "App {$step['packageName']} abierta");

                case 'CLICK_BY_TEXT':
                    return $this->dispatch($device, 'CLICK_BY_TEXT', ['text' => $step['text']], "Click en texto '{$step['text']}'");

                case 'CLICK_BY_ID':
                    return $this->dispatch($device, 'CLICK_BY_ID', ['resource_id' => $step['resourceId']], "Click en ID '{$step['resourceId']}'");

                case 'SET_TEXT':
                    return $this->dispatch($device, 'SET_TEXT', ['resource_id' => $step['resourceId'], 'value' => $step['value']], "Texto establecido en '{$step['resourceId']}'");

                case 'SCROLL':
                    $direction = $step['direction'] ?? 'down';
                    return $this->dispatch($device, 'SCROLL', ['direction' => $direction], "Scroll {$direction} realizado");

                case 'SWIPE':
                    return $this->dispatch($device, 'SWIPE', $step['params'] ?? [], 'Swipe realizado');

                case 'LONG_PRESS':
                    return $this->dispatch($device, 'LONG_PRESS', $step['params'] ?? ['duration_ms' => $step['duration'] ?? 1000], 'Long press realizado');

                case 'PRESS_BACK':
                    return $this->dispatch($device, 'PRESS_BACK', [], 'Back presionado');

                case 'PRESS_HOME':
                    return $this->dispatch($device, 'PRESS_HOME', [], 'Home presionado');

                case 'WAIT_FOR_ELEMENT':
                    $timeoutMs = ($step['timeout'] ?? 30) * 1000;
                    return $this->dispatch(
                        $device,
                        'WAIT_FOR_ELEMENT',
                        array_merge(['timeout_ms' => $timeoutMs], array_filter([
                            'text' => $step['text'] ?? null,
                            'resource_id' => $step['resourceId'] ?? null,
                        ])),
                        'Elemento encontrado',
                        timeout: 60
                    );

                case 'CAPTURE_SCREEN':
                    return $this->captureScreen($device);

                case 'PLAY_MEDIA':
                    $duration = $step['durationSeconds'] ?? 30;
                    return $this->dispatch($device, 'PLAY_MEDIA', ['duration_seconds' => $duration], "Reproduciendo durante {$duration}s", timeout: $duration + 30);

                case 'PAUSE_MEDIA':
                    return $this->dispatch($device, 'PAUSE_MEDIA', [], 'Media pausado');

                case 'GOTO_URL':
                    return $this->dispatch($device, 'GOTO_URL', ['url' => $step['url']], "Navegando a {$step['url']}");

                case 'WAIT':
                case 'TYPING_DELAY':
                    $delayMs = $step['duration'] ?? 1000;
                    usleep(min($delayMs, 60000) * 1000);
                    return ['success' => true, 'message' => "Espera de {$delayMs}ms", 'data' => null];

                case 'REPORT_RESULT':
                    return ['success' => true, 'message' => 'Resultado reportado', 'data' => null];

                default:
                    // Passthrough genérico: reenvía el comando y sus parámetros tal cual
                    // al router (transporte ADB/agente). Permite añadir utilidades ADB
                    // nuevas (INSTALL_APK, REBOOT, TAP_XY, SETTINGS_PUT…) sin tocar PHP.
                    $params = $step;
                    unset($params['type']);
                    return $this->dispatch($device, $step['type'], $params, "{$step['type']} ejecutado");
            }
        } catch (\Exception $e) {
            Log::error("Error executing step on device {$device->serial_number}: " . $e->getMessage());
            return ['success' => false, 'message' => $e->getMessage(), 'data' => null];
        }
    }

    /**
     * Envía un comando al dispositivo a través del WS server y normaliza la respuesta.
     */
    private function dispatch(Device $device, string $command, array $params, string $okMessage, int $timeout = 30): array {
        $response = Http::timeout($timeout)
            ->withToken(config('services.ws.token'))
            ->post(config('services.ws.dispatch_url'), [
                'serial_number' => $device->serial_number,
                'command' => $command,
                'params' => $params,
            ]);

        $body = $response->json();
        $success = $response->successful() && ($body['success'] ?? true);

        return [
            'success' => $success,
            'message' => $success ? $okMessage : ($body['message'] ?? "Error en comando {$command}: {$response->body()}"),
            'data' => $body,
        ];
    }

    private function captureScreen(Device $device): array {
        $result = $this->dispatch($device, 'CAPTURE_SCREEN', [], 'Captura de pantalla realizada');

        $image = $result['data']['image'] ?? $result['data']['data']['image'] ?? null;
        if ($result['success'] && $image) {
            Screenshot::create([
                'device_serial' => $device->serial_number,
                'image_data' => $image,
                'timestamp' => now(),
            ]);
        }

        return $result;
    }
}
