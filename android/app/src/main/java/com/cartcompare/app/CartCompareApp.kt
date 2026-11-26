package com.cartcompare.app

import android.app.Application
import android.util.Log
import com.cartcompare.app.push.Notifications
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

class CartCompareApp : Application() {
    val appScope = CoroutineScope(SupervisorJob() + Dispatchers.Main)

    override fun onCreate() {
        super.onCreate()
        Notifications.createChannel(this)
        if (!BuildConfig.FIREBASE_CONFIGURED) return
        appScope.launch {
            runCatching { AppGraph.repo.registerPushToken() }
                .onFailure { Log.w("CartCompare", "Push token registration failed", it) }
        }
    }
}
