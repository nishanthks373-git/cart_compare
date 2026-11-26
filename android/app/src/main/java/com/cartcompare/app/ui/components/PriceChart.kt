package com.cartcompare.app.ui.components

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.unit.dp
import com.cartcompare.app.data.PricePoint
import com.cartcompare.app.ui.theme.PriceColors
import com.cartcompare.app.util.Fmt
import java.util.Date
import kotlin.math.abs

/**
 * Step chart of price over time (a price holds until it changes), with tap/drag to inspect.
 * Drawn on a Canvas so the app doesn't need a charting library.
 */
@Composable
fun PriceChart(points: List<PricePoint>, modifier: Modifier = Modifier) {
    val sorted = remember(points) { points.sortedBy { it.at } }
    if (sorted.isEmpty()) return

    val lineColor = MaterialTheme.colorScheme.primary
    val gridColor = MaterialTheme.colorScheme.outlineVariant
    val labelStyle = MaterialTheme.typography.labelSmall.copy(color = MaterialTheme.colorScheme.onSurfaceVariant)
    val measurer = rememberTextMeasurer()
    var selected by remember(sorted) { mutableStateOf<Int?>(null) }

    // Time range: first point -> now, so the last price is drawn up to today.
    val tMin = sorted.first().at.time
    val tMax = remember(sorted) { maxOf(System.currentTimeMillis(), sorted.last().at.time, tMin + 86_400_000L) }
    val pMin = sorted.minOf { it.price }
    val pMax = sorted.maxOf { it.price }
    val pad = if (pMax == pMin) maxOf(pMax * 0.05, 1.0) else (pMax - pMin) * 0.12
    val yLow = pMin - pad
    val yHigh = pMax + pad

    val leftPadDp = 52.dp
    val rightPadDp = 8.dp
    val topPadDp = 8.dp
    val bottomPadDp = 20.dp

    Column(modifier) {
        val sel = selected?.let { sorted.getOrNull(it) }
        Text(
            if (sel != null) "${Fmt.price(sel.price)} · ${Fmt.dayYear(sel.at)}" else "Tap or drag the chart to see prices",
            style = MaterialTheme.typography.labelLarge,
            color = if (sel != null) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.onSurfaceVariant,
        )

        Canvas(
            Modifier
                .fillMaxWidth()
                .height(200.dp)
                .pointerInput(sorted) {
                    fun pick(x: Float) {
                        val left = leftPadDp.toPx()
                        val w = size.width - left - rightPadDp.toPx()
                        val t = tMin + ((x - left) / w).coerceIn(0f, 1f) * (tMax - tMin)
                        // The price in effect at time t is the last point at or before t.
                        val idx = sorted.indexOfLast { it.at.time <= t }
                        selected = if (idx >= 0) idx else 0
                    }
                    detectTapGestures { pick(it.x) }
                }
                .pointerInput(sorted) {
                    detectHorizontalDragGestures { change, _ ->
                        val left = leftPadDp.toPx()
                        val w = size.width - left - rightPadDp.toPx()
                        val t = tMin + ((change.position.x - left) / w).coerceIn(0f, 1f) * (tMax - tMin)
                        selected = sorted.indexOfLast { it.at.time <= t }.coerceAtLeast(0)
                    }
                },
        ) {
            val left = leftPadDp.toPx()
            val right = size.width - rightPadDp.toPx()
            val top = topPadDp.toPx()
            val bottom = size.height - bottomPadDp.toPx()
            fun x(t: Long) = left + (t - tMin).toFloat() / (tMax - tMin) * (right - left)
            fun y(p: Double) = (bottom - ((p - yLow) / (yHigh - yLow)) * (bottom - top)).toFloat()

            // Grid + y labels (high, middle, low)
            val dash = PathEffect.dashPathEffect(floatArrayOf(6f, 6f))
            listOf(pMax, (pMax + pMin) / 2, pMin).distinct().forEach { p ->
                val yy = y(p)
                drawLine(gridColor, Offset(left, yy), Offset(right, yy), strokeWidth = 1f, pathEffect = dash)
                val label = measurer.measure(Fmt.compact(p), labelStyle)
                drawText(label, topLeft = Offset(left - label.size.width - 6.dp.toPx(), yy - label.size.height / 2f))
            }

            // Step path
            val path = Path().apply {
                moveTo(x(sorted[0].at.time), y(sorted[0].price))
                for (i in 1 until sorted.size) {
                    val xi = x(sorted[i].at.time)
                    lineTo(xi, y(sorted[i - 1].price))
                    lineTo(xi, y(sorted[i].price))
                }
                lineTo(x(tMax), y(sorted.last().price))
            }
            val fill = Path().apply {
                addPath(path)
                lineTo(x(tMax), bottom)
                lineTo(x(sorted[0].at.time), bottom)
                close()
            }
            drawPath(fill, Brush.verticalGradient(listOf(lineColor.copy(alpha = 0.22f), Color.Transparent), startY = top, endY = bottom))
            drawPath(path, lineColor, style = Stroke(width = 2.5.dp.toPx(), join = StrokeJoin.Round))

            // Lowest price marker
            val lowIdx = sorted.indexOfFirst { it.price == pMin }
            if (lowIdx >= 0 && pMax != pMin) {
                drawCircle(PriceColors.down, radius = 4.dp.toPx(), center = Offset(x(sorted[lowIdx].at.time), y(pMin)))
            }

            // X labels
            val startLabel = measurer.measure(Fmt.day(Date(tMin)), labelStyle)
            drawText(startLabel, topLeft = Offset(left, bottom + 4.dp.toPx()))
            val endLabel = measurer.measure("Today", labelStyle)
            drawText(endLabel, topLeft = Offset(right - endLabel.size.width, bottom + 4.dp.toPx()))

            // Selection marker
            selected?.let { i ->
                val p = sorted.getOrNull(i) ?: return@let
                val sx = x(p.at.time).coerceIn(left, right)
                drawLine(lineColor.copy(alpha = 0.6f), Offset(sx, top), Offset(sx, bottom), strokeWidth = 1.5f)
                drawCircle(Color.White, radius = 6.dp.toPx(), center = Offset(sx, y(p.price)))
                drawCircle(lineColor, radius = 4.dp.toPx(), center = Offset(sx, y(p.price)))
            }
        }
    }
}

/** Points inside [fromMs, now], plus a synthetic point at fromMs carrying the price that was in effect then. */
fun clipHistory(points: List<PricePoint>, fromMs: Long?): List<PricePoint> {
    if (fromMs == null) return points
    val sorted = points.sortedBy { it.at }
    val inside = sorted.filter { it.at.time >= fromMs }
    val prior = sorted.lastOrNull { it.at.time < fromMs }
    return if (prior != null && (inside.isEmpty() || abs(inside.first().at.time - fromMs) > 60_000)) {
        listOf(PricePoint(prior.price, Date(fromMs))) + inside
    } else inside
}
