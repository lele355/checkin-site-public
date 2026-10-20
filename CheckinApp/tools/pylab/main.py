#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Python 程序设计 · 简易线上教学平台
====================================
实验八  大作业二

主菜单提供 4 大功能：
    1. 课堂点名
    2. PPT 课件播放
    3. PPT 内嵌代码片段演示与运行
    4. 拓展应用代码演示

本文件是整个项目的「主体」：数据、算法、执行器、界面全部在这里，
不依赖任何第三方库，任何装了 Python 3.8+ 的机器都能直接跑。

运行方式
--------
    python main.py                 进入控制台（作业交付形态）
    python main.py --selftest      自检四大功能，用于部署后冒烟
    python main.py --json          单次 JSON 调用（供 .NET 网站调用）
    python main.py --convert a.pptx 把真实 PPT 转成 PDF 并读页数

设计说明
--------
* 功能 2 在控制台里播放的是「结构化课件」——标题、要点、讲稿、挂的片段，
  不依赖 Office/WPS，也不需要装任何转换工具；
  如果要播真实的 .pptx，走 --convert，由 LibreOffice 转成 PDF 交给网页渲染。
  这样设计的原因见报告第 08 节：浏览器内没有 PPT 渲染引擎。
* 功能 3/4 要执行代码，所以做了三层闸：入口白名单 → 片段白名单 → 运行期沙箱。
"""

import json
import os
import random
import shutil
import subprocess
import sys
import tempfile
import time
import unicodedata

# ═══════════════════════════════════════════════════════════════════════
#  第一部分：课件数据
#  数据和逻辑分开，是「模块化」这一节最直接的实践：
#  下面的常量描述「讲什么」，后面的函数描述「怎么讲、怎么跑」。
# ═══════════════════════════════════════════════════════════════════════

STUDENTS = [
    "学生01", "学生02", "学生03", "学生04", "学生05",
    "学生06", "学生07", "学生08", "学生09", "学生10",
    "学生11", "学生12", "学生13", "学生14", "学生15",
    "学生16", "学生17", "学生18", "学生19", "学生20",
    "学生21", "学生22", "学生23", "学生24", "学生25",
    "学生26", "学生27", "学生28", "学生29", "学生30",
]

# ---------------------------------------------------------------------
# 内嵌代码片段库（功能三）
# 约束：只用标准库、3 秒内跑完、不读不写文件、不联网。
# ---------------------------------------------------------------------
SNIPPETS = {
    "s01_var": {
        "title": "变量与动态类型",
        "chapter": "第2讲 基础语法",
        "code": '''name = "乐酱"
age = 20
score = 91.5
print(f"{name}今年{age}岁，Python 成绩{score}")
print("age 的类型：", type(age))

age = "二十一"                      # 同一个名字可以换一种类型
print("改成字符串后：", age, type(age).__name__)
print("说明：Python 的变量是名字，不是盒子")''',
        "expect": "变量无需声明类型；赋值是把名字绑到对象上，可以随时换绑。",
    },
    "s02_loop": {
        "title": "for 循环与 range",
        "chapter": "第4讲 循环结构",
        "code": '''total = 0
for i in range(1, 101):            # 左闭右开：1 ~ 100
    total += i
print("1+2+...+100 =", total)

for i in range(1, 10):
    print(" * " * i)               # 字符串乘法画三角''',
        "expect": "range(1,101) 取 1~100；字符串乘 n 会重复拼接。",
    },
    "s03_func": {
        "title": "函数：默认参数与多返回值",
        "chapter": "第5讲 函数",
        "code": '''def stat(nums, ndigits=2):
    """返回 (最小值, 最大值, 平均值)"""
    return min(nums), max(nums), round(sum(nums) / len(nums), ndigits)


lo, hi, avg = stat([88, 92, 79, 95, 61])
print(f"最低{lo} 最高{hi} 平均{avg}")

print(stat([1, 2, 3], 3))              # 位置实参
print(stat([1, 2, 3], ndigits=4))      # 关键字实参''',
        "expect": "函数可以一次返回多个值（本质是元组），调用处自动解包。",
    },
    "s04_dict": {
        "title": "字典统计词频",
        "chapter": "第6讲 组合数据类型",
        "code": '''text = "python is easy python is powerful python is fun"
words = text.split()

counter = {}
for w in words:
    counter[w] = counter.get(w, 0) + 1      # 计数惯用法

ranked = sorted(counter.items(), key=lambda kv: -kv[1])
for word, n in ranked:
    print(f"{word:<10}{n:>2} 次")''',
        "expect": "dict.get(k, 0) 计数；sorted 的 key 支持 lambda。",
    },
    "s05_class": {
        "title": "类、继承与方法重写",
        "chapter": "第8讲 面向对象",
        "code": '''class Student:
    def __init__(self, name, score):
        self.name = name
        self.score = score

    def level(self):
        if self.score >= 90:
            return "优秀"
        return "合格" if self.score >= 60 else "待补考"


class Monitor(Student):                 # 班长继承学生
    def __init__(self, name, score, duty):
        super().__init__(name, score)   # 复用父类初始化
        self.duty = duty

    def level(self):                    # 重写父类方法
        return super().level() + "（" + self.duty + "）"


for s in [Student("学生01", 93), Monitor("学生09", 88, "学习委员"), Student("学生30", 55)]:
    print(f"{s.name:<6}{s.level()}")''',
        "expect": "继承 + super() + 方法重写，是本课程面向对象的核心考点。",
    },
    "s06_error": {
        "title": "异常捕获 try/except/finally",
        "chapter": "第9讲 异常处理",
        "code": '''def safe_div(a, b):
    try:
        return a / b
    except ZeroDivisionError:
        print("  分母不能为 0，返回 None")
        return None
    finally:
        print("  本次计算结束（finally 一定执行）")


for a, b in [(10, 2), (7, 0)]:
    print("结果 =", safe_div(a, b))''',
        "expect": "try 里出错跳到 except，finally 无论如何都会跑。",
    },
    "s07_gen": {
        "title": "生成器与 yield",
        "chapter": "第10讲 迭代器",
        "code": '''def fib(n):
    """生成前 n 个斐波那契数，惰性求值"""
    a, b = 1, 1
    for _ in range(n):
        yield a
        a, b = b, a + b


print("前 12 个：", list(fib(12)))

g = fib(10**9)                     # 十亿个也不会占内存
print("取前 8 个：", [next(g) for _ in range(8)])''',
        "expect": "含 yield 的函数返回生成器；一次只算一个，省内存。",
    },
}

# ---------------------------------------------------------------------
# 外部片段库（可选）：同目录的 snippets_extra.json
#
# 换一批教学例子时只改 JSON，不动代码 —— 这是本模块「数据与逻辑分开」的第三处实践
# （前两处：SNIPPETS / SLIDES 常量本身、命令行版与网页版共用一份 main.py）。
#
# 格式：{"id": {"title": 标题, "chapter": 分类, "code": 源码, "expect": 一句话预期}}
# 约束：id 只用 [a-z0-9_]；进来的代码照样过三道闸（白名单 + 禁网 + 禁写 + 3 秒），
#       所以「能不能跑」由沙箱自己判定，JSON 里写错了也不会变成后门。
# 文件不存在时静默跳过，控制台版照样能用。
# ---------------------------------------------------------------------
SNIPPETS_EXTRA_FILE = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "snippets_extra.json")


def load_extra_snippets(path=None):
    """把外部 JSON 合并进 SNIPPETS，返回真正加载了几条。

    同 id 不覆盖内建片段：内建那 7 条是配套课件页的（SLIDES 里按 id 挂好了），
    被外部文件顶掉会让课件翻到某页时「挂的片段不见了」。
    """
    path = path or SNIPPETS_EXTRA_FILE
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return 0
    if not isinstance(data, dict):
        return 0

    added = 0
    for sid, meta in data.items():
        if not isinstance(meta, dict):
            continue
        code = meta.get("code")
        if not isinstance(code, str) or not code.strip():
            continue
        if sid in SNIPPETS:
            continue
        SNIPPETS[sid] = {
            "title": str(meta.get("title") or sid),
            "chapter": str(meta.get("chapter") or "外部示例"),
            "code": code,
            "expect": str(meta.get("expect") or ""),
        }
        added += 1
    return added


EXTRA_SNIPPET_COUNT = load_extra_snippets()

# ---------------------------------------------------------------------
# 课件（功能二）
# 每页可挂一个片段 id，播放到该页即可现场运行（功能三）。
# ---------------------------------------------------------------------
SLIDES = [
    {
        "title": "Python 程序设计 · 第 10 讲",
        "subtitle": "组合数据类型与函数进阶",
        "bullets": [
            "本讲目标：把零散语法串成能解决实际问题的程序",
            "课堂流程：点名 → 课件 → 片段演示 → 拓展案例",
            "约定：每个片段都可以现场改一行再跑，看输出怎么变",
        ],
        "snippet": None,
        "note": "开场先说明互动方式：随时可以要求改代码重跑。",
    },
    {
        "title": "回顾：变量与类型",
        "subtitle": "一切皆对象",
        "bullets": [
            "变量是名字，不是盒子；赋值是把名字绑到对象上",
            "type() 看类型，id() 看身份",
            "f-string 是目前最推荐的格式化写法",
        ],
        "snippet": "s01_var",
        "note": "强调「动态类型」不是「没有类型」，运行时照样有类型检查。",
    },
    {
        "title": "循环：把重复劳动交给机器",
        "subtitle": "for / range / 累加器",
        "bullets": [
            "range(start, stop) 左闭右开，是高频错点",
            "累加器模式：先定义初值，再在循环里更新",
            "字符串乘法常用来画图形、做分隔线",
        ],
        "snippet": "s02_loop",
        "note": "让学生先猜结果再运行，落差记忆更牢。",
    },
    {
        "title": "函数：可复用的最小单位",
        "subtitle": "参数、返回值、默认值",
        "bullets": [
            "默认参数只在定义时求值一次（可变默认值是经典坑）",
            "返回多个值其实是返回元组",
            "关键字实参让调用处更好读",
        ],
        "snippet": "s03_func",
        "note": "补充讲可变默认参数：def f(x, acc=[]) 会跨调用共享。",
    },
    {
        "title": "字典：按键取值的高效容器",
        "subtitle": "词频统计是万能例子",
        "bullets": [
            "dict.get(key, default) 一次取值加兜底",
            "sorted(items, key=...) 是排序的通用入口",
            "lambda 适合写一行小函数",
        ],
        "snippet": "s04_dict",
        "note": "可现场把 text 换成中文句子，讲 split 的空格假设。",
    },
    {
        "title": "面向对象：类、继承、重写",
        "subtitle": "把数据和行为打包",
        "bullets": [
            "__init__ 初始化，self 是实例自己",
            "super().__init__() 复用父类逻辑",
            "重写让同一接口有不同表现，是多态的雏形",
        ],
        "snippet": "s05_class",
        "note": "这道题几乎是期末必考的类设计题原型。",
    },
    {
        "title": "异常处理：让程序优雅地失败",
        "subtitle": "try / except / finally",
        "bullets": [
            "只捕获你真正预期的异常类型",
            "finally 用于释放资源，一定会执行",
            "不要写裸 except:，它会把 Ctrl+C 也吞掉",
        ],
        "snippet": "s06_error",
        "note": "强调「不要用异常做流程控制」。",
    },
    {
        "title": "迭代器与生成器",
        "subtitle": "惰性求值，省内存",
        "bullets": [
            "含 yield 的函数调用后返回生成器对象",
            "next() 一次取一个，取完抛 StopIteration",
            "生成器表达式 (x for x in ...) 与列表推导的区别",
        ],
        "snippet": "s07_gen",
        "note": "用「无限序列也能装进内存」这个反直觉点收尾。",
    },
    {
        "title": "小结与作业",
        "subtitle": "本讲四件事",
        "bullets": [
            "组合数据类型是解决实际问题的骨架",
            "函数负责复用，类负责建模，生成器负责省资源",
            "作业：用字典统计一段文本，输出 Top3 高频词",
        ],
        "snippet": None,
        "note": "留 3 分钟答疑，然后进拓展案例。",
    },
]

# ---------------------------------------------------------------------
# 拓展应用案例（功能四）
# ---------------------------------------------------------------------
EXTENSIONS = {
    "e01_grade": {
        "title": "成绩分析报表",
        "tag": "综合应用",
        "code": '''scores = {"学生01": 93, "学生09": 88, "学生30": 55, "学生08": 76, "学生13": 91}

avg = sum(scores.values()) / len(scores)
print(f"班级平均分：{avg:.2f}")

rank = sorted(scores.items(), key=lambda kv: kv[1], reverse=True)
print()
print("排名：")
for i, (name, sc) in enumerate(rank, start=1):
    print(f"  第{i}名  {name:<6}{sc}分")

bands = {"优秀(90+)": 0, "良好(75-89)": 0, "及格(60-74)": 0, "不及格": 0}
for sc in scores.values():
    if sc >= 90:
        bands["优秀(90+)"] += 1
    elif sc >= 75:
        bands["良好(75-89)"] += 1
    elif sc >= 60:
        bands["及格(60-74)"] += 1
    else:
        bands["不及格"] += 1

print()
print("分数段分布：")
for k, v in bands.items():
    print(f"  {k:<12}{'#' * v} ({v}人)")''',
        "expect": "一个案例同时用到字典、排序、f-string 对齐、字符画，适合当期末题。",
    },
    "e02_caesar": {
        "title": "凯撒密码（字符串与 ord/chr）",
        "tag": "算法思维",
        "code": '''def caesar(text, shift):
    out = []
    for ch in text:
        if ch.isalpha():
            base = ord("A") if ch.isupper() else ord("a")
            out.append(chr((ord(ch) - base + shift) % 26 + base))
        else:
            out.append(ch)
    return "".join(out)


msg = "Python Is Fun 2026"
enc = caesar(msg, 3)
print("原文：", msg)
print("加密：", enc)
print("解密：", caesar(enc, -3))
print("往返一致：", caesar(enc, -3) == msg)''',
        "expect": "ASCII 位移加取模回绕，字符串与内置函数结合的经典练习。",
    },
    "e03_json": {
        "title": "JSON 序列化（数据交换格式）",
        "tag": "工程实践",
        "code": '''import json

record = {
    "student": "学生01",
    "scores": [93, 88, 76],
    "tags": ["工业工程", "Python"],
    "active": True,
}

text = json.dumps(record, ensure_ascii=False, indent=2)
print("序列化后：")
print(text)

back = json.loads(text)
print()
print("反序列化：", back["student"], sum(back["scores"]) / len(back["scores"]))''',
        "expect": "ensure_ascii=False 才不会把中文转成一堆 \\uXXXX。",
    },
    "e04_seed": {
        "title": "可复现的随机（random.seed）",
        "tag": "调试技巧",
        "code": '''import random


def sample(seed=None):
    random.seed(seed)                 # 固定种子，每次都一样
    return [random.randint(60, 100) for _ in range(6)]


print("种子 42：", sample(42))
print("种子 42：", sample(42))
print("不设种子：", sample())''',
        "expect": "固定种子让偶发 bug 可以复现，是调试随机问题的第一步。",
    },
}

# 沙箱放行的标准库：只给教学需要的那几个，外加它们内部依赖的底层模块。
# 刻意不放行 os / sys / socket / subprocess / shutil / pathlib / ctypes / importlib。
ALLOWED_MODULES = (
    "math", "random", "datetime", "json", "string", "re",
    "itertools", "collections", "functools", "statistics", "time",
    "decimal", "fractions", "numbers", "enum", "types", "warnings",
    "codecs", "io", "copyreg", "operator", "keyword", "heapq",
    "bisect", "reprlib", "weakref", "unicodedata", "textwrap",
    "difflib", "pprint", "cmath",
)

MAX_OUTPUT_CHARS = 6000


# ═══════════════════════════════════════════════════════════════════════
#  第二部分：代码执行器（功能三/四的引擎）
#
#  这是整个项目唯一「有风险」的地方，所以做了三道闸：
#    1) 入口白名单：调用方只能传片段 id，不传代码；
#    2) 片段白名单：id 查不到就拒绝，绝不执行任意字符串；
#    3) 运行期沙箱：独立子进程 + 受限 import + 禁网 + 禁写 + 硬超时。
#
#  注意：这是「教学级」沙箱，不是「生产级」。真正的强隔离要靠容器、
#  独立低权用户、只读文件系统。本模块定位是课堂演示。
# ═══════════════════════════════════════════════════════════════════════

# 子进程里的「监工」：先装闸，再读源码、exec。
# 用字符串常量而不是格式化模板，避免和用户代码里的花括号打架。
_HARNESS_SOURCE = '''import builtins
import os
import sys

_ALLOWED = __ALLOWED__

_real_import = builtins.__import__


def _guard_import(name, *args, **kwargs):
    if name.split(".")[0] not in _ALLOWED:
        raise ImportError("沙箱限制：课堂上不允许导入 " + name)
    return _real_import(name, *args, **kwargs)


builtins.__import__ = _guard_import

# 禁网：用 _real_import 拿到 socket，否则它自己会被上面的闸拦住
try:
    _socket = _real_import("socket")

    def _no_net(*args, **kwargs):
        raise PermissionError("沙箱限制：课堂上不允许访问网络")

    _socket.socket = _no_net
    _socket.create_connection = _no_net
except Exception:
    pass

# 禁写文件
_real_open = builtins.open


def _guard_open(file, mode="r", *args, **kwargs):
    if any(ch in mode for ch in "wax+"):
        raise PermissionError("沙箱限制：课堂上不允许写文件")
    return _real_open(file, mode, *args, **kwargs)


builtins.open = _guard_open

_snippet_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "snippet.py")
with _real_open(_snippet_path, "r", encoding="utf-8") as _f:
    _source = _f.read()

_globals = {"__name__": "__main__", "__file__": "<snippet>"}
exec(compile(_source, "<snippet>", "exec"), _globals)
'''


def run_code(code, timeout=3.0):
    """在隔离子进程里执行一段代码，返回结构化结果，永远不抛异常。

    返回字典：ok / output / error / duration_ms / exit_code / truncated
    """
    started = time.perf_counter()

    with tempfile.TemporaryDirectory(prefix="pylab-") as workdir:
        snippet_path = os.path.join(workdir, "snippet.py")
        harness_path = os.path.join(workdir, "_harness.py")

        with open(snippet_path, "w", encoding="utf-8") as f:
            f.write(code)
        with open(harness_path, "w", encoding="utf-8") as f:
            f.write(_HARNESS_SOURCE.replace("__ALLOWED__", repr(ALLOWED_MODULES)))

        # 最小环境：不传 PYTHONPATH，避免用户 site-packages 干扰结果
        env = {
            "PYTHONIOENCODING": "utf-8",
            "PYTHONUTF8": "1",
            "PYTHONDONTWRITEBYTECODE": "1",
        }
        if os.name == "nt":
            env["SYSTEMROOT"] = os.environ.get("SYSTEMROOT", r"C:\Windows")
            env["PATH"] = os.environ.get("PATH", "")
        else:
            env["PATH"] = "/usr/local/bin:/usr/bin:/bin"
            env["LANG"] = "C.UTF-8"

        try:
            proc = subprocess.run(
                [sys.executable, "-X", "utf8", "-I", harness_path],
                cwd=workdir,
                env=env,
                capture_output=True,
                timeout=timeout,
                text=True,
                encoding="utf-8",
                errors="replace",
            )
            out, err, code_ = proc.stdout, proc.stderr, proc.returncode
        except subprocess.TimeoutExpired as exc:
            out = exc.stdout or ""
            if isinstance(out, bytes):
                out = out.decode("utf-8", "replace")
            err = "运行超时（超过 %g 秒），已强制终止。请检查是否有死循环。" % timeout
            code_ = -9
        except OSError as exc:
            out, err, code_ = "", "无法启动 Python 解释器：%s" % exc, -1

    duration = int((time.perf_counter() - started) * 1000)
    truncated = False
    if len(out) > MAX_OUTPUT_CHARS:
        out = out[:MAX_OUTPUT_CHARS] + "\n...（输出过长，已截断）"
        truncated = True
    if len(err) > MAX_OUTPUT_CHARS:
        err = err[:MAX_OUTPUT_CHARS] + "\n...（已截断）"
        truncated = True

    return {
        "ok": code_ == 0,
        "output": out.rstrip("\n"),
        "error": err.strip(),
        "durationMs": duration,
        "exitCode": code_,
        "truncated": truncated,
    }


# ═══════════════════════════════════════════════════════════════════════
#  第三部分：课堂点名（功能一）
#
#  核心是「不重复抽样」：抽到就从池子里拿走，而不是反复随机直到不重复
#  （后者在名单小的时候会卡）。抽完自动开新一轮，并告知调用方。
# ═══════════════════════════════════════════════════════════════════════

class Roster:
    def __init__(self, students=None, seed=None):
        self.students = list(students or STUDENTS)
        self.rng = random.Random(seed)
        self.remaining = list(self.students)
        self.called = []
        self.round = 1
        self.attendance = {}          # 姓名 -> {"present":n,"late":n,"absent":n}

    # ---------------- 状态存取 ----------------
    def to_state(self):
        return {
            "students": self.students,
            "remaining": self.remaining,
            "called": self.called,
            "round": self.round,
            "attendance": {k: dict(v) for k, v in self.attendance.items()},
        }

    def load_state(self, state):
        if not state:
            return self
        if state.get("students"):
            self.students = list(state["students"])
        remain = [s for s in state.get("remaining", self.students) if s in self.students]
        self.remaining = remain
        self.called = [s for s in state.get("called", []) if s in self.students]
        self.round = int(state.get("round", 1) or 1)
        self.attendance = {k: dict(v) for k, v in (state.get("attendance") or {}).items()}
        return self

    # ---------------- 点名 ----------------
    def pick(self, count=1):
        count = max(1, min(int(count), 10))
        if not self.students:
            return {"picked": [], "round": self.round, "wrapped": False,
                    "remaining": 0, "total": 0, "calledCount": 0,
                    "message": "名单为空，请先导入班级名单"}

        picked = []
        wrapped = False
        for _ in range(count):
            if not self.remaining:
                self.remaining = list(self.students)
                self.round += 1
                wrapped = True
            who = self.rng.choice(self.remaining)
            self.remaining.remove(who)
            self.called.append(who)
            picked.append(who)

        return {
            "picked": picked,
            "round": self.round,
            "wrapped": wrapped,
            "remaining": len(self.remaining),
            "total": len(self.students),
            "calledCount": len(self.called),
        }

    def reset(self):
        self.remaining = list(self.students)
        self.called = []
        self.round = 1

    # ---------------- 考勤 ----------------
    def mark(self, name, status="present"):
        if name not in self.students:
            raise ValueError("名单里没有「%s」" % name)
        if status not in ("present", "late", "absent"):
            raise ValueError("status 只能是 present / late / absent")
        rec = self.attendance.setdefault(name, {})
        rec[status] = rec.get(status, 0) + 1
        return self.summary()

    def summary(self):
        rows = []
        for name in self.students:
            rec = self.attendance.get(name, {})
            total = sum(rec.values())
            rows.append({
                "name": name,
                "present": rec.get("present", 0),
                "late": rec.get("late", 0),
                "absent": rec.get("absent", 0),
                "total": total,
                # 分母用「这个人被打过卡的次数」，避免没打卡的人被算成 0%
                "rate": round(rec.get("present", 0) / total * 100, 1) if total else None,
            })
        marked = [r for r in rows if r["total"]]
        avg = round(sum(r["rate"] for r in marked) / len(marked), 1) if marked else None
        return {"rows": rows, "avgRate": avg, "markedCount": len(marked)}


# ═══════════════════════════════════════════════════════════════════════
#  第四部分：课件（功能二）
#
#  课件是「结构化数据」：标题 / 副标题 / 要点 / 讲稿 / 挂的片段 id。
#  这样既能打印成终端幻灯片，也能序列化成 JSON 给网页渲染，
#  而且页码是确定的——第 N 页就是第 N 条，永远对得上（关键）。
# ═══════════════════════════════════════════════════════════════════════

class Deck:
    def __init__(self, slides=None):
        self.slides = list(slides or SLIDES)
        self.index = 0

    def count(self):
        return len(self.slides)

    def at(self, index=None):
        idx = self.index if index is None else int(index)
        idx = max(0, min(idx, self.count() - 1))
        self.index = idx
        page = dict(self.slides[idx])
        page["index"] = idx
        page["pageNo"] = idx + 1
        page["total"] = self.count()
        page["hasSnippet"] = bool(page.get("snippet"))

        # 顺手把片段的标题带上：网页右侧面板就不用再发一次请求了，
        # 也避免了「先闪一下 id 再变标题」。
        sid = page.get("snippet")
        meta = SNIPPETS.get(sid) if sid else None
        page["snippetTitle"] = meta["title"] if meta else ""
        page["snippetChapter"] = meta["chapter"] if meta else ""
        return page

    def goto(self, direction="next"):
        if direction == "next":
            self.index = min(self.index + 1, self.count() - 1)
        elif direction in ("prev", "back"):
            self.index = max(self.index - 1, 0)
        elif direction == "first":
            self.index = 0
        elif direction == "last":
            self.index = self.count() - 1
        else:
            raise ValueError("未知翻页方向：%s" % direction)
        return self.at()

    def outline(self):
        return [
            {"index": i, "pageNo": i + 1, "title": s["title"],
             "subtitle": s.get("subtitle", ""), "snippet": s.get("snippet")}
            for i, s in enumerate(self.slides)
        ]

    def snippets_on_page(self, page_no):
        """给网页用：第 N 页挂了哪些片段。"""
        idx = int(page_no) - 1
        if not 0 <= idx < self.count():
            return []
        sid = self.slides[idx].get("snippet")
        return [sid] if sid else []


# ═══════════════════════════════════════════════════════════════════════
#  第五部分：真实 PPT 转换（pptx -> pdf）
#
#  Python 在这里是「调度员 + 记账员」：真正干活的是 LibreOffice，
#  Python 负责找它、给它干净的环境、算哈希、读页数、落盘、报错。
#  找不到 LibreOffice 时明确降级，而不是假装成功。
# ═══════════════════════════════════════════════════════════════════════

def find_soffice():
    """按优先级找 LibreOffice 的可执行文件，找不到返回 None。"""
    candidates = []

    for name in ("soffice", "soffice.exe", "libreoffice"):
        found = shutil.which(name)
        if found:
            candidates.append(found)

    if os.name == "nt":
        for base in (r"C:\Program Files\LibreOffice\program\soffice.exe",
                     r"C:\Program Files (x86)\LibreOffice\program\soffice.exe"):
            if os.path.exists(base):
                candidates.append(base)
    else:
        for base in ("/usr/bin/soffice", "/usr/lib/libreoffice/program/soffice"):
            if os.path.exists(base):
                candidates.append(base)

    return candidates[0] if candidates else None


def pdf_page_count(pdf_path):
    """读 PDF 页数：优先 pdfinfo，退化为数 /Type /Page。读不到返回 None。"""
    if shutil.which("pdfinfo"):
        try:
            proc = subprocess.run([shutil.which("pdfinfo"), pdf_path],
                                  capture_output=True, text=True, timeout=20)
            for line in proc.stdout.splitlines():
                if line.lower().startswith("pages:"):
                    return int(line.split(":", 1)[1].strip())
        except Exception:
            pass

    try:
        with open(pdf_path, "rb") as f:
            data = f.read()
        # 粗略统计，够用；精确值请装 poppler-utils 用 pdfinfo
        return data.count(b"/Type /Page") - data.count(b"/Type /Pages") or None
    except Exception:
        return None


def convert_pptx(src_path, out_dir=None, timeout=120):
    """把 .pptx 转成 PDF。返回 {ok, pdfPath, pageCount, durationMs, error}。

    不抛异常：所有失败都以 ok=False + error 的形式返回，方便上层统一处理。
    """
    started = time.perf_counter()

    def fail(msg):
        return {"ok": False, "pdfPath": None, "pageCount": None,
                "durationMs": int((time.perf_counter() - started) * 1000),
                "error": msg}

    if not src_path or not os.path.isfile(src_path):
        return fail("找不到源文件：%s" % src_path)
    if not src_path.lower().endswith(".pptx"):
        return fail("只支持 .pptx（.ppt 老格式请先用 WPS 另存为 .pptx）")
    if os.path.getsize(src_path) == 0:
        return fail("文件是空的")

    soffice = find_soffice()
    if not soffice:
        return fail("本机没有安装 LibreOffice，无法转换。"
                    "Windows 可装 LibreOffice 或用 WPS 手动导出 PDF；"
                    "Ubuntu 执行 sudo apt install libreoffice-impress")

    out_dir = out_dir or os.path.dirname(os.path.abspath(src_path))
    os.makedirs(out_dir, exist_ok=True)

    # 每次给独立的 UserInstallation：LibreOffice 同一 profile 不能并发，
    # 不加这个参数，多个人同时转换会互相锁死。
    profile = tempfile.mkdtemp(prefix="lo-profile-")
    try:
        proc = subprocess.run(
            [soffice, "--headless", "--norestore", "--nolockcheck",
             "-env:UserInstallation=file:///" + profile.replace("\\", "/"),
             "--convert-to", "pdf", "--outdir", out_dir, src_path],
            capture_output=True, text=True, timeout=timeout,
            encoding="utf-8", errors="replace",
        )
    except subprocess.TimeoutExpired:
        return fail("转换超时（超过 %d 秒），文件可能过大或含复杂动画" % timeout)
    except OSError as exc:
        return fail("无法启动 LibreOffice：%s" % exc)
    finally:
        shutil.rmtree(profile, ignore_errors=True)

    pdf_name = os.path.splitext(os.path.basename(src_path))[0] + ".pdf"
    pdf_path = os.path.join(out_dir, pdf_name)

    if not os.path.isfile(pdf_path):
        detail = (proc.stderr or proc.stdout or "").strip()
        return fail("转换没有产出 PDF。" + (" LibreOffice 说：" + detail[:300] if detail else ""))

    return {
        "ok": True,
        "pdfPath": os.path.abspath(pdf_path),
        "pageCount": pdf_page_count(pdf_path),
        "durationMs": int((time.perf_counter() - started) * 1000),
        "error": "",
        "soffice": soffice,
    }


# ═══════════════════════════════════════════════════════════════════════
#  第六部分：课堂（把上面三块串起来）
# ═══════════════════════════════════════════════════════════════════════

class Classroom:
    def __init__(self, seed=None):
        self.roster = Roster(seed=seed)
        self.deck = Deck()

    # ---------------- 状态 ----------------
    def to_state(self):
        return {"roster": self.roster.to_state(), "slideIndex": self.deck.index}

    def load_state(self, state):
        if not state:
            return self
        self.roster.load_state(state.get("roster"))
        self.deck.index = max(0, min(int(state.get("slideIndex", 0) or 0),
                                    self.deck.count() - 1))
        return self

    # ---------------- 功能三 / 四 ----------------
    def snippet(self, sid):
        sn = SNIPPETS.get(sid)
        if not sn:
            raise KeyError("课件里没有片段「%s」" % sid)
        return sn

    def run_snippet(self, sid, timeout=3.0):
        sn = self.snippet(sid)          # 先过白名单，查不到就抛，绝不执行
        return {
            "id": sid,
            "title": sn["title"],
            "chapter": sn["chapter"],
            "code": sn["code"],
            "expect": sn["expect"],
            "run": run_code(sn["code"], timeout=timeout),
        }

    def extension(self, eid):
        ex = EXTENSIONS.get(eid)
        if not ex:
            raise KeyError("没有拓展案例「%s」" % eid)
        return ex

    def run_extension(self, eid, timeout=5.0):
        ex = self.extension(eid)
        return {
            "id": eid,
            "title": ex["title"],
            "tag": ex["tag"],
            "code": ex["code"],
            "expect": ex["expect"],
            "run": run_code(ex["code"], timeout=timeout),
        }


# ═══════════════════════════════════════════════════════════════════════
#  第七部分：JSON 桥
#
#  约定：请求 {"action": "...", ...}，响应 {"ok": true, "data": {...}}
#  退出码恒为 0（业务错误走 JSON），只有内部崩溃才非 0。
# ═══════════════════════════════════════════════════════════════════════

def handle(action, payload):
    """无状态分发器：入参带 state，出参回新 state。"""
    if action == "probe":
        return {"result": {
            "python": sys.version.split()[0],
            "executable": sys.executable,
            "soffice": find_soffice(),
            "canConvert": find_soffice() is not None,
        }}

    if action == "bootstrap":
        room = Classroom()
        return {"result": {
            "students": STUDENTS,
            "slides": room.deck.outline(),
            "slide": room.deck.at(0),
            "snippets": [{"id": k, "title": v["title"], "chapter": v["chapter"]}
                         for k, v in SNIPPETS.items()],
            "extensions": [{"id": k, "title": v["title"], "tag": v["tag"]}
                           for k, v in EXTENSIONS.items()],
        }}

    room = Classroom().load_state(payload.get("state"))

    if action == "pick":
        return {"result": room.roster.pick(payload.get("count", 1)),
                "state": room.to_state()}

    if action == "mark":
        return {"result": room.roster.mark(payload["name"], payload.get("status", "present")),
                "state": room.to_state()}

    if action == "attendance":
        return {"result": room.roster.summary(), "state": room.to_state()}

    if action == "reset":
        room.roster.reset()
        return {"result": {"ok": True, "message": "点名轮次已重置，考勤记录保留"},
                "state": room.to_state()}

    if action == "slide":
        return {"result": room.deck.at(payload.get("index")), "state": room.to_state()}

    if action == "goto":
        return {"result": room.deck.goto(payload.get("direction", "next")),
                "state": room.to_state()}

    if action == "outline":
        return {"result": room.deck.outline(), "state": room.to_state()}

    if action == "page_links":
        page = payload.get("page", 1)
        ids = room.deck.snippets_on_page(page)
        return {"result": {
            "page": page,
            "snippets": [{"id": i, "title": SNIPPETS[i]["title"], "chapter": SNIPPETS[i]["chapter"]}
                         for i in ids if i in SNIPPETS],
        }, "state": room.to_state()}

    if action == "snippet":
        return {"result": room.run_snippet(payload["id"], payload.get("timeout", 3.0)),
                "state": room.to_state()}

    if action == "extension":
        return {"result": room.run_extension(payload["id"], payload.get("timeout", 5.0)),
                "state": room.to_state()}

    # 只允许服务端在后台调用：会拉起 LibreOffice、读写磁盘
    if action == "convert":
        return {"result": convert_pptx(payload.get("path", ""),
                                       payload.get("outDir"),
                                       payload.get("timeout", 120)),
                "state": room.to_state()}

    raise ValueError("未知动作：%s" % action)


def run_json():
    """stdin 读一条 JSON，stdout 写一条 JSON。"""
    try:
        sys.stdin.reconfigure(encoding="utf-8")
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass

    raw = sys.stdin.read()
    if not raw.strip():
        print(json.dumps({"ok": False, "error": "请求体为空"}, ensure_ascii=False))
        return 0

    try:
        req = json.loads(raw)
        if not isinstance(req, dict):
            raise ValueError("请求必须是 JSON 对象")
        action = req.pop("action", None)
        if not action:
            raise ValueError("缺少 action 字段")
        data = handle(action, req)
        resp = {"ok": True, "data": data}
    except KeyError as exc:
        # KeyError 的 str() 会多套一层引号，这里取原始消息
        msg = exc.args[0] if exc.args and isinstance(exc.args[0], str) else str(exc)
        resp = {"ok": False, "error": msg}
    except (ValueError, TypeError) as exc:
        resp = {"ok": False, "error": str(exc)}
    except Exception as exc:                      # 兜底：绝不把栈打到 stdout
        resp = {"ok": False, "error": "内部错误：%s" % exc}

    print(json.dumps(resp, ensure_ascii=False))
    return 0


# ═══════════════════════════════════════════════════════════════════════
#  第八部分：控制台界面（作业交付形态）
# ═══════════════════════════════════════════════════════════════════════

LINE = "─" * 62


def dwidth(text):
    """终端显示宽度。

    不能简单按「ord > 127 就 2 格」算：箭头 →、中点 ·、框线 ─ 这些属于
    Unicode 的 Ambiguous 宽度，在中文终端里实际只占 1 格，按 2 算会把
    整行的右边框挤歪。这里用 east_asian_width：只有 W(宽) 和 F(全角) 算 2。
    """
    total = 0
    for ch in text:
        total += 2 if unicodedata.east_asian_width(ch) in ("W", "F") else 1
    return total


def pad(text, width, align="left"):
    """按显示宽度补齐，用于表格对齐（%-8s 对中文是按字符算的，会歪）。"""
    gap = max(0, width - dwidth(text))
    return text + " " * gap if align == "left" else " " * gap + text


def center(text, width=62):
    pad = max(0, width - dwidth(text))
    left = pad // 2
    return " " * left + text + " " * (pad - left)


def hr(title=""):
    if title:
        print("\n" + LINE + "\n  " + title + "\n" + LINE)
    else:
        print(LINE)


def ask(prompt, default=""):
    try:
        text = input(prompt).strip()
    except (EOFError, KeyboardInterrupt):
        return default
    return text or default


def render_slide(page):
    """按显示宽度画一页幻灯片。"""
    inner = 58

    def row(text=""):
        print("│ " + text + " " * max(0, inner - dwidth(text)) + "│")

    def wrap(text):
        lines, cur = [], ""
        for ch in text:
            if dwidth(cur) + dwidth(ch) > inner - 4:
                lines.append(cur)
                cur = ""
            cur += ch
        if cur:
            lines.append(cur)
        return lines or [""]

    print("\n┌" + "─" * (inner + 2) + "┐")
    row("第 %d / %d 页" % (page["pageNo"], page["total"]))
    for part in wrap(page["title"]):
        row(part)
    if page.get("subtitle"):
        for part in wrap("  " + page["subtitle"]):
            row(part)
    print("├" + "─" * (inner + 2) + "┤")
    for bullet in page["bullets"]:
        for i, part in enumerate(wrap(bullet)):
            row(("· " if i == 0 else "  ") + part)
    print("└" + "─" * (inner + 2) + "┘")
    if page["hasSnippet"]:
        print("  > 本页挂了代码片段：%s（可用功能三或 r 直接运行）" % page["snippet"])
    if page.get("note"):
        print("  > 讲稿：%s" % page["note"])


def show_run(title, expect, code, result):
    """统一打印一次运行的结果。"""
    print("\n  " + title)
    print("\n  源码：")
    for line in code.splitlines():
        print("    " + line if line.strip() else "")
    print("\n  预期：%s" % expect)
    print("\n  ── 输出 ──")
    if result["output"]:
        for line in result["output"].splitlines():
            print("  " + line)
    else:
        print("  （没有任何输出，可能忘了写 print）")
    if result["error"]:
        print("\n  ── 错误（退出码 %d）──" % result["exitCode"])
        for line in result["error"].splitlines():
            print("  " + line)
    print("\n  耗时 %d ms · %s" % (result["durationMs"], "成功" if result["ok"] else "失败"))


# ---------------- 功能一 ----------------
def menu_rollcall(room):
    while True:
        r = room.roster
        hr("功能一  课堂点名")
        print("  班级人数：%d    当前第 %d 轮    本轮剩余：%d"
              % (len(r.students), r.round, len(r.remaining)))
        print("  1) 随机点 1 人")
        print("  2) 随机点 N 人")
        print("  3) 查看名单与考勤")
        print("  4) 记考勤（出勤 / 迟到 / 缺勤）")
        print("  5) 重置轮次")
        print("  0) 返回主菜单")
        choice = ask("\n请选择 > ")

        if choice in ("1", "2"):
            if choice == "1":
                count = 1
            else:
                try:
                    count = int(ask("点几个人？> ", "3"))
                except ValueError:
                    print("  请输入数字")
                    continue
            result = r.pick(count)
            print()
            for i, name in enumerate(result["picked"], 1):
                print("  ★ 第 %d 位：%s" % (i, name))
            if result.get("wrapped"):
                print("  （上一轮已抽完，已自动开始新一轮）")
            print("  第 %d 轮 · 本轮还剩 %d/%d 人"
                  % (result["round"], result["remaining"], result["total"]))

        elif choice == "3":
            summary = r.summary()
            print()
            print("  " + pad("姓名", 10) + pad("出勤", 6, "right")
                  + pad("迟到", 6, "right") + pad("缺勤", 6, "right")
                  + pad("出勤率", 8, "right"))
            print("  " + "-" * 36)
            for row in summary["rows"]:
                rate = ("%s%%" % row["rate"]) if row["rate"] is not None else "—"
                print("  " + pad(row["name"], 10)
                      + pad(str(row["present"]), 6, "right")
                      + pad(str(row["late"]), 6, "right")
                      + pad(str(row["absent"]), 6, "right")
                      + pad(rate, 8, "right"))
            if summary["avgRate"] is not None:
                print("\n  平均出勤率：%s%%（已记录 %d 人）"
                      % (summary["avgRate"], summary["markedCount"]))
            else:
                print("\n  还没有任何考勤记录。")

        elif choice == "4":
            name = ask("姓名 > ")
            status = ask("状态（1 出勤 / 2 迟到 / 3 缺勤，默认出勤）> ", "1")
            status = {"1": "present", "2": "late", "3": "absent"}.get(status, "present")
            try:
                r.mark(name, status)
                label = {"present": "出勤", "late": "迟到", "absent": "缺勤"}.get(status, status)
                print("  √ 已记录：%s → %s" % (name, label))
            except ValueError as exc:
                print("  × %s" % exc)

        elif choice == "5":
            r.reset()
            print("  √ 点名轮次已重置（考勤记录保留）")

        elif choice == "0":
            return


# ---------------- 功能二 ----------------
def menu_slides(room):
    while True:
        page = room.deck.at()
        render_slide(page)
        print("\n  [n] 下一页   [p] 上一页   [g] 跳转   [o] 大纲")
        print("  [r] 运行本页代码   [q] 返回主菜单")
        cmd = ask("> ").lower()

        if cmd in ("n", ""):
            if room.deck.index >= room.deck.count() - 1:
                print("  已经是最后一页了。")
            else:
                room.deck.goto("next")
        elif cmd == "p":
            if room.deck.index == 0:
                print("  已经是第一页了。")
            else:
                room.deck.goto("prev")
        elif cmd == "g":
            try:
                room.deck.at(int(ask("跳到第几页 > ", "1")) - 1)
            except ValueError:
                print("  请输入数字")
        elif cmd == "o":
            print()
            for item in room.deck.outline():
                mark = "→" if item["index"] == room.deck.index else " "
                tag = "  [%s]" % item["snippet"] if item["snippet"] else ""
                print("  %s %2d. %s%s" % (mark, item["pageNo"], item["title"], tag))
            print("\n  提示：真实 .pptx 请用 --convert 转成 PDF，由网页渲染。")
        elif cmd == "r":
            if not page["hasSnippet"]:
                print("  本页没有内嵌代码片段。")
            else:
                sid = page["snippet"]
                info = room.run_snippet(sid)
                show_run(info["title"], info["expect"], info["code"], info["run"])
        elif cmd == "q":
            return


# ---------------- 功能三 ----------------
def menu_snippets(room):
    ids = list(SNIPPETS)
    while True:
        hr("功能三  PPT 内嵌代码片段演示与运行")
        for i, sid in enumerate(ids, 1):
            sn = SNIPPETS[sid]
            print("  %d) %s（%s）" % (i, pad(sn["title"], 30), sn["chapter"]))
        print("  0) 返回主菜单")
        choice = ask("\n选择片段 > ")
        if choice in ("0", ""):
            return
        try:
            sid = ids[int(choice) - 1]
        except (ValueError, IndexError):
            print("  无效选择")
            continue
        info = room.run_snippet(sid)
        show_run(info["title"], info["expect"], info["code"], info["run"])


# ---------------- 功能四 ----------------
def menu_extensions(room):
    ids = list(EXTENSIONS)
    while True:
        hr("功能四  拓展应用代码演示")
        for i, eid in enumerate(ids, 1):
            ex = EXTENSIONS[eid]
            print("  %d) [%s] %s" % (i, ex["tag"], ex["title"]))
        print("  0) 返回主菜单")
        choice = ask("\n选择案例 > ")
        if choice in ("0", ""):
            return
        try:
            eid = ids[int(choice) - 1]
        except (ValueError, IndexError):
            print("  无效选择")
            continue
        info = room.run_extension(eid)
        show_run(info["title"], info["expect"], info["code"], info["run"])


def run_console():
    try:
        sys.stdout.reconfigure(errors="replace")     # 老终端遇到生僻字符不崩
    except Exception:
        pass

    room = Classroom()
    banner = "\n".join([
        "╔" + "═" * 62 + "╗",
        "║" + center("Python 程序设计 · 简易线上教学平台") + "║",
        "║" + center("实验八 大作业二 · 核心逻辑：Python") + "║",
        "╚" + "═" * 62 + "╝",
    ])

    while True:
        print(banner)
        print("  1) 课堂点名")
        print("  2) PPT 课件播放")
        print("  3) PPT 内嵌代码片段演示与运行")
        print("  4) 拓展应用代码演示")
        print("  0) 退出")
        choice = ask("\n请选择 > ")

        if choice == "1":
            menu_rollcall(room)
        elif choice == "2":
            menu_slides(room)
        elif choice == "3":
            menu_snippets(room)
        elif choice == "4":
            menu_extensions(room)
        elif choice == "0":
            print("\n  下课，再见！\n")
            return 0


# ═══════════════════════════════════════════════════════════════════════
#  第九部分：自检与命令行入口
# ═══════════════════════════════════════════════════════════════════════

def run_selftest():
    """不依赖网站、不依赖 LibreOffice，验证四大功能的核心链路。"""
    print("=" * 66)
    print(" PyLab 自检（实验八 大作业二）")
    print("=" * 66)

    failures = []

    def check(name, cond, detail=""):
        print("  [%s] %-28s %s" % ("PASS" if cond else "FAIL", name, detail))
        if not cond:
            failures.append(name)

    # 功能一
    room = Classroom(seed=42)
    r1 = room.roster.pick(3)
    check("① 点名返回 3 人", len(r1["picked"]) == 3, str(r1["picked"]))
    check("① 本轮剩余正确", r1["remaining"] == len(STUDENTS) - 3,
          "剩余 %d" % r1["remaining"])
    room.roster.reset()
    # 单次最多抽 10 人（产品限制），所以连续抽到本轮池子空为止
    guard = 0
    while room.roster.remaining and guard < 20:
        room.roster.pick(min(10, len(room.roster.remaining)))
        guard += 1
    check("① 抽完一整轮不报错", len(room.roster.called) == len(STUDENTS),
          "累计抽了 %d 人" % len(room.roster.called))
    r2 = room.roster.pick(1)
    check("① 抽完自动开新一轮", r2["round"] == 2 and r2["wrapped"] is True,
          "第 %d 轮" % r2["round"])
    room.roster.mark(STUDENTS[0], "present")
    room.roster.mark(STUDENTS[0], "late")
    s = room.roster.summary()
    row0 = [x for x in s["rows"] if x["name"] == STUDENTS[0]][0]
    check("① 考勤计数与出勤率", row0["present"] == 1 and row0["late"] == 1
          and row0["rate"] == 50.0, "出勤率 %s%%" % row0["rate"])

    # 功能二
    deck = Deck()
    check("② 课件页数", deck.count() == len(SLIDES), "共 %d 页" % deck.count())
    first = deck.at(0)
    second = deck.goto("next")
    check("② 翻页有效", second["index"] == 1, "第 %d 页" % second["pageNo"])
    check("② 页码与片段挂接", deck.snippets_on_page(2) == ["s01_var"],
          str(deck.snippets_on_page(2)))
    check("② 无片段页返回空", deck.snippets_on_page(1) == [], "第1页无片段")

    # 功能三
    res = room.run_snippet("s02_loop")
    check("③ 片段运行成功", res["run"]["ok"], "%d ms" % res["run"]["durationMs"])
    check("③ 输出内容正确", "5050" in res["run"]["output"],
          (res["run"]["output"].splitlines() or [""])[0])
    try:
        room.run_snippet("not_exist")
        check("③ 非法片段被拒", False)
    except KeyError:
        check("③ 非法片段被拒", True, "KeyError")

    # 功能四
    res4 = room.run_extension("e02_caesar")
    check("④ 拓展案例运行成功", res4["run"]["ok"], "%d ms" % res4["run"]["durationMs"])
    check("④ 往返加解密一致", "True" in res4["run"]["output"], "原文可还原")

    # 沙箱
    bad = run_code("import os\nprint(os.listdir('.'))", timeout=2)
    check("闸1 禁止 import os", not bad["ok"] and "沙箱限制" in bad["error"], "已拦")
    bad2 = run_code("open('x.txt','w').write('x')", timeout=2)
    check("闸2 禁止写文件", not bad2["ok"] and "沙箱限制" in bad2["error"], "已拦")
    bad3 = run_code("while True:\n    pass", timeout=1.5)
    check("闸3 死循环超时", not bad3["ok"] and "超时" in bad3["error"],
          "%d ms 后终止" % bad3["durationMs"])
    good = run_code("print('中文正常 ✓'.replace('✓','OK'))", timeout=2)
    check("闸4 中文输出不乱码", good["ok"] and "中文正常" in good["output"],
          good["output"])

    # 转换能力（环境探测，不算失败）
    soffice = find_soffice()
    print("\n  环境：Python %s" % sys.version.split()[0])
    print("  环境：LibreOffice %s" % (soffice or "未安装（--convert 不可用，其它功能不受影响）"))

    print("\n" + "=" * 66)
    if failures:
        print(" 结果：%d 项失败 → %s" % (len(failures), "、".join(failures)))
        return 1
    print(" 结果：全部通过")
    return 0


def cli_convert(path):
    print("转换：%s" % path)
    result = convert_pptx(path)
    if not result["ok"]:
        print("失败：%s" % result["error"])
        return 1
    print("成功：%s" % result["pdfPath"])
    print("页数：%s" % (result["pageCount"] if result["pageCount"] is not None else "未知"))
    print("耗时：%d ms" % result["durationMs"])
    return 0


def main(argv):
    args = argv[1:]

    if "--json" in args:
        return run_json()
    if "--selftest" in args:
        return run_selftest()
    if "--probe" in args:
        return run_json()
    if "--convert" in args:
        idx = args.index("--convert")
        if idx + 1 >= len(args):
            print("用法：python main.py --convert 文件.pptx")
            return 2
        return cli_convert(args[idx + 1])
    if "--help" in args or "-h" in args:
        print(__doc__)
        return 0

    return run_console()


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
