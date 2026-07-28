package dev.bsolutions.videolab

import android.app.Activity
import android.os.Bundle
import android.widget.*
import java.util.UUID

class MainActivity : Activity() {

    private lateinit var searchInput: EditText
    private lateinit var searchButton: Button
    private lateinit var videoList: ListView
    private lateinit var videoPlayerLayout: LinearLayout
    private lateinit var likeButton: Button
    private lateinit var commentInput: EditText
    private lateinit var publishButton: Button

    // Mock video database
    private val mockVideos = listOf(
        Video("1", "Introducción a MCP", "Descripción del protocolo MCP para control de dispositivos", 15000, "dev.bsolutions.videolab:id/video1"),
        Video("2", "Automatización Android", "Cómo automatizar interfaces con AccessibilityService", 8500, "dev.bsolutions.videolab:id/video2"),
        Video("3", "WebSocket en PHP", "Implementación de comunicación en tiempo real", 12000, "dev.bsolutions.videolab:id/video3"),
    )

    // Track engagement actions
    private val likedVideos = mutableSetOf<String>()
    private val commentedVideos = mutableMapOf<String, String>()
    private val subscribedChannels = mutableSetOf<String>()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Create simple UI programmatically for demonstration
        val mainLayout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(16, 16, 16, 16)
        }

        // Search section
        searchInput = EditText(this).apply {
            hint = "Buscar videos..."
            id = View.generateViewId()
            setTextColorRes(android.R.color.white)
            setBackgroundColor(0xFF0f3460.toInt())
        }

        searchButton = Button(this).apply {
            text = "Buscar"
            id = R.id.searchButton
            setOnClickListener { performSearch() }
        }

        // Video list
        videoList = ListView(this).apply {
            adapter = VideoAdapter(this@MainActivity, mockVideos)
            onItemClickListener = AdapterView.OnItemClickListener { _, _, position, _ ->
                openVideo(mockVideos[position])
            }
        }

        mainLayout.addView(searchInput)
        mainLayout.addView(searchButton)
        mainLayout.addView(videoList)

        setContentView(mainLayout)
    }

    private fun performSearch() {
        val query = searchInput.text.toString().trim().lowercase()

        if (query.isEmpty()) return

        // Filter videos by search term
        val filteredVideos = mockVideos.filter { video ->
            video.title.lowercase().contains(query) ||
            video.description.lowercase().contains(query)
        }

        // Update list with filtered results
        val adapter = VideoAdapter(this, filteredVideos)
        videoList.adapter = adapter

        Toast.makeText(this, "${filteredVideos.size} resultados encontrados", Toast.LENGTH_SHORT).show()
    }

    private fun openVideo(video: Video) {
        // Create video player layout
        val playerLayout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(16, 16, 16, 16)
            id = R.id.videoPlayerLayout

            // Video title
            TextView(this@MainActivity).apply {
                text = video.title
                textSize = 20f
                setTextColorRes(android.R.color.white)
                addView(this)
            }

            // View count and duration
            TextView(this@MainActivity).apply {
                text = "${video.views} vistas • Reproduciendo..."
                textSize = 14f
                setTextColorRes(android.R.color.gray)
                addView(this)
            }

            // Like button
            likeButton = Button(this@MainActivity).apply {
                text = "👍 Me gusta"
                id = R.id.likeButton
                setBackgroundColor(if (video.id in likedVideos) 0xFF4caf50.toInt() else 0xFF0f3460.toInt())
                setOnClickListener { toggleLike(video) }
                addView(this)
            }

            // Comment input
            commentInput = EditText(this@MainActivity).apply {
                hint = "Escribir un comentario..."
                id = R.id.commentInput
                setBackgroundColor(0xFF16213e.toInt())
                addView(this)
            }

            // Publish button
            publishButton = Button(this@MainActivity).apply {
                text = "Publicar"
                id = R.id.publishButton
                setOnClickListener { publishComment(video) }
                addView(this)
            }

            // Subscribe button
            Button(this@MainActivity).apply {
                text = if (video.channelId in subscribedChannels) "✓ Suscrito" else "Suscribirse"
                setBackgroundColor(if (video.channelId in subscribedChannels) 0xFF333333.toInt() else 0xFFe94560.toInt())
                setOnClickListener { toggleSubscribe(video) }
                addView(this)
            }
        }

        setContentView(playerLayout)

        // Log video playback
        logAction("VIDEO_OPEN", mapOf(
            "videoId" to video.id,
            "title" to video.title,
            "channelId" to video.channelId
        ))
    }

    private fun toggleLike(video: Video) {
        if (video.id in likedVideos) {
            likedVideos.remove(video.id)
            likeButton.setBackgroundColor(0xFF0f3460.toInt())
            Toast.makeText(this, "Like eliminado", Toast.LENGTH_SHORT).show()
        } else {
            likedVideos.add(video.id)
            likeButton.setBackgroundColor(0xFF4caf50.toInt())
            Toast.makeText(this, "¡Me gusta!", Toast.LENGTH_SHORT).show()

            logAction("LIKE_ADDED", mapOf(
                "videoId" to video.id,
                "channelId" to video.channelId
            ))
        }
    }

    private fun publishComment(video: Video) {
        val comment = commentInput.text.toString().trim()

        if (comment.isEmpty()) {
            Toast.makeText(this, "Escribe un comentario", Toast.LENGTH_SHORT).show()
            return
        }

        commentedVideos[video.id] = comment

        logAction("COMMENT_PUBLISHED", mapOf(
            "videoId" to video.id,
            "comment" to comment,
            "channelId" to video.channelId
        ))

        Toast.makeText(this, "Comentario publicado", Toast.LENGTH_SHORT).show()
        commentInput.text.clear()
    }

    private fun toggleSubscribe(video: Video) {
        if (video.channelId in subscribedChannels) {
            subscribedChannels.remove(video.channelId)
            Toast.makeText(this, "Suscripción cancelada", Toast.LENGTH_SHORT).show()
        } else {
            subscribedChannels.add(video.channelId)
            Toast.makeText(this, "¡Suscrito!", Toast.LENGTH_SHORT).show()

            logAction("SUBSCRIPTION_ADDED", mapOf(
                "channelId" to video.channelId
            ))
        }
    }

    private fun logAction(action: String, data: Map<String, Any>) {
        val timestamp = java.text.SimpleDateFormat("yyyy-MM-dd HH:mm:ss", java.util.Locale.getDefault()).format(java.util.Date())
        android.util.Log.d("VideoLab", "[$timestamp] $action - ${data.entries.joinToString(", ") { "${it.key}=${it.value}" }}")
    }

    // Helper extension for setting text color
    private fun TextView.setTextColorRes(colorRes: Int) {
        setTextColor(resources.getColor(colorRes, theme))
    }
}

// Data class for video
data class Video(
    val id: String,
    val title: String,
    val description: String,
    val views: Int,
    val channelId: String,
)
