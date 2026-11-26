package com.cartcompare.app.ui.theme

import android.os.Build
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.dynamicDarkColorScheme
import androidx.compose.material3.dynamicLightColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext

private val Light = lightColorScheme(
    primary = Color(0xFF0F7B5F),
    onPrimary = Color.White,
    primaryContainer = Color(0xFFA6F2D4),
    onPrimaryContainer = Color(0xFF002117),
    secondary = Color(0xFF4C6358),
    tertiary = Color(0xFF3F6374),
)

private val Dark = darkColorScheme(
    primary = Color(0xFF8AD6B8),
    onPrimary = Color(0xFF00382A),
    primaryContainer = Color(0xFF00513D),
    onPrimaryContainer = Color(0xFFA6F2D4),
    secondary = Color(0xFFB3CCBF),
    tertiary = Color(0xFFA7CCE0),
)

/** Colours for "cheaper" / "pricier" that read well in both themes. */
object PriceColors {
    val down = Color(0xFF1B8A4B)
    val up = Color(0xFFC62828)
}

@Composable
fun CartCompareTheme(content: @Composable () -> Unit) {
    val dark = isSystemInDarkTheme()
    val scheme = when {
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.S -> {
            val ctx = LocalContext.current
            if (dark) dynamicDarkColorScheme(ctx) else dynamicLightColorScheme(ctx)
        }
        dark -> Dark
        else -> Light
    }
    MaterialTheme(colorScheme = scheme, content = content)
}
