#include <memory>
#include <optional>
#include <string>
#include <utility>

#include <napi.h>

#include "scanner.hpp"

namespace {

class ScannerWrap final : public Napi::ObjectWrap<ScannerWrap> {
  public:
    static Napi::Object Init(Napi::Env env, Napi::Object exports) {
        Napi::Function ctor = DefineClass(
            env,
            "Scanner",
            {InstanceMethod("scanDocument", &ScannerWrap::ScanDocument)});

        constructor() = Napi::Persistent(ctor);
        constructor().SuppressDestruct();
        exports.Set("Scanner", ctor);
        exports.Set("createScanner", Napi::Function::New(env, &ScannerWrap::CreateScanner));
        return exports;
    }

    ScannerWrap(const Napi::CallbackInfo& info)
        : Napi::ObjectWrap<ScannerWrap>(info) {
        if (info.Length() < 1 || !info[0].IsString()) {
            throw Napi::TypeError::New(info.Env(), "modelPath is required.");
        }

        scanner_ = std::make_shared<scancpp::DocumentScanner>(info[0].As<Napi::String>().Utf8Value());
    }

  private:
    struct AsyncScanRequest {
        std::string inputPath;
        std::string scannedOutputPath;
        std::string overlayOutputPath;
        std::string debugOutputPrefix;
        bool writeDebugImages = false;
    };

    class ScanWorker final : public Napi::AsyncWorker {
      public:
        ScanWorker(
            Napi::Env env,
            std::shared_ptr<scancpp::DocumentScanner> scanner,
            AsyncScanRequest request)
            : Napi::AsyncWorker(env),
              deferred_(Napi::Promise::Deferred::New(env)),
              scanner_(std::move(scanner)),
              request_(std::move(request)) {}

        void Execute() override {
            scancpp::ScanRequest request;
            request.inputPath = request_.inputPath;
            request.scannedOutputPath = request_.scannedOutputPath;
            request.overlayOutputPath = request_.overlayOutputPath;
            request.debugOutputPrefix = request_.debugOutputPrefix;
            request.writeOverlay = !request_.overlayOutputPath.empty();
            request.writeDebugImages = request_.writeDebugImages;
            result_ = scanner_->scanFile(request);
        }

        void OnOK() override {
            Napi::Env env = Env();
            Napi::Object result = Napi::Object::New(env);
            result.Set("sourceWidth", result_.sourceWidth);
            result.Set("sourceHeight", result_.sourceHeight);
            result.Set("scannedWidth", result_.scannedWidth);
            result.Set("scannedHeight", result_.scannedHeight);
            result.Set("scannedOutputPath", result_.scannedOutputPath.string());
            result.Set("overlayOutputPath", result_.overlayOutputPath.string());

            Napi::Array corners = Napi::Array::New(env, result_.corners.size());
            for (std::size_t index = 0; index < result_.corners.size(); index += 1) {
                Napi::Object point = Napi::Object::New(env);
                point.Set("x", result_.corners[index].x);
                point.Set("y", result_.corners[index].y);
                corners.Set(index, point);
            }
            result.Set("corners", corners);

            Napi::Array debugPaths = Napi::Array::New(env, result_.debugOutputPaths.size());
            for (std::size_t index = 0; index < result_.debugOutputPaths.size(); index += 1) {
                debugPaths.Set(index, result_.debugOutputPaths[index].string());
            }
            result.Set("debugOutputPaths", debugPaths);

            deferred_.Resolve(result);
        }

        void OnError(const Napi::Error& error) override {
            deferred_.Reject(error.Value());
        }

        Napi::Promise Promise() const {
            return deferred_.Promise();
        }

      private:
        Napi::Promise::Deferred deferred_;
        std::shared_ptr<scancpp::DocumentScanner> scanner_;
        AsyncScanRequest request_;
        scancpp::ScanResult result_;
    };

    static Napi::Value CreateScanner(const Napi::CallbackInfo& info) {
        Napi::Env env = info.Env();
        if (info.Length() < 1 || !info[0].IsObject()) {
            throw Napi::TypeError::New(env, "Expected an options object.");
        }

        const Napi::Object options = info[0].As<Napi::Object>();
        const Napi::Value modelPathValue = options.Get("modelPath");
        if (!modelPathValue.IsString()) {
            throw Napi::TypeError::New(env, "options.modelPath must be a string.");
        }

        return constructor().New({modelPathValue});
    }

    Napi::Value ScanDocument(const Napi::CallbackInfo& info) {
        Napi::Env env = info.Env();
        if (info.Length() < 1 || !info[0].IsObject()) {
            throw Napi::TypeError::New(env, "Expected a scan options object.");
        }

        const Napi::Object options = info[0].As<Napi::Object>();
        AsyncScanRequest request;
        request.inputPath = getRequiredString(env, options, "inputPath");
        request.scannedOutputPath = getRequiredString(env, options, "scannedOutputPath");
        request.overlayOutputPath = getOptionalString(options, "overlayOutputPath").value_or("");
        request.debugOutputPrefix = getOptionalString(options, "debugOutputPrefix").value_or("");
        request.writeDebugImages = getOptionalBool(options, "writeDebugImages").value_or(false);

        auto* worker = new ScanWorker(env, scanner_, std::move(request));
        Napi::Promise promise = worker->Promise();
        worker->Queue();
        return promise;
    }

    static std::string getRequiredString(
        Napi::Env env,
        const Napi::Object& object,
        const char* key) {
        const Napi::Value value = object.Get(key);
        if (!value.IsString()) {
            throw Napi::TypeError::New(env, std::string("options.") + key + " must be a string.");
        }
        return value.As<Napi::String>().Utf8Value();
    }

    static std::optional<std::string> getOptionalString(
        const Napi::Object& object,
        const char* key) {
        const Napi::Value value = object.Get(key);
        if (value.IsUndefined() || value.IsNull()) {
            return std::nullopt;
        }
        if (!value.IsString()) {
            throw Napi::TypeError::New(object.Env(), std::string("options.") + key + " must be a string.");
        }
        return value.As<Napi::String>().Utf8Value();
    }

    static std::optional<bool> getOptionalBool(
        const Napi::Object& object,
        const char* key) {
        const Napi::Value value = object.Get(key);
        if (value.IsUndefined() || value.IsNull()) {
            return std::nullopt;
        }
        if (!value.IsBoolean()) {
            throw Napi::TypeError::New(object.Env(), std::string("options.") + key + " must be a boolean.");
        }
        return value.As<Napi::Boolean>().Value();
    }

    static Napi::FunctionReference& constructor() {
        static Napi::FunctionReference value;
        return value;
    }

    std::shared_ptr<scancpp::DocumentScanner> scanner_;
};

Napi::Object InitAddon(Napi::Env env, Napi::Object exports) {
    return ScannerWrap::Init(env, exports);
}

}  // namespace

NODE_API_MODULE(scancpp_node, InitAddon)
