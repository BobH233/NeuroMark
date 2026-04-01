cmake_minimum_required(VERSION 3.16)
cmake_policy(SET CMP0077 NEW)

project(scancpp VERSION 0.1.0 LANGUAGES CXX)

if(NOT CMAKE_CONFIGURATION_TYPES AND NOT CMAKE_BUILD_TYPE)
    set(CMAKE_BUILD_TYPE Release CACHE STRING "Build type" FORCE)
    set_property(CACHE CMAKE_BUILD_TYPE PROPERTY STRINGS Debug Release RelWithDebInfo MinSizeRel)
endif()

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

if(MSVC)
    set(CMAKE_MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>DLL")
endif()

option(SCANCPP_BUILD_CLI "Build the scancpp CLI executable" ON)
option(SCANCPP_BUILD_NODE_ADDON "Build the scancpp Node-API addon" ON)
set(NODEJS_EXECUTABLE "node" CACHE STRING "Node.js executable used to resolve Node-API include directories")

set(SCANCPP_DEFAULT_OPENCV_PROVIDER "system")
if(EXISTS "${CMAKE_SOURCE_DIR}/third_party/opencv/CMakeLists.txt")
    set(SCANCPP_DEFAULT_OPENCV_PROVIDER "bundled-static")
endif()

set(SCANCPP_OPENCV_PROVIDER "${SCANCPP_DEFAULT_OPENCV_PROVIDER}" CACHE STRING "How to provide OpenCV: system or bundled-static")
set_property(CACHE SCANCPP_OPENCV_PROVIDER PROPERTY STRINGS system bundled-static)
set(SCANCPP_OPENCV_VERSION "4.13.0" CACHE STRING "OpenCV version to fetch in bundled-static mode")
set(SCANCPP_OPENCV_SOURCE_DIR "" CACHE PATH "Optional local OpenCV source tree used by bundled-static mode")

set(SCANCPP_OPENCV_TARGETS
    opencv_core
    opencv_imgproc
    opencv_imgcodecs
    opencv_dnn
)
set(SCANCPP_OPENCV_INCLUDE_DIRS "")

if(SCANCPP_OPENCV_PROVIDER STREQUAL "system")
    find_package(OpenCV REQUIRED COMPONENTS core imgproc imgcodecs dnn)
    set(SCANCPP_OPENCV_INCLUDE_DIRS ${OpenCV_INCLUDE_DIRS})
elseif(SCANCPP_OPENCV_PROVIDER STREQUAL "bundled-static")
    include(FetchContent)

    if(NOT SCANCPP_OPENCV_SOURCE_DIR AND EXISTS "${CMAKE_SOURCE_DIR}/third_party/opencv/CMakeLists.txt")
        set(SCANCPP_OPENCV_SOURCE_DIR "${CMAKE_SOURCE_DIR}/third_party/opencv")
    endif()

    if(APPLE AND EXISTS "/usr/bin/python3")
        set(PYTHON_EXECUTABLE "/usr/bin/python3" CACHE FILEPATH "" FORCE)
        set(PYTHON3_EXECUTABLE "/usr/bin/python3" CACHE FILEPATH "" FORCE)
        set(PYTHON_DEFAULT_EXECUTABLE "/usr/bin/python3" CACHE FILEPATH "" FORCE)
        set(Python3_EXECUTABLE "/usr/bin/python3" CACHE FILEPATH "" FORCE)
    endif()

    set(BUILD_SHARED_LIBS OFF CACHE BOOL "" FORCE)
    set(BUILD_LIST "core,imgproc,imgcodecs,dnn" CACHE STRING "" FORCE)
    set(BUILD_opencv_world OFF CACHE BOOL "" FORCE)
    set(BUILD_opencv_apps OFF CACHE BOOL "" FORCE)
    set(BUILD_TESTS OFF CACHE BOOL "" FORCE)
    set(BUILD_PERF_TESTS OFF CACHE BOOL "" FORCE)
    set(BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
    set(BUILD_DOCS OFF CACHE BOOL "" FORCE)
    set(BUILD_JAVA OFF CACHE BOOL "" FORCE)
    set(BUILD_opencv_python2 OFF CACHE BOOL "" FORCE)
    set(BUILD_opencv_python3 OFF CACHE BOOL "" FORCE)
    set(BUILD_ZLIB ON CACHE BOOL "" FORCE)
    set(BUILD_JPEG ON CACHE BOOL "" FORCE)
    set(BUILD_PNG ON CACHE BOOL "" FORCE)
    set(BUILD_PROTOBUF ON CACHE BOOL "" FORCE)
    set(ENABLE_PIC ON CACHE BOOL "" FORCE)
    if(MSVC)
        set(BUILD_WITH_STATIC_CRT OFF CACHE BOOL "" FORCE)
    endif()

    set(WITH_OPENCL OFF CACHE BOOL "" FORCE)
    set(WITH_OPENVINO OFF CACHE BOOL "" FORCE)
    set(WITH_INF_ENGINE OFF CACHE BOOL "" FORCE)
    set(WITH_NGRAPH OFF CACHE BOOL "" FORCE)
    set(WITH_CUDA OFF CACHE BOOL "" FORCE)
    set(WITH_FFMPEG OFF CACHE BOOL "" FORCE)
    set(WITH_GSTREAMER OFF CACHE BOOL "" FORCE)
    set(WITH_IPP OFF CACHE BOOL "" FORCE)
    set(WITH_ITT OFF CACHE BOOL "" FORCE)
    set(WITH_KLEIDICV OFF CACHE BOOL "" FORCE)
    set(WITH_VTK OFF CACHE BOOL "" FORCE)
    set(WITH_OPENGL OFF CACHE BOOL "" FORCE)
    set(WITH_TBB OFF CACHE BOOL "" FORCE)
    set(WITH_JPEG ON CACHE BOOL "" FORCE)
    set(WITH_PNG ON CACHE BOOL "" FORCE)
    set(WITH_TIFF OFF CACHE BOOL "" FORCE)
    set(WITH_WEBP OFF CACHE BOOL "" FORCE)
    set(WITH_OPENJPEG OFF CACHE BOOL "" FORCE)
    set(WITH_JASPER OFF CACHE BOOL "" FORCE)
    set(WITH_OPENEXR OFF CACHE BOOL "" FORCE)
    set(WITH_JPEGXL OFF CACHE BOOL "" FORCE)
    set(WITH_AVIF OFF CACHE BOOL "" FORCE)
    set(WITH_PROTOBUF ON CACHE BOOL "" FORCE)

    if(SCANCPP_OPENCV_SOURCE_DIR)
        if(NOT EXISTS "${SCANCPP_OPENCV_SOURCE_DIR}/CMakeLists.txt")
            message(FATAL_ERROR "SCANCPP_OPENCV_SOURCE_DIR does not look like an OpenCV source tree: ${SCANCPP_OPENCV_SOURCE_DIR}")
        endif()

        add_subdirectory(
            "${SCANCPP_OPENCV_SOURCE_DIR}"
            "${CMAKE_BINARY_DIR}/_deps/opencv-build"
            EXCLUDE_FROM_ALL
        )
    else()
        FetchContent_Declare(
            opencv
            URL "https://github.com/opencv/opencv/archive/refs/tags/${SCANCPP_OPENCV_VERSION}.tar.gz"
            DOWNLOAD_EXTRACT_TIMESTAMP TRUE
        )
        FetchContent_MakeAvailable(opencv)
    endif()

    set(SCANCPP_OPENCV_INCLUDE_DIRS
        "${CMAKE_BINARY_DIR}"
        "${SCANCPP_OPENCV_SOURCE_DIR}/modules/core/include"
        "${SCANCPP_OPENCV_SOURCE_DIR}/modules/imgproc/include"
        "${SCANCPP_OPENCV_SOURCE_DIR}/modules/imgcodecs/include"
        "${SCANCPP_OPENCV_SOURCE_DIR}/modules/dnn/include"
    )
else()
    message(FATAL_ERROR "Unsupported SCANCPP_OPENCV_PROVIDER='${SCANCPP_OPENCV_PROVIDER}'. Use 'system' or 'bundled-static'.")
endif()

if(DEFINED OpenCV_VERSION AND OpenCV_VERSION VERSION_LESS 4.0.0)
    message(FATAL_ERROR "OpenCV 4.x or newer is required.")
endif()

add_library(scancpp_core STATIC
    src/scanner.cpp
)

target_link_libraries(scancpp_core PRIVATE ${SCANCPP_OPENCV_TARGETS})
target_include_directories(scancpp_core
    PUBLIC
        "${CMAKE_CURRENT_SOURCE_DIR}/src"
    PRIVATE
        ${SCANCPP_OPENCV_INCLUDE_DIRS}
)

if(MSVC)
    target_compile_options(scancpp_core PRIVATE /W4 /permissive-)
else()
    target_compile_options(scancpp_core PRIVATE -Wall -Wextra -Wpedantic)
endif()

if(SCANCPP_BUILD_CLI)
    add_executable(scancpp
        src/main.cpp
    )

    target_link_libraries(scancpp PRIVATE scancpp_core ${SCANCPP_OPENCV_TARGETS})
    target_include_directories(scancpp PRIVATE ${SCANCPP_OPENCV_INCLUDE_DIRS})

    if(MSVC)
        target_compile_options(scancpp PRIVATE /W4 /permissive-)
    else()
        target_compile_options(scancpp PRIVATE -Wall -Wextra -Wpedantic)
    endif()
endif()

if(SCANCPP_BUILD_NODE_ADDON)
    execute_process(
        COMMAND "${NODEJS_EXECUTABLE}" -p "require('node-addon-api').include"
        WORKING_DIRECTORY "${CMAKE_CURRENT_SOURCE_DIR}"
        OUTPUT_VARIABLE NODE_ADDON_API_INCLUDE_RAW
        RESULT_VARIABLE NODE_ADDON_API_RESULT
        OUTPUT_STRIP_TRAILING_WHITESPACE
    )
    if(NODE_ADDON_API_RESULT)
        message(FATAL_ERROR "Failed to resolve node-addon-api include path with ${NODEJS_EXECUTABLE}.")
    endif()
    string(REPLACE "\"" "" NODE_ADDON_API_INCLUDE_DIR "${NODE_ADDON_API_INCLUDE_RAW}")

    find_path(
        NODE_API_INCLUDE_DIR
        node_api.h
        HINTS
            "$ENV{npm_config_nodedir}/include/node"
            "$ENV{npm_config_nodedir}"
            "/opt/homebrew/include/node"
            "/usr/local/include/node"
            "${CMAKE_CURRENT_SOURCE_DIR}/../../node_modules/node/include/node"
    )
    if(NOT NODE_API_INCLUDE_DIR)
        message(FATAL_ERROR "Could not find node_api.h. Set npm_config_nodedir or install Node headers.")
    endif()

    add_library(scancpp_node MODULE
        src/node_addon.cpp
    )

    target_link_libraries(scancpp_node PRIVATE scancpp_core ${SCANCPP_OPENCV_TARGETS})
    target_include_directories(scancpp_node
        PRIVATE
            ${SCANCPP_OPENCV_INCLUDE_DIRS}
            "${NODE_ADDON_API_INCLUDE_DIR}"
            "${NODE_API_INCLUDE_DIR}"
    )
    target_compile_definitions(scancpp_node PRIVATE NAPI_VERSION=8)
    set_target_properties(scancpp_node PROPERTIES PREFIX "" SUFFIX ".node")

    if(APPLE)
        set_target_properties(scancpp_node PROPERTIES LINK_FLAGS "-undefined dynamic_lookup")
    endif()

    if(MSVC)
        target_compile_options(scancpp_node PRIVATE /W4 /permissive- /EHsc)
    else()
        target_compile_options(scancpp_node PRIVATE -Wall -Wextra -Wpedantic)
    endif()
endif()
