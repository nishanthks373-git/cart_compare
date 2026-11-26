package com.cartcompare.app.data

import com.google.firebase.Firebase
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.auth.auth
import com.google.firebase.firestore.FieldValue
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.Query
import com.google.firebase.firestore.SetOptions
import com.google.firebase.firestore.firestore
import com.google.firebase.functions.FirebaseFunctions
import com.google.firebase.functions.FirebaseFunctionsException
import com.google.firebase.functions.functions
import com.google.firebase.messaging.messaging
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.tasks.await
import java.io.IOException
import java.util.concurrent.TimeUnit

/** Must match setGlobalOptions({ region }) in firebase/functions/src/index.ts */
private const val FUNCTIONS_REGION = "asia-south1"

class ProductRepository(
    private val auth: FirebaseAuth = Firebase.auth,
    private val db: FirebaseFirestore = Firebase.firestore,
    private val functions: FirebaseFunctions = Firebase.functions(FUNCTIONS_REGION),
) {
    /** Anonymous sign-in: every install gets its own private watchlist without a login screen. */
    suspend fun ensureSignedIn(): String =
        auth.currentUser?.uid ?: auth.signInAnonymously().await().user!!.uid

    /** Send a link (or whole share text) to the backend. Returns the productId to open. */
    suspend fun lookup(textOrUrl: String, refresh: Boolean = false): String {
        ensureSignedIn()
        val callable = functions.getHttpsCallable("lookupProduct")
        callable.setTimeout(130, TimeUnit.SECONDS)
        val result = callable.call(mapOf("text" to textOrUrl, "refresh" to refresh)).await()
        val data = result.getData() as? Map<*, *> ?: error("Empty response")
        return data["productId"] as? String ?: error("No productId in response")
    }

    suspend fun track(productId: String, targetPrice: Double?, mode: AlertMode) {
        ensureSignedIn()
        functions.getHttpsCallable("trackProduct")
            .call(mapOf("productId" to productId, "targetPrice" to targetPrice, "alertMode" to mode.wire))
            .await()
    }

    suspend fun untrack(productId: String) {
        ensureSignedIn()
        functions.getHttpsCallable("untrackProduct").call(mapOf("productId" to productId)).await()
    }

    fun product(productId: String): Flow<Product?> = callbackFlow {
        ensureSignedIn()
        val reg = db.collection("products").document(productId).addSnapshotListener { snap, err ->
            if (err != null) {
                close(err); return@addSnapshotListener
            }
            trySend(snap?.takeIf { it.exists() }?.toProduct())
        }
        awaitClose { reg.remove() }
    }

    fun history(productId: String): Flow<List<PricePoint>> = callbackFlow {
        ensureSignedIn()
        val reg = db.collection("products").document(productId).collection("history")
            .orderBy("at", Query.Direction.ASCENDING)
            .limitToLast(1500)
            .addSnapshotListener { snap, err ->
                if (err != null) {
                    close(err); return@addSnapshotListener
                }
                trySend(snap?.documents.orEmpty().mapNotNull { it.toPricePoint() })
            }
        awaitClose { reg.remove() }
    }

    fun trackedList(): Flow<List<TrackedItem>> = callbackFlow {
        val uid = ensureSignedIn()
        val reg = db.collection("users").document(uid).collection("tracked")
            .orderBy("createdAt", Query.Direction.DESCENDING)
            .addSnapshotListener { snap, err ->
                if (err != null) {
                    close(err); return@addSnapshotListener
                }
                trySend(snap?.documents.orEmpty().map { it.toTrackedItem() })
            }
        awaitClose { reg.remove() }
    }

    fun trackedItem(productId: String): Flow<TrackedItem?> = callbackFlow {
        val uid = ensureSignedIn()
        val reg = db.collection("users").document(uid).collection("tracked").document(productId)
            .addSnapshotListener { snap, err ->
                if (err != null) {
                    close(err); return@addSnapshotListener
                }
                trySend(snap?.takeIf { it.exists() }?.toTrackedItem())
            }
        awaitClose { reg.remove() }
    }

    /** Save this device's push token so the backend can send price alerts here. */
    suspend fun registerPushToken(token: String? = null) {
        val uid = ensureSignedIn()
        val t = token ?: Firebase.messaging.token.await()
        val ref = db.collection("users").document(uid)
        @Suppress("UNCHECKED_CAST")
        val existing = (ref.get().await().get("fcmTokens") as? List<String>).orEmpty()
        if (existing.lastOrNull() == t) return
        // Keep only a few recent tokens (reinstalls create new ones); rules allow at most 10.
        val tokens = (existing.filter { it != t } + t).takeLast(5)
        ref.set(mapOf("fcmTokens" to tokens, "updatedAt" to FieldValue.serverTimestamp()), SetOptions.merge()).await()
    }
}

/** Human-readable message for anything thrown by the repository. */
fun Throwable.friendlyMessage(): String = when (this) {
    is FirebaseFunctionsException -> when (code) {
        FirebaseFunctionsException.Code.UNAVAILABLE,
        FirebaseFunctionsException.Code.DEADLINE_EXCEEDED -> message ?: "The store didn't respond. Try again in a minute."
        FirebaseFunctionsException.Code.NOT_FOUND -> message ?: "Not found."
        FirebaseFunctionsException.Code.INTERNAL -> "Something went wrong on our side. Try again."
        else -> message ?: "Request failed."
    }
    is IOException -> "No internet connection."
    else -> message ?: "Something went wrong."
}
