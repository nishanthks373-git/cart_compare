package com.cartcompare.app.util

import android.text.format.DateUtils
import java.text.NumberFormat
import java.text.SimpleDateFormat
import java.util.Currency
import java.util.Date
import java.util.Locale
import kotlin.math.abs
import kotlin.math.roundToLong

object Fmt {
    private val india = Locale("en", "IN")

    private val inr: NumberFormat = NumberFormat.getCurrencyInstance(india).apply {
        currency = Currency.getInstance("INR")
        maximumFractionDigits = 0
        minimumFractionDigits = 0
    }

    /** ₹1,29,999 */
    fun price(v: Double?): String = if (v == null) "—" else inr.format(v.roundToLong())

    /** Short axis label: ₹899, ₹12.5k, ₹1.3L */
    fun compact(v: Double): String = when {
        abs(v) >= 100_000 -> "₹" + trim(v / 100_000) + "L"
        abs(v) >= 1_000 -> "₹" + trim(v / 1_000) + "k"
        else -> "₹" + v.roundToLong()
    }

    private fun trim(v: Double): String {
        val s = String.format(Locale.US, "%.1f", v)
        return if (s.endsWith(".0")) s.dropLast(2) else s
    }

    fun day(d: Date): String = SimpleDateFormat("d MMM", Locale.getDefault()).format(d)

    fun dayYear(d: Date): String = SimpleDateFormat("d MMM yyyy", Locale.getDefault()).format(d)

    fun ago(d: Date?): String = if (d == null) "never" else
        DateUtils.getRelativeTimeSpanString(d.time, System.currentTimeMillis(), DateUtils.MINUTE_IN_MILLIS).toString()
}
