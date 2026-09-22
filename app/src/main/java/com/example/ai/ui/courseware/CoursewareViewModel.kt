package com.example.ai.ui.courseware

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.example.ai.data.courseware.CoursewareItem
import com.example.ai.data.courseware.CoursewareModule
import com.example.ai.data.courseware.CoursewareRepository
import com.example.ai.data.courseware.PickedImage
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

data class CoursewareUiState(
    val module: CoursewareModule = CoursewareModule.DEFAULT,
    val items: List<CoursewareItem> = emptyList(),
    val loading: Boolean = false,
    val uploading: Boolean = false,
    /** 批量上传进度：已完成 / 总数（0/0 表示没有在上传） */
    val uploadDone: Int = 0,
    val uploadTotal: Int = 0,
    val error: String = "",
) {
    val empty: Boolean get() = !loading && items.isEmpty()
}

/**
 * 课件库（家长端）—— 对齐 web `CoursewareManagerPage`：
 * 三个科目 tab 各自列表；上传可多选（逐张串行上传，与 web 的 `for (const f of files)` 一致）；
 * 上传完成后整表重拉（与 web 相同：不本地插入，保证顺序 = 服务端 created_at 倒序）。
 */
class CoursewareViewModel(
    private val repository: CoursewareRepository = CoursewareRepository(),
) : ViewModel() {

    private val _uiState = MutableStateFlow(CoursewareUiState())
    val uiState: StateFlow<CoursewareUiState> = _uiState.asStateFlow()

    init {
        load()
    }

    /** 切换科目：清空旧列表并重新拉取（web 的 `useEffect([module])`） */
    fun switchModule(module: CoursewareModule) {
        if (_uiState.value.module == module) return
        _uiState.value = _uiState.value.copy(module = module, items = emptyList(), error = "")
        load()
    }

    fun load() {
        val module = _uiState.value.module
        _uiState.value = _uiState.value.copy(loading = true, error = "")
        viewModelScope.launch {
            val list = repository.list(module)
            // 期间切了科目：丢弃这次结果（否则会把别的科目的列表盖上去）
            if (_uiState.value.module != module) return@launch
            _uiState.value = if (list == null) {
                _uiState.value.copy(loading = false, error = "加载失败：网络或服务器异常")
            } else {
                _uiState.value.copy(loading = false, items = list)
            }
        }
    }

    /**
     * 逐张串行上传（与 web 一致）；任一张失败即中断并报错（web 是 throw 到 catch）。
     * 全部成功后重拉列表（与 web 相同）。
     */
    fun upload(images: List<PickedImage>) {
        if (images.isEmpty() || _uiState.value.uploading) return
        val module = _uiState.value.module
        _uiState.value = _uiState.value.copy(
            uploading = true,
            uploadDone = 0,
            uploadTotal = images.size,
            error = "",
        )
        viewModelScope.launch {
            var failed: String? = null
            for ((i, img) in images.withIndex()) {
                val result = repository.upload(
                    bytes = img.bytes,
                    fileName = img.fileName,
                    mimeType = img.mimeType,
                    module = module,
                    title = CoursewareRepository.titleFromFileName(img.fileName),
                )
                failed = result.exceptionOrNull()?.message
                if (failed != null) break
                _uiState.value = _uiState.value.copy(uploadDone = i + 1)
            }
            _uiState.value = _uiState.value.copy(uploading = false)
            if (failed != null) {
                _uiState.value = _uiState.value.copy(error = "上传失败：$failed")
            } else if (_uiState.value.module == module) {
                // 上传期间没切科目才重拉（切了的话 load() 已经拉过新科目）
                val list = repository.list(module)
                if (list != null) _uiState.value = _uiState.value.copy(items = list)
            }
        }
    }

    /** 删除一条：成功后本地移除（与 web 一致的乐观删除，不整表重拉） */
    fun delete(item: CoursewareItem) {
        _uiState.value = _uiState.value.copy(error = "")
        viewModelScope.launch {
            if (repository.remove(item.id)) {
                _uiState.value = _uiState.value.copy(items = _uiState.value.items.filterNot { it.id == item.id })
            } else {
                _uiState.value = _uiState.value.copy(error = "删除失败：网络或服务器异常")
            }
        }
    }

    fun dismissError() {
        _uiState.value = _uiState.value.copy(error = "")
    }

    /** 供 Screen 报告本地读取失败等非 HTTP 错误 */
    fun reportError(message: String) {
        _uiState.value = _uiState.value.copy(error = message)
    }

    /** 课件图片直链（不鉴权，给 Coil 用） */
    fun imageUrl(fileName: String): String = repository.imageUrl(fileName)
}
