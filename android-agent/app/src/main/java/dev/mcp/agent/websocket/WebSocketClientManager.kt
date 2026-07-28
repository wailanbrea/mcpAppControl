package dev.mcp.agent.websocket

import android.os.Handler
import android.os.Looper
import android.util.Log
import dev.mcp.agent.MCPAccessibilityService
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONObject
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import kotlin.math.min

/**
 * Cliente WebSocket del agente.
 *
 * Protocolo (servidor mcp-server/src/websocket-server.ts, path /ws):
 *   agente -> servidor: {type:'register', serial_number, token, name, model, android_version}
 *                       {type:'heartbeat', status}
 *                       {type:'command_result', id, command, success, message, data}
 *                       {type:'screenshot', image}
 *                       {type:'log_entry', message}
 *   servidor -> agente: {type:'registered'} | {type:'error', message}
 *                       {type:'command', id, command, params}
 *                       {type:'heartbeat_ack'}
 */
class WebSocketClientManager(
    private val serverUrl: String,
    private val serialNumber: String,
    private val authToken: String,
    private val onCommandExecuted: (String, Boolean, String) -> Unit,
    private val onConnectionStateChanged: (Boolean, String) -> Unit
) {

    companion object {
        private const val TAG = "WebSocketClient"
        private const val MAX_RECONNECT_ATTEMPTS = 10
        private const val INITIAL_RECONNECT_DELAY_MS = 1000L
        private const val MAX_RECONNECT_DELAY_MS = 30000L
        private const val HEARTBEAT_INTERVAL_MS = 30000L
    }

    private var webSocket: WebSocket? = null
    @Volatile
    private var connected = false
    @Volatile
    private var connecting = false
    private var reconnectAttempts = 0
    private var manuallyClosed = false

    private val mainHandler = Handler(Looper.getMainLooper())
    // Los comandos se ejecutan en serie fuera del hilo de OkHttp (pueden bloquear segundos)
    private val commandExecutor: ExecutorService = Executors.newSingleThreadExecutor()

    private val client = OkHttpClient.Builder()
        .connectTimeout(30, TimeUnit.SECONDS)
        .readTimeout(0, TimeUnit.SECONDS) // sin timeout de lectura: conexión persistente
        .pingInterval(20, TimeUnit.SECONDS)
        .build()

    private val heartbeatRunnable = object : Runnable {
        override fun run() {
            if (connected) {
                send(JSONObject().apply {
                    put("type", "heartbeat")
                    put("status", "online")
                })
                mainHandler.postDelayed(this, HEARTBEAT_INTERVAL_MS)
            }
        }
    }

    fun connect() {
        if (connected || connecting) {
            Log.w(TAG, "Connection already active or in progress")
            return
        }

        manuallyClosed = false
        connecting = true
        val url = if (serverUrl.endsWith("/ws")) serverUrl else "${serverUrl.trimEnd('/')}/ws"
        Log.i(TAG, "Connecting to: $url")

        webSocket = client.newWebSocket(Request.Builder().url(url).build(), object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                Log.i(TAG, "Socket opened; waiting for registration")
                onConnectionStateChanged(false, "Validando registro en el servidor")
                sendRegistration()
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                try {
                    val message = JSONObject(text)
                    when (message.optString("type")) {
                        "registered" -> {
                            connected = true
                            connecting = false
                            reconnectAttempts = 0
                            Log.i(TAG, "Registered with server")
                            onConnectionStateChanged(true, "Registrado en el servidor")
                            mainHandler.postDelayed(heartbeatRunnable, HEARTBEAT_INTERVAL_MS)
                        }
                        "command" -> {
                            commandExecutor.execute { executeServerCommand(message) }
                        }
                        "heartbeat_ack" -> Log.d(TAG, "Heartbeat ack")
                        "error" -> {
                            val error = message.optString("message")
                            Log.e(TAG, "Server error: $error")
                            onConnectionStateChanged(false, "Error del servidor: $error")
                            webSocket.close(1008, error)
                        }
                    }
                } catch (e: Exception) {
                    Log.e(TAG, "Error processing message: ${e.message}", e)
                }
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                connected = false
                connecting = false
                mainHandler.removeCallbacks(heartbeatRunnable)
                Log.w(TAG, "WebSocket closed: $reason")
                onConnectionStateChanged(false, "Desconectado: $reason")
                attemptReconnect()
            }

            override fun onFailure(webSocket: WebSocket, error: Throwable, response: Response?) {
                connected = false
                connecting = false
                mainHandler.removeCallbacks(heartbeatRunnable)
                Log.e(TAG, "WebSocket error: ${error.message}", error)
                onConnectionStateChanged(false, "Error de conexión: ${error.message}")
                attemptReconnect()
            }
        })
    }

    fun disconnect() {
        manuallyClosed = true
        connecting = false
        mainHandler.removeCallbacks(heartbeatRunnable)
        webSocket?.close(1000, "Manual disconnect")
        connected = false
        Log.i(TAG, "Disconnected manually")
    }

    fun isConnected(): Boolean = connected

    // ==================== OUTGOING MESSAGES ====================

    private fun send(json: JSONObject) {
        webSocket?.send(json.toString())
    }

    private fun sendRegistration() {
        send(JSONObject().apply {
            put("type", "register")
            put("serial_number", serialNumber)
            put("token", authToken)
            put("name", "Android Device - $serialNumber")
            put("model", android.os.Build.MODEL)
            put("android_version", android.os.Build.VERSION.RELEASE)
        })
        Log.i(TAG, "Device registration sent")
    }

    private fun sendCommandResult(id: String, command: String, success: Boolean, message: String, data: JSONObject? = null) {
        send(JSONObject().apply {
            put("type", "command_result")
            put("id", id)
            put("command", command)
            put("success", success)
            put("message", message)
            if (data != null) put("data", data)
        })
        Log.d(TAG, "Sent command result: $command - success=$success")
    }

    fun sendLog(message: String) {
        if (!connected) return
        send(JSONObject().apply {
            put("type", "log_entry")
            put("message", message)
        })
    }

    // ==================== COMMAND EXECUTION ====================

    private fun executeServerCommand(message: JSONObject) {
        val id = message.optString("id")
        val command = message.optString("command")
        val params = message.optJSONObject("params") ?: JSONObject()

        Log.i(TAG, "Executing command: $command")

        val service = MCPAccessibilityService.instance
        if (service == null) {
            sendCommandResult(id, command, false, "Servicio de accesibilidad no activo")
            onCommandExecuted(command, false, "Servicio de accesibilidad no activo")
            return
        }

        val serviceParams = mapServerParams(command, params)
        val result = service.executeCommand(command, serviceParams)

        // Las capturas de pantalla viajan en su propio mensaje, no dentro del resultado
        val screenshot = result.extraData["screenshot"] as? String
        if (screenshot != null) {
            if (command == "CAPTURE_SCREEN_FRAME") {
                sendCommandResult(
                    id,
                    command,
                    result.success,
                    result.message,
                    JSONObject().put("image", screenshot)
                )
                onCommandExecuted(command, result.success, result.message)
                return
            }

            send(JSONObject().apply {
                put("type", "screenshot")
                put("image", screenshot)
            })
        }

        sendCommandResult(id, command, result.success, result.message)
        onCommandExecuted(command, result.success, result.message)
    }

    /**
     * Traduce los nombres de parámetros del servidor (snake_case) a los del servicio.
     */
    private fun mapServerParams(command: String, params: JSONObject): Map<String, Any> {
        val mapped = mutableMapOf<String, Any>()

        when (command) {
            "OPEN_APP" -> params.optString("package_name").takeIf { it.isNotEmpty() }?.let { mapped["packageName"] = it }
            "CLICK_BY_TEXT" -> params.optString("text").takeIf { it.isNotEmpty() }?.let { mapped["text"] = it }
            "CLICK_BY_ID" -> params.optString("resource_id").takeIf { it.isNotEmpty() }?.let { mapped["resourceId"] = it }
            "SET_TEXT" -> {
                params.optString("resource_id").takeIf { it.isNotEmpty() }?.let { mapped["resourceId"] = it }
                mapped["value"] = params.optString("value")
            }
            "SCROLL" -> mapped["direction"] = params.optString("direction", "down")
            "SWIPE" -> {
                mapped["startX"] = params.optInt("start_x", 200)
                mapped["startY"] = params.optInt("start_y", 1200)
                mapped["endX"] = params.optInt("end_x", 200)
                mapped["endY"] = params.optInt("end_y", 400)
            }
            "LONG_PRESS" -> {
                mapped["x"] = params.optInt("x", 500)
                mapped["y"] = params.optInt("y", 800)
            }
            "WAIT", "WAIT_FOR_ELEMENT" -> {
                params.optString("text").takeIf { it.isNotEmpty() }?.let { mapped["text"] = it }
                params.optString("resource_id").takeIf { it.isNotEmpty() }?.let { mapped["resourceId"] = it }
                mapped["timeoutMs"] = params.optInt("timeout_ms", 10000)
            }
            "PLAY_MEDIA" -> mapped["durationSeconds"] = params.optInt("duration_seconds", 30)
            "GOTO_URL" -> params.optString("url").takeIf { it.isNotEmpty() }?.let { mapped["url"] = it }
        }

        return mapped
    }

    // ==================== RECONNECT ====================

    private fun attemptReconnect() {
        if (manuallyClosed) return

        if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
            Log.w(TAG, "Max reconnection attempts reached")
            onConnectionStateChanged(false, "Reconexión agotada tras $MAX_RECONNECT_ATTEMPTS intentos")
            return
        }

        reconnectAttempts++
        val delay = min(
            INITIAL_RECONNECT_DELAY_MS * (1L shl (reconnectAttempts - 1)),
            MAX_RECONNECT_DELAY_MS
        )

        Log.i(TAG, "Reconnecting in ${delay}ms (attempt $reconnectAttempts/$MAX_RECONNECT_ATTEMPTS)")
        mainHandler.postDelayed({ connect() }, delay)
    }
}
