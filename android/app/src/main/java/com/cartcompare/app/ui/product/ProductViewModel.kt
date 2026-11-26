package com.cartcompare.app.ui.product

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.cartcompare.app.data.AlertMode
import com.cartcompare.app.data.PricePoint
import com.cartcompare.app.data.Product
import com.cartcompare.app.data.ProductRepository
import com.cartcompare.app.data.TrackedItem
import com.cartcompare.app.data.friendlyMessage
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class ProductUiState(
    val loading: Boolean = true,
    val product: Product? = null,
    val history: List<PricePoint> = emptyList(),
    val tracked: TrackedItem? = null,
    val refreshing: Boolean = false,
    val saving: Boolean = false,
    val message: String? = null,
)

private data class LocalState(val refreshing: Boolean = false, val saving: Boolean = false, val message: String? = null)

class ProductViewModel(private val productId: String, private val repo: ProductRepository) : ViewModel() {
    private val local = MutableStateFlow(LocalState())

    private fun report(e: Throwable) = local.update { it.copy(message = e.friendlyMessage()) }

    val state: StateFlow<ProductUiState> = combine(
        repo.product(productId).catch { report(it); emit(null) },
        repo.history(productId).catch { report(it); emit(emptyList()) },
        repo.trackedItem(productId).catch { report(it); emit(null) },
        local,
    ) { product, history, tracked, l ->
        ProductUiState(
            loading = false,
            product = product,
            history = history,
            tracked = tracked,
            refreshing = l.refreshing,
            saving = l.saving,
            message = l.message,
        )
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), ProductUiState())

    fun messageShown() = local.update { it.copy(message = null) }

    /** Re-scrape now and re-run the cross-store comparison. */
    fun refresh() {
        val url = state.value.product?.url ?: return
        if (local.value.refreshing) return
        launchWith({ copy(refreshing = it) }) {
            repo.lookup(url, refresh = true)
            local.update { it.copy(message = "Prices updated") }
        }
    }

    fun track(targetPrice: Double?, mode: AlertMode) = launchWith({ copy(saving = it) }) {
        repo.track(productId, targetPrice, mode)
        local.update { it.copy(message = "You'll get an alert when the price changes") }
    }

    fun untrack() = launchWith({ copy(saving = it) }) {
        repo.untrack(productId)
        local.update { it.copy(message = "Stopped tracking") }
    }

    private fun launchWith(flag: LocalState.(Boolean) -> LocalState, block: suspend () -> Unit) {
        viewModelScope.launch {
            local.update { it.flag(true) }
            try {
                block()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                report(e)
            } finally {
                local.update { it.flag(false) }
            }
        }
    }
}
