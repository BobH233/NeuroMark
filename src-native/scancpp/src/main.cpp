#include <chrono>
#include <exception>
#include <filesystem>
#include <iostream>
#include <stdexcept>
#include <string>

#include <opencv2/dnn.hpp>
#include <opencv2/imgcodecs.hpp>

#include "scanner.hpp"

namespace {

namespace fs = std::filesystem;

template <typename Fn>
double measureMilliseconds(Fn&& fn) {
    const auto begin = std::chrono::steady_clock::now();
    std::forward<Fn>(fn)();
    const auto end = std::chrono::steady_clock::now();
    return std::chrono::duration<double, std::milli>(end - begin).count();
}

}  // namespace

int main(int argc, char** argv) {
    try {
        if (argc == 1) {
            scancpp::printUsage(argv[0]);
            return 1;
        }

        const std::string firstArg = argv[1];
        if (firstArg == "--help") {
            scancpp::printUsage(argv[0]);
            return 0;
        }

        if (firstArg == "--benchmark") {
            if (argc < 5 || argc > 7) {
                scancpp::printUsage(argv[0]);
                return 1;
            }

            const std::string modelPath = argv[2];
            const std::string imagePath = argv[3];
            const std::string outputPath = argv[4];
            const int measuredRuns = argc >= 6 ? std::stoi(argv[5]) : 20;
            const int warmupRuns = argc >= 7 ? std::stoi(argv[6]) : 3;

            const fs::path outputFilePath(outputPath);
            if (!outputFilePath.parent_path().empty()) {
                fs::create_directories(outputFilePath.parent_path());
            }

            const double coldStartMs = measureMilliseconds([&]() {
                scancpp::DocumentScanner coldScanner(modelPath);
                const cv::Mat coldInput = cv::imread(imagePath, cv::IMREAD_COLOR);
                if (coldInput.empty()) {
                    throw std::runtime_error("Failed to read the input image during cold start.");
                }

                const scancpp::ScanArtifacts coldArtifacts = coldScanner.scan(coldInput);
                if (!cv::imwrite(outputPath, coldArtifacts.scanned)) {
                    throw std::runtime_error("Failed to write cold-start output image.");
                }
            });

            cv::dnn::Net net = cv::dnn::readNetFromONNX(modelPath);
            if (net.empty()) {
                throw std::runtime_error("Failed to load the ONNX model.");
            }

            net.setPreferableBackend(cv::dnn::DNN_BACKEND_OPENCV);
            net.setPreferableTarget(cv::dnn::DNN_TARGET_CPU);

            scancpp::BenchmarkSummary summary =
                scancpp::benchmarkScanDocument(net, imagePath, outputPath, warmupRuns, measuredRuns);
            summary.coldStartMs = coldStartMs;

            std::cout << "Benchmark output saved to: " << outputPath << '\n'
                      << "Cold start total ms: " << summary.coldStartMs << '\n';
            scancpp::printBenchmarkSummary(summary);
            return 0;
        }

        if (argc < 4 || argc > 5) {
            scancpp::printUsage(argv[0]);
            return 1;
        }

        const std::string modelPath = argv[1];
        const std::string imagePath = argv[2];
        const std::string outputPath = argv[3];
        const std::string debugPrefix = argc == 5 ? argv[4] : std::string();

        scancpp::DocumentScanner scanner(modelPath);
        scancpp::ScanRequest request;
        request.inputPath = imagePath;
        request.scannedOutputPath = outputPath;
        request.debugOutputPrefix = debugPrefix;
        request.writeDebugImages = !debugPrefix.empty();
        scanner.scanFile(request);

        std::cout << "Saved scanned document to: " << outputPath << '\n';
        if (!debugPrefix.empty()) {
            std::cout << "Saved debug outputs with prefix: " << debugPrefix << '\n';
        }
        return 0;
    } catch (const std::exception& ex) {
        std::cerr << "Error: " << ex.what() << '\n';
        return 1;
    }
}
