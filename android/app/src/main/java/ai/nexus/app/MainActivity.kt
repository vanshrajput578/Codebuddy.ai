package ai.nexus.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject

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
    MaterialTheme(colorScheme = darkColorScheme(primary = Violet, background = Ink, surface = Panel,
        onPrimary = Color.White, onBackground = White, onSurface = White, secondary = Color(0xFF55D9D1),
        error = Color(0xFFFF7777)), content = content)
}

@Composable
private fun NexusApp(api: NexusApi) {
    var user by remember { mutableStateOf<JSONObject?>(null) }
    var loading by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf("") }
    var tab by remember { mutableStateOf("Chat") }
    var apiOrigin by remember { mutableStateOf(api.baseUrl()) }
    val scope = rememberCoroutineScope()

    fun runRequest(action: suspend () -> Unit) {
        scope.launch {
            loading = true; error = ""
            try { action() } catch (e: Exception) { error = e.message ?: "Request failed." }
            finally { loading = false }
        }
    }

    LaunchedEffect(api.isConfigured()) {
        if (api.isConfigured()) {
            loading = true
            try {
                val result = withContext(Dispatchers.IO) { api.restoreSession() }
                user = result.optJSONObject("user")
            } catch (_: Exception) { user = null }
            finally { loading = false }
        }
    }

    Surface(Modifier.fillMaxSize(), color = Ink) {
        Column(Modifier.fillMaxSize().padding(horizontal = 18.dp, vertical = 12.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth()) {
                Column(Modifier.weight(1f)) {
                    Text("NEXUS", color = White, style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Black)
                    Text("PERSONAL AI WORKSPACE", color = Muted, style = MaterialTheme.typography.labelSmall)
                }
                user?.let { Text(it.optString("displayName", "Account"), color = Violet) }
            }
            Spacer(Modifier.height(18.dp))
            if (!api.isConfigured()) {
                OriginSetup(apiOrigin, { apiOrigin = it }) {
                    api.setBaseUrl(apiOrigin)
                    error = if (api.isConfigured()) "Server saved. Sign in to continue." else "Enter a valid HTTPS origin without a path."
                }
            } else if (user == null) {
                AuthScreen(loading, error, onLogin = { email, password ->
                    runRequest {
                        val result = withContext(Dispatchers.IO) { api.login(email, password) }
                        user = result.optJSONObject("user")
                    }
                }, onRegister = { name, email, password ->
                    runRequest {
                        val result = withContext(Dispatchers.IO) { api.register(name, email, password) }
                        user = result.optJSONObject("user")
                    }
                }, onConfigure = { apiOrigin = ""; api.setBaseUrl("") })
            } else {
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.fillMaxWidth()) {
                    listOf("Chat", "Tasks", "Settings").forEach { label ->
                        FilterChip(selected = tab == label, onClick = { tab = label }, label = { Text(label) })
                    }
                    Spacer(Modifier.weight(1f))
                    TextButton(onClick = { runRequest { withContext(Dispatchers.IO) { api.logout() }; user = null } }) { Text("Sign out") }
                }
                Spacer(Modifier.height(12.dp))
                when (tab) {
                    "Chat" -> ChatScreen(api, loading, ::runRequest)
                    "Tasks" -> TasksScreen(api, ::runRequest)
                    else -> SettingsScreen(api, ::runRequest)
                }
            }
            if (error.isNotBlank()) {
                Spacer(Modifier.height(8.dp))
                Text(error, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
            }
        }
    }
}

@Composable
private fun OriginSetup(value: String, onValue: (String) -> Unit, onSave: () -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text("Connect your NEXUS server", style = MaterialTheme.typography.headlineSmall)
        Text("Enter the deployed HTTPS API origin. Provider API keys remain on the server.", color = Muted)
        OutlinedTextField(value, onValue, label = { Text("https://your-nexus-domain.com") }, singleLine = true, modifier = Modifier.fillMaxWidth())
        Button(onClick = onSave, modifier = Modifier.fillMaxWidth()) { Text("Save server") }
    }
}

@Composable
private fun AuthScreen(loading: Boolean, error: String, onLogin: (String, String) -> Unit,
                       onRegister: (String, String, String) -> Unit, onConfigure: () -> Unit) {
    var register by remember { mutableStateOf(false) }
    var name by remember { mutableStateOf("") }
    var email by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text(if (register) "Create your account" else "Welcome back", style = MaterialTheme.typography.headlineSmall)
        Text("Your account and conversations are stored on your NEXUS server.", color = Muted)
        if (register) OutlinedTextField(name, { name = it }, label = { Text("Display name") }, modifier = Modifier.fillMaxWidth())
        OutlinedTextField(email, { email = it }, label = { Text("Email") }, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email), modifier = Modifier.fillMaxWidth())
        OutlinedTextField(password, { password = it }, label = { Text("Password") }, visualTransformation = PasswordVisualTransformation(), modifier = Modifier.fillMaxWidth())
        Button(enabled = !loading, onClick = { if (register) onRegister(name, email, password) else onLogin(email, password) }, modifier = Modifier.fillMaxWidth()) {
            Text(if (loading) "Please wait…" else if (register) "Create account" else "Sign in")
        }
        TextButton(onClick = { register = !register }) { Text(if (register) "Already have an account? Sign in" else "Create account") }
        TextButton(onClick = onConfigure) { Text("Change server URL") }
        if (error.isNotBlank()) Text(error, color = MaterialTheme.colorScheme.error)
    }
}

@Composable
private fun ChatScreen(api: NexusApi, loading: Boolean, runRequest: (suspend () -> Unit) -> Unit) {
    var messages by remember { mutableStateOf(listOf<Pair<String, String>>()) }
    var draft by remember { mutableStateOf("") }
    var conversationId by remember { mutableStateOf<String?>(null) }
    var historyOpen by remember { mutableStateOf(false) }
    var conversations by remember { mutableStateOf(listOf<JSONObject>()) }
    Column(Modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            Text("AI Chat", style = MaterialTheme.typography.titleLarge)
            Row {
                Box {
                    TextButton(onClick = {
                        runRequest {
                            val array = withContext(Dispatchers.IO) { api.conversations() }
                            conversations = (0 until array.length()).map { array.getJSONObject(it) }
                            historyOpen = true
                        }
                    }) { Text("History") }
                    DropdownMenu(expanded = historyOpen, onDismissRequest = { historyOpen = false }) {
                        conversations.forEach { conversation ->
                            DropdownMenuItem(
                                text = { Text(conversation.optString("title").take(38)) },
                                onClick = {
                                    val id = conversation.optString("id")
                                    runRequest {
                                        val array = withContext(Dispatchers.IO) { api.conversationMessages(id) }
                                        messages = (0 until array.length()).map { index ->
                                            val item = array.getJSONObject(index)
                                            (if (item.optString("role") == "assistant") "NEXUS" else "You") to item.optString("content")
                                        }
                                        conversationId = id
                                        historyOpen = false
                                    }
                                }
                            )
                        }
                        if (conversations.isEmpty()) DropdownMenuItem(text = { Text("No conversations yet") }, onClick = { historyOpen = false })
                    }
                }
                TextButton(onClick = { messages = emptyList(); conversationId = null }) { Text("New chat") }
            }
        }
        LazyColumn(Modifier.weight(1f).fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            items(messages) { item ->
                Card(colors = CardDefaults.cardColors(containerColor = if (item.first == "You") Color(0xFF211D32) else Panel), shape = RoundedCornerShape(14.dp)) {
                    Column(Modifier.fillMaxWidth().padding(14.dp)) {
                        Text(item.first, color = Violet, style = MaterialTheme.typography.labelSmall)
                        Spacer(Modifier.height(5.dp)); Text(item.second, color = White)
                    }
                }
            }
            if (messages.isEmpty()) item { Text("Ask NEXUS anything. Your selected provider runs securely on the server.", color = Muted, modifier = Modifier.padding(vertical = 28.dp)) }
        }
        Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedTextField(value = draft, onValueChange = { draft = it }, modifier = Modifier.weight(1f), placeholder = { Text("Message NEXUS…") }, maxLines = 4)
            Button(enabled = draft.isNotBlank() && !loading, onClick = {
                val text = draft.trim()
                messages = messages + ("You" to text); draft = ""
                runRequest {
                    val result = withContext(Dispatchers.IO) { api.chat(text, conversationId) }
                    conversationId = result.optString("conversationId").takeIf { it.isNotBlank() }
                    messages = messages + ("NEXUS" to result.optString("answer", "No answer returned."))
                }
            }) { Text("Send") }
        }
    }
}

@Composable
private fun TasksScreen(api: NexusApi, runRequest: (suspend () -> Unit) -> Unit) {
    var tasks by remember { mutableStateOf(listOf<JSONObject>()) }
    var detail by remember { mutableStateOf<JSONObject?>(null) }
    var selectedId by remember { mutableStateOf("") }
    var title by remember { mutableStateOf("") }
    var prompt by remember { mutableStateOf("") }

    fun refresh() = runRequest {
        val array = withContext(Dispatchers.IO) { api.tasks() }
        tasks = (0 until array.length()).map { array.getJSONObject(it) }
        if (selectedId.isNotBlank()) detail = withContext(Dispatchers.IO) { api.task(selectedId).optJSONObject("task") }
    }
    LaunchedEffect(Unit) { refresh() }

    Column(Modifier.fillMaxSize(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Text("Agent Tasks", style = MaterialTheme.typography.titleLarge)
            TextButton(onClick = { refresh() }) { Text("Refresh") }
        }
        OutlinedTextField(value = title, onValueChange = { title = it }, label = { Text("Task title (optional)") }, modifier = Modifier.fillMaxWidth(), singleLine = true)
        OutlinedTextField(value = prompt, onValueChange = { prompt = it }, label = { Text("What should NEXUS do?") }, modifier = Modifier.fillMaxWidth(), minLines = 2, maxLines = 3)
        Button(enabled = prompt.isNotBlank(), onClick = {
            runRequest {
                val created = withContext(Dispatchers.IO) { api.createTask(title, prompt) }
                val id = created.optJSONObject("task")?.optString("id").orEmpty()
                if (id.isBlank()) error("Task creation did not return an ID.")
                withContext(Dispatchers.IO) { api.planTask(id) }
                selectedId = id
                detail = withContext(Dispatchers.IO) { api.task(id).optJSONObject("task") }
                title = ""; prompt = ""
                val array = withContext(Dispatchers.IO) { api.tasks() }
                tasks = (0 until array.length()).map { array.getJSONObject(it) }
            }
        }, modifier = Modifier.fillMaxWidth()) { Text("Create task & generate plan") }

        Text("Your tasks", style = MaterialTheme.typography.titleMedium)
        LazyColumn(Modifier.weight(1f).fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(7.dp)) {
            items(tasks) { task ->
                Card(onClick = {
                    selectedId = task.optString("id")
                    runRequest { detail = withContext(Dispatchers.IO) { api.task(selectedId).optJSONObject("task") } }
                }, colors = CardDefaults.cardColors(containerColor = Panel)) {
                    Column(Modifier.fillMaxWidth().padding(11.dp)) {
                        Text(task.optString("title"), fontWeight = FontWeight.SemiBold)
                        Text(task.optString("status").replace('_', ' ') + " · " + task.optInt("current_step") + " steps", color = Muted)
                    }
                }
            }
        }
        detail?.let { task ->
            Column(Modifier.fillMaxWidth().heightIn(max = 300.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                HorizontalDivider(color = Color(0xFF373440))
                Text(task.optString("title"), style = MaterialTheme.typography.titleMedium)
                Text(task.optString("status").replace('_', ' '), color = Violet)
                val plan = task.optJSONObject("plan")?.optJSONArray("steps")
                if (plan != null) {
                    Text("Plan · review before approval", fontWeight = FontWeight.SemiBold)
                    for (index in 0 until plan.length()) {
                        val step = plan.getJSONObject(index)
                        Text("${index + 1}. ${step.optString("title")} · ${step.optString("tool")}", fontWeight = FontWeight.Medium)
                        Text(step.optString("description"), color = Muted, style = MaterialTheme.typography.bodySmall)
                        if (step.optBoolean("requiresApproval")) Text("APPROVAL REQUIRED", color = Color(0xFFFFC66D), style = MaterialTheme.typography.labelSmall)
                    }
                }
                if (task.optString("result").isNotBlank()) Text(task.optString("result"), color = Muted)
                val actions = when (task.optString("status")) {
                    "awaiting_approval" -> listOf("approve", "reject")
                    "running" -> listOf("pause", "cancel")
                    "paused" -> listOf("resume", "cancel")
                    else -> emptyList()
                }
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    actions.forEach { action ->
                        OutlinedButton(onClick = {
                            runRequest {
                                withContext(Dispatchers.IO) { api.taskAction(task.optString("id"), action) }
                                detail = withContext(Dispatchers.IO) { api.task(task.optString("id")).optJSONObject("task") }
                                val array = withContext(Dispatchers.IO) { api.tasks() }
                                tasks = (0 until array.length()).map { array.getJSONObject(it) }
                            }
                        }) { Text(action.replaceFirstChar { it.uppercase() }) }
                    }
                }
            }
        }
    }
}

@Composable
private fun SettingsScreen(api: NexusApi, runRequest: (suspend () -> Unit) -> Unit) {
    var provider by remember { mutableStateOf("gemini") }
    var model by remember { mutableStateOf("gemini-2.5-flash") }
    var key by remember { mutableStateOf("") }
    var providers by remember { mutableStateOf<JSONObject?>(null) }
    LaunchedEffect(Unit) { runCatching { withContext(Dispatchers.IO) { api.providers() } }.onSuccess { providers = it } }
    Column(verticalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.fillMaxWidth().verticalScroll(rememberScrollState())) {
        Text("Settings", style = MaterialTheme.typography.titleLarge)
        Text("AI provider", style = MaterialTheme.typography.titleMedium)
        listOf("gemini", "openai", "openrouter", "anthropic").forEach { id ->
            FilterChip(selected = provider == id, onClick = {
                provider = id
                model = when (id) {
                    "openai" -> "gpt-4.1-mini"
                    "openrouter" -> "openai/gpt-4.1-mini"
                    "anthropic" -> "claude-sonnet-4-20250514"
                    else -> "gemini-2.5-flash"
                }
            }, label = { Text(id.replaceFirstChar { it.uppercase() }) })
        }
        OutlinedTextField(value = model, onValueChange = { model = it }, label = { Text("Model ID") }, modifier = Modifier.fillMaxWidth())
        OutlinedTextField(value = key, onValueChange = { key = it }, label = { Text("API key (not stored on this device)") }, visualTransformation = PasswordVisualTransformation(), modifier = Modifier.fillMaxWidth())
        Button(onClick = {
            runRequest {
                withContext(Dispatchers.IO) { api.saveProvider(provider, key, model) }
                withContext(Dispatchers.IO) { api.selectProvider(provider) }
                key = ""
                providers = withContext(Dispatchers.IO) { api.providers() }
            }
        }, enabled = key.isNotBlank()) { Text("Save & select provider") }
        Text("Configured providers: " + (providers?.optJSONArray("providers")?.length() ?: 0), color = Muted)
        Text("Provider keys are sent to your NEXUS server and encrypted there. This app does not save API keys.", color = Muted, style = MaterialTheme.typography.bodySmall)
        Text("To switch servers, sign out and change the server URL on the sign-in screen.", color = Muted, style = MaterialTheme.typography.bodySmall)
    }
}
