package com.cartcompare.app.push

import android.util.Log
import com.cartcompare.app.AppGraph
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

/** Receives price alerts sent by the refreshTrackedPrices Cloud Function. */
class PriceAlertMessagingService : FirebaseMessagingService() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    override fun onNewToken(token: String) {
        scope.launch {
            runCatching { AppGraph.repo.registerPushToken(token) }
                .onFailure { Log.w("CartCompare", "Couldn't save new push token", it) }
        }
    }

    override fun onMessageReceived(message: RemoteMessage) {
        val data = message.data
        if (data["type"] != "price_alert") return
        val productId = data["productId"] ?: return
        Notifications.showPriceAlert(
            context = this,
            productId = productId,
            title = data["title"] ?: "Price alert",
            body = data["body"] ?: "",
        )
    }

    override fun onDestroy() {
        scope.cancel()
        super.onDestroy()
    }
}
