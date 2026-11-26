@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)

package com.cartcompare.app.ui.home

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Clear
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ElevatedCard
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import coil.compose.AsyncImage
import com.cartcompare.app.BuildConfig
import com.cartcompare.app.data.TrackedItem
import com.cartcompare.app.ui.theme.PriceColors
import com.cartcompare.app.util.Fmt

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HomeScreen(vm: HomeViewModel, onOpenProduct: (String) -> Unit) {
    val state by vm.state.collectAsStateWithLifecycle()
    val trackedState by vm.tracked.collectAsStateWithLifecycle()
    val tracked = trackedState

    Scaffold(topBar = { TopAppBar(title = { Text("Cart Compare") }) }) { padding ->
        LazyColumn(
            contentPadding = PaddingValues(
                start = 16.dp,
                end = 16.dp,
                top = padding.calculateTopPadding() + 8.dp,
                bottom = padding.calculateBottomPadding() + 24.dp,
            ),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            if (!BuildConfig.FIREBASE_CONFIGURED) item { SetupNeededCard() }
            item { LinkInputCard(state, vm::onInputChange, vm::lookup) }
            item {
                Text(
                    "Your watchlist",
                    style = MaterialTheme.typography.titleMedium,
                    modifier = Modifier.padding(top = 8.dp),
                )
            }
            when {
                tracked == null -> item {
                    Row(Modifier.fillMaxWidth().padding(24.dp), horizontalArrangement = Arrangement.Center) {
                        CircularProgressIndicator()
                    }
                }
                tracked.isEmpty() -> item { EmptyWatchlist() }
                else -> items(tracked, key = { it.productId }) { item ->
                    TrackedRow(item) { onOpenProduct(item.productId) }
                }
            }
        }
    }
}

@Composable
private fun LinkInputCard(state: HomeUiState, onChange: (String) -> Unit, onLookup: (String) -> Unit) {
    val clipboard = LocalClipboardManager.current
    val keyboard = LocalSoftwareKeyboardController.current
    val submit = {
        keyboard?.hide()
        onLookup(state.input)
    }

    ElevatedCard(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text("Paste a product link", style = MaterialTheme.typography.titleMedium)
            Text(
                "Amazon, Flipkart, Myntra, Croma, Reliance Digital, Tata CLiQ, Vijay Sales, JioMart, AJIO, Nykaa",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            OutlinedTextField(
                value = state.input,
                onValueChange = onChange,
                modifier = Modifier.fillMaxWidth(),
                placeholder = { Text("https://www.amazon.in/dp/…") },
                maxLines = 3,
                enabled = !state.loading,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, imeAction = ImeAction.Search),
                keyboardActions = KeyboardActions(onSearch = { submit() }),
                trailingIcon = {
                    if (state.input.isNotEmpty() && !state.loading) {
                        IconButton(onClick = { onChange("") }) { Icon(Icons.Default.Clear, "Clear") }
                    }
                },
            )
            Row(verticalAlignment = Alignment.CenterVertically) {
                OutlinedButton(
                    enabled = !state.loading,
                    onClick = {
                        clipboard.getText()?.text?.takeIf { it.isNotBlank() }?.let {
                            keyboard?.hide()
                            onLookup(it)
                        }
                    },
                ) { Text("Paste & check") }
                Spacer(Modifier.weight(1f))
                Button(onClick = submit, enabled = state.input.isNotBlank() && !state.loading) {
                    if (state.loading) {
                        CircularProgressIndicator(
                            modifier = Modifier.size(18.dp),
                            strokeWidth = 2.dp,
                            color = MaterialTheme.colorScheme.onPrimary,
                        )
                        Spacer(Modifier.width(8.dp))
                        Text("Checking…")
                    } else {
                        Icon(Icons.Default.Search, null, Modifier.size(18.dp))
                        Spacer(Modifier.width(8.dp))
                        Text("Compare")
                    }
                }
            }
            if (state.loading) {
                Text(
                    "Reading the product page and searching other stores. This can take up to 30 seconds.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            state.error?.let {
                Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium)
            }
            Text(
                "Tip: in the Amazon or Flipkart app, tap Share → Cart Compare.",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Composable
private fun SetupNeededCard() {
    Card(
        Modifier.fillMaxWidth(),
        colors = androidx.compose.material3.CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.errorContainer),
    ) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text("Backend not connected yet", style = MaterialTheme.typography.titleSmall, color = MaterialTheme.colorScheme.onErrorContainer)
            Text(
                "This build has no Firebase config, so lookups won't work. Add your google-services.json " +
                    "(see the README) and the next build will connect.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onErrorContainer,
            )
        }
    }
}

@Composable
private fun EmptyWatchlist() {
    Column(
        Modifier.fillMaxWidth().padding(vertical = 24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Icon(Icons.Default.Notifications, null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(
            "Track a product to get alerts when its price changes.",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun TrackedRow(item: TrackedItem, onClick: () -> Unit) {
    Card(onClick = onClick, modifier = Modifier.fillMaxWidth()) {
        Row(Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
            AsyncImage(
                model = item.imageUrl,
                contentDescription = null,
                contentScale = ContentScale.Fit,
                modifier = Modifier
                    .size(64.dp)
                    .clip(RoundedCornerShape(8.dp))
                    .background(MaterialTheme.colorScheme.surface),
            )
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(item.title, maxLines = 2, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodyMedium)
                Text(item.storeName, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(Fmt.price(item.currentPrice), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                    val now = item.currentPrice
                    val then = item.priceWhenAdded
                    if (now != null && then != null && now != then) {
                        val down = now < then
                        Spacer(Modifier.width(8.dp))
                        Text(
                            (if (down) "▼ " else "▲ ") + Fmt.price(kotlin.math.abs(now - then)),
                            color = if (down) PriceColors.down else PriceColors.up,
                            style = MaterialTheme.typography.labelMedium,
                        )
                    }
                }
                val alert = when {
                    !item.inStock -> "Out of stock"
                    item.targetPrice != null -> "Target ${Fmt.price(item.targetPrice)}"
                    else -> item.alertMode.label
                }
                Text(alert, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.primary)
            }
        }
    }
}
