#include "scanner.hpp"

#include <algorithm>
#include <chrono>
#include <cmath>
#include <iostream>
#include <limits>
#include <stdexcept>

#include <opencv2/imgcodecs.hpp>
#include <opencv2/imgproc.hpp>

namespace scancpp {

namespace {

constexpr int kModelInputSize = 320;
constexpr int kMaxEnhancementDimension = 1280;

int makeOdd(int value) {
    const int clamped = std::max(3, value);
    return clamped % 2 == 0 ? clamped + 1 : clamped;
}

cv::Mat ensureBgr(const cv::Mat& image) {
    if (image.empty()) {
        throw std::runtime_error("Input image is empty.");
    }

    if (image.channels() == 3) {
        return image;
    }

    cv::Mat converted;
    if (image.channels() == 1) {
        cv::cvtColor(image, converted, cv::COLOR_GRAY2BGR);
        return converted;
    }

    if (image.channels() == 4) {
        cv::cvtColor(image, converted, cv::COLOR_BGRA2BGR);
        return converted;
    }

    throw std::runtime_error("Unsupported image channel count.");
}

cv::Mat preprocessForU2Net(const cv::Mat& image) {
    cv::Mat bgr = ensureBgr(image);
    cv::Mat rgb;
    cv::cvtColor(bgr, rgb, cv::COLOR_BGR2RGB);

    cv::Mat resized;
    cv::resize(rgb, resized, cv::Size(kModelInputSize, kModelInputSize), 0.0, 0.0, cv::INTER_AREA);

    cv::Mat floatImage;
    resized.convertTo(floatImage, CV_32FC3, 1.0 / 255.0);

    std::vector<cv::Mat> channels;
    cv::split(floatImage, channels);
    const std::array<float, 3> mean{0.485f, 0.456f, 0.406f};
    const std::array<float, 3> stddev{0.229f, 0.224f, 0.225f};

    for (std::size_t i = 0; i < channels.size(); ++i) {
        channels[i] = (channels[i] - mean[i]) / stddev[i];
    }

    cv::merge(channels, floatImage);
    return cv::dnn::blobFromImage(floatImage, 1.0, cv::Size(), cv::Scalar(), false, false, CV_32F);
}

cv::Mat inferSaliencyMask(cv::dnn::Net& net, const cv::Mat& image) {
    cv::Mat blob = preprocessForU2Net(image);
    net.setInput(blob);
    cv::Mat output = net.forward();

    if (output.dims != 4 || output.size[0] != 1 || output.size[1] != 1) {
        throw std::runtime_error("Unexpected ONNX output shape. Expected [1, 1, H, W].");
    }

    const int maskHeight = output.size[2];
    const int maskWidth = output.size[3];
    cv::Mat rawMask(maskHeight, maskWidth, CV_32F, output.ptr<float>());
    cv::Mat normalized = rawMask.clone();

    double minValue = 0.0;
    double maxValue = 0.0;
    cv::minMaxLoc(normalized, &minValue, &maxValue);
    if (maxValue - minValue > std::numeric_limits<double>::epsilon()) {
        normalized = (normalized - static_cast<float>(minValue)) /
                     static_cast<float>(maxValue - minValue);
    } else {
        normalized = cv::Mat::zeros(normalized.size(), normalized.type());
    }

    cv::Mat resized;
    cv::resize(normalized, resized, image.size(), 0.0, 0.0, cv::INTER_LINEAR);
    return resized;
}

cv::Mat makeBinaryDocumentMask(const cv::Mat& saliencyMask) {
    cv::Mat mask8u;
    saliencyMask.convertTo(mask8u, CV_8U, 255.0);

    cv::Mat binary;
    cv::threshold(mask8u, binary, 0.0, 255.0, cv::THRESH_BINARY | cv::THRESH_OTSU);

    const cv::Mat kernel = cv::getStructuringElement(cv::MORPH_RECT, cv::Size(5, 5));
    cv::morphologyEx(binary, binary, cv::MORPH_CLOSE, kernel, cv::Point(-1, -1), 2);
    cv::morphologyEx(binary, binary, cv::MORPH_OPEN, kernel, cv::Point(-1, -1), 1);
    return binary;
}

std::vector<cv::Point> largestContour(const cv::Mat& binaryMask) {
    std::vector<std::vector<cv::Point>> contours;
    cv::findContours(binaryMask, contours, cv::RETR_EXTERNAL, cv::CHAIN_APPROX_SIMPLE);

    if (contours.empty()) {
        throw std::runtime_error("No document contour found in the saliency mask.");
    }

    const auto bestIt = std::max_element(
        contours.begin(),
        contours.end(),
        [](const std::vector<cv::Point>& lhs, const std::vector<cv::Point>& rhs) {
            return cv::contourArea(lhs) < cv::contourArea(rhs);
        });

    if (cv::contourArea(*bestIt) < 1000.0) {
        throw std::runtime_error("Detected contour is too small to be a document.");
    }

    return *bestIt;
}

std::vector<cv::Point2f> approximateDocumentQuad(const std::vector<cv::Point>& contour) {
    const double perimeter = cv::arcLength(contour, true);
    std::vector<cv::Point> approx;

    for (double epsilonScale = 0.01; epsilonScale <= 0.06; epsilonScale += 0.005) {
        cv::approxPolyDP(contour, approx, epsilonScale * perimeter, true);
        if (approx.size() == 4 && cv::isContourConvex(approx)) {
            std::vector<cv::Point2f> quad;
            quad.reserve(4);
            for (const cv::Point& point : approx) {
                quad.emplace_back(static_cast<float>(point.x), static_cast<float>(point.y));
            }
            return quad;
        }
    }

    cv::RotatedRect box = cv::minAreaRect(contour);
    std::array<cv::Point2f, 4> points{};
    box.points(points.data());
    return std::vector<cv::Point2f>(points.begin(), points.end());
}

std::array<cv::Point2f, 4> orderCorners(const std::vector<cv::Point2f>& points) {
    if (points.size() != 4) {
        throw std::runtime_error("Exactly 4 points are required to order the document corners.");
    }

    cv::Point2f center(0.0f, 0.0f);
    for (const auto& point : points) {
        center += point;
    }
    center *= 0.25f;

    std::vector<cv::Point2f> sorted = points;
    std::sort(sorted.begin(), sorted.end(), [&center](const cv::Point2f& lhs, const cv::Point2f& rhs) {
        return std::atan2(lhs.y - center.y, lhs.x - center.x) <
               std::atan2(rhs.y - center.y, rhs.x - center.x);
    });

    const auto topLeftIt = std::min_element(sorted.begin(), sorted.end(), [](const cv::Point2f& lhs, const cv::Point2f& rhs) {
        return (lhs.x + lhs.y) < (rhs.x + rhs.y);
    });

    std::array<cv::Point2f, 4> rotated{};
    const std::size_t start = static_cast<std::size_t>(std::distance(sorted.begin(), topLeftIt));
    for (std::size_t i = 0; i < sorted.size(); ++i) {
        rotated[i] = sorted[(start + i) % sorted.size()];
    }

    if (rotated[1].x < rotated[3].x) {
        return {rotated[0], rotated[3], rotated[2], rotated[1]};
    }

    return rotated;
}

float euclideanDistance(const cv::Point2f& a, const cv::Point2f& b) {
    const cv::Point2f delta = a - b;
    return std::sqrt(delta.x * delta.x + delta.y * delta.y);
}

cv::Mat warpDocument(const cv::Mat& image, const std::array<cv::Point2f, 4>& corners) {
    const float widthTop = euclideanDistance(corners[0], corners[1]);
    const float widthBottom = euclideanDistance(corners[3], corners[2]);
    const float heightLeft = euclideanDistance(corners[0], corners[3]);
    const float heightRight = euclideanDistance(corners[1], corners[2]);

    const int targetWidth = std::max(1, static_cast<int>(std::round(std::max(widthTop, widthBottom))));
    const int targetHeight = std::max(1, static_cast<int>(std::round(std::max(heightLeft, heightRight))));

    const std::array<cv::Point2f, 4> destination{
        cv::Point2f(0.0f, 0.0f),
        cv::Point2f(static_cast<float>(targetWidth - 1), 0.0f),
        cv::Point2f(static_cast<float>(targetWidth - 1), static_cast<float>(targetHeight - 1)),
        cv::Point2f(0.0f, static_cast<float>(targetHeight - 1)),
    };

    const cv::Mat transform = cv::getPerspectiveTransform(corners.data(), destination.data());
    cv::Mat warped;
    cv::warpPerspective(
        image,
        warped,
        transform,
        cv::Size(targetWidth, targetHeight),
        cv::INTER_CUBIC,
        cv::BORDER_REPLICATE);
    return warped;
}

cv::Mat drawDocumentOverlay(const cv::Mat& image, const std::array<cv::Point2f, 4>& corners) {
    cv::Mat overlay = image.clone();

    const std::array<cv::Scalar, 4> colors{
        cv::Scalar(0, 0, 255),
        cv::Scalar(0, 255, 255),
        cv::Scalar(0, 255, 0),
        cv::Scalar(255, 0, 0),
    };

    for (std::size_t i = 0; i < corners.size(); ++i) {
        const cv::Point current(
            static_cast<int>(std::lround(corners[i].x)),
            static_cast<int>(std::lround(corners[i].y)));
        const cv::Point next(
            static_cast<int>(std::lround(corners[(i + 1) % corners.size()].x)),
            static_cast<int>(std::lround(corners[(i + 1) % corners.size()].y)));

        cv::line(overlay, current, next, cv::Scalar(30, 220, 30), 6, cv::LINE_AA);
        cv::circle(overlay, current, 10, colors[i], cv::FILLED, cv::LINE_AA);
        cv::putText(
            overlay,
            std::to_string(i + 1),
            current + cv::Point(12, -12),
            cv::FONT_HERSHEY_SIMPLEX,
            0.9,
            colors[i],
            2,
            cv::LINE_AA);
    }

    return overlay;
}

cv::Mat enhanceForScan(const cv::Mat& warpedColor) {
    cv::Mat gray;
    cv::cvtColor(warpedColor, gray, cv::COLOR_BGR2GRAY);

    const int shortSide = std::max(1, std::min(gray.cols, gray.rows));
    const int longSide = std::max(gray.cols, gray.rows);
    const double enhancementScale =
        longSide > kMaxEnhancementDimension
            ? static_cast<double>(kMaxEnhancementDimension) / static_cast<double>(longSide)
            : 1.0;

    cv::Mat workingGray = gray;
    if (enhancementScale < 1.0) {
        cv::resize(gray, workingGray, cv::Size(), enhancementScale, enhancementScale, cv::INTER_AREA);
    }

    const int workingShortSide = std::max(1, std::min(workingGray.cols, workingGray.rows));
    const int blurKernel = makeOdd(std::min(121, std::max(31, workingShortSide / 8)));

    cv::Mat backgroundSmall;
    cv::GaussianBlur(
        workingGray,
        backgroundSmall,
        cv::Size(blurKernel, blurKernel),
        0.0,
        0.0,
        cv::BORDER_REPLICATE);

    cv::Mat background;
    if (backgroundSmall.size() != gray.size()) {
        cv::resize(backgroundSmall, background, gray.size(), 0.0, 0.0, cv::INTER_LINEAR);
    } else {
        background = backgroundSmall;
    }

    cv::Mat grayFloat;
    cv::Mat backgroundFloat;
    gray.convertTo(grayFloat, CV_32F);
    background.convertTo(backgroundFloat, CV_32F);

    cv::Mat normalizedFloat;
    cv::divide(grayFloat, backgroundFloat + 1.0f, normalizedFloat, 255.0);

    cv::Mat normalized;
    normalizedFloat.convertTo(normalized, CV_8U);
    cv::normalize(normalized, normalized, 0, 255, cv::NORM_MINMAX);

    auto clahe = cv::createCLAHE(2.5, cv::Size(8, 8));
    clahe->apply(normalized, normalized);
    cv::GaussianBlur(normalized, normalized, cv::Size(3, 3), 0.0, 0.0, cv::BORDER_REPLICATE);

    const int blockSize = makeOdd(std::min(63, std::max(21, shortSide / 48)));

    cv::Mat scanned;
    cv::adaptiveThreshold(
        normalized,
        scanned,
        255,
        cv::ADAPTIVE_THRESH_GAUSSIAN_C,
        cv::THRESH_BINARY,
        blockSize,
        10);
    cv::medianBlur(scanned, scanned, 3);
    return scanned;
}

template <typename Fn>
double measureMilliseconds(Fn&& fn) {
    const auto begin = std::chrono::steady_clock::now();
    std::forward<Fn>(fn)();
    const auto end = std::chrono::steady_clock::now();
    return std::chrono::duration<double, std::milli>(end - begin).count();
}

std::vector<fs::path> saveDebugOutputs(
    const cv::Mat& inputImage,
    const ScanArtifacts& artifacts,
    const std::string& prefix) {
    const fs::path prefixPath(prefix);
    if (!prefixPath.parent_path().empty()) {
        fs::create_directories(prefixPath.parent_path());
    }

    cv::Mat saliency8u;
    artifacts.saliencyMask.convertTo(saliency8u, CV_8U, 255.0);
    const cv::Mat overlay = drawDocumentOverlay(inputImage, artifacts.corners);

    const std::vector<fs::path> paths{
        fs::path(prefix + "_mask.png"),
        fs::path(prefix + "_binary.png"),
        fs::path(prefix + "_overlay.png"),
        fs::path(prefix + "_warped.png"),
        fs::path(prefix + "_scan.png"),
    };

    if (!cv::imwrite(paths[0].string(), saliency8u) ||
        !cv::imwrite(paths[1].string(), artifacts.binaryMask) ||
        !cv::imwrite(paths[2].string(), overlay) ||
        !cv::imwrite(paths[3].string(), artifacts.warpedColor) ||
        !cv::imwrite(paths[4].string(), artifacts.scanned)) {
        throw std::runtime_error("Failed to write one or more debug images.");
    }

    return paths;
}

}  // namespace

DocumentScanner::DocumentScanner(const std::string& modelPath)
    : net_(cv::dnn::readNetFromONNX(modelPath)) {
    if (net_.empty()) {
        throw std::runtime_error("Failed to load the ONNX model.");
    }

    net_.setPreferableBackend(cv::dnn::DNN_BACKEND_OPENCV);
    net_.setPreferableTarget(cv::dnn::DNN_TARGET_CPU);
}

ScanArtifacts DocumentScanner::scan(const cv::Mat& image) {
    std::lock_guard<std::mutex> lock(mutex_);

    ScanArtifacts artifacts;
    artifacts.saliencyMask = inferSaliencyMask(net_, image);
    artifacts.binaryMask = makeBinaryDocumentMask(artifacts.saliencyMask);

    const std::vector<cv::Point> contour = largestContour(artifacts.binaryMask);
    artifacts.corners = orderCorners(approximateDocumentQuad(contour));
    artifacts.warpedColor = warpDocument(image, artifacts.corners);
    artifacts.scanned = enhanceForScan(artifacts.warpedColor);
    return artifacts;
}

ScanResult DocumentScanner::scanFile(const ScanRequest& request) {
    const cv::Mat input = cv::imread(request.inputPath.string(), cv::IMREAD_COLOR);
    if (input.empty()) {
        throw std::runtime_error("Failed to read the input image.");
    }

    const ScanArtifacts artifacts = scan(input);

    if (!request.scannedOutputPath.empty()) {
        if (!request.scannedOutputPath.parent_path().empty()) {
            fs::create_directories(request.scannedOutputPath.parent_path());
        }
        if (!cv::imwrite(request.scannedOutputPath.string(), artifacts.scanned)) {
            throw std::runtime_error("Failed to write the output image.");
        }
    }

    if (request.writeOverlay && !request.overlayOutputPath.empty()) {
        if (!request.overlayOutputPath.parent_path().empty()) {
            fs::create_directories(request.overlayOutputPath.parent_path());
        }
        const cv::Mat overlay = drawDocumentOverlay(input, artifacts.corners);
        if (!cv::imwrite(request.overlayOutputPath.string(), overlay)) {
            throw std::runtime_error("Failed to write the overlay image.");
        }
    }

    ScanResult result;
    result.corners = artifacts.corners;
    result.sourceWidth = input.cols;
    result.sourceHeight = input.rows;
    result.scannedWidth = artifacts.scanned.cols;
    result.scannedHeight = artifacts.scanned.rows;
    result.scannedOutputPath = request.scannedOutputPath;
    result.overlayOutputPath = request.overlayOutputPath;

    if (request.writeDebugImages && !request.debugOutputPrefix.empty()) {
        result.debugOutputPaths = saveDebugOutputs(input, artifacts, request.debugOutputPrefix);
    }

    return result;
}

BenchmarkSummary benchmarkScanDocument(
    cv::dnn::Net& net,
    const std::string& imagePath,
    const std::string& outputPath,
    int warmupRuns,
    int measuredRuns) {
    if (measuredRuns <= 0) {
        throw std::runtime_error("Benchmark measured run count must be greater than 0.");
    }

    std::vector<BenchmarkRun> runs;
    runs.reserve(static_cast<std::size_t>(measuredRuns));

    for (int iteration = 0; iteration < warmupRuns + measuredRuns; ++iteration) {
        BenchmarkRun run;
        cv::Mat input;
        ScanArtifacts artifacts;

        const auto totalBegin = std::chrono::steady_clock::now();

        run.readMs = measureMilliseconds([&]() {
            input = cv::imread(imagePath, cv::IMREAD_COLOR);
            if (input.empty()) {
                throw std::runtime_error("Failed to read the input image during benchmark.");
            }
        });

        run.inferMs = measureMilliseconds([&]() {
            artifacts.saliencyMask = inferSaliencyMask(net, input);
        });

        run.postprocessMs = measureMilliseconds([&]() {
            artifacts.binaryMask = makeBinaryDocumentMask(artifacts.saliencyMask);
            const std::vector<cv::Point> contour = largestContour(artifacts.binaryMask);
            artifacts.corners = orderCorners(approximateDocumentQuad(contour));
            artifacts.warpedColor = warpDocument(input, artifacts.corners);
            artifacts.scanned = enhanceForScan(artifacts.warpedColor);
        });

        run.writeMs = measureMilliseconds([&]() {
            if (!cv::imwrite(outputPath, artifacts.scanned)) {
                throw std::runtime_error("Failed to write benchmark output image.");
            }
        });

        const auto totalEnd = std::chrono::steady_clock::now();
        run.totalMs = std::chrono::duration<double, std::milli>(totalEnd - totalBegin).count();

        if (iteration >= warmupRuns) {
            runs.push_back(run);
        }
    }

    BenchmarkSummary summary;
    summary.warmupRuns = warmupRuns;
    summary.measuredRuns = measuredRuns;
    summary.minTotalMs = runs.front().totalMs;
    summary.maxTotalMs = runs.front().totalMs;

    for (const BenchmarkRun& run : runs) {
        summary.averageReadMs += run.readMs;
        summary.averageInferMs += run.inferMs;
        summary.averagePostprocessMs += run.postprocessMs;
        summary.averageWriteMs += run.writeMs;
        summary.averageTotalMs += run.totalMs;
        summary.minTotalMs = std::min(summary.minTotalMs, run.totalMs);
        summary.maxTotalMs = std::max(summary.maxTotalMs, run.totalMs);
    }

    const double count = static_cast<double>(runs.size());
    summary.averageReadMs /= count;
    summary.averageInferMs /= count;
    summary.averagePostprocessMs /= count;
    summary.averageWriteMs /= count;
    summary.averageTotalMs /= count;
    return summary;
}

void printUsage(const char* executable) {
    std::cout << "Usage: " << executable
              << " <model.onnx> <input_image> <output_scan> [debug_output_prefix]\n"
              << "   or: " << executable
              << " --benchmark <model.onnx> <input_image> <output_scan> [runs] [warmup]\n";
}

void printBenchmarkSummary(const BenchmarkSummary& summary) {
    std::cout << "Benchmark summary\n"
              << "  warmup runs: " << summary.warmupRuns << '\n'
              << "  measured runs: " << summary.measuredRuns << '\n'
              << "  avg read ms: " << summary.averageReadMs << '\n'
              << "  avg infer ms: " << summary.averageInferMs << '\n'
              << "  avg postprocess ms: " << summary.averagePostprocessMs << '\n'
              << "  avg write ms: " << summary.averageWriteMs << '\n'
              << "  avg total ms: " << summary.averageTotalMs << '\n'
              << "  min total ms: " << summary.minTotalMs << '\n'
              << "  max total ms: " << summary.maxTotalMs << '\n';
}

}  // namespace scancpp
