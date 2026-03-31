# scancpp Electron 整合指南

本文档给后续接手的同事用，目标很明确：

1. 不再依赖机器上预装的 OpenCV 动态库
2. 直接把 OpenCV 源码内嵌进 `scancpp`，产出适合 Electron 使用的自包含二进制
3. 说明如何先用 CLI 方式接进 Electron
4. 说明后续如果要升级为 Node-API 原生模块，应该怎么拆

## 1. 当前推荐方案

当前项目的推荐接入方式不是“系统 OpenCV”，而是：

- 把 OpenCV 源码放在 [third_party/opencv](/Users/bobh/Documents/Coding/scancpp/third_party/opencv)
- 使用顶层 [CMakeLists.txt](/Users/bobh/Documents/Coding/scancpp/CMakeLists.txt) 的 `bundled-static` 模式
- 让 `scancpp` 在编译期静态链接 `opencv_core / opencv_imgproc / opencv_imgcodecs / opencv_dnn`

这样做的结果是：

- 最终 `scancpp` 不依赖 `libopencv_*.dylib`
- Electron 打包时不需要额外收集 OpenCV 动态库
- 依赖版本固定，避免目标机器 OpenCV 版本不一致

当前已经验证通过的 Release 构建产物是：

- [build-embedded-release-sys/bin/scancpp](/Users/bobh/Documents/Coding/scancpp/build-embedded-release-sys/bin/scancpp)

在 macOS 上用 `otool -L` 检查时，只剩系统库依赖，没有 `libopencv_*.dylib`。

## 2. 这套方案解决了什么问题

之前的问题是：

- 工程默认走系统 OpenCV
- 最终二进制会动态依赖本机 OpenCV 库
- Electron 打包时要额外带上多份 `dylib` 或 `dll`
- 很容易遇到目标机器缺库、路径不对、签名不一致的问题

现在的方案改成了：

- OpenCV 直接参与本仓库构建
- 默认优先使用 [third_party/opencv](/Users/bobh/Documents/Coding/scancpp/third_party/opencv)
- 静态链接到最终程序

另外，macOS 上还额外处理了一个坑：

- OpenCV 子构建会探测 Python
- Homebrew Python 3.14 在当前机器上会触发 `Code Signature Invalid`
- 顶层 CMake 已强制在 Apple 平台改用 `/usr/bin/python3`

对应配置可以看这里：

- [CMakeLists.txt](/Users/bobh/Documents/Coding/scancpp/CMakeLists.txt#L6)
- [CMakeLists.txt](/Users/bobh/Documents/Coding/scancpp/CMakeLists.txt#L43)

## 3. 当前工程里最关键的代码位置

构建入口：

- [CMakeLists.txt](/Users/bobh/Documents/Coding/scancpp/CMakeLists.txt)

扫描主流程：

- [src/main.cpp](/Users/bobh/Documents/Coding/scancpp/src/main.cpp#L380)

单次扫描入口：

- [src/main.cpp](/Users/bobh/Documents/Coding/scancpp/src/main.cpp#L359)

命令行入口：

- [src/main.cpp](/Users/bobh/Documents/Coding/scancpp/src/main.cpp#L499)

benchmark 参数和输出路径逻辑：

- [src/main.cpp](/Users/bobh/Documents/Coding/scancpp/src/main.cpp#L512)

注意一点：

- benchmark 输出文件名不是写死的
- 它就是命令行第 4 个参数 `argv[4]`

## 4. 给 Electron 同事的标准构建步骤

### 4.1 准备源码

需要确认仓库里已经有：

- [third_party/opencv](/Users/bobh/Documents/Coding/scancpp/third_party/opencv)
- [models/u2netp.onnx](/Users/bobh/Documents/Coding/scancpp/models/u2netp.onnx)

如果 `third_party/opencv` 不存在，就先把 OpenCV 源码放进去。当前项目已经适配“本地源码树内嵌构建”，不要求同事再去装系统 OpenCV。

### 4.2 推荐的 Release 构建命令

在仓库根目录执行：

```bash
cmake -S . -B build-embedded-release-sys \
  -DSCANCPP_OPENCV_PROVIDER=bundled-static \
  -DSCANCPP_OPENCV_SOURCE_DIR="$PWD/third_party/opencv"

cmake --build build-embedded-release-sys -j8
```

构建完成后，产物在：

```text
build-embedded-release-sys/bin/scancpp
```

### 4.3 验证是不是静态内嵌成功

macOS 下执行：

```bash
otool -L build-embedded-release-sys/bin/scancpp
```

期望结果：

- 只看到系统库
- 不应该出现任何 `libopencv_*.dylib`

### 4.4 验证扫描是否正常

单次扫描：

```bash
./build-embedded-release-sys/bin/scancpp \
  models/u2netp.onnx \
  example_input/IMG_7298.jpg \
  benchmark/IMG_7298_scan_optimized.png
```

短基准测试：

```bash
./build-embedded-release-sys/bin/scancpp --benchmark \
  models/u2netp.onnx \
  example_input/IMG_7298.jpg \
  benchmark/IMG_7298_scan_optimized.png \
  5 1
```

当前机器上已经实测通过，参考结果大致为：

- `Cold start total ms: 404`
- `avg infer ms: 87`
- `avg postprocess ms: 115`
- `avg total ms: 248`

如果同事看到 `infer` 或 `postprocess` 变成秒级，先检查是不是误用了非 Release 构建。

## 5. Electron 项目里怎么接

现阶段最稳妥的方案是：

- Electron 主进程调用这个 CLI
- 不要一开始就急着改 Node-API

原因很简单：

- CLI 已经能稳定输出扫描图
- 进程隔离更容易排查问题
- 先跑通产品流程，再决定是否做原生模块化

### 5.1 推荐的 Electron 资源布局

建议在 Electron 项目里保留类似结构：

```text
resources/
  native/
    darwin-arm64/scancpp
    darwin-x64/scancpp
    win32-x64/scancpp.exe
    linux-x64/scancpp
  models/
    u2netp.onnx
```

说明：

- 每个平台、每个架构都要单独编自己的 `scancpp`
- `u2netp.onnx` 可以跟随应用资源一起分发
- 不需要再额外塞 OpenCV 动态库

### 5.2 主进程调用方式

Electron 主进程推荐用 `execFile`：

```ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

async function scanDocument(binaryPath: string, modelPath: string, inputPath: string, outputPath: string) {
  const { stdout, stderr } = await execFileAsync(binaryPath, [
    modelPath,
    inputPath,
    outputPath,
  ]);

  return { stdout, stderr, outputPath };
}
```

如果想同时拿到调试图，可以再传第 4 个业务参数 `debug_output_prefix`：

```ts
await execFileAsync(binaryPath, [
  modelPath,
  inputPath,
  outputPath,
  debugPrefix,
]);
```

这样会额外生成：

- `*_mask.png`
- `*_binary.png`
- `*_overlay.png`
- `*_warped.png`
- `*_scan.png`

对应写文件逻辑在：

- [src/main.cpp](/Users/bobh/Documents/Coding/scancpp/src/main.cpp#L459)

### 5.3 主进程向前端返回什么

短期建议只返回：

- 是否成功
- 扫描结果路径
- 调试图路径
- stdout / stderr

一个够用的返回结构可以是：

```json
{
  "ok": true,
  "scanPath": "/abs/path/output.png",
  "overlayPath": "/abs/path/debug_overlay.png",
  "stdout": "Saved scanned document to: /abs/path/output.png",
  "stderr": ""
}
```

## 6. 如果后面要升级成 Node-API

CLI 方式适合先落地，但长期推荐拆成“核心库 + Node-API”。

建议拆分为：

```text
include/scancpp/scan_engine.h
src/scan_engine.cpp
src/main.cpp
electron/native/binding.cc
```

职责建议：

- `scan_engine.cpp`
  放纯扫描能力，不包含命令行解析
- `main.cpp`
  只保留 CLI 解析和文件 IO
- `binding.cc`
  负责把 C++ 结构转成 JS 可消费对象

推荐 C++ 侧接口：

```cpp
struct ScanOptions {
    bool generateOverlay = true;
    bool generateMask = false;
    bool generateWarped = false;
};

struct Point2f {
    float x;
    float y;
};

struct ScanResult {
    std::array<Point2f, 4> corners;
    cv::Mat scanned;
    cv::Mat warped;
    cv::Mat overlay;
};

ScanResult ScanDocument(
    cv::dnn::Net& net,
    const cv::Mat& input,
    const ScanOptions& options);
```

这样 Electron 原生模块可以直接返回：

- `corners`
- `inputWidth`
- `inputHeight`
- 输出图片 buffer 或临时路径

## 7. 前端如果要显示边界

当前代码已经有边界绘制逻辑：

- [src/main.cpp](/Users/bobh/Documents/Coding/scancpp/src/main.cpp#L255)

但正式产品里更推荐前端自己画四边形，而不是完全依赖 `overlay.png`。

原因：

- UI 更灵活
- 可以做拖拽修边
- 可以做动画和高亮
- 后续更适合手动纠偏

只要 native 层返回原图坐标，前端按缩放比映射即可：

```ts
const scaleX = displayedImageWidth / originalImageWidth;
const scaleY = displayedImageHeight / originalImageHeight;
```

## 8. 多平台交付建议

这套源码本身是跨平台的，但原生产物必须按平台和架构分别编译：

- macOS arm64
- macOS x64
- Windows x64
- Windows arm64
- Linux x64
- Linux arm64

建议不要在用户机器上现编，最好在 CI 里为每个平台产出独立二进制，再随 Electron 一起打包。

## 9. 常见排查点

### 9.1 benchmark 特别慢

先检查：

- 是否是 `Release`
- 是否带了 `-O3 -DNDEBUG`
- 是否误用了旧构建目录

### 9.2 macOS 构建阶段 Python 崩溃

先检查：

- OpenCV 子构建是不是还在用 `/opt/homebrew/bin/python3`

当前仓库已经在 bundled-static 模式下强制改为 `/usr/bin/python3`。

### 9.3 Electron 打包后运行时报缺库

先检查：

- 实际打进去的是不是这次静态构建产物
- 有没有误把旧的系统 OpenCV 版本 `scancpp` 带进包里

## 10. 一句话结论

给 Electron 同事的建议是：

- 直接使用当前仓库的 `bundled-static` 模式
- 把 [third_party/opencv](/Users/bobh/Documents/Coding/scancpp/third_party/opencv) 一起参与编译
- 产出每个平台自己的 `scancpp`
- Electron 先通过 CLI 调用
- 不要再依赖系统 OpenCV 动态库

这会比继续维护一堆 `dylib` / `dll` 稳定得多，也更适合后面升级成 Node 原生模块。
