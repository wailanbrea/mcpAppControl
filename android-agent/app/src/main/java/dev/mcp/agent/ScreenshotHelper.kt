package dev.mcp.agent

import android.accessibilityservice.AccessibilityService
import android.graphics.Bitmap
import android.os.Build
import android.util.Base64
import androidx.annotation.RequiresApi
import java.io.ByteArrayOutputStream
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/**
 * Captura de pantalla vía AccessibilityService.takeScreenshot (API 30+).
 *
 * Está en una clase SEPARADA a propósito: TakeScreenshotCallback solo existe
 * en API 30+. Si este código estuviera dentro de MCPAccessibilityService, el
 * verificador de ART fallaría al cargar el servicio en dispositivos API < 30
 * (NoClassDefFoundError) y Android desactivaría el servicio de accesibilidad.
 * Al aislarlo, esta clase solo se carga cuando se llama en API 30+.
 */
@RequiresApi(Build.VERSION_CODES.R)
object ScreenshotHelper {

    /** Devuelve la captura en base64 (PNG), o un mensaje de error. */
    fun capture(service: AccessibilityService): Pair<Boolean, String> {
        val latch = CountDownLatch(1)
        var base64Image: String? = null
        var errorMessage = "Unknown error"

        service.takeScreenshot(
            android.view.Display.DEFAULT_DISPLAY,
            Executors.newSingleThreadExecutor(),
            object : AccessibilityService.TakeScreenshotCallback {
                override fun onSuccess(screenshot: AccessibilityService.ScreenshotResult) {
                    try {
                        val hardwareBitmap = Bitmap.wrapHardwareBuffer(
                            screenshot.hardwareBuffer,
                            screenshot.colorSpace
                        )
                        if (hardwareBitmap != null) {
                            val bitmap = hardwareBitmap.copy(Bitmap.Config.ARGB_8888, false)
                            val stream = ByteArrayOutputStream()
                            bitmap.compress(Bitmap.CompressFormat.PNG, 90, stream)
                            base64Image = Base64.encodeToString(stream.toByteArray(), Base64.NO_WRAP)
                            bitmap.recycle()
                            hardwareBitmap.recycle()
                        } else {
                            errorMessage = "Could not wrap hardware buffer"
                        }
                        screenshot.hardwareBuffer.close()
                    } catch (e: Exception) {
                        errorMessage = "Error processing screenshot: ${e.message}"
                    } finally {
                        latch.countDown()
                    }
                }

                override fun onFailure(errorCode: Int) {
                    errorMessage = "takeScreenshot failed with code $errorCode"
                    latch.countDown()
                }
            }
        )

        latch.await(10, TimeUnit.SECONDS)

        return if (base64Image != null) {
            true to base64Image!!
        } else {
            false to errorMessage
        }
    }
}
