// Thin Swift wrapper over the llama.cpp C API: keeps one model resident, reuses the KV cache
// for the longest prompt prefix shared with the previous request, and decodes greedily.
// No prompt or cleanup policy lives here.

import Foundation

struct EngineError: Error, CustomStringConvertible {
    let description: String
    init(_ description: String) { self.description = description }
}

struct Completion {
    let text: String
    let stop: String  // "eog", "length" or "timeout"
    let promptTokens: Int
    let reusedTokens: Int
    let generatedTokens: Int
    let promptMs: Double
    let generateMs: Double
}

final class Engine {
    private var model: OpaquePointer?
    private var ctx: OpaquePointer?
    private var vocab: OpaquePointer?
    /// Tokens whose keys and values are currently in the cache (sequence 0).
    private var cached: [llama_token] = []
    var threads: Int32 = 4

    deinit { unload() }

    func load(path: String, contextSize: UInt32) throws {
        unload()
        guard let model = llama_model_load_from_file(path, llama_model_default_params()) else {
            throw EngineError("failed to load model at \(path)")
        }
        var cparams = llama_context_default_params()
        cparams.n_ctx = contextSize
        cparams.n_threads = threads
        cparams.n_threads_batch = threads
        cparams.flash_attn_type = LLAMA_FLASH_ATTN_TYPE_AUTO
        cparams.swa_full = true  // sliding-window layers keep every position, so the cache can be trimmed to a prefix
        cparams.no_perf = true
        guard let ctx = llama_init_from_model(model, cparams) else {
            llama_model_free(model)
            throw EngineError("failed to create a context for \(path)")
        }
        self.model = model
        self.ctx = ctx
        vocab = llama_model_get_vocab(model)
    }

    func metadata(_ key: String) -> String? {
        guard let model else { return nil }
        var buf = [CChar](repeating: 0, count: 256)
        let n = llama_model_meta_val_str(model, key, &buf, buf.count)
        return n < 0 ? nil : String(cString: buf)
    }

    func complete(prompt: String, maxTokens: Int, deadline: DispatchTime?) throws -> Completion {
        guard let ctx, let vocab else { throw EngineError("no model loaded") }
        let tokens = tokenize(prompt)
        guard !tokens.isEmpty else { throw EngineError("empty prompt") }
        guard tokens.count + maxTokens <= Int(llama_n_ctx(ctx)) else {
            throw EngineError("prompt of \(tokens.count) tokens does not fit the context")
        }

        // Decode only what differs from the cached prefix. The last prompt token is always
        // decoded again, because its logits are needed to pick the first output token.
        let start = DispatchTime.now()
        let memory = llama_get_memory(ctx)
        var reused = min(zip(cached, tokens).prefix { $0 == $1 }.count, tokens.count - 1)
        if !llama_memory_seq_rm(memory, 0, Int32(reused), -1) {
            llama_memory_clear(memory, true)
            reused = 0
        }
        cached = Array(tokens[..<reused])
        try decode(Array(tokens[reused...]))
        cached = tokens
        let promptMs = elapsedMs(since: start)

        let generateStart = DispatchTime.now()
        var bytes: [UInt8] = []
        var generated = 0
        var stop = "length"
        while generated < maxTokens {
            if let deadline, DispatchTime.now() >= deadline {
                stop = "timeout"
                break
            }
            let token = mostLikelyToken()
            if llama_vocab_is_eog(vocab, token) {
                stop = "eog"
                break
            }
            bytes += piece(token)
            generated += 1
            try decode([token])
            cached.append(token)
        }
        let generateMs = elapsedMs(since: generateStart)

        // Keep only the prompt cached: the next request shares its prefix, not this answer.
        if llama_memory_seq_rm(memory, 0, Int32(tokens.count), -1) {
            cached = tokens
        } else {
            llama_memory_clear(memory, true)
            cached = []
        }
        return Completion(text: String(decoding: bytes, as: UTF8.self), stop: stop, promptTokens: tokens.count,
                          reusedTokens: reused, generatedTokens: generated, promptMs: promptMs, generateMs: generateMs)
    }

    private func unload() {
        if let ctx { llama_free(ctx) }
        if let model { llama_model_free(model) }
        ctx = nil
        model = nil
        vocab = nil
        cached = []
    }

    private func decode(_ tokens: [llama_token]) throws {
        var tokens = tokens
        let batch = Int(llama_n_batch(ctx))
        var offset = 0
        while offset < tokens.count {
            let n = min(batch, tokens.count - offset)
            let status = tokens.withUnsafeMutableBufferPointer {
                llama_decode(ctx, llama_batch_get_one($0.baseAddress! + offset, Int32(n)))
            }
            guard status == 0 else { throw EngineError("decode failed (\(status))") }
            offset += n
        }
    }

    private func mostLikelyToken() -> llama_token {
        let logits = llama_get_logits_ith(ctx, -1)!
        var best = 0
        for i in 1..<Int(llama_vocab_n_tokens(vocab)) where logits[i] > logits[best] { best = i }
        return llama_token(best)
    }

    private func tokenize(_ text: String) -> [llama_token] {
        let length = Int32(text.utf8.count)
        var tokens = [llama_token](repeating: 0, count: Int(length) + 2)
        var n = llama_tokenize(vocab, text, length, &tokens, Int32(tokens.count), true, true)
        if n < 0 {
            tokens = [llama_token](repeating: 0, count: Int(-n))
            n = llama_tokenize(vocab, text, length, &tokens, Int32(tokens.count), true, true)
        }
        return Array(tokens.prefix(Int(max(n, 0))))
    }

    private func piece(_ token: llama_token) -> [UInt8] {
        var buf = [CChar](repeating: 0, count: 64)
        var n = llama_token_to_piece(vocab, token, &buf, Int32(buf.count), 0, false)
        if n < 0 {
            buf = [CChar](repeating: 0, count: Int(-n))
            n = llama_token_to_piece(vocab, token, &buf, Int32(buf.count), 0, false)
        }
        return buf.prefix(Int(max(n, 0))).map { UInt8(bitPattern: $0) }
    }
}

func elapsedMs(since start: DispatchTime) -> Double {
    Double(DispatchTime.now().uptimeNanoseconds - start.uptimeNanoseconds) / 1_000_000
}
