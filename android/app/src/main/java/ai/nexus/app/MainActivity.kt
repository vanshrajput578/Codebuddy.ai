package ai.nexus.app

import android.annotation.SuppressLint
import android.os.Bundle
import android.webkit.CookieManager
import android.webkit.SafeBrowsingResponse
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import java.net.URI

private val Ink = Color(0xFF09090D)
private val Panel = Color(0xFF15151D)
private val Violet = Color(0xFF8B75FF)
private val Muted = Color(0xFFA5A2B2)
private val White = Color(0xFFF5F3FA)

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.statusBarColor = android.graphics.Color.rgb(9, 9, 13)
        window.navigationBarColor = android.graphics.Color.rgb(9, 9, 13)
        setContent { NexusTheme { NexusApp(NexusApi(this)) } }
    }
}

@Composable
private fun NexusTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = darkColorScheme(
            primary = Violet, background = Ink, surface = Panel,
            onPrimary = Color.White, onBackground = White, onSurface = White,
            error = Color(0xFFFF7777)
        ),
        content = content
    )
}

@Composable
private fun NexusApp(api: NexusApi) {
    var origin by remember { mutableStateOf(api.baseUrl()) }
    var connectedOrigin by remember { mutableStateOf(if (api.isConfigured()) api.baseUrl() else "") }
    var error by remember { mutableStateOf("") }
    var pageError by remember { mutableStateOf(false) }
    var webView by remember { mutableStateOf<WebView?>(null) }

    BackHandler(enabled = connectedOrigin.isNotBlank() && webView?.canGoBack() == true) {
        webView?.goBack()
    }

    Surface(Modifier.fillMaxSize(), color = Ink) {
        if (connectedOrigin.isBlank()) {
            Column(
                Modifier.fillMaxSize().padding(horizontal = 24.dp, vertical = 28.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp)
            ) {
                Spacer(Modifier.height(12.dp))
                Text("NEXUS", color = White, style = MaterialTheme.typography.displaySmall, fontWeight = FontWeight.Black)
                Text("PERSONAL AI WORKSPACE", color = Muted, style = MaterialTheme.typography.titleSmall)
                Spacer(Modifier.height(18.dp))
                Text("Connect your NEXUS server", style = MaterialTheme.typography.headlineSmall, color = White)
                Text(
                    "Enter the deployed HTTPS API origin. The complete NEXUS HTML workspace will open inside this app.",
                    color = Muted, style = MaterialTheme.typography.bodyLarge
                )
                OutlinedTextField(
                    value = origin, onValueChange = { origin = it; error = "" },
                    label = { Text("https://your-nexus-domain.com") },
                    singleLine = true, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri),
                    modifier = Modifier.fillMaxWidth()
                )
                Button(
                    onClick = {
                        val parsed = runCatching { URI(origin.trim().trimEnd('/')) }.getOrNull()
                        val valid = parsed != null && parsed.scheme == "https" &&
                            !parsed.host.isNullOrBlank() && parsed.rawUserInfo == null &&
                            parsed.rawQuery == null && parsed.rawFragment == null &&
                            parsed.rawPath.orEmpty().let { it.isEmpty() || it == "/" }
                        if (!valid) {
                            error = "Enter a valid HTTPS server origin, without an API path."
                        } else {
                            val clean = "https://${parsed!!.rawAuthority}"
                            api.setBaseUrl(clean)
                            origin = clean
                            error = ""
                            pageError = false
                            connectedOrigin = clean
                        }
                    },
                    modifier = Modifier.fillMaxWidth().height(54.dp),
                    shape = RoundedCornerShape(28.dp)
                ) { Text("Open NEXUS workspace", style = MaterialTheme.typography.titleMedium) }
                if (error.isNotBlank()) Text(error, color = MaterialTheme.colorScheme.error)
                Spacer(Modifier.height(4.dp))
                Text(
                    "A deployed NEXUS backend is required. Provider API keys stay on the server.",
                    color = Muted, style = MaterialTheme.typography.bodySmall
                )
            }
        } else {
            Column(Modifier.fillMaxSize()) {
                Row(
                    Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 7.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text("NEXUS", color = White, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
                    TextButton(onClick = {
                        webView?.stopLoading()
                        webView?.destroy()
                        webView = null
                        connectedOrigin = ""
                        origin = api.baseUrl()
                        pageError = false
                    }) { Text("Change server") }
                }
                if (pageError) {
                    Column(
                        Modifier.fillMaxWidth().padding(20.dp),
                        verticalArrangement = Arrangement.spacedBy(10.dp)
                    ) {
                        Text("Could not load NEXUS", color = White, style = MaterialTheme.typography.titleLarge)
                        Text("Check that the server is deployed and the URL is correct.", color = Muted)
                        Button(onClick = { pageError = false; webView?.reload() }) { Text("Retry") }
                    }
                }
                AndroidView(
                    modifier = Modifier.weight(1f).fillMaxWidth(),
                    factory = { context ->
                        createWorkspaceWebView(context, connectedOrigin) { failed ->
                            pageError = failed
                        }.also { webView = it }
                    },
                    update = { view -> if (view.url.isNullOrBlank()) view.loadUrl(connectedOrigin) }
                )
            }
        }
    }
}

@SuppressLint("SetJavaScriptEnabled")
private fun createWorkspaceWebView(
    context: android.content.Context,
    origin: String,
    onMainFrameError: (Boolean) -> Unit
): WebView {
    val expected = URI(origin)
    return WebView(context).apply {
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        settings.allowFileAccess = false
        settings.allowContentAccess = false
        settings.javaScriptCanOpenWindowsAutomatically = false
        settings.setSupportMultipleWindows(false)
        settings.mixedContentMode = android.webkit.WebSettings.MIXED_CONTENT_NEVER_ALLOW
        settings.safeBrowsingEnabled = true
        CookieManager.getInstance().setAcceptCookie(true)
        CookieManager.getInstance().setAcceptThirdPartyCookies(this, false)
        webChromeClient = WebChromeClient()
        webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val target = request.url
                return target.scheme != "https" || !target.host.equals(expected.host, ignoreCase = true) ||
                    target.port != expected.port
            }

            override fun onPageStarted(view: WebView, url: String, favicon: android.graphics.Bitmap?) {
                onMainFrameError(false)
            }

            override fun onPageFinished(view: WebView, url: String) {
                onMainFrameError(false)
            }

            override fun onReceivedError(
                view: WebView, request: WebResourceRequest, error: android.webkit.WebResourceError
            ) {
                if (request.isForMainFrame) onMainFrameError(true)
            }

            override fun onReceivedHttpError(
                view: WebView, request: WebResourceRequest, response: android.webkit.WebResourceResponse
            ) {
                if (request.isForMainFrame && response.statusCode >= 500) onMainFrameError(true)
            }
        }
        loadUrl(origin)
    }
}
