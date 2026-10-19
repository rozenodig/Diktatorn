// diktatorn-llm: local language-model process used for text cleanup. Keeps one model
// resident and answers one request at a time.
//
// Protocol: one JSON object per line. Requests on stdin carry an "id"; every response on
// stdout echoes it with "ok": true/false.
//   {"id":1,"cmd":"load","model":"/path/m.gguf","contextSize":4096}   -> {"architecture":"gemma4"}
//   {"id":2,"cmd":"complete","prompt":"...","maxTokens":256,"timeoutMs":1500}
//        -> {"text":"...","stop":"eog"|"length"|"timeout","promptTokens":n,"reusedTokens":n,
//            "generatedTokens":n,"promptMs":x,"generateMs":x}
//   {"cmd":"shutdown"}
// The prompt is raw text including the model's chat markup; a beginning-of-sequence token is
// added here. Decoding is greedy; "timeoutMs" is optional and stops generation (not prompt
// processing) once passed. Every successful response includes "ms": wall time spent
// handling the request.

import Foundation

let debugLogging = ProcessInfo.processInfo.environment["DIKTATORN_LLM_DEBUG"] != nil
llama_log_set({ _, text, _ in
    if debugLogging, let text { fputs(String(cString: text), stderr) }
}, nil)
llama_backend_init()

func emit(_ object: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: object),
          let line = String(data: data, encoding: .utf8) else { return }
    FileHandle.standardOutput.write((line + "\n").data(using: .utf8)!)
}

func string(_ msg: [String: Any], _ key: String) throws -> String {
    guard let value = msg[key] as? String, !value.isEmpty else { throw EngineError("missing '\(key)'") }
    return value
}

let engine = Engine()

func handle(_ msg: [String: Any]) throws -> [String: Any] {
    switch msg["cmd"] as? String {
    case "load":
        if let threads = msg["threads"] as? Int { engine.threads = Int32(threads) }
        try engine.load(path: try string(msg, "model"), contextSize: UInt32(msg["contextSize"] as? Int ?? 4096))
        return ["architecture": engine.metadata("general.architecture") ?? ""]
    case "complete":
        let deadline = (msg["timeoutMs"] as? Int).map { DispatchTime.now() + .milliseconds($0) }
        let c = try engine.complete(prompt: try string(msg, "prompt"), maxTokens: msg["maxTokens"] as? Int ?? 256,
                                    deadline: deadline)
        return ["text": c.text, "stop": c.stop, "promptTokens": c.promptTokens, "reusedTokens": c.reusedTokens,
                "generatedTokens": c.generatedTokens, "promptMs": c.promptMs, "generateMs": c.generateMs]
    case "shutdown":
        exit(0)
    default:
        throw EngineError("unknown cmd")
    }
}

setvbuf(stdout, nil, _IOLBF, 0)
emit(["event": "ready"])
while let line = readLine() {
    let start = DispatchTime.now()
    guard let data = line.data(using: .utf8),
          let msg = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
        emit(["ok": false, "error": "unparseable request"])
        continue
    }
    let id = msg["id"] ?? NSNull()
    do {
        var response = try handle(msg)
        response["id"] = id
        response["ok"] = true
        response["ms"] = elapsedMs(since: start)
        emit(response)
    } catch {
        emit(["id": id, "ok": false, "error": "\(error)"])
    }
}
