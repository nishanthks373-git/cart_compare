package com.cartcompare.app

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.getValue
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.cartcompare.app.ui.AppNavHost
import com.cartcompare.app.ui.theme.CartCompareTheme
import kotlinx.coroutines.flow.MutableStateFlow

/** Something the app was asked to do from outside: a shared link or a tapped notification. */
sealed interface ExternalAction {
    data class Lookup(val text: String) : ExternalAction
    data class OpenProduct(val productId: String) : ExternalAction
}

class MainActivity : ComponentActivity() {
    private val pending = MutableStateFlow<ExternalAction?>(null)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        if (savedInstanceState == null) handleIntent(intent)
        setContent {
            CartCompareTheme {
                val action by pending.collectAsStateWithLifecycle()
                AppNavHost(action = action, onActionHandled = { pending.value = null })
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleIntent(intent)
    }

    private fun handleIntent(intent: Intent?) {
        if (intent == null) return
        val productId = intent.getStringExtra(EXTRA_PRODUCT_ID)
        val shared = intent.getStringExtra(Intent.EXTRA_TEXT)
        when {
            productId != null -> pending.value = ExternalAction.OpenProduct(productId)
            intent.action == Intent.ACTION_SEND && !shared.isNullOrBlank() -> pending.value = ExternalAction.Lookup(shared)
        }
    }

    companion object {
        const val EXTRA_PRODUCT_ID = "productId"
    }
}
