package com.harutokyo.checkin.kiosk.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.sizeIn
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/** 숫자 칸(등록 코드 · 직원 PIN). 숫자만 받아 시스템 키보드를 띄우지 않는다. */
@Composable
fun Digits(value: String, length: Int, masked: Boolean = false) {
    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        repeat(length) { index ->
            val char = value.getOrNull(index)
            Box(
                Modifier.sizeIn(minWidth = 56.dp, minHeight = 72.dp).background(if (char != null) G.Surface else G.Bg, Radius),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    when {
                        char == null -> "·"
                        masked -> "●"
                        else -> char.toString()
                    },
                    color = if (char == null) G.LineStrong else G.Text,
                    fontSize = if (masked) 20.sp else 34.sp,
                    fontWeight = FontWeight.Medium,
                )
            }
        }
    }
}

/** 3×4 숫자판. ⌫ 은 한 글자 지우기. */
@Composable
fun Keypad(onDigit: (Char) -> Unit, onDelete: () -> Unit) {
    val rows = listOf("123", "456", "789", " 0<")
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        for (row in rows) {
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                for (key in row) {
                    if (key == ' ') {
                        Box(Modifier.size(120.dp, 84.dp))
                        continue
                    }
                    Box(
                        Modifier.size(120.dp, 84.dp).background(G.Surface, Radius)
                            .clickable(role = Role.Button) { if (key == '<') onDelete() else onDigit(key) },
                        contentAlignment = Alignment.Center,
                    ) {
                        Text(if (key == '<') "⌫" else key.toString(), color = G.Text, fontSize = 30.sp, fontWeight = FontWeight.Medium)
                    }
                }
            }
        }
    }
}
