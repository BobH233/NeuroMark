#ifdef _MSC_VER
#pragma managed(push, off)

#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif

#include <windows.h>
#include <delayimp.h>
#include <string.h>

namespace {

FARPROC WINAPI load_exe_hook(unsigned int event, DelayLoadInfo* info) {
    if (event != dliNotePreLoadLibrary || info == nullptr || info->szDll == nullptr) {
        return nullptr;
    }

    if (_stricmp(info->szDll, "node.exe") != 0) {
        return nullptr;
    }

    // Electron exports the Node symbols from the host executable.
    HMODULE module = GetModuleHandleW(L"libnode.dll");
    if (module == nullptr) {
        module = GetModuleHandleW(nullptr);
    }

    return reinterpret_cast<FARPROC>(module);
}

}  // namespace

decltype(__pfnDliNotifyHook2) __pfnDliNotifyHook2 = load_exe_hook;

#pragma managed(pop)
#endif
