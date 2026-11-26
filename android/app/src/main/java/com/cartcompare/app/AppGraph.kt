package com.cartcompare.app

import com.cartcompare.app.data.ProductRepository

/** Tiny service locator — enough for an app this size without pulling in a DI framework. */
object AppGraph {
    val repo: ProductRepository by lazy { ProductRepository() }
}
