"""把目录送进 Windows 回收站（SHFileOperationW + FOF_ALLOWUNDO）。

为什么不用 PowerShell：Add-Type / COM 都被安全策略拦了。
这里直接调 shell32 的 SHFileOperationW —— 和 send2trash 在 Windows 上走的是同一条路，
0 表示成功；失败会返回非 0 错误码，绝不当成功。

用法：python send_to_recycle.py <路径1> [<路径2> ...]
"""
import ctypes
import ctypes.wintypes as wt
import os
import sys

FO_DELETE = 3
FOF_SILENT = 0x0004
FOF_NOCONFIRMATION = 0x0010
FOF_ALLOWUNDO = 0x0040          # ← 关键：允许撤销 = 进回收站而不是直接删
FOF_NOERRORUI = 0x0400


class SHFILEOPSTRUCTW(ctypes.Structure):
    _fields_ = [
        ("hwnd", wt.HWND),
        ("wFunc", wt.UINT),
        ("pFrom", wt.LPCWSTR),
        ("pTo", wt.LPCWSTR),
        ("fFlags", ctypes.c_uint16),
        ("fAnyOperationsAborted", wt.BOOL),
        ("hNameMappings", ctypes.c_void_p),
        ("lpszProgressTitle", wt.LPCWSTR),
    ]


def to_recycle(path):
    full = os.path.abspath(path)
    if not os.path.exists(full):
        return -1, False, "路径不存在"
    # pFrom 必须是「双空字符结尾」的多字符串，否则 shell 会读越界
    p_from = full + "\0\0"
    op = SHFILEOPSTRUCTW(
        None, FO_DELETE, p_from, None,
        FOF_ALLOWUNDO | FOF_NOCONFIRMATION | FOF_SILENT | FOF_NOERRORUI,
        False, None, None,
    )
    rc = ctypes.windll.shell32.SHFileOperationW(ctypes.byref(op))
    return rc, bool(op.fAnyOperationsAborted), ""


if __name__ == "__main__":
    for arg in sys.argv[1:]:
        rc, aborted, err = to_recycle(arg)
        gone = not os.path.exists(arg)
        print(f"{arg}\trc={rc}\taborted={aborted}\t已消失={gone}\t{err}")
