package com.cartcompare.app.data

import com.google.firebase.firestore.DocumentSnapshot
import java.util.Date

data class Offer(
    val store: String,
    val storeName: String,
    val title: String,
    val price: Double,
    val url: String,
    val imageUrl: String?,
    val matchScore: Double,
)

data class Product(
    val id: String,
    val store: String,
    val storeName: String,
    val url: String,
    val title: String,
    val brand: String?,
    val imageUrl: String?,
    val price: Double?,
    val mrp: Double?,
    val inStock: Boolean,
    val rating: Double?,
    val ratingCount: Long?,
    val lowestPrice: Double?,
    val highestPrice: Double?,
    val comparisons: List<Offer>,
    val comparisonsUpdatedAt: Date?,
    val lastChecked: Date?,
    val lastError: String?,
) {
    val discountPercent: Int?
        get() = if (price != null && mrp != null && mrp > price) (((mrp - price) / mrp) * 100).toInt() else null
}

data class PricePoint(val price: Double, val at: Date)

enum class AlertMode(val wire: String, val label: String, val description: String) {
    DROP("drop", "Any price drop", "Alert me whenever the price goes down"),
    ANY("any", "Any price change", "Alert me when the price goes up or down"),
    TARGET_ONLY("target_only", "Only at my target", "Alert me only when it reaches my target price");

    companion object {
        fun fromWire(s: String?) = entries.firstOrNull { it.wire == s } ?: DROP
    }
}

data class TrackedItem(
    val productId: String,
    val title: String,
    val imageUrl: String?,
    val storeName: String,
    val currentPrice: Double?,
    val inStock: Boolean,
    val targetPrice: Double?,
    val alertMode: AlertMode,
    val priceWhenAdded: Double?,
)

// Firestore stores whole numbers as Long and others as Double, so read numbers generically.
private fun DocumentSnapshot.num(field: String): Double? = (get(field) as? Number)?.toDouble()
private fun Map<*, *>.num(key: String): Double? = (this[key] as? Number)?.toDouble()

fun DocumentSnapshot.toProduct(): Product = Product(
    id = id,
    store = getString("store").orEmpty(),
    storeName = getString("storeName").orEmpty(),
    url = getString("url").orEmpty(),
    title = getString("title").orEmpty(),
    brand = getString("brand"),
    imageUrl = getString("imageUrl"),
    price = num("price"),
    mrp = num("mrp"),
    inStock = getBoolean("inStock") ?: true,
    rating = num("rating"),
    ratingCount = (get("ratingCount") as? Number)?.toLong(),
    lowestPrice = num("lowestPrice"),
    highestPrice = num("highestPrice"),
    comparisons = (get("comparisons") as? List<*>).orEmpty().mapNotNull { (it as? Map<*, *>)?.toOffer() },
    comparisonsUpdatedAt = getTimestamp("comparisonsUpdatedAt")?.toDate(),
    lastChecked = getTimestamp("lastChecked")?.toDate(),
    lastError = getString("lastError"),
)

private fun Map<*, *>.toOffer(): Offer? {
    val price = num("price") ?: return null
    val url = this["url"] as? String ?: return null
    return Offer(
        store = this["store"] as? String ?: "other",
        storeName = this["storeName"] as? String ?: "Store",
        title = this["title"] as? String ?: "",
        price = price,
        url = url,
        imageUrl = this["imageUrl"] as? String,
        matchScore = num("matchScore") ?: 0.0,
    )
}

fun DocumentSnapshot.toPricePoint(): PricePoint? {
    val price = num("price") ?: return null
    val at = getTimestamp("at")?.toDate() ?: return null
    return PricePoint(price, at)
}

fun DocumentSnapshot.toTrackedItem(): TrackedItem = TrackedItem(
    productId = id,
    title = getString("title").orEmpty(),
    imageUrl = getString("imageUrl"),
    storeName = getString("storeName").orEmpty(),
    currentPrice = num("currentPrice"),
    inStock = getBoolean("inStock") ?: true,
    targetPrice = num("targetPrice"),
    alertMode = AlertMode.fromWire(getString("alertMode")),
    priceWhenAdded = num("priceWhenAdded"),
)
