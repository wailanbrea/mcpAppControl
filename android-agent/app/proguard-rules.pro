# MCP Agent ProGuard Rules

# Keep WebSocket client classes
-keep class dev.mcp.agent.websocket.** { *; }

# Keep JSON model classes
-keep class org.json.** { *; }

# Keep OkHttp classes
-dontwarn okhttp3.**
-dontwarn okio.**
-keep class okhttp3.** { *; }
-keep interface okhttp3.** { *; }

# Keep Coroutines classes
-dontwarn kotlinx.coroutines.**
-keep namespace kotlinx.coroutines.** { *; }

# Keep Timber logging
-dontwarn com.jakewharton.timber.**
-keep class com.jakewharton.timber.** { *; }

# Keep reflection-based JSON parsing
-keepattributes Signature,InnerClasses,EnclosingMethod

# Keep serialization
-keepclassmembers class * implements java.io.Serializable {
    static final long serialVersionUID;
    private static final java.io.ObjectStreamField[] serialPersistentFields;
    private void writeObject(java.io.ObjectOutputStream);
    private void readObject(java.io.ObjectInputStream);
}
