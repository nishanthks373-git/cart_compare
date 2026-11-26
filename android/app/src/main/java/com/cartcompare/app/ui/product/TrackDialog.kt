@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)

package com.cartcompare.app.ui.product

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.cartcompare.app.data.AlertMode
import com.cartcompare.app.data.TrackedItem
import com.cartcompare.app.util.Fmt
import kotlin.math.roundToLong

@Composable
fun TrackDialog(
    currentPrice: Double?,
    existing: TrackedItem?,
    onDismiss: () -> Unit,
    onConfirm: (targetPrice: Double?, mode: AlertMode) -> Unit,
) {
    val suggested = currentPrice?.let { ((it * 0.95) / 10).roundToLong() * 10 }
    var targetText by remember {
        mutableStateOf(existing?.targetPrice?.roundToLong()?.toString() ?: suggested?.toString().orEmpty())
    }
    var mode by remember { mutableStateOf(existing?.alertMode ?: AlertMode.DROP) }
    val target = targetText.filter { it.isDigit() || it == '.' }.toDoubleOrNull()
    val targetInvalid = targetText.isNotBlank() && (target == null || target <= 0)
    val needsTarget = mode == AlertMode.TARGET_ONLY && target == null

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(if (existing != null) "Edit price alert" else "Track this price") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                if (currentPrice != null) {
                    Text("Current price: ${Fmt.price(currentPrice)}", style = MaterialTheme.typography.bodyMedium)
                }
                OutlinedTextField(
                    value = targetText,
                    onValueChange = { targetText = it.take(10) },
                    label = { Text("Target price (optional)") },
                    prefix = { Text("₹") },
                    singleLine = true,
                    isError = targetInvalid || needsTarget,
                    supportingText = {
                        Text(
                            when {
                                targetInvalid -> "Enter a valid amount"
                                needsTarget -> "Set a target for this alert type"
                                else -> "We'll always alert you when the price reaches this"
                            },
                        )
                    },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                    modifier = Modifier.fillMaxWidth(),
                )
                Column(Modifier.selectableGroup()) {
                    AlertMode.entries.forEach { m ->
                        Row(
                            Modifier
                                .fillMaxWidth()
                                .selectable(selected = mode == m, onClick = { mode = m }, role = Role.RadioButton)
                                .padding(vertical = 4.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            RadioButton(selected = mode == m, onClick = null)
                            Column(Modifier.padding(start = 8.dp)) {
                                Text(m.label, style = MaterialTheme.typography.bodyMedium)
                                Text(
                                    m.description,
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                        }
                    }
                }
                Text(
                    "Prices are checked every few hours.",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        },
        confirmButton = {
            TextButton(
                enabled = !targetInvalid && !needsTarget,
                onClick = { onConfirm(if (targetText.isBlank()) null else target, mode) },
            ) { Text(if (existing != null) "Save" else "Start tracking") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}
