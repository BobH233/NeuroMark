cmake_minimum_required(VERSION 3.16)

project(scancpp VERSION 0.1.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

find_package(OpenCV REQUIRED COMPONENTS core imgproc imgcodecs dnn)

if(DEFINED OpenCV_VERSION AND OpenCV_VERSION VERSION_LESS 4.0.0)
    message(FATAL_ERROR "OpenCV 4.x or newer is required.")
endif()

add_executable(scancpp
    src/main.cpp
)

target_link_libraries(scancpp PRIVATE ${OpenCV_LIBS})
target_include_directories(scancpp PRIVATE ${OpenCV_INCLUDE_DIRS})

if(MSVC)
    target_compile_options(scancpp PRIVATE /W4 /permissive-)
else()
    target_compile_options(scancpp PRIVATE -Wall -Wextra -Wpedantic)
endif()
