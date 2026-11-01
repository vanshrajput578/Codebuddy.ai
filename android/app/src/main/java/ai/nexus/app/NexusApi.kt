package ai.nexus.app

import android.content.Context
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.util.concurrent.TimeUnit

class NexusApi(context: Context) {
    private val preferences = context.getSharedPreferences("nexus_settings", Context.MODE_PRIVATE)
    private val cookieJar = SecureCookieJar(context)
    private val client = OkHttpClient.Builder().cookieJar(cookieJar)
        .connectTimeout(20, TimeUnit.SECONDS).readTimeout(60, TimeUnit.SECONDS)
        .writeTimeout(30, TimeUnit.SECONDS).build()
    @Volatile private var csrfToken: String? = null
    private val jsonType = "application/json; charset=utf-8".toMediaType()

    fun baseUrl(): String = preferences.getString("api_origin", "")!!.trim().trimEnd('/')
    fun setBaseUrl(value: String) { preferences.edit().putString("api_origin", value.trim().trimEnd('/')).apply() }
    fun isConfigured(): Boolean = validOrigin(baseUrl())

    private fun validOrigin(value: String): Boolean {
        val uri = runCatching { java.net.URI(value) }.getOrNull() ?: return false
        return uri.host != null && uri.rawPath.orEmpty().let { it.isEmpty() || it == "/" } &&
            uri.rawQuery == null && uri.rawFragment == null &&
            uri.scheme == "https"
    }

    @Synchronized fun request(path: String, method: String = "GET", body: JSONObject? = null): JSONObject {
        val origin = baseUrl()
        if (!validOrigin(origin)) throw IOException("Set a valid HTTPS API origin in Settings.")
        val builder = Request.Builder().url("$origin$path")
            .header("Accept", "application/json").header("Origin", origin)
        if (method != "GET") builder.header("X-CSRF-Token", csrfToken ?: "")
        if (body != null) builder.method(method, body.toString().toRequestBody(jsonType))
        else builder.method(method, if (method == "GET") null else ByteArray(0).toRequestBody(null))
        client.newCall(builder.build()).execute().use { response ->
            val text = response.body?.string().orEmpty()
            val parsed = runCatching { JSONObject(text) }.getOrElse { JSONObject() }
            if (!response.isSuccessful) throw IOException(parsed.optString("error").ifBlank { "Request failed (${response.code})." })
            if (path == "/api/auth/me") csrfToken = parsed.optString("csrfToken").takeIf { it.isNotBlank() }
            return parsed
        }
    }

    fun login(email: String, password: String): JSONObject {
        val result = request("/api/auth/login", "POST", JSONObject().put("email", email).put("password", password))
        csrfToken = result.optString("csrfToken")
        return result
    }
    fun register(name: String, email: String, password: String): JSONObject {
        val result = request("/api/auth/register", "POST", JSONObject().put("displayName", name).put("email", email).put("password", password))
        csrfToken = result.optString("csrfToken")
        return result
    }
    fun restoreSession(): JSONObject = request("/api/auth/me")
    fun logout() { request("/api/auth/logout", "POST", JSONObject()); csrfToken = null; cookieJar.clear() }
    fun chat(message: String, conversationId: String?): JSONObject {
        val payload = JSONObject().put("message", message)
        if (!conversationId.isNullOrBlank()) payload.put("conversationId", conversationId)
        return request("/api/chat", "POST", payload)
    }
    fun conversations(): JSONArray = request("/api/conversations").optJSONArray("conversations") ?: JSONArray()
    fun conversationMessages(id: String): JSONArray = request("/api/conversations/$id/messages").optJSONArray("messages") ?: JSONArray()
    fun tasks(): JSONArray = request("/api/agent/tasks").optJSONArray("tasks") ?: JSONArray()
    fun task(id: String): JSONObject = request("/api/agent/tasks/$id")
    fun createTask(title: String, prompt: String): JSONObject =
        request("/api/agent/tasks", "POST", JSONObject().put("title", title).put("prompt", prompt))
    fun planTask(id: String): JSONObject = request("/api/agent/tasks/$id/plan", "POST", JSONObject())
    fun taskAction(id: String, action: String): JSONObject {
        require(action in setOf("approve", "reject", "pause", "resume", "cancel"))
        return request("/api/agent/tasks/$id/$action", "POST", JSONObject())
    }
    fun saveProvider(provider: String, key: String, model: String) =
        request("/api/providers/$provider", "PUT", JSONObject().put("apiKey", key).put("model", model))
    fun selectProvider(provider: String) =
        request("/api/provider-selection", "PUT", JSONObject().put("provider", provider))
    fun providers(): JSONObject = request("/api/providers")
}
