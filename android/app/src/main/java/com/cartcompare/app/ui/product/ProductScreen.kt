@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)

package com.cartcompare.app.ui.product

import android.Manifest
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Share
import androidx.compose.material.icons.filled.ShoppingCart
import androidx.compose.material.icons.filled.Star
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ElevatedCard
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import coil.compose.AsyncImage
import com.cartcompare.app.AppGraph
import com.cartcompare.app.data.PricePoint
import com.cartcompare.app.data.Product
import com.cartcompare.app.data.TrackedItem
import com.cartcompare.app.push.Notifications
import com.cartcompare.app.ui.components.PriceChart
import com.cartcompare.app.ui.components.clipHistory
import com.cartcompare.app.ui.theme.PriceColors
import com.cartcompare.app.util.Fmt
import java.text.NumberFormat
import kotlin.math.abs

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ProductScreen(productId: String, onBack: () -> Unit) {
    val vm: ProductViewModel = viewModel(key = productId) { ProductViewModel(productId, AppGraph.repo) }
    val state by vm.state.collectAsStateWithLifecycle()
    val context = LocalContext.current
    val snackbar = remember { SnackbarHostState() }
    var showTrackDialog by rememberSaveable { mutableStateOf(false) }

    val notifPermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { /* if denied, tracking still works but alerts won't show */ }

    LaunchedEffect(state.message) {
        state.message?.let {
            snackbar.showSnackbar(it)
            vm.messageShown()
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(state.product?.storeName ?: "Product") },
                navigationIcon = {
                    IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") }
                },
                actions = {
                    if (state.refreshing) {
                        CircularProgressIndicator(Modifier.padding(12.dp).size(22.dp), strokeWidth = 2.dp)
                    } else {
                        IconButton(onClick = vm::refresh, enabled = state.product != null) {
                            Icon(Icons.Default.Refresh, "Refresh prices")
                        }
                    }
                    state.product?.let { p ->
                        IconButton(onClick = { shareProduct(context, p) }) { Icon(Icons.Default.Share, "Share") }
                    }
                },
            )
        },
        snackbarHost = { SnackbarHost(snackbar) },
    ) { padding ->
        val product = state.product
        when {
            state.loading -> Box(Modifier.fillMaxSize().padding(padding), contentAlignment = Alignment.Center) {
                CircularProgressIndicator()
            }
            product == null -> Box(Modifier.fillMaxSize().padding(padding).padding(24.dp), contentAlignment = Alignment.Center) {
                Text("This product couldn't be loaded. Go back and paste the link again.")
            }
            else -> LazyColumn(
                contentPadding = PaddingValues(
                    start = 16.dp,
                    end = 16.dp,
                    top = padding.calculateTopPadding() + 8.dp,
                    bottom = padding.calculateBottomPadding() + 32.dp,
                ),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                item { HeaderCard(product) { openUrl(context, product.url) } }
                item {
                    TrackCard(
                        tracked = state.tracked,
                        saving = state.saving,
                        onTrack = {
                            if (!Notifications.canNotify(context) && Build.VERSION.SDK_INT >= 33) {
                                notifPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
                            }
                            showTrackDialog = true
                        },
                        onUntrack = vm::untrack,
                    )
                }
                item { CompareCard(product) { openUrl(context, it) } }
                item { HistoryCard(product, state.history) }
                product.lastChecked?.let { checked ->
                    item {
                        Text(
                            "Price checked ${Fmt.ago(checked)}" + (product.lastError?.let { " · last check failed" } ?: ""),
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.padding(horizontal = 4.dp),
                        )
                    }
                }
            }
        }
    }

    if (showTrackDialog) {
        TrackDialog(
            currentPrice = state.product?.price,
            existing = state.tracked,
            onDismiss = { showTrackDialog = false },
            onConfirm = { target, mode ->
                showTrackDialog = false
                vm.track(target, mode)
            },
        )
    }
}

@Composable
private fun HeaderCard(p: Product, onOpen: () -> Unit) {
    ElevatedCard(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            AsyncImage(
                model = p.imageUrl,
                contentDescription = p.title,
                contentScale = ContentScale.Fit,
                modifier = Modifier
                    .fillMaxWidth()
                    .height(220.dp)
                    .background(Color.White, RoundedCornerShape(12.dp))
                    .padding(8.dp),
            )
            p.brand?.let {
                Text(it.uppercase(), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary)
            }
            Text(p.title, style = MaterialTheme.typography.titleMedium, maxLines = 4, overflow = TextOverflow.Ellipsis)
            if (p.rating != null) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Default.Star, null, tint = Color(0xFFF5A623), modifier = Modifier.size(16.dp))
                    Spacer(Modifier.width(4.dp))
                    Text(
                        "%.1f".format(p.rating) + (p.ratingCount?.let { " (${NumberFormat.getIntegerInstance().format(it)} ratings)" } ?: ""),
                        style = MaterialTheme.typography.bodySmall,
                    )
                }
            }
            Row(verticalAlignment = Alignment.Bottom) {
                Text(Fmt.price(p.price), style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold)
                if (p.mrp != null) {
                    Spacer(Modifier.width(8.dp))
                    Text(
                        Fmt.price(p.mrp),
                        style = MaterialTheme.typography.bodyMedium,
                        textDecoration = TextDecoration.LineThrough,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(bottom = 4.dp),
                    )
                }
                p.discountPercent?.let {
                    Spacer(Modifier.width(8.dp))
                    Text("$it% off", color = PriceColors.down, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(bottom = 4.dp))
                }
            }
            if (!p.inStock) {
                Text("Currently out of stock", color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium)
            }
            OutlinedButton(onClick = onOpen, modifier = Modifier.fillMaxWidth()) {
                Icon(Icons.Default.ShoppingCart, null, Modifier.size(18.dp))
                Spacer(Modifier.width(8.dp))
                Text("Open in ${p.storeName}")
            }
        }
    }
}

@Composable
private fun TrackCard(tracked: TrackedItem?, saving: Boolean, onTrack: () -> Unit, onUntrack: () -> Unit) {
    Card(
        Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.primaryContainer),
    ) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            if (tracked == null) {
                Text("Get alerted when the price changes", style = MaterialTheme.typography.titleSmall)
                Button(onClick = onTrack, enabled = !saving, modifier = Modifier.fillMaxWidth()) {
                    Icon(Icons.Default.Notifications, null, Modifier.size(18.dp))
                    Spacer(Modifier.width(8.dp))
                    Text(if (saving) "Saving…" else "Track price")
                }
            } else {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Default.Notifications, null, tint = MaterialTheme.colorScheme.primary)
                    Spacer(Modifier.width(8.dp))
                    Column(Modifier.weight(1f)) {
                        Text("Tracking this product", style = MaterialTheme.typography.titleSmall)
                        Text(
                            buildString {
                                append(tracked.alertMode.label)
                                tracked.targetPrice?.let { append(" · target ${Fmt.price(it)}") }
                            },
                            style = MaterialTheme.typography.bodySmall,
                        )
                    }
                }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedButton(onClick = onTrack, enabled = !saving) { Text("Edit alert") }
                    TextButton(onClick = onUntrack, enabled = !saving) { Text("Stop tracking") }
                }
            }
        }
    }
}

private data class CompareRow(val storeName: String, val title: String, val price: Double, val url: String, val isThis: Boolean)

@Composable
private fun CompareCard(p: Product, onOpen: (String) -> Unit) {
    val rows = buildList {
        p.price?.let { add(CompareRow(p.storeName, p.title, it, p.url, isThis = true)) }
        p.comparisons.forEach { add(CompareRow(it.storeName, it.title, it.price, it.url, isThis = false)) }
    }.sortedBy { it.price }

    ElevatedCard(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(vertical = 16.dp)) {
            Text("Compare prices", style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(horizontal = 16.dp))
            Text(
                if (p.comparisonsUpdatedAt != null) "Checked ${Fmt.ago(p.comparisonsUpdatedAt)} · matched by product name, so double-check the variant"
                else "Not checked yet — tap refresh",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp),
            )
            if (p.comparisons.isEmpty()) {
                Text(
                    "We couldn't find this exact product at other stores.",
                    style = MaterialTheme.typography.bodyMedium,
                    modifier = Modifier.padding(16.dp),
                )
            }
            rows.forEachIndexed { i, row ->
                if (i > 0) HorizontalDivider(Modifier.padding(horizontal = 16.dp))
                Row(
                    Modifier
                        .fillMaxWidth()
                        .clickable { onOpen(row.url) }
                        .padding(horizontal = 16.dp, vertical = 12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Column(Modifier.weight(1f)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(row.storeName, style = MaterialTheme.typography.titleSmall)
                            if (i == 0 && rows.size > 1) {
                                Spacer(Modifier.width(6.dp))
                                Badge("Lowest", PriceColors.down)
                            }
                            if (row.isThis) {
                                Spacer(Modifier.width(6.dp))
                                Badge("This link", MaterialTheme.colorScheme.primary)
                            }
                        }
                        Text(
                            row.title,
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                    Spacer(Modifier.width(12.dp))
                    Column(horizontalAlignment = Alignment.End) {
                        Text(Fmt.price(row.price), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                        val base = p.price
                        if (!row.isThis && base != null && row.price != base) {
                            val cheaper = row.price < base
                            Text(
                                "${Fmt.price(abs(base - row.price))} ${if (cheaper) "less" else "more"}",
                                style = MaterialTheme.typography.labelSmall,
                                color = if (cheaper) PriceColors.down else PriceColors.up,
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun Badge(text: String, color: Color) {
    Text(
        text,
        style = MaterialTheme.typography.labelSmall,
        color = color,
        modifier = Modifier
            .background(color.copy(alpha = 0.12f), RoundedCornerShape(4.dp))
            .padding(horizontal = 6.dp, vertical = 2.dp),
    )
}

private enum class Range(val label: String, val days: Int?) {
    M1("1M", 30), M3("3M", 90), M6("6M", 180), Y1("1Y", 365), ALL("All", null)
}

@Composable
private fun HistoryCard(p: Product, history: List<PricePoint>) {
    var range by rememberSaveable { mutableStateOf(Range.M3) }
    val now = remember { System.currentTimeMillis() }
    val shown = remember(history, range) { clipHistory(history, range.days?.let { now - it * 86_400_000L }) }

    ElevatedCard(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text("Price history", style = MaterialTheme.typography.titleMedium)

            val avg = if (history.isNotEmpty()) history.sumOf { it.price } / history.size else null
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Stat("Lowest", Fmt.price(p.lowestPrice), Modifier.weight(1f))
                Stat("Average", Fmt.price(avg), Modifier.weight(1f))
                Stat("Highest", Fmt.price(p.highestPrice), Modifier.weight(1f))
            }
            verdict(p.price, p.lowestPrice, p.highestPrice)?.let { (text, color) ->
                Text(text, color = color, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium)
            }

            if (history.size < 2) {
                Text(
                    "History starts from the first time this product was checked. " +
                        "Track it and we'll record the price every few hours.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            if (history.isNotEmpty()) {
                Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Range.entries.forEach { r ->
                        FilterChip(selected = r == range, onClick = { range = r }, label = { Text(r.label) })
                    }
                }
                if (shown.isNotEmpty()) {
                    PriceChart(shown, Modifier.fillMaxWidth())
                } else {
                    AssistChip(onClick = { range = Range.ALL }, label = { Text("No data in this range — show all") })
                }
            }
        }
    }
}

@Composable
private fun Stat(label: String, value: String, modifier: Modifier = Modifier) {
    Column(
        modifier
            .background(MaterialTheme.colorScheme.surfaceVariant, RoundedCornerShape(8.dp))
            .padding(horizontal = 10.dp, vertical = 8.dp),
    ) {
        Text(label, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(value, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold, maxLines = 1)
    }
}

private fun verdict(price: Double?, low: Double?, high: Double?): Pair<String, Color>? {
    if (price == null || low == null || high == null || high <= low) return null
    val pos = (price - low) / (high - low)
    return when {
        pos <= 0.1 -> "Great price — at or near the lowest recorded" to PriceColors.down
        pos <= 0.5 -> "Fair price — below the middle of its range" to Color(0xFF8D6E00)
        else -> "Higher than usual — consider waiting or set an alert" to PriceColors.up
    }
}

private fun openUrl(context: Context, url: String) {
    try {
        context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
    } catch (_: ActivityNotFoundException) {
        // No browser installed; nothing sensible to do.
    }
}

private fun shareProduct(context: Context, p: Product) {
    val text = "${p.title} — ${Fmt.price(p.price)} on ${p.storeName}\n${p.url}"
    val send = Intent(Intent.ACTION_SEND).apply {
        type = "text/plain"
        putExtra(Intent.EXTRA_TEXT, text)
    }
    context.startActivity(Intent.createChooser(send, "Share product"))
}
