# scancpp

一个混合工程示例：先用 Python 把官方 `u2netp.pth` 导出为 OpenCV `cv::dnn` 可直接加载的静态输入 ONNX，再用纯 C++17 + OpenCV 4.x 实现文档检测、透视矫正和扫描增强。

## 项目结构

```text
.
├── tools/
│   ├── requirements.txt
│   └── export_onnx.py
├── src/
│   └── main.cpp
├── CMakeLists.txt
└── README.md
```

## 功能说明

当前 Demo 的完整 Pipeline 如下：

1. 使用 `u2netp.onnx` 对输入自然场景图片做显著性分割。
2. 从显著性 Mask 中提取最大外轮廓并逼近出文档四边形。
3. 对四个顶点做排序，执行透视变换，把纸张拉平。
4. 对拉平后的图像做去阴影、局部增强和二值化，输出白底黑字扫描件。

整个 C++ 端只依赖 OpenCV 4.x 的 `core / imgproc / imgcodecs / dnn` 模块，没有使用任何平台特有 API，因此可以用于后续封装到 Electron 原生模块或命令行工具。

## 1. 下载官方 `u2netp.pth`

官方权重下载入口在 NathanUA 的 U-2-Net 仓库 README 中：

- 仓库主页: [https://github.com/NathanUA/U-2-Net](https://github.com/NathanUA/U-2-Net)
- README 中的权重说明: 进入仓库后找到 `u2netp.pth (4.7 MB)` 的 Google Drive 链接

建议把下载好的权重放到本项目的 `models/` 目录，例如：

```text
models/u2netp.pth
```

## 2. 使用 Python 导出 ONNX

### 2.1 安装依赖

建议使用独立虚拟环境：

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install -r tools/requirements.txt
```

如果你的平台安装 PyTorch 需要专用源或专用 wheel，请先按 PyTorch 官方指引安装 `torch`，再执行上面的 `pip install -r tools/requirements.txt`。

### 2.2 导出命令

```bash
python tools/export_onnx.py \
  --weights models/u2netp.pth \
  --output models/u2netp.onnx \
  --input-size 320 \
  --opset 11
```

说明：

- 输入尺寸固定为 `1 x 3 x 320 x 320`
- 默认导出 `opset=11`
- 导出的 ONNX 只保留主输出 `saliency`，更适合 OpenCV `cv::dnn` 部署

## 3. 编译 C++ Demo

### 通用要求

- CMake >= 3.16
- 支持 C++17 的编译器
- OpenCV 4.x，且包含 `dnn` 模块

项目的 `CMakeLists.txt` 使用 `find_package(OpenCV REQUIRED)` 动态查找依赖，没有写死任何平台路径。如果 CMake 没有自动找到 OpenCV，请通过你自己的安装方式传入 `CMAKE_PREFIX_PATH`、`OpenCV_DIR` 或工具链文件。

### macOS

Intel 和 Apple Silicon 都可以使用同一套 CMake 工程。若通过 Homebrew 安装 OpenCV：

```bash
brew install opencv
cmake -S . -B build -DCMAKE_PREFIX_PATH="$(brew --prefix opencv)"
cmake --build build -j
```

### Linux

以 Ubuntu / Debian 为例：

```bash
sudo apt update
sudo apt install -y cmake g++ libopencv-dev
cmake -S . -B build
cmake --build build -j
```

### Windows

推荐用 Visual Studio + CMake，或者通过 vcpkg 安装 OpenCV。

以 x64 为例：

```powershell
cmake -S . -B build -A x64 -DCMAKE_TOOLCHAIN_FILE=%VCPKG_ROOT%\scripts\buildsystems\vcpkg.cmake
cmake --build build --config Release
```

如果你的目标是 Windows ARM64，请把生成架构改成 `ARM64`，并安装对应架构的 OpenCV 包。

## 4. 运行单张图片 Demo

### macOS / Linux

```bash
./build/scancpp models/u2netp.onnx samples/input.jpg samples/output_scan.png
```

如果你还想保存中间结果，可以追加一个调试前缀：

```bash
./build/scancpp models/u2netp.onnx samples/input.jpg samples/output_scan.png debug/doc1
```

这会额外生成：

- `debug/doc1_mask.png`
- `debug/doc1_binary.png`
- `debug/doc1_overlay.png`
- `debug/doc1_warped.png`
- `debug/doc1_scan.png`

### Windows

```powershell
.\build\Release\scancpp.exe models\u2netp.onnx samples\input.jpg samples\output_scan.png
```

## 4.1 运行性能基准测试

如果你想测整条链路单张扫描的平均耗时，可以使用内置基准模式：

### macOS / Linux

```bash
./build/scancpp --benchmark models/u2netp.onnx example_input/IMG_7298.jpg benchmark/output_scan.png 20 3
```

参数含义：

- 第 1 个位置参数：ONNX 模型路径
- 第 2 个位置参数：输入图片路径
- 第 3 个位置参数：基准测试期间反复覆盖写入的输出图片路径
- 第 4 个位置参数：正式统计次数，默认 `20`
- 第 5 个位置参数：预热次数，默认 `3`

输出结果会包含：

- `Cold start total ms`：从模型加载开始，到读图、推理、后处理和写盘完成的首次完整耗时
- `avg read ms`：平均读图耗时
- `avg infer ms`：平均 ONNX 推理耗时
- `avg postprocess ms`：平均轮廓提取、透视矫正、扫描增强耗时
- `avg write ms`：平均写盘耗时
- `avg total ms`：整条链路平均总耗时

### Windows

```powershell
.\build\Release\scancpp.exe --benchmark models\u2netp.onnx example_input\IMG_7298.jpg benchmark\output_scan.png 20 3
```

## 5. C++ 实现细节

`src/main.cpp` 里实现了以下关键步骤：

- `cv::dnn::readNetFromONNX` 加载导出的 `u2netp.onnx`
- `blobFromImage` 之前先做 `RGB + ImageNet mean/std` 归一化，和原始 PyTorch 推理习惯保持一致
- 对显著性主输出做缩放和 Otsu 二值化
- `findContours` 提取最大外轮廓，并使用 `approxPolyDP` 优先逼近 4 点，必要时退回 `minAreaRect`
- 对四点进行 `左上 / 右上 / 右下 / 左下` 排序后，使用 `getPerspectiveTransform` + `warpPerspective` 拉平纸张
- 对拉平后的图像做形态学背景估计、去阴影、归一化和自适应阈值化，得到黑白扫描件

## 6. 跨平台注意事项

- 本项目没有使用 `Windows.h`、POSIX 专有系统调用或架构特定 SIMD 代码。
- 只要目标平台有兼容的 OpenCV 4.x 和标准 C++17 工具链，就可以在 `x86_64` 与 `ARM64` 上构建。
- 当前默认使用 OpenCV DNN 的 CPU 后端，部署行为在不同平台上更一致，也更适合后续封装进 Electron。

## 7. 后续集成建议

如果你下一步要把它封装给 Electron 调用，建议优先做这两件事：

1. 把 `scanDocument(...)` 这条 Pipeline 抽成单独库接口，而不是只保留 CLI。
2. 在 Node-API 或 Electron 原生模块层只传入三个参数：模型路径、输入图片路径、输出图片路径，保持宿主层尽量薄。
