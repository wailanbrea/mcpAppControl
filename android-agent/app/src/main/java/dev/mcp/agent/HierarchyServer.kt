package dev.mcp.agent

import android.util.Log
import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader
import java.io.OutputStream
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import kotlin.concurrent.thread

/**
 * Servidor HTTP mínimo que expone la jerarquía de la pantalla.
 *
 * Por qué existe: el PC lee la pantalla con `uiautomator dump`, pero en muchos
 * teléfonos ese comando muere ("Killed") porque el sistema mata el proceso, y en
 * apps con vídeo continuo nunca se alcanza el estado idle que necesita. Sin poder
 * leer la pantalla, ningún script encuentra sus controles.
 *
 * Este servidor da la misma información desde dentro del dispositivo, usando el
 * servicio de accesibilidad que ya está activo. El PC se conecta con
 * `adb forward tcp:<local> tcp:9009`, así que funciona igual por USB o por WiFi.
 *
 * El protocolo imita el del lector de UI que ya soportaba el escritorio, para que
 * el cliente no tenga que distinguir con quién habla:
 *   GET  /ping        -> "pong"
 *   POST /jsonrpc/0   {"method":"dumpWindowHierarchy"} -> {"result":"<xml…>"}
 *
 * Se escucha solo en loopback: el puerto no queda expuesto en la red del local.
 */
object HierarchyServer {

    private const val TAG = "HierarchyServer"
    const val PORT = 9009

    @Volatile private var server: ServerSocket? = null
    @Volatile private var running = false

    fun start() {
        if (running) return
        running = true
        thread(name = "hierarchy-server", isDaemon = true) {
            try {
                val s = ServerSocket(PORT, 8, InetAddress.getByName("127.0.0.1"))
                server = s
                Log.i(TAG, "escuchando en 127.0.0.1:$PORT")
                while (running) {
                    try {
                        val cliente = s.accept()
                        // Una petición por conexión: el cliente abre y cierra en
                        // cada consulta, así que no compensa mantener hilos vivos.
                        thread(isDaemon = true) { atender(cliente) }
                    } catch (e: Exception) {
                        if (running) Log.w(TAG, "accept: ${e.message}")
                    }
                }
            } catch (e: Exception) {
                Log.e(TAG, "no se pudo abrir el puerto $PORT: ${e.message}")
                running = false
            }
        }
    }

    fun stop() {
        running = false
        try { server?.close() } catch (_: Exception) {}
        server = null
    }

    private fun atender(cliente: Socket) {
        try {
            cliente.soTimeout = 15000
            val entrada = BufferedReader(InputStreamReader(cliente.getInputStream()))
            val salida = cliente.getOutputStream()

            val peticion = entrada.readLine() ?: return
            val partes = peticion.split(" ")
            if (partes.size < 2) return
            val metodo = partes[0]
            val ruta = partes[1]

            // Cabeceras: solo interesa cuánto cuerpo hay que leer.
            var largoCuerpo = 0
            while (true) {
                val linea = entrada.readLine() ?: break
                if (linea.isEmpty()) break
                if (linea.startsWith("Content-Length:", ignoreCase = true)) {
                    largoCuerpo = linea.substringAfter(":").trim().toIntOrNull() ?: 0
                }
            }
            var cuerpo = ""
            if (largoCuerpo > 0) {
                val buf = CharArray(largoCuerpo)
                var leidos = 0
                while (leidos < largoCuerpo) {
                    val n = entrada.read(buf, leidos, largoCuerpo - leidos)
                    if (n <= 0) break
                    leidos += n
                }
                cuerpo = String(buf, 0, leidos)
            }

            when {
                ruta.startsWith("/ping") -> responder(salida, "text/plain", "pong")

                metodo == "POST" && ruta.startsWith("/jsonrpc") -> {
                    val json = try { JSONObject(cuerpo) } catch (_: Exception) { JSONObject() }
                    val rpc = json.optString("method")
                    val id = json.opt("id") ?: 1
                    val respuesta = JSONObject().put("jsonrpc", "2.0").put("id", id)

                    when (rpc) {
                        "dumpWindowHierarchy" -> {
                            val servicio = MCPAccessibilityService.instance
                            if (servicio == null) {
                                respuesta.put("error", JSONObject()
                                    .put("code", -32000)
                                    .put("message", "el servicio de accesibilidad no está activo"))
                            } else {
                                respuesta.put("result", servicio.dumpHierarchyXml())
                            }
                        }
                        "deviceInfo" -> {
                            val servicio = MCPAccessibilityService.instance
                            respuesta.put("result", JSONObject()
                                .put("agent", "dev.mcp.agent")
                                .put("accessibility", servicio != null))
                        }
                        else -> respuesta.put("error", JSONObject()
                            .put("code", -32601)
                            .put("message", "método no soportado: $rpc"))
                    }
                    responder(salida, "application/json", respuesta.toString())
                }

                else -> responder(salida, "text/plain", "not found", "404 Not Found")
            }
        } catch (e: Exception) {
            Log.w(TAG, "petición: ${e.message}")
        } finally {
            try { cliente.close() } catch (_: Exception) {}
        }
    }

    private fun responder(salida: OutputStream, tipo: String, cuerpo: String, estado: String = "200 OK") {
        val bytes = cuerpo.toByteArray(Charsets.UTF_8)
        val cabecera = buildString {
            append("HTTP/1.1 $estado\r\n")
            append("Content-Type: $tipo; charset=utf-8\r\n")
            append("Content-Length: ${bytes.size}\r\n")
            append("Connection: close\r\n\r\n")
        }
        salida.write(cabecera.toByteArray(Charsets.UTF_8))
        salida.write(bytes)
        salida.flush()
    }
}
