package com.example.ai.data.repository

import com.example.ai.data.model.Letter
import com.example.ai.data.model.Phoneme
import com.example.ai.data.model.Word

/** 本地内容库 — 字母表、音素表、词库 */
interface ContentRepository {
    suspend fun getAllLetters(): List<Letter>
    suspend fun getLetter(char: String): Letter?
    suspend fun getWordsForLetter(letter: String): List<Word>
    suspend fun getWordsForPhoneme(phoneme: String): List<Word>
    suspend fun getAllWords(): List<Word>
    suspend fun getAllPhonemes(): List<Phoneme>
}
