package com.cartcompare.app.ui.home

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.cartcompare.app.data.ProductRepository
import com.cartcompare.app.data.TrackedItem
import com.cartcompare.app.data.friendlyMessage
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class HomeUiState(
    val input: String = "",
    val loading: Boolean = false,
    val error: String? = null,
)

class HomeViewModel(private val repo: ProductRepository) : ViewModel() {
    private val _state = MutableStateFlow(HomeUiState())
    val state: StateFlow<HomeUiState> = _state.asStateFlow()

    /** null while loading the first time. */
    val tracked: StateFlow<List<TrackedItem>?> = repo.trackedList()
        .catch { e -> _state.update { it.copy(error = e.friendlyMessage()) }; emit(emptyList()) }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)

    private val _openProduct = Channel<String>(Channel.BUFFERED)
    val openProduct: Flow<String> = _openProduct.receiveAsFlow()

    fun onInputChange(text: String) = _state.update { it.copy(input = text, error = null) }

    fun lookup(text: String = _state.value.input) {
        if (text.isBlank() || _state.value.loading) return
        _state.update { it.copy(input = text, loading = true, error = null) }
        viewModelScope.launch {
            try {
                val id = repo.lookup(text)
                _state.update { it.copy(loading = false, input = "") }
                _openProduct.send(id)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                _state.update { it.copy(loading = false, error = e.friendlyMessage()) }
            }
        }
    }
}
