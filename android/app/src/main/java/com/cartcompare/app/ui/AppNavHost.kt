package com.cartcompare.app.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import com.cartcompare.app.AppGraph
import com.cartcompare.app.ExternalAction
import com.cartcompare.app.ui.home.HomeScreen
import com.cartcompare.app.ui.home.HomeViewModel
import com.cartcompare.app.ui.product.ProductScreen

private const val HOME = "home"
private const val PRODUCT = "product/{id}"
private fun productRoute(id: String) = "product/$id"

@Composable
fun AppNavHost(action: ExternalAction?, onActionHandled: () -> Unit) {
    val nav = rememberNavController()
    // Scoped to the activity so a lookup keeps running if the user navigates.
    val homeVm: HomeViewModel = viewModel { HomeViewModel(AppGraph.repo) }

    LaunchedEffect(Unit) {
        homeVm.openProduct.collect { id -> nav.navigate(productRoute(id)) { launchSingleTop = true } }
    }

    LaunchedEffect(action) {
        when (action) {
            is ExternalAction.OpenProduct -> nav.navigate(productRoute(action.productId)) { launchSingleTop = true }
            is ExternalAction.Lookup -> {
                nav.popBackStack(HOME, inclusive = false)
                homeVm.lookup(action.text)
            }
            null -> return@LaunchedEffect
        }
        onActionHandled()
    }

    NavHost(navController = nav, startDestination = HOME) {
        composable(HOME) {
            HomeScreen(vm = homeVm, onOpenProduct = { nav.navigate(productRoute(it)) })
        }
        composable(PRODUCT, arguments = listOf(navArgument("id") { type = NavType.StringType })) { entry ->
            val id = entry.arguments?.getString("id").orEmpty()
            ProductScreen(productId = id, onBack = { nav.popBackStack() })
        }
    }
}
