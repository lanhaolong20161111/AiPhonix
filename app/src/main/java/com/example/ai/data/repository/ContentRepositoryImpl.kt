package com.example.ai.data.repository

import android.content.Context
import com.example.ai.data.model.EnglishWord
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

@Serializable
private data class EnglishWordEntry(
    val word: String,
    val phonetic: String,
    val meanings: List<String>,
    val emoji: String = "",
    val phonemes: List<String>? = null,
)

@Serializable
private data class EnglishVocabulary(
    val words: List<EnglishWordEntry>,
)

class ContentRepositoryImpl(
    private val context: Context,
) : ContentRepository {

    private val json = Json { ignoreUnknownKeys = true }
    private var wordbank: Wordbank? = null
    private var englishWords: List<EnglishWord>? = null

    private suspend fun load(): Wordbank {
        wordbank?.let { return it }
        val data = context.assets.open("wordbank.json").bufferedReader().use { it.readText() }
        return json.decodeFromString<Wordbank>(data).also { wordbank = it }
    }

    private suspend fun loadEnglishWords(): List<EnglishWord> {
        englishWords?.let { return it }
        val data = context.assets.open("english_vocabulary.json").bufferedReader().use { it.readText() }
        val vocab = json.decodeFromString<EnglishVocabulary>(data)
        return vocab.words.map { EnglishWord(word = it.word, phonetic = it.phonetic, meanings = it.meanings, emoji = it.emoji, phonemes = it.phonemes ?: emptyList()) }
            .also { englishWords = it }
    }

    override suspend fun getAllLetters(): List<Letter> = load().letters
    override suspend fun getLetter(char: String): Letter? = load().letters.find { it.char == char }
    override suspend fun getWordsForLetter(letter: String): List<Word> =
        load().words.filter { it.letter == letter }

    override suspend fun getWordsForPhoneme(phoneme: String): List<Word> =
        load().words.filter { it.phonemes.any { p -> p == phoneme } }

    override suspend fun getAllWords(): List<Word> = load().words

    override suspend fun getAllPhonemes(): List<Phoneme> = load().phonemes

    override suspend fun getAllEnglishWords(): List<EnglishWord> = loadEnglishWords()

    override suspend fun getEnglishWordsForLetter(letter: String): List<EnglishWord> =
        loadEnglishWords().filter { it.firstLetter == letter.lowercase() }

    /** 字母到最常见音素的映射，用于关联英语词汇到自然拼读音素 */
    private val letterToPrimaryPhoneme = mapOf(
        "a" to "æ", "b" to "b", "c" to "k", "d" to "d", "e" to "e",
        "f" to "f", "g" to "g", "h" to "h", "i" to "ɪ", "j" to "dʒ",
        "k" to "k", "l" to "l", "m" to "m", "n" to "n", "o" to "ɒ",
        "p" to "p", "q" to "kw", "r" to "r", "s" to "s", "t" to "t",
        "u" to "ʌ", "v" to "v", "w" to "w", "x" to "ks", "y" to "j", "z" to "z",
    )

    override suspend fun getEnglishWordsForPhoneme(phoneme: String): List<EnglishWord> {
        // 找到映射到该音素的所有字母
        val matchingLetters = letterToPrimaryPhoneme
            .filter { it.value == phoneme.removePrefix("/").removeSuffix("/") }
            .keys
        if (matchingLetters.isEmpty()) return emptyList()
        return loadEnglishWords().filter { it.firstLetter in matchingLetters }
    }
}
