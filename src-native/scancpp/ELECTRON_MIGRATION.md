# scancpp Electron 迁移说明

本文档面向需要把本项目接入其他 Electron 应用程序的同事，重点说明以下内容：

1. 这套代码是否可以跨平台和跨架构复用
2. 编译到 Electron 项目时依赖什么库和资源
3. 当前代码里真正的接入口在哪里
4. 如何把“扫描结果”和“文档边界坐标”一起提供给前端
5. 如何在 Electron 中显示检测边界

## 1. 结论

可以，这套代码可以迁移到 `x86_64` 和 `ARM64` 平台使用，适合以下组合：

- macOS Apple Silicon
- macOS Intel
- Windows x64
- Windows ARM64
- Linux x86_64
- Linux ARM64

前提是目标平台具备：

- 支持 C++17 的编译器
- OpenCV 4.x，且包含 `core / imgproc / imgcodecs / dnn`
- 与目标架构一致的 ONNX 模型文件 `u2netp.onnx`

当前工程没有使用以下任何平台绑定能力：

- `Windows.h`
- POSIX 专有系统调用
- 汇编或平台特定 SIMD 指令
- Metal / CUDA / DirectML 之类的专有推理后端

因此从源码层面是通用的。真正需要按平台分别准备的是“编译工具链”和“OpenCV 二进制依赖”。

## 2. 当前工程结构与职责

当前项目是一个“命令行 Demo + 核心算法”组合：

- [tools/export_onnx.py](/Users/bobh/Documents/Coding/scancpp/tools/export_onnx.py)
  用于把官方 `u2netp.pth` 导出为固定输入尺寸 `320x320` 的 ONNX
- [src/main.cpp](/Users/bobh/Documents/Coding/scancpp/src/main.cpp)
  包含完整扫描 Pipeline 和 CLI Demo
- [CMakeLists.txt](/Users/bobh/Documents/Coding/scancpp/CMakeLists.txt)
  当前的跨平台构建入口

虽然现在核心逻辑还集中在 `main.cpp`，但算法边界已经比较清晰，真正的核心入口是：

- [src/main.cpp:356](/Users/bobh/Documents/Coding/scancpp/src/main.cpp#L356) `ScanArtifacts scanDocument(cv::dnn::Net& net, const cv::Mat& image)`
- [src/main.cpp:260](/Users/bobh/Documents/Coding/scancpp/src/main.cpp#L260) `cv::Mat enhanceForScan(...)`
- [src/main.cpp:260](/Users/bobh/Documents/Coding/scancpp/src/main.cpp#L260) 之前的一系列图像处理函数
- [src/main.cpp:254](/Users/bobh/Documents/Coding/scancpp/src/main.cpp#L254) `drawDocumentOverlay(...)`

`ScanArtifacts` 里已经包含 Electron 侧常用的结果：

- `saliencyMask`
- `binaryMask`
- `warpedColor`
- `scanned`
- `corners`

其中 `corners` 的顺序是固定的：

- `0`: 左上
- `1`: 右上
- `2`: 右下
- `3`: 左下

这个顺序很重要，Electron 前端画边界时可以直接按这个顺序连线。

## 3. 迁移到 Electron 的两种方式

### 方式 A：先复用现有 CLI，可最快落地

这种方式适合快速验证或先让产品流程跑起来。

Electron 端做法：

1. 在主进程里通过 `child_process.spawn` 或 `execFile` 调用 `scancpp`
2. 传入模型路径、输入图片路径、输出图片路径
3. 可选传入调试前缀，生成 `overlay / warped / scan` 等中间文件
4. 主进程把输出文件路径和边界图路径回传给渲染进程

优点：

- 接入快
- 原项目改动最少
- 崩溃隔离简单

缺点：

- 进程间通信成本更高
- 边界坐标如果不额外输出，只能靠图片文件中转
- 后续要支持批量扫描、内存传图或视频帧处理时不够灵活

### 方式 B：抽成 C++ 库，再封装成 Node-API 原生模块，推荐长期使用

这是更适合正式 Electron 产品的方式。

建议拆分成：

```text
include/scancpp/scan_engine.h
src/scan_engine.cpp
src/main.cpp
electron/native/binding.cc
```

建议职责如下：

- `scan_engine.h / scan_engine.cpp`
  只放纯 C++ 扫描能力，不含 CLI
- `main.cpp`
  只保留命令行解析，调用 `scan_engine`
- `binding.cc`
  把 C++ 结果桥接给 Node-API

## 4. 推荐暴露给 Electron 的原生接口

建议把现在的内部结构整理成如下接口。

### 4.1 C++ 层推荐接口

```cpp
struct ScanOptions {
    bool generateOverlay = true;
    bool generateMask = false;
    bool generateWarped = false;
    bool enhanceForScan = true;
};

struct Quad {
    float x1;
    float y1;
    float x2;
    float y2;
    float x3;
    float y3;
    float x4;
    float y4;
};

struct ScanResult {
    Quad corners;
    cv::Mat scanned;
    cv::Mat warped;
    cv::Mat overlay;
};

ScanResult ScanDocument(
    cv::dnn::Net& net,
    const cv::Mat& input,
    const ScanOptions& options);
```

如果 Electron 端不直接吃 `cv::Mat`，也可以改成“输入输出都走文件路径”的接口：

```cpp
struct ScanFileRequest {
    std::string modelPath;
    std::string inputImagePath;
    std::string outputScanPath;
    std::string outputOverlayPath;
};

struct ScanFileResponse {
    bool ok;
    Quad corners;
    int width;
    int height;
    std::string errorMessage;
};

ScanFileResponse ScanDocumentFile(const ScanFileRequest& request);
```

### 4.2 如果需要 C ABI，推荐这样封装

如果你们更倾向于做动态库或给别的语言调用，建议额外包一层稳定的 C ABI：

```cpp
extern "C" int scancpp_scan_document(
    const char* model_path,
    const char* input_path,
    const char* output_scan_path,
    const char* output_overlay_path,
    float* corners_out_8,
    char* error_buffer,
    int error_buffer_size);
```

这样做的好处是：

- 对 Node-API、Rust、Go、Swift 或 C# 都更友好
- ABI 更稳定
- 更适合作为 Electron 的长期底层能力层

## 5. Electron 侧最关心的输入输出

Electron 最好不要自己做 OpenCV 计算，而是把它当作一个“扫描服务”来调用。

建议 native 层至少返回这些信息：

- 扫描件输出路径
- 边界预览图输出路径
- 四个顶点坐标
- 文档原图宽高
- 是否成功
- 失败错误信息

建议给前端的 JSON 结构类似这样：

```json
{
  "ok": true,
  "scanPath": "/abs/output/scan.png",
  "overlayPath": "/abs/output/overlay.png",
  "inputWidth": 4032,
  "inputHeight": 3024,
  "corners": [
    { "x": 250.0, "y": 180.0 },
    { "x": 3800.0, "y": 220.0 },
    { "x": 3720.0, "y": 2890.0 },
    { "x": 180.0, "y": 2840.0 }
  ]
}
```

## 6. 检测边界显示能力

可以支持，而且当前代码已经具备这个能力。

### 6.1 现有项目里已经能生成边界叠加图

当 CLI 传入 `debug_output_prefix` 时，现在会额外输出：

- `*_overlay.png`

这个文件是原图上画好边界后的结果图，绘制逻辑在：

- [src/main.cpp:254](/Users/bobh/Documents/Coding/scancpp/src/main.cpp#L254)
- [src/main.cpp:424](/Users/bobh/Documents/Coding/scancpp/src/main.cpp#L424)

现在的绘制内容包括：

- 四边形边框
- 四个角点
- 顶点编号 `0~3`

这很适合给测试同事或 QA 直接查看识别是否正确。

### 6.2 Electron 前端更推荐自己画线

如果是产品 UI，不建议永远依赖原生层输出 `overlay.png`，更推荐：

1. native 层返回四个角点坐标
2. 前端把原图显示出来
3. 在 `<canvas>` 或 CSS 叠加层上绘制四边形

这样更灵活，因为前端可以：

- 支持拖拽修正角点
- 支持高亮动画
- 支持不同颜色/粗细的描边
- 支持用户手动纠偏后再回传给 native 重算透视变换

### 6.3 前端绘制时的注意点

Electron 前端拿到的是原图坐标，绘制时通常需要做一次缩放映射：

```ts
const scaleX = displayedImageWidth / originalImageWidth;
const scaleY = displayedImageHeight / originalImageHeight;
```

然后每个点做：

```ts
screenX = point.x * scaleX;
screenY = point.y * scaleY;
```

只要原生层返回的是原图坐标，前端就可以准确画出来。

## 7. 推荐的迁移步骤

建议按下面顺序做，风险最低：

1. 先直接把当前 CLI 集成进 Electron 主进程，验证产品流程
2. 同时保留 `debug overlay` 输出，方便调试边界效果
3. 确认 UI 和交互方案后，再把算法从 `main.cpp` 拆到 `scan_engine.cpp`
4. 再做 Node-API 原生模块，让 Electron 直接调用库接口而不是外部进程
5. 最后再考虑批量扫描、内存传图、手动修边等增强功能

## 8. 编译依赖清单

迁移到其他 Electron 项目时，至少需要准备这些内容。

### 必备运行资产

- `u2netp.onnx`

建议放到 Electron 项目的：

```text
resources/models/u2netp.onnx
```

或打包到：

```text
<app>/resources/models/u2netp.onnx
```

### 必备原生依赖

- OpenCV 4.x
  - `opencv_core`
  - `opencv_imgproc`
  - `opencv_imgcodecs`
  - `opencv_dnn`

### 编译工具

- CMake >= 3.16
- C++17 编译器
- 平台对应的构建系统
  - macOS: AppleClang / Xcode Command Line Tools
  - Windows: MSVC
  - Linux: GCC 或 Clang

## 9. 不同平台的迁移提醒

### macOS

- Apple Silicon 和 Intel 都可以使用同一份源码
- 需要分别为 `arm64` 和 `x86_64` 编译
- 如果 Electron 目标是双架构发布，需要分别构建再合并发布流程

### Windows

- 推荐用 `vcpkg` 管理 OpenCV
- `x64` 和 `ARM64` 需要各自的依赖和构建产物
- 注意 Electron 自己的架构要和原生模块一致

### Linux

- 如果做发行版，尽量减少系统 OpenCV 版本漂移带来的问题
- 更推荐在 CI 或容器里固定依赖版本

## 10. 你同事真正需要关心的代码位置

如果你同事马上开始接入，这几个位置最关键：

- 核心扫描总入口：
  [src/main.cpp:326](/Users/bobh/Documents/Coding/scancpp/src/main.cpp#L326)
- 边界排序与透视校正：
  [src/main.cpp:193](/Users/bobh/Documents/Coding/scancpp/src/main.cpp#L193)
  [src/main.cpp:232](/Users/bobh/Documents/Coding/scancpp/src/main.cpp#L232)
- 扫描增强：
  [src/main.cpp:260](/Users/bobh/Documents/Coding/scancpp/src/main.cpp#L260)
- 边界叠加绘制：
  [src/main.cpp:254](/Users/bobh/Documents/Coding/scancpp/src/main.cpp#L254)
- CLI 接口与 benchmark：
  [src/main.cpp:439](/Users/bobh/Documents/Coding/scancpp/src/main.cpp#L439)

## 11. 建议的下一步重构

为了让迁移成本最低，我建议后续单独做一次很小的结构化重构：

1. 新增 `include/scancpp/scan_engine.h`
2. 新增 `src/scan_engine.cpp`
3. 把 `ScanArtifacts`、`scanDocument`、`drawDocumentOverlay` 移进去
4. `main.cpp` 只保留参数解析和文件读写

这样 Electron 团队就能直接依赖一个稳定的库接口，而不是从 CLI 或大文件里摘函数。

## 12. 当前能力边界

当前版本已经适合：

- 单张图片扫描
- CPU 推理
- 自动识别文档边界
- 输出扫描件
- 输出边界叠加图

如果后面产品需要这些能力，还需要继续扩展：

- 手动拖拽修边后重新透视变换
- 批量多页扫描
- 多线程队列处理
- 内存 buffer 输入输出而不是文件路径
- PDF 合并导出
- 更强的去噪和背景清理策略

## 13. 一句话建议

短期落地：

- 直接用 CLI 接 Electron 主进程
- 让 native 侧生成 `scan.png` 和 `overlay.png`

长期演进：

- 把 `scanDocument()` 抽成库
- 用 Node-API 暴露 “扫描结果 + 四点坐标 + overlay”

这样既能尽快上线，也不会把后续架构锁死。
