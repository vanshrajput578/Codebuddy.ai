package ai.nexus.app

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import okhttp3.Cookie
import okhttp3.CookieJar
import okhttp3.HttpUrl
import org.json.JSONArray
import org.json.JSONObject
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** Persists the server-issued session cookie encrypted with an Android Keystore AES key. */
class SecureCookieJar(context: Context) : CookieJar {
    private val prefs = context.getSharedPreferences("nexus_secure_session", Context.MODE_PRIVATE)
    private val keyAlias = "nexus.session.aes.v1"
    private val key: SecretKey by lazy { getOrCreateKey() }
    @Volatile private var cookies: List<Cookie> = decryptCookies()

    override fun saveFromResponse(url: HttpUrl, cookies: List<Cookie>) {
        val updated = this.cookies.filterNot { old ->
            cookies.any { it.name == old.name && it.domain == old.domain && it.path == old.path }
        } + cookies.filter { !it.hasExpired() }
        this.cookies = updated.filter { !it.hasExpired() }
        persist(this.cookies)
    }

    override fun loadForRequest(url: HttpUrl): List<Cookie> {
        val valid = cookies.filter { !it.hasExpired() && it.matches(url) }
        if (valid.size != cookies.size) {
            cookies = cookies.filterNot { it.hasExpired() }
            persist(cookies)
        }
        return valid
    }

    fun clear() {
        cookies = emptyList()
        prefs.edit().remove("blob").apply()
    }

    private fun getOrCreateKey(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey(keyAlias, null) as? SecretKey)?.let { return it }
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        generator.init(KeyGenParameterSpec.Builder(keyAlias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setRandomizedEncryptionRequired(true).build())
        return generator.generateKey()
    }

    private fun persist(items: List<Cookie>) {
        val array = JSONArray()
        items.forEach { cookie ->
            array.put(JSONObject().apply {
                put("name", cookie.name); put("value", cookie.value)
                put("domain", cookie.domain); put("path", cookie.path)
                put("expiresAt", cookie.expiresAt); put("secure", cookie.secure)
                put("httpOnly", cookie.httpOnly); put("hostOnly", cookie.hostOnly)
            })
        }
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key)
        val encrypted = cipher.doFinal(array.toString().toByteArray(Charsets.UTF_8))
        prefs.edit().putString("blob", Base64.encodeToString(cipher.iv + encrypted, Base64.NO_WRAP)).apply()
    }

    private fun decryptCookies(): List<Cookie> {
        return try {
            val encoded = prefs.getString("blob", null) ?: return emptyList()
            val blob = Base64.decode(encoded, Base64.NO_WRAP)
            require(blob.size > 12)
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(128, blob.copyOfRange(0, 12)))
            val array = JSONArray(String(cipher.doFinal(blob.copyOfRange(12, blob.size)), Charsets.UTF_8))
            buildList {
                for (i in 0 until array.length()) {
                    val item = array.getJSONObject(i)
                    val builder = Cookie.Builder().name(item.getString("name")).value(item.getString("value")).path(item.getString("path"))
                    if (item.getBoolean("hostOnly")) builder.hostOnlyDomain(item.getString("domain")) else builder.domain(item.getString("domain"))
                    if (item.getBoolean("secure")) builder.secure()
                    if (item.getBoolean("httpOnly")) builder.httpOnly()
                    val expires = item.getLong("expiresAt")
                    if (expires != Long.MAX_VALUE) builder.expiresAt(expires)
                    builder.build().takeUnless { it.hasExpired() }?.let(::add)
                }
            }
        } catch (_: Exception) {
            prefs.edit().remove("blob").apply()
            emptyList()
        }
    }
}
