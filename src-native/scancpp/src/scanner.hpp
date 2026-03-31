#pragma once

#include <array>
#include <filesystem>
#include <mutex>
#include <string>
#include <vector>

#include <opencv2/core.hpp>
#include <opencv2/dnn.hpp>

namespace scancpp {

namespace fs = std::filesystem;

struct ScanArtifacts {
    cv::Mat saliencyMask;
    cv::Mat binaryMask;
    cv::Mat warpedColor;
    cv::Mat scanned;
    std::array<cv::Point2f, 4> corners{};
};

struct BenchmarkRun {
    double readMs = 0.0;
    double inferMs = 0.0;
    double postprocessMs = 0.0;
    double writeMs = 0.0;
    double totalMs = 0.0;
};

struct BenchmarkSummary {
    double coldStartMs = 0.0;
    double averageReadMs = 0.0;
    double averageInferMs = 0.0;
    double averagePostprocessMs = 0.0;
    double averageWriteMs = 0.0;
    double averageTotalMs = 0.0;
    double minTotalMs = 0.0;
    double maxTotalMs = 0.0;
    int warmupRuns = 0;
    int measuredRuns = 0;
};

struct ScanRequest {
    fs::path inputPath;
    fs::path scannedOutputPath;
    fs::path overlayOutputPath;
    std::string debugOutputPrefix;
    bool writeOverlay = true;
    bool writeDebugImages = false;
    bool applyPostProcess = true;
};

struct ScanResult {
    std::array<cv::Point2f, 4> corners{};
    int sourceWidth = 0;
    int sourceHeight = 0;
    int scannedWidth = 0;
    int scannedHeight = 0;
    fs::path scannedOutputPath;
    fs::path overlayOutputPath;
    std::vector<fs::path> debugOutputPaths;
};

class DocumentScanner {
  public:
    explicit DocumentScanner(const std::string& modelPath);

    ScanArtifacts scan(const cv::Mat& image, bool applyPostProcess = true);
    ScanResult scanFile(const ScanRequest& request);

  private:
    cv::dnn::Net net_;
    std::mutex mutex_;
};

BenchmarkSummary benchmarkScanDocument(
    cv::dnn::Net& net,
    const std::string& imagePath,
    const std::string& outputPath,
    int warmupRuns,
    int measuredRuns);

void printUsage(const char* executable);
void printBenchmarkSummary(const BenchmarkSummary& summary);

}  // namespace scancpp
