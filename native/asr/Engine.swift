// Thin Swift wrapper over the whisper.cpp C API: keeps models resident and exposes
// speech detection, language detection and transcription. No policy lives here.

import Foundation

struct EngineError: Error, CustomStringConvertible {
    let description: String
    init(_ description: String) { self.description = description }
}

/// One loaded whisper model plus a reusable inference state.
final class LoadedModel {
    let path: String
    let ctx: OpaquePointer
    let state: OpaquePointer

    init(path: String) throws {
        var cparams = whisper_context_default_params()
        cparams.use_gpu = true
        cparams.flash_attn = true
        guard let ctx = whisper_init_from_file_with_params(path, cparams) else {
            throw EngineError("failed to load model at \(path)")
        }
        guard let state = whisper_init_state(ctx) else {
            whisper_free(ctx)
            throw EngineError("failed to allocate state for \(path)")
        }
        self.path = path
        self.ctx = ctx
        self.state = state
    }

    deinit {
        whisper_free_state(state)
        whisper_free(ctx)
    }
}

struct Segment {
    let t0: Int64  // centiseconds
    let t1: Int64
    let text: String
    let noSpeechProb: Float
}

final class Engine {
    private(set) var models: [String: LoadedModel] = [:]  // key: "sv" / "en"
    private var vad: OpaquePointer?
    var threads: Int32 = 4

    deinit {
        if let vad { whisper_vad_free(vad) }
    }

    func load(models paths: [String: String], vadPath: String?) throws {
        var byPath: [String: LoadedModel] = [:]
        for model in models.values { byPath[model.path] = model }
        var next: [String: LoadedModel] = [:]
        for (key, path) in paths {
            next[key] = try byPath[path] ?? LoadedModel(path: path)
            byPath[path] = next[key]
        }
        models = next
        if let vadPath {
            if let vad { whisper_vad_free(vad) }
            var vparams = whisper_vad_default_context_params()
            vparams.n_threads = threads
            vparams.use_gpu = false
            guard let ctx = whisper_vad_init_from_file_with_params(vadPath, vparams) else {
                throw EngineError("failed to load VAD model at \(vadPath)")
            }
            vad = ctx
        }
    }

    /// Runs one tiny inference per model so the first real request does not pay for
    /// Metal pipeline compilation.
    func warmUp() throws {
        let silence = [Float](repeating: 0, count: 16_000)
        for (key, model) in models {
            _ = try transcribe(silence, model: model, language: key, prompt: nil)
        }
    }

    func model(_ key: String) throws -> LoadedModel {
        guard let model = models[key] else { throw EngineError("model '\(key)' is not loaded") }
        return model
    }

    /// Speech segments as [start, end] in centiseconds; empty when nothing was detected.
    func speechSegments(_ samples: [Float]) throws -> [[Double]] {
        guard let vad else { throw EngineError("VAD model is not loaded") }
        var params = whisper_vad_default_params()
        params.threshold = 0.5
        params.min_speech_duration_ms = 200
        params.min_silence_duration_ms = 300
        params.speech_pad_ms = 0  // padding is applied by the caller
        guard let segments = samples.withUnsafeBufferPointer({
            whisper_vad_segments_from_samples(vad, params, $0.baseAddress, Int32($0.count))
        }) else { throw EngineError("VAD failed") }
        defer { whisper_vad_free_segments(segments) }
        return (0..<whisper_vad_segments_n_segments(segments)).map {
            [Double(whisper_vad_segments_get_segment_t0(segments, $0)),
             Double(whisper_vad_segments_get_segment_t1(segments, $0))]
        }
    }

    /// Language probabilities for the requested codes, from the model's language head.
    func detectLanguage(_ samples: [Float], model: LoadedModel, candidates: [String]) throws -> [String: Float] {
        let ok = samples.withUnsafeBufferPointer {
            whisper_pcm_to_mel_with_state(model.ctx, model.state, $0.baseAddress, Int32($0.count), threads)
        }
        guard ok == 0 else { throw EngineError("mel computation failed") }
        var probs = [Float](repeating: 0, count: Int(whisper_lang_max_id()) + 1)
        let top = whisper_lang_auto_detect_with_state(model.ctx, model.state, 0, threads, &probs)
        guard top >= 0 else { throw EngineError("language detection failed") }
        var result: [String: Float] = [:]
        for code in candidates {
            let id = whisper_lang_id(code)
            guard id >= 0 else { throw EngineError("unknown language '\(code)'") }
            result[code] = probs[Int(id)]
        }
        return result
    }

    func transcribe(_ samples: [Float], model: LoadedModel, language: String, prompt: String?) throws -> [Segment] {
        var params = whisper_full_default_params(WHISPER_SAMPLING_GREEDY)
        params.n_threads = threads
        params.translate = false
        params.no_context = true
        params.no_timestamps = true
        params.print_progress = false
        params.print_realtime = false
        params.print_special = false
        params.print_timestamps = false
        params.suppress_blank = true
        params.suppress_nst = true
        params.temperature = 0

        let status: Int32 = language.withCString { lang in
            withOptionalCString(prompt) { promptPtr in
                params.language = lang
                params.detect_language = false
                params.initial_prompt = promptPtr
                return samples.withUnsafeBufferPointer {
                    whisper_full_with_state(model.ctx, model.state, params, $0.baseAddress, Int32($0.count))
                }
            }
        }
        guard status == 0 else { throw EngineError("transcription failed (\(status))") }

        return (0..<whisper_full_n_segments_from_state(model.state)).map { i in
            Segment(
                t0: whisper_full_get_segment_t0_from_state(model.state, i),
                t1: whisper_full_get_segment_t1_from_state(model.state, i),
                text: String(cString: whisper_full_get_segment_text_from_state(model.state, i)),
                noSpeechProb: whisper_full_get_segment_no_speech_prob_from_state(model.state, i)
            )
        }
    }
}

private func withOptionalCString<R>(_ string: String?, _ body: (UnsafePointer<CChar>?) -> R) -> R {
    guard let string, !string.isEmpty else { return body(nil) }
    return string.withCString { body($0) }
}
