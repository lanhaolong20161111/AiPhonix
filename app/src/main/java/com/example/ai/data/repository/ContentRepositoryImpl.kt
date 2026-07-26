package com.example.ai.data.repository

import android.content.Context
import com.example.ai.data.model.Letter
import com.example.ai.data.model.Phoneme
import com.example.ai.data.model.Word
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

@Serializable
private data class Wordbank(
    val letters: List<Letter> = emptyList(),
    val words: List<Word> = emptyList(),
    val phonemes: List<Phoneme> = emptyList(),
)

class ContentRepositoryImpl(
    private val context: Context,
) : ContentRepository {

    private val json = Json { ignoreUnknownKeys = true }
    private var wordbank: Wordbank? = null

    private suspend fun load(): Wordbank {
        wordbank?.let { return it }
        val data = context.assets.open("wordbank.json").bufferedReader().use { it.readText() }
        return json.decodeFromString<Wordbank>(data).also { wordbank = it }
    }

    override suspend fun getAllLetters(): List<Letter> = load().letters
    override suspend fun getLetter(char: String): Letter? = load().letters.find { it.char == char }
    override suspend fun getWordsForLetter(letter: String): List<Word> =
        load().words.filter { it.letter == letter }

    override suspend fun getWordsForPhoneme(phoneme: String): List<Word> =
        load().words.filter { it.phonemes.any { p -> p == phoneme } }

    override suspend fun getAllWords(): List<Word> = load().words

    override suspend fun getAllPhonemes(): List<Phoneme> = load().phonemes
}
